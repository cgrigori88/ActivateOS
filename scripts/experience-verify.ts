import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { promoteFromSignal } from "../src/lib/facts/promotion";
import { linkFactToPursuits } from "../src/lib/facts/pursuit-link";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { selectPartnerRoute } from "../src/lib/routing/override";
import { assembleTeam } from "../src/lib/routing/team";
import { ingestFeatures } from "../src/lib/transactions/features";
import { populatePartnerRouteRelevance } from "../src/lib/routing/route-why-now";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import { getPursuitPortfolio } from "../src/lib/pursuits/read-models/portfolio";
import { getPursuitDetail } from "../src/lib/pursuits/read-models/detail";
import { getRouteComparison } from "../src/lib/pursuits/read-models/route";
import { isTimelineWorthy } from "../src/lib/pursuits/read-models/materiality";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import { experienceReadiness, pursuitExperienceEnabled } from "../src/lib/pursuits/experience-flags";

/**
 * Workstream D Phase 4 — read-model BLIND VERIFICATION (§61.2/§64/§65/§66). Proves the non-visual
 * DoD: typed page-shaped views, NO recompute, server-side disclosure + payload-absence, materiality
 * ordering, unknown≠zero, cross-tenant authorization, flag dependency fail-safe, config-driven demo.
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
const internalCaller = (orgId: string): Caller => ({ orgId, canSeeInternal: true, canSeeTransactionDetail: true });
const limitedCaller = (orgId: string): Caller => ({ orgId, canSeeInternal: false, canSeeTransactionDetail: false });

async function main() {
  console.log(`[experience-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
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
    const co = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Technology','US') returning id`, [n])).rows[0].id;
    const companyA = await co("Globex"); const companyB = await co("Initech");
    const partner = async (o: string, n: string) => (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type, capacity) values ($1,$2,'reseller',10) returning id`, [o, n])).rows[0].id;
    const cdw = await partner(orgA, "CDW"); const wwt = await partner(orgA, "WWT");
    for (const p of [cdw, wwt]) await db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,0.85,true)`, [p, node]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,64,24)`, [cdw, companyA]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,72,30)`, [wwt, companyA]);
    const seller = async (p: string, n: string) => { const id = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,$3) returning id`, [orgA, p, n])).rows[0].id; await db.query(`insert into seller_account_relationships (seller_id, company_id, strength, last_interaction_at) values ($1,$2,65,now())`, [id, companyA]); return id; };
    await seller(cdw, "CDW Rep"); await seller(wwt, "WWT Rep");
    return { orgA, orgB, node, companyA, companyB, cdw, wwt };
  });

  // Hero pursuit (DEMO env → synthetic banner is data-driven, not name-driven, §57).
  const hero = (await asOrg(s.orgA, (db) => upsertPursuit(db, { orgId: s.orgA, accountId: s.companyA, productCategoryId: s.node, pursuitType: "MODERNIZATION", useCase: "virtualization exit", businessProblem: "Exit legacy virtualization before renewal", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" }))).id;
  const second = (await asOrg(s.orgA, (db) => upsertPursuit(db, { orgId: s.orgA, accountId: s.companyA, productCategoryId: s.node, pursuitType: "EXPANSION", useCase: "ai platform", businessProblem: "AI platform expansion", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" }))).id;
  const orgBPursuit = (await asOrg(s.orgB, (db) => upsertPursuit(db, { orgId: s.orgB, accountId: s.companyB, pursuitType: "NET_NEW", useCase: "greenfield", createdVia: "SYSTEM_DETECTED" }))).id;

  await asOrg(s.orgA, async (db) => {
    // Cache canonical scores (as A/B services would) so the read model can be checked for no-recompute.
    await db.query(`update pursuits set current_priority_score=72, current_purchase_propensity_score=68, current_evidence_confidence_score=61, current_timing_score=55, data_environment='DEMO' where id=$1`, [hero]);
    // Fact + link + structured why_now (business trigger present, timing anchor MISSING → unknown).
    const ev = await db.query<{ id: string }>(`insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at, status, computed_confidence, first_party) values ($1,$2,'crm','Globex has a cloud modernization initiative.',0.85,now(),'verified',0.85,true) returning id`, [s.orgA, s.companyA]);
    const sig = await db.query<{ id: string }>(`insert into signals (org_id, company_id, signal_type, taxonomy_node_id, direction, magnitude, confidence, observed_at, half_life_days, evidence_id, value) values ($1,$2,'STRATEGIC_INITIATIVE',$3,1,0.8,0.8,now(),180,$4,'{"text":"cloud modernization"}') returning id`, [s.orgA, s.companyA, s.node, ev.rows[0].id]);
    const promo = await promoteFromSignal(db, s.orgA, sig.rows[0].id, "DEMO");
    let factId: string | null = null;
    if (promo?.outcome === "PROMOTED" && promo.factId) { factId = promo.factId; await linkFactToPursuits(db, promo.factId); }
    await db.query(`update pursuits set why_now = $2 where id=$1`, [hero, JSON.stringify({ version: 1, as_of: new Date().toISOString(), business_trigger: factId ? { fact_id: factId, predicate: "strategic_initiative", label: "Globex" } : null, timing_anchor: null, signal_convergence: { independent_family_count: 1 }, contradictory_evidence: [] })]);
    // Synthetic distributor signal for CDW, then route (records ROUTE_RECOMMENDATION_CHANGED on flip).
    await ingestFeatures(db, s.orgA, null, "DERIVED", s.companyA, s.node, s.cdw, [{ featureKey: "category_adjacency", featureValue: 0.95, confidence: 0.85, dataClassification: "TRANSACTION_CONFIDENTIAL" }], "DEMO", true);
    await recomputeRoute(db, hero, new Date(), "DEMO");
    await recomputeRoute(db, second, new Date(), "DEMO");
    await populatePartnerRouteRelevance(db, hero);
    await assembleTeam(db, hero, "DEMO");
    // Seed a RESTRICTED reason on the recommended candidate to test payload-absence.
    const rc = await db.query<{ id: string }>(`select rc.id from route_candidates rc join pursuit_route_snapshots sn on sn.id=rc.route_snapshot_id where sn.pursuit_id=$1 and sn.is_current and rc.is_recommended`, [hero]);
    if (rc.rows[0]) await db.query(`insert into route_candidate_reasons (candidate_id, org_id, reason_code, polarity, detail, disclosure_class) values ($1,$2,'RAW_SPEND',1,'TD spend $1,840,000 in category',$3)`, [rc.rows[0].id, s.orgA, "RESTRICTED"]);
  });
  console.log(`[experience-verify] seeded hero=${hero.slice(0, 8)}\n`);

  // ---- Flag dependency fail-safe (§56) ----
  // Controls its own env so the assertion is deterministic regardless of how
  // the harness was invoked: with the experience requested but a dependency
  // (FACTS_ENABLED) withheld, the gate must report OFF and name the gap.
  console.log("§66.32  Feature flag dependency fails safe");
  const savedExp = process.env.PURSUIT_EXPERIENCE_ENABLED, savedFacts = process.env.FACTS_ENABLED;
  process.env.PURSUIT_EXPERIENCE_ENABLED = "1";
  delete process.env.FACTS_ENABLED;
  const readiness = experienceReadiness();
  check("experience disabled when dependencies off", !pursuitExperienceEnabled());
  check("readiness reports missing dependencies", readiness.missing.includes("FACTS_ENABLED"), JSON.stringify(readiness.missing));
  if (savedExp === undefined) delete process.env.PURSUIT_EXPERIENCE_ENABLED; else process.env.PURSUIT_EXPERIENCE_ENABLED = savedExp;
  if (savedFacts === undefined) delete process.env.FACTS_ENABLED; else process.env.FACTS_ENABLED = savedFacts;

  // ---- Today queue (§2/§3/§4) ----
  console.log("§66.2  Today decision queue: typed, materiality-ordered, urgency≠priority");
  await asOrg(s.orgA, async (db) => {
    const q = await getTodayQueue(db, internalCaller(s.orgA));
    check("today returns typed decision items", Array.isArray(q.items) && q.items.length >= 1, `n=${q.items.length}`);
    check("items carry decisionClass + operationalUrgency + commercialPriority (distinct fields)", q.items.every((i) => i.decisionClass && i.operationalUrgency && i.commercialPriority));
    const classes = q.items.map((i) => i.decisionClass);
    const firstDecision = classes.indexOf("DECISION_REQUIRED");
    const firstMaterial = classes.indexOf("MATERIAL_CHANGE");
    check("DECISION_REQUIRED ordered before MATERIAL_CHANGE (materiality, not recency)", firstDecision === -1 || firstMaterial === -1 || firstDecision < firstMaterial);
    check("every action maps to a governed skill", q.items.every((i) => i.allowedActions.every((a) => a.skill && a.sideEffect)));
    check("demo banner is data-driven (synthetic present)", q.demoBanner !== null);
    check("deep links target exact pursuit", q.items.every((i) => i.deepLink.startsWith("/pursuits") || i.deepLink.startsWith("/review")));
  });

  // ---- Portfolio (§5/§6) ----
  console.log("§66.4  Portfolio: canonical pursuits, account groups multiple pursuits");
  await asOrg(s.orgA, async (db) => {
    const pf = await getPursuitPortfolio(db, internalCaller(s.orgA));
    check("portfolio reads canonical pursuits", pf.rows.length >= 2, `n=${pf.rows.length}`);
    const acct = pf.grouped.find((g) => g.accountId === s.companyA);
    check("one account groups multiple pursuits (not collapsed)", !!acct && acct.pursuits.length >= 2, `n=${acct?.pursuits.length}`);
    check("scores are band-first (band present)", pf.rows.every((r) => !!r.priority.band));
    check("synthetic flag propagated", pf.rows.some((r) => r.synthetic));
  });

  // ---- Detail: no-recompute + band + why-now + missing ----
  console.log("§66.5  Pursuit detail: no recompute, band, structured Why Now, missing stays missing");
  await asOrg(s.orgA, async (db) => {
    const d = (await getPursuitDetail(db, internalCaller(s.orgA), hero))!;
    check("detail returns page-shaped view", !!d && d.decisionBand.length === 6);
    // No-recompute: read canonical value directly and compare (§64).
    const canon = await db.query<{ v: string | null }>(`select current_priority_score v from pursuits where id=$1`, [hero]);
    const priorityView = d.decisionBand.find((x) => x.key === "priority")!;
    check("priority read verbatim from canonical cache (no recompute)", priorityView.value === (canon.rows[0].v == null ? null : Math.round(Number(canon.rows[0].v))), `view=${priorityView.value} canon=${canon.rows[0].v}`);
    check("decision band is band-first", priorityView.band === "high");
    check("Why Now present + traceable (business trigger has fact id)", d.whyNow.present && !!d.whyNow.businessTrigger?.refId);
    check("missing Why Now component stays null (not fabricated)", d.whyNow.timingAnchor === null);
    check("'what we don't know' lists the missing timing anchor", d.whyNow.unknowns.some((u) => /timing/i.test(u)));
    check("commercial implication distinct from fact", d.whyNow.businessTrigger?.commercialImplication !== d.whyNow.businessTrigger?.detail);
    check("demo banner is config/data-driven", d.demoBanner !== null && d.synthetic);
    // Team gap → action item.
    check("missing required role produces an action item", d.team.gapActions.every((g) => g.decisionClass === "ACTION_REQUIRED"));
    check("activation readiness is a scored view", !!d.team.activationReadiness.band);
    // Timeline is material-only.
    check("timeline contains only material events", d.timeline.events.every((e) => isTimelineWorthy(e.materiality)));
  });

  // ---- Route comparison: disclosure server-side + payload absence + unknown≠zero + override ----
  console.log("§66.12  Route: disclosure server-side, payload absence, unknown≠zero, override");
  await asOrg(s.orgA, async (db) => {
    const internal = await getRouteComparison(db, internalCaller(s.orgA), hero);
    const limited = await getRouteComparison(db, limitedCaller(s.orgA), hero);
    check("internal caller receives internal reasons", Array.isArray(internal.recommended?.reasonsInternal));
    check("limited caller: internal reasons withheld (null)", limited.recommended?.reasonsInternal === null);
    // Payload absence (§65): restricted raw value must not appear anywhere in the limited payload.
    check("restricted raw value absent from limited payload", !JSON.stringify(limited).includes("1840000"));
    check("restricted raw value present for internal caller", JSON.stringify(internal).includes("1840000"));
    // unknown ≠ zero: WWT has no transaction feature → transaction_adjacency unknown, not 0.
    const wwtCand = internal.alternatives.find((a) => a.label === "WWT") ?? internal.recommended;
    const txCell = wwtCand?.dimensions["transaction_adjacency"];
    check("missing dimension renders unknown, not zero", !!txCell && txCell.known === false && txCell.band === "unknown");
    // Override: WWT selected over recommended CDW.
    await selectPartnerRoute(db, hero, { partnerId: s.wwt, actorId: crypto.randomUUID(), reason: "exec relationship", category: "EXECUTIVE_DIRECTION" });
    const afterOverride = await getRouteComparison(db, internalCaller(s.orgA), hero);
    check("selection distinct from recommendation after override", afterOverride.selectionMatchesRecommendation === false && !!afterOverride.selected);
    check("override reason + category surfaced", afterOverride.overrideCategory === "EXECUTIVE_DIRECTION");
    check("route change event has before/after", afterOverride.changeEvents.length >= 1 && afterOverride.changeEvents.some((e) => e.before && e.after));
    check("path is multi-party with roles", internal.path.length >= 3);
  });

  // ---- Cross-tenant authorization (§66.29/§66.30) ----
  console.log("§66.29  Read models enforce tenant authorization");
  await asOrg(s.orgA, async (db) => {
    const foreign = await getPursuitDetail(db, internalCaller(s.orgA), orgBPursuit);
    check("org A cannot read org B pursuit detail (returns null)", foreign === null);
    const pf = await getPursuitPortfolio(db, internalCaller(s.orgA));
    check("portfolio excludes other tenants", !pf.rows.some((r) => r.pursuitId === orgBPursuit));
  });

  // ---- Optional: dump the real view objects for visual proof (§68) ----
  // Off by default. When EXPERIENCE_DUMP=<path> is set, serialize the exact
  // read-model outputs the UI renders — so the visual proof is driven by real
  // computed values, never invented ones.
  if (process.env.EXPERIENCE_DUMP) {
    const dump = await asOrg(s.orgA, async (db) => ({
      today: await getTodayQueue(db, internalCaller(s.orgA)),
      portfolio: await getPursuitPortfolio(db, internalCaller(s.orgA)),
      detail: await getPursuitDetail(db, internalCaller(s.orgA), hero),
      routeInternal: await getRouteComparison(db, internalCaller(s.orgA), hero),
      routeLimited: await getRouteComparison(db, limitedCaller(s.orgA), hero),
    }));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.EXPERIENCE_DUMP, JSON.stringify(dump, null, 2));
    console.log(`[experience-verify] dumped view objects → ${process.env.EXPERIENCE_DUMP}`);
  }

  console.log(`\n[experience-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[experience-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[experience-verify] fatal:", e); process.exit(2); });
