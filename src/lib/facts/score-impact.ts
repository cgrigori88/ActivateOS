import type { PoolClient } from "pg";
import { loadPredicates } from "./predicates";
import { factsAsOf } from "./asof";
import type { Dimension, DimensionValue, Contribution } from "../pursuits/scoring";

/**
 * Fact → Pursuit score-impact (Workstream B, §24/§25). Facts influence scoring ONLY through
 * explicit, versioned predicate→dimension mappings — never "an agent thought it mattered,
 * +10". The Workstream A leakage guard is absolute: only facts knowable at the snapshot's
 * as-of time contribute, and every contribution carries featureObservedAt = fact.as_of, which
 * the scorer requires to be ≤ the snapshot as-of. Directional & versioned — no calibrated
 * probability is emitted.
 */

export const FACT_SCORE_VERSION = "v1-facts-directional";

interface EligibleFact {
  id: string; predicate_key: string; confidence: number; as_of: Date; polarity: number;
}

/** Build directional dimension values + per-fact contributions for a pursuit as-of `asOf`. */
export async function factsToContributions(
  db: PoolClient, pursuitId: string, companyId: string, asOf: Date,
): Promise<{ dimensions: DimensionValue[]; contributions: Contribution[] }> {
  const preds = await loadPredicates(db);
  const asof = await factsAsOf(db, companyId, asOf);       // leakage guard: as_of ≤ asOf already enforced
  const facts: EligibleFact[] = asof.map((f) => ({ id: f.id, predicate_key: f.predicate_key, confidence: f.confidence, as_of: f.as_of, polarity: f.polarity }));

  const contributions: Contribution[] = [];
  const acc = new Map<Dimension, number[]>();
  const add = (dim: Dimension, f: EligibleFact, sign = 1) => {
    // Absolute leakage assertion — never let a future fact through.
    if (f.as_of > asOf) return;
    const value = sign * f.confidence * 100;
    contributions.push({
      dimension: dim, featureName: `fact:${f.predicate_key}`, provenanceType: "fact",
      rawValue: f.confidence * 100, normalizedValue: f.confidence, weight: 1, contribution: value,
      evidenceReference: f.id, referenceKind: "fact", featureObservedAt: f.as_of,
    });
    if (!acc.has(dim)) acc.set(dim, []);
    acc.get(dim)!.push(Math.max(0, value));
  };

  for (const f of facts) {
    const p = preds.get(f.predicate_key);
    if (!p) continue;
    const contra = f.polarity === -1;
    if (contra) { add("evidence_confidence", f, -1); continue; }   // contradicting facts penalize, never netted silently
    if (p.supportsTiming) add("timing", f);
    if (p.supportsPropensity) add("purchase_propensity", f);
    if (p.supportsSolutionFit) add("solution_fit", f);
    if (p.supportsPartnerActivation) add("partner_activation", f);
    if (p.supportsSellerActivation) add("seller_activation", f);
    add("evidence_confidence", f);
  }

  const dimensions: DimensionValue[] = [];
  for (const [dim, vals] of acc.entries()) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    dimensions.push({ dimension: dim, value: clampScore(avg) });
  }
  // Priority is a directional roll-up of the contributing dimensions (never a probability).
  if (dimensions.length) {
    const priority = dimensions.reduce((a, d) => a + d.value, 0) / dimensions.length;
    dimensions.push({ dimension: "pursuit_priority", value: clampScore(priority) });
  }
  return { dimensions, contributions };
}

function clampScore(n: number): number { return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)); }
