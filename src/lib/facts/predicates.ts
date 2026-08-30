import type { PoolClient } from "pg";
import type { ValueType } from "./identity";

/**
 * Fact predicate registry access (Workstream B, §2/§3/§12). The controlled vocabulary and
 * its promotion policy live in the DB (fact_predicates / fact_promotion_policies) as
 * governed data. This module loads and caches them and is the ONLY place code resolves a
 * predicate — an unresolved predicate key can never become a durable Fact (§29).
 */

export type FreshnessPolicy = "STATIC" | "EVENT" | "DECAYING" | "VALID_UNTIL" | "PERMANENT_HISTORY";
export type ContradictionStrategy = "NEGATION" | "COMPETING_VALUE" | "TEMPORAL_CONFLICT" | "SCOPE_CONFLICT" | "SOURCE_DISAGREEMENT";

export interface PredicateDef {
  key: string;
  displayName: string;
  subjectType: string;
  objectType: ValueType;
  defaultHalfLifeDays: number | null;
  freshnessPolicy: FreshnessPolicy;
  allowedProvenanceClasses: string[];
  supportsTiming: boolean;
  supportsPropensity: boolean;
  supportsSolutionFit: boolean;
  supportsPartnerActivation: boolean;
  supportsSellerActivation: boolean;
  contradictionStrategy: ContradictionStrategy;
  signalType: string | null;
  family: string | null;
}

export interface PromotionPolicy {
  predicateKey: string;
  minimumSupportCount: number;
  minimumTrust: number;
  firstPartyRequired: boolean;
  corroborationRequired: boolean;
  allowedProvenance: string[] | null;
  maximumAgeDays: number | null;
  autoPromoteAllowed: boolean;
  humanReviewRequired: boolean;
  version: number;
}

let predicateCache: Map<string, PredicateDef> | null = null;
let policyCache: Map<string, PromotionPolicy> | null = null;

export async function loadPredicates(db: PoolClient): Promise<Map<string, PredicateDef>> {
  if (predicateCache) return predicateCache;
  const { rows } = await db.query(
    `select key, display_name, subject_type, object_type, default_half_life_days, freshness_policy,
            allowed_provenance_classes, supports_timing, supports_propensity, supports_solution_fit,
            supports_partner_activation, supports_seller_activation, contradiction_strategy, signal_type, family
       from fact_predicates where status = 'active'`,
  );
  const m = new Map<string, PredicateDef>();
  for (const r of rows) {
    m.set(r.key, {
      key: r.key, displayName: r.display_name, subjectType: r.subject_type, objectType: r.object_type,
      defaultHalfLifeDays: r.default_half_life_days, freshnessPolicy: r.freshness_policy,
      allowedProvenanceClasses: r.allowed_provenance_classes ?? [], supportsTiming: r.supports_timing,
      supportsPropensity: r.supports_propensity, supportsSolutionFit: r.supports_solution_fit,
      supportsPartnerActivation: r.supports_partner_activation, supportsSellerActivation: r.supports_seller_activation,
      contradictionStrategy: r.contradiction_strategy, signalType: r.signal_type, family: r.family ?? null,
    });
  }
  predicateCache = m;
  return m;
}

export async function loadPolicies(db: PoolClient): Promise<Map<string, PromotionPolicy>> {
  if (policyCache) return policyCache;
  const { rows } = await db.query(
    `select distinct on (predicate_key) predicate_key, minimum_support_count, minimum_trust,
            first_party_required, corroboration_required, allowed_provenance, maximum_age_days,
            auto_promote_allowed, human_review_required, version
       from fact_promotion_policies order by predicate_key, version desc`,
  );
  const m = new Map<string, PromotionPolicy>();
  for (const r of rows) {
    m.set(r.predicate_key, {
      predicateKey: r.predicate_key, minimumSupportCount: r.minimum_support_count, minimumTrust: Number(r.minimum_trust),
      firstPartyRequired: r.first_party_required, corroborationRequired: r.corroboration_required,
      allowedProvenance: r.allowed_provenance, maximumAgeDays: r.maximum_age_days,
      autoPromoteAllowed: r.auto_promote_allowed, humanReviewRequired: r.human_review_required, version: r.version,
    });
  }
  policyCache = m;
  return m;
}

/** Signal-type → predicate map (deterministic promotion path, §5a). */
export async function predicateForSignalType(db: PoolClient, signalType: string): Promise<PredicateDef | null> {
  const preds = await loadPredicates(db);
  for (const p of preds.values()) if (p.signalType === signalType) return p;
  return null;
}

/** Test/hygiene helper — drop caches (e.g. between verification runs on different DBs). */
export function _resetPredicateCache() { predicateCache = null; policyCache = null; }
