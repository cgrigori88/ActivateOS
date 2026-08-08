/**
 * Computed confidence (invariant #2): a single model call never sets final
 * confidence. It is always extraction × source trust × corroboration.
 */

export interface ConfidenceInputs {
  extractionConfidence: number; // model's own confidence in the extraction
  sourceTrust: number;          // learned trust of the source (0.05–0.99)
  corroborations: number;       // independent sources making the same claim
  contradictions: number;       // independent sources contradicting it
  /** Confidence of an affirming model cross-check (stage [2]), if one ran. */
  crossCheckConfidence?: number | null;
}

const CORROBORATION_BOOST = 0.08; // per corroboration, capped at 3
const CONTRADICTION_PENALTY = 0.5; // multiplicative per contradiction
// The cross-check is an independent verification, so an affirming verdict
// boosts confidence like corroboration does. Calibrated so a PERFECT
// extraction from a brand-new source (trust 0.5) barely clears the verify
// threshold when the checker strongly agrees — weaker items still wait for
// human trust-building (no cold-start deadlock, no free pass).
const CROSS_CHECK_BOOST = 0.15;

export function computeConfidence(inputs: ConfidenceInputs): number {
  const { extractionConfidence, sourceTrust, corroborations, contradictions } = inputs;
  const base = extractionConfidence * sourceTrust;
  const corroborated = base * (1 + CORROBORATION_BOOST * Math.min(corroborations, 3));
  const crossChecked =
    inputs.crossCheckConfidence != null
      ? corroborated * (1 + CROSS_CHECK_BOOST * inputs.crossCheckConfidence)
      : corroborated;
  const penalized = crossChecked * Math.pow(CONTRADICTION_PENALTY, contradictions);
  return Math.max(0, Math.min(1, penalized));
}

/** Thresholds for the verification verdict. */
export const VERIFY_THRESHOLD = 0.55;
export const QUARANTINE_FLOOR = 0.25; // below this → rejected, not quarantined
