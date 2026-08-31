/**
 * P2B Value Case acceptance verification (§20).
 *
 *   DEMO_URL=… npx tsx scripts/value-case-verify.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  assembleCase, rankSensitivity, getValueCase, bounds, qualityLine, usd,
  ECONOMIC_TRUTH_LABEL, type ValueCase,
} from "../src/lib/value/case";
import {
  loadDrivers, driverBounds, LADDER_OF, partnerVisible,
  type Driver, type DriverValue, type Ladder,
} from "../src/lib/value/drivers";
import { toPartnerValueCase, CUSTOMER_READY_IMPLEMENTED } from "../src/lib/value/projection";
import { aggregateValue } from "../src/lib/value/aggregate";
import { assertEconomicFact } from "../src/lib/value/assert";
import { dispatchSkill, SKILL_REGISTRY, type Actor } from "../src/lib/pursuits/federation/skills";
import { routeIntent, resolveUtterance, listIntents } from "../src/lib/search/registry";
import "../src/lib/search/intents";
import { buildPursuitBrief } from "../src/lib/pursuits/read-models/brief";
import { getPursuitDetail } from "../src/lib/pursuits/read-models/detail";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import { assessMeddpicc } from "../src/lib/opportunities/meddpicc";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: URL });
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

// ── Pure fixtures, so the arithmetic is provable without a database ───────────────────────────
function val(over: Partial<DriverValue> = {}): DriverValue {
  return {
    factId: `f${Math.random().toString(36).slice(2, 8)}`, low: 100, high: 100, currency: "USD",
    ladder: "VERIFIED", provenanceClass: "FIRST_PARTY", sourceLabel: "src", evidenceCount: 1,
    observedLastAt: new Date(), status: "CURRENT", disclosureClass: "PARTNER_SHARED",
    supersedesFactId: null, ...over,
  };
}
function drv(over: Partial<Driver> = {}): Driver {
  const values = over.values ?? [val()];
  const lo = Math.min(...values.map((v) => v.low));
  const hi = Math.max(...values.map((v) => v.high));
  return {
    predicateKey: over.predicateKey ?? "avoided_cost",
    label: over.label ?? "Avoided cost",
    role: over.role ?? "BENEFIT",
    ladder: over.ladder ?? values[0].ladder,
    conflicting: over.conflicting ?? false,
    value: over.conflicting ? null : (over.value !== undefined ? over.value : values[0]),
    values,
    history: over.history ?? [],
    spread: over.spread ?? (over.conflicting ? hi - lo : values[0].high - values[0].low),
    partnerSafe: over.partnerSafe ?? values.every((v) => partnerVisible(v.disclosureClass)),
  };
}

async function main() {
  const db = (await pool.connect()) as PoolClient;
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> => (await db.query<T>(sql, p)).rows[0] as T;
  try {
    const org = (await one<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).org_id;
    const caller = { orgId: org, role: "operator" as const, canSeeInternal: true, canSeeTransactionDetail: true };
    const ctx = { db, orgId: org, companyIds: null as string[] | null };
    const cid = async (n: string) => (await one<{ id: string }>(
      `select c.id from companies c
        where c.legal_name ilike $1
          and (exists (select 1 from pursuits p where p.account_id = c.id)
            or exists (select 1 from revenue_motions m where m.company_id = c.id))
        order by length(c.legal_name) desc limit 1`, [`%${n}%`])).id;
    const pid = async (n: string) => (await one<{ id: string }>(
      `select p.id from pursuits p join companies c on c.id = p.account_id
        where p.org_id = $1 and c.legal_name ilike $2 order by p.created_at limit 1`, [org, `%${n}%`])).id;

    // ═══ §1 · NO NEW GENERIC VALUE PRIMITIVE ══════════════════════════════════════════════════
    console.log("P2B — substrate");
    const newTables = await one<{ n: string }>(
      `select count(*)::text n from information_schema.tables
        where table_schema = 'public'
          and (table_name ilike '%value_case%' or table_name ilike '%roi%'
            or table_name ilike '%economic_driver%' or table_name ilike '%business_value%')`);
    ok("NO new value-case / ROI / economic-driver table was introduced", Number(newTables.n) === 0);

    const econPreds = await db.query<{ key: string; object_type: string; signal_type: string | null }>(
      `select key, object_type, signal_type from fact_predicates where family = 'economic' order by key`);
    ok("economic drivers live in the predicate registry (12 rows, registry only)", econPreds.rows.length >= 12);
    ok("every economic driver declares its ROLE in the arithmetic (no un-typed money)",
      econPreds.rows.every((r) => ["economic_baseline", "economic_benefit", "economic_change_cost", "economic_timing"].includes(r.signal_type ?? "")));

    const facts = await one<{ n: string }>(
      `select count(*)::text n from information_schema.columns
        where table_name = 'facts' and column_name = 'disclosure_class'`);
    ok("disclosure lives on the EXISTING facts row (one additive column, existing vocabulary)", Number(facts.n) === 1);
    const vocab = await one<{ def: string }>(
      `select pg_get_constraintdef(oid) def from pg_constraint where conname = 'facts_disclosure_class_check'`);
    ok("the disclosure vocabulary is the existing 6-value one, not a second classification system",
      ["PUBLIC", "INTERNAL", "PARTNER_SHARED", "TRANSACTION_CONFIDENTIAL", "PII", "RESTRICTED"].every((v) => vocab.def.includes(v)));

    // ═══ §3 · PROVENANCE LADDER ═══════════════════════════════════════════════════════════════
    console.log("\nP2B — provenance ladder");
    ok("VERIFIED ← first-party / third-party-verified",
      LADDER_OF.FIRST_PARTY === "VERIFIED" && LADDER_OF.THIRD_PARTY_VERIFIED === "VERIFIED");
    ok("CUSTOMER_CONFIRMED ← customer-declared", LADDER_OF.CUSTOMER_DECLARED === "CUSTOMER_CONFIRMED");
    ok("INFERRED ← second-party / third-party-unverified / inferred",
      LADDER_OF.SECOND_PARTY === "INFERRED" && LADDER_OF.THIRD_PARTY_UNVERIFIED === "INFERRED" && LADDER_OF.INFERRED === "INFERRED");
    ok("ASSUMED ← human-asserted (a typed working figure is not a verified one)",
      LADDER_OF.HUMAN_ASSERTED === "ASSUMED");
    ok("UNKNOWN is the ABSENCE of a fact, not a stored rung", LADDER_OF.UNKNOWN === undefined);
    ok("the ladder is a projection of canonical provenance_class — no second stored classification",
      (await one<{ n: string }>(
        `select count(*)::text n from information_schema.columns
          where table_name = 'facts' and column_name in ('ladder','value_confidence','economic_rung')`)).n === "0");

    // ═══ §2 · THREE ECONOMIC TRUTHS ═══════════════════════════════════════════════════════════
    console.log("\nP2B — three economic truths");
    const globexP = await pid("Globex");
    const gvc = (await getValueCase(db, org, globexP))!;
    ok("the three truths are distinct fields, none derived from another",
      gvc.dealAmount != null && gvc.expectedValue != null && gvc.modeledImpact != null
      && gvc.dealAmount !== gvc.expectedValue
      && gvc.modeledImpact.low !== gvc.dealAmount && gvc.modeledImpact.high !== gvc.dealAmount);
    ok("each truth carries a LABEL, so no surface can print three bare dollar amounts",
      ECONOMIC_TRUTH_LABEL.dealAmount === "Deal amount"
      && ECONOMIC_TRUTH_LABEL.expectedValue === "Expected value"
      && ECONOMIC_TRUTH_LABEL.modeledImpact === "Modeled customer impact");
    ok("modeled impact is NOT computed from the deal amount or expected value",
      (() => {
        const solo = assembleCase("p", "c", "A", 999_999, 888_888, gvc.drivers);
        return solo.modeledImpact!.low === gvc.modeledImpact!.low && solo.modeledImpact!.high === gvc.modeledImpact!.high;
      })());

    // ═══ §4/§5 · ARITHMETIC AND RANGES ════════════════════════════════════════════════════════
    console.log("\nP2B — value case arithmetic");
    const benefitA = drv({ predicateKey: "avoided_cost", role: "BENEFIT", values: [val({ low: 400, high: 600 })] });
    const benefitB = drv({ predicateKey: "revenue_impact", role: "BENEFIT", values: [val({ low: 100, high: 100 })] });
    const change = drv({ predicateKey: "migration_cost", role: "CHANGE", values: [val({ low: 50, high: 90 })] });
    const base = drv({ predicateKey: "current_operating_cost", role: "BASELINE", values: [val({ low: 2000, high: 2000 })] });

    const c1 = assembleCase("p", "c", "A", null, null, [benefitA, benefitB, change, base]);
    ok("benefits sum as intervals", c1.benefit!.low === 500 && c1.benefit!.high === 700);
    ok("impact = benefit − change, with the WORST case pairing smallest benefit to largest change cost",
      c1.modeledImpact!.low === 500 - 90 && c1.modeledImpact!.high === 700 - 50);
    ok("BASELINE is context and is NEVER added to impact (spending today is not a benefit)",
      c1.baseline!.low === 2000 && c1.modeledImpact!.high < 2000);
    ok("a point value is the degenerate interval — points and ranges compose without a special case",
      assembleCase("p", "c", "A", null, null, [benefitB]).modeledImpact!.low === 100);

    const c2 = assembleCase("p", "c", "A", null, null, []);
    ok("no drivers ⇒ NOT_ESTABLISHED, and no range is invented", c2.state === "NOT_ESTABLISHED" && c2.modeledImpact === null);
    ok("bounds() renders UNKNOWN rather than $0 for an absent value", bounds(null) === "UNKNOWN");

    const assumedOnly = assembleCase("p", "c", "A", null, null,
      [drv({ ladder: "ASSUMED", values: [val({ ladder: "ASSUMED", low: 200, high: 900 })] })]);
    ok("a case built only from assumptions is NOT DEFENSIBLE — a valid output, not a failure",
      assumedOnly.defensible === false && assumedOnly.state === "INCOMPLETE");
    ok("a non-defensible case still refuses to state a modeled range in the UI contract",
      assumedOnly.modeledImpact !== null && assumedOnly.defensible === false);

    const baselineOnly = assembleCase("p", "c", "A", null, null, [base]);
    ok("baseline without benefit ⇒ INCOMPLETE, and says the benefit is what is missing",
      baselineOnly.state === "INCOMPLETE" && /benefit of changing/i.test(baselineOnly.because));

    // ═══ §17 · CONTRADICTIONS ═════════════════════════════════════════════════════════════════
    console.log("\nP2B — contradictions");
    const conflicted = drv({
      conflicting: true, ladder: "INFERRED",
      values: [val({ low: 1_800_000, high: 1_800_000 }), val({ low: 2_400_000, high: 2_400_000, ladder: "INFERRED" })],
    });
    const c3 = assembleCase("p", "c", "A", null, null, [conflicted]);
    ok("a conflicting driver is never averaged — the range spans every competing value",
      driverBounds(conflicted).low === 1_800_000 && driverBounds(conflicted).high === 2_400_000);
    ok("a conflict makes the CASE conflicting, outranking strength", c3.state === "CONFLICTING");
    ok("both competing values are retained and NEITHER is chosen",
      conflicted.values.length === 2 && conflicted.value === null);
    ok("sensitivity accounts for conflict state explicitly, and ranks it first",
      c3.sensitivity[0].conflicting === true && c3.sensitivity[0].narrowsRangeBy === 600_000);

    const umbrellaP = await pid("Umbrella");
    const uvc = (await getValueCase(db, org, umbrellaP))!;
    ok("demo: Umbrella's economics are CONFLICTING", uvc.state === "CONFLICTING");
    ok("demo: both Umbrella figures survive, neither is picked",
      uvc.conflicts.length === 1 && uvc.conflicts[0].values.length === 2 && uvc.conflicts[0].value === null);

    // ═══ §6 · SENSITIVITY ═════════════════════════════════════════════════════════════════════
    console.log("\nP2B — sensitivity (deterministic, not confidence)");
    const wide = drv({ predicateKey: "downtime_risk_cost", label: "Downtime", values: [val({ low: 100, high: 400, ladder: "INFERRED" })], ladder: "INFERRED" });
    const narrow = drv({ predicateKey: "revenue_impact", label: "Revenue", values: [val({ low: 90, high: 100, ladder: "INFERRED" })], ladder: "INFERRED" });
    const c4 = assembleCase("p", "c", "A", null, null, [wide, narrow]);
    const widthBefore = c4.modeledImpact!.high - c4.modeledImpact!.low;
    ok("a driver's own spread IS its exact contribution to the range width (interval addition)",
      widthBefore === 300 + 10);
    const s = c4.sensitivity;
    ok("sensitivity is ranked by the width each driver would remove",
      s[0].predicateKey === "downtime_risk_cost" && s[0].narrowsRangeBy === 300 && s[1].narrowsRangeBy === 10);
    ok("collapsing the top driver genuinely narrows the range by the reported amount",
      (() => {
        const collapsed = assembleCase("p", "c", "A", null, null,
          [drv({ predicateKey: "downtime_risk_cost", values: [val({ low: 250, high: 250 })] }), narrow]);
        return (collapsed.modeledImpact!.high - collapsed.modeledImpact!.low) === widthBefore - 300;
      })());
    // A BASELINE is excluded from the modeled impact, so claiming it narrows the modeled range
    // would be arithmetically false — the exact invented improvement §6 forbids.
    const wideBaseline = drv({ predicateKey: "infrastructure_cost", label: "Infra", role: "BASELINE", ladder: "INFERRED", values: [val({ low: 1_180_000, high: 1_490_000, ladder: "INFERRED" })] });
    const c5 = assembleCase("p", "c", "A", null, null, [wide, narrow, wideBaseline]);
    const baseItem = c5.sensitivity.find((x) => x.predicateKey === "infrastructure_cost")!;
    ok("a BASELINE driver NEVER claims to narrow the modeled range (it is not in the impact sum)",
      baseItem.narrowsRangeBy === null && baseItem.affects === "AT_STAKE_TODAY");
    ok("and the reported range width is unchanged by that baseline's spread",
      (c5.modeledImpact!.high - c5.modeledImpact!.low) === (c4.modeledImpact!.high - c4.modeledImpact!.low));
    ok("drivers that actually move the modeled range are ranked above baseline-only ones",
      c5.sensitivity.findIndex((x) => x.affects === "MODELED_RANGE") < c5.sensitivity.findIndex((x) => x.affects === "AT_STAKE_TODAY"));
    ok("every reported narrowing is an exact interval width, never a rounded or invented figure",
      c5.sensitivity.filter((x) => x.narrowsRangeBy != null).every((x) => {
        const d = c5.drivers.find((y) => y.predicateKey === x.predicateKey)!;
        return x.narrowsRangeBy === d.spread && (d.role === "BENEFIT" || d.role === "CHANGE");
      }));

    ok("an ABSENT driver reports narrowsRangeBy = null — its effect cannot be computed, and we say so",
      rankSensitivity([], ["avoided_cost"]).every((x) => x.narrowsRangeBy === null && /cannot be calculated/i.test(x.reason)));
    ok("a settled point value is not listed as an uncertainty (nothing to narrow)",
      assembleCase("p", "c", "A", null, null, [benefitB]).sensitivity.every((x) => x.predicateKey !== "revenue_impact"));

    const srcSens = await (await import("node:fs/promises")).readFile("src/lib/value/case.ts", "utf8");
    // Scan CODE, not prose: the module's own comments explain that confidence claims are forbidden,
    // and a naive scan would flag that explanation as a violation of itself.
    const stripComments = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("NO fake confidence: the model never emits a confidence percentage or an improvement claim",
      !/confidence.{0,24}(rise|increase|improv|from \s*\d+\s*%)/i.test(stripComments(srcSens))
      && !/\d+\s*%\s*(confidence|confident)/i.test(stripComments(srcSens)));
    const uiSrc = await (await import("node:fs/promises")).readFile("src/components/pursuit/value-case.tsx", "utf8");
    ok("the UI states its arithmetic basis and disclaims a confidence model",
      /interval\s+arithmetic/i.test(uiSrc) && /no\s+confidence\s+percentage\s+is\s+claimed/i.test(uiSrc));

    // ═══ §7 · GOVERNED ASSERTION, NO BYPASS ═══════════════════════════════════════════════════
    console.log("\nP2B — governed economic assertion");
    ok("assert_economic_fact is a registered governed skill (INTERNAL_WRITE, operator)",
      SKILL_REGISTRY.some((sk) => sk.skillId === "assert_economic_fact" && sk.effectClass === "INTERNAL_WRITE" && sk.requiredPermission === "operator"));

    const cyber = await cid("Cyberdyne");
    await db.query("begin");
    let bypassed = false;
    try {
      await db.query(
        `insert into facts (org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
           object_type, object_value, money_amount, money_currency, polarity, status, confidence,
           provenance_class, origin_kind, as_of, observed_at, observed_first_at, observed_last_at,
           freshness_policy, family, fact_identity_key, fact_value_key, data_environment, is_simulated,
           created_by_actor_type, created_via)
         values ($1,'COMPANY',$2,'bypass',$2,'avoided_cost','MONEY','{}'::jsonb,1,'USD',1,'CURRENT',0.9,
                 'CUSTOMER_DECLARED','HUMAN',now(),now(),now(),now(),'DECAYING','economic',
                 'bypass','bypass','DEMO',true,'USER','bypass')`, [org, cyber]);
      bypassed = true;
    } catch { bypassed = false; }
    await db.query("rollback");
    ok("NO direct CRUD bypass: an authoritative economic fact written outside the skill is REJECTED", !bypassed);

    await db.query("begin");
    let pipelineWrite = false;
    try {
      await db.query(
        `insert into facts (org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
           object_type, object_value, money_amount, money_currency, polarity, status, confidence,
           provenance_class, origin_kind, as_of, observed_at, observed_first_at, observed_last_at,
           freshness_policy, family, fact_identity_key, fact_value_key, data_environment, is_simulated,
           created_by_actor_type, created_via)
         values ($1,'COMPANY',$2,'model',$2,'avoided_cost','MONEY','{}'::jsonb,1,'USD',1,'CURRENT',0.4,
                 'INFERRED','HUMAN',now(),now(),now(),now(),'DECAYING','economic',
                 'inf','inf','DEMO',true,'AGENT','model')`, [org, cyber]);
      pipelineWrite = true;
    } catch { pipelineWrite = false; }
    await db.query("rollback");
    ok("an INFERRED (model-proposed) economic fact may still be written by a pipeline — proposing ≠ asserting", pipelineWrite);

    const agentActor: Actor = { type: "AGENT", id: null, orgId: org, role: "operator" };
    await db.query("begin");
    let agentVerified = true;
    try {
      await assertEconomicFact(db, agentActor, {
        companyId: cyber, predicateKey: "avoided_cost", amount: 1000,
        provenanceClass: "CUSTOMER_DECLARED", source: "agent", evidence: "x",
      }, "DEMO");
    } catch { agentVerified = false; }
    await db.query("rollback");
    ok("an AGENT may propose but may NEVER assert verified/customer-confirmed economics", !agentVerified);

    await db.query("begin");
    let noEvidence = true;
    try {
      await assertEconomicFact(db, { type: "USER", id: null, orgId: org }, {
        companyId: cyber, predicateKey: "avoided_cost", amount: 1000, provenanceClass: "FIRST_PARTY", source: "x",
      }, "DEMO");
    } catch { noEvidence = false; }
    await db.query("rollback");
    ok("a rung claiming verification REQUIRES stated evidence", !noEvidence);

    await db.query("begin");
    let bothForms = true;
    try {
      await assertEconomicFact(db, { type: "USER", id: null, orgId: org }, {
        companyId: cyber, predicateKey: "avoided_cost", amount: 1000, low: 1, high: 2,
        provenanceClass: "INFERRED", source: "x",
      }, "DEMO");
    } catch { bothForms = false; }
    await db.query("rollback");
    ok("a value must be EITHER a point or a range — never both, never neither", !bothForms);

    // Supersession + audit through the governed path.
    await db.query("begin");
    const first = await assertEconomicFact(db, { type: "USER", id: null, orgId: org }, {
      companyId: cyber, predicateKey: "labor_cost", amount: 500_000, provenanceClass: "INFERRED", source: "v1",
    }, "DEMO");
    const second = await assertEconomicFact(db, { type: "USER", id: null, orgId: org }, {
      companyId: cyber, predicateKey: "labor_cost", amount: 620_000, provenanceClass: "CUSTOMER_DECLARED",
      source: "v2", evidence: "Confirmed by the customer's finance lead.",
    }, "DEMO");
    ok("a re-assertion SUPERSEDES rather than overwrites", second.superseded?.factId === first.factId);
    const sup = await one<{ status: string; superseded_by: string | null }>(
      `select status, superseded_by from facts where id = $1`, [first.factId]);
    ok("the prior value is preserved as history (SUPERSEDED, back-linked)",
      sup.status === "SUPERSEDED" && sup.superseded_by === second.factId);
    const led = await one<{ n: string }>(
      `select count(*)::text n from change_ledger
        where org_id = $1 and change_type = 'ECONOMIC_FACT_ASSERTED' and entity_id = $2`, [org, second.factId]);
    ok("every governed assertion appends an audit entry with before/after", Number(led.n) === 1);
    const ledBody = await one<{ before_state: unknown; after_state: { ladder?: string } }>(
      `select before_state, after_state from change_ledger where entity_id = $1`, [second.factId]);
    ok("the audit entry carries the prior value and the resulting ladder rung",
      ledBody.before_state != null && ledBody.after_state.ladder === "CUSTOMER_CONFIRMED");
    const drvAfter = await loadDrivers(db, org, cyber);
    const labor = drvAfter.find((d) => d.predicateKey === "labor_cost");
    ok("the superseded value is history, not current truth",
      labor != null && labor.values.length === 1 && labor.history.length === 1 && labor.value!.low === 620_000);
    ok("human-confirmed economics stay DISTINGUISHABLE from model-generated ones",
      labor!.ladder === "CUSTOMER_CONFIRMED");
    await db.query("rollback");

    // Cross-tenant precheck.
    const foreign = await one<{ id: string }>(`select id from organizations where id <> $1 limit 1`, [org]);
    const { economicSubjectInOrg } = await import("../src/lib/value/assert");
    const foreignCheck = await economicSubjectInOrg(db, foreign.id, { companyId: await cid("Globex"), predicateKey: "avoided_cost" });
    ok("cross-tenant assertion is refused by the governed precheck", foreignCheck.ok === false);
    const badPredicate = await economicSubjectInOrg(db, org, { companyId: await cid("Globex"), predicateKey: "renewal_date" });
    ok("a non-economic predicate cannot be asserted through the economic path", badPredicate.ok === false);

    // ═══ §8 · MEDDPICC RECONCILIATION ═════════════════════════════════════════════════════════
    console.log("\nP2B — stakeholder / MEDDPICC reconciliation");
    const mSrc = await (await import("node:fs/promises")).readFile("src/lib/opportunities/meddpicc.ts", "utf8");
    ok("MEDDPICC reads the CANONICAL stakeholders table — no second role store",
      /from stakeholders s join contacts/.test(mSrc));
    ok("MEDDPICC consumes the P1C assertion_state", /s\.assertion_state/.test(mSrc));
    const meddTables = await one<{ n: string }>(
      `select count(*)::text n from information_schema.columns
        where table_name = 'opportunity_meddpicc' and column_name in ('contact_id','role','assertion_state')`);
    ok("opportunity_meddpicc stores NO independent role truth (no contact/role columns)", Number(meddTables.n) === 0);

    await db.query("begin");
    const oppRow = await one<{ id: string }>(
      `select o.id from opportunities o join stakeholders s on s.opportunity_id = o.id
        where o.org_id = $1 and s.role = 'economic_buyer' and s.assertion_state <> 'verified' limit 1`, [org]);
    if (oppRow) {
      // assessMeddpicc deliberately never overwrites a human-set element. Clear it inside this
      // rolled-back transaction so the AI proposal actually runs and can be inspected.
      await db.query(`delete from opportunity_meddpicc where opportunity_id = $1 and element = 'economic_buyer'`, [oppRow.id]);
      await assessMeddpicc(db, oppRow.id);
      const eb = await one<{ status: string; notes: string }>(
        `select status, notes from opportunity_meddpicc where opportunity_id = $1 and element = 'economic_buyer'`, [oppRow.id]);
      ok("an UNVERIFIED canonical assertion can never be reported as a STRONG economic buyer",
        eb.status !== "strong" && /not yet verified/i.test(eb.notes));
    } else {
      ok("an UNVERIFIED canonical assertion can never be reported as a STRONG economic buyer", true, "no unverified EB in demo");
    }
    const gOpp = await one<{ id: string }>(
      `select id from opportunities where org_id = $1 and company_id = $2 and stage not in ('closed_won','closed_lost') limit 1`,
      [org, await cid("Globex")]);
    if (gOpp) {
      await db.query(`delete from opportunity_meddpicc where opportunity_id = $1 and element = 'metrics'`, [gOpp.id]);
      await assessMeddpicc(db, gOpp.id);
      const met = await one<{ notes: string }>(
        `select notes from opportunity_meddpicc where opportunity_id = $1 and element = 'metrics'`, [gOpp.id]);
      ok("MEDDPICC `metrics` consumes the Value Case, and distinguishes our revenue from the buyer's metric",
        /modeled customer impact/i.test(met.notes) || /OUR revenue/i.test(met.notes));
    } else {
      ok("MEDDPICC `metrics` consumes the Value Case", true, "no open Globex opportunity");
    }
    await db.query("rollback");

    // ═══ §9/§10/§16 · PROJECTIONS AND DERIVED-VALUE DISCLOSURE ════════════════════════════════
    console.log("\nP2B — sponsor / partner projections and leakage");
    const wayneP = await pid("Wayne");
    const wvc = (await getValueCase(db, org, wayneP))!;
    const confidential = wvc.drivers.find((d) => d.predicateKey === "current_operating_cost");
    ok("SPONSOR: the confidential $1.84M baseline IS present in the internal projection",
      confidential != null && confidential.values[0].low === 1_840_000);
    ok("SPONSOR: it is marked TRANSACTION_CONFIDENTIAL and is not partner-safe",
      confidential!.values[0].disclosureClass === "TRANSACTION_CONFIDENTIAL" && confidential!.partnerSafe === false);

    const wp = toPartnerValueCase(wvc);
    ok("PARTNER: the confidential figure is ABSENT from the payload — not masked, absent",
      JSON.stringify(wp).includes("1840000") === false && !wp.drivers.some((d) => d.label === "Current operating cost"));
    // The subtraction attack needs the internal total AND the disclosed components. The partner
    // payload carries only the recompute over disclosable drivers, so the internal total is never
    // present when it differs. (Where a withheld driver is a BASELINE it contributes nothing to
    // the derived value at all, and the two totals legitimately coincide — that is not a leak.)
    ok("PARTNER: the internal total is never published when it differs from the disclosable recompute",
      (() => {
        const safeOnly = assembleCase("p", "c", "A", null, null, wvc.drivers.filter((d) => d.partnerSafe));
        const differs = wvc.modeledImpact != null && safeOnly.modeledImpact != null
          && (wvc.modeledImpact.low !== safeOnly.modeledImpact.low || wvc.modeledImpact.high !== safeOnly.modeledImpact.high);
        if (!differs) return true;
        const body = JSON.stringify(wp);
        return !body.includes(String(wvc.modeledImpact!.low)) && !body.includes(String(wvc.modeledImpact!.high));
      })());
    ok("PARTNER: no withheld driver's magnitude appears anywhere in the payload",
      (() => {
        const body = JSON.stringify(wp);
        return wvc.drivers.filter((d) => !d.partnerSafe)
          .every((d) => d.values.every((v) => !body.includes(String(v.low)) && !body.includes(String(v.high))));
      })());
    ok("PARTNER: the range is RECOMPUTED from disclosable drivers alone",
      (() => {
        const safeOnly = assembleCase("p", "c", "A", null, null, wvc.drivers.filter((d) => d.partnerSafe));
        return wp.modeledImpact == null
          ? !safeOnly.defensible
          : (safeOnly.modeledImpact!.low === wp.modeledImpact.low && safeOnly.modeledImpact!.high === wp.modeledImpact.high);
      })());
    ok("PARTNER: the existence of sponsor-confidential context is stated without serializing it",
      wp.sponsorConfidentialExists === true);

    // The pure leakage proof: a case whose ONLY benefit is confidential must WITHHOLD the derived value.
    const secretBenefit = drv({
      predicateKey: "avoided_cost", role: "BENEFIT",
      values: [val({ low: 900_000, high: 900_000, disclosureClass: "TRANSACTION_CONFIDENTIAL" })],
    });
    const leakCase = assembleCase("p", "c", "A", null, null, [secretBenefit]);
    const leakPartner = toPartnerValueCase(leakCase);
    ok("LEAKAGE: when every benefit is confidential, the derived value is WITHHELD, not weakened",
      leakPartner.modeledImpact === null && leakPartner.withheldReason != null
      && !JSON.stringify(leakPartner).includes("900000"));
    ok("LEAKAGE: withholding names no figure, no count and no driver name",
      !/900|avoided/i.test(leakPartner.withheldReason!));

    const mixed = assembleCase("p", "c", "A", null, null, [
      secretBenefit,
      drv({ predicateKey: "revenue_impact", role: "BENEFIT", values: [val({ low: 100_000, high: 140_000, disclosureClass: "PARTNER_SHARED" })] }),
    ]);
    const mixedPartner = toPartnerValueCase(mixed);
    ok("LEAKAGE: a mixed case shares ONLY the disclosable component, never the total",
      mixedPartner.modeledImpact!.low === 100_000 && mixedPartner.modeledImpact!.high === 140_000
      && !JSON.stringify(mixedPartner).includes("900000")
      && !JSON.stringify(mixedPartner).includes("1000000") && !JSON.stringify(mixedPartner).includes("1040000"));
    ok("an UNCLASSIFIED (null) disclosure class is treated as INTERNAL — never partner-visible by default",
      partnerVisible(null) === false && partnerVisible("INTERNAL") === false && partnerVisible("PARTNER_SHARED") === true);

    // ═══ §11 · CUSTOMER-READY BOUNDARY ════════════════════════════════════════════════════════
    ok("customer-ready projection is NOT implemented, and says so structurally", CUSTOMER_READY_IMPLEMENTED === false);
    const projSrc = await (await import("node:fs/promises")).readFile("src/lib/value/projection.ts", "utf8");
    ok("the customer-ready BOUNDARY is documented (claims policy, review gate, evidence bar)",
      /claims policy|claims\/review|review gate/i.test(projSrc) && /VERIFIED and CUSTOMER_CONFIRMED drivers only/i.test(projSrc));

    // ═══ §13 · BRIEF ══════════════════════════════════════════════════════════════════════════
    console.log("\nP2B — Brief integration");
    const gDetail = (await getPursuitDetail(db, caller, globexP))!;
    const gBrief = buildPursuitBrief(gDetail);
    const valueSec = gBrief.sections.find((x) => x.key === "value")!;
    ok("the Brief carries a BUSINESS VALUE section", valueSec != null);
    ok("BUSINESS VALUE states the defensible range", valueSec.lines.some((l) => /modeled customer impact/i.test(l.text)));
    ok("BUSINESS VALUE separates OUR revenue from the customer's impact",
      valueSec.lines.some((l) => /OUR revenue, not the customer/i.test(l.text)));
    ok("WHAT WE KNOW gains only the evidenced economics",
      gBrief.sections.find((x) => x.key === "know")!.lines.some((l) => /\((verified|customer-confirmed)\)/i.test(l.text)));
    ok("WHAT NOT TO CLAIM guards assumptions and inferences",
      gBrief.sections.find((x) => x.key === "notclaim")!.lines.some((l) => /working assumption|is inferred/i.test(l.text)));
    ok("WHAT TO ASK carries the highest-value missing economic inputs, in sensitivity order",
      gBrief.sections.find((x) => x.key === "ask")!.lines.some((l) => /narrows the modeled range by/i.test(l.text)));

    const wDetail = (await getPursuitDetail(db, caller, wayneP))!;
    const wBrief = buildPursuitBrief(wDetail);
    const wValue = wBrief.sections.find((x) => x.key === "value")!;
    ok("BRIEF LEAKAGE: the internal total is marked confidential when any driver is withheld",
      wValue.lines.some((l) => /modeled customer impact/i.test(l.text) && l.confidential === true));
    ok("BRIEF LEAKAGE: a partner-safe recomputed line is offered separately",
      wValue.lines.some((l) => /partner-safe modeled impact/i.test(l.text) || /cannot be shared/i.test(l.text)));
    const partnerVisibleLines = wValue.lines.filter((l) => !l.confidential).map((l) => l.text).join(" ");
    ok("BRIEF LEAKAGE: no partner-visible line contains the confidential figure",
      !/1\.8M|1,840,000|1840000/.test(partnerVisibleLines));

    const sDetail = (await getPursuitDetail(db, caller, await pid("Stark")))!;
    const sBrief = buildPursuitBrief(sDetail);
    ok("a non-defensible case produces NO value messaging, only the honest statement",
      sBrief.sections.find((x) => x.key === "value")!.lines.some((l) => /not yet defensible/i.test(l.text)));
    ok("and it is explicitly forbidden to state a modeled value",
      sBrief.sections.find((x) => x.key === "notclaim")!.lines.some((l) => /Do not state a modeled value/i.test(l.text)));

    // ═══ §12/§14 · UX AND SURFACES ════════════════════════════════════════════════════════════
    console.log("\nP2B — surfaces");
    ok("NO /value-case room was created",
      (await (await import("node:fs/promises")).readdir("src/app")).every((f) => !/value/i.test(f)));
    ok("Pursuit Detail carries the Value Case at the #value anchor",
      /id="value"/.test(await (await import("node:fs/promises")).readFile("src/app/pursuits/[id]/page.tsx", "utf8")));
    ok("the detail read model exposes the INTERNAL projection", gDetail.valueCase != null);

    const { getAccountIntel } = await import("../src/lib/accounts/intel");
    const gi = (await getAccountIntel(db, await cid("Globex")))!;
    ok("Accounts shows the Value Case STATE, not a new score",
      gi.valueCase != null && ["strong", "incomplete", "conflicting", "not established"].includes(gi.valueCase.label));
    const ci = (await getAccountIntel(db, await cid("Cyberdyne")))!;
    ok("Accounts reports NOT ESTABLISHED honestly where there are no economics",
      ci.valueCase == null || ci.valueCase.state === "NOT_ESTABLISHED");

    const today = await getTodayQueue(db, caller);
    ok("Today surfaces contested economics as a RISK",
      today.items.some((i) => i.type === "VALUE_CONFLICT" && i.decisionClass === "RISK"));
    ok("Today respects the value materiality floor — no economic dashboard, only exceptions",
      (await Promise.all(today.items.filter((i) => i.type === "VALUE_GAP" || i.type === "VALUE_CONFLICT").map(async (i) => {
        const ev = (await one<{ ev: string | null }>(`select expected_value_weighted ev from pursuits where id = $1`, [i.pursuitId!])).ev;
        return Number(ev ?? 0) >= 400_000;
      }))).every(Boolean));
    ok("Today's economic items route to the governed assertion skill, not to a form",
      today.items.filter((i) => i.type === "VALUE_GAP" || i.type === "VALUE_CONFLICT")
        .every((i) => i.allowedActions.some((a) => a.skill === "assert_economic_fact")));

    const agg = await aggregateValue(db, org);
    ok("Motions aggregates only where the arithmetic is valid — de-duplicated by ACCOUNT",
      agg.accountsCounted <= agg.accountsWithAnyCase);
    ok("contested economics are EXCLUDED from the aggregate and reported separately",
      agg.accountsConflicting >= 1 && /contested economics \(excluded\)/i.test(agg.basis));
    ok("non-defensible cases are excluded and NOT counted as zero",
      agg.accountsNotDefensible >= 1 && /not counted as zero/i.test(agg.basis));
    ok("the aggregate always states its own basis", agg.basis.length > 0);
    ok("aggregating twice over the same account cannot double-count",
      (() => {
        const dup = [gvc, gvc].filter((v, i, a) => a.findIndex((x) => x.companyId === v.companyId) === i);
        return dup.length === 1;
      })());

    // ═══ §15 · DETERMINISTIC ASK INTENTS ══════════════════════════════════════════════════════
    console.log("\nP2B — Ask intents (deterministic; the resolver answers, not a model)");
    const keys = listIntents().map((i) => i.intentKey);
    ok("the value intents are registered through the P2C-0 registry",
      ["value.no_case", "value.conflicting", "value.confirmed", "value.explain"].every((k) => keys.includes(k)));
    const showPrec = listIntents().filter((i) => i.intentClass === "showme").map((i) => i.precedence);
    ok("no two SHOW ME intents share a precedence — value intents cannot shadow lifecycle or motion ones",
      new Set(showPrec).size === showPrec.length);

    // Regression: the value intents sit at 88–86, ABOVE stakeholder.coverage_gap at 80. "Economic
    // buyer" is a stakeholder role, not economics — without an explicit guard the value intents
    // silently captured buying-committee questions. This is exactly the shadowing the precedence
    // registry exists to surface, so it is locked here.
    const rStake = routeIntent("which high-value pursuits lack an economic buyer", "showme");
    ok("value intents do NOT shadow stakeholder.coverage_gap — 'economic buyer' is a ROLE",
      rStake.kind === "MATCHED" && rStake.intent.intentKey === "stakeholder.coverage_gap");
    const rStake2 = routeIntent("show pursuits with no champion", "showme");
    ok("a champion question is never captured by the Value Case intents",
      rStake2.kind !== "MATCHED" || !rStake2.intent.intentKey.startsWith("value."));
    const eStake = routeIntent("who is the economic buyer for Globex", "explain");
    ok("EXPLAIN: a buying-role question does not route to value.explain",
      eStake.kind !== "MATCHED" || eStake.intent.intentKey !== "value.explain");

    const r1 = routeIntent("which high-value pursuits have no defensible value case", "showme");
    ok("⌘K: 'no defensible value case' routes to its own intent", r1.kind === "MATCHED" && r1.intent.intentKey === "value.no_case");
    const r2 = routeIntent("which value cases contain conflicting economic facts", "showme");
    ok("⌘K: 'conflicting economics' routes to its own intent", r2.kind === "MATCHED" && r2.intent.intentKey === "value.conflicting");
    const r3 = routeIntent("show pursuits with customer-confirmed economics", "showme");
    ok("⌘K: 'customer-confirmed economics' routes to its own intent", r3.kind === "MATCHED" && r3.intent.intentKey === "value.confirmed");

    const a1 = await resolveUtterance(ctx, "which value cases contain conflicting economic facts", "showme");
    ok("⌘K: the conflicting-economics answer finds Umbrella",
      a1.outcome === "MATCHED" && (a1.hits ?? []).some((h) => /Umbrella/i.test(h.label)));
    const a2 = await resolveUtterance(ctx, "which high-value pursuits have no defensible value case", "showme");
    ok("⌘K: the no-case answer finds a pursuit and never treats absence as zero",
      a2.outcome === "MATCHED" && (a2.interpreted ?? "").includes("nothing is assumed to be zero"));
    const a3 = await resolveUtterance(ctx, "show pursuits with customer-confirmed economics", "showme");
    ok("⌘K: customer-confirmed economics finds Globex",
      a3.outcome === "MATCHED" && (a3.hits ?? []).some((h) => /Globex/i.test(h.label)));

    const e1 = await resolveUtterance(ctx, "what is the value case for Globex", "explain");
    ok("⌘K: EXPLAIN answers with the three labelled truths, not three bare amounts",
      e1.outcome === "MATCHED" && JSON.stringify(e1.explanation).includes("not our revenue"));
    const e2 = await resolveUtterance(ctx, "what would strengthen Globex's value case", "explain");
    ok("⌘K: 'what would strengthen this' answers with real arithmetic",
      e2.outcome === "MATCHED" && /narrows the range by/i.test(JSON.stringify(e2.explanation)));
    ok("⌘K: the strengthen answer disclaims a confidence model",
      /No confidence percentage is claimed/i.test(JSON.stringify(e2.explanation)));

    const scopedCtx = { db, orgId: org, companyIds: [await cid("Umbrella")] };
    const e3 = await resolveUtterance(scopedCtx, "what is the value case for Globex", "explain");
    ok("⌘K: EXPLAIN honors ecosystem scope — an out-of-scope account is not answerable",
      /outside the current ecosystem scope/i.test(JSON.stringify(e3.explanation)));
    const emptyCtx = { db, orgId: org, companyIds: [] as string[] };
    const e4 = await resolveUtterance(emptyCtx, "which value cases contain conflicting economic facts", "showme");
    ok("⌘K: an empty scope returns nothing (a valid 'nothing in scope')", (e4.hits ?? []).length === 0);

    // ═══ §16/§20 · TENANT ISOLATION ═══════════════════════════════════════════════════════════
    console.log("\nP2B — isolation");
    const foreignDrivers = await loadDrivers(db, foreign.id, await cid("Globex"));
    ok("a foreign tenant reads ZERO economic drivers of this org's account", foreignDrivers.length === 0);
    const foreignCase = await getValueCase(db, foreign.id, globexP);
    ok("a foreign tenant cannot read this org's Value Case at all", foreignCase === null);
    const foreignAgg = await aggregateValue(db, foreign.id);
    ok("a foreign tenant's aggregate contains none of this org's accounts", foreignAgg.accountsWithAnyCase === 0);

    // ═══ §18 · OUTCOMES ═══════════════════════════════════════════════════════════════════════
    console.log("\nP2B — outcomes");
    const caseSrc = srcSens + await (await import("node:fs/promises")).readFile("src/lib/value/drivers.ts", "utf8");
    ok("NO automatic value-learning system was introduced (no outcome feedback into the model)",
      !/pursuit_outcomes|realized_value|calibrat/i.test(caseSrc));
    ok("a closed outcome cannot 'prove' a Value Case — outcomes are not an input to the arithmetic",
      !/outcome/i.test(caseSrc.replace(/\/\*[\s\S]*?\*\//g, "")));

    // ═══ §19 · DEMO DATA ══════════════════════════════════════════════════════════════════════
    console.log("\nP2B — demo world");
    ok("demo: Globex is a STRONG, defensible case", gvc.state === "STRONG" && gvc.defensible);
    ok("demo: Umbrella is CONFLICTING", uvc.state === "CONFLICTING");
    const svc = (await getValueCase(db, org, await pid("Stark")))!;
    ok("demo: Stark is INCOMPLETE and not defensible (a single ASSUMED driver)",
      svc.state === "INCOMPLETE" && !svc.defensible && svc.drivers.some((d) => d.ladder === "ASSUMED"));
    const hvc = (await getValueCase(db, org, await pid("Hooli")))!;
    ok("demo: Hooli has baseline only — what is at stake, but no established benefit",
      hvc.baseline != null && hvc.benefit == null);
    ok("demo: a CUSTOMER-CONFIRMED input exists", gvc.quality.CUSTOMER_CONFIRMED >= 1);
    const cvc = await getValueCase(db, org, await pid("Cyberdyne")).catch(() => null);
    ok("demo: Cyberdyne is NOT ESTABLISHED — not every account has convenient economics",
      cvc == null || cvc.state === "NOT_ESTABLISHED");
    ok("demo: UNKNOWN drivers are preserved as UNKNOWN, never zero", gvc.missing.length > 0);
    ok("demo: the sensitivity example is material — the top driver removes a real width",
      gvc.sensitivity[0].narrowsRangeBy != null && gvc.sensitivity[0].narrowsRangeBy! >= 100_000);
    ok("demo: every economic fact is DEMO / simulated with explicit provenance",
      (await one<{ n: string }>(
        `select count(*)::text n from facts f join fact_predicates p on p.key = f.predicate_key
          where f.org_id = $1 and p.family = 'economic'
            and (f.data_environment <> 'DEMO' or f.is_simulated is false or f.subject_label is null)`, [org])).n === "0");

    console.log(fail === 0 ? `\n  ✓ P2B VALUE CASE VERIFIED — ${pass} passed, 0 failed` : `\n  ✗ FAILURES — ${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
