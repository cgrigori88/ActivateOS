import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Renewal-radar reconciliation (P2A §5). The design audit found TWO renewal truths:
 *
 *   1. `population_members.attributes->>'renewal_date'` — an import JSON blob, read directly by the
 *      divergence engine's `renewal_uncovered` finding;
 *   2. canonical `renewal_date` / `contract_expires` facts in the fact graph.
 *
 * They were interpreted independently, so an account could carry two renewal dates with no
 * reconciliation and no provenance ladder. This bridge makes the FACT GRAPH AUTHORITATIVE while
 * discarding nothing:
 *
 *   · every import attribute is promoted INTO the graph as a fact, one-way;
 *   · provenance is preserved honestly — a partner/import list is `SECOND_PARTY` when it came from a
 *     partner-owned population, otherwise `THIRD_PARTY_UNVERIFIED`. Neither is trusted for a precise
 *     date, so the import lands on `renewal_window` (RANGE) and reads as an INFERRED WINDOW. An
 *     imported spreadsheet date can therefore never masquerade as a confirmed renewal;
 *   · the original source is preserved: `data_lineage` records the population and the raw value;
 *   · uncertainty is preserved: the window brackets the imported date rather than asserting it;
 *   · contradictions are preserved: if the graph already holds a DIFFERENT date from a trusted
 *     source, the import does NOT overwrite it — the derivation surfaces both as CONFLICTING.
 *
 * Idempotent: `fact_identity_key` is derived from (org, company, predicate, source population), so
 * re-running updates the same slot instead of accumulating duplicates.
 *
 * DEBT (documented, not expanded): this is a ONE-WAY compatibility bridge run on demand. A full
 * ingestion rewrite — promoting import attributes through `fact_candidates` with the normal review
 * queue — is the correct long-term path and is deliberately out of this slice's scope.
 */

export interface BridgeReport {
  scanned: number;
  promoted: number;
  skippedTrustedDateExists: number;
  skippedUnparseable: number;
}

/** Window half-width around an imported date: an import tells us roughly when, not exactly when. */
const WINDOW_PAD_DAYS = 15;

export async function bridgeImportRenewals(
  db: PoolClient, orgId: string, opts: { dataEnvironment?: string } = {},
): Promise<BridgeReport> {
  const env = opts.dataEnvironment ?? "PRODUCTION";
  const report: BridgeReport = { scanned: 0, promoted: 0, skippedTrustedDateExists: 0, skippedUnparseable: 0 };

  const { rows } = await db.query<{
    company_id: string; legal_name: string; raw: string; population_id: string; population_name: string; partner_id: string | null;
  }>(
    `select distinct on (pm.company_id, ap.id)
            pm.company_id, c.legal_name, pm.attributes->>'renewal_date' raw,
            ap.id population_id, ap.name population_name, ap.partner_id
       from population_members pm
       join account_populations ap on ap.id = pm.population_id and ap.org_id = $1
       join companies c on c.id = pm.company_id
      where pm.attributes ? 'renewal_date'
      order by pm.company_id, ap.id, pm.created_at desc nulls last`,
    [orgId]);

  for (const r of rows) {
    report.scanned++;
    const parsed = new Date(r.raw);
    if (Number.isNaN(parsed.getTime())) { report.skippedUnparseable++; continue; }

    // A trusted, current, precise date already in the graph outranks an import. Do NOT overwrite it
    // and do NOT silently drop the import — record it so the derivation can show the disagreement.
    const trusted = (await db.query<{ id: string; date_value: Date | null }>(
      `select id, date_value from facts
        where org_id = $1 and company_id = $2 and status = 'CURRENT'
          and predicate_key in ('renewal_date','contract_expires','subscription_term_end')
          and provenance_class in ('FIRST_PARTY','SECOND_PARTY','CUSTOMER_DECLARED','HUMAN_ASSERTED')
        limit 1`, [orgId, r.company_id])).rows[0];

    const sameDay = trusted?.date_value && trusted.date_value.toISOString().slice(0, 10) === parsed.toISOString().slice(0, 10);
    if (trusted && sameDay) { report.skippedTrustedDateExists++; continue; }   // nothing new to say

    const from = new Date(parsed.getTime() - WINDOW_PAD_DAYS * 86_400_000);
    const to = new Date(parsed.getTime() + WINDOW_PAD_DAYS * 86_400_000);
    // Partner-supplied lists are SECOND_PARTY; anything else imported is unverified third-party.
    // Neither is permitted a precise date by the 0098 registry — both land as a window.
    const provenance = r.partner_id ? "SECOND_PARTY" : "THIRD_PARTY_UNVERIFIED";
    const identity = `${orgId}:${r.company_id}:renewal_window:import:${r.population_id}`;
    const valueKey = `${identity}:${parsed.toISOString().slice(0, 10)}`;

    await db.query(
      `insert into facts (
         id, org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
         object_type, object_value, valid_from, valid_until,
         polarity, status, confidence, provenance_class, origin_kind,
         as_of, observed_at, observed_first_at, observed_last_at,
         freshness_policy, half_life_days, family,
         fact_identity_key, fact_value_key, data_environment, data_lineage, is_simulated,
         created_by_actor_type, created_via)
       values (
         $1, $2, 'COMPANY', $3, $4, $3, 'renewal_window',
         'RANGE', $5::jsonb, $6, $7,
         1, 'CURRENT', 0.45, $8, 'IMPORT',
         now(), now(), now(), now(),
         'DECAYING', 270, 'trigger',
         $9, $10, $11, $12::jsonb, $13,
         'SYSTEM', 'lifecycle-import-bridge')
       on conflict (org_id, fact_identity_key) where status = 'CURRENT'
       do update set valid_from = excluded.valid_from, valid_until = excluded.valid_until,
                     object_value = excluded.object_value, observed_last_at = now(),
                     as_of = now(), data_lineage = excluded.data_lineage`,
      [
        randomUUID(), orgId, r.company_id, r.legal_name,
        JSON.stringify({ from: from.toISOString(), to: to.toISOString(), imported_value: r.raw }),
        from, to, provenance,
        identity, valueKey, env,
        JSON.stringify({ source: "population_members.attributes.renewal_date", population_id: r.population_id, population_name: r.population_name, raw: r.raw }),
        env !== "PRODUCTION",
      ]);
    report.promoted++;
  }
  return report;
}
