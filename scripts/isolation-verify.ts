/**
 * Release Gate R1-G3 blind harness — runtime cross-tenant isolation (negative suite).
 * Under FORCE RLS, as app_rw pinned to org A, proves that caller-controlled IDs cannot
 * cross the tenant boundary across the surfaces R1 governs: participant read models,
 * governed action, recompute, tenant feature flags — and that consent / participant
 * WITHDRAWAL correctly revokes access. Everything a foreign org names (a pursuit id, an
 * org id) is refused or returns nothing; nothing of org B's is read or mutated by org A.
 *
 *   npx tsx scripts/isolation-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { addParticipant, acceptParticipation, revokeParticipation } from "../src/lib/pursuits/federation/participation";
import { proposeGrant, acceptGrant, revokeGrant, buildFederationViewer, hasActionAuthority } from "../src/lib/pursuits/federation/grants";
import { getPursuitFederation, getPursuitOutcomes } from "../src/lib/pursuits/federation/read-models";
import { seedGovernedSkills, dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { enqueueRecompute, drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import { setOrgFeature } from "../src/lib/pursuits/tenant-flags";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }
const actor = (orgId: string, role: Actor["role"]): Actor => ({ type: "USER", id: randomUUID(), orgId, role });

async function main() {
  console.log(`[isolation-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const a = await org("G3 OrgA"); const b = await org("G3 OrgB");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`G3 ${RID}`, `g3-${RID}`])).rows[0].id;
    const co = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [n])).rows[0].id;
    const pA = (await upsertPursuit(db, { orgId: a, accountId: await co(`A Co ${RID}`), productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    const pB = (await upsertPursuit(db, { orgId: b, accountId: await co(`B Co ${RID}`), productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "y", businessProblem: "y", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { a, b, pA, pB };
  });

  // ---- A cannot read/reach B's canonical pursuit by naming its id ----
  console.log("R1-G3.1  A cannot cross into B's pursuit by naming its id");
  check("org A sees zero rows for B's pursuit (RLS)", (await asOrg(s.a, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuits where id=$1`, [s.pB])).rows[0].n)) === "0");
  check("participant read model returns NOTHING for a foreign pursuit", (await asOrg(s.a, (db) => getPursuitFederation(db, s.a, s.pB))) === null);
  check("outcome read model returns NOTHING for a foreign pursuit", (await asOrg(s.a, async (db) => getPursuitOutcomes(db, await buildFederationViewer(db, s.a, s.pB), s.pB))) === null);

  // ---- A cannot mutate B via a governed action naming B's pursuit ----
  console.log("R1-G3.2  A cannot mutate B through a governed action");
  // B invites its own participant; A (naming B's participant id) must not be able to accept it.
  const bPart = await asOrg(s.b, (db) => addParticipant(db, { pursuitId: s.pB, orgId: s.b, roleKey: "VENDOR", sponsorOrgId: s.b, state: "ACTIVE" }));
  const foreignAccept = await asOrg(s.a, (db) => dispatchSkill(db, "accept_participation", actor(s.a, "operator"), { pursuitId: s.pB, args: { participantId: bPart } }));
  check("a governed accept on B's participant does not EXECUTE for org A", foreignAccept.status !== "EXECUTED");
  check("B's participant is unchanged (no cross-tenant mutation)", (await asOrg(s.b, async (db) => (await db.query<{ state: string }>(`select participation_state state from pursuit_participants where id=$1`, [bPart])).rows[0].state)) === "ACTIVE");

  // ---- A enqueuing/draining a recompute for B's pursuit produces no cross-tenant effect ----
  console.log("R1-G3.3  Recompute cannot be aimed across tenants");
  const beforeB = await asOrg(s.b, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.pB])).rows[0].n);
  await asOrg(s.a, async (db) => { await enqueueRecompute(db, { orgId: s.a, pursuitId: s.pB, changeType: "TRANSACTION_SIGNAL_INGESTED", asOf: new Date() }); await drainRecomputeQueue(db, {}); });
  const afterB = await asOrg(s.b, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.pB])).rows[0].n);
  check("draining A's queue creates NO route snapshot on B's pursuit", afterB === beforeB);

  // ---- Tenant feature flags cannot be read/written across tenants ----
  console.log("R1-G3.4  Feature flags are tenant-isolated");
  await asOrg(s.b, (db) => setOrgFeature(db, s.b, "pursuit_experience", true, { reason: "b" }));
  check("org A cannot read B's org_features row (RLS)", (await asOrg(s.a, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from org_features where org_id=$1`, [s.b])).rows[0].n)) === "0");
  check("org A cannot write a feature flag onto org B (RLS with-check)", await expectThrows(() => asOrg(s.a, (db) => setOrgFeature(db, s.b, "federation", true, {}))));

  // ---- Consent + participant WITHDRAWAL revoke access ----
  console.log("R1-G3.5  Consent + participant withdrawal");
  // B legitimately brings A onto B's pursuit + grants A action authority.
  const aOnB = await asOrg(s.b, (db) => addParticipant(db, { pursuitId: s.pB, orgId: s.a, roleKey: "DISTRIBUTOR", sponsorOrgId: s.b }));
  await asOrg(s.a, (db) => acceptParticipation(db, aOnB));
  check("as an ACTIVE participant, A can now see B's pursuit", (await asOrg(s.a, (db) => getPursuitFederation(db, s.a, s.pB))) !== null);
  const grant = await asOrg(s.b, (db) => proposeGrant(db, { pursuitId: s.pB, fromOrgId: s.b, toOrgId: s.a, grantKind: "ACTION", actionFamily: "team.request_acceptance", purpose: "authorize" }));
  await asOrg(s.a, (db) => acceptGrant(db, grant));
  check("A has action authority while the grant is live", await asOrg(s.a, (db) => hasActionAuthority(db, s.a, s.pB, "team.request_acceptance")));
  await asOrg(s.b, (db) => revokeGrant(db, grant));
  check("revoking the grant removes A's action authority (consent withdrawal)", !(await asOrg(s.a, (db) => hasActionAuthority(db, s.a, s.pB, "team.request_acceptance"))));
  await asOrg(s.b, (db) => revokeParticipation(db, aOnB));
  check("revoking participation removes A's visibility of B's pursuit", (await asOrg(s.a, (db) => getPursuitFederation(db, s.a, s.pB))) === null);

  console.log(`\n[isolation-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[isolation-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[isolation-verify] fatal:", e); process.exit(2); });
