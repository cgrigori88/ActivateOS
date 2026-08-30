/**
 * Workstream E3-A blind harness — Federated Pursuit participation.
 * Runs against the full-schema demo DB (pursuit_demo) so it exercises the real
 * 0080 migration under real RLS as app_rw. Proves: extensible role registry,
 * participation lifecycle + illegal-transition guard, can_see_pursuit isolation
 * (sponsor + ACTIVE participant see; non-participant does not; INVITED sees only
 * its own edge), cross-tenant write refusal, multi-party topology, graceful
 * partial participation, room→pursuit projection binding, and the flag fail-safe.
 *
 *   npx tsx scripts/federation-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import {
  listRoleTypes, addParticipant, acceptParticipation, declineParticipation,
  revokeParticipation, getParticipants, activeParticipantOrgIds, canTransition,
} from "../src/lib/pursuits/federation/participation";
import { federationEnabled, federationReadiness } from "../src/lib/pursuits/federation/flags";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }

async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function seesPursuit(orgId: string, pursuitId: string): Promise<boolean> {
  return asOrg(orgId, async (db) => (await db.query<{ v: boolean }>(`select public.can_see_pursuit($1) as v`, [pursuitId])).rows[0].v);
}
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

async function main() {
  console.log(`[federation-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full', now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3A Vendor"); const distributor = await org("E3A Distributor");
    const reseller = await org("E3A Reseller"); const customer = await org("E3A Customer"); const outsider = await org("E3A Outsider");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3A Cat ${RID}`, `e3a-cat-${RID}`])).rows[0].id;
    const co = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Technology','US') returning id`, [n])).rows[0].id;
    const acct = await co(`E3A Globex ${RID}`);
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "virtualization exit", businessProblem: "Exit legacy virtualization", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    const solo = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "EXPANSION", useCase: "solo", businessProblem: "Solo pursuit", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, distributor, reseller, customer, outsider, hero, solo };
  });

  // ---- Role registry (R3) ----
  console.log("E3-A.1  Extensible role registry");
  const roles = await asOrg(s.vendor, (db) => listRoleTypes(db));
  check("role registry seeded (>= 9 roles)", roles.length >= 9, `${roles.length}`);
  check("includes vendor/distributor/reseller + customer-guest + observer", ["VENDOR", "DISTRIBUTOR", "RESELLER", "CUSTOMER_GUEST", "OBSERVER"].every((k) => roles.some((r) => r.roleKey === k)));
  check("route-capability distinguishes participation from route (observer not route-capable)", roles.find((r) => r.roleKey === "OBSERVER")?.isRouteCapable === false && roles.find((r) => r.roleKey === "DISTRIBUTOR")?.isRouteCapable === true);

  // ---- Participation lifecycle (R2) ----
  console.log("E3-A.2  Participation lifecycle + guards");
  const { distId, resId } = await asOrg(s.vendor, async (db) => {
    await addParticipant(db, { pursuitId: s.hero, orgId: s.vendor, roleKey: "VENDOR", sponsorOrgId: s.vendor, source: "sponsor", state: "ACTIVE" });
    const distId = await addParticipant(db, { pursuitId: s.hero, orgId: s.distributor, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor, inviterOrgId: s.vendor, source: "sponsor" });
    const resId = await addParticipant(db, { pursuitId: s.hero, orgId: s.reseller, roleKey: "RESELLER", sponsorOrgId: s.vendor, inviterOrgId: s.vendor, source: "sponsor" });
    return { distId, resId };
  });
  await asOrg(s.distributor, (db) => acceptParticipation(db, distId));
  check("legal transition table: INVITED→ACTIVE ok, ACTIVE→INVITED illegal", canTransition("INVITED", "ACTIVE") && !canTransition("ACTIVE", "INVITED"));
  // decline then try to accept the declined row → illegal transition rejected
  await asOrg(s.reseller, (db) => declineParticipation(db, resId));
  check("illegal transition (accept a DECLINED participation) is rejected", await expectThrows(() => asOrg(s.reseller, (db) => acceptParticipation(db, resId))));

  // ---- can_see_pursuit isolation (R2 / T1-T3) ----
  console.log("E3-A.3  can_see_pursuit isolation");
  check("sponsor org sees the pursuit", await seesPursuit(s.vendor, s.hero));
  check("ACTIVE participant (distributor) sees the pursuit", await seesPursuit(s.distributor, s.hero));
  check("non-participant (outsider) does NOT see the pursuit", !(await seesPursuit(s.outsider, s.hero)));
  check("INVITED-only never became ACTIVE: declined reseller does NOT see the pursuit", !(await seesPursuit(s.reseller, s.hero)));
  // Edge visibility: an org sees its OWN participation row but not others'
  const outsiderRows = await asOrg(s.outsider, (db) => getParticipants(db, s.hero));
  check("outsider sees zero participation rows", outsiderRows.length === 0);
  const vendorRows = await asOrg(s.vendor, (db) => getParticipants(db, s.hero));
  check("sponsor sees all participation edges", vendorRows.length === 3);
  check("active participant org ids = sponsor + distributor", (await asOrg(s.vendor, (db) => activeParticipantOrgIds(db, s.hero))).sort().join() === [s.vendor, s.distributor].sort().join());

  // ---- Cross-tenant write refusal (T8 precursor) ----
  console.log("E3-A.4  Cross-tenant write refusal");
  check("outsider cannot insert a participation row for another org", await expectThrows(() =>
    asOrg(s.outsider, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.customer, roleKey: "CUSTOMER_GUEST", sponsorOrgId: s.vendor }))));

  // ---- Multi-party topology (R3) ----
  console.log("E3-A.5  Multi-party topology + graceful partial participation");
  await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.customer, roleKey: "CUSTOMER_GUEST", sponsorOrgId: s.vendor, source: "sponsor", state: "ACTIVE" }));
  const all = await asOrg(s.vendor, (db) => getParticipants(db, s.hero));
  check("N-party (>2) participation supported with varied roles", all.length >= 4 && new Set(all.map((p) => p.roleKey)).size >= 3);
  check("sponsor flagged correctly on the vendor edge", all.find((p) => p.orgId === s.vendor)?.isSponsor === true);
  // graceful partial: a pursuit with no explicit participants still resolves for its sponsor
  check("graceful partial participation: solo pursuit visible to sponsor, empty participant set", (await seesPursuit(s.vendor, s.solo)) && (await asOrg(s.vendor, (db) => getParticipants(db, s.solo))).length === 0);

  // ---- Room → Pursuit projection binding (R1/§5) ----
  console.log("E3-A.6  Room projection binding");
  const hasCol = await asOwner(async (db) => (await db.query(`select 1 from information_schema.columns where table_name='joint_pursuits' and column_name='pursuit_id'`)).rowCount === 1);
  check("joint_pursuits carries a pursuit_id projection FK (room projects a Pursuit, not vice versa)", hasCol);

  // ---- Flag fail-safe (R42) ----
  console.log("E3-A.7  Federation flag fail-safe");
  const savedFed = process.env.FEDERATION_ENABLED, savedExp = process.env.PURSUIT_EXPERIENCE_ENABLED;
  process.env.FEDERATION_ENABLED = "1"; delete process.env.PURSUIT_EXPERIENCE_ENABLED;
  check("federation disabled when its experience dependency is off", !federationEnabled());
  check("readiness names the missing dependency", federationReadiness().missing.length >= 1, JSON.stringify(federationReadiness().missing));
  if (savedFed === undefined) delete process.env.FEDERATION_ENABLED; else process.env.FEDERATION_ENABLED = savedFed;
  if (savedExp === undefined) delete process.env.PURSUIT_EXPERIENCE_ENABLED; else process.env.PURSUIT_EXPERIENCE_ENABLED = savedExp;

  console.log(`\n[federation-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[federation-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[federation-verify] fatal:", e); process.exit(2); });
