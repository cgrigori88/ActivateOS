import { bandOf, type Caller } from "./helpers";
import { canDisclose } from "./pertinence";
import type { Band, DisclosureClass } from "./types";

/**
 * Portfolio Pertinence (P2) — "why THIS pursuit rather than another?"
 *
 * WHAT IT MEASURES. **Relative attention priority.** Not win probability, not account quality, not
 * forecast confidence. A pursuit ranks highly for any of four independent reasons — material
 * commercial potential, something important changed, a decision is waiting, or a consequential
 * context gap needs attention — so the top of this list is "what most deserves your next hour", and
 * a high rank is NEVER an absolute quality judgment.
 *
 * THE PRODUCT IS `#3 of 18 · Why here`. The numeric score exists for inspection and debugging; no
 * surface may lead with it, and a rank is never shown without its comparison-set size.
 *
 * WHY THIS IS A SIBLING OF `pertinence.ts`, NOT AN EXTENSION (D-017). `pertinence.ts` answers
 * "within this pursuit, what should I look at next?" and deliberately takes no cross-pursuit input.
 * These are different computations with different inputs and different consumers; conflating them
 * would produce a module that did neither well. This one mirrors its SHAPE — declared weights, every
 * contribution shown with its arithmetic, disclosure filtered before ranking — and nothing else.
 *
 * DETERMINISTIC, WITH NO MODEL. Every number below is explicit arithmetic over declared weights.
 * AI-derived evidence may exist upstream but enters only through its canonical provenance class.
 * Nothing here is persisted: the ranking is recomputed from canonical state on every read, so it
 * cannot drift from the world it describes.
 */

// ---------------------------------------------------------------------------
// Signal weights — declared, so the ranking can be argued with.
// ---------------------------------------------------------------------------

export const PORTFOLIO_SIGNAL_WEIGHT = {
  /** A decision is waiting on a person. A pursuit that is blocked ON YOU outranks a merely valuable one. */
  decisionPressure: 0.25,
  /** How much commercial significance is EVIDENCED here, relative to comparable pursuits. */
  commercialPriority: 0.30,
  /** How much reason there is to attend to this pursuit's context. Higher = more reason, not "risk is good". */
  contextNeed: 0.20,
  /** Recent material change, with a half-life rather than a cliff. */
  momentum: 0.15,
  /** Can this actually be progressed today? */
  activationReadiness: 0.10,
} as const;

export type PortfolioSignalKey = keyof typeof PORTFOLIO_SIGNAL_WEIGHT;

// ---------------------------------------------------------------------------
// Value basis — the rule that keeps two different economic quantities apart.
// ---------------------------------------------------------------------------

/**
 * `value/case.ts` §2 is explicit: the economic truths are NOT interchangeable and none is derived
 * from another to make them agree. `dealAmount` is "what the commercial deal is worth to us";
 * `modeledImpact` is "the customer's modeled business impact — NOT our revenue". So a modelled
 * $1.2M and a pipeline $1.2M are different quantities that happen to share a currency symbol, and
 * they are NEVER placed in one percentile cohort.
 */
export type ValueBasis = "PIPELINE" | "MODELED" | "UNESTABLISHED";

/**
 * How much commercial evidentiary weight a basis can bear.
 *
 * ── THIS IS A PRODUCT-POLICY WEIGHT. IT IS NOT A CONFIDENCE ESTIMATE OR A PROBABILITY. ──────────
 * 0.60 does NOT mean "60% confident" and does NOT mean "60% likely". It is a declared policy
 * decision, of the same species as the signal weights above: a defensible modelled customer-impact
 * case may contribute meaningfully to commercial attention, but it may not carry the same
 * commercial evidentiary weight as an actual recorded pipeline opportunity — because the latter
 * rests on a commercial commitment we have recorded, and the former has not yet been converted into
 * any commercial commitment at all.
 *
 * It is NOT a conversion rate from customer impact to vendor revenue. No such conversion exists in
 * this codebase, and inventing one is expressly out of scope. It is NOT calibrated, and it is NOT
 * altered dynamically in this slice.
 */
export const BASIS_EVIDENCE_WEIGHT: Record<ValueBasis, number> = {
  PIPELINE: 1.00,
  MODELED: 0.60,
  UNESTABLISHED: 0.00,
};

/** Split of `commercialPriority` between relative standing and closing proximity. */
export const COMMERCIAL_STANDING_WEIGHT = 0.70;
export const COMMERCIAL_PROXIMITY_WEIGHT = 0.30;

/**
 * Proximity for a pursuit with no close date to be late for. Deliberately NEUTRAL rather than zero:
 * a whitespace pursuit must not be penalised for lacking a CRM date it could not have.
 */
export const NEUTRAL_PROXIMITY = 0.35;

/** Beyond this horizon a close date carries no urgency. */
export const PROXIMITY_HORIZON_DAYS = 180;

/** Neutral standing: a cohort of one, or a cohort in which every magnitude is equal. */
export const NEUTRAL_STANDING = 0.5;

/** Momentum half-life, in days. Mirrors `pertinence.ts`'s recency treatment. */
export const MOMENTUM_HALF_LIFE_DAYS = 90;

/** Ledger materiality → how much a completed change counts as momentum. */
export const MATERIALITY_WEIGHT: Record<string, number> = {
  CRITICAL: 1.0, HIGH: 0.8, MEDIUM: 0.55, LOW: 0.3,
};

/**
 * Ledger events that OPEN a pending decision are excluded from momentum, because
 * `decisionPressure` already counts that same condition as pending state. Their RESOLUTIONS are
 * retained — those are things that happened.
 *
 *   decisionPressure counts what has NOT happened.   momentum counts what HAS.
 */
export const MOMENTUM_EXCLUDED_CHANGE_TYPES: ReadonlySet<string> = new Set([
  "PLAN_REVIEW_REQUIRED",
  "APPROVAL_REQUESTED",
  "ROUTE_RECOMMENDATION_CHANGED",
  "SELLER_RECOMMENDATION_CHANGED",
]);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A completed material change, already filtered of decision-opening events by the loader. */
export interface MomentumEvent { materiality: string; at: Date }

export interface PortfolioCandidate {
  pursuitId: string;
  accountLabel: string;
  label: string;
  disclosure: DisclosureClass;

  /** Pending decisions waiting on a person, with their own wording. */
  pendingDecisions: string[];

  valueBasis: ValueBasis;
  /** In its NATIVE meaning: stage-weighted pipeline value, or modelled customer impact. Never mixed. */
  magnitudeUsd: number | null;
  /** Soonest expected close across open opportunities. PIPELINE only. */
  daysToClose: number | null;

  /** 0..1 — how much reason there is to attend to this pursuit's context. */
  contextNeed: number;
  contextNeedReason: string;

  momentumEvents: MomentumEvent[];

  /** 0..1 — can this be progressed today (our side: seller, capacity, team roles, route confidence). */
  activationReadiness: number;
  activationReadinessReason: string;
}

export interface PortfolioPertinenceInput {
  caller: Caller;
  candidates: PortfolioCandidate[];
  /** THE single evaluation clock. Captured once per computation and passed to every clock-derived signal. */
  asOf: Date;
  /** A human-readable description of the active scope, always rendered beside the rank. */
  scope: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface PortfolioSignalContribution {
  key: PortfolioSignalKey;
  /** The raw signal, 0..1. */
  value: number;
  weight: number;
  /** value × weight — what this signal actually contributed. */
  contribution: number;
  reason: string;
}

/** Everything needed to explain the commercial signal without ever equating the two bases. */
export interface CommercialBasisView {
  basis: ValueBasis;
  /** How many pursuits this one was compared against — ITS OWN basis cohort, not the portfolio. */
  cohortSize: number;
  /** The magnitude in its native meaning. Null when nothing is established. */
  magnitudeUsd: number | null;
  /** What that number MEANS. Rendered verbatim so no surface invents its own wording. */
  magnitudeMeaning: string;
  basisEvidenceWeight: number;
  standing: number;
  proximity: number;
}

export interface PortfolioPertinentItem {
  pursuitId: string;
  accountLabel: string;
  label: string;
  /** 1-based, within the visible comparison set. */
  rank: number;
  /** 0..100. For inspection — never the headline. */
  score: number;
  band: Band;
  signals: PortfolioSignalContribution[];
  topReasons: string[];
  commercial: CommercialBasisView;
  /** Mechanically causal, derived from Δ contribution against the adjacent pursuit. Null at the ends. */
  comparedToBelow: string | null;
  /** True when this pursuit's total is exactly equal to its neighbour's. */
  tiedWithBelow: boolean;
  disclosure: DisclosureClass;
}

export interface PortfolioPertinenceView {
  items: PortfolioPertinentItem[];
  /** The visible comparison set size. A rank is meaningless without it. */
  comparisonSetSize: number;
  /** Removed before ranking — contributed nothing. A count only (D-018). */
  withheldCount: number;
  scope: string;
  asOf: string;
  /** Cohort sizes per basis, so a reader can see what each pursuit was compared against. */
  cohortSizes: Record<ValueBasis, number>;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Mid-rank percentile. Equal values receive EQUAL normalized values, and one extreme outlier
 * occupies exactly one rank position, so it cannot collapse everyone else toward zero.
 *
 *   n = 0  → the cohort is unused.
 *   n = 1  → NEUTRAL. A single pursuit has no portfolio to be relative to; ranking it at either
 *            extreme would be an invented claim.
 *   all equal → NEUTRAL, straight out of the formula, with no special case.
 */
export function midRankPercentile(x: number, cohort: number[]): number {
  const n = cohort.length;
  if (n <= 1) return NEUTRAL_STANDING;
  let below = 0, equal = 0;
  for (const v of cohort) { if (v < x) below++; else if (v === x) equal++; }
  return (below + (equal - 1) / 2) / (n - 1);
}

/** Days until close → urgency. Past due and closing-now are equally urgent. */
export function proximityOf(daysToClose: number | null): number {
  if (daysToClose == null) return NEUTRAL_PROXIMITY;
  if (daysToClose <= 0) return 1;
  if (daysToClose >= PROXIMITY_HORIZON_DAYS) return 0;
  return 1 - daysToClose / PROXIMITY_HORIZON_DAYS;
}

/** Materiality-weighted half-life decay. The strongest single event carries the signal. */
export function momentumOf(events: MomentumEvent[], asOf: Date): number {
  let best = 0;
  for (const e of events) {
    const w = MATERIALITY_WEIGHT[e.materiality] ?? MATERIALITY_WEIGHT.LOW;
    const ageDays = Math.max(0, (asOf.getTime() - e.at.getTime()) / 86_400_000);
    best = Math.max(best, w * Math.pow(0.5, ageDays / MOMENTUM_HALF_LIFE_DAYS));
  }
  return Math.max(0, Math.min(1, best));
}

const MAGNITUDE_MEANING: Record<ValueBasis, string> = {
  PIPELINE: "stage-weighted value of open opportunities",
  MODELED: "modelled customer business impact — not our revenue",
  UNESTABLISHED: "no commercial value established",
};

const SIGNAL_LABEL: Record<PortfolioSignalKey, string> = {
  decisionPressure: "a decision is waiting",
  commercialPriority: "commercial signal",
  contextNeed: "context needs attention",
  momentum: "recent movement",
  activationReadiness: "can be progressed",
};

// ---------------------------------------------------------------------------
// The ranking
// ---------------------------------------------------------------------------

export function rankPortfolioPertinence(input: PortfolioPertinenceInput): PortfolioPertinenceView {
  const { asOf } = input;

  // ── DISCLOSURE FILTERS FIRST (D-018) ───────────────────────────────────────────────────────────
  // Withheld pursuits are removed BEFORE the comparison set exists, so they cannot influence any
  // visible score, rank, neighbour or explanation — not even by occupying a cohort position.
  const visible: PortfolioCandidate[] = [];
  let withheldCount = 0;
  for (const c of input.candidates) {
    if (canDisclose(input.caller, c.disclosure)) visible.push(c); else withheldCount++;
  }

  // ── COHORTS — magnitudes are compared ONLY within their own basis ──────────────────────────────
  // log1p keeps the inspected values legible and monotone at 0; mid-rank percentile is invariant
  // under any monotone transform, so this changes ordering not at all.
  const cohort: Record<ValueBasis, number[]> = { PIPELINE: [], MODELED: [], UNESTABLISHED: [] };
  for (const c of visible) {
    if (c.valueBasis === "UNESTABLISHED") continue;
    cohort[c.valueBasis].push(Math.log1p(Math.max(0, c.magnitudeUsd ?? 0)));
  }

  const items: PortfolioPertinentItem[] = visible.map((c) => {
    const basis = c.valueBasis;
    const evidenceWeight = BASIS_EVIDENCE_WEIGHT[basis];
    const standing = basis === "UNESTABLISHED"
      ? 0
      : midRankPercentile(Math.log1p(Math.max(0, c.magnitudeUsd ?? 0)), cohort[basis]);
    const proximity = basis === "PIPELINE" ? proximityOf(c.daysToClose) : NEUTRAL_PROXIMITY;
    const commercialValue = evidenceWeight * (COMMERCIAL_STANDING_WEIGHT * standing + COMMERCIAL_PROXIMITY_WEIGHT * proximity);

    const pending = c.pendingDecisions.length > 0;
    const momentum = momentumOf(c.momentumEvents, asOf);

    const raw: Record<PortfolioSignalKey, { value: number; reason: string }> = {
      decisionPressure: {
        value: pending ? 1 : 0,
        reason: pending ? c.pendingDecisions.join("; ") : "Nothing is waiting on a decision",
      },
      commercialPriority: {
        value: commercialValue,
        reason: basis === "UNESTABLISHED"
          ? "No commercial value established"
          : `${MAGNITUDE_MEANING[basis]}: ${fmtUsd(c.magnitudeUsd)} — ${ordinalOf(standing, cohort[basis].length)}`,
      },
      contextNeed: { value: clamp01(c.contextNeed), reason: c.contextNeedReason },
      momentum: {
        value: momentum,
        reason: c.momentumEvents.length === 0 ? "No material change recorded" : momentumReason(c.momentumEvents, asOf),
      },
      activationReadiness: { value: clamp01(c.activationReadiness), reason: c.activationReadinessReason },
    };

    const signals: PortfolioSignalContribution[] = (Object.keys(PORTFOLIO_SIGNAL_WEIGHT) as PortfolioSignalKey[]).map((key) => {
      const weight = PORTFOLIO_SIGNAL_WEIGHT[key];
      return { key, value: raw[key].value, weight, contribution: raw[key].value * weight, reason: raw[key].reason };
    });
    const total = signals.reduce((s, x) => s + x.contribution, 0);

    const topReasons = [...signals]
      .filter((s) => s.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key))
      .slice(0, 2)
      .map((s) => s.reason);

    return {
      pursuitId: c.pursuitId, accountLabel: c.accountLabel, label: c.label,
      rank: 0,
      score: Math.round(total * 100),
      band: bandOf(Math.round(total * 100)),
      signals, topReasons,
      commercial: {
        basis, cohortSize: cohort[basis].length, magnitudeUsd: basis === "UNESTABLISHED" ? null : c.magnitudeUsd,
        magnitudeMeaning: MAGNITUDE_MEANING[basis], basisEvidenceWeight: evidenceWeight, standing, proximity,
      },
      comparedToBelow: null, tiedWithBelow: false, disclosure: c.disclosure,
    };
  });

  // Exact totals order the list; `pursuitId` is the FINAL deterministic tie-break and is never given
  // a business reason (see `comparedToBelow` below).
  const exact = new Map(items.map((i) => [i.pursuitId, i.signals.reduce((s, x) => s + x.contribution, 0)]));
  items.sort((a, b) => (exact.get(b.pursuitId)! - exact.get(a.pursuitId)!) || a.pursuitId.localeCompare(b.pursuitId));
  items.forEach((it, i) => { it.rank = i + 1; });

  // ── COMPARATIVE REASONS — mechanically causal ──────────────────────────────────────────────────
  // Derived ONLY from the difference in realised weighted contributions. A signal may be cited only
  // if it actually produced a positive differential. No attribute is cited for sounding plausible,
  // and no model generates any of this.
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i], b = items[i + 1];
    const ta = exact.get(a.pursuitId)!, tb = exact.get(b.pursuitId)!;
    if (ta === tb) {
      a.tiedWithBelow = true;
      a.comparedToBelow = `Tied with «${b.label}» on pertinence — ordered by identifier, which is a deterministic tie-break and not a judgment.`;
      continue;
    }
    const deltas = a.signals
      .map((s, idx) => ({ key: s.key, delta: s.contribution - b.signals[idx].contribution, reason: s.reason }))
      .filter((d) => d.delta > 0)
      .sort((x, y) => y.delta - x.delta || x.key.localeCompare(y.key));
    a.comparedToBelow = deltas.length === 0
      ? `Ahead of «${b.label}» on total pertinence, with no single signal accounting for it.`
      : `Ahead of «${b.label}» because ${deltas.slice(0, 2)
          .map((d) => `${SIGNAL_LABEL[d.key]} — ${d.reason} (Δ ${d.delta.toFixed(3)})`).join("; and ")}.`;
  }

  return {
    items: input.limit != null && input.limit >= 0 ? items.slice(0, input.limit) : items,
    comparisonSetSize: visible.length,
    withheldCount,
    scope: input.scope,
    asOf: asOf.toISOString(),
    cohortSizes: { PIPELINE: cohort.PIPELINE.length, MODELED: cohort.MODELED.length, UNESTABLISHED: 0 },
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const fmtUsd = (v: number | null) => v == null ? "not established"
  : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}K` : `$${Math.round(v)}`;
const ordinalOf = (standing: number, n: number) =>
  n <= 1 ? "the only pursuit on that basis" : `${Math.round(standing * 100)}th percentile of ${n} on that basis`;

function momentumReason(events: MomentumEvent[], asOf: Date): string {
  let best = events[0], bestScore = -1;
  for (const e of events) {
    const w = MATERIALITY_WEIGHT[e.materiality] ?? MATERIALITY_WEIGHT.LOW;
    const s = w * Math.pow(0.5, Math.max(0, (asOf.getTime() - e.at.getTime()) / 86_400_000) / MOMENTUM_HALF_LIFE_DAYS);
    if (s > bestScore) { bestScore = s; best = e; }
  }
  const days = Math.floor(Math.max(0, (asOf.getTime() - best.at.getTime()) / 86_400_000));
  return `${best.materiality} change ${days === 0 ? "today" : `${days}d ago`}`;
}
