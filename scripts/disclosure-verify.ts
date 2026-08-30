/**
 * Workstream E3-B blind harness — consent + disclosure.
 * Proves the disclosure policy engine resolves per viewer (exact / generalized /
 * aggregated / suppressed) with the exact value NEVER leaking to a non-authorized
 * viewer (R7 payload absence), the TD SYNNEX three-tier regression fixture, grant
 * lifecycle (grant→access, revoke/expire→no access, R28), and data-consent ≠
 * action-authority (R24). DB parts run as app_rw under RLS against pursuit_demo.
 *
 *   npx tsx scripts/disclosure-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { resolveDisclosure, applyDisclosure, type Disclosable, type FederationViewer } from "../src/lib/pursuits/federation/disclosure";
import { proposeGrant, acceptGrant, revokeGrant, expireDueGrants, hasLiveDataGrant, hasActionAuthority, buildFederationViewer } from "../src/lib/pursuits/federation/grants";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { upsertPursuit } from "../src/lib/pursuits/model";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }

// Viewer constructors for pure-engine tests.
const V = (orgId: string, o: Partial<FederationViewer> = {}): FederationViewer => ({ orgId, isSponsor: false, isParticipant: false, allowlistGrantedFor: new Set(), ...o });

async function main() {
  console.log(`[disclosure-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  // ---- Disclosure resolution matrix (pure engine, R6/R7) ----
  console.log("E3-B.1  Disclosure resolution matrix");
  const item = <T,>(audience: Disclosable<T>["audience"], value: T, extra: Partial<Disclosable<T>> = {}): Disclosable<T> => ({ ownerOrgId: "vendor", audience, value, ...extra });
  const sponsor = V("vendor", { isSponsor: true });
  const participant = V("dist", { isParticipant: true });
  const outsider = V("acme");
  check("sponsor sees EXACT regardless of audience", resolveDisclosure(item("ORG_PRIVATE", "x"), sponsor).visibility === "EXACT");
  check("PUBLIC → EXACT for everyone", resolveDisclosure(item("PUBLIC", "x"), outsider).visibility === "EXACT");
  check("PARTICIPANT_SHARED → EXACT for participant, downgraded for outsider",
    resolveDisclosure(item("PARTICIPANT_SHARED", "x"), participant).visibility === "EXACT" &&
    resolveDisclosure(item("PARTICIPANT_SHARED", "x"), outsider).visibility === "SUPPRESSED");
  check("PURSUIT_INTERNAL → generalized for participant when a substitute exists",
    resolveDisclosure(item("PURSUIT_INTERNAL", "exact", { generalized: "general" }), participant).visibility === "GENERALIZED");
  check("ORG_PRIVATE → SUPPRESSED for non-owner (existence hidden, T11)",
    resolveDisclosure(item("ORG_PRIVATE", "x"), participant).visibility === "SUPPRESSED");
  check("ORG_ALLOWLIST → EXACT only for a granted org",
    resolveDisclosure(item("ORG_ALLOWLIST", "x", { allowlistOrgs: ["dist"] }), participant).visibility === "EXACT" &&
    resolveDisclosure(item("ORG_ALLOWLIST", "x", { allowlistOrgs: ["dist"] }), outsider).visibility === "SUPPRESSED");
  check("AGGREGATED → aggregate value for a participant, never the exact",
    (() => { const r = resolveDisclosure(item("AGGREGATED", "exact", { aggregate: "~agg" }), participant); return r.visibility === "AGGREGATED" && r.value === "~agg"; })());
  check("outsider (no standing) is suppressed for all pursuit-scoped classes (T11)",
    ["PURSUIT_INTERNAL", "PARTICIPANT_SHARED", "AGGREGATED", "GENERALIZED", "ORG_ALLOWLIST"].every(
      (a) => resolveDisclosure(item(a as Disclosable<string>["audience"], "x", { generalized: "g", aggregate: "a" }), outsider).visibility === "SUPPRESSED"));

  // ---- TD SYNNEX three-tier regression fixture (R7 — permanent) ----
  console.log("E3-B.2  TD SYNNEX three-tier disclosure (permanent regression)");
  const tdItem: Disclosable<string> = { ownerOrgId: "vendor", audience: "PURSUIT_INTERNAL", sensitivity: "CONFIDENTIAL",
    value: "$1,840,000 recent category activity through TD SYNNEX",
    generalized: "Recent distributor/channel activity materially strengthens this route" };
  const rInternal = resolveDisclosure(tdItem, sponsor);
  const rPartner = resolveDisclosure(tdItem, participant);
  const rUnauth = resolveDisclosure(tdItem, outsider);
  check("internal caller receives the exact figure", rInternal.visibility === "EXACT" && String(rInternal.value).includes("1,840,000"));
  check("partner-safe caller receives generalized, NO figure", rPartner.visibility === "GENERALIZED" && !String(rPartner.value).includes("1,840,000"));
  check("unauthorized caller: item suppressed, value null", rUnauth.visibility === "SUPPRESSED" && rUnauth.value === null);
  // payload absence: serialize the participant + outsider results, exact must be absent
  check("exact figure absent from serialized partner/outsider payload",
    !JSON.stringify([rPartner, rUnauth]).includes("1,840,000"));
  // applyDisclosure omits the suppressed item entirely (existence hidden)
  check("applyDisclosure omits suppressed items (existence not leaked)",
    applyDisclosure([tdItem], outsider).length === 0 && applyDisclosure([tdItem], participant).length === 1);

  // ---- Grant lifecycle + data≠action (DB, R8/R24/R28) ----
  console.log("E3-B.3  Grant lifecycle + data-consent ≠ action-authority");
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3B Vendor"); const dist = await org("E3B Distributor");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3B ${RID}`, `e3b-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`E3B Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, dist, hero };
  });
  // vendor grants DATA to distributor for this pursuit
  const grantId = await asOrg(s.vendor, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.vendor, toOrgId: s.dist, grantKind: "DATA", informationClasses: ["PARTICIPANT_SHARED"], purpose: "Globex virtualization co-sell" }));
  check("no access before the grant is accepted", !(await asOrg(s.vendor, (db) => hasLiveDataGrant(db, s.dist, s.hero))));
  await asOrg(s.dist, (db) => acceptGrant(db, grantId));
  check("grant → access after accept", await asOrg(s.vendor, (db) => hasLiveDataGrant(db, s.dist, s.hero)));
  check("data consent does NOT confer action authority (R24)", !(await asOrg(s.vendor, (db) => hasActionAuthority(db, s.dist, s.hero, "route.request_acceptance"))));
  await asOrg(s.vendor, (db) => revokeGrant(db, grantId));
  check("revoke → future access blocked immediately (R28)", !(await asOrg(s.vendor, (db) => hasLiveDataGrant(db, s.dist, s.hero))));
  // expiry: a fresh grant with a past expiry, accepted, then swept
  const expId = await asOrg(s.vendor, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.vendor, toOrgId: s.dist, purpose: "temp", expiresAt: new Date(Date.now() - 1000) }));
  await asOrg(s.dist, (db) => acceptGrant(db, expId));
  check("expired grant does not confer access (grant_is_live checks expiry)", !(await asOrg(s.vendor, (db) => hasLiveDataGrant(db, s.dist, s.hero))));
  check("sweeper flips accepted-past-expiry to expired", (await asOrg(s.vendor, (db) => expireDueGrants(db))) >= 1);

  // ---- buildFederationViewer (R6 richer Caller) ----
  console.log("E3-B.4  Federation viewer construction");
  await asOrg(s.vendor, async (db) => {
    await addParticipant(db, { pursuitId: s.hero, orgId: s.vendor, roleKey: "VENDOR", sponsorOrgId: s.vendor, state: "ACTIVE" });
    await addParticipant(db, { pursuitId: s.hero, orgId: s.dist, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor });
  });
  await asOrg(s.dist, async (db) => {
    const { rows } = await db.query<{ id: string }>(`select id from pursuit_participants where pursuit_id=$1 and org_id=$2`, [s.hero, s.dist]);
    await acceptParticipation(db, rows[0].id);
  });
  const vv = await asOrg(s.vendor, (db) => buildFederationViewer(db, s.vendor, s.hero));
  const dv = await asOrg(s.dist, (db) => buildFederationViewer(db, s.dist, s.hero));
  check("viewer: sponsor flagged isSponsor", vv.isSponsor === true);
  check("viewer: active participant flagged isParticipant, not sponsor", dv.isParticipant === true && dv.isSponsor === false);

  console.log(`\n[disclosure-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[disclosure-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[disclosure-verify] fatal:", e); process.exit(2); });
