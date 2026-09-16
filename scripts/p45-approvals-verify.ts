import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { startRun, resumeRun } from "../src/lib/runtime/runtime";
import { decideApproval, pendingApprovals } from "../src/lib/runtime/approvals";
import { withTenantOrg } from "../src/lib/db/tenant";
import { DECIDE_SKILL, effectiveApprovalRequired, seedGovernedSkills, type Actor } from "../src/lib/pursuits/federation/skills";

/**
 * P45-2 — the approval lifecycle.
 *
 * EXECUTION IDENTITY. Per the permanent P45 requirement, every runtime and decision call below runs
 * through the product's own `withTenantOrg` on the REAL `app_rw` login. Owner authority is used only
 * to plant fixtures and to assert across orgs — never to execute.
 *
 * THE RULE UNDER TEST: approval authorizes continuation; it does not confer authority. So the
 * interesting cases are not the happy path — they are the ones where authority lapses while a
 * request waits, and the ones where two people decide at once.
 *
 *   npx tsx scripts/verify-run.ts --suite p45-approvals
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 6 });
const rw = new Pool({ connectionString: rwUrl, max: 4 });
process.env.DATABASE_URL = rwUrl;              // the product pool = the real runtime identity
process.env.VNEXT_CONTROL_PLANE_ENABLED = "true";

const SKILL = "draft_campaign_touch";
let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

interface Fx { orgId: string; pursuitId: string; planId: string; revId: string; bf: string;
               requester: string; approver: string; approver2: string; viewerActor: string;
               reqPrincipal: string; appPrincipal: string; app2Principal: string; campaign: string; }

/** A disposable org with a requesting actor, two independent approvers, and a viewer-role actor. */
async function plant(db: PoolClient, tag: string): Promise<Fx> {
  const ns = `P45-2-${tag}-${randomUUID().slice(0, 8)}`;
  const orgId = (await db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [`${ns} Org`])).rows[0].id;
  await db.query(`insert into org_features (org_id, pursuits, facts, routing, pursuit_experience, federation, governed_action)
                  values ($1,true,true,true,true,true,true)`, [orgId]);
  const companyId = (await db.query<{ id: string }>(
    `insert into companies (legal_name, normalized_name) values ($1,$2) returning id`, [`${ns} Co`, ns.toLowerCase()])).rows[0].id;
  const pursuitId = (await db.query<{ id: string }>(
    `insert into pursuits (org_id, account_id, dedup_key) values ($1,$2,$3) returning id`, [orgId, companyId, ns])).rows[0].id;
  const goalId = (await db.query<{ id: string }>(
    `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type)
     values ($1,$2,'Open the renewal','ACTIVE','HUMAN_AUTHORED','USER') returning id`, [orgId, pursuitId])).rows[0].id;
  const planId = (await db.query<{ id: string }>(
    `insert into pursuit_plans (org_id, pursuit_id, goal_id, status) values ($1,$2,$3,'ACTIVE') returning id`, [orgId, pursuitId, goalId])).rows[0].id;
  const content = { nextAction: { key: "draft_campaign_touch:first", text: `Draft the first campaign touch for ${ns}.` } };
  const recId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,1,'RECOMMENDATION',$4,'{}',$5,'SYSTEM') returning id`, [orgId, pursuitId, planId, JSON.stringify(content), `bf-${ns}`])).rows[0].id;
  const revId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,2,'DECISION','APPROVED',$4,$5,'{}',$6,'USER') returning id`, [orgId, pursuitId, planId, recId, JSON.stringify(content), `bf-${ns}`])).rows[0].id;
  const campaign = `${ns} Campaign`;
  await db.query(`insert into campaigns (org_id, company_id, name, status, source) values ($1,$2,$3,'draft','user')`, [orgId, companyId, campaign]);

  const mk = async (key: string, principal: string) => (await db.query<{ id: string }>(
    `insert into governed_actors (org_id, actor_type, key, display_name, principal_user_id, lifecycle)
     values ($1,'USER',$2,$3,$4,'ACTIVE') returning id`, [orgId, `${ns}-${key}`, `${ns} ${key}`, principal])).rows[0].id;
  const reqPrincipal = randomUUID(), appPrincipal = randomUUID(), app2Principal = randomUUID(), viewPrincipal = randomUUID();
  const requester = await mk("requester", reqPrincipal);
  const approver = await mk("approver", appPrincipal);
  const approver2 = await mk("approver2", app2Principal);
  const viewerActor = await mk("viewer", viewPrincipal);
  // The requester may run the action; both approvers may decide; the viewer actor holds the decision
  // grant too, so a refusal can only come from its ROLE, never from a missing capability.
  await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id) values ($1,$2,$3)`, [orgId, requester, SKILL]);
  for (const a of [approver, approver2, viewerActor])
    await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id) values ($1,$2,$3)`, [orgId, a, DECIDE_SKILL]);
  return { orgId, pursuitId, planId, revId, bf: `bf-${ns}`, requester, approver, approver2, viewerActor,
           reqPrincipal, appPrincipal, app2Principal, campaign };
}

/** draft_campaign_touch requires approval for this fixture — the canonical policy, set on the skill. */
const requireApproval = async (db: PoolClient, on: boolean) =>
  db.query(`update governed_skills set approval_required = $1 where skill_id = $2 and version = 1`, [on, SKILL]);

const actorOf = (p: string, orgId: string, role: "owner" | "operator" | "viewer" = "operator"): Actor =>
  ({ type: "USER", id: p, orgId, role });
const runOf = async (db: PoolClient, id: string) =>
  (await db.query<{ status: string; reason: string | null }>(`select status, reason from pursuit_runs where id=$1`, [id])).rows[0];
const touches = async (db: PoolClient, orgId: string) => Number((await db.query<{ n: string }>(
  `select count(*)::text n from campaign_touches t join campaigns c on c.id=t.campaign_id where c.org_id=$1`, [orgId])).rows[0].n);
const execs = async (db: PoolClient, orgId: string) => Number((await db.query<{ n: string }>(
  `select count(*)::text n from governed_action_invocations where org_id=$1 and status='EXECUTED' and skill_id=$2`, [orgId, SKILL])).rows[0].n);

const start = (f: Fx, extra: Record<string, unknown> = {}) => withTenantOrg(f.orgId, (db) => startRun(db, f.orgId, {
  pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revId, governedActorId: f.requester,
  initiatedByUserId: f.reqPrincipal, skillId: SKILL, args: { campaign: f.campaign, subject: "Renewal", body: "Hello", ...extra },
}));
const resume = (f: Fx, runId: string) => withTenantOrg(f.orgId, (db) => resumeRun(db, f.orgId, runId, actorOf(f.reqPrincipal, f.orgId)));
const decide = (f: Fx, reqId: string, d: "APPROVED" | "REJECTED", actorId: string, principal: string,
                role: "owner" | "operator" | "viewer" = "operator") =>
  withTenantOrg(f.orgId, (db) => decideApproval(db, f.orgId, reqId, d,
    { governedActorId: actorId, principal, actor: actorOf(principal, f.orgId, role) }));
const openRequest = async (db: PoolClient, f: Fx) => (await pendingApprovals(db, f.orgId))[0];

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[p45-approvals-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();
  const sendBefore = (await db.query(
    `select (select count(*) from messages)::int m, (select count(*) from action_outbox)::int o,
            (select count(*) from email_events)::int e, (select count(*) from sending_identities)::int s,
            (select count(*) from campaign_touches where status='sent')::int t`)).rows[0];
  // Mirror the code registry into governed_skills exactly as production does, so the decision
  // capability's canonical policy row exists and is operator-visible.
  await seedGovernedSkills(db);
  await requireApproval(db, true);

  // ── 1. policy resolution ────────────────────────────────────────────────────────────────────────
  console.log("\n=== policy: effectiveApprovalRequired ===");
  check("1: override NULL inherits the canonical skill policy",
    effectiveApprovalRequired(SKILL, true, null) === true && effectiveApprovalRequired(SKILL, false, null) === false);
  check("2: override TRUE narrows policy — approval required even when the skill does not demand it",
    effectiveApprovalRequired(SKILL, false, true) === true);
  check("3: override FALSE can NEVER weaken a canonical requirement (hard in Slice 2)",
    effectiveApprovalRequired(SKILL, true, false) === true);
  check("4: override FALSE yields 'not required' only when the skill itself does not require it",
    effectiveApprovalRequired(SKILL, false, false) === false);
  check("5: the decision capability can NEVER require approval — the recursion base case",
    effectiveApprovalRequired(DECIDE_SKILL, true, true) === false);

  // ── 2. the happy path ───────────────────────────────────────────────────────────────────────────
  console.log("\n=== request → approve → exactly one execution ===");
  const f = await plant(db, "happy");
  const r1 = await start(f);
  const e1 = await resume(f, r1.id);
  check("6: an approval-required action enters WAITING_FOR_APPROVAL", e1.runStatus === "WAITING_FOR_APPROVAL" && !e1.dispatched, e1.reason ?? "");
  check("7: NO consequential invocation and NO draft before approval", (await execs(db, f.orgId)) === 0 && (await touches(db, f.orgId)) === 0);
  const req = await openRequest(db, f);
  check("8: the request is visible as pending with its context", !!req && req.skillId === SKILL && !!req.account && !!req.whyRequired);
  check("9: resume alone cannot release a pending approval", (await resume(f, r1.id)).runStatus === "WAITING_FOR_APPROVAL");
  const d1 = await decide(f, req.requestId, "APPROVED", f.approver, f.appPrincipal);
  check("10: an authorized approver can APPROVE", d1.status === "DECIDED" && d1.decision === "APPROVED", d1.reason ?? "");
  check("11: APPROVE resumes the SAME persisted run (never a new or retargeted one)",
    (await runOf(db, r1.id)).status === "READY");
  const e2 = await resume(f, r1.id);
  check("12: the approved run executes and completes", e2.runStatus === "COMPLETED" && e2.dispatched);
  check("13: EXACTLY ONE consequential execution and ONE draft", (await execs(db, f.orgId)) === 1 && (await touches(db, f.orgId)) === 1);
  check("14: it is still the same run, same pinned revision",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_runs where org_id=$1 and plan_revision_id=$2`, [f.orgId, f.revId])).rows[0].n === "1");

  // ── 3. append-only lifecycle ────────────────────────────────────────────────────────────────────
  console.log("\n=== append-only lifecycle ===");
  const rows = (await db.query<{ decision: string; request_id: string | null; id: string }>(
    `select decision, request_id::text, id::text from pursuit_run_approvals where org_id=$1 order by created_at`, [f.orgId])).rows;
  check("15: the lifecycle is REQUESTED then one terminal row", rows.length === 2 && rows[0].decision === "REQUESTED" && rows[1].decision === "APPROVED");
  check("16: the terminal row NAMES its request", rows[1].request_id === rows[0].id);
  check("17: the REQUESTED row is unchanged after the decision — it carries no decider",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_run_approvals where id=$1 and decided_by_actor_id is null and request_id is null`, [rows[0].id])).rows[0].n === "1");
  const led = (await db.query<{ change_type: string; run_id: string | null; governed_actor_id: string | null }>(
    `select change_type, run_id::text, governed_actor_id::text from change_ledger where org_id=$1 and change_type like 'APPROVAL%' order by occurred_at`, [f.orgId])).rows;
  check("18: the ledger records APPROVAL_REQUESTED then APPROVAL_GRANTED, linked to the run",
    led.length === 2 && led[0].change_type === "APPROVAL_REQUESTED" && led[1].change_type === "APPROVAL_GRANTED" && led.every((l) => l.run_id === r1.id));

  // app_rw must not be able to rewrite approval history.
  const rwc = await rw.connect();
  try {
    await rwc.query("begin");
    await rwc.query(`select set_config('app.org_id',$1,true)`, [f.orgId]);
    const deny = async (sql: string) => { await rwc.query("savepoint s");
      try { await rwc.query(sql, [rows[0].id]); await rwc.query("release savepoint s"); return ""; }
      catch (e) { await rwc.query("rollback to savepoint s"); return (e as Error).message; } };
    check("19: app_rw CANNOT update an approval row", /permission denied/i.test(await deny(`update pursuit_run_approvals set reason='x' where id=$1`)));
    check("20: app_rw CANNOT delete an approval row", /permission denied/i.test(await deny(`delete from pursuit_run_approvals where id=$1`)));
    await rwc.query("rollback");
  } finally { rwc.release(); }

  // ── 4. replay of a decision ─────────────────────────────────────────────────────────────────────
  console.log("\n=== decision replay ===");
  const again = await decide(f, req.requestId, "APPROVED", f.approver, f.appPrincipal);
  check("21: replaying APPROVE cannot duplicate execution", again.status === "ALREADY_DECIDED" && (await execs(db, f.orgId)) === 1 && (await touches(db, f.orgId)) === 1);
  const flip = await decide(f, req.requestId, "REJECTED", f.approver2, f.app2Principal);
  check("22: a late REJECT cannot overturn a committed APPROVE", flip.status === "ALREADY_DECIDED" && (await runOf(db, f.orgId === "" ? "" : r1.id)).status === "COMPLETED");

  // ── 5. rejection ────────────────────────────────────────────────────────────────────────────────
  console.log("\n=== rejection ===");
  const fr = await plant(db, "reject");
  const rr = await start(fr); await resume(fr, rr.id);
  const rreq = await openRequest(db, fr);
  const dr = await decide(fr, rreq.requestId, "REJECTED", fr.approver, fr.appPrincipal);
  check("23: an authorized approver can REJECT", dr.status === "DECIDED" && dr.decision === "REJECTED");
  const rrun = await runOf(db, rr.id);
  check("24: REJECT terminates the run durably as CANCELLED / APPROVAL_REJECTED",
    rrun.status === "CANCELLED" && rrun.reason === "APPROVAL_REJECTED", `${rrun.status}/${rrun.reason}`);
  check("25: rejection prevents execution permanently", (await resume(fr, rr.id)).dispatched === false && (await execs(db, fr.orgId)) === 0 && (await touches(db, fr.orgId)) === 0);
  const rr2 = await decide(fr, rreq.requestId, "REJECTED", fr.approver2, fr.app2Principal);
  check("26: replaying REJECT does not mutate state", rr2.status === "ALREADY_DECIDED" && (await runOf(db, rr.id)).status === "CANCELLED");
  check("27: invocation REJECTED semantics are NOT overloaded — the human decision lives in its own record",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_run_approvals where org_id=$1 and decision='REJECTED' and decided_by_actor_id is not null`, [fr.orgId])).rows[0].n === "1");

  // ── 6. authorization refusals ───────────────────────────────────────────────────────────────────
  console.log("\n=== authorization ===");
  const fa = await plant(db, "authz");
  const ra = await start(fa); await resume(fa, ra.id);
  const areq = await openRequest(db, fa);
  const wrongP = await decide(fa, areq.requestId, "APPROVED", fa.approver, randomUUID());
  check("28: a wrong principal cannot decide", wrongP.status === "REFUSED" && /principal does not match/i.test(wrongP.reason ?? ""), wrongP.reason ?? "");
  const viewer = await decide(fa, areq.requestId, "APPROVED", fa.viewerActor, (await db.query<{ p: string }>(`select principal_user_id::text p from governed_actors where id=$1`, [fa.viewerActor])).rows[0].p, "viewer");
  check("29: an ordinary viewer cannot approve even holding the decision grant", viewer.status === "REFUSED" && /insufficient permission/i.test(viewer.reason ?? ""), viewer.reason ?? "");
  const selfApprove = await decide(fa, areq.requestId, "APPROVED", fa.requester, fa.reqPrincipal);
  check("30: the requester cannot self-approve", selfApprove.status === "REFUSED" && /cannot decide its own request/i.test(selfApprove.reason ?? ""), selfApprove.reason ?? "");
  const other = await plant(db, "othertenant");
  const foreign = await withTenantOrg(other.orgId, (d) => decideApproval(d, other.orgId, areq.requestId, "APPROVED",
    { governedActorId: other.approver, principal: other.appPrincipal, actor: actorOf(other.appPrincipal, other.orgId) }));
  check("31: another tenant cannot see or decide this request", foreign.status === "ALREADY_DECIDED", foreign.reason ?? "");
  check("32: none of those refusals executed anything", (await execs(db, fa.orgId)) === 0 && (await touches(db, fa.orgId)) === 0);
  check("33: and the request is still genuinely pending", (await openRequest(db, fa))?.requestId === areq.requestId);

  // ── 7. stale authority ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== stale authority: approval is not a frozen entitlement ===");
  const fg = await plant(db, "revoked");
  const rg = await start(fg); await resume(fg, rg.id);
  const greq = await openRequest(db, fg);
  await db.query(`update actor_capability_grants set status='REVOKED', revoked_at=now() where org_id=$1 and actor_id=$2 and skill_id=$3`, [fg.orgId, fg.requester, SKILL]);
  const gd = await decide(fg, greq.requestId, "APPROVED", fg.approver, fg.appPrincipal);
  check("34: a grant revoked while waiting → INVALIDATED, not approved", gd.status === "INVALIDATED" && gd.reason === "CAPABILITY_REVOKED", `${gd.status}/${gd.reason}`);
  check("35: and the run is CANCELLED with no execution", (await runOf(db, rg.id)).status === "CANCELLED" && (await execs(db, fg.orgId)) === 0);

  const fs2 = await plant(db, "suspended");
  const rs = await start(fs2); await resume(fs2, rs.id);
  const sreq = await openRequest(db, fs2);
  await db.query(`update governed_actors set lifecycle='SUSPENDED' where id=$1`, [fs2.requester]);
  const sd = await decide(fs2, sreq.requestId, "APPROVED", fs2.approver, fs2.appPrincipal);
  check("36: an actor suspended while waiting → INVALIDATED", sd.status === "INVALIDATED" && sd.reason === "ACTOR_SUSPENDED", `${sd.status}/${sd.reason}`);
  check("37: and nothing executed", (await execs(db, fs2.orgId)) === 0 && (await touches(db, fs2.orgId)) === 0);

  const fp = await plant(db, "superseded");
  const rp = await start(fp); await resume(fp, rp.id);
  const preq = await openRequest(db, fp);
  const nrec = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,3,'RECOMMENDATION','{}','{}','bf2','SYSTEM') returning id`, [fp.orgId, fp.pursuitId, fp.planId])).rows[0].id;
  await db.query(`insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id, content, basis, basis_fingerprint, actor_type)
                  values ($1,$2,$3,4,'DECISION','APPROVED',$4,'{}','{}','bf2','USER')`, [fp.orgId, fp.pursuitId, fp.planId, nrec]);
  const pd = await decide(fp, preq.requestId, "APPROVED", fp.approver, fp.appPrincipal);
  check("38: a superseded revision while waiting → INVALIDATED / PLAN_SUPERSEDED", pd.status === "INVALIDATED" && pd.reason === "PLAN_SUPERSEDED", `${pd.status}/${pd.reason}`);
  check("39: the run is CANCELLED, still pinned to the ORIGINAL revision, never retargeted",
    (await runOf(db, rp.id)).status === "CANCELLED" &&
    (await db.query<{ p: string }>(`select plan_revision_id::text p from pursuit_runs where id=$1`, [rp.id])).rows[0].p === fp.revId);
  check("40: INVALIDATED requests are NOT offered as pending", (await pendingApprovals(db, fp.orgId)).length === 0);
  check("41: INVALIDATED carries a system reason and no deciding actor",
    (await db.query<{ n: string }>(`select count(*)::text n from pursuit_run_approvals where org_id=$1 and decision='INVALIDATED' and decided_by_actor_id is null and reason is not null`, [fp.orgId])).rows[0].n === "1");

  // ── 8. the race ─────────────────────────────────────────────────────────────────────────────────
  console.log("\n=== concurrent decisions: exactly one winner ===");
  for (const [tag, a, b] of [["approve-vs-approve", "APPROVED", "APPROVED"], ["approve-vs-reject", "APPROVED", "REJECTED"], ["reject-vs-reject", "REJECTED", "REJECTED"]] as const) {
    const fx = await plant(db, tag);
    const rx = await start(fx); await resume(fx, rx.id);
    const q = await openRequest(db, fx);
    const [x, y] = await Promise.all([
      decide(fx, q.requestId, a as "APPROVED" | "REJECTED", fx.approver, fx.appPrincipal).catch((e) => ({ status: "ERROR", decision: null, requestId: q.requestId, reason: (e as Error).message })),
      decide(fx, q.requestId, b as "APPROVED" | "REJECTED", fx.approver2, fx.app2Principal).catch((e) => ({ status: "ERROR", decision: null, requestId: q.requestId, reason: (e as Error).message })),
    ]);
    const winners = [x, y].filter((r) => r.status === "DECIDED").length;
    const losers = [x, y].filter((r) => r.status === "ALREADY_DECIDED").length;
    const terminal = Number((await db.query<{ n: string }>(
      `select count(*)::text n from pursuit_run_approvals where org_id=$1 and decision <> 'REQUESTED'`, [fx.orgId])).rows[0].n);
    check(`42-${tag}: exactly ONE terminal decision, ONE winner, loser told 'already decided'`,
      winners === 1 && losers === 1 && terminal === 1,
      `winner=${winners} loser=${losers} terminal=${terminal} · ${x.status}(${x.reason ?? "-"})/${y.status}(${y.reason ?? "-"})`);
    const anyApprove = ([a, b] as string[]).includes("APPROVED");
    if (anyApprove) {
      await resume(fx, rx.id);
      const n = await execs(db, fx.orgId);
      check(`43-${tag}: at most ONE consequential execution`, n <= 1 && (await touches(db, fx.orgId)) <= 1, `executions=${n}`);
    } else {
      check(`43-${tag}: a doubly-rejected run executes nothing`, (await execs(db, fx.orgId)) === 0);
    }
    check(`44-${tag}: the run is in exactly one terminal-consistent state`,
      ["COMPLETED", "CANCELLED"].includes((await runOf(db, rx.id)).status), (await runOf(db, rx.id)).status);
  }

  // ── 9. feature gate + recursion + send ──────────────────────────────────────────────────────────
  console.log("\n=== gates, recursion, send ===");
  const fo = await plant(db, "gateoff");
  const ro = await start(fo); await resume(fo, ro.id);
  const oreq = await openRequest(db, fo);
  await db.query(`update org_features set governed_action=false where org_id=$1`, [fo.orgId]);
  const { runtimeEnabled } = await import("../src/lib/runtime/entry");
  check("45: with the per-org gate OFF the runtime is disabled for this org",
    (await withTenantOrg(fo.orgId, (d) => runtimeEnabled(d, fo.orgId))) === false);
  delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
  check("46: with the global flag OFF the runtime is disabled regardless",
    (await withTenantOrg(f.orgId, (d) => runtimeEnabled(d, f.orgId))) === false);
  process.env.VNEXT_CONTROL_PLANE_ENABLED = "true";
  await db.query(`update org_features set governed_action=true where org_id=$1`, [fo.orgId]);
  check("47: the pending request survived the gate flap untouched and is still pending",
    (await openRequest(db, fo))?.requestId === oreq.requestId);

  const decideRows = Number((await db.query<{ n: string }>(
    `select count(*)::text n from pursuit_run_approvals a join pursuit_run_steps s on s.id=a.run_step_id where s.skill_id=$1`, [DECIDE_SKILL])).rows[0].n);
  check("48: decide_governed_action never itself enters an approval workflow", decideRows === 0, `${decideRows} approval rows for the decision capability`);
  // Coordination skills are deliberately NOT mirrored into governed_skills (they are dispatchable but
  // not listed as Federation actions), so there is no policy row — and therefore no row an operator
  // could edit into requiring an approval-of-an-approval. The base case is structural, not data.
  check("49: the decision capability has NO governed_skills policy row to be edited into requiring approval",
    (await db.query<{ n: string }>(`select count(*)::text n from governed_skills where skill_id=$1`, [DECIDE_SKILL])).rows[0].n === "0");

  const sendAfter = (await db.query(
    `select (select count(*) from messages)::int m, (select count(*) from action_outbox)::int o,
            (select count(*) from email_events)::int e, (select count(*) from sending_identities)::int s,
            (select count(*) from campaign_touches where status='sent')::int t`)).rows[0];
  check("50: send surfaces are 0/0/0/0/0 and unchanged throughout",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter) && Object.values(sendAfter as Record<string, number>).every((v) => Number(v) === 0),
    JSON.stringify(sendAfter));

  db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end(); await rw.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[p45-approvals-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
