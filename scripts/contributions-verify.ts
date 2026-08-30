/**
 * Workstream E3-C blind harness — Context Contributions.
 * Proves: the durable provenance object (R4), provenance-retained /
 * disclosure-controlled (R3 — source_org_id always known; value disclosure is
 * separate), no-central-custody for FEDERATED/ASSERTED/AGGREGATED (R5),
 * revocation stops future USE while history is preserved (R28), fact→contribution
 * provenance boundary, the 5-mode vocabulary, and cross-tenant write refusal.
 *
 *   npx tsx scripts/contributions-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { recordContribution, revokeContribution, contributionsForPursuit, liveContributionsForPursuit, linkFactToContribution, impliesRawCustody } from "../src/lib/pursuits/federation/contributions";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { buildFederationViewer, allowlistKeysFor } from "../src/lib/pursuits/federation/grants";
import { resolveDisclosure, type Disclosable } from "../src/lib/pursuits/federation/disclosure";
import { upsertPursuit } from "../src/lib/pursuits/model";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function expectThrows(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

async function main() {
  console.log(`[contributions-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("E3C Vendor"); const dist = await org("E3C Distributor"); const outsider = await org("E3C Outsider");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`E3C ${RID}`, `e3c-${RID}`])).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`E3C Co ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: acct, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "x", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    return { vendor, dist, outsider, hero, acct };
  });
  // distributor becomes an ACTIVE participant (so it can see the pursuit's contributions)
  await asOrg(s.vendor, async (db) => {
    await addParticipant(db, { pursuitId: s.hero, orgId: s.vendor, roleKey: "VENDOR", sponsorOrgId: s.vendor, state: "ACTIVE" });
    await addParticipant(db, { pursuitId: s.hero, orgId: s.dist, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor });
  });
  await asOrg(s.dist, async (db) => { const { rows } = await db.query<{ id: string }>(`select id from pursuit_participants where pursuit_id=$1 and org_id=$2`, [s.hero, s.dist]); await acceptParticipation(db, rows[0].id); });

  // ---- No-central-custody defaults per mode (R5) ----
  console.log("E3-C.1  Contribution modes + no-central-custody (R5)");
  check("RAW implies central custody; FEDERATED/ASSERTED/AGGREGATED do not", impliesRawCustody("RAW") && !impliesRawCustody("FEDERATED") && !impliesRawCustody("ASSERTED") && !impliesRawCustody("AGGREGATED"));
  // Distributor contributes a FEDERATED signal — the raw rows stay on its side.
  const fedId = await asOrg(s.dist, (db) => recordContribution(db, {
    pursuitId: s.hero, sourceOrgId: s.dist, mode: "FEDERATED", dataCategory: "transaction_adjacency",
    semanticMeaning: "Recent distributor transaction adjacency strongly supports CDW",
    disclosureClass: "PARTICIPANT_SHARED", sensitivityClass: "CONFIDENTIAL", purpose: "Globex co-sell", isSimulated: true,
  }));
  const fed = await asOrg(s.vendor, (db) => contributionsForPursuit(db, s.hero));
  const fedRow = fed.find((c) => c.contributionId === fedId)!;
  check("FEDERATED contribution recorded with raw_stored=false / derived_only=true", fedRow.rawStored === false && fedRow.derivedOnly === true);
  check("provenance retained: contribution knows its source org", fedRow.sourceOrgId === s.dist);
  // RAW contribution keeps raw
  const rawId = await asOrg(s.vendor, (db) => recordContribution(db, { pursuitId: s.hero, sourceOrgId: s.vendor, mode: "RAW", semanticMeaning: "first-party CRM", purpose: "x" }));
  check("RAW contribution stores raw", (await asOrg(s.vendor, (db) => contributionsForPursuit(db, s.hero))).find((c) => c.contributionId === rawId)!.rawStored === true);
  check("all 5 contribution modes accepted", (await asOrg(s.vendor, async (db) => {
    for (const m of ["DERIVED", "ASSERTED", "AGGREGATED"] as const) await recordContribution(db, { pursuitId: s.hero, sourceOrgId: s.vendor, mode: m, purpose: "x" });
    return true;
  })));

  // ---- Provenance retained / disclosure controlled (R3) ----
  console.log("E3-C.2  Provenance retained, disclosure controlled (R3)");
  // The contribution ROW (provenance) is visible to the participant via can_see_pursuit,
  // but the VALUE disclosure is governed separately by the E3-B engine.
  const distSees = await asOrg(s.dist, (db) => contributionsForPursuit(db, s.hero));
  check("active participant can see the contribution edge (provenance)", distSees.some((c) => c.contributionId === fedId));
  const distViewer = await asOrg(s.dist, (db) => buildFederationViewer(db, s.dist, s.hero));
  const item: Disclosable<string> = { ownerOrgId: s.dist, audience: "PARTICIPANT_SHARED", value: fedRow.semanticMeaning ?? "" };
  check("value disclosure is governed independently of row visibility", resolveDisclosure(item, distViewer).visibility === "EXACT");
  // outsider cannot even see the contribution row
  check("non-participant outsider sees no contributions", (await asOrg(s.outsider, (db) => contributionsForPursuit(db, s.hero))).length === 0);

  // ---- Revocation stops future USE, preserves history (R28) ----
  console.log("E3-C.3  Revocation (R28)");
  await asOrg(s.dist, (db) => revokeContribution(db, fedId));
  const liveAfter = await asOrg(s.vendor, (db) => liveContributionsForPursuit(db, s.hero));
  const allAfter = await asOrg(s.vendor, (db) => contributionsForPursuit(db, s.hero));
  check("revoked contribution excluded from the live (usable) set", !liveAfter.some((c) => c.contributionId === fedId));
  check("revoked contribution history preserved (still listed, state REVOKED)", allAfter.find((c) => c.contributionId === fedId)?.revocationState === "REVOKED");

  // ---- Fact ← Contribution provenance boundary (R4) ----
  console.log("E3-C.4  Fact provenance boundary");
  await asOrg(s.vendor, async (db) => {
    const f = await db.query<{ id: string }>(
      `insert into facts (org_id, subject_scope, subject_label, predicate_key, object_type, object_value, company_id,
         status, confidence, provenance_class, origin_kind, as_of, observed_at, observed_first_at, observed_last_at,
         fact_identity_key, fact_value_key)
       values ($1,'COMPANY','E3C Co','strategic_initiative','STRING','"x"'::jsonb,$2,'CURRENT',0.8,'THIRD_PARTY_VERIFIED',
         'HUMAN', now(), now(), now(), now(), $3, $4) returning id`,
      [s.vendor, s.acct, `e3c-${RID}-slot`, `e3c-${RID}-val`]);
    await linkFactToContribution(db, f.rows[0].id, rawId, s.vendor);
    const bound = await db.query<{ contribution_id: string | null; source_org_id: string | null }>(`select contribution_id, source_org_id from facts where id=$1`, [f.rows[0].id]);
    check("fact bound to its originating contribution + source org", bound.rows[0].contribution_id === rawId && bound.rows[0].source_org_id === s.vendor);
  });

  // ---- Cross-tenant write refusal ----
  console.log("E3-C.5  Cross-tenant write refusal");
  check("an org cannot record a contribution claiming another org as source", await expectThrows(() =>
    asOrg(s.outsider, (db) => recordContribution(db, { pursuitId: s.hero, sourceOrgId: s.vendor, mode: "ASSERTED", purpose: "x" }))));

  await asOrg(s.vendor, (db) => allowlistKeysFor(db, s.dist, s.hero)); // smoke: grant integration path

  console.log(`\n[contributions-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[contributions-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[contributions-verify] fatal:", e); process.exit(2); });
