/**
 * Lifecycle Intelligence demo story (P2A). Minimal synthetic enrichment — exactly enough to show
 * every derived state, and deliberately NOT enough to make every account conveniently informed.
 *
 *   Globex     VERIFIED DATE     customer-declared renewal ~76 days out
 *   Umbrella   INFERRED WINDOW   third-party evidence, a bounded period (never a day)
 *   Stark      CONFLICTING DATE  two active sources ~6 weeks apart + an open contradiction
 *   Hooli      STALE DATE        a first-party date whose validity has already passed
 *   Cyberdyne  UNKNOWN           deliberately untouched — no lifecycle evidence at all
 *   Acme       import bridge     a population_members.attributes.renewal_date, promoted one-way
 *                                into the graph as an INFERRED WINDOW by the reconciliation bridge
 *   Wayne      SPONSOR-ONLY      a RESTRICTED contract fact that must never reach a partner payload
 *
 * All provenance is explicit and every row is DEMO/is_simulated. Idempotent: facts are keyed by
 * fact_identity_key, so a re-run updates the same slots.
 *
 *   npx tsx scripts/demo-lifecycle-story.ts
 */
import { Pool, type PoolClient } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { randomUUID } from "node:crypto";
import { bridgeImportRenewals } from "../src/lib/lifecycle/bridge";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

async function companyId(db: PoolClient, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from companies where legal_name ilike $1 order by length(legal_name) limit 1`, [`%${name}%`]);
  if (!rows[0]) throw new Error(`company not found: ${name}`);
  return rows[0].id;
}

interface FactSpec {
  orgId: string; companyId: string; label: string; predicate: string;
  objectType: "DATE" | "RANGE";
  dateValue?: Date | null; validFrom?: Date | null; validUntil?: Date | null;
  provenance: string; confidence: number; slot: string;
  observedLastAt?: Date; halfLife?: number | null; freshness?: string;
  disclosureNote?: string;
}

async function putFact(db: PoolClient, s: FactSpec): Promise<string> {
  const identity = `${s.orgId}:${s.companyId}:${s.predicate}:${s.slot}`;
  const id = randomUUID();
  const { rows } = await db.query<{ id: string }>(
    `insert into facts (
       id, org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
       object_type, object_value, date_value, valid_from, valid_until,
       polarity, status, confidence, provenance_class, origin_kind,
       as_of, observed_at, observed_first_at, observed_last_at,
       freshness_policy, half_life_days, family,
       fact_identity_key, fact_value_key, data_environment, is_simulated,
       created_by_actor_type, created_via, data_lineage)
     values ($1,$2,'COMPANY',$3,$4,$3,$5,
             $6,$7::jsonb,$8,$9,$10,
             1,'CURRENT',$11,$12,'IMPORT',
             now(),$13,$13,$13,
             $14,$15,'trigger',
             $16,$17,'DEMO',true,
             'SYSTEM','demo-lifecycle-story',$18::jsonb)
     on conflict (org_id, fact_identity_key) where status = 'CURRENT'
     do update set date_value = excluded.date_value, valid_from = excluded.valid_from,
                   valid_until = excluded.valid_until, confidence = excluded.confidence,
                   observed_last_at = excluded.observed_last_at, as_of = now()
     returning id`,
    [id, s.orgId, s.companyId, s.label, s.predicate,
     s.objectType, JSON.stringify({ note: s.disclosureNote ?? null }), s.dateValue ?? null, s.validFrom ?? null, s.validUntil ?? null,
     s.confidence, s.provenance,
     s.observedLastAt ?? new Date(),
     s.freshness ?? (s.objectType === "RANGE" ? "DECAYING" : "VALID_UNTIL"), s.halfLife ?? (s.objectType === "RANGE" ? 270 : null),
     identity, `${identity}:${(s.dateValue ?? s.validFrom ?? new Date()).toISOString().slice(0, 10)}`,
     JSON.stringify({ demo: true, note: s.disclosureNote ?? null })]);
  return rows[0].id;
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  // Refuses unless the TARGET database says it is synthetic (0102). An exported
  // production DEMO_URL is the realistic accident; the database answers, not the env.
  await assertSyntheticDatabase(pool, "demo lifecycle seed");
  const db = (await pool.connect()) as PoolClient;
  try {
    await db.query("begin");
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;

    // ── VERIFIED DATE — the customer told us. Trusted class ⇒ a precise date is legitimate. ──
    const globex = await companyId(db, "Globex");
    await putFact(db, { orgId: org, companyId: globex, label: "Globex Manufacturing Inc.", predicate: "renewal_date",
      objectType: "DATE", dateValue: at(76), provenance: "CUSTOMER_DECLARED", confidence: 0.92, slot: "customer" });
    console.log("  ✓ Globex — VERIFIED DATE (customer-declared, 76d)");

    // ── INFERRED WINDOW — third-party evidence. The 0098 registry forbids it a precise date. ──
    const umbrella = await companyId(db, "Umbrella");
    await putFact(db, { orgId: org, companyId: umbrella, label: "Umbrella Health Systems", predicate: "renewal_window",
      objectType: "RANGE", validFrom: at(58), validUntil: at(104), provenance: "THIRD_PARTY_UNVERIFIED", confidence: 0.44, slot: "vendor-signal" });
    console.log("  ✓ Umbrella — INFERRED WINDOW (third-party, 58–104d)");

    // ── CONFLICTING DATE — two active sources, ~6 weeks apart, with an open contradiction. ──
    const stark = await companyId(db, "Stark");
    const a = await putFact(db, { orgId: org, companyId: stark, label: "Stark Industries LLC", predicate: "contract_expires",
      objectType: "DATE", dateValue: at(47), provenance: "SECOND_PARTY", confidence: 0.71, slot: "partner-list" });
    const b = await putFact(db, { orgId: org, companyId: stark, label: "Stark Industries LLC", predicate: "renewal_date",
      objectType: "DATE", dateValue: at(89), provenance: "CUSTOMER_DECLARED", confidence: 0.68, slot: "crm-note" });
    await db.query(
      `insert into fact_contradictions (org_id, fact_id_a, fact_id_b, contradiction_type, basis, status)
       values ($3,$1,$2,'COMPETING_VALUE','A partner list and a customer note give renewal dates six weeks apart.','open')
       on conflict do nothing`, [a, b, org]);
    console.log("  ✓ Stark — CONFLICTING DATE (47d vs 89d, contradiction open)");

    // ── STALE DATE — first-party, but its validity has already passed. Not UNKNOWN: we knew. ──
    const hooli = await companyId(db, "Hooli");
    await putFact(db, { orgId: org, companyId: hooli, label: "Hooli Cloud", predicate: "subscription_term_end",
      objectType: "DATE", dateValue: at(-24), validUntil: at(-24), provenance: "FIRST_PARTY", confidence: 0.8,
      slot: "billing", observedLastAt: new Date(Date.now() - 400 * DAY) });
    console.log("  ✓ Hooli — STALE DATE (term ended 24d ago)");

    // ── UNKNOWN — Cyberdyne deliberately untouched. ──
    console.log("  ✓ Cyberdyne — UNKNOWN (deliberately no lifecycle evidence)");

    // ── SPONSOR-CONFIDENTIAL — a RESTRICTED contract fact. Must never reach a partner payload. ──
    const wayne = await companyId(db, "Wayne");
    await putFact(db, { orgId: org, companyId: wayne, label: "Wayne Enterprises", predicate: "contract_expires",
      objectType: "DATE", dateValue: at(63), provenance: "FIRST_PARTY", confidence: 0.88, slot: "sponsor-only",
      disclosureNote: "SPONSOR_ONLY — negotiated contract term; not for partner disclosure." });
    console.log("  ✓ Wayne — sponsor-confidential contract date (partner payload must omit it)");

    // ── IMPORT BRIDGE — an import attribute promoted one-way into the graph. ──
    const acme = await companyId(db, "Acme");
    const pop = (await db.query<{ id: string }>(
      `select id from account_populations where org_id = $1 order by created_at limit 1`, [org])).rows[0];
    if (pop) {
      await db.query(
        `insert into population_members (population_id, company_id, attributes)
         values ($1, $2, jsonb_build_object('renewal_date', $3::text))
         on conflict (population_id, company_id) do update set attributes = population_members.attributes || excluded.attributes`,
        [pop.id, acme, at(41).toISOString().slice(0, 10)]);
      const report = await bridgeImportRenewals(db, org, { dataEnvironment: "DEMO" });
      console.log(`  ✓ Acme — import renewal bridged into the fact graph (${JSON.stringify(report)})`);
    }

    await db.query("commit");
    console.log("\nLifecycle demo story committed (DEMO environment, synthetic provenance).");
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
