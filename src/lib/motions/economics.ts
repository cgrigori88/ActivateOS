/**
 * Motion economics v1 (BLUEPRINT Phase 3) — deterministic, from the play
 * template, never from a model. The play declares how deal value scales
 * with account size; the LLM never sees or invents a number. Expected value
 * couples economics to propensity so the portfolio ranks on what a motion
 * is worth × how likely the account is to move.
 */

export interface PlayEconomics {
  base_value_usd: number;
  value_per_employee_usd?: number;
  value_cap_usd?: number;
  /** 1 (light-touch) .. 5 (heavy pursuit) */
  effort: number;
}

export interface MotionEconomics {
  estimatedValueUsd: number;
  effort: number;
}

export function computeMotionEconomics(
  econ: PlayEconomics,
  employeeCount: number | null,
): MotionEconomics {
  let value = econ.base_value_usd;
  if (econ.value_per_employee_usd && employeeCount) {
    value += econ.value_per_employee_usd * employeeCount;
  }
  if (econ.value_cap_usd) value = Math.min(value, econ.value_cap_usd);
  return {
    estimatedValueUsd: Math.round(value),
    effort: Math.max(1, Math.min(5, Math.round(econ.effort))),
  };
}

/** Expected value: what the motion is worth, discounted by propensity. */
export function expectedValueUsd(estimatedValueUsd: number, propensityScore: number): number {
  return Math.round(estimatedValueUsd * Math.max(0, Math.min(100, propensityScore)) / 100);
}
