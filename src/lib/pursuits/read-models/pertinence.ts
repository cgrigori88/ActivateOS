import { bandOf } from "./helpers";
import type { Caller } from "./helpers";
import type { Band, DisclosureClass } from "./types";
import type { FactRelevanceType } from "./context-health";
import type { LedgerMateriality } from "./memory";
import type { GapKind, GapSource } from "./missing-context";

/**
 * Pursuit Pertinence (vNext Slice 1, chunk 4).
 *
 * Answers: "of everything PursuitOS knows AND is allowed to reveal to this
 * caller, what matters for this pursuit and this decision right now?"
 *
 * THIS IS NOT SEARCH. There is no query string, no embedding, no relevance
 * feedback. Pertinence is computed from structured state the product already
 * holds — how a fact is linked to the pursuit, how recent it is, how material a
 * change was, whether a question is still open, and what the caller is currently
 * trying to decide. Search asks "what matches these words"; pertinence asks
 * "what should this person look at next".
 *
 * NO MODEL, BY DESIGN — BUT NOT BY EXCLUSION. Every signal here is deterministic
 * arithmetic over declared weights, and every item reports its own signal
 * breakdown. A later layer may reorder or narrate on top of this; it may not
 * replace it, because a ranking a user acts on must be reproducible and
 * explainable. The shape is deliberately model-ready: `PertinenceSignals` is an
 * open record of named contributions, so an additional signal can be added later
 * without changing the contract or the call sites.
 *
 * DISCLOSURE IS A FILTER, NOT A PENALTY. Items the caller is not entitled to see
 * are removed BEFORE ranking and contribute nothing — not a lowered score, not a
 * displaced neighbour, not a reason string. If a restricted item could push a
 * visible one down the list, its existence would be inferable from the ordering,
 * which is a leak by arithmetic. Only an aggregate `withheldCount` is reported,
 * matching the behaviour the product already has elsewhere.
 *
 * Pure and deterministic. No database access, no clock of its own, no writes.
 */

// ---------------------------------------------------------------------------
// Candidates — deliberately heterogeneous. Facts, remembered events and open
// gaps compete on one ranking, because "what should I look at" does not respect
// entity boundaries.
// ---------------------------------------------------------------------------

export type PertinenceItemKind = "FACT" | "EVENT" | "GAP";

/**
 * What the caller is trying to decide. Pertinence is task-relative: the renewal
 * date is the whole story when validating timing and background when choosing a
 * partner. GENERAL applies no task bias.
 */
export type DecisionContext =
  | "GENERAL"
  | "VALIDATE_TIMING"
  | "SELECT_ROUTE"
  | "QUALIFY"
  | "ENGAGE_STAKEHOLDER"
  | "ASSESS_RISK"
  | "BUILD_VALUE_CASE";

export interface PertinenceCandidate {
  id: string;
  kind: PertinenceItemKind;
  /** Short, factual label from the source domain. Never generated here. */
  label: string;
  /** Canonical disclosure class; decides visibility against the caller. */
  disclosure: DisclosureClass;
  /** When this happened or was last observed. Drives recency. */
  at: Date | null;
  /** FACT only: how the fact bears on the pursuit (`pursuit_facts.relevance_type`). */
  relevance?: FactRelevanceType;
  /**
   * FACT only. True when `relevance` was DERIVED (what the fact would be typed as
   * if linked) rather than read from a `pursuit_facts` row. It changes only the
   * wording of the reason, never the score — but the wording matters: saying
   * "linked to this pursuit" about an unlinked fact asserts a linkage nobody
   * made, which is the false-linkage failure the evidence layer exists to avoid.
   */
  relevanceInferred?: boolean;
  /** EVENT only: the ledger's materiality. */
  materiality?: LedgerMateriality;
  /** GAP only: what kind of unresolved thing this is. */
  gapKind?: GapKind;
  /**
   * GAP only: the upstream rank `composeMissingContext` already assigned, 0..100.
   * Carried rather than recomputed — the gap layer is authoritative for how much
   * a gap matters, and discarding it here is the defect this field fixes.
   */
  gapRank?: number;
  /** GAP only: which domain produced it. Lets a task match on source, not just kind. */
  gapSource?: GapSource;
  /** Upstream explanation, when the source domain supplied one. Never generated here. */
  whyItMatters?: string | null;
  /** FACT only: 0..1 from `facts.confidence`. */
  confidence?: number;
  /** True when this item represents an open question rather than a settled one. */
  unresolved?: boolean;
  refType: string;
  refId: string | null;
}

export interface PertinenceInput {
  pursuitId: string;
  caller: Caller;
  candidates: readonly PertinenceCandidate[];
  /** Default GENERAL — no task bias. */
  decisionContext?: DecisionContext;
  /** Bound the returned list. The count before bounding is always reported. */
  limit?: number;
  /** Half-life in days for the recency signal. Default 90. */
  recencyHalfLifeDays?: number;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Signal weights — declared, so the ranking can be argued with.
// ---------------------------------------------------------------------------

export const SIGNAL_WEIGHT = {
  /** How tightly the item is bound to this pursuit. The strongest signal. */
  linkage: 0.30,
  /** What the caller is currently trying to decide. */
  taskFit: 0.25,
  /** Unresolved things outrank settled ones — you cannot act on a closed question. */
  unresolved: 0.20,
  /** Recent beats old, with a half-life rather than a cliff. */
  recency: 0.15,
  /** How well evidenced the item is. */
  corroboration: 0.10,
} as const;

export type SignalKey = keyof typeof SIGNAL_WEIGHT;

/** FACT linkage strength. Mirrors the relevance weighting context health uses. */
const LINKAGE_BY_RELEVANCE: Record<FactRelevanceType, number> = {
  PRIMARY_TRIGGER: 1.0,
  TIMING_ANCHOR: 1.0,
  RISK: 0.85,
  CONTRADICTION: 0.85,
  CONTRADICTING: 0.85,
  SOLUTION_FIT: 0.7,
  PARTNER_ROUTE: 0.7,
  SUPPORTING_CONTEXT: 0.5,
  BACKGROUND: 0.2,
};

/** EVENT linkage rides on materiality: a CRITICAL change is tightly bound. */
const LINKAGE_BY_MATERIALITY: Record<LedgerMateriality, number> = {
  CRITICAL: 1.0, HIGH: 0.8, MEDIUM: 0.5, LOW: 0.25,
};

/**
 * GAP linkage FALLBACK, used only when no upstream rank travelled with the
 * candidate. `composeMissingContext` already computes a richer number —
 * `KIND_WEIGHT[kind] + SOURCE_WEIGHT[source] + blocking bonus` — and when that
 * is present it is used instead of this table. See `linkageOf`.
 */
const LINKAGE_BY_GAP: Record<GapKind, number> = {
  CONFLICTING: 1.0, MISSING: 0.8, STALE: 0.7, UNVERIFIED: 0.5, NOT_ESTABLISHED: 0.3,
};

/**
 * Task bias. Each decision context names the relevance types, materialities and
 * gap kinds it actually turns on. An item outside its task's set is not
 * penalised to zero — it simply gets the neutral 0.5, because a pursuit's
 * primary trigger still matters whatever you happen to be doing.
 */
const TASK_FIT: Record<DecisionContext, { relevance?: FactRelevanceType[]; gaps?: GapKind[]; gapSources?: GapSource[]; refTypes?: string[] }> = {
  GENERAL: {},
  // WHY_NOW is the timing/urgency domain, so a gap from it is a timing gap —
  // which is why "No verified timing anchor" was previously invisible here.
  VALIDATE_TIMING: { relevance: ["TIMING_ANCHOR", "PRIMARY_TRIGGER"], gaps: ["STALE", "CONFLICTING"], gapSources: ["WHY_NOW"] },
  SELECT_ROUTE: { relevance: ["PARTNER_ROUTE", "SOLUTION_FIT"], refTypes: ["route", "partner"] },
  // MEDDPICC is the qualification domain. This previously matched gap KIND
  // "MISSING" — the commonest kind — so QUALIFY treated a timing gap as a
  // qualification gap. Source is the precise signal now that it travels.
  QUALIFY: { relevance: ["PRIMARY_TRIGGER", "SUPPORTING_CONTEXT"], gapSources: ["MEDDPICC"], refTypes: ["meddpicc_element"] },
  ENGAGE_STAKEHOLDER: { refTypes: ["stakeholder_role", "contact"] },
  // CONTEXT_HEALTH is the domain that reports stale, superseded, disputed and
  // weakly-evidenced context — risk to what we believe, as distinct from risk
  // in the deal. Both belong to this task.
  ASSESS_RISK: { relevance: ["RISK", "CONTRADICTION", "CONTRADICTING"], gaps: ["CONFLICTING", "UNVERIFIED"], gapSources: ["CONTEXT_HEALTH"] },
  BUILD_VALUE_CASE: { relevance: ["PRIMARY_TRIGGER", "SOLUTION_FIT"], refTypes: ["value_driver"] },
};

const NEUTRAL_TASK_FIT = 0.5;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface SignalContribution {
  key: SignalKey;
  /** The raw signal, 0..1. */
  value: number;
  weight: number;
  /** value × weight — what this signal actually contributed. */
  contribution: number;
  /** Plain statement of why the signal reads as it does. */
  reason: string;
}

export interface PertinentItem {
  id: string;
  kind: PertinenceItemKind;
  label: string;
  /** 0..100. */
  score: number;
  band: Band;
  /** Every signal, with its arithmetic. This is what makes the ranking arguable. */
  signals: SignalContribution[];
  /** The one or two signals that decided this item's position. */
  topReasons: string[];
  refType: string;
  refId: string | null;
  disclosure: DisclosureClass;
}

export interface PertinenceView {
  pursuitId: string;
  decisionContext: DecisionContext;
  /** Ranked, highest first. */
  items: PertinentItem[];
  /** Visible candidates considered, before `limit`. */
  considered: number;
  /**
   * Candidates removed because the caller is not entitled to them. A count only:
   * these contributed nothing to the ranking.
   */
  withheldCount: number;
  computedAt: string;
}

/**
 * Can this caller see an item of this disclosure class?
 *
 * Uses the canonical `DisclosureClass` vocabulary and the capability the caller
 * already carries, rather than a second permission model. PII and RESTRICTED are
 * held to the internal bar deliberately: this read-model is not the place to
 * loosen either.
 */
export function canDisclose(caller: Caller, disclosure: DisclosureClass): boolean {
  switch (disclosure) {
    case "PUBLIC":
    case "PARTNER_SHARED":
      return true;
    case "TRANSACTION_CONFIDENTIAL":
      return caller.canSeeTransactionDetail;
    case "INTERNAL":
    case "PII":
    case "RESTRICTED":
      return caller.canSeeInternal;
    default:
      return false;   // unknown class ⇒ withhold. Fail closed.
  }
}

function linkageOf(c: PertinenceCandidate): { value: number; reason: string } {
  if (c.kind === "FACT" && c.relevance) {
    const as = c.relevance.toLowerCase().replace(/_/g, " ");
    return {
      value: LINKAGE_BY_RELEVANCE[c.relevance] ?? 0.5,
      reason: c.relevanceInferred
        ? `Would bear on this pursuit as ${as} — inferred, not linked`
        : `Linked to this pursuit as ${as}`,
    };
  }
  if (c.kind === "EVENT" && c.materiality) {
    return { value: LINKAGE_BY_MATERIALITY[c.materiality], reason: `${c.materiality.toLowerCase()} materiality change on this pursuit` };
  }
  if (c.kind === "GAP") {
    const state = c.gapKind ? c.gapKind.toLowerCase().replace(/_/g, " ") : "unresolved item";
    // SUBSTITUTION, NOT ADDITION — the point of this whole branch.
    //
    // The upstream rank encodes gap KIND, gap SOURCE, and whether the gap blocks
    // the decision. `LINKAGE_BY_GAP` encodes kind alone. They are two encodings
    // of the same question ("how tightly does this bind to the decision?"), so
    // the richer one REPLACES the coarser one. Adding them would count gap kind
    // twice and make the arithmetic indefensible.
    //
    // Normalised against the fixed 0..100 scale rather than against the other
    // candidates present: a candidate's score must never depend on its
    // neighbours, or filtering a restricted item out could move a visible one.
    if (typeof c.gapRank === "number" && Number.isFinite(c.gapRank)) {
      const value = Math.max(0, Math.min(1, c.gapRank / 100));
      const from = c.gapSource ? ` from ${c.gapSource.toLowerCase().replace(/_/g, " ")}` : "";
      return { value, reason: `Unresolved ${state}${from} (upstream rank ${Math.round(c.gapRank)}/100)` };
    }
    if (c.gapKind) {
      return { value: LINKAGE_BY_GAP[c.gapKind], reason: `Unresolved ${state} on this pursuit` };
    }
  }
  return { value: 0.5, reason: "Associated with this pursuit" };
}

function taskFitOf(c: PertinenceCandidate, ctx: DecisionContext): { value: number; reason: string } {
  if (ctx === "GENERAL") return { value: NEUTRAL_TASK_FIT, reason: "No specific decision in progress" };
  const fit = TASK_FIT[ctx];
  const task = ctx.toLowerCase().replace(/_/g, " ");
  if (c.relevance && fit.relevance?.includes(c.relevance)) return { value: 1, reason: `Bears directly on ${task}` };
  if (c.gapKind && fit.gaps?.includes(c.gapKind)) return { value: 1, reason: `Blocks ${task}` };
  if (c.gapSource && fit.gapSources?.includes(c.gapSource)) {
    return { value: 1, reason: `Unresolved ${c.gapSource.toLowerCase().replace(/_/g, " ")} context blocks ${task}` };
  }
  if (fit.refTypes?.includes(c.refType)) return { value: 1, reason: `Bears directly on ${task}` };
  return { value: NEUTRAL_TASK_FIT, reason: `Not specific to ${task}` };
}

function recencyOf(c: PertinenceCandidate, now: Date, halfLifeDays: number): { value: number; reason: string } {
  if (!c.at) return { value: NEUTRAL_TASK_FIT, reason: "No date recorded" };
  const ageDays = Math.max(0, (now.getTime() - c.at.getTime()) / DAY_MS);
  const value = Math.pow(0.5, ageDays / halfLifeDays);
  const rounded = Math.round(ageDays);
  return { value, reason: rounded === 0 ? "Happened today" : `${rounded} day${rounded === 1 ? "" : "s"} old` };
}

/**
 * Rank what matters for this pursuit and this decision.
 *
 * Candidates the caller may not see are filtered out first, so nothing
 * restricted can influence the ordering of what remains.
 */
export function rankPertinence(input: PertinenceInput): PertinenceView {
  const now = input.now ?? new Date();
  const ctx = input.decisionContext ?? "GENERAL";
  const halfLife = input.recencyHalfLifeDays ?? 90;

  // Disclosure filter FIRST. Everything below sees only authorized inputs.
  const visible: PertinenceCandidate[] = [];
  let withheldCount = 0;
  for (const c of input.candidates) {
    if (canDisclose(input.caller, c.disclosure)) visible.push(c);
    else withheldCount++;
  }

  const items: PertinentItem[] = visible.map((c) => {
    const linkage = linkageOf(c);
    const taskFit = taskFitOf(c, ctx);
    const recency = recencyOf(c, now, halfLife);
    const unresolvedValue = c.unresolved || c.kind === "GAP" ? 1 : 0;
    const corroborationValue = c.confidence != null ? Math.max(0, Math.min(1, c.confidence)) : NEUTRAL_TASK_FIT;

    const raw: Record<SignalKey, { value: number; reason: string }> = {
      linkage,
      taskFit,
      unresolved: {
        value: unresolvedValue,
        reason: unresolvedValue ? "Still unresolved" : "Settled — nothing outstanding",
      },
      recency,
      corroboration: {
        value: corroborationValue,
        reason: c.confidence != null ? `Confidence ${Math.round(corroborationValue * 100)}%` : "Confidence not applicable",
      },
    };

    const signals: SignalContribution[] = (Object.keys(SIGNAL_WEIGHT) as SignalKey[]).map((key) => {
      const weight = SIGNAL_WEIGHT[key];
      return { key, value: raw[key].value, weight, contribution: raw[key].value * weight, reason: raw[key].reason };
    });

    const score = Math.round(signals.reduce((s, sig) => s + sig.contribution, 0) * 100);

    // The reasons that actually moved this item, strongest contribution first.
    const topReasons = [...signals]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map((s) => s.reason);

    return {
      id: c.id, kind: c.kind, label: c.label, score, band: bandOf(score),
      signals, topReasons, refType: c.refType, refId: c.refId, disclosure: c.disclosure,
    };
  });

  // Score descending; `id` breaks ties so a windowed read is reproducible.
  items.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));

  return {
    pursuitId: input.pursuitId,
    decisionContext: ctx,
    items: input.limit != null && input.limit >= 0 ? items.slice(0, input.limit) : items,
    considered: visible.length,
    withheldCount,
    computedAt: now.toISOString(),
  };
}
