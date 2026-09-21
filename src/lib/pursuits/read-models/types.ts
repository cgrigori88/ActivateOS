/**
 * Read-model contracts (Workstream D, §1/§49/§50). Page-shaped, explanation-ready view types.
 * The UI consumes ONLY these — it never queries raw entities and never recomputes a score.
 * Every score arrives with its band + a canonical "why" affordance payload; every confidential
 * field is already disclosure-filtered server-side before it reaches these objects.
 */

export type Band = "very_high" | "high" | "moderate" | "low" | "unknown";
export type DisclosureClass = "PUBLIC" | "INTERNAL" | "PARTNER_SHARED" | "TRANSACTION_CONFIDENTIAL" | "PII" | "RESTRICTED";

/** A score rendered as a band first, exact value secondary (§10), with an explanation payload (§9/§29). */
export interface ScoreView {
  key: string;                       // 'priority' | 'purchase_propensity' | 'evidence_confidence' | ...
  label: string;
  band: Band;
  value: number | null;              // null = unknown, distinct from 0 (§17/§41)
  known: boolean;
  definition: string;                // canonical, page-invariant meaning (§9)
  why: ScoreReason[];                // strong / missing lines (§6/§29)
}
export interface ScoreReason { text: string; polarity: 1 | -1 | 0; strength?: "strong" | "missing"; refType?: string; refId?: string | null; }

/** Trust label attached to any surfaced fact/feature (§23/§37). */
export type TrustLabel = "VERIFIED" | "DISPUTED" | "STALE" | "SUPERSEDED" | "FIRST_PARTY" | "EXTERNAL" | "HUMAN_ASSERTED" | "SYNTHETIC" | "HYPOTHESIS";

export interface FreshnessView { label: string; at: string | null }   // e.g. "Updated 12m ago"

// ---- Today decision queue (§2/§3/§4/§54) -----------------------------------
export type DecisionClass = "DECISION_REQUIRED" | "MATERIAL_CHANGE" | "ACTION_REQUIRED" | "RISK" | "OPPORTUNITY" | "FYI";
/** P2 — the "#N of M · Why here" disclosure, rendered only when Pursuit Intelligence is ON. */
export interface DecisionPertinence {
  /** 1-based, within the caller's authorized comparison set. */
  rank: number;
  /** A rank is meaningless without the set it came from, so this is never omitted. */
  comparisonSetSize: number;
  /** The active scope, always shown beside the rank. */
  scope: string;
  /** Mechanically causal — the largest positive delta in realised weighted contribution. */
  whyHere: string | null;
  /** True when this pursuit is genuinely tied with the one below it. */
  tiedWithBelow: boolean;
  /** For inspection and debugging only. NEVER the headline, and never an absolute quality claim. */
  score: number;
}

export interface DecisionItem {
  id: string;
  type: string;                      // ROUTE_APPROVAL | FACT_REVIEW | SELLER_SELECTION | TEAM_REPLACEMENT | ...
  decisionClass: DecisionClass;
  operationalUrgency: "critical" | "high" | "normal" | "low";   // distinct from commercial priority (§4)
  commercialPriority: Band;
  pursuitId: string | null;
  companyId: string | null;    // account id for the contextual intelligence drawer (§4)
  accountLabel: string;
  title: string;
  reason: string;
  before?: string | null;            // material change before/after (§24)
  after?: string | null;
  allowedActions: DecisionAction[];  // map to governed Skills (§30)
  deepLink: string;                  // §41
  synthetic: boolean;
  at: string;
  /**
   * vNext Slice 2B — present only when Today composes pursuit attention (flag ON): the card is a
   * pursuit's one attention item. Absent on every flag-OFF item, so the certified card renders
   * exactly as before.
   */
  attention?: DecisionAttention;
  /**
   * P2 — present only when Pursuit Intelligence is ON. Absent on every flag-OFF item, so the
   * certified card renders exactly as before and the flag-OFF ordering falls back to the
   * commercial-priority band. The RANK is the product; `score` is for inspection only.
   */
  pertinence?: DecisionPertinence;
  /**
   * A SERVER-MINTED ATTENTION TOKEN, present only when this card carries P2 facts and the surface
   * is a ranked one. It is opaque to the browser: the client may carry it back on the explicit CTA
   * and may not author its contents. Rendering it writes nothing — redeeming it is the write.
   */
  attentionToken?: string;
  /** vNext Slice 2B — the pursuit's other reasons, folded beneath this card instead of becoming cards. */
  others?: DecisionOther[];
}
export interface DecisionAction { label: string; skill: string; sideEffect: "READ" | "INTERNAL_WRITE" | "CROSS_TENANT_ACTION"; }
/** What a pursuit-attention card carries beyond a decision item. All copy is chosen server-side. */
export interface DecisionAttention {
  /** Deterministic key of the primary reason — stable while the canonical state is. */
  key: string;
  /** PLAN: a person's decision on the plan · EXECUTION: approved work · PROGRESS: informational. */
  layer: "PLAN" | "EXECUTION" | "PROGRESS";
  ownerLabel: string | null;
  ownerNote: string | null;
  dueLabel: string | null;
  dueState: "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | null;
  /** Every reason derived for the pursuit, primary first (for explanation, never for re-ranking). */
  kinds: string[];
}
/**
 * A reason folded beneath a pursuit's card. `actionLabel` is the folded item's own CTA, so it stays
 * actionable from the disclosure ("Approve route via CDW → Approve"), not merely listed.
 */
export interface DecisionOther { key: string; title: string; detail: string | null; deepLink: string; actionLabel?: string; }
export interface TodayQueueView {
  generatedAt: string; items: DecisionItem[]; counts: Record<DecisionClass, number>;
  /** How many cards the queue holds (what "View all" opens). */
  total?: number;
  /**
   * Slice 2B composition only: every underlying decision/attention reason on Today, however it is
   * grouped (each card plus everything folded beneath it). Absent on the certified queue, where each
   * reason is its own card and `total` already means the same thing.
   */
  decisionCount?: number;
  demoBanner: string | null;
}

// ---- Portfolio (§5/§6) -----------------------------------------------------
export interface PortfolioRow {
  pursuitId: string; accountLabel: string; thesis: string; solution: string | null;
  priority: ScoreView; propensity: ScoreView; evidenceConfidence: ScoreView; timing: ScoreView;
  recommendedRoute: string | null; routeConfidence: ScoreView; activationReadiness: ScoreView;
  stage: string; expectedValue: number | null; currency: string | null;
  lastMaterialChange: string | null; nextBestAction: string | null; synthetic: boolean; deepLink: string;
}
export interface PortfolioAccountGroup { accountId: string; accountLabel: string; pursuits: PortfolioRow[]; }
export interface PursuitPortfolioView { rows: PortfolioRow[]; grouped: PortfolioAccountGroup[]; total: number; }

// ---- Why Now (§11/§12/§13/§14) ---------------------------------------------
export interface WhyNowComponent { kind: string; label: string; present: boolean; detail: string | null; commercialImplication: string | null; refType?: string; refId?: string | null; synthetic?: boolean; }
export interface WhyNowView {
  present: boolean;                  // false → "no structured Why Now yet" (do not fabricate, §42)
  businessTrigger: WhyNowComponent | null;
  technologyCondition: WhyNowComponent | null;
  timingAnchor: WhyNowComponent | null;
  signalConvergence: WhyNowComponent | null;
  routeRelevance: WhyNowComponent | null;
  contradictions: { text: string; supporting: number; contradicting: number }[];
  unknowns: string[];                // "what we don't know" (§14)
  renderedSummary: string | null;    // derivative prose (§11)
  asOf: string | null;
  /**
   * Lifecycle Intelligence (P2A) — the account's lifecycle events with their derived state
   * (VERIFIED_DATE / INFERRED_WINDOW / STALE_DATE / CONFLICTING_DATE), never flattened into a
   * point date. Empty array = UNKNOWN, which is displayed as such rather than hidden.
   */
  lifecycle: import("@/lib/lifecycle/state").LifecycleEvent[];
}

// ---- Route comparison (§15/§16/§17/§18) ------------------------------------
export interface RouteDimensionCell { band: Band; known: boolean; label: string; }   // unknown ≠ zero (§17)
export interface RouteCandidateView {
  key: string; label: string; topology: string; rank: number; disqualified: boolean;
  routeScore: ScoreView; partnerActivation: ScoreView; suitability: ScoreView; readiness: ScoreView; confidence: ScoreView;
  dimensions: Record<string, RouteDimensionCell>;
  reasonsShareable: ScoreReason[];   // disclosure-filtered (§25/§39)
  reasonsInternal: ScoreReason[] | null;   // null when caller lacks internal disclosure (§39/§40/§65)
  disqualifiers: { code: string; severity: "HARD" | "SOFT"; detail: string }[];
  synthetic: boolean;
  // Execution-history EVIDENCE (P1B.2): canonical outcomes + attribution for this candidate
  // partner in this pursuit's category. Display-only — never an input to any score (fit-v2 is a
  // deferred versioned decision). Absent for candidates without a partner or without history.
  executionHistory?: ScoreReason[];
  executionSummary?: { won: number; lost: number; sample: number } | null;
}
export interface RoutePathStep { role: string; label: string; sequence: number; }
export interface RouteComparisonView {
  path: RoutePathStep[];
  recommended: RouteCandidateView | null;
  selected: RouteCandidateView | null;
  selectionMatchesRecommendation: boolean;   // "Recommendation accepted" vs override (§18)
  overrideReason: string | null;
  overrideCategory: string | null;
  alternatives: RouteCandidateView[];
  changeEvents: { at: string; before: string | null; after: string | null; trigger: string; synthetic: boolean }[]; // §20/§24
  dimensionKeys: string[];
  // Canonical micro-loop decision state (governed route decision):
  decided: boolean;                 // route_status = 'SELECTED' — a human has committed a decision
  selectedKey: string | null;       // the currently-selected candidate id (even when it == recommended)
  recomputePending: boolean;        // a recompute triggered by the decision is still PENDING/RUNNING —
                                    // the UI must NOT imply downstream state has settled until this clears
}

// ---- Team (§21/§22) --------------------------------------------------------
export interface TeamMemberView {
  id: string; role: string; side: string; personLabel: string | null; partnerLabel: string | null;
  status: string; fit: ScoreView | null; missing: boolean; required: boolean;
  // The governed next step an operator can take on this member (Phase C2): a recommended member is
  // confirmed, a confirmed (invited) member is marked accepted. null when there's nothing to decide.
  nextGovernedAction: "confirm" | "accept" | null;
  // A confirmed-but-not-yet-accepted role — the pursuit is waiting on this participant.
  waiting: boolean;
}
export interface PursuitTeamView { members: TeamMemberView[]; activationReadiness: ScoreView; missingRequiredRoles: string[]; gapActions: DecisionItem[]; sellerAlternatives: { sellerId: string; label: string; fit: ScoreView }[]; }

// ---- Timeline + evidence (§23/§25/§26) -------------------------------------
export interface TimelineEvent { at: string; changeType: string; label: string; before: string | null; after: string | null; materiality: string; synthetic: boolean; }
export interface PursuitTimelineView { events: TimelineEvent[]; }
export interface EvidenceItem { id: string; claim: string; trust: TrustLabel[]; sourceType: string; observedAt: string | null; disclosureClass: DisclosureClass; }
export interface FactItem { id: string; proposition: string; state: string; trust: TrustLabel[]; confidence: ScoreView | null; }

// ---- Detail (page-shaped composite, §7/§50) --------------------------------
export interface PursuitDetailView {
  pursuitId: string; accountId: string; accountLabel: string; thesis: string; solution: string | null;
  lifecycle: string; expectedValue: number | null; currency: string | null; lastMaterialChange: string | null;
  decisionBand: ScoreView[];         // Priority, Propensity, Evidence Confidence, Timing, Route, Readiness (+ Expected Value tile) (§8)
  whyNow: WhyNowView;
  route: RouteComparisonView;
  team: PursuitTeamView;
  timeline: PursuitTimelineView;
  facts: FactItem[];
  pendingDecisions: DecisionItem[];
  freshness: FreshnessView[];
  synthetic: boolean;
  demoBanner: string | null;
  /** Stakeholder Intelligence (P1C) — canonical coverage projection; null only when the read fails. */
  stakeholders: import("@/lib/stakeholders/coverage").StakeholderCoverage | null;
  /** Value Case (P2B) — the INTERNAL, fully-authorized economic projection. Never partner-safe. */
  valueCase: import("@/lib/value/case").ValueCase | null;
}
