/**
 * Deterministic, versioned Fact confidence (Workstream B, §4/§8). A single LLM call can
 * NEVER set fact.confidence — the model's extraction_confidence is at most one bounded
 * input. Durable confidence is computed from governed inputs: evidence/source trust,
 * verification state, source class, independent corroboration (source types AND families),
 * contradictions, and freshness. Multiplicative, mirroring src/lib/quality/confidence.ts.
 */

export const FACT_CONFIDENCE_MODEL_VERSION = "v1-facts-deterministic";

export interface ConfidenceInput {
  /** strongest supporting evidence's computed_confidence (0..1), or extraction confidence floor */
  baseSupport: number;
  /** trust of the strongest non-refuted source (0..1) */
  sourceTrust: number;
  /** count of independent supporting source TYPES (distinct source_type) */
  independentSourceTypes: number;
  /** count of independent supporting FAMILIES */
  independentFamilies: number;
  /** count of contradicting evidence/facts */
  contradictionCount: number;
  /** freshness factor 0..1 (decay of most-recent observation), 1 for timeless facts */
  freshness: number;
  /** true if any first-party / customer-declared source supports it */
  firstParty: boolean;
}

const K_CORROB = 0.08;
const K_FAMILY = 0.06;
const FIRST_PARTY_BONUS = 1.1;

export function computeFactConfidence(i: ConfidenceInput): { confidence: number; modelVersion: string } {
  const corrob = 1 + K_CORROB * Math.min(Math.max(i.independentSourceTypes - 1, 0), 3);
  const family = 1 + K_FAMILY * Math.min(Math.max(i.independentFamilies - 1, 0), 3);
  const contradictionPenalty = Math.pow(0.5, Math.max(i.contradictionCount, 0));
  const fp = i.firstParty ? FIRST_PARTY_BONUS : 1;
  const raw = i.baseSupport * i.sourceTrust * corrob * family * contradictionPenalty * fp * clamp01(i.freshness);
  return { confidence: clamp01(raw), modelVersion: FACT_CONFIDENCE_MODEL_VERSION };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
