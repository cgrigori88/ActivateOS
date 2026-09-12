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
 * Pursuit Context narrative (vNext Slice 1, chunk 6A) — the composed view-model behind the
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
export type ContextState =
  | "VERIFIED"
  | "NEEDS_VALIDATION"
  | "OUT_OF_DATE"
  | "CONFLICTING"
  | "NOT_IDENTIFIED"
  | "NOT_ESTABLISHED";

export const CONTEXT_STATE_LABEL: Record<ContextState, string> = {
  VERIFIED: "Verified",
  NEEDS_VALIDATION: "Needs validation",
  OUT_OF_DATE: "Out of date",
  CONFLICTING: "Sources disagree",
  NOT_IDENTIFIED: "Not identified yet",
  NOT_ESTABLISHED: "Not yet established",
};

/** Gap kind → the state a reader sees. One phrasing each; nothing collapses. */
const GAP_STATE: Record<GapKind, ContextState> = {
  MISSING: "NOT_IDENTIFIED",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
  UNVERIFIED: "NEEDS_VALIDATION",
  STALE: "OUT_OF_DATE",
  CONFLICTING: "CONFLICTING",
};

/**
 * Scope-aware state label.
 *
 * A supporting account fact rendered as a bare "Verified" chip reads, to anyone
 * skimming chips rather than prose, as verified *for this pursuit*. It is not —
 * it is verified on the account, and nobody has confirmed it here. The chip is
 * the most-skimmed element on the row, so the scope belongs in the chip rather
 * than only in the group heading above it (D-020).
 *
 * Only VERIFIED is qualified. "Needs validation on account" would be noise: the
 * degraded states already say the claim is not to be relied on, so adding scope
 * changes nothing a reader would act on.
 */
export function stateLabelFor(state: ContextState, origin: "PURSUIT" | "ACCOUNT"): string {
  if (origin === "ACCOUNT" && state === "VERIFIED") return "Verified on account";
  return CONTEXT_STATE_LABEL[state];
}

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
export type ContextConfidence = "WELL_EVIDENCED" | "PARTLY_EVIDENCED" | "THIN" | "NOT_ESTABLISHED";

export const CONTEXT_CONFIDENCE_LABEL: Record<ContextConfidence, string> = {
  WELL_EVIDENCED: "Well evidenced",
  PARTLY_EVIDENCED: "Partly evidenced",
  THIN: "Thin evidence",
  NOT_ESTABLISHED: "Not yet established",
};

const CONFIDENCE_FROM_HEALTH: Record<ContextHealthView["conclusion"], ContextConfidence> = {
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

export interface ContextClause {
  /** Canonical text, carried from the domain that wrote it. Never generated. */
  text: string;
  refType: string;
  refId: string | null;
}

export interface ContextEvidenceLine {
  factId: string;
  label: string;
  predicateKey: string;
  /** Which group this belongs to. The distinction, preserved for the UI. */
  origin: "PURSUIT" | "ACCOUNT";
  state: ContextState;
  /**
   * The chip's words, already chosen — scope-qualified for account context so a
   * supporting fact cannot read as verified for the pursuit (U-14, D-020).
   */
  stateLabel: string;
  /** Short provenance word, e.g. "Customer-declared". */
  note: string;
}

export interface ContextChangeLine {
  id: string;
  changeType: string;
  /** Product-language title of what happened. Deterministic; never generated. */
  text: string;
  /** Qualifier and date, already assembled. e.g. "Previously inferred · Sep 12". */
  meta: string;
  /** The ledger's own reason, verbatim. Preserved for audit and traceability. */
  canonicalReason: string | null;
  /** Business time, ISO. Never record time. */
  at: string;
  materiality: string;
  /** True when a person, not the system, made the change. */
  byPerson: boolean;
}

/**
 * A secondary unresolved item. Deliberately lighter than `ContextAttention`:
 * headline and state only. The disclosure exists so the reader can see WHAT
 * else is open, not to relocate the whole list into a drawer.
 */
export interface ContextAttentionBrief {
  state: ContextState;
  stateLabel: string;
  headline: string;
  refType: string;
  refId: string | null;
}

export interface ContextAttention {
  state: ContextState;
  /** The chip's words, already chosen. */
  stateLabel: string;
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

export interface ContextTimingNote {
  text: string;
  refType: string;
  refId: string | null;
}

export interface PursuitContextView {
  pursuitId: string;
  accountLabel: string;

  whyThisMatters: {
    clauses: ContextClause[];
    confidence: ContextConfidence;
    /** One canonical sentence explaining the confidence. Null when obvious. */
    confidenceReason: string | null;
  };

  whatWeKnow: {
    /** Explicitly linked to this pursuit. */
    confirmed: ContextEvidenceLine[];
    /** Pertinent account context. Never presented as linked. */
    accountContext: ContextEvidenceLine[];
    /** Evidence available but not shown by default. */
    hiddenCount: number;
  };

  whatChanged: {
    entries: ContextChangeLine[];
    /**
     * The remaining memory entries, same business-time order, carried in the
     * payload so the "Earlier history" disclosure can actually render them.
     *
     * This field exists because chunk 6B shipped a disclosure that promised
     * "(7 more)" and revealed only a sentence pointing at the activity record —
     * which this very surface had absorbed. Seven of the Globex pursuit's ten
     * ledger events, the partner-override chronology among them, were reachable
     * nowhere on the page. A disclosure must reveal the thing it counted.
     *
     * Not materiality-filtered (D-006): this is memory, not an attention feed.
     */
    earlier: ContextChangeLine[];
    /** Entries behind the disclosure. Always `earlier.length`. */
    hiddenCount: number;
  };

  needsAttention: {
    primary: ContextAttention | null;
    /**
     * The remaining ranked gaps, in Missing Context's order, carried so the
     * "N other items" affordance can actually reveal them. Chunk 6B stated the
     * count as plain text with nothing to open — a number where the reader
     * expected a door.
     *
     * Each keeps its own state, so a drawer of ten items does not flatten into
     * ten identical "missing" rows.
     */
    others: ContextAttentionBrief[];
    /** Always `others.length`. */
    otherCount: number;
    /**
     * Surfaced whenever the pursuit has an unresolved timing question AND the
     * account holds timing context — NOT only when timing happens to be the
     * top-ranked gap. On Globex the economic-buyer gap outranks timing, so a
     * note tied to the primary alone would stay silent while the page showed a
     * verified-looking renewal date elsewhere. Saying neither half alone is the
     * whole requirement.
     */
    timingNote: ContextTimingNote | null;
  };

  computedAt: string;
}

export interface PursuitContextInput {
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

// ---------------------------------------------------------------------------
// Deterministic copy
//
// Canonical records carry operational strings: enum fragments, counts with the
// wrong plural, semicolon-joined label lists, prose written for an audit trail.
// They are correct and they read like machine output. This section translates
// them into product language by table lookup and structural inspection — no
// model, no template filled from free text, no claim the source does not make.
//
// Every translation degrades to the canonical string it could not improve, so a
// vocabulary this layer has not seen produces slightly clumsy copy rather than
// silence or a guess. The canonical value is preserved alongside the rendered
// one on every line.
// ---------------------------------------------------------------------------

/** Trim, capitalise, and end with a single full stop. Punctuation only. */
function sentence(text: string): string {
  const t = text.trim().replace(/\s*[;.]+$/, "");
  if (!t) return "";
  const cased = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

/** `["A thing", "Another thing"]` → `"A thing and another thing"`. */
function joinClauses(parts: string[]): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const tail = clean.slice(1).map(lower);
  return tail.length === 1
    ? `${clean[0]} and ${tail[0]}`
    : `${[clean[0], ...tail.slice(0, -1)].join(", ")} and ${tail[tail.length - 1]}`;
}

/** `technical_buyer` → `Technical buyer`. Lower-snake canonical tokens only. */
function titleizeToken(token: string): string {
  const words = token.replace(/_/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * One "why it matters" clause, in product language.
 *
 * Two canonical strings need structural help rather than a nicer adjective:
 * `signal_convergence.detail` is a count with a hard-coded plural
 * ("1 independent families"), and `route_relevance.detail` is up to two
 * shareable labels joined with "; ". Both are rebuilt from their parts.
 */
function clauseText(c: { kind: string; detail: string | null; commercialImplication: string | null }): string | null {
  const raw = c.commercialImplication || c.detail;
  if (!raw) return null;

  if (c.kind === "signal_convergence") {
    const m = /^\s*(\d+)\b/.exec(c.detail ?? "");
    if (!m) return sentence(raw);
    const n = Number(m[1]);
    if (n === 0) return "No independent corroboration yet.";
    return n === 1
      ? "Corroborated by one independent signal family."
      : `Corroborated by ${n} independent signal families.`;
  }

  if (c.kind === "route_relevance" && c.detail) {
    const joined = joinClauses(c.detail.split(";"));
    return joined ? sentence(joined) : sentence(raw);
  }

  return sentence(raw);
}

/** Canonical stakeholder roles (`stakeholders.role` CHECK). */
const ROLE_LABEL: Record<string, string> = {
  economic_buyer: "Economic buyer",
  technical_buyer: "Technical buyer",
  champion: "Champion",
  influencer: "Influencer",
  blocker: "Blocker",
  end_user: "End user",
};

/**
 * Canonical `assertion_state` → what happened, and what it still needs.
 * `verified` is a confirmation; `inferred` is a machine reading that has not
 * been confirmed, and the qualifier has to say so or the row overstates itself.
 */
const ASSERTION_COPY: Record<string, { verb: string; qualifier: string | null }> = {
  verified: { verb: "confirmed", qualifier: null },
  inferred: { verb: "identified", qualifier: "Needs validation" },
  unverified: { verb: "recorded", qualifier: "Not yet verified" },
};

interface ChangeCopy {
  title: string;
  qualifier: string | null;
}

/**
 * A remembered event, in product language.
 *
 * Reads the ledger's STRUCTURED payload rather than parsing its prose, so
 * "champion — verified (supersedes champion — inferred)" is rebuilt from
 * `afterState.role`, `afterState.assertion_state` and `beforeState.assertion_state`
 * instead of from a regex over an audit string.
 *
 * When the payload is absent — which is exactly what `buildPursuitMemory` does
 * for a caller without internal visibility — this falls through to the canonical
 * reason. A guest therefore sees plainer copy, never a fabricated detail and
 * never a payload they may not read.
 */
function changeCopy(e: {
  changeType: string;
  reason: string | null;
  afterState: Record<string, unknown> | null;
  beforeState: Record<string, unknown> | null;
}): ChangeCopy {
  const fallback = e.reason ?? titleizeToken(e.changeType);

  if (e.changeType === "STAKEHOLDER_ROLE_ASSERTED") {
    const role = typeof e.afterState?.role === "string" ? e.afterState.role : null;
    const state = typeof e.afterState?.assertion_state === "string" ? e.afterState.assertion_state : null;
    const copy = state ? ASSERTION_COPY[state] : null;
    if (role && copy) {
      const label = ROLE_LABEL[role] ?? titleizeToken(role);
      const wasInferred = e.beforeState?.assertion_state === "inferred";
      return {
        title: `${label} ${copy.verb}`,
        // A confirmation that replaced a machine reading is the more useful
        // fact than the generic qualifier, so it wins the one slot available.
        qualifier: state === "verified" && wasInferred ? "Previously inferred" : copy.qualifier,
      };
    }
    return { title: sentence(fallback).replace(/\.$/, ""), qualifier: null };
  }

  if (e.changeType === "PARTNER_OVERRIDE") {
    const category = typeof e.afterState?.category === "string" ? e.afterState.category : null;
    return {
      title: "Route overridden by a person",
      qualifier: category ? titleizeToken(category) : null,
    };
  }

  // These two record their own rationale or payload in `reason`, so the reason
  // is the qualifier and the title has to be supplied. Left unmapped they render
  // as a bare fragment ("exec relationship") or as a database operation
  // ("Linked fact (SOLUTION_FIT)") — both visible now that the earlier-history
  // disclosure actually opens.
  if (e.changeType === "OVERRIDE_RECORDED") {
    return { title: "Override rationale recorded", qualifier: e.reason?.trim() || null };
  }
  if (e.changeType === "FACT_LINKED_TO_PURSUIT") {
    const relevance = typeof e.afterState?.relevance === "string" ? e.afterState.relevance : null;
    return { title: "Evidence linked to this pursuit", qualifier: relevance ? titleizeToken(relevance) : null };
  }

  // Everything else: the ledger's reason already reads as a short statement
  // ("Team assembled (5 roles)", "Pursuit detected (SYSTEM_DETECTED)"). Capitalise
  // it and let the component humanise any embedded enum token.
  return { title: sentence(fallback).replace(/\.$/, ""), qualifier: null };
}

/**
 * "Sep 12", or "Sep 12, 2025" once the year stops being obvious. Fixed en-US
 * month abbreviations rather than a runtime locale, so server and client render
 * the same string and a snapshot cannot drift with the host's ICU data.
 */
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const stamp = `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? stamp : `${stamp}, ${d.getUTCFullYear()}`;
}

const DEGRADED: ReadonlySet<FactStatus> = new Set<FactStatus>(["STALE", "SUPERSEDED", "EXPIRED"]);
const WEAK_PROVENANCE: ReadonlySet<ProvenanceClass> = new Set<ProvenanceClass>(["THIRD_PARTY_UNVERIFIED", "INFERRED"]);

/** A fact's state, in the same five-state vocabulary the gaps use. */
function factState(f: { status: FactStatus; provenanceClass: ProvenanceClass; freshness: number }): ContextState {
  if (f.status === "DISPUTED") return "CONFLICTING";
  if (DEGRADED.has(f.status) || f.freshness < 0.15) return "OUT_OF_DATE";
  if (WEAK_PROVENANCE.has(f.provenanceClass)) return "NEEDS_VALIDATION";
  return "VERIFIED";
}

function evidenceLine(f: DirectEvidenceItem | SupportingContextItem, origin: "PURSUIT" | "ACCOUNT"): ContextEvidenceLine {
  const state = factState(f);
  return {
    factId: f.factId,
    label: f.label,
    predicateKey: f.predicateKey,
    origin,
    state,
    stateLabel: stateLabelFor(state, origin),
    note: PROVENANCE_WORD[f.provenanceClass] ?? "Source not stated",
  };
}

/** Relevance types that answer the timing question. Canonical, not keyword-matched. */
const TIMING_RELEVANCE = new Set(["TIMING_ANCHOR"]);

/**
 * The one sentence that keeps the Globex case honest. The account holds a
 * customer-declared renewal date; the pursuit has no verified timing anchor.
 * "Timing is known" would be false and "timing is not identified" would be
 * false, so the note says exactly both halves.
 */
function timingNoteText(t: SupportingContextItem): ContextTimingNote {
  return {
    text: `${PROVENANCE_WORD[t.provenanceClass] ?? "Account"} timing exists on the account — not yet confirmed for this pursuit`,
    refType: "fact",
    refId: t.factId,
  };
}

/**
 * Compose the brief.
 *
 * Every section degrades honestly: an absent input produces an empty section and
 * a stated reason, never a confident-sounding placeholder.
 */
export function composePursuitContext(input: PursuitContextInput): PursuitContextView {
  const now = input.now ?? new Date();
  const evidenceBudget = input.evidenceBudget ?? 4;
  const changeBudget = input.changeBudget ?? 3;

  // --- A · Why this matters -------------------------------------------------
  // Pursuit-scoped: why THIS pursuit looks live on its own evidence. Not why it
  // outranks another pursuit — that is portfolio work (D-017).
  const clauses: ContextClause[] = [];
  const w = input.whyNow;
  if (w?.present) {
    for (const c of [w.businessTrigger, w.technologyCondition, w.timingAnchor, w.signalConvergence, w.routeRelevance]) {
      if (!c?.present) continue;
      const text = clauseText(c);
      if (!text) continue;
      clauses.push({ text, refType: c.refType ?? "pursuit", refId: c.refId ?? input.pursuitId });
    }
  }
  // Fall back to the strongest confirmed evidence — still canonical text.
  if (!clauses.length) {
    const strongest = input.evidence?.direct[0];
    if (strongest) {
      clauses.push({ text: sentence(strongest.label), refType: "fact", refId: strongest.factId });
    }
  }

  const health = input.contextHealth;
  const confidence: ContextConfidence = health
    ? (clauses.length ? CONFIDENCE_FROM_HEALTH[health.conclusion] : "NOT_ESTABLISHED")
    : "NOT_ESTABLISHED";
  // The top concern, phrased as something a reader can act on. The canonical
  // text is an inventory note ("No identity context researched yet"); the gap it
  // describes is a research task, so it is stated as one.
  const topConcern = health?.concerns[0] ?? null;
  const confidenceReason = topConcern
    ? topConcern.kind === "MISSING_COVERAGE" && topConcern.refId
      ? `${titleizeToken(topConcern.refId)} context still needs research.`
      : sentence(topConcern.text)
    : null;

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
  const allChanges: ContextChangeLine[] = newestFirst.map((e) => {
    const copy = changeCopy(e);
    const stamp = dateLabel(e.occurredAt, now);
    return {
      id: e.id,
      changeType: e.changeType,
      text: copy.title,
      meta: [copy.qualifier, stamp].filter(Boolean).join(" · "),
      canonicalReason: e.reason,
      at: e.occurredAt,
      materiality: e.materiality,
      byPerson: e.actor.type === "USER",
    };
  });
  // Head stays concise; the tail travels with it so the disclosure has content.
  // Every entry the memory read-model returned is in one list or the other —
  // asserted by test, because "the count matches" is the property that broke.
  const entries = allChanges.slice(0, changeBudget);
  const earlier = allChanges.slice(changeBudget);

  // --- D · Needs attention --------------------------------------------------
  const gaps = input.missingContext?.gaps ?? [];
  const top = gaps[0] ?? null;

  // Account-held timing, if any. Used twice: to soften a timing gap that happens
  // to rank first, and to carry the standalone note when it does not.
  const accountTiming = (input.evidence?.supporting ?? []).find((s) => TIMING_RELEVANCE.has(s.inferredRelevance)) ?? null;
  const hasTimingGap = gaps.some((g) => g.source === "WHY_NOW");
  const timingNote: ContextTimingNote | null =
    hasTimingGap && accountTiming ? timingNoteText(accountTiming) : null;
  let primary: ContextAttention | null = null;
  if (top) {
    let state = GAP_STATE[top.kind];
    let accountSignal: ContextAttention["accountSignal"] = null;

    // The Globex nuance. When the gap is a timing question and the ACCOUNT holds
    // timing context, the honest answer is neither "not identified" nor "timing
    // is known": the pursuit's timing has not been validated, and the account
    // already offers something to validate it against.
    if (top.source === "WHY_NOW" && accountTiming) {
      state = "NEEDS_VALIDATION";
      accountSignal = { ...timingNoteText(accountTiming) };
    }

    primary = {
      state,
      stateLabel: CONTEXT_STATE_LABEL[state],
      headline: top.text,
      detail: top.whyItMatters,
      resolution: top.howToResolve,
      refType: top.refType,
      refId: top.refId,
      accountSignal,
    };
  }

  // The rest, in Missing Context's ranking — carried, not summarised into a
  // number. Each keeps its own state so the drawer does not read as ten
  // identical "missing" rows (D-019).
  const others: ContextAttentionBrief[] = (primary ? gaps.slice(1) : gaps).map((g) => {
    const s = GAP_STATE[g.kind];
    return { state: s, stateLabel: CONTEXT_STATE_LABEL[s], headline: g.text, refType: g.refType, refId: g.refId };
  });

  return {
    pursuitId: input.pursuitId,
    accountLabel: input.accountLabel,
    whyThisMatters: { clauses, confidence, confidenceReason },
    whatWeKnow: { confirmed, accountContext, hiddenCount },
    whatChanged: { entries, earlier, hiddenCount: earlier.length },
    needsAttention: { primary, others, otherCount: others.length, timingNote },
    computedAt: now.toISOString(),
  };
}
