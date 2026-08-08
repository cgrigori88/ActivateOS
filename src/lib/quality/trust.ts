/**
 * Plane 2/3: bounded source-trust learning (invariant #3).
 * Small-step EWMA with hard caps — no single verdict can move trust far.
 */

export const TRUST_FLOOR = 0.05;
export const TRUST_CEILING = 0.99;
const LEARNING_RATE = 0.05;
const MAX_STEP = 0.05;

/** Update trust from one human audit verdict (true = accurate). */
export function updateTrust(current: number, accurate: boolean): number {
  const target = accurate ? 1 : 0;
  const step = LEARNING_RATE * (target - current);
  const bounded = Math.max(-MAX_STEP, Math.min(MAX_STEP, step));
  return Math.max(TRUST_FLOOR, Math.min(TRUST_CEILING, current + bounded));
}

/**
 * Audit sample rate from trust: rate = clamp(0.02 + 0.6·(1 − trust)², 0.02, 0.5).
 * New/shaky sources get heavily sampled; proven sources decay to a 2% floor.
 */
export function auditSampleRate(trust: number): number {
  const rate = 0.02 + 0.6 * Math.pow(1 - trust, 2);
  return Math.max(0.02, Math.min(0.5, rate));
}
