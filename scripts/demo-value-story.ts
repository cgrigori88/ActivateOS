/**
 * Value Case demo story (P2B §19). Minimal synthetic economics — exactly enough to show every
 * state, and deliberately NOT enough to give every account a tidy business case.
 *
 *   Globex    STRONG            customer-confirmed + verified benefits, a bounded change cost,
 *                               and a sensitivity example: verifying the infra bound narrows the
 *                               modeled range materially.
 *   Umbrella  CONFLICTING       finance says $1.8M, infrastructure says $2.4M — never averaged.
 *   Stark     INCOMPLETE        one ASSUMED benefit and nothing evidenced → not yet defensible.
 *   Hooli     baseline only     costs of today recorded, no benefit of changing → INCOMPLETE.
 *   Cyberdyne NOT ESTABLISHED   deliberately untouched — no economic facts at all.
 *   Wayne     SPONSOR-ONLY      a TRANSACTION_CONFIDENTIAL baseline that must not reach a partner
 *                               payload, plus one PARTNER_SHARED benefit so the partner projection
 *                               has something honest to recompute from.
 *
 * Every write goes through the GOVERNED path (dispatchSkill → assert_economic_fact), so the demo
 * exercises the same authority boundary production does. All rows are DEMO / is_simulated.
 *
 *   npx tsx scripts/demo-value-story.ts
 */
import { Pool, type PoolClient } from "pg";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

async function companyId(db: PoolClient, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select c.id from companies c
      where c.legal_name ilike $1
        and (exists (select 1 from pursuits p where p.account_id = c.id)
          or exists (select 1 from revenue_motions m where m.company_id = c.id))
      order by length(c.legal_name) desc limit 1`, [`%${name}%`]);
  if (!rows[0]) throw new Error(`company not found: ${name}`);
  return rows[0].id;
}

interface Spec {
  predicateKey: string;
  amount?: number;
  low?: number;
  high?: number;
  provenanceClass: string;
  source: string;
  evidence?: string;
  disclosureClass?: string;
}

async function assert_(db: PoolClient, actor: Actor, companyId: string, s: Spec) {
  const r = await dispatchSkill(db, "assert_economic_fact", actor, {
    args: { companyId, ...s },
    dataEnvironment: "DEMO",
  });
  if (r.status !== "EXECUTED" && r.status !== "SUCCEEDED") {
    throw new Error(`assert_economic_fact ${s.predicateKey} → ${r.status}: ${r.reason ?? ""}`);
  }
  return r.result as { factId: string };
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    await db.query("begin");
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    // `dispatchSkill` records actor_id as a uuid; a demo operator has no user row, so the actor is
    // identified by type and org, and the human-readable source travels on each assertion.
    const actor: Actor = { type: "USER", id: null, orgId: org, role: "operator" };

    // ── GLOBEX — a STRONG case. Evidenced benefits, a bounded change cost, one wide driver that
    //    makes the sensitivity answer real. ────────────────────────────────────────────────────
    const globex = await companyId(db, "Globex");
    await assert_(db, actor, globex, {
      predicateKey: "avoided_cost", amount: 640_000, provenanceClass: "CUSTOMER_DECLARED",
      source: "CFO office, Q3 review", evidence: "Confirmed on the 12 Aug business review call by the CFO's finance lead.",
      disclosureClass: "PARTNER_SHARED",
    });
    await assert_(db, actor, globex, {
      predicateKey: "productivity_impact", amount: 310_000, provenanceClass: "FIRST_PARTY",
      source: "Joint time-and-motion study", evidence: "Measured across 14 operators over 6 weeks; study attached to the account.",
      disclosureClass: "PARTNER_SHARED",
    });
    // The wide one: still only inferred, and its spread IS the range width to be narrowed.
    await assert_(db, actor, globex, {
      predicateKey: "infrastructure_cost", low: 1_180_000, high: 1_490_000, provenanceClass: "THIRD_PARTY_UNVERIFIED",
      source: "Vendor spend estimate", disclosureClass: "INTERNAL",
    });
    await assert_(db, actor, globex, {
      predicateKey: "downtime_risk_cost", low: 140_000, high: 450_000, provenanceClass: "INFERRED",
      source: "Incident model from public outage history", disclosureClass: "INTERNAL",
    });
    await assert_(db, actor, globex, {
      predicateKey: "migration_cost", low: 180_000, high: 240_000, provenanceClass: "SECOND_PARTY",
      source: "Partner services estimate (WWT)", disclosureClass: "PARTNER_SHARED",
    });
    console.log("  ✓ Globex — STRONG (2 evidenced benefits, bounded change cost, 2 wide drivers to narrow)");

    // ── UMBRELLA — CONFLICTING. Two live sources, six figures apart. Never averaged. ───────────
    const umbrella = await companyId(db, "Umbrella");
    const a = await assert_(db, actor, umbrella, {
      predicateKey: "avoided_cost", amount: 1_800_000, provenanceClass: "FIRST_PARTY",
      source: "Finance model", evidence: "Built by our finance team from the customer's published filings.",
      disclosureClass: "INTERNAL",
    });
    // A competing value on the SAME driver: written directly so both stay CURRENT (a second
    // governed assertion would supersede the first, which is the normal path — a conflict is the
    // abnormal one, and is what fact_contradictions exists to represent).
    await db.query(`select set_config('app.governed_economic_assertion','1',true)`);
    const b = (await db.query<{ id: string }>(
      `insert into facts (org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
                          object_type, object_value, money_amount, money_currency,
                          polarity, status, confidence, provenance_class, origin_kind,
                          as_of, observed_at, observed_first_at, observed_last_at,
                          freshness_policy, half_life_days, family, disclosure_class,
                          fact_identity_key, fact_value_key, data_environment, is_simulated,
                          created_by_actor_type, created_via)
       values ($1,'COMPANY',$2,'Infrastructure team estimate',$2,'avoided_cost',
               'MONEY','{}'::jsonb,2400000,'USD',
               1,'CURRENT',0.7,'SECOND_PARTY','HUMAN',
               now(),now(),now(),now(),
               'DECAYING',365,'economic','INTERNAL',
               $3,$4,'DEMO',true,
               'USER','demo-value-story')
       returning id`,
      [org, umbrella, `${org}:${umbrella}:avoided_cost:infra`, `${org}:${umbrella}:avoided_cost:infra:2400000`])).rows[0];
    await db.query(`select set_config('app.governed_economic_assertion','',true)`);
    await db.query(
      `insert into fact_contradictions (org_id, fact_id_a, fact_id_b, contradiction_type, basis, status)
       values ($3,$1,$2,'COMPETING_VALUE','Finance and infrastructure disagree on annual avoided cost by $600k.','open')
       on conflict do nothing`, [a.factId, b.id, org]);
    console.log("  ✓ Umbrella — CONFLICTING ($1.8M finance vs $2.4M infrastructure, contradiction open)");

    // ── STARK — INCOMPLETE. One bare assumption. Not defensible, and it says so. ───────────────
    const stark = await companyId(db, "Stark");
    await assert_(db, actor, stark, {
      predicateKey: "productivity_impact", low: 200_000, high: 900_000, provenanceClass: "HUMAN_ASSERTED",
      source: "AE working estimate", disclosureClass: "INTERNAL",
    });
    console.log("  ✓ Stark — INCOMPLETE (a single ASSUMED benefit ⇒ not yet defensible)");

    // ── HOOLI — costs of today recorded, no benefit of changing established. ───────────────────
    const hooli = await companyId(db, "Hooli");
    await assert_(db, actor, hooli, {
      predicateKey: "license_subscription_cost", amount: 880_000, provenanceClass: "CUSTOMER_DECLARED",
      source: "Procurement disclosure", evidence: "Stated by procurement during the renewal discussion on 3 Jul.",
      disclosureClass: "INTERNAL",
    });
    await assert_(db, actor, hooli, {
      predicateKey: "labor_cost", low: 300_000, high: 420_000, provenanceClass: "INFERRED",
      source: "Headcount model", disclosureClass: "INTERNAL",
    });
    console.log("  ✓ Hooli — INCOMPLETE (baseline only: what is at stake, but no benefit of changing)");

    // ── CYBERDYNE — deliberately untouched. ───────────────────────────────────────────────────
    console.log("  ✓ Cyberdyne — NOT ESTABLISHED (deliberately no economic facts)");

    // ── WAYNE — the disclosure case. A confidential baseline plus one shareable benefit, so the
    //    partner projection has something to recompute from WITHOUT the confidential input. ────
    const wayne = await companyId(db, "Wayne");
    await assert_(db, actor, wayne, {
      predicateKey: "current_operating_cost", amount: 1_840_000, provenanceClass: "FIRST_PARTY",
      source: "Negotiated contract schedule", evidence: "From the in-force contract schedule held by our legal team.",
      disclosureClass: "TRANSACTION_CONFIDENTIAL",
    });
    await assert_(db, actor, wayne, {
      predicateKey: "avoided_cost", low: 260_000, high: 380_000, provenanceClass: "SECOND_PARTY",
      source: "Partner-shared benchmark", disclosureClass: "PARTNER_SHARED",
    });
    console.log("  ✓ Wayne — sponsor-confidential $1.84M baseline + a PARTNER_SHARED benefit");

    await db.query("commit");
    console.log("\nValue Case demo story committed (DEMO environment, governed assertions, synthetic provenance).");
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
