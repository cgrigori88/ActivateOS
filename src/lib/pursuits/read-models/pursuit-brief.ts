import type { ContextHealthView } from "./context-health";
import type { GapKind, MissingContextView } from "./missing-context";
import type { PursuitMemoryView } from "./memory";
import type {
  DirectEvidenceItem,
  PursuitEvidenceView,
  SupportingContextItem,
} from "./pursuit-evidence";
import type { FactStatus, ProvenanceClass } from "./context-health";
import type { WhyNowView } from "./types";

/**
 * Pursuit Brief (vNext Slice 1, chunk 6A) — the composed view-model behind the
 * one surface that replaces Why Now, Facts and What Changed.
 *
 * WHY THIS EXISTS. Pursuit Detail tells one story across three panels that each
 * hold a fragment of it: why the pursuit matters, what we know, and what moved.
 * A reader has to assemble the story themselves. This view-model assembles it
 * once, server-side, deterministically.
 *
 * IT GENERATES NOTHING. Every line is either canonical text carried verbatim
 * from an upstream domain, or a phrase selected from a declared table by a
 * canonical state. There is no model, no template filled from free text, and no
 * sentence that asserts more than its source supports. Where a domain already
 * wrote the words — `WhyNowComponent.detail`, `ContextGap.text` — those words
 * are used unchanged (D-005, D-019).
 *
 * THE FOUR-STATE VOCABULARY SURVIVES INTO THE COPY. The product distinguishes
 * verified / inferred / degraded / absent in three separate domains, and the
 * point of this layer is to keep that distinction visible to a user without
 * teaching them the data model. So "missing" is never the universal word:
 * `MISSING` reads "Not identified yet", `NOT_ESTABLISHED` reads "Not yet
 * established", `UNVERIFIED` reads "Needs validation", `STALE` reads "Out of
 * date", `CONFLICTING` reads "Sources disagree". Five states, five phrasings.
 *
 * DIRECT AND SUPPORTING STAY DISTINCT — IN THE COPY, NOT JUST THE TYPE. Chunk
 * 5B-2 caught a reason string claiming "Linked to this pursuit" about an
 * unlinked fact. The same slip in UI copy would be a false provenance claim to
 * a user. So the two groups are labelled in product language — "Confirmed for
 * this pursuit" and "Relevant account context" — which conveys the difference
 * without the words `pursuit_facts`, `inferred` or `pertinence` ever appearing
 * (D-012, D-020).
 *
 * Pure and deterministic. No database, no clock of its own, no writes.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The state of one claim, in the product's voice. Deliberately five values, not
 * four: "not identified yet" (we looked and it is absent) and "not yet
 * established" (the question is not answerable at this stage) are different
 * answers, and collapsing them is the flattening this layer exists to prevent.
 */
export type BriefState =
  | "VERIFIED"
  | "NEEDS_VALIDATION"
  | "OUT_OF_DATE"
  | "CONFLICTING"
  | "NOT_IDENTIFIED"
  | "NOT_ESTABLISHED";

export const BRIEF_STATE_LABEL: Record<BriefState, string> = {
  VERIFIED: "Verified",
  NEEDS_VALIDATION: "Needs validation",
  OUT_OF_DATE: "Out of date",
  CONFLICTING: "Sources disagree",
  NOT_IDENTIFIED: "Not identified yet",
  NOT_ESTABLISHED: "Not yet established",
};

/** Gap kind → the state a reader sees. One phrasing each; nothing collapses. */
const GAP_STATE: Record<GapKind, BriefState> = {
  MISSING: "NOT_IDENTIFIED",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
  UNVERIFIED: "NEEDS_VALIDATION",
  STALE: "OUT_OF_DATE",
  CONFLICTING: "CONFLICTING",
};

/** Provenance in product language. No `provenance_class` reaches a user. */
const PROVENANCE_WORD: Record<ProvenanceClass, string> = {
  FIRST_PARTY: "First-party",
  CUSTOMER_DECLARED: "Customer-declared",
  THIRD_PARTY_VERIFIED: "Verified source",
  SECOND_PARTY: "Partner-provided",
  HUMAN_ASSERTED: "Asserted by a person",
  THIRD_PARTY_UNVERIFIED: "Unverified source",
  INFERRED: "Modelled",
};

/** How well-evidenced the pursuit's story is overall. */
export type BriefConfidence = "WELL_EVIDENCED" | "PARTLY_EVIDENCED" | "THIN" | "NOT_ESTABLISHED";

export const BRIEF_CONFIDENCE_LABEL: Record<BriefConfidence, string> = {
  WELL_EVIDENCED: "Well evidenced",
  PARTLY_EVIDENCED: "Partly evidenced",
  THIN: "Thin evidence",
  NOT_ESTABLISHED: "Not yet established",
};

const CONFIDENCE_FROM_HEALTH: Record<ContextHealthView["conclusion"], BriefConfidence> = {
  VERIFIED: "WELL_EVIDENCED",
  INFERRED: "PARTLY_EVIDENCED",
  NEEDS_VALIDATION: "PARTLY_EVIDENCED",
  STALE: "THIN",
  CONFLICTING: "THIN",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface BriefClause {
  /** Canonical text, carried from the domain that wrote it. Never generated. */
  text: string;
  refType: string;
  refId: string | null;
}

export interface BriefEvidenceLine {
  factId: string;
  label: string;
  predicateKey: string;
  /** Which group this belongs to. The distinction, preserved for the UI. */
  origin: "PURSUIT" | "ACCOUNT";
  state: BriefState;
  /** Short provenance word, e.g. "Customer-declared". */
  note: string;
}

export interface BriefChangeLine {
  id: string;
  /** The ledger's own reason, or its change type when it recorded none. */
  text: string;
  /** Business time, ISO. Never record time. */
  at: string;
  materiality: string;
  /** True when a person, not the system, made the change. */
  byPerson: boolean;
}

export interface BriefAttention {
  state: BriefState;
  /** The gap's canonical text. Not rewritten. */
  headline: string;
  /** Why it matters, when the source domain supplied it. */
  detail: string | null;
  /** What would resolve it, when the source domain supplied it. */
  resolution: string | null;
  refType: string;
  refId: string | null;
  /**
   * Set when authorized ACCOUNT context plausibly bears on this gap while the
   * pursuit itself still lacks a verified answer. The Globex case: the account
   * holds a customer-declared renewal date, and the pursuit has no verified
   * timing anchor. Saying only "not identified" would be false; saying timing is
   * known would be worse.
   */
  accountSignal: { text: string; refType: string; refId: string | null } | null;
}

export interface PursuitBriefView {
  pursuitId: string;
  accountLabel: string;

  whyThisMatters: {
    clauses: BriefClause[];
    confidence: BriefConfidence;
    /** One canonical sentence explaining the confidence. Null when obvious. */
    confidenceReason: string | null;
  };

  whatWeKnow: {
    /** Explicitly linked to this pursuit. */
    confirmed: BriefEvidenceLine[];
    /** Pertinent account context. Never presented as linked. */
    accountContext: BriefEvidenceLine[];
    /** Evidence available but not shown by default. */
    hiddenCount: number;
  };

  whatChanged: {
    entries: BriefChangeLine[];
    hiddenCount: number;
  };

  needsAttention: {
    primary: BriefAttention | null;
    otherCount: number;
  };

  computedAt: string;
}

export interface PursuitBriefInput {
  pursuitId: string;
  accountLabel: string;
  whyNow: WhyNowView | null;
  evidence: PursuitEvidenceView | null;
  memory: PursuitMemoryView | null;
  missingContext: MissingContextView | null;
  contextHealth: ContextHealthView | null;
  /** Total evidence lines shown by default, across both groups. Default 4. */
  evidenceBudget?: number;
  /** Changes shown by default. Default 3. */
  changeBudget?: number;
  now?: Date;
}

// ---------------------------------------------------------------------------

const DEGRADED: ReadonlySet<FactStatus> = new Set<FactStatus>(["STALE", "SUPERSEDED", "EXPIRED"]);
const WEAK_PROVENANCE: ReadonlySet<ProvenanceClass> = new Set<ProvenanceClass>(["THIRD_PARTY_UNVERIFIED", "INFERRED"]);

/** A fact's state, in the same five-state vocabulary the gaps use. */
function factState(f: { status: FactStatus; provenanceClass: ProvenanceClass; freshness: number }): BriefState {
  if (f.status === "DISPUTED") return "CONFLICTING";
  if (DEGRADED.has(f.status) || f.freshness < 0.15) return "OUT_OF_DATE";
  if (WEAK_PROVENANCE.has(f.provenanceClass)) return "NEEDS_VALIDATION";
  return "VERIFIED";
}

function evidenceLine(f: DirectEvidenceItem | SupportingContextItem, origin: "PURSUIT" | "ACCOUNT"): BriefEvidenceLine {
  return {
    factId: f.factId,
    label: f.label,
    predicateKey: f.predicateKey,
    origin,
    state: factState(f),
    note: PROVENANCE_WORD[f.provenanceClass] ?? "Source not stated",
  };
}

/** Relevance types that answer the timing question. Canonical, not keyword-matched. */
const TIMING_RELEVANCE = new Set(["TIMING_ANCHOR"]);

/**
 * Compose the brief.
 *
 * Every section degrades honestly: an absent input produces an empty section and
 * a stated reason, never a confident-sounding placeholder.
 */
export function buildPursuitBrief(input: PursuitBriefInput): PursuitBriefView {
  const now = input.now ?? new Date();
  const evidenceBudget = input.evidenceBudget ?? 4;
  const changeBudget = input.changeBudget ?? 3;

  // --- A · Why this matters -------------------------------------------------
  // Pursuit-scoped: why THIS pursuit looks live on its own evidence. Not why it
  // outranks another pursuit — that is portfolio work (D-017).
  const clauses: BriefClause[] = [];
  const w = input.whyNow;
  if (w?.present) {
    for (const c of [w.businessTrigger, w.technologyCondition, w.timingAnchor, w.signalConvergence, w.routeRelevance]) {
      if (!c?.present) continue;
      const text = c.commercialImplication || c.detail;
      if (!text) continue;
      clauses.push({ text, refType: c.refType ?? "pursuit", refId: c.refId ?? input.pursuitId });
    }
  }
  // Fall back to the strongest confirmed evidence — still canonical text.
  if (!clauses.length) {
    const strongest = input.evidence?.direct[0];
    if (strongest) {
      clauses.push({ text: strongest.label, refType: "fact", refId: strongest.factId });
    }
  }

  const health = input.contextHealth;
  const confidence: BriefConfidence = health
    ? (clauses.length ? CONFIDENCE_FROM_HEALTH[health.conclusion] : "NOT_ESTABLISHED")
    : "NOT_ESTABLISHED";
  const confidenceReason = health?.concerns[0]?.text ?? null;

  // --- B · What we know -----------------------------------------------------
  const allConfirmed = (input.evidence?.direct ?? []).map((d) => evidenceLine(d, "PURSUIT"));
  const allAccount = (input.evidence?.supporting ?? []).map((s) => evidenceLine(s, "ACCOUNT"));

  // Confirmed evidence fills the budget first — explicitly linked evidence is
  // structurally privileged — but never crowds account context out entirely,
  // because on a thinly-linked pursuit the account context IS the story.
  const confirmed = allConfirmed.slice(0, Math.max(1, evidenceBudget - 1));
  const accountContext = allAccount.slice(0, Math.max(0, evidenceBudget - confirmed.length));
  const hiddenCount =
    (allConfirmed.length - confirmed.length) +
    (allAccount.length - accountContext.length) +
    (input.evidence?.excludedSummary.beyondLimit ?? 0);

  // --- C · What changed -----------------------------------------------------
  // Newest first by BUSINESS time. The memory read-model already orders by
  // occurred_at; this only takes the head of it (D-006).
  const memoryEntries = input.memory?.entries ?? [];
  const newestFirst = input.memory?.order === "newest" ? memoryEntries : [...memoryEntries].reverse();
  const entries: BriefChangeLine[] = newestFirst.slice(0, changeBudget).map((e) => ({
    id: e.id,
    text: e.reason ?? e.changeType.replace(/_/g, " ").toLowerCase(),
    at: e.occurredAt,
    materiality: e.materiality,
    byPerson: e.actor.type === "USER",
  }));

  // --- D · Needs attention --------------------------------------------------
  const gaps = input.missingContext?.gaps ?? [];
  const top = gaps[0] ?? null;
  let primary: BriefAttention | null = null;
  if (top) {
    let state = GAP_STATE[top.kind];
    let accountSignal: BriefAttention["accountSignal"] = null;

    // The Globex nuance. When the gap is a timing question and the ACCOUNT holds
    // timing context, the honest answer is neither "not identified" nor "timing
    // is known": the pursuit's timing has not been validated, and the account
    // already offers something to validate it against.
    if (top.source === "WHY_NOW") {
      const timing = (input.evidence?.supporting ?? []).find((s) => TIMING_RELEVANCE.has(s.inferredRelevance));
      if (timing) {
        state = "NEEDS_VALIDATION";
        accountSignal = {
          text: `${PROVENANCE_WORD[timing.provenanceClass] ?? "Account"} timing exists on the account — not yet confirmed for this pursuit`,
          refType: "fact",
          refId: timing.factId,
        };
      }
    }

    primary = {
      state,
      headline: top.text,
      detail: top.whyItMatters,
      resolution: top.howToResolve,
      refType: top.refType,
      refId: top.refId,
      accountSignal,
    };
  }

  return {
    pursuitId: input.pursuitId,
    accountLabel: input.accountLabel,
    whyThisMatters: { clauses, confidence, confidenceReason },
    whatWeKnow: { confirmed, accountContext, hiddenCount },
    whatChanged: { entries, hiddenCount: Math.max(0, memoryEntries.length - entries.length) },
    needsAttention: { primary, otherCount: Math.max(0, gaps.length - (primary ? 1 : 0)) },
    computedAt: now.toISOString(),
  };
}
