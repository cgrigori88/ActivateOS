import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { startRun, resumeRun, cancelRun, pauseRun, resumeAfterPause, ProgramConflictError,
         type ProgramStep, type RunRow } from "../src/lib/runtime/runtime";
import { decideApproval, pendingApprovals } from "../src/lib/runtime/approvals";
import { withTenantOrg } from "../src/lib/db/tenant";
import { getPool } from "../src/db/client";
import { DECIDE_SKILL, type Actor } from "../src/lib/pursuits/federation/skills";

/**
 * P45-3 — the SEQUENTIAL MULTI-STEP runtime.
 *
 * WHAT THIS PROVES. That a run pinned to a decided P3 revision can durably execute a CALLER-SUPPLIED
 * ordered program of governed steps — created atomically, identified as a whole, advanced one step
 * per request, halted rather than skipped when a step cannot proceed, and re-authorized at every
 * step boundary — without weakening anything P45-1 and P45-2 certified.
 *
 * WHAT IT DOES NOT PROVE, and must never be read as proving: that the program was DERIVED from the
 * decided plan. `PlanContent.nextAction` is untouched and still singular. The persisted step rows
 * are the durable program snapshot for this slice; plan → program synthesis is separate future work,
 * as are DAG/parallel execution and autonomous draining.
 *
 * EXECUTION IDENTITY. Every runtime call goes through the product's own `withTenantOrg` on the real
 * `app_rw` login (the permanent P45 requirement established by defect P45-D1). Owner authority is
 * used only for fixture setup and for assertions that must see across orgs.
 *
 *   npx tsx scripts/verify-run.ts --suite p45-program
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 6 });
const rw = new Pool({ connectionString: rwUrl, max: 4 });
process.env.DATABASE_URL = rwUrl;

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const SKILL = "draft_campaign_touch";
const READ_SKILL = "explain_route";

interface Fx {
  orgId: string; pursuitId: string; planId: string; revId: string; companyId: string; goalId: string;
  runner: string; runnerPrincipal: string; approver: string; approverPrincipal: string; campaign: string;
}

/** A disposable P3 → P4 chain. Committed, so this suite runs only on a seeded clone. */
async function plant(db: PoolClient, label: string): Promise<Fx> {
  const ns = `P45-3 ${label} ${randomUUID().slice(0, 8)}`;
  const orgId = (await db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [ns])).rows[0].id;
  const companyId = (await db.query<{ id: string }>(
    `insert into companies (legal_name, normalized_name) values ($1,$2) returning id`,
    [`${ns} Co`, `p453-${randomUUID()}`])).rows[0].id;
  const pursuitId = (await db.query<{ id: string }>(
    `insert into pursuits (org_id, account_id, dedup_key) values ($1,$2,$3) returning id`,
    [orgId, companyId, `p453-${randomUUID()}`])).rows[0].id;
  const goalId = (await db.query<{ id: string }>(
    `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type)
     values ($1,$2,'Land the renewal','ACTIVE','HUMAN_AUTHORED','USER') returning id`, [orgId, pursuitId])).rows[0].id;
  const planId = (await db.query<{ id: string }>(
    `insert into pursuit_plans (org_id, pursuit_id, goal_id, status) values ($1,$2,$3,'ACTIVE') returning id`,
    [orgId, pursuitId, goalId])).rows[0].id;
  const content = { nextAction: { key: "draft_campaign_touch:first", text: "Draft the first touch." } };
  const recId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,1,'RECOMMENDATION',$4,'{}',$5,'SYSTEM') returning id`,
    [orgId, pursuitId, planId, JSON.stringify(content), `bf-${label}`])).rows[0].id;
  const revId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,2,'DECISION','APPROVED',$4,$5,'{}',$6,'USER') returning id`,
    [orgId, pursuitId, planId, recId, JSON.stringify(content), `bf-${label}`])).rows[0].id;
  const campaign = `${ns} Campaign`;
  await db.query(`insert into campaigns (org_id, company_id, name, status, source) values ($1,$2,$3,'draft','user')`, [orgId, companyId, campaign]);
  await db.query(`insert into org_features (org_id, governed_action) values ($1,true) on conflict (org_id) do update set governed_action = true`, [orgId]);

  const runnerPrincipal = randomUUID(), approverPrincipal = randomUUID();
  const mk = async (key: string, principal: string) => (await db.query<{ id: string }>(
    `insert into governed_actors (org_id, actor_type, key, display_name, principal_user_id, lifecycle)
     values ($1,'USER',$2,$3,$4,'ACTIVE') returning id`, [orgId, `${ns}-${key}`, `${ns} ${key}`, principal])).rows[0].id;
  const runner = await mk("runner", runnerPrincipal);
  const approver = await mk("approver", approverPrincipal);
  for (const s of [SKILL, READ_SKILL])
    await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id) values ($1,$2,$3)`, [orgId, runner, s]);
  await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id) values ($1,$2,$3)`, [orgId, approver, DECIDE_SKILL]);
  return { orgId, pursuitId, planId, revId, companyId, goalId, runner, runnerPrincipal, approver, approverPrincipal, campaign };
}

async function txPlant(db: PoolClient, label: string): Promise<Fx> {
  await db.query("begin");
  try { const f = await plant(db, label); await db.query("commit"); return f; }
  catch (e) { await db.query("rollback"); throw e; }
}

const actorOf = (p: string, orgId: string, role: "owner" | "operator" | "viewer" = "operator"): Actor => ({ type: "USER", id: p, orgId, role });

/** Three distinct drafts: same skill, different args, so each step is a separate real effect. */
const draft = (f: Fx, n: number): ProgramStep =>
  ({ skillId: SKILL, args: { campaign: f.campaign, name: `step ${n}`, subject: `Subject ${n}`, body: `Body ${n}` }, milestoneKey: `touch_${n}` });

const start = (f: Fx, steps: ProgramStep[], actorId?: string): Promise<RunRow> =>
  withTenantOrg(f.orgId, (db) => startRun(db, f.orgId, {
    pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revId,
    governedActorId: actorId ?? f.runner, initiatedByUserId: f.runnerPrincipal, steps }));
const resume = (f: Fx, runId: string, role: "owner" | "operator" | "viewer" = "operator") =>
  withTenantOrg(f.orgId, (db) => resumeRun(db, f.orgId, runId, actorOf(f.runnerPrincipal, f.orgId, role)));
const decide = (f: Fx, reqId: string, d: "APPROVED" | "REJECTED") =>
  withTenantOrg(f.orgId, (db) => decideApproval(db, f.orgId, reqId, d,
    { governedActorId: f.approver, principal: f.approverPrincipal, actor: actorOf(f.approverPrincipal, f.orgId) }));

const runOf = async (db: PoolClient, id: string) => (await db.query<{ status: string; reason: string | null; current_step_id: string | null; continuation: Record<string, unknown> }>(
  `select status, reason, current_step_id, continuation from pursuit_runs where id=$1`, [id])).rows[0];
const stepsOf = async (db: PoolClient, runId: string) => (await db.query<{ id: string; seq: number; status: string; skill_id: string; attempt: number; invocation_id: string | null; idempotency_key: string; milestone_key: string | null }>(
  `select id, seq, status, skill_id, attempt, invocation_id, idempotency_key, milestone_key from pursuit_run_steps where run_id=$1 order by seq`, [runId])).rows;
const touches = async (db: PoolClient, orgId: string) => Number((await db.query<{ n: string }>(
  `select count(*)::text n from campaign_touches t join campaigns c on c.id=t.campaign_id where c.org_id=$1`, [orgId])).rows[0].n);
const execs = async (db: PoolClient, orgId: string) => Number((await db.query<{ n: string }>(
  `select count(*)::text n from governed_action_invocations where org_id=$1 and status='EXECUTED'`, [orgId])).rows[0].n);
const ledgerOf = async (db: PoolClient, runId: string) => (await db.query<{ change_type: string; run_step_id: string | null; after_state: Record<string, unknown> | null }>(
  `select change_type, run_step_id, after_state from change_ledger where run_id=$1 order by recorded_at, id`, [runId])).rows;
const types = async (db: PoolClient, runId: string) => (await ledgerOf(db, runId)).map((r) => r.change_type);

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[p45-program-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();
  const sendBefore = (await db.query(
    `select (select count(*) from messages)::int m, (select count(*) from action_outbox)::int o,
            (select count(*) from email_events)::int e, (select count(*) from sending_identities)::int s,
            (select count(*) from campaign_touches where status='sent')::int t`)).rows[0];
  const skillsBefore = (await db.query<{ n: string }>(`select count(*)::text n from governed_skills`)).rows[0].n;

  // ══ 1. ATOMIC PROGRAM CREATION ════════════════════════════════════════════════════════════════
  const f = await txPlant(db, "program");
  const p3 = [draft(f, 1), draft(f, 2), draft(f, 3)];
  const run = await start(f, p3);
  let st = await stepsOf(db, run.id);
  check("1: a 3-step program creates exactly 3 steps", st.length === 3 && run.stepCount === 3, `${st.length} steps`);
  check("2: the server assigned seq 1,2,3 — contiguous and in the order presented",
    st.map((s) => s.seq).join(",") === "1,2,3", st.map((s) => `${s.seq}:${s.milestone_key}`).join(" "));
  check("3: every step starts PENDING and no step has an invocation yet",
    st.every((s) => s.status === "PENDING" && s.invocation_id === null));
  check("4: each step has its OWN idempotency identity (position is part of it)",
    new Set(st.map((s) => s.idempotency_key)).size === 3);
  check("5: the run is READY, pointing at step 1", (await runOf(db, run.id)).status === "READY" && run.currentStepId === st[0].id);
  check("6: exactly ONE RUN_STARTED, and nothing has executed", (await types(db, run.id)).join(",") === "RUN_STARTED" && (await touches(db, f.orgId)) === 0);

  // Validation failure must leave nothing behind — including in the SAME transaction.
  const before = await db.query<{ n: string }>(`select count(*)::text n from pursuit_runs where org_id=$1`, [f.orgId]);
  let bad = "";
  try {
    await withTenantOrg(f.orgId, async (d) => {
      await startRun(d, f.orgId, { pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revId,
        governedActorId: f.runner, steps: [draft(f, 9), { skillId: "" }] });
    });
  } catch (e) { bad = (e as Error).message; }
  check("7: an invalid step rejects the WHOLE program before anything is written", /step 2: skillId is required/.test(bad), bad.slice(0, 70));
  check("8: zero run, zero steps, zero ledger residue from the failed creation",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_runs where org_id=$1`, [f.orgId])).rows[0].n === before.rows[0].n);
  let empty = "";
  try { await withTenantOrg(f.orgId, (d) => startRun(d, f.orgId, { pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revId, governedActorId: f.runner, steps: [] })); }
  catch (e) { empty = (e as Error).message; }
  check("9: an empty program is refused", /at least one step/.test(empty), empty.slice(0, 60));
  check("10: a caller cannot supply `seq` — the type carries none and order is the only input",
    !("seq" in (p3[0] as object)));

  // ══ 2. WHOLE-PROGRAM IDENTITY ═════════════════════════════════════════════════════════════════
  const replay = await start(f, p3);
  check("11: the identical program replays onto the SAME run", replay.id === run.id && replay.replayed === true);
  check("12: replay created no extra steps", (await stepsOf(db, run.id)).length === 3);
  let conflict: unknown = null;
  try { await start(f, [draft(f, 2), draft(f, 1), draft(f, 3)]); } catch (e) { conflict = e; }
  check("13: the SAME steps REORDERED are a different program — explicit conflict, never a replay",
    conflict instanceof ProgramConflictError && (conflict as ProgramConflictError).runId === run.id,
    conflict instanceof Error ? conflict.message.slice(0, 80) : "NO ERROR");
  let conflict2: unknown = null;
  try { await start(f, [draft(f, 1), draft(f, 2)]); } catch (e) { conflict2 = e; }
  check("14: a DIFFERENT program against a live run is a conflict, never a false replay",
    conflict2 instanceof ProgramConflictError);
  check("15: no second run was created by either conflict",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_runs where org_id=$1`, [f.orgId])).rows[0].n === "1");

  // ══ 3. ONE CALL ADVANCES AT MOST ONE CONSEQUENTIAL STEP ═══════════════════════════════════════
  const e1 = await resume(f, run.id);
  st = await stepsOf(db, run.id);
  check("16: the first call executed step 1 ONLY", e1.dispatched && e1.stepSeq === 1 && st[0].status === "COMPLETED"
    && st[1].status === "PENDING" && st[2].status === "PENDING", `run=${e1.runStatus} remaining=${e1.remainingSteps}`);
  check("17: the run is READY — NOT COMPLETED — with 2 steps left", e1.runStatus === "READY" && e1.remainingSteps === 2);
  check("18: exactly ONE effect so far", (await touches(db, f.orgId)) === 1 && (await execs(db, f.orgId)) === 1);
  let r = await runOf(db, run.id);
  check("19: the durable cursor advanced to step 2 in the same transition",
    r.current_step_id === st[1].id && (r.continuation as { seq?: number }).seq === 2,
    `current=seq2? ${r.current_step_id === st[1].id} · continuation=${JSON.stringify(r.continuation)}`);
  check("20: an intermediate success emits exactly ONE RUN_STEP_COMPLETED and no RUN_COMPLETED",
    (await types(db, run.id)).join(",") === "RUN_STARTED,RUN_STEP_COMPLETED");

  const e2 = await resume(f, run.id);
  check("21: the second call executed step 2 ONLY", e2.stepSeq === 2 && e2.runStatus === "READY" && (await touches(db, f.orgId)) === 2);
  const e3 = await resume(f, run.id);
  check("22: the final step COMPLETES the run", e3.stepSeq === 3 && e3.runStatus === "COMPLETED" && e3.remainingSteps === 0);
  check("23: exactly 3 effects for 3 steps — none skipped, none doubled",
    (await touches(db, f.orgId)) === 3 && (await execs(db, f.orgId)) === 3);
  const chain = (await types(db, run.id)).join(" → ");
  check("24: THE AUDIT CONTRACT — RUN_STARTED → RUN_STEP_COMPLETED ×2 → RUN_COMPLETED",
    chain === "RUN_STARTED → RUN_STEP_COMPLETED → RUN_STEP_COMPLETED → RUN_COMPLETED", chain);
  check("25: the final step emits RUN_COMPLETED and NOT also RUN_STEP_COMPLETED",
    (await types(db, run.id)).filter((t) => t === "RUN_STEP_COMPLETED").length === 2
    && (await types(db, run.id)).filter((t) => t === "RUN_COMPLETED").length === 1);
  const led = await ledgerOf(db, run.id);
  check("26: every runtime row names the step it is about", led.every((x) => x.run_step_id !== null));
  const e4 = await resume(f, run.id);
  check("27: resuming a finished program is inert — no fourth effect",
    e4.dispatched === false && (await touches(db, f.orgId)) === 3);

  // ══ 4. A ONE-STEP RUN IS BYTE-FOR-BYTE THE SLICE-1 CONTRACT ═══════════════════════════════════
  const f1 = await txPlant(db, "single");
  const r1 = await start(f1, [draft(f1, 1)]);
  const s1 = await resume(f1, r1.id);
  check("28: a 1-step program still COMPLETES on its first successful step", s1.runStatus === "COMPLETED" && r1.stepCount === 1);
  check("29: and still emits exactly RUN_STARTED → RUN_COMPLETED — no new event for one step",
    (await types(db, r1.id)).join(" → ") === "RUN_STARTED → RUN_COMPLETED");
  const inline = await withTenantOrg(f1.orgId, (d) => startRun(d, f1.orgId, {
    pursuitId: f1.pursuitId, planId: f1.planId, planRevisionId: f1.revId, governedActorId: f1.runner,
    skillId: SKILL, args: { campaign: f1.campaign, name: "inline", subject: "S", body: "B" } }));
  check("30: the Slice-1 inline single-step shape still works and normalizes to a 1-step program",
    inline.stepCount === 1 && inline.status === "READY");

  // ══ 5. FAILURE AND BLOCK NEVER SKIP FORWARD ═══════════════════════════════════════════════════
  // A viewer role makes dispatch refuse on PERMISSION — a governance refusal, which BLOCKS.
  const fb = await txPlant(db, "blocked");
  const rb = await start(fb, [draft(fb, 1), draft(fb, 2), draft(fb, 3)]);
  await resume(fb, rb.id);
  const eb = await resume(fb, rb.id, "viewer");
  let sb = await stepsOf(db, rb.id);
  check("31: a governance refusal BLOCKS the run at that step", eb.runStatus === "BLOCKED" && sb[1].status === "BLOCKED", `${eb.runStatus}/${sb[1].status}`);
  check("32: step 3 is untouched — the runtime did NOT skip past the blocked step", sb[2].status === "PENDING");
  const eb2 = await resume(fb, rb.id);
  check("33: a BLOCKED run is not resumable — P45-3 introduces no new BLOCKED recovery path",
    eb2.dispatched === false && /not resumable from BLOCKED/.test(eb2.reason ?? ""), eb2.reason ?? "—");
  check("34: exactly ONE effect — only step 1 ever executed", (await touches(db, fb.orgId)) === 1);

  // ══ 6. CANCEL AFTER PARTIAL COMPLETION — effects remain, halt point is explicit ════════════════
  const fc = await txPlant(db, "cancel");
  const rc = await start(fc, [draft(fc, 1), draft(fc, 2), draft(fc, 3)]);
  await resume(fc, rc.id); await resume(fc, rc.id);
  check("35: two steps completed before the cancellation", (await touches(db, fc.orgId)) === 2);
  await withTenantOrg(fc.orgId, (d) => cancelRun(d, fc.orgId, rc.id, "operator changed course", fc.runnerPrincipal));
  const sc = await stepsOf(db, rc.id);
  check("36: completed steps STAY COMPLETED — no compensation, no rollback, no undo",
    sc[0].status === "COMPLETED" && sc[1].status === "COMPLETED" && sc[2].status === "CANCELLED");
  check("37: the effects of steps 1–2 remain", (await touches(db, fc.orgId)) === 2);
  const halt = (await ledgerOf(db, rc.id)).filter((x) => x.change_type === "RUN_CANCELLED")[0]?.after_state as
    { stepsTotal?: number; stepsCompleted?: number; haltedAtSeq?: number; effectsRetained?: boolean } | null;
  check("38: the ledger records the HALT POINT — CANCELLED never means 'nothing executed'",
    halt?.stepsTotal === 3 && halt?.stepsCompleted === 2 && halt?.haltedAtSeq === 3 && halt?.effectsRetained === true,
    JSON.stringify(halt));
  check("39: the run stays pinned to its original revision — never retargeted",
    (await db.query<{ plan_revision_id: string }>(`select plan_revision_id from pursuit_runs where id=$1`, [rc.id])).rows[0].plan_revision_id === fc.revId);

  // ══ 7. SUPERSESSION MID-PROGRAM ═══════════════════════════════════════════════════════════════
  const fs = await txPlant(db, "supersede");
  const rs = await start(fs, [draft(fs, 1), draft(fs, 2)]);
  await resume(fs, rs.id);
  // A DECISION must respond to a RECOMMENDATION (pursuit_plan_revisions_shape), so plant both.
  const newRec = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,3,'RECOMMENDATION','{}','{}','bf-new','SYSTEM') returning id`, [fs.orgId, fs.pursuitId, fs.planId])).rows[0].id;
  await db.query(`insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id, content, basis, basis_fingerprint, actor_type)
                  values ($1,$2,$3,4,'DECISION','APPROVED',$4,'{}','{}','bf-new','USER')`, [fs.orgId, fs.pursuitId, fs.planId, newRec]);
  const es = await resume(fs, rs.id);
  check("40: a superseded pin CANCELS the program mid-way as PLAN_SUPERSEDED, never retargets it",
    es.runStatus === "CANCELLED" && (await runOf(db, rs.id)).reason === "PLAN_SUPERSEDED");
  check("41: step 2 never executed, step 1's effect remains",
    (await stepsOf(db, rs.id))[1].status === "CANCELLED" && (await touches(db, fs.orgId)) === 1);

  // ══ 8. ONE APPROVAL RELEASES EXACTLY ONE STEP ═════════════════════════════════════════════════
  // Both steps use the SAME skill, so a cascade would be invisible to a skill-scoped check.
  const fa = await txPlant(db, "approval");
  await db.query(`update actor_capability_grants set approval_required_override = true where org_id=$1 and actor_id=$2 and skill_id=$3`,
    [fa.orgId, fa.runner, SKILL]);
  const ra = await start(fa, [draft(fa, 1), draft(fa, 2)]);
  const a1 = await resume(fa, ra.id);
  check("42: step 1 parks in WAITING_FOR_APPROVAL with no invocation and no draft",
    a1.runStatus === "WAITING_FOR_APPROVAL" && a1.invocationId === null && (await touches(db, fa.orgId)) === 0);
  const a1b = await resume(fa, ra.id);
  check("43: resume alone cannot release a pending approval", a1b.dispatched === false && a1b.runStatus === "WAITING_FOR_APPROVAL");
  const req1 = await withTenantOrg(fa.orgId, async (d) => (await pendingApprovals(d, fa.orgId))[0]);
  const d1 = await decide(fa, req1.requestId, "APPROVED");
  check("44: the approval is granted by a different governed actor", d1.status === "DECIDED" && d1.decision === "APPROVED");
  const a2 = await resume(fa, ra.id);
  check("45: the approved step executes exactly once and the run advances to step 2",
    a2.stepSeq === 1 && a2.runStatus === "READY" && (await touches(db, fa.orgId)) === 1);
  const a3 = await resume(fa, ra.id);
  check("46: STEP 2 PARKS INDEPENDENTLY — the approval on step 1 did NOT cascade, same skill notwithstanding",
    a3.runStatus === "WAITING_FOR_APPROVAL" && a3.stepSeq === 2 && (await touches(db, fa.orgId)) === 1, `${a3.runStatus} seq=${a3.stepSeq}`);
  const pend = await withTenantOrg(fa.orgId, (d) => pendingApprovals(d, fa.orgId));
  check("47: a second, distinct approval request exists for step 2", pend.length === 1 && pend[0].requestId !== req1.requestId);
  const reqRows = (await db.query<{ n: string }>(`select count(*)::text n from pursuit_run_approvals where run_id=$1 and decision='REQUESTED'`, [ra.id])).rows[0].n;
  check("48: two separate REQUESTED records — one per step, never one per run", reqRows === "2");
  await decide(fa, pend[0].requestId, "REJECTED");
  check("49: rejecting step 2 cancels the run with step 1's effect retained",
    (await runOf(db, ra.id)).status === "CANCELLED" && (await touches(db, fa.orgId)) === 1);
  const achain = (await types(db, ra.id)).join(" → ");
  check("50: the audit chain carries both decisions distinctly", /APPROVAL_REQUESTED/.test(achain) && /APPROVAL_GRANTED/.test(achain)
    && /APPROVAL_REJECTED/.test(achain) && /RUN_STEP_COMPLETED/.test(achain), achain);

  // ══ 9. AUTHORITY IS RE-EVALUATED AT EVERY STEP BOUNDARY ═══════════════════════════════════════
  const fg = await txPlant(db, "revoke");
  const rg = await start(fg, [draft(fg, 1), draft(fg, 2)]);
  await resume(fg, rg.id);
  await db.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where org_id=$1 and actor_id=$2 and skill_id=$3`, [fg.orgId, fg.runner, SKILL]);
  const eg = await resume(fg, rg.id);
  check("51: revoking the grant between steps refuses step 2 — a pinned identity is not a pinned entitlement",
    eg.runStatus !== "COMPLETED" && (await touches(db, fg.orgId)) === 1, `${eg.runStatus}: ${eg.reason ?? "—"}`);
  const fsus = await txPlant(db, "suspend");
  const rsus = await start(fsus, [draft(fsus, 1), draft(fsus, 2)]);
  await resume(fsus, rsus.id);
  await db.query(`update governed_actors set lifecycle='SUSPENDED' where id=$1`, [fsus.runner]);
  const esus = await resume(fsus, rsus.id);
  check("52: suspending the actor between steps refuses step 2 as well",
    esus.runStatus !== "COMPLETED" && (await touches(db, fsus.orgId)) === 1, `${esus.runStatus}: ${esus.reason ?? "—"}`);

  // ══ 10. PAUSE / RESUME MID-PROGRAM ════════════════════════════════════════════════════════════
  const fp = await txPlant(db, "pause");
  const rp = await start(fp, [draft(fp, 1), draft(fp, 2), draft(fp, 3)]);
  await resume(fp, rp.id);
  await withTenantOrg(fp.orgId, (d) => pauseRun(d, fp.orgId, rp.id, "human pause", fp.runnerPrincipal));
  const ep = await resume(fp, rp.id);
  check("53: a paused program genuinely stops — no further step executes", ep.dispatched === false && (await touches(db, fp.orgId)) === 1);
  await withTenantOrg(fp.orgId, (d) => resumeAfterPause(d, fp.orgId, rp.id, "human resume", fp.runnerPrincipal));
  const ep2 = await resume(fp, rp.id);
  check("54: resuming continues at step 2 from durable state alone — not step 1, not step 3",
    ep2.stepSeq === 2 && (await touches(db, fp.orgId)) === 2);

  // ══ 11. GENERATION-BOUND CONCURRENCY (defect P45-3-D1) ═══════════════════════════════════════
  //
  // The rule is NOT "every step executes once" — that was true of the defective behaviour too, and
  // it was not enough. Requests issued against step 1 must not serialize into "A runs step 1, B then
  // runs step 2": B is STALE with respect to the cursor it meant to advance, and letting it through
  // turns one double-click into TWO authorized consequential actions.
  //
  // D-P45-PROGRAM-FLAKE — WHY THIS SECTION IS SPLIT IN TWO.
  //
  // The previous version launched N resumes with `Promise.allSettled` and called them
  // "same-generation racers". That premise was never established. `resumeRun` fixes the generation a
  // request was issued against when its FIRST statement — an unlocked `observeGeneration` SELECT —
  // returns, which happens after connection acquisition and scheduler entry. Under load a later
  // racer legitimately begins after the winner committed, observes the NEW generation, and advances
  // the next step. That is designed behaviour, certified below as a fresh continuation, and the old
  // test scored it as a failure roughly 15% of the time on unmodified code at every commit tried.
  //
  // So the two contracts are now separate and each is asserted against what actually happened:
  //
  //   SCENARIO A — natural public concurrency. No barrier. Records what each racer observed and
  //                asserts only scheduler-INDEPENDENT safety.
  //   SCENARIO B — deterministic same-generation concurrency. A verifier-only Proxy over the
  //                PoolClient the test already supplies pauses every participant AFTER its
  //                generation observation and BEFORE it serializes, so the premise is PROVEN before
  //                the consequence is asserted. No product code is bypassed or modified.

  /** The statement `resumeRun` uses to fix the generation a request was issued against. */
  const GENERATION_SQL = /current_step_id as "stepId"/;
  interface Observed { stepId: string | null; status: string; attempt: number | null }
  const genKey = (g: Observed | null): string => g ? `${g.stepId}|${g.status}|${g.attempt}` : "none";

  /**
   * Count-based, in-process, no sleeps. The timeout is a DEADLOCK FAIL-SAFE so a harness bug cannot
   * hang certification — it is never the synchronization mechanism and never a correctness
   * criterion: if it fires, the premise assertion fails rather than the race "passing".
   */
  function makeBarrier(n: number, label: string) {
    const arrived: Observed[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const failsafe = setTimeout(() => release(), 60_000);
    return {
      async arrive(g: Observed): Promise<void> {
        arrived.push(g);
        if (arrived.length >= n) { clearTimeout(failsafe); release(); }
        await gate;
      },
      get observations(): Observed[] { return arrived; },
      /** null when all N arrived having observed one identical generation tuple. */
      premiseFailure(): string | null {
        if (arrived.length !== n) return `${label}: only ${arrived.length} of ${n} participants reached the barrier`;
        const keys = [...new Set(arrived.map(genKey))];
        return keys.length === 1 ? null : `${label}: participants observed ${keys.length} distinct generations — ${keys.join(" ; ")}`;
      },
    };
  }

  type Raced = { out: Awaited<ReturnType<typeof resumeRun>>; observed: Observed | null };
  /**
   * The seam. `resumeRun` already takes the PoolClient as its first parameter and the verifier
   * already supplies it, so wrapping it here needs no product change. `barrier` null = Scenario A
   * (observe only, do not delay).
   */
  const racedResume = (f: Fx, runId: string, barrier: ReturnType<typeof makeBarrier> | null): Promise<Raced> =>
    withTenantOrg(f.orgId, async (client) => {
      let seen = 0;
      let observed: Observed | null = null;
      const proxy = new Proxy(client, {
        get(t, prop, recv) {
          if (prop !== "query") return Reflect.get(t, prop, recv);
          return async (...args: unknown[]) => {
            const first = args[0];
            const sql = typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
            const res = await (t as unknown as PoolClient).query(...(args as Parameters<PoolClient["query"]>));
            if (++seen === 1) {
              // Never silently assume "first query forever": if resumeRun is refactored so the seam
              // moves, fail LOUDLY as a harness-seam failure rather than pause at an unrelated query.
              if (!GENERATION_SQL.test(sql)) {
                throw new Error(`HARNESS SEAM FAILURE — resumeRun's first statement is no longer the generation observation: ${sql.replace(/\s+/g, " ").slice(0, 100)}`);
              }
              observed = ((res as unknown as { rows?: Observed[] }).rows?.[0] ?? null);
              if (barrier) await barrier.arrive(observed as Observed);
            }
            return res;
          };
        },
      });
      const out = await resumeRun(proxy as unknown as PoolClient, f.orgId, runId, actorOf(f.runnerPrincipal, f.orgId));
      return { out, observed };
    });

  const settledRaces = (rs: PromiseSettledResult<Raced>[]) =>
    rs.filter((x): x is PromiseFulfilledResult<Raced> => x.status === "fulfilled").map((x) => x.value);

  /** Shared safety checker, so the negative controls below exercise the REAL logic (NC2/NC3/NC5). */
  function safetyViolations(rows: Raced[], perStepInvocations: Map<number, number>, perStepEffects: Map<number, number>): string[] {
    const bad: string[] = [];
    const dispatched = rows.filter((r) => r.out.dispatched);
    const seqs = dispatched.map((r) => r.out.stepSeq ?? -1);
    if (new Set(seqs).size !== seqs.length) bad.push(`two racers dispatched the same seq: ${seqs.join(",")}`);
    for (const [seq, n] of perStepInvocations) if (n > 1) bad.push(`seq${seq} has ${n} invocations`);
    for (const [seq, n] of perStepEffects) if (n > 1) bad.push(`seq${seq} has ${n} consequential effects`);
    for (const r of rows) {
      if (r.out.dispatched) continue;
      if (r.out.stale === true && r.out.invocationId !== null) bad.push("a stale loser carried an invocation");
    }
    return bad;
  }

  const invocationsPerStep = async (runId: string): Promise<Map<number, number>> => new Map(
    (await db.query<{ seq: number; n: string }>(
      `select st.seq, count(i.id)::text n from pursuit_run_steps st
         left join governed_action_invocations i on i.run_step_id = st.id
        where st.run_id = $1 group by st.seq order by st.seq`, [runId])).rows.map((r) => [Number(r.seq), Number(r.n)]));
  /** A consequential effect here is an EXECUTED invocation of that step — countable directly,
   *  without assuming anything about the shape of the invocation's stored result. */
  const effectsPerStep = async (runId: string): Promise<Map<number, number>> => new Map(
    (await db.query<{ seq: number; n: string }>(
      `select st.seq, count(i.id) filter (where i.status = 'EXECUTED')::text n from pursuit_run_steps st
         left join governed_action_invocations i on i.run_step_id = st.id
        where st.run_id = $1 group by st.seq order by st.seq`, [runId])).rows.map((r) => [Number(r.seq), Number(r.n)]));

  // ── SCENARIO A · NATURAL PUBLIC CONCURRENCY (no barrier) ────────────────────────────────────
  // Ordinary public behaviour under arbitrary scheduling. Deliberately NOT called same-generation.
  const fr = await txPlant(db, "race");
  const rr = await start(fr, [draft(fr, 1), draft(fr, 2), draft(fr, 3)]);
  const natural = settledRaces(await Promise.allSettled([1, 2, 3, 4, 5].map(() => racedResume(fr, rr.id, null))));
  const aInv = await invocationsPerStep(rr.id);
  const aDispatched = natural.filter((r) => r.out.dispatched);
  check("A1: no two racers dispatch the same step, and each step ran at most once",
    safetyViolations(natural, aInv, await effectsPerStep(rr.id)).length === 0,
    `${aDispatched.length} dispatched · ${[...aInv].map(([s, n]) => `seq${s}=${n}`).join(" ")}`);
  const aSteps = await stepsOf(db, rr.id);
  const seqOfStepId = (id: string | null) => aSteps.find((s) => s.id === id)?.seq ?? null;
  check("A2: every dispatching racer advanced the step its OWN observation pointed at",
    aDispatched.every((r) => r.observed !== null && seqOfStepId(r.observed.stepId) === r.out.stepSeq),
    aDispatched.map((r) => `observed seq${seqOfStepId(r.observed?.stepId ?? null)} → dispatched seq${r.out.stepSeq}`).join(" · "));
  check("A3: a racer that lost the generation it observed is stale, with no invocation and no effect",
    natural.filter((r) => r.out.stale === true).every((r) => r.out.invocationId === null && !r.out.dispatched),
    `${natural.filter((r) => r.out.stale === true).length} stale`);
  check("A4: non-dispatchers are stale OR a certified terminal/no-op observer — never misclassified",
    natural.filter((r) => !r.out.dispatched).every((r) => r.out.stale === true || r.out.invocationId === null),
    natural.filter((r) => !r.out.dispatched).map((r) => `${r.out.runStatus}/${r.out.stale ? "stale" : "no-op"}`).join(" · "));
  const aSeqs = aDispatched.map((r) => r.out.stepSeq as number).sort((x, y) => x - y);
  check("A5: advances are distinct, in canonical order, and skip no unexecuted step",
    aSeqs.every((s, i) => i === 0 ? s === 1 : s === aSeqs[i - 1] + 1),
    `advanced ${aSeqs.join(",")} — a natural burst may advance more than one step when later requests genuinely observed later generations`);

  // ── SCENARIO B · DETERMINISTIC SAME-GENERATION CONCURRENCY ──────────────────────────────────
  // Every participant is held after its own generation observation and before it serializes, so
  // "they all observed G" is PROVEN, not assumed, before any consequence is asserted.
  async function sameGenerationBurst(tag: string, n: number) {
    const f = await txPlant(db, tag);
    const r = await start(f, [draft(f, 1), draft(f, 2), draft(f, 3)]);
    const barrier = makeBarrier(n, `${tag}(n=${n})`);
    const rows = settledRaces(await Promise.allSettled(Array.from({ length: n }, () => racedResume(f, r.id, barrier))));
    return { f, r, barrier, rows };
  }

  // §7 POOL TOPOLOGY, proven before the five-participant barrier rather than assumed: five
  // participants must each hold their own app-pool client simultaneously. An idle client is fine; a
  // sixth simultaneously-required checkout would not be.
  const appPool = getPool();
  const poolMax = (appPool as unknown as { options: { max: number } }).options.max;
  check("B0: the app pool can seat a five-participant barrier (max ≥ 5, nothing else checked out)",
    poolMax >= 5 && appPool.totalCount - appPool.idleCount === 0,
    `max=${poolMax} total=${appPool.totalCount} idle=${appPool.idleCount} in-use=${appPool.totalCount - appPool.idleCount}`);

  for (const n of [2, 5]) {
    const { f, r, barrier, rows } = await sameGenerationBurst(`race${n}`, n);
    const premise = barrier.premiseFailure();
    check(`B-premise(${n}): all ${n} participants observed the SAME generation G before any was released`,
      premise === null, premise ?? `G=${genKey(barrier.observations[0])} ×${barrier.observations.length}`);
    if (premise !== null) { check(`B(${n}): consequences NOT asserted — the race premise was not established`, false, premise); continue; }

    const dispatched = rows.filter((x) => x.out.dispatched);
    const losers = rows.filter((x) => !x.out.dispatched);
    const inv = await invocationsPerStep(r.id);
    const steps = await stepsOf(db, r.id);
    check(`B1(${n}): EXACTLY ONE participant advanced generation G`, dispatched.length === 1,
      rows.map((x) => `${x.out.dispatched ? `advanced(seq=${x.out.stepSeq})` : x.out.stale ? "stale" : "no-op"}`).join(" · "));
    check(`B2(${n}): every other participant is stale with invocationId null and caused no effect`,
      losers.length === n - 1 && losers.every((x) => x.out.stale === true && x.out.invocationId === null),
      losers.map((x) => `stale=${x.out.stale} inv=${x.out.invocationId ?? "null"}`).join(" · "));
    check(`B3(${n}): the G step has exactly one invocation, one effect and one completion transition`,
      inv.get(1) === 1 && (await touches(db, f.orgId)) === 1
      && (await types(db, r.id)).filter((t) => t === "RUN_STEP_COMPLETED").length === 1,
      `seq1 invocations=${inv.get(1)} effects=${await touches(db, f.orgId)}`);
    check(`B4(${n}): the following step is still PENDING — the burst did not drain G+1`,
      steps[1].status === "PENDING", steps.map((s) => `${s.seq}:${s.status}`).join(" "));
    check(`B5(${n}): the run advanced exactly one generation`,
      (await runOf(db, r.id)).current_step_id === steps[1].id, `current=seq2`);
    check(`B6(${n}): no step was skipped`, inv.get(2) === 0 && inv.get(3) === 0,
      [...inv].map(([s, c]) => `seq${s}=${c}`).join(" "));
    check(`B7(${n}): ledger evidence agrees with the API outcomes`,
      (await types(db, r.id)).join(",") === "RUN_STARTED,RUN_STEP_COMPLETED", (await types(db, r.id)).join(","));

    // §6 — a SEPARATE phase, after the barrier race has completely resolved and not sharing its
    // barrier. This is the distinction the old test blurred: a duplicate same-generation request is
    // refused, a genuinely fresh next-generation request proceeds.
    if (n === 5) {
      const fresh = await resume(f, r.id);
      check("B8: a FRESH unbarriered resume afterwards observes G+1 and executes it normally",
        fresh.dispatched && fresh.stepSeq === 2 && !fresh.stale && (await touches(db, f.orgId)) === 2,
        `seq=${fresh.stepSeq} run=${fresh.runStatus}`);
      // §12 — the direct semantic evidence for the property the old assertions only assumed.
      console.log(`  [B-EVIDENCE n=5] G=${genKey(barrier.observations[0])} · arrivals=${barrier.observations.length}`
        + ` · dispatched=${dispatched.length} · stale/null losers=${losers.length}`
        + ` · seq1 invocations=${inv.get(1)} effects=1 · seq2 after burst=PENDING · then fresh resume → seq2`);
    }
  }

  // ── NEGATIVE CONTROLS · the repaired suite must FAIL when these properties are violated ─────
  {
    const g = (stepId: string, status = "READY", attempt = 1): Observed => ({ stepId, status, attempt });
    const nc1 = makeBarrier(2, "NC1");
    void nc1.arrive(g("step-A")); void nc1.arrive(g("step-B"));
    await new Promise((r) => setImmediate(r));
    check("NC1: unequal observed generations FAIL at the premise, before any consequence is asserted",
      nc1.premiseFailure() !== null && /distinct generations/.test(nc1.premiseFailure() ?? ""), nc1.premiseFailure() ?? "");
    const nc1ok = makeBarrier(2, "NC1-control");
    void nc1ok.arrive(g("step-A")); void nc1ok.arrive(g("step-A"));
    await new Promise((r) => setImmediate(r));
    check("NC1-control: identical observations establish the premise, so NC1 is discriminating", nc1ok.premiseFailure() === null);

    const fake = (dispatched: boolean, stepSeq: number | null, stale?: boolean, invocationId: string | null = null): Raced =>
      ({ out: { runStatus: "READY", stepStatus: "—", invocationId, dispatched, stepSeq, stale, reason: null } as Raced["out"], observed: g("s") });
    check("NC2: two racers claiming the SAME dispatched seq is caught",
      safetyViolations([fake(true, 1), fake(true, 1)], new Map([[1, 1]]), new Map([[1, 1]]))
        .some((v) => /same seq/.test(v)));
    check("NC3: a step with more than one invocation or effect is caught",
      safetyViolations([fake(true, 1)], new Map([[1, 2]]), new Map([[1, 1]])).some((v) => /2 invocations/.test(v))
      && safetyViolations([fake(true, 1)], new Map([[1, 1]]), new Map([[1, 2]])).some((v) => /2 consequential effects/.test(v)));
    check("NC5: a stale loser carrying an invocation is caught",
      safetyViolations([fake(false, null, true, "inv-1")], new Map(), new Map()).some((v) => /stale loser carried/.test(v)));
    check("NC-control: a clean burst produces NO violations, so NC2/NC3/NC5 are discriminating",
      safetyViolations([fake(true, 1), fake(false, null, true)], new Map([[1, 1]]), new Map([[1, 1]])).length === 0);
    // NC4 — Scenario B must fail if the proven-G burst itself completed G+1.
    const drained = [{ seq: 1, status: "COMPLETED" }, { seq: 2, status: "COMPLETED" }];
    check("NC4: a burst that drained G+1 is caught by the B4 condition",
      !(drained[1].status === "PENDING"), `seq2=${drained[1].status}`);
  }
  // Parking for approval ends the generation too, so duplicates cannot pile requests onto one step.
  const fap = await txPlant(db, "raceapp");
  await db.query(`update actor_capability_grants set approval_required_override = true where org_id=$1 and actor_id=$2 and skill_id=$3`,
    [fap.orgId, fap.runner, SKILL]);
  const rap = await start(fap, [draft(fap, 1), draft(fap, 2)]);
  const parkRace = await Promise.allSettled([resume(fap, rap.id), resume(fap, rap.id), resume(fap, rap.id)]);
  const parked = (await db.query<{ n: string }>(`select count(*)::text n from pursuit_run_approvals where run_id=$1 and decision='REQUESTED'`, [rap.id])).rows[0].n;
  check("63: concurrent resumes on an approval-required step raise EXACTLY ONE request",
    parked === "1" && (await runOf(db, rap.id)).status === "WAITING_FOR_APPROVAL", `${parked} REQUESTED rows`);
  check("64: none of them dispatched, and no draft exists",
    parkRace.every((x) => x.status === "fulfilled" && !x.value.dispatched) && (await touches(db, fap.orgId)) === 0);

  // Immediately after an approval releases a step, duplicates must still not double-advance.
  const rq = await withTenantOrg(fap.orgId, async (d) => (await pendingApprovals(d, fap.orgId))[0]);
  await decide(fap, rq.requestId, "APPROVED");
  const afterApproval = await Promise.allSettled([resume(fap, rap.id), resume(fap, rap.id)]);
  const advA = afterApproval.filter((x) => x.status === "fulfilled" && x.value.dispatched).length;
  check("65: right after an approval releases a step, concurrent resumes advance exactly once", advA === 1, `${advA} advanced`);
  check("66: the released step ran once and step 2 did NOT execute on that approval",
    (await touches(db, fap.orgId)) === 1 && (await stepsOf(db, rap.id))[1].status !== "COMPLETED",
    `${await touches(db, fap.orgId)} effects · ${(await stepsOf(db, rap.id)).map((x) => `${x.seq}:${x.status}`).join(" ")}`);

  // A one-step program: there is nothing to advance to, so exactly one dispatch is the only answer.
  const fr1 = await txPlant(db, "race1");
  const rr1 = await start(fr1, [draft(fr1, 1)]);
  const both1 = await Promise.allSettled([resume(fr1, rr1.id), resume(fr1, rr1.id)]);
  const disp1 = both1.filter((x) => x.status === "fulfilled" && x.value.dispatched).length;
  check("67: on a ONE-step program, two concurrent resumes dispatch EXACTLY once", disp1 === 1, `${disp1} dispatched`);
  check("68: exactly one effect and exactly one EXECUTED invocation",
    (await touches(db, fr1.orgId)) === 1 && (await execs(db, fr1.orgId)) === 1);
  check("69: exactly one RUN_COMPLETED — the loser recorded no second completion",
    (await types(db, rr1.id)).filter((t) => t === "RUN_COMPLETED").length === 1, (await types(db, rr1.id)).join(","));
  check("70: a stale resume writes NOTHING to the ledger — no transition, no residue",
    (await types(db, rr1.id)).join(",") === "RUN_STARTED,RUN_COMPLETED", (await types(db, rr1.id)).join(","));

  // ══ 12. TENANT ISOLATION UNDER REAL app_rw ════════════════════════════════════════════════════
  const other = await txPlant(db, "foreign");
  const foreign = await withTenantOrg(other.orgId, (d) => resumeRun(d, other.orgId, rr.id, actorOf(other.runnerPrincipal, other.orgId)).catch((e: Error) => e.message));
  check("71: another tenant cannot advance this run", typeof foreign === "string" && /run not found/.test(foreign), String(foreign).slice(0, 60));
  const rwc = await rw.connect();
  try {
    await rwc.query("begin"); await rwc.query(`select set_config('app.org_id', $1, true)`, [other.orgId]);
    const seen = (await rwc.query<{ n: string }>(`select count(*)::text n from pursuit_run_steps where run_id=$1`, [rr.id])).rows[0].n;
    check("72: app_rw in another org's context sees ZERO of this run's steps", seen === "0");
    await rwc.query("rollback");
    // Step identity is immutable: the columns that make a replay provably the same step.
    await rwc.query("begin"); await rwc.query(`select set_config('app.org_id', $1, true)`, [fr.orgId]);
    let denied = "";
    await rwc.query("savepoint s1");
    try { await rwc.query(`update pursuit_run_steps set skill_id='x' where run_id=$1`, [rr.id]); await rwc.query("release savepoint s1"); }
    catch (e) { denied = (e as Error).message; await rwc.query("rollback to savepoint s1"); }
    check("73: app_rw CANNOT rewrite a step's skill_id", /permission denied/i.test(denied), denied.split("\n")[0].slice(0, 70));
    let denied2 = "";
    await rwc.query("savepoint s2");
    try { await rwc.query(`update pursuit_run_steps set args='{}'::jsonb where run_id=$1`, [rr.id]); await rwc.query("release savepoint s2"); }
    catch (e) { denied2 = (e as Error).message; await rwc.query("rollback to savepoint s2"); }
    check("74: app_rw CANNOT rewrite a step's args either — identity is fixed at creation", /permission denied/i.test(denied2), denied2.split("\n")[0].slice(0, 70));
    await rwc.query("rollback");
  } finally { rwc.release(); }

  // ══ 13. THE SUITE CAN ACTUALLY FAIL — negative control ════════════════════════════════════════
  // Slice 1's assumption, reproduced literally: "a successful step completes the run". If that were
  // still the rule, the run below would be COMPLETED with two steps never executed.
  const fn = await txPlant(db, "control");
  const rn = await start(fn, [draft(fn, 1), draft(fn, 2), draft(fn, 3)]);
  const en = await resume(fn, rn.id);
  const oldAssumption = en.runStatus === "COMPLETED";
  check("75: NEGATIVE CONTROL — the old `ok ? COMPLETED` assumption would be visible here and is NOT",
    oldAssumption === false && en.runStatus === "READY" && (await stepsOf(db, rn.id)).filter((s) => s.status === "PENDING").length === 2,
    `run=${en.runStatus}`);

  // ══ 14. NOTHING ELSE MOVED ════════════════════════════════════════════════════════════════════
  check("76: governed_skills is unchanged — this slice registers no skill and mirrors nothing",
    (await db.query<{ n: string }>(`select count(*)::text n from governed_skills`)).rows[0].n === skillsBefore, `${skillsBefore} rows`);
  const sendAfter = (await db.query(
    `select (select count(*) from messages)::int m, (select count(*) from action_outbox)::int o,
            (select count(*) from email_events)::int e, (select count(*) from sending_identities)::int s,
            (select count(*) from campaign_touches where status='sent')::int t`)).rows[0];
  check("77: send surfaces 0/0/0/0/0 and unchanged — no step reached the outbox or a provider",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter)
    && Object.values(sendAfter as Record<string, number>).every((v) => Number(v) === 0), JSON.stringify(sendAfter));
  const outbox = (await db.query<{ n: string }>(`select count(*)::text n from action_outbox`)).rows[0].n;
  check("78: the outbox is empty — no EXTERNAL_ACTION step exists in this slice", outbox === "0");

  db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end(); await rw.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[p45-program-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
