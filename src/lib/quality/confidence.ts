/**
 * Computed confidence (invariant #2): a single model call never sets final
 * confidence. It is always extraction × source trust × corroboration.
 */

export interface ConfidenceInputs {
  extractionConfidence: number; // model's own confidence in the extraction
  sourceTrust: number;          // learned trust of the source (0.05–0.99)
  corroborations: number;       // independent sources making the same claim
  contradictions: number;       // independent sources contradicting it
}

const CORROBORATION_BOOST = 0.08; // per corroboration, capped at 3
const CONTRADICTION_PENALTY = 0.5; // multiplicative per contradiction

export function computeConfidence(inputs: ConfidenceInputs): number {
  const { extractionConfidence, sourceTrust, corroborations, contradictions } = inputs;
  const base = extractionConfidence * sourceTrust;
  const boosted = base * (1 + CORROBORATION_BOOST * Math.min(corroborations, 3));
  const penalized = boosted * Math.pow(CONTRADICTION_PENALTY, contradictions);
  return Math.max(0, Math.min(1, penalized));
}

/** Thresholds for the verification verdict. */
export const VERIFY_THRESHOLD = 0.55;
export const QUARANTINE_FLOOR = 0.25; // below this → rejected, not quarantined
