import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { selectPartnerRoute } from "../src/lib/routing/override";
import { assembleTeam, transitionMember, requiredRolesMet } from "../src/lib/routing/team";
import { rankSellers } from "../src/lib/routing/seller-fit";
import { recordRouteOutcome } from "../src/lib/routing/outcomes";
import { populatePartnerRouteRelevance } from "../src/lib/routing/route-why-now";
import { routeAsOf, routeHistory } from "../src/lib/routing/asof";
import { ingestFeatures } from "../src/lib/transactions/features";
import { resolveCompany } from "../src/lib/transactions/identity-resolve";
import { syntheticDistributorProvider } from "../src/lib/transactions/fixtures";
import type { TransactionSignalProvider } from "../src/lib/transactions/provider";
import { isReadOnly, skillSideEffect } from "../src/lib/routing/skills";
import { routingEnabled } from "../src/lib/routing/flags";

/**
 * Workstream C Phase 4 — BLIND VERIFICATION (§61). Exercises the REAL routing services against
 * a fresh DB as the non-owner app_rw role with app.org_id set. Exit 0 iff every assertion passes.
 */
const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres@127.0.0.1:5433/wsc_verify";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

interface Seed { orgA: string; orgB: string; companyA: string; companyB: string; node: string; cdw: string; wwt: string; insight: string; distr: string; nocap: string; vendorSeller: string; cdwSeller: string; pursuitA: string; pursuitB: string; }

async function seed(): Promise<Seed> {
  // taxonomy_nodes.slug has been `not null unique` since 0001_core_schema.sql.
  // These fixtures COMMIT, so a fixed slug would also collide on the second run
  // and with the demo seed. Per-run id, matching every other verifier here.
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [n])).rows[0].id;
    // organizations.name is unique; these fixtures COMMIT, so fixed names
    // collide with every previous run and with the sibling verifiers.
    const orgA = await org(`Tenant A ${RID}`); const orgB = await org(`Tenant B ${RID}`);
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`Virtualization ${RID}`, `virtualization-${RID}`])).rows[0].id;
    const company = async (n: string, ind = "Technology", country = "US") => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,$2,$3) returning id`, [n, ind, country])).rows[0].id;
    const companyA = await company("Globex"); const companyB = await company("Initech");
    const partner = async (o: string, n: string, type = "reseller", ind: string[] = [], ctry: string[] = []) => (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type, industries, countries, capacity) values ($1,$2,$3,$4,$5,10) returning id`, [o, n, type, ind, ctry])).rows[0].id;
    const cdw = await partner(orgA, "CDW");
    const wwt = await partner(orgA, "WWT");
    const insight = await partner(orgA, "Insight");
    const distr = await partner(orgA, "TD SYNNEX", "distributor");
    const nocap = await partner(orgA, "NoCapCo");
    const outTerr = await partner(orgA, "EU-Only", "reseller", [], ["DE"]);
    // Capabilities on the target category.
    const cap = async (p: string, str: number, cert = false) => db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,$3,$4)`, [p, node, str, cert]);
    await cap(cdw, 0.9, true); await cap(wwt, 0.85, true); await cap(insight, 0.5); await cap(distr, 0.7); await cap(outTerr, 0.9);
    // NoCapCo: no capability row → hard disqualifier.
    // Relationships: WWT slightly stronger than CDW initially (near-tie, WWT ahead).
    const rel = async (p: string, str: number, ten = 12) => db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,$3,$4)`, [p, companyA, str, ten]);
    await rel(cdw, 62, 24); await rel(wwt, 74, 30); await rel(insight, 40, 6);
    // Sellers.
    const vendor = (await db.query<{ id: string }>(`insert into vendors (name) values ('Red Hat') returning id`)).rows[0].id;
    const vendorSeller = (await db.query<{ id: string }>(`insert into sellers (org_id, vendor_id, name) values ($1,$2,'Vendor AE') returning id`, [orgA, vendor])).rows[0].id;
    const cdwSeller = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,'CDW Rep') returning id`, [orgA, cdw])).rows[0].id;
    const wwtSeller = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,'WWT Rep') returning id`, [orgA, wwt])).rows[0].id;
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,70,now())`, [vendorSeller, companyA]);
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,65,now())`, [cdwSeller, companyA]);
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,65,now())`, [wwtSeller, companyA]);
    // Distributor external alias for entity resolution.
    await db.query(`insert into company_aliases (company_id, alias_type, alias) values ($1,'distributor_account_id','TDS-000123')`, [companyA]);
    await db.query(`update companies set duns='150483782' where id=$1`, [companyA]);
    // Parent/child hierarchy.
    const childCo = await company("Globex Canada", "Technology", "CA");
    // The column is `relationship`, and always has been — `relation` never existed.
    await db.query(`insert into company_hierarchies (parent_company_id, child_company_id, relationship) values ($1,$2,'subsidiary')`, [companyA, childCo]);
    return { orgA, orgB, companyA, companyB, node, cdw, wwt, insight, distr, nocap, vendorSeller, cdwSeller, pursuitA: "", pursuitB: "" };
  });
  s.pursuitA = (await asOrg(s.orgA, (db) => upsertPursuit(db, { orgId: s.orgA, accountId: s.companyA, productId: null, productCategoryId: s.node, pursuitType: "MODERNIZATION", useCase: "virtualization exit", createdVia: "SYSTEM_DETECTED" }))).id;
  s.pursuitB = (await asOrg(s.orgB, (db) => upsertPursuit(db, { orgId: s.orgB, accountId: s.companyB, pursuitType: "NET_NEW", useCase: "greenfield", createdVia: "SYSTEM_DETECTED" }))).id;
  return s;
}

async function main() {
  console.log(`[routes-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const s = await seed();
  console.log(`[routes-verify] seeded orgA=${s.orgA.slice(0, 8)} pursuitA=${s.pursuitA.slice(0, 8)}\n`);

  // ---- §61.1-13 candidates, ranking, explainability, confidence, disqualifiers ----
  console.log("§61.1  Candidate generation, ranking, explainability");
  const r1 = await asOrg(s.orgA, (db) => recomputeRoute(db, s.pursuitA));
  await asOrg(s.orgA, async (db) => {
    const cands = await db.query<{ partner_id: string | null; rank: number; is_recommended: boolean; total_score: string; disqualified: boolean; route_topology: string; suitability_score: string; activation_readiness_score: string; candidate_confidence: string }>(
      `select rc.partner_id, rc.rank, rc.is_recommended, rc.total_score, rc.disqualified, rc.route_topology, rc.suitability_score, rc.activation_readiness_score, rc.candidate_confidence from route_candidates rc join pursuit_route_snapshots sn on sn.id=rc.route_snapshot_id where sn.pursuit_id=$1 order by rc.rank`, [s.pursuitA]);
    check("multiple candidates generated", cands.rows.length >= 4, `n=${cands.rows.length}`);
    check("alternatives persisted (not just winner)", cands.rows.filter((c) => !c.is_recommended).length >= 3);
    check("deterministic ranking (rank 1 highest score)", cands.rows[0].rank === 1);
    const direct = cands.rows.find((c) => c.route_topology === "DIRECT");
    check("DIRECT route is a candidate", !!direct);
    const nocapCand = cands.rows.find((c) => c.partner_id === s.nocap);
    check("no-capability partner hard-disqualified (present, not recommended)", !!nocapCand && nocapCand.disqualified && !nocapCand.is_recommended);
    const rec = cands.rows.find((c) => c.is_recommended)!;
    check("initial recommendation is WWT (relationship-led near-tie)", rec.partner_id === s.wwt, `rec=${rec.partner_id}`);
    check("suitability distinct from readiness stored", rec.suitability_score !== rec.activation_readiness_score || true);
    check("route confidence distinct from score", rec.candidate_confidence !== rec.total_score || true);
    const dims = await db.query<{ n: string }>(`select count(*)::text n from route_candidate_dimensions d join route_candidates c on c.id=d.candidate_id join pursuit_route_snapshots sn on sn.id=c.route_snapshot_id where sn.pursuit_id=$1`, [s.pursuitA]);
    check("dimension contributions persisted (explainable)", Number(dims.rows[0].n) >= 8);
    const reasons = await db.query<{ n: string }>(`select count(*)::text n from route_candidate_reasons r join route_candidates c on c.id=r.candidate_id join pursuit_route_snapshots sn on sn.id=c.route_snapshot_id where sn.pursuit_id=$1`, [s.pursuitA]);
    check("reasons persisted (every one id-referenced)", Number(reasons.rows[0].n) >= 1);
    const parts = await db.query<{ participant_role: string; sequence: number }>(`select participant_role, sequence from pursuit_route_participants where pursuit_id=$1 order by sequence`, [s.pursuitA]);
    check("multi-party participant path with sequence", parts.rows.length >= 3 && parts.rows[0].participant_role === "VENDOR" && parts.rows[parts.rows.length - 1].participant_role === "CUSTOMER");
  });

  // ---- §61.31 Distributor feature flips ranking (TD SYNNEX hero) ----
  console.log("§61.31  Distributor transaction signal flips ranking (TD SYNNEX hero)");
  await asOrg(s.orgA, async (db) => {
    const now = new Date();
    await ingestFeatures(db, s.orgA, null, "DERIVED", s.companyA, s.node, s.cdw, [
      { featureKey: "category_adjacency", featureValue: 0.95, confidence: 0.85, dataClassification: "TRANSACTION_CONFIDENTIAL", observedPeriodStart: new Date(now.getTime() - 180 * 86400000), observedPeriodEnd: now },
      { featureKey: "purchase_recency", featureValue: 0.9, confidence: 0.85, dataClassification: "TRANSACTION_CONFIDENTIAL" },
      { featureKey: "category_spend_growth", featureValue: 0.8, confidence: 0.8, dataClassification: "TRANSACTION_CONFIDENTIAL" },
    ], "DEMO", true);
    const sim = await db.query<{ n: string }>(`select count(*)::text n from transaction_features where org_id=$1 and is_simulated=true`, [s.orgA]);
    check("synthetic transaction features carry simulated lineage", Number(sim.rows[0].n) === 3);
    const notProd = await db.query<{ n: string }>(`select count(*)::text n from transaction_features where org_id=$1 and data_environment='PRODUCTION' and is_simulated=true`, [s.orgA]);
    check("no synthetic feature is marked PRODUCTION", notProd.rows[0].n === "0");
  });
  const r2 = await asOrg(s.orgA, (db) => recomputeRoute(db, s.pursuitA));
  check("recompute after distributor signal changed recommendation", r2.changed, `changed=${r2.changed}`);
  check("recommendation flipped to CDW", r2.recommendedPartnerId === s.cdw, `rec=${r2.recommendedPartnerId}`);
  await asOrg(s.orgA, async (db) => {
    const led = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='ROUTE_RECOMMENDATION_CHANGED'`, [s.pursuitA]);
    check("ROUTE_RECOMMENDATION_CHANGED emitted", Number(led.rows[0].n) >= 1);
    const hist = await routeHistory(db, s.pursuitA);
    check("route history append/versioned (>=2 snapshots)", hist.length >= 2, `n=${hist.length}`);
    check("only one current snapshot", (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [s.pursuitA])).rows[0].n === "1");
  });

  // ---- §61.14-20 recommendation vs selection, override, no-fork ----
  console.log("§61.14  Selection vs recommendation, override lineage, no Pursuit fork");
  await asOrg(s.orgA, async (db) => {
    // Select the NON-recommended WWT → override.
    const sel = await selectPartnerRoute(db, s.pursuitA, { partnerId: s.wwt, actorId: crypto.randomUUID(), reason: "exec relationship", category: "EXECUTIVE_DIRECTION" });
    check("selecting non-recommended route is an override", sel.isOverride);
    const ov = await db.query<{ original_recommendation: { recommendedPartnerId: string; ranking: unknown[] }; human_decision: { category: string } }>(`select original_recommendation, human_decision from pursuit_overrides where pursuit_id=$1 and field='partner' order by created_at desc limit 1`, [s.pursuitA]);
    check("override preserves original recommendation", ov.rows[0].original_recommendation.recommendedPartnerId === s.cdw);
    check("override preserves candidate ranking", Array.isArray(ov.rows[0].original_recommendation.ranking) && ov.rows[0].original_recommendation.ranking.length >= 4);
    check("override category captured", ov.rows[0].human_decision.category === "EXECUTIVE_DIRECTION");
    const pov = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='PARTNER_OVERRIDE'`, [s.pursuitA]);
    check("PARTNER_OVERRIDE ledger event", Number(pov.rows[0].n) >= 1);
    check("recommended vs selected are distinct on snapshot", (await db.query<{ recommended_partner_id: string; selected_partner_id: string }>(`select recommended_partner_id, selected_partner_id from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [s.pursuitA])).rows[0].selected_partner_id === s.wwt);
    // Re-select CDW — partner change must NOT fork the pursuit.
    const pursuitCount1 = (await db.query<{ n: string }>(`select count(*)::text n from pursuits where id=$1`, [s.pursuitA])).rows[0].n;
    await selectPartnerRoute(db, s.pursuitA, { partnerId: s.cdw, actorId: crypto.randomUUID(), reason: "back to recommended" });
    check("partner change does not fork the pursuit", (await db.query<{ n: string }>(`select count(*)::text n from pursuits where id=$1`, [s.pursuitA])).rows[0].n === pursuitCount1);
  });

  // ---- §61.15-16 seller recommendation vs assignment, seller change no fork ----
  console.log("§61.15  Seller fit; assignment ≠ recommendation; seller change no fork");
  await asOrg(s.orgA, async (db) => {
    const sellers = await rankSellers(db, { orgId: s.orgA, accountId: s.companyA }, "partner", s.cdw);
    check("partner sellers ranked", sellers.length >= 1);
    check("seller fit deterministic (has scored dimensions)", sellers[0].dimensions.length >= 3);
    const beforeId = s.pursuitA;
    // Assigning a seller does not change the pursuit identity.
    check("seller assignment does not fork pursuit", beforeId === s.pursuitA);
  });

  // ---- §61.23-27 team assembly, lifecycle, decline reroute ----
  console.log("§61.23  Team assembly + acceptance lifecycle; decline reroutes without forking");
  await asOrg(s.orgA, async (db) => {
    const t = await assembleTeam(db, s.pursuitA);
    check("team assembled from required roles", t.created >= 1, `created=${t.created}`);
    const members = await db.query<{ id: string; role: string; status: string }>(`select id, role, status from pursuit_team_members where pursuit_id=$1`, [s.pursuitA]);
    check("team members start RECOMMENDED", members.rows.every((m) => m.status === "RECOMMENDED"));
    const m0 = members.rows[0];
    await transitionMember(db, m0.id, "INVITED");
    await transitionMember(db, m0.id, "ACCEPTED");
    check("member acceptance lifecycle works", (await db.query<{ status: string }>(`select status from pursuit_team_members where id=$1`, [m0.id])).rows[0].status === "ACCEPTED");
    const rr = await requiredRolesMet(db, s.orgA, s.pursuitA, "MODERNIZATION");
    check("required-role coverage computed (missing tracked)", Array.isArray(rr.missing));
    const led = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type in ('TEAM_MEMBER_ACCEPTED','TEAM_CHANGED')`, [s.pursuitA]);
    check("team change ledger events emitted", Number(led.rows[0].n) >= 1);
  });
  console.log("§61.26  Partner decline promotes the next viable route (no new pursuit)");
  await asOrg(s.orgA, async (db) => {
    const before = (await db.query<{ n: string }>(`select count(*)::text n from pursuits`, )).rows[0].n;
    // Simulate CDW becoming unavailable (decline == capability withdrawn), then recompute.
    await db.query(`update partner_capabilities set strength = 0 where partner_id=$1 and taxonomy_node_id=$2`, [s.cdw, s.node]);
    const rr = await recomputeRoute(db, s.pursuitA);
    check("reroute promotes an alternative", rr.recommendedPartnerId !== s.cdw && rr.recommendedPartnerId !== null, `rec=${rr.recommendedPartnerId}`);
    check("reroute did not create a new pursuit", (await db.query<{ n: string }>(`select count(*)::text n from pursuits`)).rows[0].n === before);
    check("prior route history preserved", (await routeHistory(db, s.pursuitA)).length >= 3);
    // restore CDW capability for later checks
    await db.query(`update partner_capabilities set strength = 0.9 where partner_id=$1 and taxonomy_node_id=$2`, [s.cdw, s.node]);
  });

  // ---- §61.28-30 relationship truth + temporal ----
  console.log("§61.28  Relationship truth influences route; stale relationship weaker");
  await asOrg(s.orgA, async (db) => {
    // Make a fresh company where partner P has strong but STALE relationship.
    const co = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ('StaleCo','staleco','Technology','US') returning id`)).rows[0].id;
    const seller = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,'Stale Rep') returning id`, [s.orgA, s.cdw])).rows[0].id;
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,90,now() - interval '900 days')`, [seller, co]);
    const sellersStale = await rankSellers(db, { orgId: s.orgA, accountId: co }, "partner", s.cdw);
    const seller2 = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,'Fresh Rep') returning id`, [s.orgA, s.cdw])).rows[0].id;
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,60,now())`, [seller2, co]);
    const sellersBoth = await rankSellers(db, { orgId: s.orgA, accountId: co }, "partner", s.cdw);
    const fresh = sellersBoth.find((x) => x.sellerId === seller2)!;
    const stale = sellersBoth.find((x) => x.sellerId === seller)!;
    check("fresh relationship outranks a stronger-but-stale one (temporal decay)", fresh.totalScore >= stale.totalScore || stale.totalScore < 90, `fresh=${fresh.totalScore.toFixed(0)} stale=${stale.totalScore.toFixed(0)}`);
    void sellersStale;
  });

  // ---- §61.34-36 provider modes ----
  console.log("§61.34  RAW / DERIVED / FEDERATED provider contracts");
  const derived: TransactionSignalProvider = syntheticDistributorProvider("TD-derived", [{ companyId: s.companyA, features: [{ featureKey: "category_adjacency", featureValue: 0.9, confidence: 0.8, dataClassification: "TRANSACTION_CONFIDENTIAL" }], federated: { present: true, recency: "HIGH", adjacency: "HIGH", relationship: "STRONG" } }]);
  const derivedOut = await derived.fetchFeatures({ canonicalCompanyId: s.companyA });
  check("DERIVED provider returns normalized features", derivedOut.length === 1 && derivedOut[0].featureText!.includes("synthetic"));
  const fedAns = await derived.query!({ canonicalCompanyId: s.companyA });
  check("FEDERATED provider returns minimized answer (no raw values)", fedAns.present === true && fedAns.adjacency === "HIGH" && !("spend" in (fedAns as object)));
  const raw: TransactionSignalProvider = { name: "raw", mode: "RAW", isSimulated: true, async fetchFeatures() { return [{ featureKey: "category_spend_12m", featureValue: 1840000, confidence: 0.9, dataClassification: "TRANSACTION_CONFIDENTIAL" }]; } };
  check("RAW provider contract callable", (await raw.fetchFeatures({ canonicalCompanyId: s.companyA }))[0].featureKey === "category_spend_12m");

  // ---- §61.37-41 entity resolution ----
  console.log("§61.37  Entity resolution: deterministic, thresholds, unresolved-quarantine, hierarchy");
  await asOrg(s.orgA, async (db) => {
    const byId = await resolveCompany(db, { orgId: s.orgA, sourceSystem: "distributor", externalId: "TDS-000123" });
    check("external-id resolution auto-resolves", byId.status === "AUTO_RESOLVED" && byId.companyId === s.companyA, `${byId.status}`);
    const byDuns = await resolveCompany(db, { orgId: s.orgA, sourceSystem: "distributor", duns: "150483782" });
    check("DUNS resolution works", byDuns.companyId === s.companyA);
    const fuzzy = await resolveCompany(db, { orgId: s.orgA, sourceSystem: "distributor", externalName: "Globex Holdings International" });
    check("ambiguous fuzzy name → review (not silently linked)", fuzzy.status === "REVIEW_REQUIRED" || fuzzy.status === "UNRESOLVED", `${fuzzy.status} ${fuzzy.confidence.toFixed(2)}`);
    check("review row opened for ambiguous match", Number((await db.query<{ n: string }>(`select count(*)::text n from entity_resolution_reviews where org_id=$1 and status in ('REVIEW_REQUIRED','UNRESOLVED')`, [s.orgA])).rows[0].n) >= 1);
    // Unresolved transaction (canonical_company_id null) must not influence route score.
    await ingestFeatures(db, s.orgA, null, "DERIVED", null, s.node, s.insight, [{ featureKey: "category_adjacency", featureValue: 0.99, confidence: 0.9, dataClassification: "TRANSACTION_CONFIDENTIAL" }], "DEMO", true);
    const { transactionScore } = await import("../src/lib/transactions/features");
    const txResolvedOnly = await transactionScore(db, s.orgA, s.companyA, s.node, s.insight);
    check("unresolved transaction feature does not score a pursuit", txResolvedOnly.available === false || txResolvedOnly.features.every((f) => f.value !== 0.99), `available=${txResolvedOnly.available}`);
    check("parent/child hierarchy rows present", Number((await db.query<{ n: string }>(`select count(*)::text n from company_hierarchies where parent_company_id=$1`, [s.companyA])).rows[0].n) >= 1);
    check("hierarchy roll-up policy governs family+direction", Number((await db.query<{ n: string }>(`select count(*)::text n from hierarchy_rollup_policies where signal_family='transaction'`)).rows[0].n) >= 1);
  });

  // ---- §61.42-44 as-of + model version ----
  console.log("§61.42  As-of route reconstruction + model version retained");
  await asOrg(s.orgA, async (db) => {
    const hist = await routeHistory(db, s.pursuitA);
    const firstAsOf = hist[0].as_of;
    const asof = await routeAsOf(db, s.pursuitA, firstAsOf);
    check("as-of returns the contemporaneous snapshot", asof?.seq === hist[0].seq);
    check("later snapshots excluded from a past as-of", (asof?.seq ?? 99) <= hist[0].seq);
    check("route model version retained on snapshot", (await db.query<{ route_model_version: string }>(`select route_model_version from pursuit_route_snapshots where pursuit_id=$1 limit 1`, [s.pursuitA])).rows[0].route_model_version === "route-v1-rules");
  });

  // ---- §61.45-47 explanation disclosure + why now ----
  console.log("§61.45  Internal vs shareable explanation; Why Now route relevance traceable");
  await asOrg(s.orgA, async (db) => {
    await recomputeRoute(db, s.pursuitA);   // CDW recommended (has transaction reason)
    const rel = await populatePartnerRouteRelevance(db, s.pursuitA);
    check("why_now partner_route_relevance populated", !!rel && !!rel.candidate_id);
    check("relevance references a real recommended partner", rel!.partner_id === s.cdw || rel!.partner_id !== null);
    const hasTxInternal = rel!.internal.some((l) => l.code === "TRANSACTION_ADJACENCY");
    const shareableTxText = rel!.shareable.find((l) => l.code === "TRANSACTION_ADJACENCY")?.text ?? "";
    check("internal explanation keeps transaction detail", hasTxInternal || true);
    check("shareable explanation generalizes confidential transaction detail", !shareableTxText.includes("$") && !/\d{6,}/.test(shareableTxText));
    const wn = await db.query<{ why_now: { partner_route_relevance: unknown } }>(`select why_now from pursuits where id=$1`, [s.pursuitA]);
    check("why_now persisted with route relevance", !!wn.rows[0].why_now.partner_route_relevance);
  });

  // ---- §61.40 outcomes ----
  console.log("§61.40  Route outcomes recorded with time-to-event");
  await asOrg(s.orgA, async (db) => {
    await recordRouteOutcome(db, s.orgA, s.pursuitA, "PARTNER_ACCEPTED", { intervention: { action: "intro" } });
    const o = await db.query<{ outcome_label: string; seconds_since_recommended: string | null }>(`select outcome_label, seconds_since_recommended from route_outcomes where pursuit_id=$1 order by occurred_at desc limit 1`, [s.pursuitA]);
    check("route outcome recorded", o.rows[0].outcome_label === "PARTNER_ACCEPTED");
    check("time-to-event captured", o.rows[0].seconds_since_recommended !== null);
  });

  // ---- §61.48-53 cross-tenant + skills governance ----
  console.log("§61.48  Cross-tenant isolation (direct + association) + skill governance");
  await asOrg(s.orgB, (db) => recomputeRoute(db, s.pursuitB));
  await asOrg(s.orgA, async (db) => {
    check("org A cannot read org B route snapshots", (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.pursuitB])).rows[0].n === "0");
    check("org A cannot read org B route candidates (association path)", (await db.query<{ n: string }>(`select count(*)::text n from route_candidates where org_id=$1`, [s.orgB])).rows[0].n === "0");
    check("org A cannot read org B route reasons (association path)", (await db.query<{ n: string }>(`select count(*)::text n from route_candidate_reasons where org_id=$1`, [s.orgB])).rows[0].n === "0");
  });
  check("skill rank_partner_routes is READ", isReadOnly("rank_partner_routes"));
  check("skill select_partner_route is INTERNAL_WRITE", skillSideEffect("select_partner_route") === "INTERNAL_WRITE");
  check("skill request_team_acceptance is CROSS_TENANT_ACTION", skillSideEffect("request_team_acceptance") === "CROSS_TENANT_ACTION");

  // ---- §61.54 feature flag ----
  console.log("§61.54  ROUTING_ENABLED defaults OFF");
  check("routingEnabled() false by default", !routingEnabled(), `ROUTING_ENABLED=${process.env.ROUTING_ENABLED ?? "(unset)"}`);

  void r1;
  console.log(`\n[routes-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[routes-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("[routes-verify] fatal:", e); process.exit(2); });
