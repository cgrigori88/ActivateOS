import { STAGE_PROBABILITY, STAGES, type Stage } from "../opportunities/lifecycle";

/**
 * Stage-probability calibration (BLUEPRINT Phase 7): compare the DECLARED
 * v1 stage probabilities against OBSERVED outcomes. Below the minimum
 * sample size we say "insufficient data" — a two-deal win rate is noise,
 * and acting on noise is exactly the drift this system is built to prevent.
 * When a divergence is real, it becomes a change PROPOSAL for a human, not
 * a silent weight update.
 */

export const MIN_SAMPLE = 10;
export const DIVERGENCE_THRESHOLD = 0.15; // propose review beyond ±15 points

export interface ClosedOpportunity {
  /** every open stage this opportunity passed through (from its transitions) */
  stagesReached: Stage[];
  won: boolean;
}

export interface StageCalibration {
  stage: Stage;
  declared: number;
  observed: number | null; // null until MIN_SAMPLE reached
  sample: number;
  divergent: boolean;
}

export function calibrateStages(closed: ClosedOpportunity[]): StageCalibration[] {
  return STAGES.map((stage) => {
    const reached = closed.filter((o) => o.stagesReached.includes(stage));
    const sample = reached.length;
    const observed =
      sample >= MIN_SAMPLE
        ? Math.round((reached.filter((o) => o.won).length / sample) * 100) / 100
        : null;
    const declared = STAGE_PROBABILITY[stage];
    return {
      stage,
      declared,
      observed,
      sample,
      divergent: observed != null && Math.abs(observed - declared) > DIVERGENCE_THRESHOLD,
    };
  });
}

/**
 * Seller-edit intensity (founder decision Phase 5 §11): how heavily do
 * humans rework AI drafts? Normalized 0..1 per message (edit distance over
 * draft length, capped) then averaged — the messaging learning loop's
 * first-order signal.
 */
export function editIntensity(
  edits: { editDistance: number; draftLength: number }[],
): number | null {
  if (edits.length === 0) return null;
  const per = edits.map((e) =>
    e.draftLength === 0 ? 1 : Math.min(1, e.editDistance / e.draftLength),
  );
  return Math.round((per.reduce((a, b) => a + b, 0) / per.length) * 100) / 100;
}
