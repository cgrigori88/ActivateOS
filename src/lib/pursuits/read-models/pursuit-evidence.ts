import { factFreshness } from "@/lib/facts/freshness";
import type { FreshnessPolicy } from "@/lib/facts/predicates";
import { bandOf } from "./helpers";
import type { Caller } from "./helpers";
import {
  RELEVANCE_WEIGHT,
  type FactRelevanceType,
  type FactStatus,
  type ProvenanceClass,
} from "./context-health";
import {
  canDisclose,
  rankPertinence,
  type DecisionContext,
  type PertinenceCandidate,
  type PertinentItem,
} from "./pertinence";
import type { Band, DisclosureClass } from "./types";

/**
 * Pursuit Evidence (vNext Slice 1, chunk 5B-2).
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. Pursuit Detail currently shows the top 20
 * facts for the whole *account*, which can surface facts irrelevant to the
 * pursuit and bury relevant ones. The obvious fix — show only `pursuit_facts` —
 * is worse: the canonical synthetic Globex pursuit has exactly ONE linked fact,
 * while its account holds a `renewal_date` and five economic drivers that the
 * pursuit demonstrably needs. Swapping account scope for pursuit scope would
 * have deleted the most useful evidence on the screen.
 *
 * So the two things are not the same thing, and neither is a superset of the
 * other:
 *
 *   DIRECT      facts explicitly linked through `pursuit_facts`. Someone or
 *               something asserted that this fact bears on this pursuit, and
 *               that assertion is canonical.
 *   SUPPORTING  authorized account facts that are materially pertinent to this
 *               pursuit but carry no such assertion. The system considers them
 *               relevant; nobody has said they are.
 *
 * THAT DISTINCTION IS THE POINT, AND IT IS STRUCTURAL. They are returned as two
 * arrays, not one array with a boolean, because a boolean is easy to drop
 * downstream and the difference matters for learning: "the system considered
 * this pertinent" is a different claim from "this fact was linked to the
 * pursuit", and conflating them would poison any later attempt to learn from
 * which linkages turned out to be right.
 *
 * NO FALSE LINKAGE. Nothing here writes `pursuit_facts`. A fact does not become
 * linked by ranking well. This module is read-only composition, and inferred
 * pertinence must never be promoted into canonical linkage silently.
 *
 * WHAT IT DOES NOT REINVENT. Relevance comes from `deriveRelevance()`, the same
 * canonical function `linkFactToPursuits` uses — so a supporting fact is typed
 * exactly as it WOULD be typed if someone linked it. Freshness comes from
 * `factFreshness()`. Ranking comes from `rankPertinence`. Banding comes from
 * `bandOf()`. This module contributes composition and ordering, nothing else.
 *
 * Pure and deterministic. No database access, no clock of its own, no model, no
 * narrative, no writes.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * One account fact, with everything the composition needs. A direct projection
 * of `facts` left-joined to `pursuit_facts`, plus the canonical relevance the
 * loader derived — nothing is reinterpreted between SQL and here.
 */
export interface EvidenceFactInput {
  factId: string;
  predicateKey: string;
  /** `facts.subject_label` — the display form the product already uses. */
  subjectLabel: string;
  family: string | null;
  status: FactStatus;
  /** `facts.confidence`, 0..1. */
  confidence: number;
  provenanceClass: ProvenanceClass;
  disclosure: DisclosureClass;

  freshnessPolicy: FreshnessPolicy;
  observedLastAt: Date;
  halfLifeDays: number | null;
  validUntil?: Date | null;
  occurredAt?: Date | null;
  superseded?: boolean;

  /**
   * Set when a `pursuit_facts` row exists. Its presence is what makes a fact
   * DIRECT — never a score, never a threshold.
   */
  linkedRelevance?: FactRelevanceType | null;
  linkedAt?: Date | null;
  linkedByType?: string | null;
  linkReason?: string | null;

  /**
   * `deriveRelevance()` output — what relevance this fact WOULD carry if linked.
   * Used to rank supporting context. Carrying it does not link anything.
   */
  derivedRelevance: FactRelevanceType;
}

export interface PursuitEvidenceInput {
  pursuitId: string;
  accountId: string;
  caller: Caller;
  /** Every authorized-or-not account fact; this module filters. */
  accountFacts: readonly EvidenceFactInput[];
  /**
   * The decision in progress. GENERAL is the right default for a Pursuit Detail
   * evidence view, which exists to explain the pursuit rather than to serve one
   * specific decision.
   */
  decisionContext?: DecisionContext;
  /**
   * Minimum pertinence band for supporting context. Defaults to "moderate",
   * i.e. `bandOf(score) !== "low"` — the product's existing banding rather than
   * a number invented here. Staleness is NOT a separate cutoff: an aged fact
   * loses recency inside pertinence and falls below the band on its own.
   */
  minSupportingBand?: Exclude<Band, "unknown">;
  /** Presentation bound on supporting items. A cap on display, not on truth. */
  supportingLimit?: number;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type EvidenceLinkage = "EXPLICIT" | "INFERRED";

/** Shared shape so a surface can render either kind without special-casing. */
interface EvidenceBase {
  factId: string;
  predicateKey: string;
  label: string;
  family: string | null;
  status: FactStatus;
  confidence: number;
  provenanceClass: ProvenanceClass;
  disclosure: DisclosureClass;
  /** 0..1 from `factFreshness()`. */
  freshness: number;
  observedLastAt: string;
}

export interface DirectEvidenceItem extends EvidenceBase {
  linkage: "EXPLICIT";
  /** `pursuit_facts.relevance_type` — the asserted relevance, not a derived one. */
  relevance: FactRelevanceType;
  linkedAt: string | null;
  linkedByType: string | null;
  linkReason: string | null;
}

export interface SupportingContextItem extends EvidenceBase {
  linkage: "INFERRED";
  /** What `deriveRelevance()` says it WOULD be. Explicitly not an assertion. */
  inferredRelevance: FactRelevanceType;
  /** 0..100 from `rankPertinence`. */
  pertinence: number;
  band: Band;
  /** The full signal breakdown — why this was included, in canonical form. */
  signals: PertinentItem["signals"];
  /** The two strongest contributions. Structured reasons, never generated prose. */
  inclusionReasons: string[];
}

export interface EvidenceExclusionSummary {
  /** Every account fact offered to this composition. */
  accountFactsConsidered: number;
  direct: number;
  supporting: number;
  /** REJECTED facts, excluded under existing semantics. Never positive evidence. */
  rejected: number;
  /** Not disclosable to this caller. A count only — the content is not described. */
  unauthorized: number;
  /** Authorized and pertinent-ranked, but below the band gate. */
  belowBand: number;
  /** Above the gate but beyond the presentation limit. Still true, just not shown. */
  beyondLimit: number;
}

export interface PursuitEvidenceView {
  pursuitId: string;
  accountId: string;
  /** Explicitly linked. Structurally privileged by being its own array. */
  direct: DirectEvidenceItem[];
  /** Inferred as pertinent. Never promoted into `direct`. */
  supporting: SupportingContextItem[];
  excludedSummary: EvidenceExclusionSummary;
  decisionContext: DecisionContext;
  computedAt: string;
}

const BAND_ORDER: Record<Exclude<Band, "unknown">, number> = { low: 0, moderate: 1, high: 2, very_high: 3 };
const DEFAULT_SUPPORTING_LIMIT = 6;

/**
 * Compose the evidence picture for one pursuit.
 *
 * Order of operations is load-bearing:
 *   1. REJECTED out       — a claim the system declined to believe is not evidence
 *   2. unauthorized out   — before any ranking, so nothing invisible can move
 *                           anything visible (D-018)
 *   3. split direct / candidate-supporting by LINKAGE, never by score
 *   4. rank only the supporting candidates
 *   5. gate by band, then bound by limit
 */
export function composePursuitEvidence(input: PursuitEvidenceInput): PursuitEvidenceView {
  const now = input.now ?? new Date();
  const decisionContext = input.decisionContext ?? "GENERAL";
  const minBand = input.minSupportingBand ?? "moderate";
  const limit = input.supportingLimit ?? DEFAULT_SUPPORTING_LIMIT;

  const accountFactsConsidered = input.accountFacts.length;
  let rejected = 0;
  let unauthorized = 0;

  const freshnessOf = (f: EvidenceFactInput): number => factFreshness({
    freshnessPolicy: f.freshnessPolicy, observedLastAt: f.observedLastAt,
    halfLifeDays: f.halfLifeDays, validUntil: f.validUntil ?? null,
    occurredAt: f.occurredAt ?? null, now,
  });

  const base = (f: EvidenceFactInput): EvidenceBase => ({
    factId: f.factId, predicateKey: f.predicateKey, label: f.subjectLabel,
    family: f.family, status: f.status, confidence: f.confidence,
    provenanceClass: f.provenanceClass, disclosure: f.disclosure,
    freshness: Math.round(freshnessOf(f) * 1000) / 1000,
    observedLastAt: f.observedLastAt.toISOString(),
  });

  // --- 1 & 2: exclusions that must happen before anything is ranked ---------
  const usable: EvidenceFactInput[] = [];
  for (const f of input.accountFacts) {
    if (f.status === "REJECTED") { rejected++; continue; }
    if (!canDisclose(input.caller, f.disclosure)) { unauthorized++; continue; }
    usable.push(f);
  }

  // --- 3: the split is by LINKAGE, never by score --------------------------
  const directFacts = usable.filter((f) => f.linkedRelevance != null);
  const supportingCandidateFacts = usable.filter((f) => f.linkedRelevance == null);

  const direct: DirectEvidenceItem[] = directFacts
    .map((f) => ({
      ...base(f),
      linkage: "EXPLICIT" as const,
      relevance: f.linkedRelevance as FactRelevanceType,
      linkedAt: f.linkedAt ? f.linkedAt.toISOString() : null,
      linkedByType: f.linkedByType ?? null,
      linkReason: f.linkReason ?? null,
    }))
    // Asserted relevance first (the existing pursuit relevance weighting), then
    // freshness, then id so the order is reproducible.
    .sort((a, b) =>
      (RELEVANCE_WEIGHT[b.relevance] ?? 0.5) - (RELEVANCE_WEIGHT[a.relevance] ?? 0.5)
      || b.freshness - a.freshness
      || a.factId.localeCompare(b.factId));

  // --- 4: rank ONLY the supporting candidates ------------------------------
  const candidates: PertinenceCandidate[] = supportingCandidateFacts.map((f) => ({
    id: f.factId,
    kind: "FACT",
    label: f.subjectLabel,
    disclosure: f.disclosure,
    at: f.observedLastAt,
    // The canonical relevance this fact WOULD carry. Ranking input only, and
    // flagged as inferred so no reason string claims a linkage nobody made.
    relevance: f.derivedRelevance,
    relevanceInferred: true,
    confidence: f.confidence,
    unresolved: f.status === "DISPUTED",
    refType: "fact",
    refId: f.factId,
  }));

  const ranked = rankPertinence({
    pursuitId: input.pursuitId, caller: input.caller, candidates, decisionContext, now,
  });
  const byId = new Map(supportingCandidateFacts.map((f) => [f.factId, f]));

  // --- 5: gate by canonical band, then bound by the presentation limit ------
  const gated: SupportingContextItem[] = [];
  let belowBand = 0;
  for (const item of ranked.items) {
    const f = byId.get(item.id);
    if (!f) continue;
    const band = item.band;
    if (band === "unknown" || BAND_ORDER[band] < BAND_ORDER[minBand]) { belowBand++; continue; }
    gated.push({
      ...base(f),
      linkage: "INFERRED",
      inferredRelevance: f.derivedRelevance,
      pertinence: item.score,
      band,
      signals: item.signals,
      inclusionReasons: item.topReasons,
    });
  }

  const supporting = limit >= 0 ? gated.slice(0, limit) : gated;
  const beyondLimit = gated.length - supporting.length;

  return {
    pursuitId: input.pursuitId,
    accountId: input.accountId,
    direct,
    supporting,
    excludedSummary: {
      accountFactsConsidered,
      direct: direct.length,
      supporting: supporting.length,
      rejected, unauthorized, belowBand, beyondLimit,
    },
    decisionContext,
    computedAt: now.toISOString(),
  };
}
