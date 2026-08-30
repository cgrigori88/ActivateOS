import type { PoolClient } from "pg";
import type { TransactionFeatureOut } from "./provider";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Transaction feature persistence + scoring (Workstream C, §21/§31/§37). Features carry full
 * provenance/lineage; a feature whose company identity is UNRESOLVED (canonical_company_id
 * null) must never influence a route score (§31). Synthetic features stay lineage-isolated so
 * nothing from a demo enters production learning.
 */

export async function ingestFeatures(
  db: PoolClient, orgId: string, providerId: string | null, mode: string,
  canonicalCompanyId: string | null, taxonomyNodeId: string | null, partnerId: string | null,
  features: TransactionFeatureOut[], env: DataEnvironment = "PRODUCTION", isSimulated = false,
): Promise<number> {
  let n = 0;
  for (const f of features) {
    await db.query(
      `insert into transaction_features
         (org_id, provider_id, mode, canonical_company_id, taxonomy_node_id, partner_id, feature_key,
          feature_value, feature_text, observed_period_start, observed_period_end, confidence,
          data_classification, source_lineage, data_environment, is_simulated)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [orgId, providerId, mode, canonicalCompanyId, taxonomyNodeId, partnerId, f.featureKey, f.featureValue,
       f.featureText ?? null, f.observedPeriodStart ?? null, f.observedPeriodEnd ?? null, f.confidence,
       f.dataClassification, JSON.stringify({ mode, provider: providerId }), env, isSimulated],
    );
    n++;
  }
  await recordChange(db, {
    orgId, pursuitId: null, entityType: "transaction", entityId: canonicalCompanyId,
    changeType: "TRANSACTION_SIGNAL_INGESTED", materiality: "LOW",
    reason: `${n} transaction feature(s) ingested (${mode})`, actorType: "WORKER",
    triggerType: "SCHEDULED_REFRESH", dataEnvironment: env, after: { count: n, isSimulated },
  });
  return n;
}

export interface TransactionScore { score01: number; confidence: number; available: boolean; features: { key: string; value: number | null; classification: string }[]; }

/**
 * Deterministic transaction-adjacency score for a (company, category, partner). Only RESOLVED
 * features contribute. Returns available=false (neutral, lower route confidence) when there is
 * no reliable transaction signal — never invents a value (§53).
 */
export async function transactionScore(
  db: PoolClient, orgId: string, companyId: string, taxonomyNodeId: string | null, partnerId: string | null,
): Promise<TransactionScore> {
  const { rows } = await db.query<{ feature_key: string; feature_value: string | null; confidence: string; data_classification: string }>(
    `select feature_key, feature_value, confidence, data_classification
       from transaction_features
      where org_id = $1 and canonical_company_id = $2
        and (taxonomy_node_id is null or $3::uuid is null or taxonomy_node_id = $3)
        and ($4::uuid is null or partner_id is null or partner_id = $4)`,
    [orgId, companyId, taxonomyNodeId, partnerId],
  );
  if (!rows.length) return { score01: 0.5, confidence: 0, available: false, features: [] };

  // Weighted blend of the adjacency-relevant features (normalized 0..1).
  const w: Record<string, number> = { category_adjacency: 0.35, purchase_recency: 0.25, category_spend_growth: 0.2, purchase_frequency: 0.1, partner_tenure: 0.1 };
  let num = 0, den = 0, conf = 0;
  const feats: TransactionScore["features"] = [];
  for (const r of rows) {
    const v = r.feature_value != null ? Number(r.feature_value) : null;
    feats.push({ key: r.feature_key, value: v, classification: r.data_classification });
    const weight = w[r.feature_key];
    if (weight != null && v != null) { num += weight * clamp01(v); den += weight; conf = Math.max(conf, Number(r.confidence)); }
  }
  const score01 = den > 0 ? num / den : 0.5;
  return { score01, confidence: conf, available: den > 0, features: feats };
}

function clamp01(n: number): number { return Math.min(1, Math.max(0, n)); }
