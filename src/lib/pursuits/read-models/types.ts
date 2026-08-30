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
export interface DecisionItem {
  id: string;
  type: string;                      // ROUTE_APPROVAL | FACT_REVIEW | SELLER_SELECTION | TEAM_REPLACEMENT | ...
  decisionClass: DecisionClass;
  operationalUrgency: "critical" | "high" | "normal" | "low";   // distinct from commercial priority (§4)
  commercialPriority: Band;
  pursuitId: string | null;
  accountLabel: string;
  title: string;
  reason: string;
  before?: string | null;            // material change before/after (§24)
  after?: string | null;
  allowedActions: DecisionAction[];  // map to governed Skills (§30)
  deepLink: string;                  // §41
  synthetic: boolean;
  at: string;
}
export interface DecisionAction { label: string; skill: string; sideEffect: "READ" | "INTERNAL_WRITE" | "CROSS_TENANT_ACTION"; }
export interface TodayQueueView { generatedAt: string; items: DecisionItem[]; counts: Record<DecisionClass, number>; demoBanner: string | null; }

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
}

// ---- Team (§21/§22) --------------------------------------------------------
export interface TeamMemberView { role: string; side: string; personLabel: string | null; status: string; fit: ScoreView | null; missing: boolean; }
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
}
