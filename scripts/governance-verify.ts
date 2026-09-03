/**
 * Workstream E3-D blind harness — governed action boundary.
 * Proves dispatchSkill enforces: actor eligibility + required permission (R9),
 * effect-class routing (READ/INTERNAL_WRITE run; EXTERNAL_ACTION queues the outbox
 * and never runs inline, R25; CROSS_TENANT_ACTION requires an ACTION grant, never
 * a DATA grant, R24), idempotency, loop guard (R23), external-action receipts (R26),
 * and the audit invocation record. Runs as app_rw under RLS against pursuit_demo.
 *
 *   npx tsx scripts/governance-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { seedGovernedSkills, dispatchSkill, drainActionOutbox, type Actor } from "../src/lib/pursuits/federation/skills";
import { addParticipant } from "../src/lib/pursuits/federation/participation";
import { proposeGrant, acceptGrant } from "../src/lib/pursuits/federation/grants";
import { governedActionEnabled } from "../src/lib/pursuits/federation/flags";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const actor = (orgId: string, role: Actor["role"], type: Actor["type"] = "USER"): Actor => ({ type, id: randomUUID(), orgId, role });

async function main() {
  console.log(`[governance-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3D Vendor"); const dist = await org("E3D Distributor");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3D ${RID}`, `e3d-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`E3D Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, dist, hero };
  });

  // ---- Registry seeded ----
  console.log("E3-D.1  Skill registry");
  check("governed_skills registry seeded", (await asOrg(s.vendor, async (db) => (await db.query(`select count(*)::int n from governed_skills`)).rows[0].n)) >= 4);

  // ---- Permission + actor eligibility (R9) ----
  console.log("E3-D.2  Permission + actor eligibility");
  const partId = await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.dist, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor }));
  check("READ skill executes for a viewer", (await asOrg(s.vendor, (db) => dispatchSkill(db, "explain_route", actor(s.vendor, "viewer"), { pursuitId: s.hero }))).status === "EXECUTED");
  check("INTERNAL_WRITE rejected for a viewer (insufficient permission)",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "accept_participation", actor(s.vendor, "viewer"), { pursuitId: s.hero, args: { participantId: partId } }))).status === "REJECTED");
  check("INTERNAL_WRITE rejected for an ineligible actor type (AGENT)",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "accept_participation", actor(s.vendor, "operator", "AGENT"), { pursuitId: s.hero, args: { participantId: partId } }))).status === "REJECTED");
  const accepted = await asOrg(s.dist, (db) => dispatchSkill(db, "accept_participation", actor(s.dist, "operator"), { pursuitId: s.hero, args: { participantId: partId } }));
  check("INTERNAL_WRITE executes for an operator and performs the mutation", accepted.status === "EXECUTED" &&
    (await asOrg(s.dist, async (db) => (await db.query(`select participation_state from pursuit_participants where id=$1`, [partId])).rows[0].participation_state)) === "ACTIVE");

  // ---- Idempotency ----
  console.log("E3-D.3  Idempotency");
  const key = `idem-${RID}`;
  const first = await asOrg(s.vendor, (db) => dispatchSkill(db, "explain_route", actor(s.vendor, "operator"), { pursuitId: s.hero, idempotencyKey: key }));
  const second = await asOrg(s.vendor, (db) => dispatchSkill(db, "explain_route", actor(s.vendor, "operator"), { pursuitId: s.hero, idempotencyKey: key }));
  check("idempotency key dedupes to a single invocation", first.invocationId === second.invocationId);

  // ---- CROSS_TENANT_ACTION authority (R24) ----
  console.log("E3-D.4  Cross-tenant action authority");
  /*
   * Wave 6B §6. `request_team_acceptance` requires a confirmed (INVITED) team
   * member — that is its documented precondition, and the fixture never created
   * one or passed `memberId`. The first two assertions below never noticed,
   * because authority is checked BEFORE the handler runs, so only the
   * authorized path ever reached it. When it did, the handler threw, the throw
   * aborted the transaction, and the suite died with "current transaction is
   * aborted" — which is why this was reported as a SAVEPOINT problem. The
   * savepoint was one real defect (fixed in skills.ts); this missing
   * prerequisite is the other, and it was hiding behind it.
   */
  const memberId = (await asOwner((db) => db.query<{ id: string }>(
    `insert into pursuit_team_members (org_id, pursuit_id, side, role, status, is_recommended, is_accepted)
     values ($1,$2,'PARTNER','PARTNER_ACCOUNT_MANAGER','INVITED', true, false) returning id`,
    [s.vendor, s.hero],
  ))).rows[0].id;
  check("CROSS_TENANT_ACTION rejected without an ACTION grant",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero, args: { memberId } }))).status === "REJECTED");
  // distributor grants vendor DATA (must NOT authorize) then ACTION (authorizes)
  const dataG = await asOrg(s.dist, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.dist, toOrgId: s.vendor, grantKind: "DATA", purpose: "share" }));
  await asOrg(s.vendor, (db) => acceptGrant(db, dataG));
  check("a DATA grant does NOT authorize a CROSS_TENANT_ACTION (R24)",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero, args: { memberId } }))).status === "REJECTED");
  const actG = await asOrg(s.dist, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.dist, toOrgId: s.vendor, grantKind: "ACTION", actionFamily: "team.request_acceptance", purpose: "authorize team ask" }));
  await asOrg(s.vendor, (db) => acceptGrant(db, actG));
  /* §6 proof: the two rejections above changed nothing. The skill's only
     material effect is a TEAM_CHANGED change-ledger entry, so its absence is
     the evidence that a refused cross-tenant action persists no mutation —
     while the REJECTED invocation rows above prove the refusals were audited. */
  check("a rejected cross-tenant action persisted no mutation",
    (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(
      `select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='TEAM_CHANGED'`, [s.hero])).rows[0].n)) === "0");
  check("both refusals were recorded as REJECTED invocations",
    (await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(
      `select count(*)::text n from governed_action_invocations where pursuit_id=$1 and skill_id='request_team_acceptance' and status='REJECTED'`, [s.hero])).rows[0].n)) === "2");
  check("an ACTION grant authorizes the CROSS_TENANT_ACTION",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero, args: { memberId } }))).status === "EXECUTED");

  // ---- EXTERNAL_ACTION outbox + receipt (R25/R26) ----
  console.log("E3-D.5  External-action outbox + receipt");
  const ext = await asOrg(s.vendor, (db) => dispatchSkill(db, "send_partner_intro", actor(s.vendor, "operator"), { pursuitId: s.hero, args: { to: "cdw" } }));
  check("EXTERNAL_ACTION is queued (EXECUTING), not run inline (R25)", ext.status === "EXECUTING" && ext.queued === true);
  check("an outbox row exists PENDING before any executor runs",
    (await asOrg(s.vendor, async (db) => (await db.query(`select count(*)::int n from action_outbox where invocation_id=$1 and status='PENDING'`, [ext.invocationId])).rows[0].n)) === 1);
  const drained = await asOrg(s.vendor, (db) => drainActionOutbox(db, { simulate: true }));
  check("executor drains the outbox and writes a receipt (R26)", drained >= 1 &&
    (await asOrg(s.vendor, async (db) => (await db.query(`select count(*)::int n from action_receipts where invocation_id=$1`, [ext.invocationId])).rows[0].n)) === 1);
  check("invocation completes EXECUTED after the receipt",
    (await asOrg(s.vendor, async (db) => (await db.query(`select status from governed_action_invocations where id=$1`, [ext.invocationId])).rows[0].status)) === "EXECUTED");

  // ---- Loop guard (R23) ----
  console.log("E3-D.6  Loop guard");
  const corr = randomUUID();
  await asOrg(s.vendor, async (db) => { for (let i = 0; i < 25; i++) await dispatchSkill(db, "explain_route", actor(s.vendor, "operator"), { pursuitId: s.hero, correlationId: corr }); });
  check("action chain beyond the loop-guard depth is rejected",
    (await asOrg(s.vendor, (db) => dispatchSkill(db, "explain_route", actor(s.vendor, "operator"), { pursuitId: s.hero, correlationId: corr }))).status === "REJECTED");

  // ---- Flag fail-safe ----
  console.log("E3-D.7  Governed-action flag fail-safe");
  const savedGA = process.env.GOVERNED_ACTION_ENABLED, savedExp = process.env.PURSUIT_EXPERIENCE_ENABLED;
  process.env.GOVERNED_ACTION_ENABLED = "1"; delete process.env.PURSUIT_EXPERIENCE_ENABLED;
  check("governed action disabled when federation dependency is off", !governedActionEnabled());
  if (savedGA === undefined) delete process.env.GOVERNED_ACTION_ENABLED; else process.env.GOVERNED_ACTION_ENABLED = savedGA;
  if (savedExp === undefined) delete process.env.PURSUIT_EXPERIENCE_ENABLED; else process.env.PURSUIT_EXPERIENCE_ENABLED = savedExp;

  console.log(`\n[governance-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[governance-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[governance-verify] fatal:", e); process.exit(2); });
