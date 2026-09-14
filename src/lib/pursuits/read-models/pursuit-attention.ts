import { dueBucket, startOfToday, type DueBucket } from "@/lib/motions/due-buckets";
import { bandOf, type Caller } from "./helpers";
import { todaySort, type OperationalUrgency } from "./materiality";
import {
  dayLabel,
  ownerCopy,
  resolveOwner,
  type PlanDisplayState,
  type PlanOwner,
  type PlanTeamMember,
  type PursuitPlanView,
  type RevisionRecord,
} from "./pursuit-plan";
import type { Band, DecisionClass, DecisionItem, DecisionOther } from "./types";

/**
 * Pursuit Attention (vNext Slice 2B) — the ATTENTION half of the coordination loop.
 *
 *   Today  = "what needs my judgment or attention across my pursuits right now, and why?"
 *   Queue  = "what work exists, and what do I need to execute?"
 *
 * WHAT THIS MODULE IS. A pure, derived read-model. Given the Slice 2A plan context of one
 * pursuit (the same view Pursuit Detail renders for this caller, the plan in force, the
 * recommendation awaiting a decision, and the approved action as the Queue holds it), it
 * derives every applicable attention reason, ranks them by a declared order, and collapses
 * them into ONE primary reason per pursuit with the rest carried beneath it.
 *
 * WHAT IT IS NOT. Not a task system and not a second source of truth: there is no attention
 * table, nothing is persisted, and every reason is recomputed from canonical state on read.
 * Each reason carries a DETERMINISTIC key built from the canonical records it rests on (a
 * revision id, a motion action id, the live plan fingerprint), so a later learning system
 * (P8) can join "attention shown" to the decision, the action and the outcome without anyone
 * having written an attention row.
 *
 * TODAY IS NOT THE QUEUE. A queued action does not by itself earn a Today card: only the
 * action a person approved through the pursuit's plan does, and only when it is overdue, due
 * inside the Queue's own seven-day window, blocked, or unowned. And a plan that needs review
 * outranks the approved action it would otherwise point at — the action stays in the Queue,
 * in force, until a person decides (D-028), but Today never tells the reader the stale action
 * is the most important thing to do.
 *
 * DISCLOSURE FIRST. The plan view arrives already disclosure-filtered for the caller. On top
 * of that, a caller without internal visibility receives only declared-table wording here —
 * never plan free text (a person's reworded action, a gap headline, a review reason), never a
 * person's name, never a warm path. Filtering happens before ranking and before counting, and
 * nothing withheld contributes a reason, a count or a position (D-018).
 *
 * Pure. No database, no writes, no clock except the `now` it is given.
 */

export type AttentionKind =
  | "PLAN_REVIEW_REQUIRED"
  | "PLAN_DECISION_REQUIRED"
  | "ACTION_OVERDUE"
  | "ACTION_BLOCKED"
  | "OWNER_MISSING"
  | "ACTION_DUE"
  | "MILESTONE_ADVANCED";

export type AttentionLayer = "PLAN" | "EXECUTION" | "PROGRESS";

/**
 * The declared order in which one pursuit's reasons are ranked to choose its primary.
 *
 * Validated against Today's existing materiality policy (`todaySort`: decision class →
 * operational urgency → commercial priority → age): the two plan reasons are
 * DECISION_REQUIRED, the four execution reasons ACTION_REQUIRED and progress
 * MATERIAL_CHANGE, so this order never contradicts the class ranking. It adds only what the
 * class cannot say — within a class, which reason a person should see first:
 *
 *   review before decision — an approved plan is steering live work on a basis that moved;
 *   overdue before blocked — late work is already costing time, blocked work is waiting;
 *   blocked before owner   — an owner cannot move a step that cannot proceed;
 *   owner before due       — a due action nobody holds will not happen on its date.
 */
export const ATTENTION_ORDER: readonly AttentionKind[] = [
  "PLAN_REVIEW_REQUIRED",
  "PLAN_DECISION_REQUIRED",
  "ACTION_OVERDUE",
  "ACTION_BLOCKED",
  "OWNER_MISSING",
  "ACTION_DUE",
  "MILESTONE_ADVANCED",
];

interface AttentionPolicy {
  decisionClass: DecisionClass;
  layer: AttentionLayer;
  headline: string;
  cta: string;
  /** What acting runs. READ means the CTA only navigates — nothing governed happens. */
  skill: string;
  sideEffect: "READ" | "INTERNAL_WRITE";
  target: "PLAN" | "WORK" | "TEAM";
}

/** Every word a reader sees for a reason is chosen here (U-14), never in the component. */
export const ATTENTION_POLICY: Record<AttentionKind, AttentionPolicy> = {
  PLAN_REVIEW_REQUIRED: { decisionClass: "DECISION_REQUIRED", layer: "PLAN", headline: "Plan needs review", cta: "Review plan", skill: "decide_pursuit_plan", sideEffect: "INTERNAL_WRITE", target: "PLAN" },
  PLAN_DECISION_REQUIRED: { decisionClass: "DECISION_REQUIRED", layer: "PLAN", headline: "Plan awaiting approval", cta: "Review plan", skill: "decide_pursuit_plan", sideEffect: "INTERNAL_WRITE", target: "PLAN" },
  ACTION_OVERDUE: { decisionClass: "ACTION_REQUIRED", layer: "EXECUTION", headline: "Approved action is overdue", cta: "Open the work", skill: "open_queued_action", sideEffect: "READ", target: "WORK" },
  ACTION_BLOCKED: { decisionClass: "ACTION_REQUIRED", layer: "EXECUTION", headline: "Approved action cannot proceed", cta: "Open pursuit", skill: "open_pursuit_plan", sideEffect: "READ", target: "PLAN" },
  OWNER_MISSING: { decisionClass: "ACTION_REQUIRED", layer: "EXECUTION", headline: "Approved action has no confirmed owner", cta: "Open team", skill: "confirm_team_member", sideEffect: "INTERNAL_WRITE", target: "TEAM" },
  ACTION_DUE: { decisionClass: "ACTION_REQUIRED", layer: "EXECUTION", headline: "Approved action is due", cta: "Open the work", skill: "open_queued_action", sideEffect: "READ", target: "WORK" },
  MILESTONE_ADVANCED: { decisionClass: "MATERIAL_CHANGE", layer: "PROGRESS", headline: "Milestone reached", cta: "Open pursuit", skill: "open_pursuit_plan", sideEffect: "READ", target: "PLAN" },
};

export interface AttentionReason {
  kind: AttentionKind;
  /** Deterministic: the same canonical state always yields the same key. */
  key: string;
  headline: string;
  detail: string | null;
  decisionClass: DecisionClass;
  urgency: OperationalUrgency;
  layer: AttentionLayer;
  cta: { label: string; href: string; skill: string; sideEffect: "READ" | "INTERNAL_WRITE" };
  /** The time of the canonical record this reason rests on (never "now"). */
  at: string;
  /**
   * Set when a higher reason already carries this one — a pending update inside a plan review,
   * progress that is the reason the review exists. Kept on the model (P8 sees everything that
   * was derived); never shown as a separate item and never counted.
   */
  subsumedBy: AttentionKind | null;
  /** The canonical record this reason is grounded in. */
  ref: { refType: "pursuit_plan_revision" | "motion_action" | "pursuit_team_member"; refId: string | null };
}

export interface PursuitAttention {
  /** The primary reason's key — the card's stable identity. */
  key: string;
  pursuitId: string;
  companyId: string;
  accountLabel: string;
  commercialPriority: Band;
  synthetic: boolean;
  planId: string | null;
  primary: AttentionReason;
  /** Non-subsumed reasons after the primary, ranked. What "N other items" counts. */
  others: AttentionReason[];
  /** Every derived reason, subsumed ones included, ranked — the model's full answer. */
  reasons: AttentionReason[];
  owner: { label: string; note: string | null } | null;
  due: { label: string; bucket: Exclude<DueBucket, "NO_DATE"> } | null;
}

export interface PursuitAttentionInput {
  pursuitId: string;
  companyId: string;
  accountLabel: string;
  priorityScore: number | null;
  synthetic: boolean;
  /** The Slice 2A plan view for THIS caller — already tenant-scoped and disclosure-filtered. */
  view: PursuitPlanView;
  inForce: RevisionRecord | null;
  pending: RevisionRecord | null;
  /** The live recommendation's fingerprint — part of the review key, so a new drift is a new attention. */
  liveFingerprint: string | null;
  /** The pursuit team as it stands now; the approved owner is re-read against it. */
  team: PlanTeamMember[];
  /** The in-force plan's staged action as the Queue holds it. */
  staged: { id: string; dueAt: string; status: string } | null;
  /** The earliest material change recorded since the plan in force was decided. */
  firstChangeAt: string | null;
}

const ORDER_INDEX = new Map(ATTENTION_ORDER.map((k, i) => [k, i]));

/** End a carried sentence exactly once — never strip the period off "Inc." to add our own. */
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

function hrefFor(target: AttentionPolicy["target"], pursuitId: string, motionId: string | null): string {
  if (target === "WORK" && motionId) return `/briefs/${motionId}`;
  if (target === "TEAM") return `/pursuits/${pursuitId}#team`;
  return `/pursuits/${pursuitId}#plan`;
}

/** The approved owner, re-read against the team as it stands now. */
function liveOwner(o: PlanOwner, team: PlanTeamMember[]): PlanOwner {
  if (!o.teamMemberId) return o;
  const m = team.find((x) => x.id === o.teamMemberId);
  if (!m) return { ...o, kind: "UNASSIGNED", teamMemberId: null, personLabel: null, confirmed: false };
  return resolveOwner(m.role, [m]);
}

function ownerConfirmed(o: PlanOwner): boolean {
  return o.kind === "PERSON" && o.confirmed;
}

/** Owner copy for the card. A caller without internal visibility never receives a name. */
function ownerFor(o: PlanOwner, caller: Caller): { label: string; note: string | null } {
  if (caller.canSeeInternal) return ownerCopy(o);
  return { label: o.kind === "PERSON" ? "Assigned on the pursuit team" : "Unassigned", note: null };
}

const PLAN_STATES_IN_FORCE: PlanDisplayState[] = ["APPROVED", "ADJUSTED", "REVIEW_NEEDED"];

/**
 * Derive one pursuit's attention: every applicable reason, ranked, collapsed to one primary.
 * Null when nothing about the plan needs a person right now. Deterministic for a given input
 * and `now`; `now` matters only to the due buckets, which are about time by definition.
 */
export function derivePursuitAttention(input: PursuitAttentionInput, caller: Caller, now: Date): PursuitAttention | null {
  const { view, inForce, pending, pursuitId } = input;
  if (!view.exists) return null;
  const internal = caller.canSeeInternal;
  const state = view.status.state;
  const reasons: AttentionReason[] = [];
  const motionId = inForce?.content.motion.motionId ?? pending?.content.motion.motionId ?? null;

  const make = (kind: AttentionKind, key: string, detail: string | null, urgency: OperationalUrgency, at: string, ref: AttentionReason["ref"], subsumedBy: AttentionKind | null = null): AttentionReason => {
    const p = ATTENTION_POLICY[kind];
    return {
      kind, key: `attention:${pursuitId}:${kind}:${key}`, headline: p.headline, detail,
      decisionClass: p.decisionClass, urgency, layer: p.layer,
      cta: { label: p.cta, href: hrefFor(p.target, pursuitId, motionId), skill: p.skill, sideEffect: p.sideEffect },
      at, subsumedBy, ref,
    };
  };

  const na = inForce?.content.nextAction ?? null;
  const staged = na?.stagedMotionActionId && input.staged && input.staged.id === na.stagedMotionActionId ? input.staged : null;
  const stagedPending = staged?.status === "pending";
  const inForceNow = !!inForce && PLAN_STATES_IN_FORCE.includes(state);
  const review = inForceNow && state === "REVIEW_NEEDED";

  // ── plan layer ─────────────────────────────────────────────────────────────
  if (review && inForce) {
    const first = internal ? (view.review.reasons[0] ?? null) : "The pursuit has changed since the plan was approved.";
    const follow = view.review.update && !view.review.update.stale
      ? "An updated recommendation is waiting for your decision."
      : "The approved plan stays in force until a person decides.";
    // Operational urgency (materiality §4): CRITICAL while the stale plan still has queued work
    // someone could execute on a basis that moved — the "acting blindly" case the Queue
    // annotation exists for. HIGH once nothing it queued is still pending.
    reasons.push(make("PLAN_REVIEW_REQUIRED", `${inForce.id}:${input.liveFingerprint ?? "unknown"}`,
      [first, follow].filter(Boolean).join(" "), stagedPending ? "critical" : "high",
      input.firstChangeAt ?? inForce.createdAt, { refType: "pursuit_plan_revision", refId: inForce.id }));
  }
  if (pending) {
    const text = pending.content.nextAction?.text ?? pending.content.focus?.headline ?? null;
    const base = internal && text ? `PursuitOS recommends: ${sentence(text)}` : "PursuitOS has recommended a plan for this pursuit.";
    const detail = view.decision.stale ? `${base} The pursuit has changed since — ask for an updated recommendation.` : base;
    // Same urgency as a route awaiting approval: a recommendation waiting on a person is the
    // shape Today already treats as HIGH.
    reasons.push(make("PLAN_DECISION_REQUIRED", pending.id, detail, "high", pending.createdAt,
      { refType: "pursuit_plan_revision", refId: pending.id }, review ? "PLAN_REVIEW_REQUIRED" : null));
  }

  // ── execution layer — only the action a person approved through this plan ──────
  if (inForceNow && inForce && na) {
    const actionOpen = !staged || stagedPending;
    const inReview = review ? " Still queued from the approved plan, which now needs review." : "";
    if (stagedPending && staged) {
      const bucket = dueBucket(new Date(staged.dueAt), startOfToday(now));
      const when = dayLabel(staged.dueAt, now);
      // Carried verbatim ("…Globex Manufacturing Inc."): the words are the plan's, not ours.
      const what = internal ? na.text.trim() : "The approved next action";
      if (bucket === "OVERDUE") {
        reasons.push(make("ACTION_OVERDUE", staged.id, `${what} — was due ${when}.${inReview}`, "high", staged.dueAt, { refType: "motion_action", refId: staged.id }));
      } else if (bucket === "TODAY" || bucket === "THIS_WEEK") {
        reasons.push(make("ACTION_DUE", `${staged.id}:${bucket}`, `${what} — due ${bucket === "TODAY" ? "today" : when}.${inReview}`,
          bucket === "TODAY" ? "high" : "normal", staged.dueAt, { refType: "motion_action", refId: staged.id }));
      }
    }
    // A real, unresolved dependency — never a guess.
    //   (a) approval could not queue the action: the plan's motion is not active (0009: only an
    //       active motion's work is schedulable), exactly what the plan surface says;
    //   (b) the milestone the action serves waits on an earlier milestone (D-029's declared
    //       dependencies), as the live milestone status reports it.
    if (!staged) {
      reasons.push(make("ACTION_BLOCKED", `${inForce.id}:unqueued`, "Not queued — no active motion to carry it.", "high",
        inForce.createdAt, { refType: "pursuit_plan_revision", refId: inForce.id }));
    }
    const focusKey = inForce.content.focus?.milestoneKey ?? null;
    const focusMs = focusKey ? view.milestones.find((m) => m.key === focusKey && m.status === "BLOCKED") : null;
    if (focusMs && actionOpen) {
      reasons.push(make("ACTION_BLOCKED", `${inForce.id}:${focusMs.key}`,
        `Waits on an earlier step: ${focusMs.afterLabels.join(", ").toLowerCase() || "an earlier milestone"}.`, "high",
        inForce.createdAt, { refType: "pursuit_plan_revision", refId: inForce.id }));
    }
    const owner = liveOwner(na.owner, input.team);
    if (actionOpen && !ownerConfirmed(owner)) {
      const note = internal
        ? (ownerCopy(owner).note ?? "No one holds this action yet.")
        : "No confirmed owner on the pursuit team yet.";
      reasons.push(make("OWNER_MISSING", `${inForce.id}:${owner.teamMemberId ?? "none"}:${owner.kind}`, note, "normal",
        inForce.createdAt, { refType: "pursuit_team_member", refId: owner.teamMemberId }));
    }
  }

  // ── progress — informational, and the very reason a review exists ──────────────
  if (inForceNow && inForce && view.progress.reachedSinceDecision > 0) {
    const reached = view.milestones.filter((m) => m.status === "DONE" && inForce.basis.inputs.milestones[m.key] !== "DONE");
    const n = reached.length;
    const detail = internal && n
      ? `${reached.map((m) => m.label).join(", ")} — reached since the plan was approved.`
      : `${view.progress.reachedSinceDecision} ${view.progress.reachedSinceDecision === 1 ? "milestone" : "milestones"} reached since the plan was approved.`;
    reasons.push(make("MILESTONE_ADVANCED", `${inForce.id}:${reached.map((m) => m.key).join("+") || "progress"}`, detail, "low",
      inForce.createdAt, { refType: "pursuit_plan_revision", refId: inForce.id }, review ? "PLAN_REVIEW_REQUIRED" : null));
  }

  if (!reasons.length) return null;
  reasons.sort((a, b) => (ORDER_INDEX.get(a.kind)! - ORDER_INDEX.get(b.kind)!) || a.key.localeCompare(b.key));
  const visible = reasons.filter((r) => r.subsumedBy === null);
  const [primary, ...others] = visible;
  if (!primary) return null;

  // Owner and due describe the pursuit's approved action (or, awaiting a decision, the one
  // proposed). The due state is shown only when the primary IS about that action — on a plan
  // review it would point the reader at the stale step.
  const ownerSource = na ? liveOwner(na.owner, input.team) : pending?.content.nextAction?.owner ?? null;
  const dueBucketNow = stagedPending && staged ? dueBucket(new Date(staged.dueAt), startOfToday(now)) : null;
  const due = stagedPending && staged && dueBucketNow && dueBucketNow !== "NO_DATE" && primary.layer === "EXECUTION"
    ? {
      bucket: dueBucketNow,
      label: dueBucketNow === "OVERDUE" ? `Overdue since ${dayLabel(staged.dueAt, now)}`
        : dueBucketNow === "TODAY" ? "Due today" : `Due ${dayLabel(staged.dueAt, now)}`,
    }
    : null;

  return {
    key: primary.key,
    pursuitId,
    companyId: input.companyId,
    accountLabel: input.accountLabel,
    commercialPriority: bandOf(input.priorityScore),
    synthetic: input.synthetic,
    planId: view.planId,
    primary,
    others,
    reasons,
    // When the primary already IS the owner problem, the owner line would only repeat it.
    owner: ownerSource && primary.kind !== "OWNER_MISSING" ? ownerFor(ownerSource, caller) : null,
    due,
  };
}

/** One pursuit's attention as a Today card, in the decision queue's own item shape. */
export function attentionToDecisionItem(a: PursuitAttention, extraOthers: DecisionOther[] = []): DecisionItem {
  const p = a.primary;
  const others: DecisionOther[] = [
    ...a.others.map((r) => ({ key: r.key, title: r.headline, detail: r.detail, deepLink: r.cta.href })),
    ...extraOthers,
  ];
  return {
    id: a.key,
    type: p.kind,
    decisionClass: p.decisionClass,
    operationalUrgency: p.urgency,
    commercialPriority: a.commercialPriority,
    pursuitId: a.pursuitId,
    companyId: a.companyId,
    accountLabel: a.accountLabel,
    title: p.headline,
    reason: p.detail ?? "",
    before: null,
    after: null,
    allowedActions: [{ label: p.cta.label, skill: p.cta.skill, sideEffect: p.cta.sideEffect }],
    deepLink: p.cta.href,
    synthetic: a.synthetic,
    at: p.at,
    attention: {
      key: a.key,
      layer: p.layer,
      ownerLabel: a.owner?.label ?? null,
      ownerNote: a.owner?.note ?? null,
      dueLabel: a.due?.label ?? null,
      dueState: a.due?.bucket ?? null,
      kinds: a.reasons.map((r) => r.kind),
    },
    ...(others.length ? { others } : {}),
  };
}

// ---------------------------------------------------------------------------
// Today composition — one card per pursuit
// ---------------------------------------------------------------------------

function byMateriality(now: Date) {
  const age = (it: DecisionItem) => (now.getTime() - new Date(it.at).getTime()) / 1000;
  return (a: DecisionItem, b: DecisionItem) =>
    todaySort(
      { decisionClass: a.decisionClass, operationalUrgency: a.operationalUrgency, commercialPriority: a.commercialPriority, ageSeconds: age(a) },
      { decisionClass: b.decisionClass, operationalUrgency: b.operationalUrgency, commercialPriority: b.commercialPriority, ageSeconds: age(b) },
    ) || a.id.localeCompare(b.id);   // total order: ranking never depends on arrival order
}

export interface AttentionQueueInput {
  /** The existing Today decision items, UNCUT, in any order. */
  items: DecisionItem[];
  /** Pursuit attention for the caller's own pursuits. */
  attention: PursuitAttention[];
  /** Pursuits the caller's organization owns. Anything else never reaches the composition. */
  tenantPursuitIds: ReadonlySet<string>;
  now: Date;
  limit?: number;
}

export interface AttentionQueueResult {
  items: DecisionItem[];
  total: number;
  counts: Record<DecisionClass, number>;
  /** Every composed card, uncut — for badges that must reflect only what the caller owns. */
  all: DecisionItem[];
}

/**
 * Today with pursuit attention: ONE card per pursuit.
 *
 *   • Tenant first. A pursuit-scoped item whose pursuit the caller's organization does not own
 *     is dropped before anything is grouped, ranked or counted — so no other org's pursuit can
 *     move a card, a count, a badge or an "other items" number.
 *   • Where a person is coordinating a pursuit through a plan and that plan needs them, the
 *     plan's attention is the pursuit's card: it already composes the pursuit's focus gap, route,
 *     team and milestones. The pursuit's other Today items fold beneath it as "other items".
 *   • Every other pursuit keeps its most material item (the existing policy, `todaySort`) as its
 *     card, with the rest folded beneath it. A pursuit with a single item is unchanged.
 *   • Items with no pursuit (a fact review, a motion-wide aggregate) are left exactly as they are.
 *   • Cards are ordered by the existing materiality policy; ties break on a stable key.
 */
export function composeAttentionQueue(input: AttentionQueueInput): AttentionQueueResult {
  const order = byMateriality(input.now);
  const owned = input.items.filter((it) => it.pursuitId == null || input.tenantPursuitIds.has(it.pursuitId));
  const attByPursuit = new Map(input.attention.filter((a) => input.tenantPursuitIds.has(a.pursuitId)).map((a) => [a.pursuitId, a]));

  const standalone: DecisionItem[] = [];
  const byPursuit = new Map<string, DecisionItem[]>();
  for (const it of owned) {
    if (it.pursuitId == null) { standalone.push(it); continue; }
    (byPursuit.get(it.pursuitId) ?? byPursuit.set(it.pursuitId, []).get(it.pursuitId)!).push(it);
  }

  const toOther = (it: DecisionItem): DecisionOther => ({ key: it.id, title: it.title, detail: null, deepLink: it.deepLink });
  const cards: DecisionItem[] = [...standalone];
  const pursuitIds = [...new Set([...attByPursuit.keys(), ...byPursuit.keys()])].sort();
  for (const pid of pursuitIds) {
    const existing = [...(byPursuit.get(pid) ?? [])].sort(order);
    const att = attByPursuit.get(pid);
    if (att) {
      cards.push(attentionToDecisionItem(att, existing.map(toOther)));
    } else if (existing.length) {
      const [primary, ...rest] = existing;
      cards.push(rest.length ? { ...primary, others: rest.map(toOther) } : primary);
    }
  }

  cards.sort(order);
  const counts = { DECISION_REQUIRED: 0, MATERIAL_CHANGE: 0, ACTION_REQUIRED: 0, RISK: 0, OPPORTUNITY: 0, FYI: 0 } as Record<DecisionClass, number>;
  for (const c of cards) counts[c.decisionClass]++;
  return {
    items: input.limit != null ? cards.slice(0, input.limit) : cards,
    total: cards.length,
    counts,
    all: cards,
  };
}

// ---------------------------------------------------------------------------
// Queue lineage — which plan selected an action, and is that plan still current?
// ---------------------------------------------------------------------------

export type QueueLineageState = "CURRENT" | "REVIEW_NEEDED" | "EARLIER_PLAN";

export const QUEUE_LINEAGE_COPY: Record<QueueLineageState, { label: string; link: string }> = {
  CURRENT: { label: "From the approved plan", link: "View plan" },
  REVIEW_NEEDED: { label: "Plan needs review", link: "Review plan" },
  EARLIER_PLAN: { label: "From an earlier approved plan", link: "View plan" },
};

export interface QueueLineage {
  motionActionId: string;
  pursuitId: string;
  planId: string;
  /** The DECISION revision that queued this action. */
  revisionId: string;
  decision: "APPROVED" | "ADJUSTED";
  approvedByPerson: boolean;
  /** Is that decision the plan in force today? */
  inForce: boolean;
  state: QueueLineageState;
  label: string;
  linkLabel: string;
  href: string;
  /** Plain-language provenance for the link's title — no ids. */
  provenance: string;
}

export interface QueueLineageInput {
  motionActionId: string;
  pursuitId: string;
  planId: string;
  decisionRevision: { id: string; decision: "APPROVED" | "ADJUSTED"; actorType: string; createdAt: string };
  /** The plan's live standing, as the plan surface resolves it for this caller. */
  livePlanId: string | null;
  inForceRevisionId: string | null;
  planState: PlanDisplayState;
  now: Date;
}

/**
 * The plan context one queued action carries. The Queue never changes because a plan needs
 * review — the approved plan stays in force until a person decides — but a row queued by that
 * plan says so, so no one acts on it blindly.
 */
export function queueLineageFor(input: QueueLineageInput): QueueLineage {
  const inForce = input.livePlanId === input.planId && input.inForceRevisionId === input.decisionRevision.id;
  const state: QueueLineageState = !inForce ? "EARLIER_PLAN" : input.planState === "REVIEW_NEEDED" ? "REVIEW_NEEDED" : "CURRENT";
  const byPerson = input.decisionRevision.actorType === "USER";
  const when = dayLabel(input.decisionRevision.createdAt, input.now);
  const how = input.decisionRevision.decision === "ADJUSTED" ? "Approved with changes" : "Approved";
  return {
    motionActionId: input.motionActionId,
    pursuitId: input.pursuitId,
    planId: input.planId,
    revisionId: input.decisionRevision.id,
    decision: input.decisionRevision.decision,
    approvedByPerson: byPerson,
    inForce,
    state,
    label: QUEUE_LINEAGE_COPY[state].label,
    linkLabel: QUEUE_LINEAGE_COPY[state].link,
    href: `/pursuits/${input.pursuitId}#plan`,
    provenance: `${how}${byPerson ? " by a person" : ""}${when ? ` on ${when}` : ""}${state === "EARLIER_PLAN" ? " — a later decision replaced this plan" : ""}`,
  };
}
