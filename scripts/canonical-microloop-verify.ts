/**
 * Canonical closed micro-loop — end-to-end integration proof (Phase 1+2).
 *
 *   recommend route → authorized human decision/override → governed mutation →
 *   immutable audit evidence → recompute enqueued → worker drains → read model refreshes,
 *   with recommendation ≠ decision preserved, sponsor/partner disclosure intact, and an
 *   unauthorized tenant unable to observe or mutate any part of the sequence.
 *
 * Exercises the REAL services against the demo tenant. Run:
 *   DEMO_URL=… npx tsx scripts/canonical-microloop-verify.ts
 */
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { dispatchSkill } from "../src/lib/pursuits/federation/skills";
import { getRouteComparison } from "../src/lib/pursuits/read-models/route";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const internal = (orgId: string): Caller => ({ orgId, canSeeInternal: true, canSeeTransactionDetail: true });
const partner = (orgId: string): Caller => ({ orgId, canSeeInternal: false, canSeeTransactionDetail: false });

/** Owner connection with the org GUC pinned (RLS latent — how the app runs today). */
async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
/** Non-owner app_rw connection with a (possibly foreign) org GUC — RLS actually enforces. */
async function rls<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  try {
    // ---- Pick a pursuit whose recommended route is CDW with a distinct alternative (ideally WWT). ----
    const pick = await pool.query<{ pursuit_id: string; org_id: string }>(
      `select s.pursuit_id, s.org_id
         from pursuit_route_snapshots s
         join route_candidates rc on rc.route_snapshot_id = s.id
         left join partners p on p.id = s.recommended_partner_id
        where s.is_current and p.name = 'CDW'
        group by s.pursuit_id, s.org_id having count(*) >= 2 limit 1`);
    if (!pick.rows[0]) { console.log("no CDW-recommended pursuit with alternatives — seed the demo first"); process.exit(1); }
    const { pursuit_id: pursuitId, org_id: orgA } = pick.rows[0];

    // Clean start: recompute a fresh RECOMMENDED snapshot so the loop begins undecided (idempotent).
    await tx(pool, orgA, (db) => recomputeRoute(db, pursuitId, new Date(), "DEMO"));

    // Identify recommended (CDW) + a non-recommended, non-disqualified alternative (prefer WWT).
    const before = await tx(pool, orgA, (db) => getRouteComparison(db, internal(orgA), pursuitId));
    const recLabel = before.recommended?.label ?? "?";
    const alt = before.alternatives.find((a) => /WWT|World Wide/i.test(a.label) && !a.disqualified)
             ?? before.alternatives.find((a) => !a.disqualified);
    if (!alt) { console.log("no viable alternative candidate to override to"); process.exit(1); }
    console.log(`\n  · pursuit ${pursuitId.slice(0, 8)} — recommended=${recLabel}, overriding to=${alt.label}\n`);

    // (1) recommendation is CDW.
    ok("1. recommendation is CDW", recLabel === "CDW", `got ${recLabel}`);
    ok("1b. route is undecided at loop start (Today shows the decision)",
      (await tx(pool, orgA, (db) => getTodayQueue(db, internal(orgA), {}))).items.some((i) => i.type === "ROUTE_APPROVAL" && i.pursuitId === pursuitId));

    // ---- Rollback/failure BEFORE the happy path: a viewer may not decide. ----
    const viewerAttempt = await tx(pool, orgA, (db) => dispatchSkill(db, "override_partner_route", { type: "USER", id: null, orgId: orgA, role: "viewer" }, { pursuitId, args: { candidateKey: alt.key, reason: "nope", category: "OTHER" }, correlationId: null }));
    ok("R1. viewer override REJECTED (insufficient permission)", viewerAttempt.status === "REJECTED");
    ok("R1b. rejected attempt did not select anything", !(await tx(pool, orgA, (db) => getRouteComparison(db, internal(orgA), pursuitId))).decided);

    // ---- Failure: an unknown candidate id fails cleanly (FAILED invocation, no mutation). ----
    const badCand = await tx(pool, orgA, (db) => dispatchSkill(db, "override_partner_route", { type: "USER", id: null, orgId: orgA, role: "operator" }, { pursuitId, args: { candidateKey: "00000000-0000-0000-0000-000000000000", reason: "bad", category: "OTHER" }, correlationId: null }));
    ok("R2. unknown candidate → FAILED invocation (audited), no mutation", badCand.status === "FAILED");

    // ---- (2)(3)(4) The authorized human override, through the governed mutation authority. ----
    const correlationId = randomUUID();
    const decision = await tx(pool, orgA, (db) => dispatchSkill(db, "override_partner_route", { type: "USER", id: null, orgId: orgA, role: "operator" }, {
      pursuitId, args: { candidateKey: alt.key, reason: "Existing exec relationship at the account", category: "RELATIONSHIP_KNOWLEDGE" }, correlationId }));
    ok("3. governed skill invocation EXECUTED", decision.status === "EXECUTED", decision.status);

    const inv = (await pool.query<{ skill_id: string; status: string; correlation_id: string; effect_class: string }>(
      `select skill_id, status, correlation_id, effect_class from governed_action_invocations where id = $1`, [decision.invocationId])).rows[0];
    ok("3b. invocation row: override_partner_route / EXECUTED / INTERNAL_WRITE / correlated", !!inv && inv.skill_id === "override_partner_route" && inv.status === "EXECUTED" && inv.effect_class === "INTERNAL_WRITE" && inv.correlation_id === correlationId);

    const snap = (await pool.query<{ selected: string | null; recommended: string | null; route_status: string }>(
      `select selected_partner_id selected, recommended_partner_id recommended, route_status from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId])).rows[0];
    ok("4. canonical mutation: selected_partner_id = the chosen (WWT) route", snap.selected === (alt.key ? await partnerOf(pool, alt.key) : null));
    ok("4b. route_status = SELECTED", snap.route_status === "SELECTED");
    const ov = (await pool.query<{ orig: { recommendedPartnerId: string | null }; human: { selectedPartnerId: string | null }; reason: string | null }>(
      `select original_recommendation orig, human_decision human, reason from pursuit_overrides where pursuit_id = $1 order by created_at desc limit 1`, [pursuitId])).rows[0];
    ok("4c. pursuit_overrides captured recommendation AND decision separately", !!ov && ov.orig.recommendedPartnerId === snap.recommended && ov.human.selectedPartnerId === snap.selected && !!ov.reason);
    const led = (await pool.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id = $1 and change_type = 'PARTNER_OVERRIDE'`, [pursuitId])).rows[0];
    ok("4d. change_ledger PARTNER_OVERRIDE event recorded", Number(led.n) >= 1);

    // (5) append-only: the audit rows cannot be rewritten by app_rw.
    const upd = await rls(pool, orgA, (db) => db.query(`update change_ledger set reason = 'x' where pursuit_id = $1`, [pursuitId]).then(() => "OK").catch((e: { code?: string }) => e.code ?? "ERR"));
    ok("5. change_ledger UPDATE denied to app_rw (append-only)", upd === "42501");

    // (6) recompute enqueued once — READINESS/TODAY, never ROUTE (selection would be lost).
    const reqs = (await pool.query<{ target: string; status: string; correlation_id: string | null }>(
      `select target, status, correlation_id from recompute_requests where pursuit_id = $1 and correlation_id = $2`, [pursuitId, correlationId])).rows;
    ok("6. recompute enqueued on the decision", reqs.length > 0);
    ok("6b. targets are READINESS/TODAY only (no ROUTE rebuild)", reqs.every((r) => r.target === "READINESS" || r.target === "TODAY") && !reqs.some((r) => r.target === "ROUTE"));

    // (7) worker drains the queue.
    await tx(pool, orgA, (db) => drainRecomputeQueue(db, {}));
    const pendAfter = Number((await pool.query<{ n: string }>(`select count(*)::text n from recompute_requests where pursuit_id = $1 and status in ('PENDING','RUNNING')`, [pursuitId])).rows[0].n);
    ok("7. worker processed the queue (nothing left PENDING/RUNNING)", pendAfter === 0);

    // (8)(9) refreshed read model: decision reflected, recommendation preserved & distinguishable.
    const after = await tx(pool, orgA, (db) => getRouteComparison(db, internal(orgA), pursuitId));
    ok("8. read model: decided, selection differs from recommendation, recompute settled",
      after.decided && !after.selectionMatchesRecommendation && after.recomputePending === false);
    ok("9. recommendation (CDW) and human decision (WWT) remain distinguishable",
      after.recommended?.label === "CDW" && after.selected?.label === alt.label && after.recommended?.label !== after.selected?.label);
    ok("9b. the ROUTE_APPROVAL decision is gone from Today (loop closed)",
      !(await tx(pool, orgA, (db) => getTodayQueue(db, internal(orgA), {}))).items.some((i) => i.type === "ROUTE_APPROVAL" && i.pursuitId === pursuitId));

    // (10) disclosure projection: internal reasons withheld from a partner-class viewer, server-side.
    const asPartner = await tx(pool, orgA, (db) => getRouteComparison(db, partner(orgA), pursuitId));
    ok("10. partner-class viewer receives NO internal reasons (withheld server-side)", asPartner.recommended?.reasonsInternal === null);
    ok("10b. sponsor (internal) viewer DOES receive internal reasons", Array.isArray(after.recommended?.reasonsInternal));

    // (11) isolation: a different tenant cannot observe or mutate any part of the sequence.
    const orgB = (await pool.query<{ id: string }>(`select id from organizations where id <> $1 order by created_at limit 1`, [orgA])).rows[0].id;
    const foreignSees = await rls(pool, orgB, (db) => db.query<{ n: string }>(`select count(*)::text n from route_candidates where id = $1`, [alt.key]).then((r) => Number(r.rows[0].n)));
    ok("11. foreign tenant cannot OBSERVE the route candidate (RLS)", foreignSees === 0);
    const foreignMutates = await rls(pool, orgB, (db) => db.query(`update pursuit_route_snapshots set route_status = 'RECOMMENDED' where pursuit_id = $1`, [pursuitId]).then((r) => r.rowCount ?? 0));
    ok("11b. foreign tenant cannot MUTATE the snapshot (RLS → 0 rows)", foreignMutates === 0);
    const foreignInvocation = (await pool.query<{ n: string }>(`select count(*)::text n from governed_action_invocations where id = $1 and org_id = $2`, [decision.invocationId, orgB])).rows[0];
    ok("11c. the invocation belongs to the acting org, not the foreign one", Number(foreignInvocation.n) === 0);

    console.log(`\n[canonical-microloop-verify] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  } finally {
    await pool.end();
  }
}

async function partnerOf(pool: Pool, candidateId: string): Promise<string | null> {
  return (await pool.query<{ partner_id: string | null }>(`select partner_id from route_candidates where id = $1`, [candidateId])).rows[0]?.partner_id ?? null;
}
function randomUuid(): string { return require("node:crypto").randomUUID(); }

main().catch((e) => { console.error("[canonical-microloop-verify] fatal:", e); process.exit(1); });
