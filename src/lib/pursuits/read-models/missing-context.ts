import { ELEMENTS, type ElementKey, type Meddpicc } from "@/lib/opportunities/meddpicc";
import type { CoverageState, StakeholderCoverage } from "@/lib/stakeholders/coverage";
import type { ValueCaseState } from "@/lib/value/case";
import type { ContextHealthView } from "./context-health";
import type { Caller } from "./helpers";
import type { WhyNowView } from "./types";

/**
 * Missing Context (vNext Slice 1, chunk 3).
 *
 * Answers one question: "what is the most important thing we do not know or have
 * not validated yet on this pursuit?"
 *
 * THIS IS A COMPOSITION LAYER, NOT A FIFTH GAP FRAMEWORK. Four gap computations
 * already exist and each is correct in its own domain:
 *
 *   • `meddpiccGaps()`            — qualification elements still unknown or flagged
 *   • `StakeholderCoverage`       — deal-risk role coverage, with its own
 *                                    VERIFIED/INFERRED/UNVERIFIED/MISSING ladder
 *                                    and an honest NOT ESTABLISHED state
 *   • `ValueCase`                 — economic drivers, with STRONG/INCOMPLETE/
 *                                    CONFLICTING/NOT_ESTABLISHED
 *   • `WhyNowView.unknowns`       — "what we don't know yet" about timing
 *
 * plus, as of chunk 1, `ContextHealthView.concerns` for stale, superseded,
 * disputed and unresearched context.
 *
 * This module re-derives none of them. It takes their ALREADY-COMPUTED outputs,
 * normalises them onto one vocabulary, and ranks them deterministically. If a
 * domain changes its mind about what counts as a gap, this layer inherits that
 * automatically — which is the whole reason not to write a fifth one.
 *
 * MISSING IS NOT ONE THING. The distinction the product already makes in three
 * places is preserved here rather than flattened:
 *
 *   MISSING         we have never had it
 *   STALE           we had it and it has aged out
 *   CONFLICTING     we have it twice and the copies disagree
 *   UNVERIFIED      we have it but nothing corroborates it
 *   NOT_ESTABLISHED the question is not answerable yet — a pre-opportunity
 *                   pursuit has no stakeholder coverage to be missing
 *
 * A surface that renders all five as "missing" would be lying about four of them.
 *
 * ENTITLEMENT IS NOT A GAP. The subtle correctness requirement: if the caller is
 * not entitled to see something, that is not a hole in their knowledge — it is a
 * boundary, and reporting it as "missing" both misleads them and leaks the shape
 * of what sits behind the boundary. Such items are excluded from `gaps` entirely
 * and reported only as a count in `withheldCount`, mirroring the product's
 * existing "1 confidential figure removed at the server" behaviour.
 *
 * Deterministic and inspectable: ranking is explicit arithmetic over declared
 * weights, every gap carries `rankReasons` explaining its position, and no model
 * is involved. Pure — no database access, no clock of its own, no writes.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type GapKind = "MISSING" | "STALE" | "CONFLICTING" | "UNVERIFIED" | "NOT_ESTABLISHED";

export type GapSource = "MEDDPICC" | "STAKEHOLDER_COVERAGE" | "VALUE_CASE" | "WHY_NOW" | "CONTEXT_HEALTH";

export interface ContextGap {
  /** Stable within one pursuit, so a surface can key and de-duplicate on it. */
  key: string;
  source: GapSource;
  kind: GapKind;
  /** What is unresolved. Taken from the source domain — never generated here. */
  text: string;
  /** Why it matters commercially, when the source domain supplies it. */
  whyItMatters: string | null;
  /** What would resolve it, when the source domain supplies it. */
  howToResolve: string | null;
  refType: string;
  refId: string | null;
  /** 0..100. Deterministic — see RANKING below. */
  rank: number;
  /** The arithmetic, exposed. A surface can show why this is first. */
  rankReasons: string[];
}

export interface MissingContextView {
  pursuitId: string;
  /** Ranked, highest first. Empty when nothing is unresolved. */
  gaps: ContextGap[];
  /** The single most important unresolved thing, or null. */
  top: ContextGap | null;
  /** Counts by kind across `gaps` — so "3 stale, 1 conflicting" is one read. */
  byKind: Record<GapKind, number>;
  /**
   * Items excluded because this caller is not entitled to the underlying data.
   * A count only: the content is deliberately not described.
   */
  withheldCount: number;
  /** Sources that could not be evaluated at all, with the reason. Honest silence. */
  notEvaluated: { source: GapSource; reason: string }[];
  computedAt: string;
}

// ---------------------------------------------------------------------------
// RANKING — explicit, declared, deterministic.
// ---------------------------------------------------------------------------

/**
 * Kind weight. A disagreement outranks an absence: acting on context you believe
 * is settled but is not is worse than acting on context you know you lack.
 * NOT_ESTABLISHED ranks lowest because it is usually a statement about the
 * pursuit's stage, not a failure to do the work.
 */
export const KIND_WEIGHT: Record<GapKind, number> = {
  CONFLICTING: 40,
  MISSING: 30,
  STALE: 25,
  UNVERIFIED: 18,
  NOT_ESTABLISHED: 8,
};

/**
 * Source weight. Qualification and economic-buyer coverage move deals; research
 * coverage is important but further from the decision.
 */
export const SOURCE_WEIGHT: Record<GapSource, number> = {
  STAKEHOLDER_COVERAGE: 30,
  MEDDPICC: 26,
  WHY_NOW: 22,
  VALUE_CASE: 20,
  CONTEXT_HEALTH: 14,
};

/**
 * MEDDPICC elements that block a deal rather than merely weaken it. Drawn from
 * the same three roles the existing deal-risk checklist treats as critical
 * (`stakeholderGaps`: economic buyer, champion, technical buyer) plus the pain
 * that creates urgency at all.
 */
const BLOCKING_MEDDPICC: ReadonlySet<ElementKey> = new Set<ElementKey>(["economic_buyer", "champion", "identified_pain"]);

const BLOCKING_BONUS = 20;

/** Coverage ladder → gap kind. Preserves the distinction the ladder already makes. */
const COVERAGE_STATE_KIND: Record<CoverageState, GapKind | null> = {
  MISSING: "MISSING",
  UNVERIFIED: "UNVERIFIED",
  INFERRED: "UNVERIFIED",   // inferred is held, but nothing corroborates it
  VERIFIED: null,           // not a gap
};

/** Context-health concern → gap kind. */
const CONCERN_KIND: Record<ContextHealthView["concerns"][number]["kind"], GapKind> = {
  STALE_FACT: "STALE",
  SUPERSEDED_FACT: "STALE",
  DISPUTED_FACT: "CONFLICTING",
  OPEN_CONTRADICTION: "CONFLICTING",
  WEAK_PROVENANCE: "UNVERIFIED",
  MISSING_COVERAGE: "MISSING",
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface MissingContextInput {
  pursuitId: string;
  caller: Caller;
  /** Already computed by `computeContextHealth`. */
  contextHealth?: ContextHealthView | null;
  /** Already computed by `getStakeholderCoverage`. */
  stakeholderCoverage?: StakeholderCoverage | null;
  /** Already loaded by `meddpiccFor`, for the pursuit's primary opportunity. */
  meddpicc?: Meddpicc | null;
  /** Already computed by `assembleCase`. */
  valueCase?: { state: ValueCaseState; missingDrivers: string[] } | null;
  /** Already computed by `getPursuitWhyNow`. */
  whyNow?: WhyNowView | null;
  /**
   * How many context-health concerns to promote into the ranked list. Health can
   * emit one concern per unresearched category; all of them would drown the
   * qualification gaps that actually move a deal. Default 3, worst-first — the
   * full list stays available on `ContextHealthView.concerns`.
   */
  maxHealthConcerns?: number;
  now?: Date;
}

// ---------------------------------------------------------------------------

function rankOf(kind: GapKind, source: GapSource, blocking: boolean): { rank: number; reasons: string[] } {
  const reasons: string[] = [
    `${kind.toLowerCase().replace(/_/g, " ")} (+${KIND_WEIGHT[kind]})`,
    `${source.toLowerCase().replace(/_/g, " ")} (+${SOURCE_WEIGHT[source]})`,
  ];
  let rank = KIND_WEIGHT[kind] + SOURCE_WEIGHT[source];
  if (blocking) {
    rank += BLOCKING_BONUS;
    reasons.push(`blocks the decision (+${BLOCKING_BONUS})`);
  }
  return { rank: Math.min(100, rank), reasons };
}

/**
 * Compose and rank the unresolved context for one pursuit.
 *
 * Every source is optional. A source that was not supplied is reported in
 * `notEvaluated` rather than silently treated as "no gaps" — "we did not look"
 * and "we looked and found nothing" are different answers, and only one of them
 * should reassure anyone.
 */
export function composeMissingContext(input: MissingContextInput): MissingContextView {
  const now = input.now ?? new Date();
  const gaps: ContextGap[] = [];
  const notEvaluated: { source: GapSource; reason: string }[] = [];
  let withheldCount = 0;

  // --- stakeholder coverage -------------------------------------------------
  if (input.stakeholderCoverage === undefined) {
    notEvaluated.push({ source: "STAKEHOLDER_COVERAGE", reason: "Stakeholder coverage was not evaluated" });
  } else if (input.stakeholderCoverage === null) {
    notEvaluated.push({ source: "STAKEHOLDER_COVERAGE", reason: "No stakeholder coverage available for this pursuit" });
  } else if (!input.stakeholderCoverage.established) {
    // The honest pre-opportunity answer. Not a failure to do the work.
    const { rank, reasons } = rankOf("NOT_ESTABLISHED", "STAKEHOLDER_COVERAGE", false);
    gaps.push({
      key: "stakeholder:not_established",
      source: "STAKEHOLDER_COVERAGE", kind: "NOT_ESTABLISHED",
      text: input.stakeholderCoverage.notEstablishedReason ?? "Stakeholder coverage is not established for this pursuit",
      whyItMatters: null, howToResolve: null,
      refType: "pursuit", refId: input.pursuitId, rank, rankReasons: reasons,
    });
  } else if (!input.caller.canSeeInternal) {
    // A guest partner is not entitled to the sponsor's stakeholder map. Their not
    // seeing it is a boundary, not a hole in their knowledge.
    withheldCount += input.stakeholderCoverage.roles.filter((r) => COVERAGE_STATE_KIND[r.state] !== null).length;
  } else {
    for (const role of input.stakeholderCoverage.roles) {
      const kind = COVERAGE_STATE_KIND[role.state];
      if (!kind) continue;
      const blocking = role.role === "economic_buyer" || role.role === "champion";
      const { rank, reasons } = rankOf(kind, "STAKEHOLDER_COVERAGE", blocking);
      gaps.push({
        key: `stakeholder:${role.role}`,
        source: "STAKEHOLDER_COVERAGE", kind,
        text: kind === "MISSING"
          ? `No ${role.role.replace(/_/g, " ")} identified`
          : `${role.role.replace(/_/g, " ")} is not verified`,
        whyItMatters: role.whyItMatters || null,
        howToResolve: role.verifyingEvidence || null,
        refType: "stakeholder_role", refId: role.role, rank, rankReasons: reasons,
      });
    }
  }

  // --- MEDDPICC -------------------------------------------------------------
  if (input.meddpicc === undefined) {
    notEvaluated.push({ source: "MEDDPICC", reason: "Qualification was not evaluated" });
  } else if (input.meddpicc === null) {
    notEvaluated.push({ source: "MEDDPICC", reason: "No linked opportunity to qualify" });
  } else {
    const m = input.meddpicc;
    for (const el of ELEMENTS) {
      const status = m[el.key]?.status;
      if (status !== "unknown" && status !== "gap") continue;
      // Both map to MISSING — neither is resolved — but the text keeps the
      // distinction the domain makes: "unknown" was never captured, "gap" was
      // captured and found wanting.
      const blocking = BLOCKING_MEDDPICC.has(el.key);
      const { rank, reasons } = rankOf("MISSING", "MEDDPICC", blocking);
      gaps.push({
        key: `meddpicc:${el.key}`,
        source: "MEDDPICC", kind: "MISSING",
        text: status === "gap" ? `${el.label} is a known gap` : `${el.label} is unknown`,
        whyItMatters: el.hint, howToResolve: null,
        refType: "meddpicc_element", refId: el.key, rank, rankReasons: reasons,
      });
    }
  }

  // --- value case -----------------------------------------------------------
  if (input.valueCase === undefined) {
    notEvaluated.push({ source: "VALUE_CASE", reason: "Value case was not evaluated" });
  } else if (input.valueCase === null || input.valueCase.state === "NOT_ESTABLISHED") {
    const { rank, reasons } = rankOf("NOT_ESTABLISHED", "VALUE_CASE", false);
    gaps.push({
      key: "value:not_established",
      source: "VALUE_CASE", kind: "NOT_ESTABLISHED",
      text: "No economic value case established yet",
      whyItMatters: null, howToResolve: null,
      refType: "pursuit", refId: input.pursuitId, rank, rankReasons: reasons,
    });
  } else if (!input.caller.canSeeTransactionDetail) {
    // Economic drivers are transaction-confidential.
    withheldCount += input.valueCase.missingDrivers.length;
  } else {
    // CONFLICTING is a property of the case as a whole, so it colours its drivers.
    const kind: GapKind = input.valueCase.state === "CONFLICTING" ? "CONFLICTING" : "MISSING";
    for (const driver of input.valueCase.missingDrivers) {
      const { rank, reasons } = rankOf(kind, "VALUE_CASE", false);
      gaps.push({
        key: `value:${driver}`,
        source: "VALUE_CASE", kind,
        text: kind === "CONFLICTING" ? `${driver} is contested` : `${driver} has no quantified value`,
        whyItMatters: null, howToResolve: null,
        refType: "value_driver", refId: driver, rank, rankReasons: reasons,
      });
    }
  }

  // --- why now --------------------------------------------------------------
  if (input.whyNow === undefined) {
    notEvaluated.push({ source: "WHY_NOW", reason: "Timing was not evaluated" });
  } else if (input.whyNow === null || !input.whyNow.present) {
    const { rank, reasons } = rankOf("NOT_ESTABLISHED", "WHY_NOW", false);
    gaps.push({
      key: "whynow:not_established",
      source: "WHY_NOW", kind: "NOT_ESTABLISHED",
      text: "No structured timing rationale assembled yet",
      whyItMatters: null, howToResolve: null,
      refType: "pursuit", refId: input.pursuitId, rank, rankReasons: reasons,
    });
  } else {
    // `unknowns` is the domain's own list — consumed verbatim, never recomputed.
    input.whyNow.unknowns.forEach((text, i) => {
      const blocking = /timing|renewal|anchor/i.test(text);
      const { rank, reasons } = rankOf("MISSING", "WHY_NOW", blocking);
      gaps.push({
        key: `whynow:unknown:${i}`,
        source: "WHY_NOW", kind: "MISSING", text,
        whyItMatters: null, howToResolve: null,
        refType: "pursuit", refId: input.pursuitId, rank, rankReasons: reasons,
      });
    });
    input.whyNow.contradictions.forEach((c, i) => {
      const { rank, reasons } = rankOf("CONFLICTING", "WHY_NOW", true);
      gaps.push({
        key: `whynow:contradiction:${i}`,
        source: "WHY_NOW", kind: "CONFLICTING", text: c.text,
        whyItMatters: `${c.supporting} supporting vs ${c.contradicting} contradicting`,
        howToResolve: null,
        refType: "pursuit", refId: input.pursuitId, rank, rankReasons: reasons,
      });
    });
  }

  // --- context health -------------------------------------------------------
  if (input.contextHealth === undefined) {
    notEvaluated.push({ source: "CONTEXT_HEALTH", reason: "Context health was not evaluated" });
  } else if (input.contextHealth) {
    const max = input.maxHealthConcerns ?? 3;
    // `concerns` arrives already ranked worst-first by chunk 1.
    for (const c of input.contextHealth.concerns.slice(0, Math.max(0, max))) {
      const kind = CONCERN_KIND[c.kind];
      const { rank, reasons } = rankOf(kind, "CONTEXT_HEALTH", false);
      gaps.push({
        key: `health:${c.kind}:${c.refId ?? "none"}`,
        source: "CONTEXT_HEALTH", kind, text: c.text,
        whyItMatters: null, howToResolve: null,
        refType: c.refType, refId: c.refId, rank, rankReasons: reasons,
      });
    }
  }

  // Rank descending; `key` breaks ties so the order is reproducible.
  gaps.sort((a, b) => (b.rank - a.rank) || a.key.localeCompare(b.key));

  const byKind: Record<GapKind, number> = { MISSING: 0, STALE: 0, CONFLICTING: 0, UNVERIFIED: 0, NOT_ESTABLISHED: 0 };
  for (const g of gaps) byKind[g.kind]++;

  return {
    pursuitId: input.pursuitId,
    gaps,
    top: gaps[0] ?? null,
    byKind,
    withheldCount,
    notEvaluated,
    computedAt: now.toISOString(),
  };
}
