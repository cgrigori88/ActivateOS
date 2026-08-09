import type { ScorableSignal } from "./compute";
import { timeRelevance } from "./compute";

/**
 * Phase 1 multidimensional scoring (BLUEPRINT §6–8): pure, deterministic,
 * versioned. Dimensions are computed alongside — not folded into — the
 * composite propensity index, so each answers its own question.
 */

export const DIMENSION_VERSION = "v2-rules";

export interface DimensionResult {
  purchase_need: number;
  purchase_propensity: number;
  timing: number;
  solution_fit: number;
  evidence_confidence: number;
  corroboration: number;
  convergence: number;
}

export interface SignalWithSource extends ScorableSignal {
  sourceType: string;
}

const CONVERGENCE_WINDOW_DAYS = 90;

/**
 * Corroboration Score (BLUEPRINT §6): independent source types AND distinct
 * signal families both required — one source repeating itself, or one family
 * echoing, never corroborates. 0..1.
 */
export function corroborationScore(signals: SignalWithSource[]): number {
  const positive = signals.filter((s) => s.direction === 1);
  const sources = new Set(positive.map((s) => s.sourceType));
  const families = new Set(positive.map((s) => s.family));
  const sourceTerm = Math.min(3, sources.size - 1) * 0.2;
  const familyTerm = Math.min(3, families.size - 1) * 0.15;
  return Math.max(0, Math.min(1, sourceTerm + familyTerm));
}

/**
 * Signal Convergence Index (BLUEPRINT §7): share of distinct positive signal
 * families active within the trailing window ending at the freshest signal.
 * Clustered recency beats scattered history. 0..1.
 */
export function convergenceIndex(signals: SignalWithSource[], windowDays = CONVERGENCE_WINDOW_DAYS): number {
  const positive = signals.filter((s) => s.direction === 1);
  if (positive.length === 0) return 0;
  const latest = Math.max(...positive.map((s) => s.observedAt.getTime()));
  const windowStart = latest - windowDays * 86_400_000;
  const familiesAll = new Set(positive.map((s) => s.family));
  const familiesInWindow = new Set(
    positive.filter((s) => s.observedAt.getTime() >= windowStart).map((s) => s.family),
  );
  if (familiesAll.size === 0) return 0;
  // Requires at least two families in-window to register convergence at all.
  if (familiesInWindow.size < 2) return 0;
  return familiesInWindow.size / Math.max(familiesAll.size, familiesInWindow.size);
}

/** Contradiction detection v1 (BLUEPRINT §5–6): opposing directions on the same node or same base type. */
export interface ContradictionPair {
  a: SignalWithSource;
  b: SignalWithSource;
  basis: string;
}

export function detectContradictions(signals: SignalWithSource[]): ContradictionPair[] {
  const pairs: ContradictionPair[] = [];
  const positives = signals.filter((s) => s.direction === 1);
  const negatives = signals.filter((s) => s.direction === -1);
  for (const p of positives) {
    for (const n of negatives) {
      if (p.nodeSlug && p.nodeSlug === n.nodeSlug) {
        pairs.push({ a: p, b: n, basis: "opposing_direction_same_node" });
      }
    }
  }
  return pairs;
}

function familyStrength(
  signals: SignalWithSource[],
  families: string[],
  now: Date,
): { raw: number; count: number } {
  let raw = 0;
  let count = 0;
  for (const s of signals) {
    if (s.direction !== 1 || !families.includes(s.family)) continue;
    raw += s.magnitude * s.confidence * timeRelevance(s, now);
    count++;
  }
  return { raw, count };
}

export function computeDimensions(
  signals: SignalWithSource[],
  targetSlug: string,
  edgeWeights: Map<string, number>,
  compositeScore: number,
  now: Date = new Date(),
): DimensionResult {
  const corr = corroborationScore(signals);
  const conv = convergenceIndex(signals);

  // Solution fit: adjacency-weighted installed technology toward the target.
  let fitRaw = 0;
  for (const s of signals) {
    if (s.direction !== 1 || s.family !== "technology" || !s.nodeSlug) continue;
    if (s.nodeSlug === targetSlug) continue;
    const w = edgeWeights.get(s.nodeSlug);
    if (w) fitRaw += s.magnitude * s.confidence * timeRelevance(s, now) * w;
  }

  const need = familyStrength(signals, ["initiative"], now).raw +
    familyStrength(signals, ["trigger"], now).raw * 0.5;
  const trigger = familyStrength(signals, ["trigger"], now).raw;
  const momentum = familyStrength(signals, ["momentum"], now).raw;

  const positive = signals.filter((s) => s.direction === 1);
  const avgConfidence = positive.length
    ? positive.reduce((sum, s) => sum + s.confidence, 0) / positive.length
    : 0;

  const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  return {
    purchase_need: pct(need),
    purchase_propensity: Math.round(Math.max(0, Math.min(100, compositeScore))),
    timing: pct(Math.min(1, trigger) * 0.6 + conv * 0.25 + Math.min(1, momentum) * 0.15),
    solution_fit: pct(fitRaw),
    evidence_confidence: pct(avgConfidence * (0.6 + 0.4 * corr)),
    corroboration: pct(corr),
    convergence: pct(conv),
  };
}

/** Positive/negative evidence split (BLUEPRINT §5), in composite-score points. */
export function evidenceSplit(features: { contribution: number }[]): {
  positive: number;
  negative: number;
} {
  let positive = 0;
  let negative = 0;
  for (const f of features) {
    if (f.contribution >= 0) positive += f.contribution;
    else negative += f.contribution;
  }
  return { positive: Math.round(positive * 10) / 10, negative: Math.round(negative * 10) / 10 };
}

/** Refresh tier from band (BLUEPRINT §50). Returns days until next refresh. */
export function refreshIntervalDays(band: string): number {
  switch (band) {
    case "very_high": return 7;
    case "high": return 7;
    case "medium": return 21;
    default: return 45;
  }
}
