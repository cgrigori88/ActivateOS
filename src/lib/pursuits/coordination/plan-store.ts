import type { PoolClient } from "pg";
import { nextBusinessDay } from "@/lib/motions/cadence";
import { recordChange } from "../ledger";
import type { DataEnvironment } from "../lineage";
import { recordOverride } from "../overrides";
import { callerFor } from "../read-models/caller";
import { loadChangesSince, loadPlanRecords, loadPlanState } from "../read-models/plan-loaders";
import {
  RECOMMENDER_VERSION,
  applyAdjustments,
  assessPlanReview,
  recommendPursuitPlan,
  resolvePlanStanding,
  type PlanAdjustmentChange,
  type PlanAdjustments,
  type PlanContent,
  type ReviewTrigger,
} from "../read-models/pursuit-plan";

/**
 * Pursuit Coordination writes (vNext Slice 2A). Called ONLY from the governed
 * skills `recommend_pursuit_plan` and `decide_pursuit_plan` inside `dispatchSkill`,
 * which own authorization, idempotency and the invocation audit. Nothing here is
 * reachable from a surface directly.
 *
 * WHAT THESE WRITES CAN AND CANNOT DO.
 *   • record a recommendation (a proposal — never in force until a person decides);
 *   • record a person's decision, which references the recommendation it answers;
 *   • stage the approved next action as a pending step on the motion that carries
 *     the pursuit — the existing action queue, not a new one;
 *   • record a human divergence as an override (supervision data, D-004).
 * They never send, never call a provider, never touch the outbox, and never write
 * outside this org. No path here performs an external action.
 *
 * APPEND-ONLY. A revision is inserted and never updated. The plan in force is the
 * newest human-decided revision; it is replaced only by a newer human decision.
 */

export interface PlanActor {
  type: "USER" | "AGENT" | "WORKER" | "SYSTEM";
  id: string | null;
  orgId: string;
}

export interface WriteOpts {
  env: DataEnvironment;
  correlationId: string | null;
  now?: Date;
}

async function nextRevisionNo(db: PoolClient, planId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select coalesce(max(revision_no), 0) + 1 as n from pursuit_plan_revisions where plan_id = $1`, [planId]);
  return Number(rows[0].n);
}

/**
 * Record PursuitOS's recommended plan for a pursuit.
 *
 * Creates the goal and plan identity on first use. Appends a RECOMMENDATION only
 * when the recommendation would differ from the latest one on record — the same
 * canonical state never produces a second, identical proposal.
 *
 * If a plan is already IN FORCE and the pursuit has moved underneath it, the new
 * recommendation carries a review trigger and a PLAN_REVIEW_REQUIRED ledger event is
 * written. The plan in force is not touched: it stays exactly as a person approved
 * it until a person decides otherwise.
 */
export async function recordPlanRecommendation(
  db: PoolClient, actor: PlanActor, pursuitId: string, opts: WriteOpts,
): Promise<{ status: "RECORDED" | "UNCHANGED"; goalId: string; planId: string; revisionId: string; reviewRequired: boolean }> {
  const now = opts.now ?? new Date();
  // Serialize concurrent recommendations for one pursuit on the pursuit row itself.
  const lock = await db.query(`select id from pursuits where id = $1 and org_id = $2 for update`, [pursuitId, actor.orgId]);
  if (!lock.rows[0]) throw new Error("pursuit not found in this organization");

  const caller = await callerFor(db, actor.orgId);
  const state = await loadPlanState(db, caller, pursuitId, now);
  if (!state) throw new Error("pursuit not found in this organization");
  const rec = recommendPursuitPlan(state, now);
  const records = await loadPlanRecords(db, caller, pursuitId);

  let goalId = records.goal && (records.goal.status === "PROPOSED" || records.goal.status === "ACTIVE") ? records.goal.id : null;
  if (!goalId) {
    goalId = (await db.query<{ id: string }>(
      `insert into pursuit_goals (org_id, pursuit_id, objective, target_date, status, origin, basis,
                                  proposed_by_actor_type, proposed_by_actor_id, data_environment)
       values ($1,$2,$3,$4,'PROPOSED','SYSTEM_RECOMMENDED',$5,$6,$7,$8) returning id`,
      [actor.orgId, pursuitId, rec.goal.objective, rec.goal.targetDate, JSON.stringify({ evidence: rec.goal.basis, recommenderVersion: RECOMMENDER_VERSION }),
       actor.type, actor.id, opts.env])).rows[0].id;
  }

  // A plan is reused only for the goal it implements. After a goal is replaced its plan is
  // SUPERSEDED, so the new goal always gets a plan of its own.
  let planId = records.plan && (records.plan.status === "PROPOSED" || records.plan.status === "ACTIVE") && records.plan.goalId === goalId
    ? records.plan.id : null;
  if (!planId) {
    planId = (await db.query<{ id: string }>(
      `insert into pursuit_plans (org_id, pursuit_id, goal_id, status, data_environment)
       values ($1,$2,$3,'PROPOSED',$4) returning id`,
      [actor.orgId, pursuitId, goalId, opts.env])).rows[0].id;
  }

  const revisions = records.plan?.id === planId ? records.revisions : [];
  const { inForce, latestRecommendation } = resolvePlanStanding(revisions);
  if (latestRecommendation && latestRecommendation.fingerprint === rec.basis.fingerprint) {
    return { status: "UNCHANGED", goalId, planId, revisionId: latestRecommendation.id, reviewRequired: false };
  }

  let reviewTrigger: ReviewTrigger | null = null;
  if (inForce && inForce.fingerprint !== rec.basis.fingerprint) {
    const assessment = assessPlanReview(inForce, rec);
    const changes = await loadChangesSince(db, caller, pursuitId, inForce.createdAt);
    reviewTrigger = { fromRevisionId: inForce.id, reasons: assessment.reasons, ledgerEventIds: changes.map((c) => c.id) };
  }

  const revisionNo = await nextRevisionNo(db, planId);
  const revisionId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions
       (org_id, pursuit_id, plan_id, revision_no, kind, content, basis, basis_fingerprint,
        review_trigger, actor_type, actor_id, correlation_id, recommender_version, data_environment)
     values ($1,$2,$3,$4,'RECOMMENDATION',$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [actor.orgId, pursuitId, planId, revisionNo, JSON.stringify(rec.content), JSON.stringify(rec.basis), rec.basis.fingerprint,
     reviewTrigger ? JSON.stringify(reviewTrigger) : null, actor.type, actor.id, opts.correlationId, RECOMMENDER_VERSION, opts.env])).rows[0].id;

  if (reviewTrigger && inForce) {
    await recordChange(db, {
      orgId: actor.orgId, pursuitId, entityType: "pursuit_plan", entityId: planId,
      changeType: "PLAN_REVIEW_REQUIRED", materiality: "MEDIUM",
      reason: `Pursuit plan needs review — ${reviewTrigger.reasons[0]?.replace(/\.$/, "") ?? "context changed"}`,
      actorType: actor.type, actorId: actor.id, triggerType: "MODEL_RECALCULATION", triggerId: inForce.id,
      modelVersion: RECOMMENDER_VERSION, dataEnvironment: opts.env,
      before: { revisionId: inForce.id, fingerprint: inForce.fingerprint },
      after: { revisionId, fingerprint: rec.basis.fingerprint, reasons: reviewTrigger.reasons },
    });
  }

  return { status: "RECORDED", goalId, planId, revisionId, reviewRequired: reviewTrigger != null };
}

export interface ReplaceGoalArgs {
  pursuitId: string;
  objective: string;
  targetDate?: string | null;
  reason: string;
}

/**
 * Replace a pursuit's commercial objective (D-033).
 *
 * Only for a GENUINELY different outcome. Choosing another route, motion or action is
 * plan state and never comes here — the goal does not encode any of them.
 *
 * Append-only: the live goal keeps its objective byte for byte and only moves to
 * SUPERSEDED; the plan that implemented it moves to SUPERSEDED with every revision
 * intact; a NEW, human-authored, active goal names the goal it replaces and why. The
 * next recommendation starts a fresh plan for the new goal.
 */
export async function replacePursuitGoal(
  db: PoolClient, actor: PlanActor, args: ReplaceGoalArgs, opts: WriteOpts,
): Promise<{ goalId: string; replacedGoalId: string; supersededPlanId: string | null }> {
  const objective = args.objective?.trim() ?? "";
  const reason = args.reason?.trim() ?? "";
  if (objective.length < 3 || objective.length > 300) throw new Error("A goal's objective must be between 3 and 300 characters.");
  if (!reason) throw new Error("A reason is required to replace a pursuit's goal.");
  const targetDate = args.targetDate ?? null;
  if (targetDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error("Target date must be YYYY-MM-DD.");

  const lock = await db.query(`select id from pursuits where id = $1 and org_id = $2 for update`, [args.pursuitId, actor.orgId]);
  if (!lock.rows[0]) throw new Error("pursuit not found in this organization");

  const live = (await db.query<{ id: string; objective: string }>(
    `select id, objective from pursuit_goals
      where pursuit_id = $1 and org_id = $2 and status in ('PROPOSED','ACTIVE') for update`,
    [args.pursuitId, actor.orgId])).rows[0];
  if (!live) throw new Error("This pursuit has no live goal to replace.");
  if (live.objective.trim() === objective) throw new Error("That is the current objective — nothing to replace.");

  // Old meaning preserved: only its lifecycle status moves (the one updatable column that matters).
  await db.query(`update pursuit_goals set status = 'SUPERSEDED', updated_at = now() where id = $1 and org_id = $2`, [live.id, actor.orgId]);
  const plan = (await db.query<{ id: string }>(
    `update pursuit_plans set status = 'SUPERSEDED', updated_at = now()
      where goal_id = $1 and org_id = $2 and status in ('PROPOSED','ACTIVE') returning id`,
    [live.id, actor.orgId])).rows[0];

  const goalId = (await db.query<{ id: string }>(
    `insert into pursuit_goals (org_id, pursuit_id, objective, target_date, status, origin, basis,
                                proposed_by_actor_type, proposed_by_actor_id, decided_by_actor_id, decided_at,
                                supersedes_goal_id, supersession_reason, data_environment)
     values ($1,$2,$3,$4,'ACTIVE','HUMAN_AUTHORED',$5,$6,$7,$7, now(), $8,$9,$10) returning id`,
    [actor.orgId, args.pursuitId, objective, targetDate, JSON.stringify({ replaces: live.id }),
     actor.type, actor.id, live.id, reason, opts.env])).rows[0].id;

  await recordChange(db, {
    orgId: actor.orgId, pursuitId: args.pursuitId, entityType: "pursuit_goal", entityId: goalId,
    changeType: "GOAL_REPLACED", materiality: "MEDIUM",
    reason: `Pursuit goal replaced — ${reason}`,
    actorType: actor.type, actorId: actor.id, triggerType: "MANUAL", dataEnvironment: opts.env,
    before: { goalId: live.id, objective: live.objective, planId: plan?.id ?? null },
    after: { goalId, objective, supersedesGoalId: live.id },
  });

  return { goalId, replacedGoalId: live.id, supersededPlanId: plan?.id ?? null };
}

export type PlanDecision = "APPROVED" | "ADJUSTED" | "REJECTED";

export interface DecidePlanArgs {
  pursuitId: string;
  planId: string;
  recommendationId: string;
  decision: PlanDecision;
  adjustments?: PlanAdjustments;
  reason?: string | null;
}

/**
 * Record a person's decision on the recommendation awaiting one.
 *
 *   APPROVED  the recommendation becomes the plan in force, unchanged;
 *   ADJUSTED  it becomes the plan in force with the person's changes, and the
 *             divergence is recorded as an override;
 *   REJECTED  nothing comes into force; the refusal and its reason are recorded.
 *
 * Only the LATEST recommendation can be decided, only once, and only while it still
 * matches the pursuit — approving a plan computed against a world that has since
 * moved would put a stale plan in force.
 */
export async function decidePlan(
  db: PoolClient, actor: PlanActor, args: DecidePlanArgs, opts: WriteOpts,
): Promise<{ decision: PlanDecision; revisionId: string; stagedMotionActionId: string | null }> {
  const now = opts.now ?? new Date();
  if (!["APPROVED", "ADJUSTED", "REJECTED"].includes(args.decision)) throw new Error(`unknown plan decision ${args.decision}`);
  const reason = args.reason?.trim() || null;
  if (args.decision !== "APPROVED" && !reason) throw new Error("A reason is required to adjust or decline a recommended plan.");

  const plan = (await db.query<{ id: string; goal_id: string; status: string }>(
    `select id, goal_id, status from pursuit_plans where id = $1 and org_id = $2 and pursuit_id = $3 for update`,
    [args.planId, actor.orgId, args.pursuitId])).rows[0];
  if (!plan) throw new Error("plan not found for this pursuit in this organization");

  const caller = await callerFor(db, actor.orgId);
  const records = await loadPlanRecords(db, caller, args.pursuitId);
  if (records.plan?.id !== plan.id) throw new Error("plan is not the live plan for this pursuit");
  const { pending } = resolvePlanStanding(records.revisions);
  if (!pending || pending.id !== args.recommendationId) throw new Error("This recommendation is no longer awaiting a decision.");

  const state = await loadPlanState(db, caller, args.pursuitId, now);
  if (!state) throw new Error("pursuit not found in this organization");
  if (args.decision !== "REJECTED" && recommendPursuitPlan(state, now).basis.fingerprint !== pending.fingerprint) {
    throw new Error("The pursuit has changed since this plan was recommended — request an updated plan first.");
  }

  let content: PlanContent = pending.content;
  let changes: PlanAdjustmentChange[] | null = null;
  if (args.decision === "ADJUSTED") {
    const adjusted = applyAdjustments(pending.content, args.adjustments ?? {}, state.team);
    content = adjusted.content;
    changes = adjusted.changes;
  }

  // Stage the next action into the motion's existing queue — only when a person put
  // the plan in force, and only onto an ACTIVE motion (activation is what makes a
  // motion's work schedulable, 0009). Otherwise it stays with the plan, unqueued,
  // and the surface says so.
  let stagedMotionActionId: string | null = null;
  if (args.decision !== "REJECTED" && content.nextAction && content.motion.motionId) {
    const motion = (await db.query<{ status: string }>(
      `select status from revenue_motions where id = $1 and org_id = $2`, [content.motion.motionId, actor.orgId])).rows[0];
    if (motion?.status === "active") {
      const step = Number((await db.query<{ n: number }>(
        `select coalesce(max(step), 0) + 1 as n from motion_actions where motion_id = $1`, [content.motion.motionId])).rows[0].n);
      const dueAt = nextBusinessDay(new Date(now.getTime() + content.nextAction.dueInDays * 86_400_000));
      stagedMotionActionId = (await db.query<{ id: string }>(
        `insert into motion_actions (org_id, motion_id, step, action, due_at) values ($1,$2,$3,$4,$5) returning id`,
        [actor.orgId, content.motion.motionId, step, content.nextAction.text, dueAt])).rows[0].id;
      content = { ...content, nextAction: { ...content.nextAction, stagedMotionActionId } };
      await recordChange(db, {
        orgId: actor.orgId, pursuitId: args.pursuitId, entityType: "motion_action", entityId: stagedMotionActionId,
        changeType: "ACTION_CREATED", materiality: "LOW",
        reason: `Plan action queued: ${content.nextAction!.text}`,
        actorType: "USER", actorId: actor.id, triggerType: "MANUAL", dataEnvironment: opts.env,
        after: { motionId: content.motion.motionId, step, dueAt: dueAt.toISOString(), planId: plan.id },
      });
    }
  }

  const revisionNo = await nextRevisionNo(db, plan.id);
  const revisionId = (await db.query<{ id: string }>(
    `insert into pursuit_plan_revisions
       (org_id, pursuit_id, plan_id, revision_no, kind, decision, responds_to_revision_id, content, basis,
        basis_fingerprint, adjustments, reason, actor_type, actor_id, correlation_id, data_environment)
     values ($1,$2,$3,$4,'DECISION',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [actor.orgId, args.pursuitId, plan.id, revisionNo, args.decision, pending.id, JSON.stringify(content),
     JSON.stringify(pending.basis), pending.fingerprint, changes ? JSON.stringify(changes) : null, reason,
     actor.type, actor.id, opts.correlationId, opts.env])).rows[0].id;

  // A person diverging from the recommendation is supervision data — the same
  // immutable trail every other override lands in (0068).
  if (args.decision !== "APPROVED") {
    await recordOverride(db, {
      orgId: actor.orgId, pursuitId: args.pursuitId, field: "plan",
      originalRecommendation: {
        revisionId: pending.id, fingerprint: pending.fingerprint, focus: pending.content.focus?.gapKey ?? null,
        nextAction: pending.content.nextAction
          ? { key: pending.content.nextAction.key, text: pending.content.nextAction.text, ownerTeamMemberId: pending.content.nextAction.owner.teamMemberId, dueInDays: pending.content.nextAction.dueInDays }
          : null,
      },
      humanDecision: { decision: args.decision, revisionId, adjustments: changes },
      reason, actorId: actor.id, modelVersion: RECOMMENDER_VERSION, dataEnvironment: opts.env,
    });
  }

  let goalStatus: string | null = null;
  if (args.decision !== "REJECTED") {
    const g = await db.query<{ status: string }>(
      `update pursuit_goals set status = 'ACTIVE', decided_by_actor_id = $3, decided_at = now(), updated_at = now()
        where id = $1 and org_id = $2 and status = 'PROPOSED' returning status`,
      [plan.goal_id, actor.orgId, actor.id]);
    goalStatus = g.rows[0]?.status ?? null;
    await db.query(
      `update pursuit_plans set status = 'ACTIVE', updated_at = now() where id = $1 and org_id = $2 and status = 'PROPOSED'`,
      [plan.id, actor.orgId]);
  }

  await recordChange(db, {
    orgId: actor.orgId, pursuitId: args.pursuitId, entityType: "pursuit_plan", entityId: plan.id,
    changeType: "PLAN_DECIDED", materiality: "MEDIUM",
    reason: args.decision === "APPROVED" ? "Pursuit plan approved"
      : args.decision === "ADJUSTED" ? `Pursuit plan approved with changes — ${reason}`
        : `Recommended pursuit plan declined — ${reason}`,
    actorType: "USER", actorId: actor.id,
    triggerType: args.decision === "APPROVED" ? "MANUAL" : "USER_OVERRIDE",
    modelVersion: RECOMMENDER_VERSION, dataEnvironment: opts.env,
    before: { recommendationRevisionId: pending.id, fingerprint: pending.fingerprint, nextAction: pending.content.nextAction?.text ?? null },
    after: { decision: args.decision, revisionId, nextAction: content.nextAction?.text ?? null, stagedMotionActionId, goalConfirmed: goalStatus === "ACTIVE" },
  });

  return { decision: args.decision, revisionId, stagedMotionActionId };
}
