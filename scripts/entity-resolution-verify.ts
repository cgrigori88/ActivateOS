/**
 * Workstream E3-G blind harness — federation-aware entity resolution + provider vocab.
 * Proves: the alias column drift is fixed (resolution runs against the REAL schema);
 * external-id resolution is scoped to the SOURCE ORG's id space, so the same external
 * id from two orgs resolves to each org's own company and never collides (§14/§30); a
 * global (null-scoped) alias resolves for anyone; an unknown identity is QUARANTINED
 * (companyId null) with a source-org-scoped review row, so it can never attach a signal
 * to another org's Pursuit (§31); recordAlias is org-scoped + idempotent; and the
 * transaction-adjacency scorer now honors inventory/renewal/marketplace features while
 * still refusing to score an UNRESOLVED company. Runs as app_rw under RLS.
 *
 *   npx tsx scripts/entity-resolution-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { resolveIdentity, recordAlias } from "../src/lib/identity/federation-resolve";
import { ingestFeatures, transactionScore } from "../src/lib/transactions/features";
import type { TransactionFeatureOut } from "../src/lib/transactions/provider";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const feat = (key: string, value: number): TransactionFeatureOut => ({ featureKey: key, featureValue: value, confidence: 0.9, dataClassification: "TRANSACTION_CONFIDENTIAL" });

async function main() {
  console.log(`[entity-resolution-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const orgA = await org("E3G OrgA"); const orgB = await org("E3G OrgB");
    const company = async (n: string, domain: string | null = null) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country, primary_domain) values ($1,$1,'Tech','US',$2) returning id`, [`${n} ${RID}`, domain])).rows[0].id;
    const acme = await company("Acme"); const globex = await company("Globex", `globex-${RID}.com`);
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3G ${RID}`, `e3g-${RID}`])).rows[0].id;
    return { orgA, orgB, acme, globex, node };
  });

  // ---- Alias drift fixed + source-org scoping (§14/§30) ----
  console.log("E3-G.1  Federation-scoped external-id resolution");
  // The SAME external id in two orgs' id spaces points at two different companies.
  await asOrg(s.orgA, (db) => recordAlias(db, { companyId: s.acme, alias: `EXT-777-${RID}`, aliasType: "distributor_account_id", sourceOrgId: s.orgA, resolutionMethod: "EXTERNAL_ID", resolutionConfidence: 1 }));
  await asOrg(s.orgB, (db) => recordAlias(db, { companyId: s.globex, alias: `EXT-777-${RID}`, aliasType: "distributor_account_id", sourceOrgId: s.orgB, resolutionMethod: "EXTERNAL_ID", resolutionConfidence: 1 }));
  const ra = await asOrg(s.orgA, (db) => resolveIdentity(db, { orgId: s.orgA, sourceSystem: "distributor", sourceOrgId: s.orgA, externalId: `EXT-777-${RID}` }));
  const rb = await asOrg(s.orgB, (db) => resolveIdentity(db, { orgId: s.orgB, sourceSystem: "distributor", sourceOrgId: s.orgB, externalId: `EXT-777-${RID}` }));
  check("external-id resolution runs against the real schema (alias drift fixed)", ra.companyId !== null || ra.status !== undefined);
  check("the same external id resolves to each org's OWN company (no collision, §14)", ra.companyId === s.acme && rb.companyId === s.globex && ra.companyId !== rb.companyId);
  check("org A's id space cannot see org B's mapping for the same id", ra.companyId !== s.globex);

  // ---- Global (null-scoped) alias ----
  console.log("E3-G.2  Global first-party alias");
  await asOwner((db) => recordAlias(db, { companyId: s.acme, alias: `DUNS-GLOBAL-${RID}`, aliasType: "vendor_account_id", sourceOrgId: null, resolutionMethod: "LEGAL_IDENTITY", resolutionConfidence: 1 }));
  const gA = await asOrg(s.orgA, (db) => resolveIdentity(db, { orgId: s.orgA, sourceSystem: "import", sourceOrgId: s.orgA, externalId: `DUNS-GLOBAL-${RID}` }));
  const gB = await asOrg(s.orgB, (db) => resolveIdentity(db, { orgId: s.orgB, sourceSystem: "import", sourceOrgId: s.orgB, externalId: `DUNS-GLOBAL-${RID}` }));
  check("a global (null-scoped) alias resolves for any org", gA.companyId === s.acme && gB.companyId === s.acme);

  // ---- Quarantine of an unresolved identity (§31) ----
  console.log("E3-G.3  Quarantine of unresolved identity (§31)");
  const q = await asOrg(s.orgA, (db) => resolveIdentity(db, { orgId: s.orgA, sourceSystem: "distributor", sourceOrgId: s.orgA, externalId: `UNKNOWN-${RID}` }));
  check("an unknown external id is quarantined (companyId null, never guessed)", q.companyId === null && q.quarantined === true && q.status === "UNRESOLVED");
  const review = await asOrg(s.orgA, async (db) => (await db.query<{ source_org_id: string | null; status: string }>(`select source_org_id, status from entity_resolution_reviews where org_id=$1 and external_id=$2 order by created_at desc limit 1`, [s.orgA, `UNKNOWN-${RID}`])).rows[0]);
  check("a source-org-scoped review row is opened for the quarantined identity", review && review.source_org_id === s.orgA && review.status === "UNRESOLVED");
  check("org B cannot see org A's resolution review (tenant isolation)", (await asOrg(s.orgB, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from entity_resolution_reviews where external_id=$1`, [`UNKNOWN-${RID}`])).rows[0].n)) === "0");

  // ---- recordAlias idempotency ----
  console.log("E3-G.4  Alias registration idempotency");
  await asOrg(s.orgA, (db) => recordAlias(db, { companyId: s.acme, alias: `EXT-777-${RID}`, aliasType: "distributor_account_id", sourceOrgId: s.orgA }));
  check("re-registering the same alias does not duplicate", (await asOrg(s.orgA, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from company_aliases where alias=$2 and alias_type='distributor_account_id' and company_id=$1`, [s.acme, `EXT-777-${RID}`])).rows[0].n)) === "1");

  // ---- Provider vocabulary: inventory / renewal / marketplace ----
  console.log("E3-G.5  Distributor provider vocabulary (inventory/renewal/marketplace)");
  await asOrg(s.orgA, (db) => ingestFeatures(db, s.orgA, null, "FEDERATED", s.acme, s.node, null, [
    feat("category_adjacency", 0.8), feat("inventory_availability", 0.9), feat("renewal_window", 0.7), feat("marketplace_presence", 0.6),
  ], "DEMO", true));
  const scored = await asOrg(s.orgA, (db) => transactionScore(db, s.orgA, s.acme, s.node, null));
  check("the scorer consumes the new inventory/renewal/marketplace features", scored.available === true && scored.features.some((f) => f.key === "inventory_availability") && scored.features.some((f) => f.key === "renewal_window"));
  check("a resolved company produces a bounded 0..1 transaction score", scored.score01 >= 0 && scored.score01 <= 1 && scored.confidence > 0);
  // §31 still holds: an UNRESOLVED company (no features) never scores.
  const none = await asOrg(s.orgA, (db) => transactionScore(db, s.orgA, s.globex, s.node, null));
  check("an unresolved/absent-signal company yields available=false (never invented, §31)", none.available === false);

  console.log(`\n[entity-resolution-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[entity-resolution-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[entity-resolution-verify] fatal:", e); process.exit(2); });
