import { factFreshness } from "@/lib/facts/freshness";
import type { FreshnessPolicy } from "@/lib/facts/predicates";
import { computeCompleteness, type CompletenessResult, type CoverageCategory } from "@/lib/intel/completeness";
import { bandOf } from "./helpers";
import type { Band, ScoreReason, TrustLabel } from "./types";

/**
 * Pursuit Context Health (vNext Slice 1, chunk 1).
 *
 * Answers "how trustworthy and useful is the context behind THIS pursuit, right
 * now?" by composing primitives that already exist. It deliberately computes no
 * freshness curve, no coverage rule and no materiality policy of its own:
 *
 *   freshness  → `factFreshness()` (src/lib/facts/freshness.ts), which is
 *                predicate-specific rather than one global half-life;
 *   coverage   → `computeCompleteness()` (src/lib/intel/completeness.ts), which
 *                is deliberately separate from propensity — missing data is not
 *                low intent;
 *   banding    → `bandOf()` (./helpers), so a health band means the same thing a
 *                score band means everywhere else in the product.
 *
 * WHY THIS IS NOT ONE OPAQUE NUMBER. An overall figure is reported, because the
 * product's canonical idiom is band-first with the exact value secondary. But the
 * figure never travels alone: every dimension keeps its own band, and every
 * deduction keeps a `ScoreReason` naming the fact or category responsible, with
 * its ref. A surface can therefore always answer "why is this amber?" without
 * recomputing anything. Flattening the reasons away would make the health figure
 * unexplainable, which is the failure this product exists to avoid.
 *
 * THE CONCLUSION VOCABULARY IS BORROWED, NOT INVENTED. Three domains already
 * express a four-way conclusion that separates verified / inferred / degraded /
 * absent: `ValueCaseState` (STRONG · INCOMPLETE · CONFLICTING · NOT_ESTABLISHED),
 * `CoverageState` (VERIFIED · INFERRED · UNVERIFIED · MISSING) and lifecycle
 * (VERIFIED_DATE · INFERRED_WINDOW · STALE_DATE · CONFLICTING_DATE). Context
 * health uses the same shape so the product keeps one mental model.
 *
 * NOT ESTABLISHED ≠ UNHEALTHY. A pursuit with no linked facts is not scored 0 —
 * it returns `NOT_ESTABLISHED` with `overall: null`. `unknown` is a first-class
 * band here exactly as it is for every other score (§17/§41): an absent
 * measurement and a bad measurement are different claims and must look different.
 *
 * Pure and deterministic: same inputs, same output. No database access, no clock
 * of its own (`now` is injected), no model involvement, no writes.
 */

// ---------------------------------------------------------------------------
// Inputs — shaped to match what the canonical tables already hold, so the chunk-5
// loader is a mechanical projection of `facts` ⋈ `pursuit_facts` with no
// reinterpretation in between.
// ---------------------------------------------------------------------------

/** `pursuit_facts.relevance_type` (migration 0066, widened by 0072). */
export type FactRelevanceType =
  | "PRIMARY_TRIGGER" | "SUPPORTING_CONTEXT" | "TIMING_ANCHOR" | "SOLUTION_FIT"
  | "PARTNER_ROUTE" | "RISK" | "CONTRADICTION" | "CONTRADICTING" | "BACKGROUND";

/** `facts.status` (migration 0070). CANDIDATE lives in `fact_candidates`, not here. */
export type FactStatus = "CURRENT" | "DISPUTED" | "STALE" | "SUPERSEDED" | "EXPIRED" | "REJECTED";

/** `facts.provenance_class` (migration 0070). */
export type ProvenanceClass =
  | "FIRST_PARTY" | "SECOND_PARTY" | "THIRD_PARTY_VERIFIED" | "THIRD_PARTY_UNVERIFIED"
  | "INFERRED" | "CUSTOMER_DECLARED" | "HUMAN_ASSERTED";

/** One fact linked to the pursuit, with the columns health actually depends on. */
export interface ContextFactInput {
  factId: string;
  predicateKey: string;
  label: string;
  relevance: FactRelevanceType;
  status: FactStatus;
  /** `facts.confidence`, 0..1. */
  confidence: number;
  provenanceClass: ProvenanceClass;
  freshnessPolicy: FreshnessPolicy;
  observedLastAt: Date;
  halfLifeDays: number | null;
  validUntil?: Date | null;
  occurredAt?: Date | null;
  /** True when `superseded_by` is set — the fact has been replaced by a newer belief. */
  superseded?: boolean;
}

export interface ContextHealthInput {
  pursuitId: string;
  facts: ContextFactInput[];
  /** Passed straight to `computeCompleteness` — this module does not redefine coverage. */
  completeness: { providersRun: Set<string>; familiesPresent: Set<string> };
  /**
   * Coverage categories this pursuit's use-case actually depends on. A
   * virtualization-exit pursuit needs `timing` and `technology`; it does not need
   * `hiring`. Empty ⇒ judge against every category, which is the honest default
   * when the dependency is unknown.
   */
  requiredCategories?: CoverageCategory[];
  /**
   * Count of unresolved contradictions recorded against this pursuit's context
   * (`fact_contradictions`). Kept as a count rather than re-derived here so this
   * module never becomes a second contradiction detector.
   */
  openContradictions?: number;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Policy — explicit, inspectable, deterministic.
// ---------------------------------------------------------------------------

/**
 * How much each relevance type contributes to health. A stale TIMING_ANCHOR is a
 * far bigger problem than a stale BACKGROUND fact, and health must say so.
 * CONTRADICTION/CONTRADICTING carry weight because an unresolved disagreement is
 * a health signal in its own right, not noise to be averaged away.
 */
export const RELEVANCE_WEIGHT: Record<FactRelevanceType, number> = {
  PRIMARY_TRIGGER: 1.0,
  TIMING_ANCHOR: 1.0,
  RISK: 0.8,
  CONTRADICTION: 0.8,
  CONTRADICTING: 0.8,
  SOLUTION_FIT: 0.7,
  PARTNER_ROUTE: 0.7,
  SUPPORTING_CONTEXT: 0.5,
  BACKGROUND: 0.2,
};

/**
 * Provenance → corroboration strength, 0..1. Mirrors the ordering the promotion
 * policy already enforces (first-party and verified third-party outrank
 * unverified and inferred).
 */
export const PROVENANCE_STRENGTH: Record<ProvenanceClass, number> = {
  FIRST_PARTY: 1.0,
  CUSTOMER_DECLARED: 0.95,
  THIRD_PARTY_VERIFIED: 0.85,
  HUMAN_ASSERTED: 0.7,
  SECOND_PARTY: 0.7,
  THIRD_PARTY_UNVERIFIED: 0.45,
  INFERRED: 0.3,
};

/** A fact in one of these states is no longer a live basis for a decision. */
const DEGRADED_STATUS: ReadonlySet<FactStatus> = new Set<FactStatus>(["STALE", "SUPERSEDED", "EXPIRED"]);

/** Below this, a fact counts as stale for reporting purposes. Matches `sweepFreshness`. */
export const STALE_FRESHNESS_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type ContextHealthDimensionKey = "freshness" | "corroboration" | "coverage" | "consistency" | "currency";

export interface ContextHealthDimension {
  key: ContextHealthDimensionKey;
  label: string;
  /** 0..100, or null when there is nothing to measure — never coerced to 0. */
  value: number | null;
  band: Band;
  known: boolean;
  definition: string;
  /** Named, ref-carrying reasons. This is what makes the band explainable. */
  why: ScoreReason[];
}

/**
 * Typed conclusion key, NOT display copy. The UI owns the wording; this owns the
 * judgement. Deliberately parallel to `ValueCaseState` / `CoverageState`.
 */
export type ContextHealthConclusion =
  | "VERIFIED"         // well-corroborated, fresh, covered
  | "INFERRED"         // holds together, but leans on inference or thin provenance
  | "NEEDS_VALIDATION" // real gaps in coverage or corroboration
  | "STALE"            // the context was good and has aged out
  | "CONFLICTING"      // unresolved disagreement dominates
  | "NOT_ESTABLISHED"; // nothing linked yet — unknown, not bad

export interface ContextHealthConcern {
  kind: "STALE_FACT" | "SUPERSEDED_FACT" | "DISPUTED_FACT" | "WEAK_PROVENANCE" | "MISSING_COVERAGE" | "OPEN_CONTRADICTION";
  /** Which dimension this concern drags down. */
  dimension: ContextHealthDimensionKey;
  text: string;
  refType: "fact" | "coverage_category" | "pursuit";
  refId: string | null;
  /** Relevance weight of the affected fact — lets a surface show the worst first. */
  weight: number;
}

export interface ContextHealthView {
  pursuitId: string;
  /** 0..100, or null when NOT_ESTABLISHED. Never a substitute for `dimensions`. */
  overall: number | null;
  band: Band;
  conclusion: ContextHealthConclusion;
  dimensions: ContextHealthDimension[];
  /** Ranked worst-first. The "why" behind the conclusion, with refs. */
  concerns: ContextHealthConcern[];
  /** Trust labels present across the linked facts — reuses the canonical vocabulary. */
  trust: TrustLabel[];
  factsConsidered: number;
  /** Facts excluded from scoring because they are REJECTED (not a health signal). */
  factsExcluded: number;
  coverage: CompletenessResult;
  computedAt: string;
}

const DEFINITIONS: Record<ContextHealthDimensionKey, { label: string; definition: string }> = {
  freshness: { label: "Freshness", definition: "How current the supporting facts are, weighted by how much each one matters to this pursuit." },
  corroboration: { label: "Corroboration", definition: "How strongly the supporting facts are evidenced, from their confidence and provenance." },
  coverage: { label: "Coverage", definition: "How many of the context categories this pursuit depends on have been researched at all." },
  consistency: { label: "Consistency", definition: "Whether the supporting facts agree, or carry unresolved disagreement." },
  currency: { label: "Currency", definition: "Whether the supporting facts are still live beliefs, rather than superseded or expired ones." },
};

function dim(key: ContextHealthDimensionKey, value: number | null, why: ScoreReason[]): ContextHealthDimension {
  return {
    key, label: DEFINITIONS[key].label, definition: DEFINITIONS[key].definition,
    value: value == null ? null : Math.round(value),
    band: bandOf(value), known: value != null, why,
  };
}

const pct = (n: number): number => Math.max(0, Math.min(100, n * 100));

/**
 * Weighted mean that returns null (not 0) for an empty set, so "nothing to
 * measure" stays distinguishable from "measured and bad".
 */
function weightedMean(items: { value: number; weight: number }[]): number | null {
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight <= 0) return null;
  return items.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight;
}

/**
 * Compute context health for one pursuit.
 *
 * REJECTED facts are excluded entirely rather than scored as bad: a rejected
 * claim is one the system correctly declined to believe, which is the process
 * working, not context decaying. They are counted in `factsExcluded` so the
 * exclusion is visible rather than silent.
 */
export function computeContextHealth(input: ContextHealthInput): ContextHealthView {
  const now = input.now ?? new Date();
  const computedAt = now.toISOString();
  const coverage = computeCompleteness(input.completeness);

  const scored = input.facts.filter((f) => f.status !== "REJECTED");
  const factsExcluded = input.facts.length - scored.length;
  const openContradictions = input.openContradictions ?? 0;
  const concerns: ContextHealthConcern[] = [];
  const trust = new Set<TrustLabel>();

  // --- coverage: computed even with no facts, since it measures research effort,
  // not belief. Restricted to the categories this pursuit actually depends on.
  const required = input.requiredCategories?.length ? input.requiredCategories : null;
  const coverageMissing = required
    ? required.filter((c) => !coverage.byCategory[c])
    : coverage.gaps;
  const coverageDenominator = required ? required.length : Object.keys(coverage.byCategory).length;
  const coverageValue = coverageDenominator > 0
    ? ((coverageDenominator - coverageMissing.length) / coverageDenominator) * 100
    : null;
  const coverageWhy: ScoreReason[] = coverageMissing.map((c) => ({
    text: `No ${c} context researched yet`, polarity: -1, strength: "missing", refType: "coverage_category", refId: c,
  }));
  for (const c of coverageMissing) {
    concerns.push({ kind: "MISSING_COVERAGE", dimension: "coverage", text: `No ${c} context researched yet`, refType: "coverage_category", refId: c, weight: 0.6 });
  }
  if (!coverageMissing.length && coverageDenominator > 0) {
    coverageWhy.push({ text: "Every context category this pursuit depends on has been researched", polarity: 1, strength: "strong" });
  }

  // --- no linked facts: honest UNKNOWN, not a zero.
  if (scored.length === 0) {
    return {
      pursuitId: input.pursuitId,
      overall: null, band: "unknown", conclusion: "NOT_ESTABLISHED",
      dimensions: [
        dim("freshness", null, [{ text: "No facts linked to this pursuit yet", polarity: 0, strength: "missing" }]),
        dim("corroboration", null, [{ text: "No facts linked to this pursuit yet", polarity: 0, strength: "missing" }]),
        dim("coverage", coverageValue, coverageWhy),
        dim("consistency", null, [{ text: "No facts linked to this pursuit yet", polarity: 0, strength: "missing" }]),
        dim("currency", null, [{ text: "No facts linked to this pursuit yet", polarity: 0, strength: "missing" }]),
      ],
      concerns, trust: [], factsConsidered: 0, factsExcluded, coverage, computedAt,
    };
  }

  // --- per-fact measures ------------------------------------------------------
  const freshParts: { value: number; weight: number }[] = [];
  const corrobParts: { value: number; weight: number }[] = [];
  const currencyParts: { value: number; weight: number }[] = [];
  const consistencyParts: { value: number; weight: number }[] = [];
  const freshWhy: ScoreReason[] = [];
  const corrobWhy: ScoreReason[] = [];
  const currencyWhy: ScoreReason[] = [];
  const consistencyWhy: ScoreReason[] = [];

  for (const f of scored) {
    const weight = RELEVANCE_WEIGHT[f.relevance] ?? 0.5;

    const fresh = factFreshness({
      freshnessPolicy: f.freshnessPolicy, observedLastAt: f.observedLastAt,
      halfLifeDays: f.halfLifeDays, validUntil: f.validUntil ?? null,
      occurredAt: f.occurredAt ?? null, now,
    });
    freshParts.push({ value: pct(fresh), weight });
    if (fresh < STALE_FRESHNESS_THRESHOLD || f.status === "STALE") {
      trust.add("STALE");
      const text = `${f.label} has aged past its useful window`;
      freshWhy.push({ text, polarity: -1, strength: "missing", refType: "fact", refId: f.factId });
      concerns.push({ kind: "STALE_FACT", dimension: "freshness", text, refType: "fact", refId: f.factId, weight });
    }

    const provenance = PROVENANCE_STRENGTH[f.provenanceClass] ?? 0.45;
    // Confidence and provenance are both required: a confident inference is still
    // an inference, and a first-party claim with no confidence is still weak.
    const corrob = Math.max(0, Math.min(1, f.confidence)) * provenance;
    corrobParts.push({ value: pct(corrob), weight });
    if (provenance <= 0.45) {
      const text = `${f.label} rests on ${f.provenanceClass === "INFERRED" ? "inference" : "unverified third-party data"}`;
      corrobWhy.push({ text, polarity: -1, strength: "missing", refType: "fact", refId: f.factId });
      concerns.push({ kind: "WEAK_PROVENANCE", dimension: "corroboration", text, refType: "fact", refId: f.factId, weight });
    }
    if (f.provenanceClass === "FIRST_PARTY") trust.add("FIRST_PARTY");
    if (f.provenanceClass === "HUMAN_ASSERTED") trust.add("HUMAN_ASSERTED");
    if (f.provenanceClass === "THIRD_PARTY_UNVERIFIED" || f.provenanceClass === "THIRD_PARTY_VERIFIED") trust.add("EXTERNAL");

    const degraded = DEGRADED_STATUS.has(f.status) || f.superseded === true;
    currencyParts.push({ value: degraded ? 0 : 100, weight });
    if (f.superseded === true || f.status === "SUPERSEDED") {
      trust.add("SUPERSEDED");
      const text = `${f.label} has been superseded by a newer belief`;
      currencyWhy.push({ text, polarity: -1, strength: "missing", refType: "fact", refId: f.factId });
      concerns.push({ kind: "SUPERSEDED_FACT", dimension: "currency", text, refType: "fact", refId: f.factId, weight });
    } else if (f.status === "EXPIRED") {
      const text = `${f.label} is past its validity window`;
      currencyWhy.push({ text, polarity: -1, strength: "missing", refType: "fact", refId: f.factId });
      concerns.push({ kind: "SUPERSEDED_FACT", dimension: "currency", text, refType: "fact", refId: f.factId, weight });
    }

    const disputed = f.status === "DISPUTED" || f.relevance === "CONTRADICTION" || f.relevance === "CONTRADICTING";
    consistencyParts.push({ value: disputed ? 0 : 100, weight });
    if (disputed) {
      trust.add("DISPUTED");
      const text = `${f.label} is disputed by other evidence`;
      consistencyWhy.push({ text, polarity: -1, strength: "missing", refType: "fact", refId: f.factId });
      concerns.push({ kind: "DISPUTED_FACT", dimension: "consistency", text, refType: "fact", refId: f.factId, weight });
    }
    if (f.status === "CURRENT" && !disputed) trust.add("VERIFIED");
  }

  for (let i = 0; i < openContradictions; i++) {
    consistencyParts.push({ value: 0, weight: 1 });
  }
  if (openContradictions > 0) {
    trust.add("DISPUTED");
    const text = `${openContradictions} unresolved contradiction${openContradictions === 1 ? "" : "s"} in this pursuit's context`;
    consistencyWhy.push({ text, polarity: -1, strength: "missing", refType: "pursuit", refId: input.pursuitId });
    concerns.push({ kind: "OPEN_CONTRADICTION", dimension: "consistency", text, refType: "pursuit", refId: input.pursuitId, weight: 1 });
  }

  const freshnessValue = weightedMean(freshParts);
  const corroborationValue = weightedMean(corrobParts);
  const currencyValue = weightedMean(currencyParts);
  const consistencyValue = weightedMean(consistencyParts);

  if (freshnessValue != null && freshnessValue >= 60 && !freshWhy.length) {
    freshWhy.push({ text: "Supporting facts are current", polarity: 1, strength: "strong" });
  }
  if (corroborationValue != null && corroborationValue >= 60 && !corrobWhy.length) {
    corrobWhy.push({ text: "Supporting facts are well evidenced", polarity: 1, strength: "strong" });
  }
  if (!consistencyWhy.length) consistencyWhy.push({ text: "No unresolved disagreement in the supporting facts", polarity: 1, strength: "strong" });
  if (!currencyWhy.length) currencyWhy.push({ text: "Every supporting fact is still a live belief", polarity: 1, strength: "strong" });

  const dimensions: ContextHealthDimension[] = [
    dim("freshness", freshnessValue, freshWhy),
    dim("corroboration", corroborationValue, corrobWhy),
    dim("coverage", coverageValue, coverageWhy),
    dim("consistency", consistencyValue, consistencyWhy),
    dim("currency", currencyValue, currencyWhy),
  ];

  // Overall is the mean of the dimensions that could actually be measured. A
  // dimension with nothing to measure is skipped, never counted as zero.
  const measured = dimensions.filter((d) => d.value != null).map((d) => d.value as number);
  const overall = measured.length ? Math.round(measured.reduce((s, v) => s + v, 0) / measured.length) : null;

  // Ranked worst-first so a surface can show the single biggest drag.
  concerns.sort((a, b) => b.weight - a.weight);

  return {
    pursuitId: input.pursuitId,
    overall, band: bandOf(overall),
    conclusion: concludeHealth({ overall, freshnessValue, corroborationValue, coverageValue, consistencyValue, currencyValue, facts: scored.length }),
    dimensions, concerns, trust: [...trust], factsConsidered: scored.length, factsExcluded, coverage, computedAt,
  };
}

/**
 * Map measured dimensions onto the typed conclusion. Ordered by severity, and
 * deliberately written as explicit rules rather than thresholds on the overall
 * figure alone — "stale" and "conflicting" are different problems that can share
 * an overall score, and a surface needs to tell them apart.
 */
function concludeHealth(a: {
  overall: number | null;
  freshnessValue: number | null;
  corroborationValue: number | null;
  coverageValue: number | null;
  consistencyValue: number | null;
  currencyValue: number | null;
  facts: number;
}): ContextHealthConclusion {
  if (a.facts === 0 || a.overall == null) return "NOT_ESTABLISHED";
  // Unresolved disagreement outranks everything: acting on contested context is
  // worse than acting on thin context you know is thin.
  if (a.consistencyValue != null && a.consistencyValue < 60) return "CONFLICTING";
  // Aged-out or superseded context is a distinct failure from never having had it.
  if ((a.freshnessValue != null && a.freshnessValue < 40) || (a.currencyValue != null && a.currencyValue < 60)) return "STALE";
  if ((a.coverageValue != null && a.coverageValue < 60) || (a.corroborationValue != null && a.corroborationValue < 40)) return "NEEDS_VALIDATION";
  if (a.corroborationValue != null && a.corroborationValue < 60) return "INFERRED";
  if (a.overall >= 60) return "VERIFIED";
  return "NEEDS_VALIDATION";
}
