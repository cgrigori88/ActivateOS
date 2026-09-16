import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { startRun, resumeRun, pauseRun, resumeAfterPause, stepIdempotencyKey } from "../src/lib/runtime/runtime";
import { withTenantOrg } from "../src/lib/db/tenant";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { runtimeEnabled } from "../src/lib/runtime/entry";

/**
 * P45-1 — the governed Pursuit Runtime, Slice 1.
 *
 * WHAT THIS PROVES. That one approved plan action can execute through P4 identity + P5 run state
 * without weakening anything H1 certified: the grant gate rejects rather than permits, a run is
 * permanently pinned to the revision that justified it, replay cannot produce a second consequential
 * mutation, human pause genuinely stops execution, recovery comes from the database alone, and no
 * send surface is touched.
 *
 * WHY A DISPOSABLE ORG. The canonical world has ONE plan, a single RECOMMENDATION revision, zero
 * DECISIONs and zero campaigns — there is nothing here to execute against. So the suite plants its
 * own org, pursuit, goal, plan, DECISION revision and campaign. It COMMITS them, so it runs only on
 * a disposable seeded clone and never touches the canonical world.
 *
 *   npx tsx scripts/verify-run.ts --suite p45-runtime
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 4 });
const rw = new Pool({ connectionString: rwUrl, max: 2 });

/**
 * EXECUTION IDENTITY — a permanent acceptance requirement, not a detail.
 *
 * This suite once executed the runtime on the OWNER connection and used app_rw only to assert RLS
 * visibility. That is structurally unable to detect a privilege defect, and it missed one: the
 * runtime appended a ledger row and then UPDATEd it, which the owner may do and `app_rw` may not
 * (change_ledger is INSERT/SELECT only). No run could complete under the real runtime identity, and
 * only the hosted gate caught it (defect P45-D1).
 *
 * So the product pool is pointed at the REAL app_rw login before the first getPool() call, and every
 * runtime invocation below goes through the product's own `withTenantOrg` — the same tenant binding
 * a request uses. Owner authority remains for fixture setup and for assertions that must see across
 * orgs. getPool() is lazy, so assigning here (after imports, before any runtime call) is sufficient.
 */
process.env.DATABASE_URL = rwUrl;

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const SKILL = "draft_campaign_touch";

/**
 * Every runtime entry point runs through the product's own `withTenantOrg`: one app_rw connection,
 * one transaction, `app.org_id` set — exactly the shape a request produces, and the shape
 * `dispatchSkill` needs for its SAVEPOINT-isolated handlers. The `db` argument these helpers ignore
 * is the owner client used elsewhere in the suite; it is deliberately NOT the execution identity.
 */
const txStart = (_db: PoolClient, orgId: string, a: Parameters<typeof startRun>[2]) =>
  withTenantOrg(orgId, (rwDb) => startRun(rwDb, orgId, a));
const txResume = (_db: PoolClient, orgId: string, runId: string, actor: Actor) =>
  withTenantOrg(orgId, (rwDb) => resumeRun(rwDb, orgId, runId, actor));
const txPause = (_db: PoolClient, orgId: string, runId: string, reason: string, uid: string) =>
  withTenantOrg(orgId, (rwDb) => pauseRun(rwDb, orgId, runId, reason, uid));
const txUnpause = (_db: PoolClient, orgId: string, runId: string, reason: string, uid: string) =>
  withTenantOrg(orgId, (rwDb) => resumeAfterPause(rwDb, orgId, runId, reason, uid));
/** Fixture setup stays on the OWNER: there is no product path for planting an org, and RLS would
 *  refuse an app_rw insert for an org that does not yet exist in its context. */
async function txPlant(db: PoolClient, label: string): Promise<Fixture> {
  await db.query("begin");
  try { const r = await plantOrg(db, label); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback"); throw e; }
}

interface Fixture { orgId: string; pursuitId: string; planId: string; revisionId: string; actorId: string; campaignName: string; principal: string }

/** A complete, disposable P3 → P4 chain: org → pursuit → goal → plan → DECISION → actor → grant. */
async function plantOrg(db: PoolClient, label: string): Promise<Fixture> {
  const principal = randomUUID();
  const orgId = (await db.query<{ id: string }>(
    `insert into organizations (name) values ($1) returning id`, [`P45 ${label} ${randomUUID().slice(0, 8)}`])).rows[0].id;
  // `companies` is a SHARED account table with no org_id — org scoping happens through the rows that
  // reference it (opportunities, populations, pursuits), not on the company itself.
  const companyId = (await db.query<{ id: string }>(
    `insert into companies (legal_name, normalized_name) values ($1,$2) returning id`,
    [`P45 Co ${label} ${randomUUID().slice(0, 8)}`, `p45-co-${label}-${randomUUID().slice(0, 8)}`])).rows[0].id;
  const pursuitId = (await db.query<{ id: string }>(
    `insert into pursuits (org_id, account_id, dedup_key) values ($1,$2,$3) returning id`,
    [orgId, companyId, `p45-${randomUUID()}`])).rows[0].id;
  const goalId = (await db.query<{ id: string }>(
    `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type)
     values ($1,$2,'Land the renewal','ACTIVE','HUMAN_AUTHORED','USER') returning id`, [orgId, pursuitId])).rows[0].id;
  const planId = (await db.query<{ id: string }>(
    `insert into pursuit_plans (org_id, pursuit_id, goal_id, status) values ($1,$2,$3,'ACTIVE') returning id`,
    [orgId, pursuitId, goalId])).rows[0].id;
  // A RECOMMENDATION then the DECISION that responds to it — the shape the plan model requires.
  const recId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,1,'RECOMMENDATION','{"nextAction":{"text":"Draft the touch"}}','{}','basis-${label}','SYSTEM') returning id`,
    [orgId, pursuitId, planId])).rows[0].id;
  const revisionId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id,
       content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,2,'DECISION','APPROVED',$4,'{"nextAction":{"text":"Draft the touch"}}','{}','basis-${label}','USER') returning id`,
    [orgId, pursuitId, planId, recId])).rows[0].id;
  const campaignName = `P45 Campaign ${label}`;
  await db.query(`insert into campaigns (org_id, company_id, name, status, source) values ($1,$2,$3,'draft','user')`,
    [orgId, companyId, campaignName]);
  await db.query(`insert into org_features (org_id, governed_action) values ($1, true)
                  on conflict (org_id) do update set governed_action = true`, [orgId]);
  const actorId = (await db.query<{ id: string }>(
    `insert into governed_actors (org_id, actor_type, key, display_name, purpose, principal_user_id, lifecycle)
     values ($1,'USER',$2,'P45 operator','Slice-1 runtime proof',$3,'ACTIVE') returning id`,
    [orgId, `p45-user-${label}`, principal])).rows[0].id;
  await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id, status) values ($1,$2,$3,'ACTIVE')`,
    [orgId, actorId, SKILL]);
  return { orgId, pursuitId, planId, revisionId, actorId, campaignName, principal };
}

const actorFor = (f: Fixture): Actor => ({ type: "USER", id: f.principal, orgId: f.orgId, role: "operator" });
const touchCount = async (db: PoolClient, orgId: string): Promise<number> => Number((await db.query<{ n: string }>(
  `select count(*)::text n from campaign_touches t join campaigns c on c.id = t.campaign_id where c.org_id = $1`, [orgId])).rows[0].n);
const runStatus = async (db: PoolClient, id: string): Promise<{ status: string; reason: string | null }> =>
  (await db.query<{ status: string; reason: string | null }>(`select status, reason from pursuit_runs where id = $1`, [id])).rows[0];
const stepOf = async (db: PoolClient, runId: string) =>
  (await db.query<{ id: string; status: string; attempt: number; idempotency_key: string; invocation_id: string | null; failure_class: string | null }>(
    `select id, status, attempt, idempotency_key, invocation_id, failure_class from pursuit_run_steps where run_id = $1 order by seq limit 1`, [runId])).rows[0];

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[p45-runtime-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();

  const sendBefore = (await db.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];

  // ── 1. Registry semantics were NOT bent to suit the demo ────────────────────────────────────────
  const reg = (await db.query<{ effect_class: string; eligible_actors: string[]; idempotent: boolean; approval_required: boolean; status: string }>(
    `select effect_class, eligible_actors, idempotent, approval_required, status from governed_skills where skill_id = $1 and version = 1`, [SKILL])).rows[0];
  check("1: draft_campaign_touch is INTERNAL_WRITE, idempotent, USER-eligible, active — unchanged",
    reg.effect_class === "INTERNAL_WRITE" && reg.idempotent === true && reg.eligible_actors.includes("USER") && reg.status === "active",
    `${reg.effect_class} · idempotent=${reg.idempotent} · actors=${reg.eligible_actors.join("/")} · approval_required=${reg.approval_required}`);
  check("1b: it is NOT an EXTERNAL_ACTION, so dispatch can never route it to the outbox",
    reg.effect_class !== "EXTERNAL_ACTION");

  // ── 2. Happy path, end to end ───────────────────────────────────────────────────────────────────
  const f = await txPlant(db, "happy");
  const before = await touchCount(db, f.orgId);
  const run = await txStart(db, f.orgId, {
    pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revisionId,
    governedActorId: f.actorId, initiatedByUserId: f.principal,
    skillId: SKILL, args: { campaign: f.campaignName, name: "P45 draft", subject: "Hello", body: "Body" },
    milestoneKey: "touch_drafted",
  });
  check("2: run starts READY, pinned to the decided revision, with basis_fingerprint captured",
    run.status === "READY" && run.planRevisionId === f.revisionId && run.basisFingerprint === "basis-happy",
    `${run.status} · basis=${run.basisFingerprint}`);
  const exec = await txResume(db, f.orgId, run.id, actorFor(f));
  check("3: the step dispatched and the run COMPLETED", exec.runStatus === "COMPLETED" && exec.stepStatus === "COMPLETED" && exec.dispatched,
    `run=${exec.runStatus} step=${exec.stepStatus} reason=${exec.reason ?? "—"}`);
  check("4: a governed_action_invocation was created and EXECUTED", !!exec.invocationId &&
    (await db.query<{ status: string; governed_actor_id: string | null; run_step_id: string | null }>(
      `select status, governed_actor_id, run_step_id from governed_action_invocations where id = $1`, [exec.invocationId])).rows[0]?.status === "EXECUTED");
  const inv = (await db.query<{ governed_actor_id: string | null; run_step_id: string | null }>(
    `select governed_actor_id, run_step_id from governed_action_invocations where id = $1`, [exec.invocationId])).rows[0];
  check("5: the invocation traces back to the governed actor AND the run step",
    inv.governed_actor_id === f.actorId && inv.run_step_id === (await stepOf(db, run.id)).id);
  check("6: exactly ONE draft campaign touch was created", (await touchCount(db, f.orgId)) === before + 1,
    `${before} → ${await touchCount(db, f.orgId)}`);
  const drafted = (await db.query<{ status: string }>(
    `select t.status from campaign_touches t join campaigns c on c.id = t.campaign_id where c.org_id = $1`, [f.orgId])).rows[0];
  check("7: the touch is a DRAFT — nothing was sent", drafted.status !== "sent", `status=${drafted.status}`);

  // ── 3. Ledger trail ─────────────────────────────────────────────────────────────────────────────
  const led = (await db.query<{ change_type: string; run_id: string | null; run_step_id: string | null; governed_actor_id: string | null; trigger_type: string | null }>(
    `select change_type, run_id, run_step_id, governed_actor_id, trigger_type from change_ledger
      where org_id = $1 and run_id = $2 order by occurred_at, id`, [f.orgId, run.id])).rows;
  check("8: the run wrote RUN_STARTED then RUN_COMPLETED into change_ledger — no parallel log",
    led.length === 2 && led[0].change_type === "RUN_STARTED" && led[1].change_type === "RUN_COMPLETED",
    led.map((r) => r.change_type).join(" → "));
  check("9: every ledger row carries run, step, governed actor and the GOVERNED_ACTION trigger",
    led.every((r) => r.run_id === run.id && r.governed_actor_id === f.actorId && r.trigger_type === "GOVERNED_ACTION" && r.run_step_id !== null));

  // ── 4. Replay must not produce a second consequential mutation ──────────────────────────────────
  const after1 = await touchCount(db, f.orgId);
  // P45-3: run identity now hashes the WHOLE canonical program — position, skill, version, args AND
  // milestone key. This replay must therefore present the IDENTICAL program, milestoneKey included.
  // It previously omitted it and still replayed, because the old key hashed only skill + args; under
  // the stronger rule that omission is a materially different program, which is the point of the
  // rule. (Presented while the first run is still live it is a ProgramConflictError; presented after
  // it COMPLETED, as here, it would simply be a new program — either way, not a replay.)
  const replayRun = await txStart(db, f.orgId, {
    pursuitId: f.pursuitId, planId: f.planId, planRevisionId: f.revisionId,
    governedActorId: f.actorId, initiatedByUserId: f.principal,
    skillId: SKILL, args: { campaign: f.campaignName, name: "P45 draft", subject: "Hello", body: "Body" },
    milestoneKey: "touch_drafted",
  });
  check("10: replaying the same decision returns the SAME run (run-level idempotency)", replayRun.id === run.id, `${replayRun.id === run.id}`);
  const replayExec = await txResume(db, f.orgId, run.id, actorFor(f));
  check("11: a completed run does not re-dispatch", !replayExec.dispatched && replayExec.runStatus === "COMPLETED");
  check("12: REPLAY created NO duplicate draft", (await touchCount(db, f.orgId)) === after1, `${after1} → ${await touchCount(db, f.orgId)}`);

  // ── 5. NO GRANT ─────────────────────────────────────────────────────────────────────────────────
  const g = await txPlant(db, "nogrant");
  await db.query(`update actor_capability_grants set status = 'REVOKED', revoked_at = now() where org_id = $1`, [g.orgId]);
  const gBefore = await touchCount(db, g.orgId);
  const gRun = await txStart(db, g.orgId, { pursuitId: g.pursuitId, planId: g.planId, planRevisionId: g.revisionId,
    governedActorId: g.actorId, initiatedByUserId: g.principal, skillId: SKILL, args: { campaign: g.campaignName, subject: "x", body: "y" } });
  const gExec = await txResume(db, g.orgId, gRun.id, actorFor(g));
  check("13: with NO active grant the invocation is REJECTED and the run is BLOCKED",
    gExec.runStatus === "BLOCKED" && /no active capability grant/i.test(gExec.reason ?? ""), `${gExec.runStatus}: ${gExec.reason}`);
  check("14: and NO draft was created", (await touchCount(db, g.orgId)) === gBefore);

  // ── 6. SUSPENDED ACTOR ──────────────────────────────────────────────────────────────────────────
  const s = await txPlant(db, "suspended");
  await db.query(`update governed_actors set lifecycle = 'SUSPENDED' where id = $1`, [s.actorId]);
  const sBefore = await touchCount(db, s.orgId);
  const sRun = await txStart(db, s.orgId, { pursuitId: s.pursuitId, planId: s.planId, planRevisionId: s.revisionId,
    governedActorId: s.actorId, initiatedByUserId: s.principal, skillId: SKILL, args: { campaign: s.campaignName, subject: "x", body: "y" } });
  const sExec = await txResume(db, s.orgId, sRun.id, actorFor(s));
  check("15: a SUSPENDED governed actor cannot execute", sExec.runStatus === "BLOCKED" && /SUSPENDED/i.test(sExec.reason ?? ""), `${sExec.runStatus}: ${sExec.reason}`);
  check("16: and NO draft was created", (await touchCount(db, s.orgId)) === sBefore);

  // A grant cannot rescue an actor the registry refuses: viewer < operator.
  const vExec = await withTenantOrg(f.orgId, (rwDb) => dispatchSkill(rwDb, SKILL,
    { type: "USER", id: f.principal, orgId: f.orgId, role: "viewer" },
    { governedActorId: f.actorId, args: { campaign: f.campaignName }, idempotencyKey: `viewer-${randomUUID()}` }));
  check("17: a grant does NOT override required_permission — viewer is still refused",
    vExec.status === "REJECTED" && /insufficient permission/i.test(vExec.reason ?? ""), `${vExec.status}: ${vExec.reason}`);

  // A USER actor that identifies nobody cannot be ACTIVE. Enforced in the DATABASE, because an
  // identity registry whose identity is optional is not an identity registry.
  let noPrincipal = "";
  await db.query("begin");
  try { await db.query(`savepoint np`);
        await db.query(`insert into governed_actors (org_id, actor_type, key, display_name, lifecycle)
                        values ($1,'USER','no-principal','No principal','ACTIVE')`, [f.orgId]);
        await db.query(`rollback to savepoint np`);
  } catch (e) { noPrincipal = (e as Error).message; await db.query(`rollback to savepoint np`); }
  await db.query("rollback");
  check("17b: a USER governed actor cannot be ACTIVE without a principal (DB constraint)",
    /governed_actors_user_principal/.test(noPrincipal), noPrincipal.slice(0, 110) || "NOT REFUSED");

  // ── 7. CROSS-ORG references are refused RELATIONALLY ────────────────────────────────────────────
  const b = await txPlant(db, "orgb");
  let grantXfail = "", runXfail = "";
  await db.query("begin");
  try { await db.query(`savepoint x1`);
        await db.query(`insert into actor_capability_grants (org_id, actor_id, skill_id) values ($1,$2,$3)`, [f.orgId, b.actorId, SKILL]);
        await db.query(`rollback to savepoint x1`);
  } catch (e) { grantXfail = (e as Error).message.slice(0, 70); await db.query(`rollback to savepoint x1`); }
  check("18: org A cannot grant a capability to org B's actor (composite FK)", grantXfail !== "", grantXfail || "NOT REFUSED");
  try { await db.query(`savepoint x2`);
        await db.query(`insert into pursuit_runs (org_id, pursuit_id, plan_id, plan_revision_id, governed_actor_id, idempotency_key, basis_fingerprint)
                        values ($1,$2,$3,$4,$5,$6,'x')`, [f.orgId, f.pursuitId, f.planId, f.revisionId, b.actorId, randomUUID()]);
        await db.query(`rollback to savepoint x2`);
  } catch (e) { runXfail = (e as Error).message.slice(0, 70); await db.query(`rollback to savepoint x2`); }
  check("19: org A cannot start a run on org B's actor (composite FK)", runXfail !== "", runXfail || "NOT REFUSED");
  await db.query("rollback");

  // ── 8. PAUSE / RESUME ───────────────────────────────────────────────────────────────────────────
  const p = await txPlant(db, "pause");
  const pBefore = await touchCount(db, p.orgId);
  const pRun = await txStart(db, p.orgId, { pursuitId: p.pursuitId, planId: p.planId, planRevisionId: p.revisionId,
    governedActorId: p.actorId, initiatedByUserId: p.principal, skillId: SKILL, args: { campaign: p.campaignName, subject: "x", body: "y" } });
  await txPause(db, p.orgId, pRun.id, "held by a person", p.principal);
  const pausedExec = await txResume(db, p.orgId, pRun.id, actorFor(p));
  check("20: a PAUSED run does not execute", !pausedExec.dispatched && pausedExec.runStatus === "PAUSED");
  check("21: and NO draft was created while paused", (await touchCount(db, p.orgId)) === pBefore);
  await txUnpause(db, p.orgId, pRun.id, "released", p.principal);
  const resumedExec = await txResume(db, p.orgId, pRun.id, actorFor(p));
  check("22: RESUME continues from durable state and completes", resumedExec.runStatus === "COMPLETED" && resumedExec.dispatched);
  check("23: pause and resume are first-class ledger transitions",
    (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where run_id = $1 and change_type in ('RUN_PAUSED','RUN_RESUMED')`, [pRun.id])).rows[0].n === "2");

  // ── 9. RETRY: bounded, same identity, no duplicate effect ───────────────────────────────────────
  // INJECTION: the step is put into exactly the durable state a transient dispatch failure leaves
  // behind. That is the state the runtime must recover from, so driving it directly tests the
  // runtime's own retry machinery rather than a provider's failure modes.
  const r = await txPlant(db, "retry");
  const rRun = await txStart(db, r.orgId, { pursuitId: r.pursuitId, planId: r.planId, planRevisionId: r.revisionId,
    governedActorId: r.actorId, initiatedByUserId: r.principal, skillId: SKILL, args: { campaign: r.campaignName, subject: "x", body: "y" } });
  const rStep = await stepOf(db, rRun.id);
  const keyBefore = rStep.idempotency_key;
  await db.query(`update pursuit_run_steps set status='RETRYABLE_FAILURE', attempt=1, failure_class='TRANSIENT',
                  next_attempt_at = now() + interval '1 hour' where id = $1`, [rStep.id]);
  await db.query(`update pursuit_runs set status='RETRYABLE_FAILURE' where id = $1`, [rRun.id]);
  const backoff = await txResume(db, r.orgId, rRun.id, actorFor(r));
  check("24: backoff is honoured — no dispatch before next_attempt_at", !backoff.dispatched && backoff.reason === "backoff not elapsed");
  await db.query(`update pursuit_run_steps set next_attempt_at = now() - interval '1 minute' where id = $1`, [rStep.id]);
  const rBefore = await touchCount(db, r.orgId);
  const retried = await txResume(db, r.orgId, rRun.id, actorFor(r));
  const rStepAfter = await stepOf(db, rRun.id);
  check("25: the retry dispatches and completes", retried.dispatched && retried.runStatus === "COMPLETED");
  check("26: the retry reused the SAME step idempotency identity", rStepAfter.idempotency_key === keyBefore,
    `${keyBefore === rStepAfter.idempotency_key}`);
  check("27: attempt advanced to 2 (bounded, not unbounded)", rStepAfter.attempt === 2, `attempt=${rStepAfter.attempt}`);
  check("28: the retry created exactly ONE draft in total, not one per attempt", (await touchCount(db, r.orgId)) === rBefore + 1,
    `${rBefore} → ${await touchCount(db, r.orgId)}`);
  check("29: the step key is deterministic from (run, seq, skill, version, args)",
    keyBefore === stepIdempotencyKey(rRun.id, 1, SKILL, 1, { campaign: r.campaignName, subject: "x", body: "y" }));

  // Budget exhaustion is terminal, not an infinite loop.
  const e2 = await txPlant(db, "exhaust");
  const eRun = await txStart(db, e2.orgId, { pursuitId: e2.pursuitId, planId: e2.planId, planRevisionId: e2.revisionId,
    governedActorId: e2.actorId, initiatedByUserId: e2.principal, skillId: SKILL, args: { campaign: e2.campaignName, subject: "x", body: "y" }, maxAttempts: 2 });
  await db.query(`update pursuit_run_steps set status='RETRYABLE_FAILURE', attempt=2 where run_id = $1`, [eRun.id]);
  await db.query(`update pursuit_runs set status='RETRYABLE_FAILURE' where id = $1`, [eRun.id]);
  const exhausted = await txResume(db, e2.orgId, eRun.id, actorFor(e2));
  check("30: an exhausted retry budget is TERMINAL_FAILURE and does not dispatch",
    exhausted.runStatus === "TERMINAL_FAILURE" && !exhausted.dispatched, `${exhausted.runStatus}`);

  // ── 10. PROCESS INTERRUPTION — recovery from the database alone ─────────────────────────────────
  const i = await txPlant(db, "crash");
  const iRun = await txStart(db, i.orgId, { pursuitId: i.pursuitId, planId: i.planId, planRevisionId: i.revisionId,
    governedActorId: i.actorId, initiatedByUserId: i.principal, skillId: SKILL, args: { campaign: i.campaignName, subject: "x", body: "y" } });
  const iStep = await stepOf(db, iRun.id);
  // Exactly what a crash between "persist RUNNING" and "persist outcome" leaves behind.
  await db.query(`update pursuit_run_steps set status='RUNNING', attempt=1, started_at=now(), invocation_id=null where id=$1`, [iStep.id]);
  await db.query(`update pursuit_runs set status='RUNNING', continuation = jsonb_build_object('seq',1,'attempt',1,'stepId',$2::text) where id=$1`, [iRun.id, iStep.id]);
  db.release();
  // A genuinely fresh connection: nothing in memory survives from the "crashed" process.
  const db2 = await owner.connect();
  const iBefore = await touchCount(db2, i.orgId);
  const recovered = await txResume(db2, i.orgId, iRun.id, actorFor(i));
  check("31: a run interrupted mid-dispatch recovers from durable DB state alone", recovered.dispatched && recovered.runStatus === "COMPLETED",
    `${recovered.runStatus}`);
  check("32: recovery created exactly ONE draft — the crash did not double-execute", (await touchCount(db2, i.orgId)) === iBefore + 1);

  // ── 11. PLAN SUPERSESSION ───────────────────────────────────────────────────────────────────────
  const sp = await txPlant(db2, "superseded");
  const spRun = await txStart(db2, sp.orgId, { pursuitId: sp.pursuitId, planId: sp.planId, planRevisionId: sp.revisionId,
    governedActorId: sp.actorId, initiatedByUserId: sp.principal, skillId: SKILL, args: { campaign: sp.campaignName, subject: "x", body: "y" } });
  const spBefore = await touchCount(db2, sp.orgId);
  // A newer DECISION supersedes the one this run was pinned to.
  await db2.query(
    `insert into pursuit_plan_revisions (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id,
       content, basis, basis_fingerprint, actor_type)
     values ($1,$2,$3,3,'DECISION','APPROVED',$4,'{}','{}','basis-superseded-2','USER')`,
    [sp.orgId, sp.pursuitId, sp.planId, sp.revisionId]);
  const spExec = await txResume(db2, sp.orgId, spRun.id, actorFor(sp));
  check("33: a run pinned to a superseded revision is CANCELLED, reason PLAN_SUPERSEDED",
    spExec.runStatus === "CANCELLED" && spExec.reason === "PLAN_SUPERSEDED", `${spExec.runStatus}: ${spExec.reason}`);
  check("34: it was NOT retargeted — the pin still names the ORIGINAL revision",
    (await db2.query<{ plan_revision_id: string }>(`select plan_revision_id from pursuit_runs where id=$1`, [spRun.id])).rows[0].plan_revision_id === sp.revisionId);
  check("35: and no action was taken on supersession", (await touchCount(db2, sp.orgId)) === spBefore);
  const spAfter = await runStatus(db2, spRun.id);
  const spRetry = await txResume(db2, sp.orgId, spRun.id, actorFor(sp));
  check("36: a CANCELLED run is terminal and never resumes", spAfter.status === "CANCELLED" && !spRetry.dispatched);

  // ── 12. Tenant isolation under the REAL app_rw login ────────────────────────────────────────────
  const rwc = await rw.connect();
  try {
    await rwc.query("begin read only");
    const noCtx = (await rwc.query<{ n: string }>(`select count(*)::text n from pursuit_runs`)).rows[0].n;
    check("37: with no tenant context app_rw sees ZERO runs", noCtx === "0", `${noCtx} rows`);
    await rwc.query("rollback");
    await rwc.query("begin read only");
    await rwc.query(`select set_config('app.org_id',$1,true)`, [f.orgId]);
    const own = (await rwc.query<{ n: string }>(`select count(*)::text n from pursuit_runs`)).rows[0].n;
    const foreign = (await rwc.query<{ n: string }>(`select count(*)::text n from pursuit_runs where org_id <> $1`, [f.orgId])).rows[0].n;
    check("38: under its own context app_rw sees only its own runs", own === "1" && foreign === "0", `own=${own} foreign=${foreign}`);
    const actors = (await rwc.query<{ n: string }>(`select count(*)::text n from governed_actors where org_id <> $1`, [f.orgId])).rows[0].n;
    check("39: and no foreign governed actors or grants are visible", actors === "0", `${actors} foreign actors`);
    await rwc.query("rollback");
  } finally { rwc.release(); }

  // ── 11b. APPEND-ONLY LEDGER under the REAL execution identity (defect P45-D1) ───────────────────
  // The two halves of this must both hold, and the first one is what the old owner-executed suite
  // could never test: app_rw must be able to RUN the runtime end to end, and must still be unable
  // to rewrite a ledger row it already wrote.
  const rwLedger = await rw.connect();
  try {
    await rwLedger.query("begin");
    await rwLedger.query(`select set_config('app.org_id',$1,true)`, [f.orgId]);
    const who = (await rwLedger.query<{ u: string; b: boolean }>(
      `select current_user u, (select rolbypassrls from pg_roles where rolname=current_user) b`)).rows[0];
    check("11b: the runtime above executed as app_rw with BYPASSRLS false — not the owner",
      who.u === "app_rw" && who.b === false, `${who.u} / bypassrls=${who.b}`);
    const ledRow = (await rwLedger.query<{ id: string }>(
      `select id from change_ledger where run_id = $1 order by occurred_at, id limit 1`, [run.id])).rows[0];
    check("11c: app_rw can SELECT the runtime ledger rows it wrote", !!ledRow);
    let denied = "";
    await rwLedger.query("savepoint ao");
    try { await rwLedger.query(`update change_ledger set reason = 'tampered' where id = $1`, [ledRow.id]);
          await rwLedger.query("release savepoint ao"); }
    catch (e) { denied = (e as Error).message; await rwLedger.query("rollback to savepoint ao"); }
    check("11d: app_rw CANNOT update a prior ledger row — append-only holds",
      /permission denied/i.test(denied), denied.split("\n")[0].slice(0, 80) || "NOT REFUSED");
    let delDenied = "";
    await rwLedger.query("savepoint ad");
    try { await rwLedger.query(`delete from change_ledger where id = $1`, [ledRow.id]);
          await rwLedger.query("release savepoint ad"); }
    catch (e) { delDenied = (e as Error).message; await rwLedger.query("rollback to savepoint ad"); }
    check("11e: app_rw CANNOT delete a ledger row either", /permission denied/i.test(delDenied),
      delDenied.split("\n")[0].slice(0, 80) || "NOT REFUSED");
    await rwLedger.query("rollback");
    // The linkage was written by the INSERT, so it is present without any UPDATE ever occurring.
    const linked = (await db.query<{ n: string }>(
      `select count(*)::text n from change_ledger where run_id = $1 and run_step_id is not null and governed_actor_id is not null`, [run.id])).rows[0].n;
    check("11f: runtime linkage is present on every row, written atomically in the INSERT", linked === "2", `${linked} linked rows`);
  } finally { rwLedger.release(); }

  // ── 12b. The FEATURE GATE itself — both flags, default OFF ──────────────────────────────────────
  // The runtime is inert unless BOTH the deployment flag and the per-org feature are on. This is
  // exercised rather than assumed: a gate nothing tests is a gate nobody has proved.
  const envWas = process.env.VNEXT_CONTROL_PLANE_ENABLED;
  delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
  check("40a: with VNEXT_CONTROL_PLANE_ENABLED unset the runtime is DISABLED (default off)",
    (await runtimeEnabled(db2, f.orgId)) === false);
  process.env.VNEXT_CONTROL_PLANE_ENABLED = "true";
  check("40b: with the deployment flag on AND org_features.governed_action on, it is enabled",
    (await runtimeEnabled(db2, f.orgId)) === true);
  await db2.query(`update org_features set governed_action = false where org_id = $1`, [f.orgId]);
  check("40c: turning the per-org feature off disables it again, even with the deployment flag on",
    (await runtimeEnabled(db2, f.orgId)) === false);
  await db2.query(`update org_features set governed_action = true where org_id = $1`, [f.orgId]);
  if (envWas === undefined) delete process.env.VNEXT_CONTROL_PLANE_ENABLED; else process.env.VNEXT_CONTROL_PLANE_ENABLED = envWas;

  // ── 13. Send safety ─────────────────────────────────────────────────────────────────────────────
  const sendAfter = (await db2.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];
  check("40: send surfaces are 0/0/0/0/0 and unchanged — nothing reached the outbox or a provider",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter)
    && Object.values(sendAfter as Record<string, number>).every((v) => Number(v) === 0), JSON.stringify(sendAfter));

  db2.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end(); await rw.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[p45-runtime-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
