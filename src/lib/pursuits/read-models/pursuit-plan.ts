import { createHash } from "node:crypto";
import { formatMoney } from "@/lib/format/money";
import type { Caller } from "./helpers";
import type { ContextGap, GapKind, GapSource } from "./missing-context";
import { canDisclose } from "./pertinence";
import { CONTEXT_STATE_LABEL, type ContextState } from "./pursuit-context";
import type { DisclosureClass } from "./types";

/**
 * Pursuit Plan (vNext Slice 2A) — Pursuit Goal → Pursuit Plan → Motion → Action.
 *
 * WHAT THIS MODULE IS. The deterministic half of Pursuit Coordination: given the
 * canonical state of one pursuit (already loaded, already tenant-scoped, already
 * disclosure-filtered), it composes
 *
 *   • a GOAL draft — the durable commercial outcome, from the pursuit's thesis and
 *     its open opportunity. Never the route, motion, action or owner: those are how
 *     the ecosystem intends to get there, and they belong to the plan (D-033);
 *   • a PLAN — milestones with dependencies, each resolved from a canonical domain
 *     rather than typed by hand (the house rule `goals.ts` already follows);
 *   • the CURRENT FOCUS — the top-ranked unresolved gap, carried from Missing
 *     Context with its rank and source intact, never re-ranked here (D-019);
 *   • the MOTION that carries execution — an existing `revenue_motions` row, named
 *     only through a canonical link, never inferred;
 *   • the NEXT ACTION and its OWNER — from a declared table, owned by a pursuit-team
 *     role, and explicitly unassigned when nobody holds it;
 *   • WHY — each line citing a canonical record and saying which scope it is true at;
 *   • a FINGERPRINT of the inputs, so "is the approved plan still current?" is a
 *     comparison, not an opinion.
 *
 * IT GENERATES NOTHING. No model, no template filled from free text. Every string is
 * canonical text carried from the domain that wrote it, or a phrase chosen from a
 * declared table by a canonical state (D-005, D-022).
 *
 * IT DECIDES NOTHING. A recommendation produced here is persisted as a proposal; only
 * a person turns it into a plan in force (D-004). Approval, staging and ledger writes
 * live in `coordination/plan-store.ts`, behind `dispatchSkill`.
 *
 * Pure. No database, no clock of its own, no writes.
 */

export const RECOMMENDER_VERSION = "pursuit-plan-v2";
/** The version historical revisions carry. Never written again; read for life (P3 Slice 2C). */
export const PLAN_CONTENT_SCHEMA_V1 = 1 as const;
export const PLAN_CONTENT_SCHEMA_V2 = 2 as const;
/** What new revisions are written as. */
export const PLAN_CONTENT_SCHEMA = PLAN_CONTENT_SCHEMA_V2;

/**
 * How many distinct recommended actions a v2 plan may carry.
 *
 * A PRODUCT-GLOBAL, SCHEMA-VERSIONED PRESENTATION BOUND — a human commercial plan with a dozen
 * "next" actions is not a plan. It is deliberately NOT a governance limit, NOT a runtime authority
 * limit, NOT a semantic cohort definition (contrast `analyze()`, where a limit may never decide
 * membership — D-P7-COHORT-COMPLETENESS), and NOT organization-configurable.
 */
export const MAX_PLAN_ACTIONS_V2 = 3;

/**
 * Default time allowed for a staged next action, in days after approval. A declared
 * planning default, not a commercial fact — a person can change it when adjusting.
 */
export const DEFAULT_ACTION_DUE_DAYS = 5;

// ---------------------------------------------------------------------------
// Input — the normalized canonical state of one pursuit
// ---------------------------------------------------------------------------

export type CoverageRoleState = "VERIFIED" | "INFERRED" | "UNVERIFIED" | "MISSING";

export interface PlanTeamMember {
  id: string;
  role: string;
  status: string;
  personLabel: string | null;
  partnerLabel: string | null;
}

export interface PlanWarmPath {
  tier: string;
  text: string;
  via: string | null;
  refType: string;
  refId: string | null;
}

export interface PlanState {
  pursuitId: string;
  accountLabel: string;
  pursuitStatus: string;
  businessProblem: string | null;
  /** The pursuit's primary open opportunity, when one is linked. */
  opportunity: { id: string; name: string; stage: string; amountUsd: number | null; expectedClose: string | null } | null;
  /** Route recommendation vs human selection, as the route read-model states it. */
  route: { decided: boolean; selectedLabel: string | null; recommendedLabel: string | null; overridden: boolean } | null;
  /**
   * The motion carrying this pursuit. Only ever a canonical link: the motion names
   * the pursuit (`PURSUIT`), or it is the motion this pursuit's opportunity is
   * attributed to (`OPPORTUNITY`). Null means no motion — never a guess.
   */
  motion: { id: string; label: string | null; status: string; partnerLabel: string | null; linkage: "PURSUIT" | "OPPORTUNITY"; openActions: number } | null;
  /** Buying-role coverage. `withheld` when the caller may not see the sponsor's map. */
  stakeholders: { established: boolean; withheld: boolean; roles: { role: string; state: CoverageRoleState; personName: string | null }[] } | null;
  /** MEDDPICC element → status, for the primary opportunity. Null = nothing to qualify. */
  qualification: Record<string, string> | null;
  valueState: "STRONG" | "INCOMPLETE" | "CONFLICTING" | "NOT_ESTABLISHED" | null;
  /** Whether the pursuit has a verified timing anchor, and what the ACCOUNT holds. */
  timing: {
    anchored: boolean;
    accountEvent: { label: string; date: string | null; state: string; factId: string | null } | null;
  };
  /** Ranked gaps from Missing Context — already disclosure-filtered upstream. */
  gaps: ContextGap[];
  team: PlanTeamMember[];
  warmPaths: PlanWarmPath[];
}

// ---------------------------------------------------------------------------
// Content — what a revision carries
// ---------------------------------------------------------------------------

export type MilestoneRule =
  | { kind: "ROUTE_DECIDED" }
  | { kind: "ROLE_VERIFIED"; role: string }
  | { kind: "TIMING_CONFIRMED" }
  | { kind: "QUALIFICATION_KNOWN"; elements: string[] }
  | { kind: "VALUE_DEFENSIBLE" }
  | { kind: "OPPORTUNITY_OPEN" }
  | { kind: "CLOSED_WON" };

export type MilestoneStatus = "DONE" | "OPEN" | "BLOCKED" | "NOT_ESTABLISHED";

export interface PlanMilestone {
  key: string;
  label: string;
  rule: MilestoneRule;
  /** Keys of milestones that should hold first. A planning dependency, not a fact. */
  dependsOn: string[];
}

/** One line of "why", tied to the canonical record that makes it true. */
export interface PlanEvidenceRef {
  text: string;
  refType: string;
  refId: string | null;
  /**
   * The scope the claim is true at. ACCOUNT context bears on this pursuit without
   * anyone having confirmed it here, and must never read as pursuit-confirmed (D-020).
   */
  origin: "PURSUIT" | "ACCOUNT";
  disclosure: DisclosureClass;
}

export interface PlanOwner {
  /**
   * PERSON          a named person holds the role on the pursuit team
   * ROLE_UNFILLED   the role exists on the team only as a recommendation — nobody confirmed
   * UNASSIGNED      no one holds the role at all
   */
  kind: "PERSON" | "ROLE_UNFILLED" | "UNASSIGNED";
  teamMemberId: string | null;
  role: string | null;
  roleLabel: string | null;
  personLabel: string | null;
  confirmed: boolean;
}

export interface PlanMotionRef {
  motionId: string | null;
  linkage: "PURSUIT" | "OPPORTUNITY" | "NONE";
  label: string | null;
  status: string | null;
  partnerLabel: string | null;
  openActions: number;
}

export interface PlanNextAction {
  /** Stable across revisions for the same intent, so a later reader can join them. */
  key: string;
  text: string;
  /** What would count as done — the upstream domain's own resolution text. */
  doneWhen: string | null;
  via: PlanEvidenceRef | null;
  owner: PlanOwner;
  dueInDays: number;
  /** Set on a DECISION when the action was staged into the motion's queue. */
  stagedMotionActionId: string | null;
}

export interface PlanFocus {
  gapKey: string;
  source: GapSource;
  kind: GapKind;
  headline: string;
  /** The upstream rank, carried (D-019). */
  rank: number;
  refType: string;
  refId: string | null;
  milestoneKey: string | null;
}

/**
 * What a plan revision carries. Deliberately NO goal text: the plan implements a goal
 * (`pursuit_plans.goal_id`), it does not restate it — a copied objective would drift
 * from the goal it claims to serve, and would couple the goal to plan revisions.
 */
/**
 * ONE RECOMMENDED ACTION (P3 Slice 2C, schema v2).
 *
 * Identical to `PlanNextAction` except for what it deliberately does NOT carry:
 *
 *   - no `stagedMotionActionId`. A revision is immutable, and staging happens over time as
 *     commercial state progresses; a pointer inside the plan would have to be written after the
 *     fact. Lineage therefore lives on the mutable `motion_actions` row (migration 0115).
 *   - no capability, skill, version or args. A v2 action is COMMERCIAL INTENT and is
 *     non-executable by construction. Action text can never create executability, and nothing in
 *     2C-A compiles a plan into anything a runtime can run.
 */
export interface PlanActionV2 {
  /** Stable across revisions for the same intent, so a later reader can join them. */
  key: string;
  text: string;
  /** What would count as done — the upstream domain's own resolution text. */
  doneWhen: string | null;
  via: PlanEvidenceRef | null;
  owner: PlanOwner;
  dueInDays: number;
  /**
   * The milestone this action advances, when it advances one. A REFERENCE into the milestone
   * layer, never a new dependency edge: `PlanMilestone.dependsOn` already carries dependencies and
   * `evaluateMilestones` already computes BLOCKED from them.
   */
  milestoneKey: string | null;
}

/** What a v1 revision carries. Historical: read for life, never written again, never rewritten. */
export interface PlanContentV1 {
  schema: typeof PLAN_CONTENT_SCHEMA_V1;
  focus: PlanFocus | null;
  motion: PlanMotionRef;
  nextAction: PlanNextAction | null;
  milestones: PlanMilestone[];
  why: PlanEvidenceRef[];
}

/**
 * What a v2 revision carries.
 *
 * > **`actions[]` is ordered recommendation PRIORITY. It is not a strict execution dependency
 * > chain and not a sequential runtime program.**
 *
 * Order is inherited from Missing Context's ranking, which this module never re-ranks (D-019).
 * Dependency truth stays in the milestone layer, which is why an action references a milestone
 * instead of naming another action.
 */
export interface PlanContentV2 {
  schema: typeof PLAN_CONTENT_SCHEMA_V2;
  focus: PlanFocus | null;
  motion: PlanMotionRef;
  /** Ordered, at most `MAX_PLAN_ACTIONS_V2`, and `[]` is legal. */
  actions: PlanActionV2[];
  milestones: PlanMilestone[];
  why: PlanEvidenceRef[];
}

/** What a row may hold. Discriminated on `schema` — the only legal way to tell them apart. */
export type StoredPlanContent = PlanContentV1 | PlanContentV2;

/**
 * THE NORMALIZED IN-MEMORY VIEW. Every reader consumes this shape, whatever the row holds, and
 * obtains it only through `normalizePlanContent`.
 */
export type PlanContent = PlanContentV2;

/**
 * The normalized inputs whose drift makes an approved plan reviewable.
 *
 * **V1 IS FROZEN.** Stored v1 plans are compared v1-to-v1 for life, so this shape and the function
 * that builds it must not change — a stored fingerprint compared against a differently-computed
 * one would flip every in-force plan to REVIEWABLE at once, which is a mass product event, not a
 * refactor (P3 Slice 2C §3).
 */
export interface PlanFingerprintInputsV1 {
  v: 1;
  pursuitStatus: string;
  opportunity: { id: string; stage: string } | null;
  route: { decided: boolean; selected: string | null } | null;
  motion: { id: string; status: string; linkage: string } | null;
  focus: { gapKey: string; kind: GapKind } | null;
  milestones: Record<string, MilestoneStatus>;
  owner: { role: string | null; memberId: string | null; status: string | null } | null;
}

/**
 * V2 inputs — everything whose change could alter the ORDERED RECOMMENDED ACTION SET.
 *
 * `focus` alone was sufficient while a plan carried one action derived from one gap. With three,
 * actions 2 and 3 descend from gaps the v1 basis never mentioned, so a change to those gaps would
 * silently leave an in-force plan looking current while the recommendation had moved.
 *
 * What is deliberately ABSENT is as load-bearing as what is present: no action `text`, `doneWhen`,
 * `via` or `dueInDays`, and no human adjustment. Those are rendered prose and human decisions, not
 * canonical inputs. The question plan review asks is *"has the recommendation basis materially
 * changed?"*, never *"would the world regenerate the human's edited words?"*
 */
export interface PlanFingerprintInputsV2 {
  v: 2;
  pursuitStatus: string;
  opportunity: { id: string; stage: string } | null;
  route: { decided: boolean; selected: string | null } | null;
  motion: { id: string; status: string; linkage: string } | null;
  focus: { gapKey: string; kind: GapKind } | null;
  milestones: Record<string, MilestoneStatus>;
  /** One entry per recommended action, in recommended order. Array ORDER is the order. */
  actions: {
    key: string;
    /** The gap that drove it — the dedup winner, so a losing sibling cannot move the plan. */
    gapKey: string;
    source: GapSource;
    kind: GapKind;
    milestoneKey: string | null;
    owner: { role: string | null; memberId: string | null; status: string | null } | null;
  }[];
}

export type PlanFingerprintInputs = PlanFingerprintInputsV1 | PlanFingerprintInputsV2;

export interface PlanBasis {
  /**
   * RECORDED, NEVER HASHED. Hashing the algorithm's identity would make every in-force plan
   * REVIEWABLE the next time the recommender is touched — the same mass-staleness event versioned
   * fingerprints exist to prevent. The same reasoning covers `MAX_PLAN_ACTIONS_V2`.
   */
  recommenderVersion: string;
  computedAt: string;
  fingerprint: string;
  inputs: PlanFingerprintInputs;
  /** Every canonical record the recommendation rests on. */
  evidence: { refType: string; refId: string | null }[];
}

export interface GoalDraft {
  objective: string;
  targetDate: string | null;
  basis: { refType: string; refId: string | null }[];
}

export interface PlanRecommendation {
  goal: GoalDraft;
  content: PlanContentV2;
  basis: PlanBasis;
  /**
   * THE SAME WORLD, COMPOSED THE WAY `e55499b` COMPOSED IT.
   *
   * Not a downgrade of `content` — independently derived from the same state by the same v1 rules,
   * so that with `PLAN_CONTENT_V2_WRITES_ENABLED` OFF the persisted row is what the previous
   * runtime would have written, and rollback to it stays valid. Keeping the recommender PURE is the
   * point: the gate is read at the persistence boundary, never inside a derivation.
   */
  legacyContent: PlanContentV1;
  /**
   * The SAME world state, fingerprinted by the unchanged v1 algorithm.
   *
   * Never persisted and never compared against a v2 plan. It exists so that a stored v1 plan can be
   * reviewed against today's world using the algorithm it was written with — the alternative,
   * comparing a v1 fingerprint to a v2 computation, never matches and would declare every legacy
   * plan stale on deploy.
   */
  legacyBasis: PlanBasis;
}

// ---------------------------------------------------------------------------
// Declared tables — the only place wording and planning policy are chosen
// ---------------------------------------------------------------------------

/**
 * Milestone catalog. Each milestone is resolved from ONE canonical domain, so its
 * status is computed, never typed — the same principle `goals.ts` applies to goal
 * progress. Dependencies are planning policy, stated here with their reason:
 *
 *   • decision/paper process → economic buyer: the paper process runs through the
 *     person who owns the budget; mapping it without them is mapping a guess.
 *   • closed-won → everything else: a close is the consequence of the plan, not a step.
 */
interface CatalogEntry extends PlanMilestone {
  applies: (s: PlanState) => boolean;
}

const hasOpportunity = (s: PlanState) => s.opportunity != null;
const coverageApplies = (s: PlanState) => s.stakeholders?.established === true && !s.stakeholders.withheld;

const CATALOG: CatalogEntry[] = [
  { key: "route_decided", label: "Route decided", rule: { kind: "ROUTE_DECIDED" }, dependsOn: [], applies: () => true },
  { key: "opportunity_open", label: "Opportunity opened", rule: { kind: "OPPORTUNITY_OPEN" }, dependsOn: [], applies: (s) => !hasOpportunity(s) },
  { key: "champion_confirmed", label: "Champion confirmed", rule: { kind: "ROLE_VERIFIED", role: "champion" }, dependsOn: [], applies: coverageApplies },
  { key: "technical_buyer_confirmed", label: "Technical buyer confirmed", rule: { kind: "ROLE_VERIFIED", role: "technical_buyer" }, dependsOn: [], applies: coverageApplies },
  { key: "economic_buyer_confirmed", label: "Economic buyer confirmed", rule: { kind: "ROLE_VERIFIED", role: "economic_buyer" }, dependsOn: [], applies: coverageApplies },
  { key: "timing_confirmed", label: "Timing confirmed for this pursuit", rule: { kind: "TIMING_CONFIRMED" }, dependsOn: [], applies: () => true },
  { key: "value_case_strong", label: "Value case established", rule: { kind: "VALUE_DEFENSIBLE" }, dependsOn: [], applies: () => true },
  {
    key: "decision_path_mapped", label: "Decision and paper process mapped",
    rule: { kind: "QUALIFICATION_KNOWN", elements: ["decision_process", "paper_process"] },
    dependsOn: ["economic_buyer_confirmed"], applies: (s) => s.qualification != null,
  },
  {
    key: "closed_won", label: "Opportunity closed won", rule: { kind: "CLOSED_WON" },
    dependsOn: ["route_decided", "champion_confirmed", "technical_buyer_confirmed", "economic_buyer_confirmed", "timing_confirmed", "value_case_strong", "decision_path_mapped"],
    applies: hasOpportunity,
  },
];

/** Gap → the milestone it would move. Keys are the canonical `ContextGap.key` shapes. */
function milestoneForGap(g: ContextGap): string | null {
  if (g.source === "STAKEHOLDER_COVERAGE" && g.refType === "stakeholder_role") {
    return g.refId === "champion" ? "champion_confirmed"
      : g.refId === "technical_buyer" ? "technical_buyer_confirmed"
        : g.refId === "economic_buyer" ? "economic_buyer_confirmed" : null;
  }
  if (g.source === "MEDDPICC" && (g.refId === "decision_process" || g.refId === "paper_process")) return "decision_path_mapped";
  // The same classifier Missing Context uses to call a Why-Now unknown blocking.
  if (g.source === "WHY_NOW" && /timing|renewal|anchor/i.test(g.text)) return "timing_confirmed";
  if (g.source === "VALUE_CASE") return "value_case_strong";
  return null;
}

/** Who owns closing each kind of gap. Pursuit-team roles (0075's registry), never a person by name. */
const OWNER_ROLE_FOR_SOURCE: Record<GapSource, string> = {
  STAKEHOLDER_COVERAGE: "VENDOR_ACCOUNT_EXECUTIVE",
  MEDDPICC: "VENDOR_ACCOUNT_EXECUTIVE",
  WHY_NOW: "VENDOR_ACCOUNT_EXECUTIVE",
  VALUE_CASE: "VENDOR_SOLUTION_ARCHITECT",
  CONTEXT_HEALTH: "VENDOR_SPECIALIST",
};

const TEAM_ROLE_LABEL: Record<string, string> = {
  VENDOR_ACCOUNT_EXECUTIVE: "Account executive",
  VENDOR_PARTNER_MANAGER: "Partner manager",
  VENDOR_SPECIALIST: "Specialist",
  VENDOR_SOLUTION_ARCHITECT: "Solution architect",
  VENDOR_EXECUTIVE_SPONSOR: "Executive sponsor",
  PARTNER_ACCOUNT_MANAGER: "Partner account manager",
};

const ROLE_WORD: Record<string, string> = {
  economic_buyer: "Economic buyer",
  champion: "Champion",
  technical_buyer: "Technical buyer",
};

const QUALIFICATION_ACTION: Record<string, string> = {
  decision_process: "Map the decision process and who owns each step",
  paper_process: "Map the paper process to signature",
  economic_buyer: "Confirm who holds budget authority",
  champion: "Confirm an internal champion",
  metrics: "Agree the metrics the buyer will measure",
  decision_criteria: "Confirm the decision criteria",
  identified_pain: "Confirm the pain driving urgency",
  competition: "Establish the competitive alternatives",
};

/** Gap → a concrete action, in product language. Degrades to the gap's own words. */
function actionFor(g: ContextGap, account: string): { key: string; text: string } {
  if (g.source === "STAKEHOLDER_COVERAGE" && g.refType === "stakeholder_role" && g.refId) {
    const text = g.refId === "economic_buyer" ? `Identify and verify the economic buyer at ${account}`
      : g.refId === "champion" ? `Confirm a champion at ${account}`
        : g.refId === "technical_buyer" ? `Confirm the technical buyer at ${account}`
          : `Confirm the ${g.refId.replace(/_/g, " ")} at ${account}`;
    return { key: `verify_role:${g.refId}`, text };
  }
  if (g.source === "MEDDPICC" && g.refId) {
    return { key: `qualify:${g.refId}`, text: QUALIFICATION_ACTION[g.refId] ?? `Qualify ${g.refId.replace(/_/g, " ")}` };
  }
  if (g.source === "WHY_NOW" && milestoneForGap(g) === "timing_confirmed") {
    return { key: "confirm_timing", text: "Confirm the timing for this pursuit" };
  }
  if (g.source === "VALUE_CASE" && g.refType === "value_driver" && g.refId) {
    return { key: `quantify:${g.refId}`, text: `Quantify ${g.refId.replace(/_/g, " ")}` };
  }
  return { key: `resolve:${g.key}`, text: `Resolve: ${g.text.trim().replace(/\.$/, "")}` };
}

const GAP_CONTEXT_STATE: Record<GapKind, ContextState> = {
  MISSING: "NOT_IDENTIFIED",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
  UNVERIFIED: "NEEDS_VALIDATION",
  STALE: "OUT_OF_DATE",
  CONFLICTING: "CONFLICTING",
};

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  DONE: "Done",
  OPEN: "Open",
  BLOCKED: "Waiting on an earlier step",
  NOT_ESTABLISHED: "Not yet established",
};

export type PlanDisplayState = "NONE" | "AWAITING_DECISION" | "APPROVED" | "ADJUSTED" | "DECLINED" | "REVIEW_NEEDED";

export const PLAN_STATE_LABEL: Record<PlanDisplayState, string> = {
  NONE: "No plan yet",
  AWAITING_DECISION: "Awaiting approval",
  APPROVED: "Approved",
  ADJUSTED: "Approved with changes",
  DECLINED: "Recommendation declined",
  REVIEW_NEEDED: "Needs review",
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 24", or "Oct 24, 2027" once the year stops being obvious. Fixed en-US, UTC. */
export function dayLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  const stamp = `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? stamp : `${stamp}, ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * The goal: the durable COMMERCIAL OUTCOME, composed from the pursuit's thesis and its
 * open opportunity — and from nothing else. It reads no route, partner, motion, action
 * or owner, so choosing WWT over CDW (or back), changing the motion, or adjusting the
 * next action cannot change what the pursuit is trying to achieve (D-033). Those are
 * plan state and live in plan revisions.
 */
export function draftGoal(s: PlanState): GoalDraft {
  const thesis = (s.businessProblem ?? "").trim().replace(/\.$/, "");
  const basis: GoalDraft["basis"] = [{ refType: "pursuit", refId: s.pursuitId }];
  if (s.opportunity) {
    basis.push({ refType: "opportunity", refId: s.opportunity.id });
    const amount = s.opportunity.amountUsd != null ? ` ${formatMoney(s.opportunity.amountUsd)}` : "";
    const close = `close the${amount} opportunity`;
    return {
      objective: thesis ? `${thesis} and ${close}` : `${close.charAt(0).toUpperCase()}${close.slice(1)}`,
      targetDate: s.opportunity.expectedClose,
      basis,
    };
  }
  return {
    objective: thesis || `Establish a qualified opportunity at ${s.accountLabel}`,
    targetDate: null,
    basis,
  };
}

/** The milestones that apply to this pursuit, in plan order. */
export function planMilestones(s: PlanState): PlanMilestone[] {
  const applicable = CATALOG.filter((c) => c.applies(s));
  const keys = new Set(applicable.map((c) => c.key));
  return applicable.map(({ key, label, rule, dependsOn }) => ({
    key, label, rule,
    // A dependency on a milestone that does not apply here is dropped, not left dangling.
    dependsOn: dependsOn.filter((d) => keys.has(d)),
  }));
}

function ruleStatus(rule: MilestoneRule, s: PlanState): Exclude<MilestoneStatus, "BLOCKED"> {
  switch (rule.kind) {
    case "ROUTE_DECIDED":
      return s.route == null ? "NOT_ESTABLISHED" : s.route.decided ? "DONE" : "OPEN";
    case "ROLE_VERIFIED": {
      if (!s.stakeholders || !s.stakeholders.established || s.stakeholders.withheld) return "NOT_ESTABLISHED";
      const r = s.stakeholders.roles.find((x) => x.role === rule.role);
      return r?.state === "VERIFIED" ? "DONE" : "OPEN";
    }
    case "TIMING_CONFIRMED":
      return s.timing.anchored ? "DONE" : "OPEN";
    case "QUALIFICATION_KNOWN": {
      if (!s.qualification) return "NOT_ESTABLISHED";
      return rule.elements.every((e) => {
        const st = s.qualification?.[e];
        return st != null && st !== "unknown" && st !== "gap";
      }) ? "DONE" : "OPEN";
    }
    case "VALUE_DEFENSIBLE":
      return s.valueState === "STRONG" ? "DONE" : "OPEN";
    case "OPPORTUNITY_OPEN":
      return s.opportunity ? "DONE" : "OPEN";
    case "CLOSED_WON":
      return s.opportunity?.stage === "closed_won" || s.pursuitStatus === "WON" ? "DONE" : "OPEN";
  }
}

/**
 * Resolve each milestone's status against the CURRENT canonical state. An open
 * milestone whose dependency has not held is BLOCKED — so the reader sees the order
 * of work, not just a checklist.
 */
export function evaluateMilestones(milestones: PlanMilestone[], s: PlanState): Record<string, MilestoneStatus> {
  const base: Record<string, MilestoneStatus> = {};
  for (const m of milestones) base[m.key] = ruleStatus(m.rule, s);
  const out: Record<string, MilestoneStatus> = {};
  for (const m of milestones) {
    const st = base[m.key];
    out[m.key] = st === "OPEN" && m.dependsOn.some((d) => base[d] !== undefined && base[d] !== "DONE") ? "BLOCKED" : st;
  }
  return out;
}

/** The pursuit-team member holding a role, stated exactly as the team says it. */
export function resolveOwner(role: string, team: PlanTeamMember[]): PlanOwner {
  const roleLabel = TEAM_ROLE_LABEL[role] ?? role.replace(/_/g, " ").toLowerCase();
  const live = team.filter((m) => m.role === role && m.status !== "SUPERSEDED" && m.status !== "DECLINED" && m.status !== "INACTIVE");
  const confirmed = live.find((m) => m.personLabel && ["ACCEPTED", "ACTIVE", "ACTION_REQUIRED", "INVITED"].includes(m.status));
  if (confirmed) {
    return {
      kind: "PERSON", teamMemberId: confirmed.id, role, roleLabel, personLabel: confirmed.personLabel,
      confirmed: confirmed.status === "ACCEPTED" || confirmed.status === "ACTIVE",
    };
  }
  const proposed = live[0];
  if (proposed) {
    return { kind: "ROLE_UNFILLED", teamMemberId: proposed.id, role, roleLabel, personLabel: proposed.personLabel, confirmed: false };
  }
  return { kind: "UNASSIGNED", teamMemberId: null, role, roleLabel, personLabel: null, confirmed: false };
}

function motionRef(s: PlanState): PlanMotionRef {
  if (!s.motion) return { motionId: null, linkage: "NONE", label: null, status: null, partnerLabel: null, openActions: 0 };
  return {
    motionId: s.motion.id, linkage: s.motion.linkage, label: s.motion.label, status: s.motion.status,
    partnerLabel: s.motion.partnerLabel, openActions: s.motion.openActions,
  };
}

/**
 * The warm path for a stakeholder action. The route a PERSON selected is preferred
 * over whichever path happens to rank first — the plan follows the decision, not the
 * recommendation. Overlap-only statements are not paths and are never offered.
 */
function viaFor(s: PlanState): PlanEvidenceRef | null {
  const usable = s.warmPaths.filter((p) => p.tier === "PERSON_VERIFIED" || p.tier === "SELLER_ACCOUNT");
  const selected = s.route?.decided ? s.route.selectedLabel : null;
  const pick = usable.find((p) => selected && p.via === selected) ?? usable[0];
  if (!pick) return null;
  return { text: pick.text, refType: pick.refType, refId: pick.refId, origin: "ACCOUNT", disclosure: "INTERNAL" };
}

function whyFor(s: PlanState, focus: ContextGap | null): PlanEvidenceRef[] {
  const why: PlanEvidenceRef[] = [];
  if (focus?.whyItMatters) {
    why.push({ text: focus.whyItMatters, refType: focus.refType, refId: focus.refId, origin: "PURSUIT", disclosure: "INTERNAL" });
  }
  if (s.route?.decided && s.route.selectedLabel) {
    why.push({
      text: s.route.overridden && s.route.recommendedLabel
        ? `Runs through ${s.route.selectedLabel} — the route a person chose over the ${s.route.recommendedLabel} recommendation.`
        : `Runs through ${s.route.selectedLabel}, the recommended route, approved by a person.`,
      refType: "route", refId: s.pursuitId, origin: "PURSUIT", disclosure: "INTERNAL",
    });
  }
  if (s.stakeholders?.established && !s.stakeholders.withheld) {
    const verified = s.stakeholders.roles.filter((r) => r.state === "VERIFIED");
    if (verified.length) {
      const parts = verified.map((r) => `${(ROLE_WORD[r.role] ?? r.role).toLowerCase()}${r.personName ? ` (${r.personName})` : ""}`);
      const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
      why.push({
        text: `${joined.charAt(0).toUpperCase()}${joined.slice(1)} ${verified.length === 1 ? "is" : "are"} confirmed for this pursuit.`,
        refType: "stakeholder_coverage", refId: s.pursuitId, origin: "PURSUIT", disclosure: "INTERNAL",
      });
    }
  }
  const ev = s.timing.accountEvent;
  if (!s.timing.anchored && ev && ev.date) {
    // Stated with its date, not "in N days": a persisted revision is read later, and a
    // relative count frozen at recommendation time would quietly go wrong. The year is
    // always shown, for the same reason — "Nov 29" means a different day next year.
    const d = new Date(`${ev.date.slice(0, 10)}T00:00:00Z`);
    const when = Number.isNaN(d.getTime()) ? ev.date : `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    why.push({
      text: `${ev.label} is held on the account for ${when} — not yet confirmed for this pursuit.`,
      refType: "fact", refId: ev.factId, origin: "ACCOUNT", disclosure: "INTERNAL",
    });
  }
  return why.slice(0, 4);
}

/** The normalized inputs a recommendation depends on. Time-varying values are excluded. */
export function fingerprintInputs(s: PlanState, milestones: Record<string, MilestoneStatus>, focus: ContextGap | null, owner: PlanOwner | null): PlanFingerprintInputsV1 {
  const ownerMember = owner?.teamMemberId ? s.team.find((m) => m.id === owner.teamMemberId) : null;
  return {
    v: 1,
    pursuitStatus: s.pursuitStatus,
    opportunity: s.opportunity ? { id: s.opportunity.id, stage: s.opportunity.stage } : null,
    route: s.route ? { decided: s.route.decided, selected: s.route.selectedLabel } : null,
    motion: s.motion ? { id: s.motion.id, status: s.motion.status, linkage: s.motion.linkage } : null,
    focus: focus ? { gapKey: focus.key, kind: focus.kind } : null,
    // Key order is fixed by the catalog, so the serialization is stable.
    milestones,
    owner: owner ? { role: owner.role, memberId: owner.teamMemberId, status: ownerMember?.status ?? null } : null,
  };
}

export function fingerprintOf(inputs: PlanFingerprintInputs): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
}

/** The owner triple, in the exact shape v1 hashes — reused per action so v2 stays comparable. */
function ownerInputs(s: PlanState, owner: PlanOwner | null): { role: string | null; memberId: string | null; status: string | null } | null {
  if (!owner) return null;
  const member = owner.teamMemberId ? s.team.find((m) => m.id === owner.teamMemberId) : null;
  return { role: owner.role, memberId: owner.teamMemberId, status: member?.status ?? null };
}

/** V2 inputs. Same canonical state as v1, plus the ordered action set v1 could not describe. */
export function fingerprintInputsV2(
  s: PlanState,
  milestones: Record<string, MilestoneStatus>,
  focus: ContextGap | null,
  actions: { action: PlanActionV2; gap: ContextGap }[],
): PlanFingerprintInputsV2 {
  return {
    v: 2,
    pursuitStatus: s.pursuitStatus,
    opportunity: s.opportunity ? { id: s.opportunity.id, stage: s.opportunity.stage } : null,
    route: s.route ? { decided: s.route.decided, selected: s.route.selectedLabel } : null,
    motion: s.motion ? { id: s.motion.id, status: s.motion.status, linkage: s.motion.linkage } : null,
    focus: focus ? { gapKey: focus.key, kind: focus.kind } : null,
    // Key order is fixed by the catalog, so the serialization is stable.
    milestones,
    actions: actions.map(({ action, gap }) => ({
      key: action.key,
      gapKey: gap.key,
      source: gap.source,
      kind: gap.kind,
      milestoneKey: action.milestoneKey,
      owner: ownerInputs(s, action.owner),
    })),
  };
}

/** A stored row carried a `schema` this build does not know. Fail closed — never guess a shape. */
export class UnknownPlanContentSchema extends Error {
  constructor(readonly schema: unknown) {
    super(`unknown plan content schema ${JSON.stringify(schema)}`);
    this.name = "UnknownPlanContentSchema";
  }
}

/**
 * THE ONE PLACE STORED PLAN CONTENT BECOMES A USABLE OBJECT.
 *
 * It dispatches on the stored `schema` and nothing else. Shape inference — "it has an `actions`
 * field, so it must be v2" — is exactly the failure this boundary exists to prevent: a future
 * version carrying an `actions` field would be silently read as v2 and misinterpreted. `schema`
 * was written from the first revision and never read until now; it starts being load-bearing here.
 *
 * A v1 row is lifted into the v2 view in memory. **The stored row is never rewritten**, and no
 * backfill exists: `pursuit_plan_revisions` is append-only by grant, and its history is evidence.
 */
export function normalizePlanContent(stored: unknown): PlanContentV2 {
  const raw = stored as { schema?: unknown };
  if (!raw || typeof raw !== "object") throw new UnknownPlanContentSchema(raw);
  if (raw.schema === PLAN_CONTENT_SCHEMA_V2) return stored as PlanContentV2;
  if (raw.schema === PLAN_CONTENT_SCHEMA_V1) {
    const v1 = stored as PlanContentV1;
    return {
      schema: PLAN_CONTENT_SCHEMA_V2,
      focus: v1.focus,
      motion: v1.motion,
      // The single action becomes a one-element ordered set. `milestoneKey` is absent from v1 and
      // stays absent: inventing one from the focus would assert a link the revision never made.
      actions: v1.nextAction
        ? [{
          key: v1.nextAction.key, text: v1.nextAction.text, doneWhen: v1.nextAction.doneWhen,
          via: v1.nextAction.via, owner: v1.nextAction.owner, dueInDays: v1.nextAction.dueInDays,
          milestoneKey: null,
        }]
        : [],
      milestones: v1.milestones,
      why: v1.why,
    };
  }
  throw new UnknownPlanContentSchema(raw.schema);
}

/** The historical staging pointer, readable only on a v1 row. v2 lineage lives on `motion_actions`. */
export function legacyStagedActionId(stored: unknown): string | null {
  const raw = stored as { schema?: unknown; nextAction?: { stagedMotionActionId?: string | null } };
  if (!raw || typeof raw !== "object" || raw.schema !== PLAN_CONTENT_SCHEMA_V1) return null;
  return raw.nextAction?.stagedMotionActionId ?? null;
}

/**
 * Compose the recommendation. Deterministic: the same canonical state always
 * produces the same content and the same fingerprint.
 */
/**
 * THE ORDERED ACTION SET — derived, never invented.
 *
 * Scans the ranked gaps in their existing order (D-019: ranking belongs to Missing Context and is
 * never redone here) and keeps the first `MAX_PLAN_ACTIONS_V2` DISTINCT action keys.
 *
 * DEDUP IS BY STABLE COMMERCIAL INTENT, HIGHEST-RANKED FIRST. Several gaps legitimately collapse
 * to one action: `whynow:not_established`, `whynow:unknown:{i}` and `whynow:contradiction:{i}` all
 * produce `confirm_timing`, because they are three REASONS the same act is needed, not three acts.
 * A seller confirms timing once. The losing siblings are dropped, and the winner's identity is what
 * the basis records — so a sibling appearing or disappearing does not move the plan.
 *
 * An array index is NEVER appended to force uniqueness: a key must represent a stable intent, and
 * `verify_role:champion#2` would represent nothing.
 */
export function deriveOrderedActions(s: PlanState): { action: PlanActionV2; gap: ContextGap }[] {
  const out: { action: PlanActionV2; gap: ContextGap }[] = [];
  const seen = new Set<string>();
  for (const gap of s.gaps) {
    if (out.length >= MAX_PLAN_ACTIONS_V2) break;
    const a = actionFor(gap, s.accountLabel);
    if (seen.has(a.key)) continue;         // a lower-ranked sibling of an intent already taken
    seen.add(a.key);
    const owner = resolveOwner(OWNER_ROLE_FOR_SOURCE[gap.source], s.team);
    out.push({
      gap,
      action: {
        key: a.key, text: a.text, doneWhen: gap.howToResolve,
        via: gap.source === "STAKEHOLDER_COVERAGE" ? viaFor(s) : null,
        owner, dueInDays: DEFAULT_ACTION_DUE_DAYS,
        milestoneKey: milestoneForGap(gap),
      },
    });
  }
  return out;
}

/**
 * Compose the recommendation. Deterministic: the same canonical state always
 * produces the same content and the same fingerprint.
 */
export function recommendPursuitPlan(s: PlanState, now: Date = new Date()): PlanRecommendation {
  const goal = draftGoal(s);
  const milestones = planMilestones(s);
  const status = evaluateMilestones(milestones, s);
  const top = s.gaps[0] ?? null;

  const focus: PlanFocus | null = top
    ? { gapKey: top.key, source: top.source, kind: top.kind, headline: top.text, rank: top.rank, refType: top.refType, refId: top.refId, milestoneKey: milestoneForGap(top) }
    : null;

  const derived = deriveOrderedActions(s);
  const actions = derived.map((d) => d.action);

  const why = whyFor(s, top);
  const inputs = fingerprintInputsV2(s, status, top, derived);
  const evidence = [
    ...goal.basis,
    ...(focus ? [{ refType: focus.refType, refId: focus.refId }] : []),
    ...(s.motion ? [{ refType: "motion", refId: s.motion.id }] : []),
    ...why.map((w) => ({ refType: w.refType, refId: w.refId })),
    ...actions.filter((a) => a.via).map((a) => ({ refType: a.via!.refType, refId: a.via!.refId })),
  ];

  // ── THE V1 REPRESENTATION OF THE SAME STATE ─────────────────────────────────────────────────
  // The v1 algorithm run verbatim: one action from the top-ranked gap, one owner, and the v1
  // fingerprint inputs. Used to review a stored v1 plan with the algorithm it was written with, and
  // to PERSIST a v1 recommendation while v2 writes are disabled.
  const legacyOwner = top ? resolveOwner(OWNER_ROLE_FOR_SOURCE[top.source], s.team) : null;
  const legacyInputs = fingerprintInputs(s, status, top, legacyOwner);
  const legacyNextAction: PlanNextAction | null = top && legacyOwner
    ? (() => {
      const a = actionFor(top, s.accountLabel);
      return {
        key: a.key, text: a.text, doneWhen: top.howToResolve,
        via: top.source === "STAKEHOLDER_COVERAGE" ? viaFor(s) : null,
        owner: legacyOwner, dueInDays: DEFAULT_ACTION_DUE_DAYS, stagedMotionActionId: null,
      };
    })()
    : null;

  return {
    goal,
    content: {
      schema: PLAN_CONTENT_SCHEMA_V2,
      focus, motion: motionRef(s), actions, milestones, why,
    },
    basis: {
      recommenderVersion: RECOMMENDER_VERSION,
      computedAt: now.toISOString(),
      fingerprint: fingerprintOf(inputs),
      inputs,
      evidence,
    },
    legacyContent: {
      schema: PLAN_CONTENT_SCHEMA_V1,
      focus, motion: motionRef(s), nextAction: legacyNextAction, milestones, why,
    },
    legacyBasis: {
      recommenderVersion: RECOMMENDER_VERSION,
      computedAt: now.toISOString(),
      fingerprint: fingerprintOf(legacyInputs),
      inputs: legacyInputs,
      evidence,
    },
  };
}

// ---------------------------------------------------------------------------
// The canonical current action
// ---------------------------------------------------------------------------

export type ActionResolvedReason = "MILESTONE_DONE" | "MOTION_ACTION_DONE" | "MOTION_ACTION_SKIPPED";

export type ActionStanding =
  | { standing: "ACTIONABLE" }
  | { standing: "BLOCKED"; milestoneKey: string }
  | { standing: "RESOLVED"; reason: ActionResolvedReason };

/** The staged queue row for one action, as the Queue holds it. Keyed by action key. */
export type StagedByActionKey = Record<string, { status: string } | undefined>;

/**
 * ONE ACTION'S STANDING.
 *
 * Milestone state is canonical business truth and is consulted first. The motion-action fallback
 * exists only for an action with NO milestone, where the domain has no completion signal at all —
 * and it is named honestly: **`MOTION_ACTION_SKIPPED` means this recommended action is no longer
 * pending, never that the underlying commercial condition was satisfied.** The runtime and the
 * Queue never write a milestone; milestone completion stays computed from canonical state.
 */
export function actionStanding(
  action: PlanActionV2,
  milestones: Record<string, MilestoneStatus>,
  staged: StagedByActionKey = {},
): ActionStanding {
  if (action.milestoneKey) {
    const st = milestones[action.milestoneKey];
    if (st === "DONE") return { standing: "RESOLVED", reason: "MILESTONE_DONE" };
    if (st === "BLOCKED") return { standing: "BLOCKED", milestoneKey: action.milestoneKey };
    return { standing: "ACTIONABLE" };
  }
  const row = staged[action.key];
  if (row?.status === "done") return { standing: "RESOLVED", reason: "MOTION_ACTION_DONE" };
  if (row?.status === "skipped") return { standing: "RESOLVED", reason: "MOTION_ACTION_SKIPPED" };
  return { standing: "ACTIONABLE" };
}

/**
 * THE CANONICAL CURRENT ACTION. One implementation; surfaces consume it and never reproduce it.
 *
 * Scans in RECOMMENDATION ORDER and returns the first ACTIONABLE action, skipping resolved ones and
 * ones blocked by a milestone dependency. **Skip-blocked is deliberate**: `actions[]` is ordered
 * priority, not a dependency chain, and a later action is frequently the very work that unblocks an
 * earlier one (mapping the paper process is blocked until the economic buyer is confirmed, and
 * confirming the economic buyer is itself a recommended action). Freezing on unworkable work would
 * hide the thing that clears it.
 *
 * `null` means no remaining recommended actions — never that every business objective succeeded.
 */
export function selectCurrentPlanAction(
  actions: readonly PlanActionV2[],
  milestones: Record<string, MilestoneStatus>,
  staged: StagedByActionKey = {},
): { action: PlanActionV2; index: number; standing: ActionStanding } | null {
  for (let i = 0; i < actions.length; i++) {
    const standing = actionStanding(actions[i], milestones, staged);
    if (standing.standing === "ACTIONABLE") return { action: actions[i], index: i, standing };
  }
  return null;
}

/**
 * What a surface SHOWS when it has room for exactly one action.
 *
 * The current actionable one, or — when everything is resolved or blocked — the top-ranked action,
 * so a plan never renders as though it had no content. Defined once, beside the selector, so Today,
 * Pursuit Detail and the approval label agree without any of them re-deriving standing.
 */
export function selectDisplayPlanAction(
  actions: readonly PlanActionV2[],
  milestones: Record<string, MilestoneStatus>,
  staged: StagedByActionKey = {},
): { action: PlanActionV2; index: number; standing: ActionStanding; isCurrent: boolean } | null {
  const current = selectCurrentPlanAction(actions, milestones, staged);
  if (current) return { ...current, isCurrent: true };
  const first = actions[0];
  if (!first) return null;
  return { action: first, index: 0, standing: actionStanding(first, milestones, staged), isCurrent: false };
}

// ---------------------------------------------------------------------------
// Course correction
// ---------------------------------------------------------------------------

export interface PlanReviewAssessment {
  state: "NOT_DECIDED" | "CURRENT" | "REVIEW_NEEDED";
  /** Why, in product language. Deterministic, from a structural diff of the inputs. */
  reasons: string[];
}

/**
 * Is the plan in force still current? A comparison, not a judgement: the approved
 * revision's inputs against the inputs as they stand now. Nothing here rewrites the
 * approved plan — it becomes REVIEWABLE, and says why.
 */
export function assessPlanReview(
  inForce: { content: PlanContent; basis: PlanBasis } | null,
  current: PlanRecommendation | null,
): PlanReviewAssessment {
  if (!inForce || !current) return { state: "NOT_DECIDED", reasons: [] };
  // THE ALGORITHM COMES FROM THE STORED PLAN, NEVER FROM THE NEWEST BUILD. Comparing a stored v1
  // fingerprint against a v2 computation never matches, so it would declare every legacy plan
  // REVIEWABLE the moment this code deployed — a mass product event dressed as a refactor.
  const currentBasis = freshBasisFor(inForce.basis, current);
  if (inForce.basis.fingerprint === currentBasis.fingerprint) return { state: "CURRENT", reasons: [] };

  const a = inForce.basis.inputs;
  const b = currentBasis.inputs;
  const reasons: string[] = [];
  const labelOf = (key: string) =>
    current.content.milestones.find((m) => m.key === key)?.label ?? inForce.content.milestones.find((m) => m.key === key)?.label ?? key;

  for (const [key, now] of Object.entries(b.milestones)) {
    const was = a.milestones[key];
    if (was !== undefined && was !== "DONE" && now === "DONE") reasons.push(`${labelOf(key)} — reached since the plan was approved.`);
    if (was === "DONE" && now !== "DONE") reasons.push(`${labelOf(key)} — no longer holds.`);
  }
  const addedOrRemoved = Object.keys(a.milestones).length !== Object.keys(b.milestones).length
    || Object.keys(b.milestones).some((k) => a.milestones[k] === undefined);
  if (addedOrRemoved) reasons.push("The plan's milestones changed with the pursuit's context.");
  if ((a.focus?.gapKey ?? null) !== (b.focus?.gapKey ?? null)) {
    reasons.push(current.content.focus ? `The most important gap is now: ${current.content.focus.headline.trim().replace(/\.$/, "")}.` : "No unresolved gaps remain.");
  } else if (a.focus && b.focus && a.focus.kind !== b.focus.kind) {
    reasons.push("The current focus changed state.");
  }
  if ((a.route?.selected ?? null) !== (b.route?.selected ?? null) || (a.route?.decided ?? false) !== (b.route?.decided ?? false)) {
    reasons.push(b.route?.decided && b.route.selected ? `Route is now ${b.route.selected}.` : "The route decision changed.");
  }
  if ((a.motion?.id ?? null) !== (b.motion?.id ?? null)) reasons.push(b.motion ? "A different motion now carries this pursuit." : "No motion carries this pursuit any more.");
  else if (a.motion && b.motion && a.motion.status !== b.motion.status) reasons.push(`The motion is now ${b.motion.status}.`);
  if ((a.opportunity?.stage ?? null) !== (b.opportunity?.stage ?? null)) {
    reasons.push(b.opportunity ? `Opportunity moved to ${b.opportunity.stage.replace(/_/g, " ")}.` : "The opportunity is no longer open.");
  }
  if (a.pursuitStatus !== b.pursuitStatus) reasons.push(`Pursuit is now ${b.pursuitStatus.toLowerCase().replace(/_/g, " ")}.`);
  const ownerA = basisOwner(a);
  const ownerB = basisOwner(b);
  if ((ownerA?.memberId ?? null) !== (ownerB?.memberId ?? null) || (ownerA?.status ?? null) !== (ownerB?.status ?? null)) {
    reasons.push("The owner's team assignment changed.");
  }
  // V2 ONLY: actions 2 and 3 descend from gaps the v1 basis never mentioned, so their movement is
  // invisible to every reason above. Membership and order are stated in the plan's own words.
  if (a.v === 2 && b.v === 2) {
    const keysA = a.actions.map((x) => x.key);
    const keysB = b.actions.map((x) => x.key);
    const added = keysB.filter((k) => !keysA.includes(k));
    const removed = keysA.filter((k) => !keysB.includes(k));
    const textFor = (key: string) => current.content.actions.find((x) => x.key === key)?.text
      ?? inForce.content.actions.find((x) => x.key === key)?.text ?? key;
    for (const k of removed) reasons.push(`No longer recommended: ${sentenceish(textFor(k))}.`);
    for (const k of added) reasons.push(`Now recommended: ${sentenceish(textFor(k))}.`);
    if (!added.length && !removed.length && keysA.join("\u0000") !== keysB.join("\u0000")) {
      reasons.push("The recommended actions are in a different order.");
    }
    for (const now of b.actions) {
      const was = a.actions.find((x) => x.key === now.key);
      if (was && (was.owner?.memberId ?? null) !== (now.owner?.memberId ?? null)) {
        reasons.push(`The owner changed for: ${sentenceish(textFor(now.key))}.`);
      }
    }
  }
  return { state: "REVIEW_NEEDED", reasons: reasons.length ? reasons : ["The pursuit's context changed since the plan was approved."] };
}

const sentenceish = (t: string) => t.trim().replace(/\.$/, "");

/** The recommended owner a basis describes: v1 states it directly, v2 carries it per action. */
function basisOwner(inputs: PlanFingerprintInputs): { memberId: string | null; status: string | null } | null {
  return inputs.v === 1 ? inputs.owner : inputs.actions[0]?.owner ?? null;
}

/**
 * Which freshly-computed basis a stored plan must be compared against.
 *
 * Dispatch is on the STORED basis version, which tracks the stored content version. An unrecognised
 * version fails closed rather than falling back to the newest algorithm — a wrong comparison is
 * worse than no comparison, because it renders as a confident "this plan needs review".
 */
export function freshBasisFor(stored: PlanBasis, live: PlanRecommendation): PlanBasis {
  const v: unknown = stored.inputs?.v;
  if (v === 1) return live.legacyBasis;
  if (v === 2) return live.basis;
  throw new UnknownPlanContentSchema(v);
}

// ---------------------------------------------------------------------------
// Human adjustment
// ---------------------------------------------------------------------------

export interface PlanAdjustments {
  /** Per-action edits, addressed by STABLE ACTION KEY — never by array index. */
  actions?: Record<string, { text?: string; ownerTeamMemberId?: string | null; dueInDays?: number }>;
  /** The approved order, as action keys. A subset removes the omitted actions. */
  order?: string[];
  /** v1 compatibility: the single action's fields, when a v1 recommendation is being decided. */
  nextActionText?: string;
  ownerTeamMemberId?: string | null;
  dueInDays?: number;
}

export interface PlanAdjustmentChange {
  field: "action.text" | "action.owner" | "action.dueInDays" | "action.removed" | "actions.order";
  /** Which action this change is about. Null for a whole-plan change such as reordering. */
  actionKey: string | null;
  from: unknown;
  to: unknown;
}

/**
 * Apply a person's adjustments to a recommendation.
 *
 * A WHITELIST, and deliberately a narrow one: the words of an action, its owner, its due window,
 * the approved order, and removal. The focus, the milestones and the evidence stay as recommended,
 * and **no new action can be added** — an adjustment may modify or reduce a deterministic
 * recommendation, never invent an ungrounded commercial action that nothing in the world proposed.
 *
 * Actions KEEP their keys, so the recommended set, the human's changes and the approved order can
 * all be reconstructed from the immutable revision and its change list (the P8 learning signal).
 */
export function applyAdjustments(content: PlanContent, adj: PlanAdjustments, team: PlanTeamMember[]): { content: PlanContent; changes: PlanAdjustmentChange[] } {
  if (!content.actions.length) throw new Error("This plan has no actions to adjust.");
  const changes: PlanAdjustmentChange[] = [];
  const byKey = new Map(content.actions.map((a) => [a.key, { ...a, owner: { ...a.owner } }]));

  // v1 compatibility: a legacy recommendation carries exactly one action, so the flat fields
  // address it unambiguously. They are not extended to multi-action plans.
  const flat = adj.nextActionText !== undefined || adj.ownerTeamMemberId !== undefined || adj.dueInDays !== undefined;
  const perAction: Record<string, { text?: string; ownerTeamMemberId?: string | null; dueInDays?: number }> = { ...(adj.actions ?? {}) };
  if (flat) {
    if (content.actions.length !== 1) throw new Error("This plan has several actions — address each one by its key.");
    const only = content.actions[0].key;
    perAction[only] = {
      ...(adj.nextActionText !== undefined ? { text: adj.nextActionText } : {}),
      ...(adj.ownerTeamMemberId !== undefined ? { ownerTeamMemberId: adj.ownerTeamMemberId } : {}),
      ...(adj.dueInDays !== undefined ? { dueInDays: adj.dueInDays } : {}),
      ...(perAction[only] ?? {}),
    };
  }

  for (const [key, edit] of Object.entries(perAction)) {
    const action = byKey.get(key);
    if (!action) throw new Error(`This plan has no action ${key}.`);
    if (edit.text !== undefined) {
      const t = edit.text.trim();
      if (!t) throw new Error("An action needs words.");
      if (t !== action.text) { changes.push({ field: "action.text", actionKey: key, from: action.text, to: t }); action.text = t; }
    }
    if (edit.ownerTeamMemberId !== undefined) {
      const before = action.owner.teamMemberId;
      if (edit.ownerTeamMemberId === null) {
        if (before !== null) {
          changes.push({ field: "action.owner", actionKey: key, from: before, to: null });
          action.owner = { kind: "UNASSIGNED", teamMemberId: null, role: action.owner.role, roleLabel: action.owner.roleLabel, personLabel: null, confirmed: false };
        }
      } else {
        const m = team.find((x) => x.id === edit.ownerTeamMemberId);
        if (!m) throw new Error("That person is not on this pursuit's team.");
        if (before !== m.id) {
          changes.push({ field: "action.owner", actionKey: key, from: before, to: m.id });
          action.owner = {
            kind: m.personLabel ? "PERSON" : "ROLE_UNFILLED", teamMemberId: m.id, role: m.role,
            roleLabel: TEAM_ROLE_LABEL[m.role] ?? m.role.replace(/_/g, " ").toLowerCase(),
            personLabel: m.personLabel, confirmed: m.status === "ACCEPTED" || m.status === "ACTIVE",
          };
        }
      }
    }
    if (edit.dueInDays !== undefined) {
      if (!Number.isInteger(edit.dueInDays) || edit.dueInDays < 1 || edit.dueInDays > 90) throw new Error("A due window is between 1 and 90 days.");
      if (edit.dueInDays !== action.dueInDays) {
        changes.push({ field: "action.dueInDays", actionKey: key, from: action.dueInDays, to: edit.dueInDays });
        action.dueInDays = edit.dueInDays;
      }
    }
  }

  let ordered = content.actions.map((a) => byKey.get(a.key)!);
  if (adj.order !== undefined) {
    const wanted = adj.order;
    if (new Set(wanted).size !== wanted.length) throw new Error("An action can appear once in the approved order.");
    for (const k of wanted) if (!byKey.has(k)) throw new Error(`This plan has no action ${k}.`);
    const removed = content.actions.filter((a) => !wanted.includes(a.key));
    for (const r of removed) changes.push({ field: "action.removed", actionKey: r.key, from: r.text, to: null });
    const before = content.actions.map((a) => a.key);
    ordered = wanted.map((k) => byKey.get(k)!);
    if (before.filter((k) => wanted.includes(k)).join("\u0000") !== wanted.join("\u0000")) {
      changes.push({ field: "actions.order", actionKey: null, from: before, to: wanted });
    }
  }

  // An ADJUSTED decision that changed nothing is an approval wearing the wrong word, and it would
  // record a human override that never happened. Preserved from v1.
  if (!changes.length) throw new Error("Nothing was changed — approve the plan as recommended instead.");
  return { content: { ...content, actions: ordered }, changes };
}

// ---------------------------------------------------------------------------
// Records (DB projections) and the view-model
// ---------------------------------------------------------------------------

export interface GoalRecord {
  id: string;
  objective: string;
  targetDate: string | null;
  status: "PROPOSED" | "ACTIVE" | "ACHIEVED" | "ABANDONED" | "SUPERSEDED";
  origin: "SYSTEM_RECOMMENDED" | "HUMAN_AUTHORED";
  decidedAt: string | null;
  /** The goal this one replaced, when a person replaced the commercial objective (D-033). */
  supersedesGoalId: string | null;
  createdAt: string;
}

export interface PlanRecord {
  id: string;
  goalId: string;
  status: "PROPOSED" | "ACTIVE" | "CLOSED" | "SUPERSEDED";
  createdAt: string;
}

export interface ReviewTrigger {
  fromRevisionId: string;
  reasons: string[];
  ledgerEventIds: string[];
}

export interface RevisionRecord {
  id: string;
  revisionNo: number;
  kind: "RECOMMENDATION" | "DECISION";
  decision: "APPROVED" | "ADJUSTED" | "REJECTED" | null;
  respondsToRevisionId: string | null;
  /** NORMALIZED. The stored row is never rewritten; `contentSchema` says what it actually holds. */
  content: PlanContent;
  /**
   * The stored JSON exactly as the row holds it.
   *
   * Needed because a decision on a v1 recommendation must persist the V1 SHAPE — the decision
   * inherits its generation from the recommendation it responds to, and normalizing on the way in
   * then serializing the normalized form on the way out would silently upgrade it.
   */
  rawContent: StoredPlanContent;
  contentSchema: typeof PLAN_CONTENT_SCHEMA_V1 | typeof PLAN_CONTENT_SCHEMA_V2;
  /** The staging pointer a v1 row carries inside its content. Always null for v2. */
  legacyStagedActionId: string | null;
  basis: PlanBasis;
  fingerprint: string;
  adjustments: PlanAdjustmentChange[] | null;
  reviewTrigger: ReviewTrigger | null;
  reason: string | null;
  actorType: "USER" | "AGENT" | "WORKER" | "SYSTEM";
  createdAt: string;
}

export interface PlanRecords {
  goal: GoalRecord | null;
  plan: PlanRecord | null;
  /** Oldest first. */
  revisions: RevisionRecord[];
  /** Motion actions staged by decisions: id → due date and status, as the queue holds them. */
  stagedActions: Record<string, { dueAt: string; status: string }>;
  /**
   * The staged queue row for each action of the plan IN FORCE, by action key.
   *
   * v2 reads it from the lineage columns on `motion_actions` (0115); v1 from the pointer inside its
   * own content. Two disjoint branches, each explicitly targeted at one version — never a
   * shape-inferred fallback.
   */
  stagedByActionKey: Record<string, { motionActionId: string; dueAt: string; status: string }>;
}

/** A material ledger event recorded after the plan in force was decided. */
export interface PlanLedgerChange {
  id: string;
  changeType: string;
  reason: string | null;
  occurredAt: string;
}

/** The plan's resolved standing: which revision is in force, which is awaiting a decision. */
export function resolvePlanStanding(revisions: RevisionRecord[]): {
  inForce: RevisionRecord | null;
  latestRecommendation: RevisionRecord | null;
  pending: RevisionRecord | null;
  latestDecision: RevisionRecord | null;
} {
  const sorted = [...revisions].sort((x, y) => x.revisionNo - y.revisionNo);
  const decisions = sorted.filter((r) => r.kind === "DECISION");
  const inForce = [...decisions].reverse().find((r) => r.decision === "APPROVED" || r.decision === "ADJUSTED") ?? null;
  const latestRecommendation = [...sorted].reverse().find((r) => r.kind === "RECOMMENDATION") ?? null;
  const answered = new Set(decisions.map((d) => d.respondsToRevisionId));
  const pending = latestRecommendation && !answered.has(latestRecommendation.id) ? latestRecommendation : null;
  return { inForce, latestRecommendation, pending, latestDecision: decisions.at(-1) ?? null };
}

export interface PursuitPlanView {
  pursuitId: string;
  planId: string | null;
  exists: boolean;
  goal: { objective: string; targetLabel: string | null; confirmed: boolean; provenanceLabel: string } | null;
  status: { state: PlanDisplayState; label: string; atLabel: string | null; byPerson: boolean; reason: string | null };
  review: {
    state: "NOT_APPLICABLE" | "CURRENT" | "REVIEW_NEEDED";
    reasons: string[];
    changesSince: { text: string; atLabel: string | null }[];
    /** A newer recommendation, recorded because the plan in force went stale. */
    update: { revisionId: string; focusHeadline: string | null; nextActionText: string | null; stale: boolean } | null;
  };
  progress: { done: number; total: number; label: string; reachedSinceDecision: number; segments: MilestoneStatus[] };
  focus: { headline: string; stateLabel: string; state: ContextState } | null;
  motion: { line: string | null; note: string | null };
  /**
   * The one action a narrow surface shows: the current actionable one, or the top-ranked action
   * when every action is resolved or blocked. `isCurrent` says which of those it is.
   */
  nextAction: {
    text: string; doneWhen: string | null; via: string | null;
    ownerLabel: string; ownerNote: string | null; dueLabel: string; queued: boolean;
    key: string; isCurrent: boolean;
  } | null;
  /** The ordered recommended actions, each with the standing the canonical selector assigned. */
  actions: {
    key: string; text: string; doneWhen: string | null; via: string | null;
    ownerLabel: string; ownerNote: string | null; dueLabel: string; queued: boolean;
    standing: ActionStanding["standing"];
    /** Present when RESOLVED; `MOTION_ACTION_SKIPPED` never means the condition was satisfied. */
    resolvedReason: ActionResolvedReason | null;
    blockedAfterLabels: string[];
    isCurrent: boolean;
  }[];
  why: { text: string; scopeLabel: string | null }[];
  withheldCount: number;
  milestones: { key: string; label: string; status: MilestoneStatus; statusLabel: string; afterLabels: string[] }[];
  history: { id: string; label: string; detail: string | null; atLabel: string | null; byPerson: boolean }[];
  decision: {
    /** The recommendation a person may approve or adjust now, if any. */
    recommendationId: string | null;
    /** True when the pending recommendation no longer matches the pursuit — refresh before deciding. */
    stale: boolean;
    teamOptions: { id: string; label: string }[];
    ownerTeamMemberId: string | null;
    actionText: string | null;
    actionKey: string | null;
    dueInDays: number;
    /** Every action a person may adjust, in recommended order. Addressed by stable key. */
    actions: { key: string; text: string; ownerTeamMemberId: string | null; dueInDays: number }[];
  };
  /**
   * vNext Slice 2B labelling only. Set by `frameApprovedPlan`, never by the composer, so the
   * Slice 2A view is byte-identical unless the attention capability asks for the frame.
   */
  approvedPlanFrame?: { label: string; note: string; focusLabel: string } | null;
}

/**
 * Label the plan in force as what it is once it needs review (vNext Slice 2B).
 *
 * The approved plan is deliberately preserved when new evidence arrives (D-028), so its content
 * — "No economic buyer identified" — can describe a world that has since moved. Nothing about it
 * is rewritten here: the same content, framed as the CURRENT APPROVED PLAN recorded before the
 * changes the review describes. Copy is chosen here, not in the component (U-14).
 */
export function frameApprovedPlan(view: PursuitPlanView): PursuitPlanView {
  if (view.status.state !== "REVIEW_NEEDED") return { ...view, approvedPlanFrame: null };
  return {
    ...view,
    approvedPlanFrame: {
      label: "Current approved plan",
      note: view.status.atLabel
        ? `Approved ${view.status.atLabel} — recorded before the changes above`
        : "Recorded before the changes above",
      focusLabel: "Focus when approved",
    },
  };
}

export interface PursuitPlanViewInput {
  pursuitId: string;
  caller: Caller;
  state: PlanState | null;
  records: PlanRecords;
  /** The recommendation as the pursuit stands now — computed, never persisted by reading. */
  live: PlanRecommendation | null;
  changesSinceDecision: PlanLedgerChange[];
  now?: Date;
}

const DECISION_WORD: Record<"APPROVED" | "ADJUSTED" | "REJECTED", string> = {
  APPROVED: "Approved by a person",
  ADJUSTED: "Approved with changes by a person",
  REJECTED: "Declined by a person",
};

const CHANGE_FIELD_WORD: Record<PlanAdjustmentChange["field"], string> = {
  "action.text": "action reworded",
  "action.owner": "owner changed",
  "action.dueInDays": "due window changed",
  "action.removed": "action removed",
  "actions.order": "order changed",
};

export function ownerCopy(o: PlanOwner): { label: string; note: string | null } {
  if (o.kind === "PERSON") {
    return { label: `${o.personLabel}${o.roleLabel ? ` · ${o.roleLabel}` : ""}`, note: o.confirmed ? null : "Invited — acceptance pending" };
  }
  if (o.kind === "ROLE_UNFILLED") {
    return { label: "Unassigned", note: `${o.roleLabel ?? "Owner"} role proposed — no one confirmed yet` };
  }
  return { label: "Unassigned", note: o.roleLabel ? `No ${o.roleLabel.toLowerCase()} on the pursuit team yet` : null };
}

function motionCopy(m: PlanMotionRef): { line: string | null; note: string | null } {
  if (!m.motionId) return { line: null, note: "No motion is linked to this pursuit yet" };
  const parts = [`${m.label ?? "Revenue"} motion`];
  if (m.partnerLabel) parts.push(`via ${m.partnerLabel}`);
  if (m.status) parts.push(m.status);
  const note = [
    m.linkage === "OPPORTUNITY" ? "Linked through this pursuit's opportunity" : null,
    m.openActions > 0 ? `${m.openActions} open ${m.openActions === 1 ? "step" : "steps"} already queued` : null,
  ].filter(Boolean).join(" · ");
  return { line: parts.join(" · "), note: note || null };
}

/**
 * The view-model behind the Pursuit plan surface. All copy is chosen here, from
 * declared tables; the component renders it (U-14). Disclosure is applied here a
 * second time — anything the caller may not see is removed and only counted (D-018).
 */
export function composePursuitPlanView(input: PursuitPlanViewInput): PursuitPlanView {
  const now = input.now ?? new Date();
  const { records, caller } = input;
  const standing = resolvePlanStanding(records.revisions);
  const shown = standing.inForce ?? standing.pending ?? standing.latestRecommendation;

  const emptyDecision = { recommendationId: null, stale: false, teamOptions: [], ownerTeamMemberId: null, actionText: null, actionKey: null, dueInDays: DEFAULT_ACTION_DUE_DAYS, actions: [] };
  if (!records.plan || !shown) {
    return {
      pursuitId: input.pursuitId, planId: records.plan?.id ?? null, exists: false, goal: null,
      status: { state: "NONE", label: PLAN_STATE_LABEL.NONE, atLabel: null, byPerson: false, reason: null },
      review: { state: "NOT_APPLICABLE", reasons: [], changesSince: [], update: null },
      progress: { done: 0, total: 0, label: "", reachedSinceDecision: 0, segments: [] },
      focus: null, motion: { line: null, note: null }, nextAction: null, actions: [], why: [], withheldCount: 0,
      milestones: [], history: [], decision: emptyDecision,
    };
  }

  // --- status + review -------------------------------------------------------
  const review = standing.inForce
    ? assessPlanReview(standing.inForce, input.live)
    : { state: "NOT_DECIDED" as const, reasons: [] };
  let state: PlanDisplayState;
  let decidedAt: string | null = null;
  let byPerson = false;
  let statusReason: string | null = null;
  if (standing.inForce) {
    state = review.state === "REVIEW_NEEDED" ? "REVIEW_NEEDED" : (standing.inForce.decision as "APPROVED" | "ADJUSTED");
    decidedAt = standing.inForce.createdAt;
    byPerson = standing.inForce.actorType === "USER";
    statusReason = standing.inForce.reason;
  } else if (standing.pending) {
    state = "AWAITING_DECISION";
  } else {
    state = "DECLINED";
    decidedAt = standing.latestDecision?.createdAt ?? null;
    byPerson = standing.latestDecision?.actorType === "USER";
    statusReason = standing.latestDecision?.reason ?? null;
  }

  const pendingIsUpdate = standing.inForce && standing.pending && standing.pending.revisionNo > standing.inForce.revisionNo;
  // COMPARE LIKE WITH LIKE. A pending recommendation is measured against the algorithm ITS
  // generation was written with — not against whichever one this deployment currently generates.
  // Without the dispatch, a v1 recommendation on a v2-capable build (which is exactly what
  // `PLAN_CONTENT_V2_WRITES_ENABLED=off` produces) would read as permanently stale, and the
  // surface would refuse to offer a decision it is perfectly able to take.
  const pendingStale = standing.pending != null && input.live != null
    && standing.pending.fingerprint !== freshBasisFor(standing.pending.basis, input.live).fingerprint;

  // --- progress --------------------------------------------------------------
  const content = shown.content;
  const liveStatus = input.state ? evaluateMilestones(content.milestones, input.state) : shown.basis.inputs.milestones;
  const segments = content.milestones.map((m) => liveStatus[m.key] ?? "NOT_ESTABLISHED");
  const done = segments.filter((s) => s === "DONE").length;
  const reachedSinceDecision = standing.inForce
    ? content.milestones.filter((m) => liveStatus[m.key] === "DONE" && standing.inForce!.basis.inputs.milestones[m.key] !== "DONE").length
    : 0;

  // --- disclosure: remove before rendering, count only --------------------------
  const visibleWhy = content.why.filter((w) => canDisclose(caller, w.disclosure));
  const visibleVia = (a: PlanActionV2) => (a.via && canDisclose(caller, a.via.disclosure) ? a.via : null);
  const withheldCount = (content.why.length - visibleWhy.length)
    + content.actions.filter((a) => a.via && !visibleVia(a)).length;

  // --- actions ---------------------------------------------------------------
  // The standing of every action, and the one a narrow surface shows, both come from the canonical
  // selector. No surface re-derives "current" — `pursuit-attention` and the approval label consume
  // the same functions, so they cannot drift apart.
  const stagedFor = (a: PlanActionV2) => records.stagedByActionKey[a.key];
  const stagedStanding: StagedByActionKey = Object.fromEntries(
    Object.entries(records.stagedByActionKey).map(([k, v]) => [k, { status: v.status }]));
  const display = selectDisplayPlanAction(content.actions, liveStatus, stagedStanding);
  const dueLabelFor = (a: PlanActionV2) => {
    const staged = stagedFor(a);
    if (staged) return `${staged.status === "done" ? "Done" : staged.status === "skipped" ? "Skipped" : "Due"} ${dayLabel(staged.dueAt, now) ?? ""}`.trim();
    return standing.inForce ? "Not queued — no active motion to carry it" : `Due within ${a.dueInDays} days of approval`;
  };
  const actionView = (a: PlanActionV2, isCurrent: boolean) => {
    const owner = ownerCopy(a.owner);
    const st = actionStanding(a, liveStatus, stagedStanding);
    return {
      key: a.key, text: a.text, doneWhen: a.doneWhen, via: visibleVia(a)?.text ?? null,
      ownerLabel: owner.label, ownerNote: owner.note, dueLabel: dueLabelFor(a), queued: !!stagedFor(a),
      standing: st.standing,
      resolvedReason: st.standing === "RESOLVED" ? st.reason : null,
      blockedAfterLabels: st.standing === "BLOCKED"
        ? (content.milestones.find((m) => m.key === st.milestoneKey)?.dependsOn ?? [])
          .filter((d) => liveStatus[d] !== "DONE")
          .map((d) => content.milestones.find((m) => m.key === d)?.label ?? d)
        : [],
      isCurrent,
    };
  };
  const actions = content.actions.map((a) => actionView(a, display?.action.key === a.key && display.isCurrent));
  // The action a person would adjust now: from the recommendation awaiting a decision when there is
  // one, otherwise from the revision being shown.
  const decidableContent = (standing.pending ?? shown).content;
  const decidable = selectDisplayPlanAction(decidableContent.actions, liveStatus, stagedStanding)?.action ?? null;
  // THE SINGLE-ACTION BLOCK IS THE PLAN'S OWN FIRST ACTION, NEVER A RE-SELECTION.
  //
  // It is tempting to point this at whatever is currently actionable, and it would be wrong: an
  // approved plan is deliberately preserved when the world moves (D-028), and `frameApprovedPlan`
  // labels it "recorded before the changes above". Silently swapping the headline action for a
  // later one would rewrite what a person approved. Which action is actionable NOW is stated in
  // the ordered list instead, by `isCurrent` — the information is added, not substituted.
  //
  // It also keeps a v1 revision rendering byte-identically: its single action IS `actions[0]`.
  const headline = content.actions[0] ?? null;
  const nextAction: PursuitPlanView["nextAction"] = headline
    ? (({ standing: _s, resolvedReason: _r, blockedAfterLabels: _b, ...rest }) =>
      rest)(actionView(headline, display?.isCurrent === true && display.action.key === headline.key))
    : null;

  const labelFor = (k: string) => content.milestones.find((m) => m.key === k)?.label ?? k;
  const goalRec = records.goal;

  return {
    pursuitId: input.pursuitId,
    planId: records.plan.id,
    exists: true,
    goal: goalRec
      ? {
        objective: goalRec.objective,
        targetLabel: goalRec.targetDate ? `Target ${dayLabel(goalRec.targetDate, now)}` : null,
        confirmed: goalRec.status === "ACTIVE" || goalRec.status === "ACHIEVED",
        provenanceLabel: goalRec.origin === "HUMAN_AUTHORED"
          ? "Set by a person"
          : goalRec.status === "PROPOSED" ? "Proposed by PursuitOS — not yet confirmed" : "Proposed by PursuitOS, confirmed by a person",
      }
      : null,
    status: { state, label: PLAN_STATE_LABEL[state], atLabel: dayLabel(decidedAt, now), byPerson, reason: statusReason },
    review: {
      state: review.state === "NOT_DECIDED" ? "NOT_APPLICABLE" : review.state,
      reasons: review.reasons,
      changesSince: review.state === "REVIEW_NEEDED"
        ? input.changesSinceDecision.slice(0, 3).map((c) => ({ text: c.reason ?? c.changeType.toLowerCase().replace(/_/g, " "), atLabel: dayLabel(c.occurredAt, now) }))
        : [],
      update: pendingIsUpdate && standing.pending
        ? {
          revisionId: standing.pending.id,
          focusHeadline: standing.pending.content.focus?.headline ?? null,
          nextActionText: standing.pending.content.actions[0]?.text ?? null,
          stale: pendingStale,
        }
        : null,
    },
    progress: {
      done, total: segments.length,
      label: segments.length ? `${done} of ${segments.length} milestones done` : "",
      reachedSinceDecision, segments,
    },
    focus: content.focus
      ? { headline: content.focus.headline, state: GAP_CONTEXT_STATE[content.focus.kind], stateLabel: CONTEXT_STATE_LABEL[GAP_CONTEXT_STATE[content.focus.kind]] }
      : null,
    motion: motionCopy(content.motion),
    nextAction,
    actions,
    why: visibleWhy.map((w) => ({ text: w.text, scopeLabel: w.origin === "ACCOUNT" ? "Account context" : null })),
    withheldCount,
    milestones: content.milestones.map((m) => ({
      key: m.key, label: m.label, status: liveStatus[m.key] ?? "NOT_ESTABLISHED",
      statusLabel: MILESTONE_STATUS_LABEL[liveStatus[m.key] ?? "NOT_ESTABLISHED"],
      afterLabels: (liveStatus[m.key] === "DONE" ? [] : m.dependsOn.filter((d) => liveStatus[d] !== "DONE").map(labelFor)),
    })),
    history: [...records.revisions].sort((x, y) => y.revisionNo - x.revisionNo).map((r) => ({
      id: r.id,
      label: r.kind === "RECOMMENDATION"
        ? (r.reviewTrigger ? "Updated recommendation from PursuitOS" : "Recommended by PursuitOS")
        : DECISION_WORD[r.decision as "APPROVED" | "ADJUSTED" | "REJECTED"],
      detail: r.kind === "RECOMMENDATION"
        ? (r.reviewTrigger?.reasons[0] ?? (r.content.actions[0] ? `Next: ${r.content.actions[0].text}` : null))
        : [r.adjustments?.map((c) => CHANGE_FIELD_WORD[c.field]).join(", "), r.reason].filter(Boolean).join(" — ") || null,
      atLabel: dayLabel(r.createdAt, now),
      byPerson: r.actorType === "USER",
    })),
    decision: {
      recommendationId: standing.pending?.id ?? null,
      stale: pendingStale,
      teamOptions: (input.state?.team ?? [])
        .filter((m) => m.status !== "SUPERSEDED" && m.status !== "DECLINED" && m.status !== "INACTIVE")
        .map((m) => ({
          id: m.id,
          label: `${m.personLabel ?? TEAM_ROLE_LABEL[m.role] ?? m.role.replace(/_/g, " ").toLowerCase()}${m.personLabel ? ` · ${TEAM_ROLE_LABEL[m.role] ?? m.role}` : ""}${m.partnerLabel ? ` (${m.partnerLabel})` : ""}${m.status === "RECOMMENDED" ? " — proposed" : ""}`,
        })),
      ownerTeamMemberId: decidable?.owner.teamMemberId ?? null,
      actionText: decidable?.text ?? null,
      actionKey: decidable?.key ?? null,
      dueInDays: decidable?.dueInDays ?? DEFAULT_ACTION_DUE_DAYS,
      actions: ((standing.pending ?? shown).content.actions).map((a) => ({
        key: a.key, text: a.text, ownerTeamMemberId: a.owner.teamMemberId, dueInDays: a.dueInDays,
      })),
    },
  };
}
