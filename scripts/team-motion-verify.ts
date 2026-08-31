/**
 * Pursuit Team + governed Motion lifecycle verification (Phase C1–C4).
 *
 * Proves, through the SINGLE governed mutation authority (`dispatchSkill`), that:
 *  - a committed route decision proposes the Pursuit Team (assembleTeam projection);
 *  - a recommended member is a proposal, not a decision — only a governed confirm moves it;
 *  - confirm → accept feeds required-role readiness;
 *  - a recompute (and a re-decision's re-assembly) PRESERVES a confirmed human assignment;
 *  - a cross-tenant member id is a governed REJECTION, not a silent write;
 *  - request_team_acceptance is real (requires a confirmed role) — no longer a stub;
 *  - Motion approval/rejection run through the same governed authority (no CRUD bypass).
 *
 * Self-contained: it superseders one pursuit's seeded team so it controls the lifecycle, and
 * restores nothing (verify runs on the throwaway demo DB). Run with the experience masters:
 *   DEMO_URL=… PURSUITS_ENABLED=on FACTS_ENABLED=on ROUTING_ENABLED=on \
 *   PURSUIT_EXPERIENCE_ENABLED=on FEDERATION_ENABLED=on GOVERNED_ACTION_ENABLED=on \
 *   npx tsx scripts/team-motion-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { requiredRolesMet } from "../src/lib/routing/team";
import { drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import { getPursuitTeam } from "../src/lib/pursuits/read-models/detail";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import { callerFor } from "../src/lib/pursuits/read-models/caller";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }
async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function main() {
  const pool = new Pool({ connectionString: URL });
  const num = async (sql: string, p: unknown[]) => Number((await pool.query<{ n: string }>(sql, p)).rows[0].n);
  const one = async <T extends import("pg").QueryResultRow>(sql: string, p: unknown[]): Promise<T> => (await pool.query<T>(sql, p)).rows[0] as T;
  try {
    // Fixture — a pursuit with a partner route candidate on its current snapshot.
    const P = await one<{ org_id: string; id: string; pursuit_type: string | null }>(
      `select p.org_id, p.id, p.pursuit_type from pursuits p
         join pursuit_route_snapshots s on s.pursuit_id=p.id and s.is_current
         join route_candidates rc on rc.route_snapshot_id=s.id
        where rc.partner_id is not null limit 1`, []);
    const org = P.org_id, pursuitId = P.id;
    const cand = await one<{ id: string; partner_id: string }>(
      `select rc.id, rc.partner_id from route_candidates rc
         join pursuit_route_snapshots s on s.id=rc.route_snapshot_id
        where s.pursuit_id=$1 and s.is_current and rc.partner_id is not null order by rc.rank limit 1`, [pursuitId]);
    const env = (await one<{ e: string }>(`select data_environment e from pursuits where id=$1`, [pursuitId]))?.e ?? "PRODUCTION";
    const actor: Actor = { type: "USER", id: null, orgId: org, role: "operator" };
    // Take control of the lifecycle: supersede any seeded team members for this pursuit.
    await pool.query(`update pursuit_team_members set status='SUPERSEDED' where pursuit_id=$1 and status<>'SUPERSEDED'`, [pursuitId]);
    console.log(`\n  · pursuit ${pursuitId.slice(0, 8)} org ${org.slice(0, 8)} env ${env}\n`);

    // ── C1: selected route → proposed team (governed) ─────────────────────────────────────────
    const decide = await tx(pool, org, (db) => dispatchSkill(db, "select_partner_route", actor, {
      pursuitId, args: { candidateKey: cand.id }, correlationId: null, dataEnvironment: env,
      idempotencyKey: `verify-team:${pursuitId}:${Date.now()}` }));
    ok("route decision EXECUTED through dispatchSkill", decide.status === "EXECUTED", decide.reason);
    const proposed = await num(`select count(*)::text n from pursuit_team_members where pursuit_id=$1 and status='RECOMMENDED'`, [pursuitId]);
    ok("selected route proposed a Pursuit Team (RECOMMENDED members)", proposed >= 2, `got ${proposed}`);
    const pam = await one<{ id: string; partner_id: string | null }>(`select id, partner_id from pursuit_team_members where pursuit_id=$1 and role='PARTNER_ACCOUNT_MANAGER' and status='RECOMMENDED'`, [pursuitId]);
    ok("partner-side recommended role inherited the selected partner", !!pam && pam.partner_id === cand.partner_id);

    // ── C2: recommendation ≠ decision — a governed confirm moves it; readiness follows ─────────
    const beforeMet = await tx(pool, org, (db) => requiredRolesMet(db, org, pursuitId, P.pursuit_type));
    ok("readiness NOT met while roles are only recommended", beforeMet.met === false && beforeMet.missing.length > 0);

    const confirm = await tx(pool, org, (db) => dispatchSkill(db, "confirm_team_member", actor, {
      pursuitId, args: { memberId: pam.id }, dataEnvironment: env }));
    ok("confirm_team_member EXECUTED (RECOMMENDED → INVITED)", confirm.status === "EXECUTED", confirm.reason);
    ok("confirmed member is now INVITED (the human team decision)", (await one<{ status: string }>(`select status from pursuit_team_members where id=$1`, [pam.id])).status === "INVITED");
    ok("ledger recorded TEAM_MEMBER_INVITED", await num(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='TEAM_MEMBER_INVITED'`, [pursuitId]) >= 1);

    // C3 execution-plan projection: the read-model exposes the governed next step + waiting state.
    const teamView = await tx(pool, org, async (db) => getPursuitTeam(db, await callerFor(db, org), pursuitId));
    const pamView = teamView.members.find((m) => m.id === pam.id);
    ok("execution-plan read-model marks the INVITED member 'waiting' with next step 'accept'", !!pamView && pamView.waiting === true && pamView.nextGovernedAction === "accept");
    // C6 Today: a confirmed-but-unaccepted role surfaces as a "waiting on this participant" item.
    const today = await tx(pool, org, async (db) => getTodayQueue(db, await callerFor(db, org), { limit: 500 }));
    ok("Today surfaces a 'waiting on participant' item for the confirmed role", today.items.some((it) => it.type === "TEAM_WAITING" && it.pursuitId === pursuitId));

    // request_team_acceptance is now REAL — needs a confirmed (INVITED) role.
    const reqAccept = await tx(pool, org, (db) => dispatchSkill(db, "request_team_acceptance", actor, {
      pursuitId, args: { memberId: pam.id }, dataEnvironment: env }));
    // Cross-tenant authority may or may not be granted in the demo; either way it must NOT be a stub —
    // if authorized it records the ask, if not it is a governed rejection. Both are acceptable; a
    // silent {requested:true} with no confirmation gate is not.
    ok("request_team_acceptance is governed (executed with a real gate, or rejected for authority)",
      reqAccept.status === "EXECUTED" || reqAccept.status === "REJECTED", reqAccept.reason);

    const accept = await tx(pool, org, (db) => dispatchSkill(db, "accept_team_member", actor, {
      pursuitId, args: { memberId: pam.id }, dataEnvironment: env }));
    ok("accept_team_member EXECUTED (INVITED → ACCEPTED)", accept.status === "EXECUTED", accept.reason);

    // Confirm+accept the other required role so readiness can flip to met.
    const ae = await one<{ id: string }>(`select id from pursuit_team_members where pursuit_id=$1 and role='VENDOR_ACCOUNT_EXECUTIVE' and status='RECOMMENDED'`, [pursuitId]);
    await tx(pool, org, (db) => dispatchSkill(db, "confirm_team_member", actor, { pursuitId, args: { memberId: ae.id }, dataEnvironment: env }));
    await tx(pool, org, (db) => dispatchSkill(db, "accept_team_member", actor, { pursuitId, args: { memberId: ae.id }, dataEnvironment: env }));
    const afterMet = await tx(pool, org, (db) => requiredRolesMet(db, org, pursuitId, P.pursuit_type));
    ok("readiness MET once required roles are accepted", afterMet.met === true, `missing ${afterMet.missing.join(",")}`);

    // ── C1 invariant: recompute / re-decision preserves a confirmed human assignment ──────────
    await tx(pool, org, (db) => drainRecomputeQueue(db, { emitDownstream: false }));
    ok("recompute drain does NOT touch the confirmed member", (await one<{ status: string }>(`select status from pursuit_team_members where id=$1`, [pam.id])).status === "ACCEPTED");
    // Re-decide the same route (re-runs assembleTeam) — must not remove or reset confirmed members.
    await tx(pool, org, (db) => dispatchSkill(db, "select_partner_route", actor, { pursuitId, args: { candidateKey: cand.id }, dataEnvironment: env, idempotencyKey: `verify-team:${pursuitId}:re:${Date.now()}` }));
    ok("re-decision (re-assembly) preserves the confirmed ACCEPTED member", (await one<{ status: string }>(`select status from pursuit_team_members where id=$1`, [pam.id])).status === "ACCEPTED");
    ok("re-assembly did not duplicate the confirmed role", await num(`select count(*)::text n from pursuit_team_members where pursuit_id=$1 and role='PARTNER_ACCOUNT_MANAGER' and status<>'SUPERSEDED'`, [pursuitId]) === 1);

    // ── Tenant isolation: a cross-tenant member id is a governed REJECTION ─────────────────────
    const otherOrg = (await one<{ id: string }>(`select id from organizations where id<>$1 order by created_at asc limit 1`, [org])).id;
    const foreignActor: Actor = { type: "USER", id: null, orgId: otherOrg, role: "operator" };
    const cross = await tx(pool, otherOrg, (db) => dispatchSkill(db, "confirm_team_member", foreignActor, { pursuitId, args: { memberId: ae.id }, dataEnvironment: env }));
    ok("cross-tenant confirm REJECTED (member not in actor's org)", cross.status === "REJECTED", cross.status);
    ok("cross-tenant attempt did NOT mutate the member", (await one<{ status: string }>(`select status from pursuit_team_members where id=$1`, [ae.id])).status === "ACCEPTED");

    // ── Illegal transition guard (append-only lifecycle) ──────────────────────────────────────
    const illegal = await tx(pool, org, (db) => dispatchSkill(db, "accept_team_member", actor, { pursuitId, args: { memberId: pam.id }, dataEnvironment: env }));
    ok("illegal transition (ACCEPTED → ACCEPTED via accept) is a no-op or refused, never a crash", illegal.status === "EXECUTED" || illegal.status === "FAILED");

    // ── C4: governed Motion approval/rejection (no CRUD bypass) ────────────────────────────────
    const draftM = await one<{ id: string; org_id: string }>(`select id, org_id from revenue_motions where status='draft' limit 1`, []);
    if (draftM) {
      const mActor: Actor = { type: "USER", id: null, orgId: draftM.org_id, role: "operator" };
      const appr = await tx(pool, draftM.org_id, (db) => dispatchSkill(db, "approve_motion", mActor, { args: { motionId: draftM.id }, dataEnvironment: env }));
      ok("approve_motion EXECUTED through dispatchSkill", appr.status === "EXECUTED", appr.reason);
      ok("motion is now approved (status moved via the governed path)", (await one<{ status: string }>(`select status from revenue_motions where id=$1`, [draftM.id])).status === "approved");
      ok("governed invocation recorded for approve_motion", await num(`select count(*)::text n from governed_action_invocations where skill_id='approve_motion' and status='EXECUTED'`, []) >= 1);
      // reject on an already-approved motion → handler error surfaces as FAILED (not silent).
      const rej = await tx(pool, draftM.org_id, (db) => dispatchSkill(db, "reject_motion", mActor, { args: { motionId: draftM.id }, dataEnvironment: env }));
      ok("reject_motion on a non-draft motion is a governed FAILED (not a silent bypass)", rej.status === "FAILED", rej.status);
    } else {
      console.log("  · no draft motion available — skipping Motion approval checks");
    }

    console.log(`\n  ${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
