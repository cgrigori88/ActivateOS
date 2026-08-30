/**
 * TransactionSignalProvider (Workstream C, §34/§39). Generic distributor-intelligence
 * contract with three privacy-preserving modes — NO distributor-specific logic embedded:
 *   RAW       — authorized raw rows; PursuitOS computes features.
 *   DERIVED   — the distributor computes features and returns only normalized outputs.
 *   FEDERATED — PursuitOS sends a minimized permitted query; receives only allowed answers
 *               (present? recency? adjacency? relationship?) — never SKU/spend/invoice/margin.
 */

// Contribution modes (E3-C / R4/R5). RAW/DERIVED/FEDERATED plus ASSERTED (a human/
// system assertion) and AGGREGATED (k-anonymous aggregate). FEDERATED/ASSERTED/
// AGGREGATED do not require central custody of the source rows (R5).
export type ProviderMode = "RAW" | "DERIVED" | "FEDERATED" | "ASSERTED" | "AGGREGATED";
export type DataClassification = "PUBLIC" | "INTERNAL" | "PARTNER_SHARED" | "TRANSACTION_CONFIDENTIAL" | "PII" | "RESTRICTED";

export interface TransactionFeatureOut {
  featureKey: string;                 // category_spend_12m, category_spend_growth, purchase_recency, category_adjacency, ...
  featureValue: number | null;
  featureText?: string | null;
  observedPeriodStart?: Date | null;
  observedPeriodEnd?: Date | null;
  confidence: number;
  dataClassification: DataClassification;
}

export interface FeatureRequest {
  canonicalCompanyId: string;
  taxonomyNodeId?: string | null;
  partnerId?: string | null;
}

/** FEDERATED minimized answer — feature minimization (§39). */
export interface FederatedAnswer {
  present: boolean;
  recency?: "HIGH" | "MEDIUM" | "LOW";
  adjacency?: "HIGH" | "MEDIUM" | "LOW";
  relationship?: "STRONG" | "MODERATE" | "WEAK";
}

export interface TransactionSignalProvider {
  name: string;
  mode: ProviderMode;
  isSimulated: boolean;
  /** RAW/DERIVED: normalized features for a RESOLVED company (+optional category/partner). */
  fetchFeatures(req: FeatureRequest): Promise<TransactionFeatureOut[]>;
  /** FEDERATED: minimized query → allowed outputs only. Optional. */
  query?(req: FeatureRequest): Promise<FederatedAnswer>;
}
