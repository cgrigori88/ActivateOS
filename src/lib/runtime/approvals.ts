import type { PoolClient } from "pg";
import { recordChange } from "@/lib/pursuits/ledger";
import { DECIDE_SKILL, dispatchSkill, type Actor } from "@/lib/pursuits/federation/skills";
import type { DataEnvironment } from "@/lib/pursuits/lineage";

/**
 * P45-2 — the approval lifecycle.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: **approval authorizes continuation; it does not confer
 * authority.** Nothing here creates a capability, restores a revoked grant, reactivates a suspended
 * actor, bypasses principal matching, tenancy, feature gates or the send posture, or retargets a
 * stale run. A decision only ever unblocks work that was *already* governed.
 *
 * Which is why authority is re-evaluated IMMEDIATELY BEFORE continuation, never trusted from the
 * moment the request was raised (`assertStillExecutable`). An approval is not a frozen entitlement:
 * if the grant was revoked, the actor suspended or the revision superseded while the request waited,
 * the request is INVALIDATED rather than allowed to resurrect authority that has lapsed.
 *
 * APPEND-ONLY. `pursuit_run_approvals` is INSERT/SELECT for `app_rw`. A request row is never
 * mutated; a terminal row NAMES its request via `request_id`, and the database enforces that the two
 * share org / run / step.
 *
 * THE RACE. Two approvers acting at once resolve through three independent layers:
 *   1. `pursuit_run_approvals_one_terminal` — a partial unique index on `request_id`: exactly ONE
 *      terminal row can ever commit. This is the race arbiter.
 *   2. a conditional (compare-and-set) transition of the run and step out of WAITING_FOR_APPROVAL:
 *      exactly one transition wins. This is the runtime arbiter.
 *   3. step idempotency (proven in P45-1): even a double resume replays one invocation.
 * All of it happens inside ONE transaction, so a durable APPROVED decision can never commit while
 * the run is left stranded in WAITING_FOR_APPROVAL.
 */

export type ApprovalDecision = "REQUESTED" | "APPROVED" | "REJECTED" | "INVALIDATED";

/** Why the system withdrew a pending request. Never a human act. */
export type InvalidationReason = "PLAN_SUPERSEDED" | "CAPABILITY_REVOKED" | "ACTOR_SUSPENDED";

export interface PendingApproval {
  requestId: string; orgId: string; pursuitId: string; runId: string; runStepId: string;
  skillId: string; skillVersion: number; requestedByActorId: string; requestedAt: string;
  account: string | null; actionText: string | null; whyRequired: string; planRevisionId: string;
}

export interface DecisionOutcome {
  status: "DECIDED" | "ALREADY_DECIDED" | "NOT_PENDING" | "INVALIDATED" | "REFUSED";
  decision: ApprovalDecision | null;
  requestId: string | null;
  reason: string | null;
}

/** One ledger event per approval transition, in the SAME event model as everything else. */
async function approvalLedger(
  db: PoolClient, orgId: string, pursuitId: string, runId: string, stepId: string,
  changeType: "APPROVAL_REQUESTED" | "APPROVAL_GRANTED" | "APPROVAL_REJECTED" | "APPROVAL_INVALIDATED",
  o: { actorId?: string | null; governedActorId?: string | null; env: DataEnvironment; reason: string;
       before: unknown; after: unknown },
): Promise<void> {
  await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit_run", entityId: runId,
    changeType, materiality: "HIGH", reason: o.reason,
    actorType: "USER", actorId: o.actorId ?? null, triggerType: "GOVERNED_ACTION",
    dataEnvironment: o.env, before: o.before ?? undefined, after: o.after ?? undefined,
    runId, runStepId: stepId, governedActorId: o.governedActorId ?? null,
  });
}

/** Open the lifecycle. Called by the runtime when policy says this action needs a human. */
export async function requestApproval(
  db: PoolClient, orgId: string,
  a: { pursuitId: string; planRevisionId: string; runId: string; runStepId: string;
       skillId: string; skillVersion: number; requestedByActorId: string; env: DataEnvironment; why: string },
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `select id from pursuit_run_approvals
      where org_id = $1 and run_step_id = $2 and decision = 'REQUESTED'`, [orgId, a.runStepId]);
  if (existing.rows[0]) return existing.rows[0].id;      // idempotent: one open request per step

  const { rows } = await db.query<{ id: string }>(
    `insert into pursuit_run_approvals
       (org_id, pursuit_id, plan_revision_id, run_id, run_step_id, skill_id, skill_version,
        decision, requested_by_actor_id, reason, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,'REQUESTED',$8,$9,$10) returning id`,
    [orgId, a.pursuitId, a.planRevisionId, a.runId, a.runStepId, a.skillId, a.skillVersion,
     a.requestedByActorId, a.why, a.env]);
  await approvalLedger(db, orgId, a.pursuitId, a.runId, a.runStepId, "APPROVAL_REQUESTED",
    { governedActorId: a.requestedByActorId, env: a.env, reason: a.why,
      before: { status: "READY" }, after: { status: "WAITING_FOR_APPROVAL", requestId: rows[0].id, skillId: a.skillId } });
  return rows[0].id;
}

interface Ctx {
  request_id: string; pursuit_id: string; run_id: string; run_step_id: string; plan_revision_id: string;
  skill_id: string; skill_version: number; requested_by_actor_id: string; data_environment: DataEnvironment;
  run_status: string; step_status: string;
}

const loadPending = async (db: PoolClient, orgId: string, requestId: string): Promise<Ctx | null> =>
  (await db.query<Ctx>(
    `select a.id as request_id, a.pursuit_id, a.run_id, a.run_step_id, a.plan_revision_id,
            a.skill_id, a.skill_version, a.requested_by_actor_id, a.data_environment,
            r.status as run_status, s.status as step_status
       from pursuit_run_approvals a
       join pursuit_runs r on r.id = a.run_id and r.org_id = a.org_id
       join pursuit_run_steps s on s.id = a.run_step_id and s.org_id = a.org_id
      where a.org_id = $1 and a.id = $2 and a.decision = 'REQUESTED'
        and not exists (select 1 from pursuit_run_approvals t where t.request_id = a.id)`,
    [orgId, requestId])).rows[0] ?? null;

/**
 * THE STALE-AUTHORITY RULE. Authority at request time proves nothing about authority now. If any of
 * it has lapsed the request is INVALIDATED — a human must not be able to approve an action that can
 * no longer legally execute.
 */
async function staleAuthority(db: PoolClient, orgId: string, c: Ctx): Promise<InvalidationReason | null> {
  const { rows: sup } = await db.query<{ superseded: boolean }>(
    `select (p.status in ('SUPERSEDED','CLOSED')
             or exists (select 1 from pursuit_plan_revisions r2
                         where r2.plan_id = r.plan_id and r2.org_id = $1 and r2.kind = 'DECISION'
                           and r2.revision_no > r.revision_no)) as superseded
       from pursuit_plan_revisions r join pursuit_plans p on p.id = r.plan_id
      where r.id = $2 and r.org_id = $1`, [orgId, c.plan_revision_id]);
  if (sup[0]?.superseded) return "PLAN_SUPERSEDED";

  const { rows: actor } = await db.query<{ lifecycle: string }>(
    `select lifecycle from governed_actors where id = $1 and org_id = $2`, [c.requested_by_actor_id, orgId]);
  if (!actor[0] || actor[0].lifecycle !== "ACTIVE") return "ACTOR_SUSPENDED";

  const { rows: grant } = await db.query<{ id: string }>(
    `select id from actor_capability_grants
      where org_id = $1 and actor_id = $2 and skill_id = $3 and status = 'ACTIVE'
        and (skill_version is null or skill_version = $4)`,
    [orgId, c.requested_by_actor_id, c.skill_id, c.skill_version]);
  if (!grant[0]) return "CAPABILITY_REVOKED";
  return null;
}

/** Withdraw a pending request the system can no longer honour. Terminal, and never a human act. */
export async function invalidateApproval(
  db: PoolClient, orgId: string, c: Ctx, reason: InvalidationReason,
): Promise<void> {
  await db.query(
    `insert into pursuit_run_approvals
       (org_id, pursuit_id, plan_revision_id, run_id, run_step_id, skill_id, skill_version,
        decision, request_id, reason, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,'INVALIDATED',$8,$9,$10)
     on conflict do nothing`,
    [orgId, c.pursuit_id, c.plan_revision_id, c.run_id, c.run_step_id, c.skill_id, c.skill_version,
     c.request_id, reason, c.data_environment]);
  await db.query(
    `update pursuit_run_steps set status = 'CANCELLED', ended_at = now(), updated_at = now()
      where id = $1 and org_id = $2 and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE')`,
    [c.run_step_id, orgId]);
  await db.query(
    `update pursuit_runs set status = 'CANCELLED', reason = $3, last_transition_at = now(), updated_at = now()
      where id = $1 and org_id = $2 and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE')`,
    [c.run_id, orgId, reason]);
  await approvalLedger(db, orgId, c.pursuit_id, c.run_id, c.run_step_id, "APPROVAL_INVALIDATED",
    { governedActorId: c.requested_by_actor_id, env: c.data_environment, reason,
      before: { status: "WAITING_FOR_APPROVAL" }, after: { status: "CANCELLED", decision: "INVALIDATED", reason } });
}

/**
 * Decide a pending request. ONE transaction: validate → insert the winning terminal row →
 * compare-and-set the run and step → append the ledger event.
 *
 * `decidingActor` must hold a live grant for DECIDE_SKILL — checked by `dispatchSkill`, so the
 * decision is itself a governed action with its own invocation record. The principal is
 * SERVER-RESOLVED by the caller; this function never accepts a client-supplied approver identity.
 */
export async function decideApproval(
  db: PoolClient, orgId: string, requestId: string,
  decision: "APPROVED" | "REJECTED",
  decider: { governedActorId: string; principal: string | null; actor: Actor },
  reason?: string,
): Promise<DecisionOutcome> {
  const c = await loadPending(db, orgId, requestId);
  if (!c) return { status: "ALREADY_DECIDED", decision: null, requestId, reason: "no open request — already decided or never pending" };
  if (c.run_status !== "WAITING_FOR_APPROVAL")
    return { status: "NOT_PENDING", decision: null, requestId, reason: `run is ${c.run_status}` };

  // Self-approval: a request and its decision must come from different governed actors.
  if (c.requested_by_actor_id === decider.governedActorId)
    return { status: "REFUSED", decision: null, requestId, reason: "a governed actor cannot decide its own request" };

  // The decision is itself governed: eligibility, permission, principal match, live grant.
  const gate = await dispatchSkill(db, DECIDE_SKILL, decider.actor, {
    pursuitId: c.pursuit_id, args: { requestId, decision }, governedActorId: decider.governedActorId,
    runStepId: c.run_step_id, dataEnvironment: c.data_environment,
    // NO idempotency key, deliberately. A governance evaluation must be FRESH every attempt: if an
    // approver is refused for insufficient permission and an admin then grants it, the retry has to
    // be re-evaluated, not handed the cached refusal. Keying this dispatch would make a refusal
    // stale-by-construction — found by the hosted gate, where a suspended-decider attempt replayed
    // an earlier wrong-principal refusal.
    //
    // Nothing is lost: duplicate EFFECTS are prevented by `pursuit_run_approvals_one_terminal`,
    // which is the designated race arbiter, plus the compare-and-set transition and step
    // idempotency behind it. Dispatch idempotency was never load-bearing here.
  });
  if (gate.status !== "EXECUTED")
    return { status: "REFUSED", decision: null, requestId, reason: gate.reason ?? gate.status };

  // Stale authority — checked for BOTH outcomes. Approving something that can no longer execute
  // would be meaningless; rejecting it is redundant once it is already void.
  const lapsed = await staleAuthority(db, orgId, c);
  if (lapsed) { await invalidateApproval(db, orgId, c, lapsed);
    return { status: "INVALIDATED", decision: "INVALIDATED", requestId, reason: lapsed }; }

  // THE RACE ARBITER. `pursuit_run_approvals_one_terminal` permits one terminal row per request.
  const { rows: won } = await db.query<{ id: string }>(
    `insert into pursuit_run_approvals
       (org_id, pursuit_id, plan_revision_id, run_id, run_step_id, skill_id, skill_version,
        decision, request_id, decided_by_actor_id, decided_by_principal, reason, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict do nothing returning id`,
    [orgId, c.pursuit_id, c.plan_revision_id, c.run_id, c.run_step_id, c.skill_id, c.skill_version,
     decision, requestId, decider.governedActorId, decider.principal, reason ?? null, c.data_environment]);
  if (!won[0]) return { status: "ALREADY_DECIDED", decision: null, requestId, reason: "another decision won this request" };

  // THE RUNTIME ARBITER. Conditional on the state we validated, so the transition cannot double-fire.
  if (decision === "APPROVED") {
    const step = await db.query(
      `update pursuit_run_steps set status = 'READY', updated_at = now()
        where id = $1 and org_id = $2 and status = 'WAITING_FOR_APPROVAL'`, [c.run_step_id, orgId]);
    const run = await db.query(
      `update pursuit_runs set status = 'READY', reason = null, last_transition_at = now(), updated_at = now(),
              continuation = continuation || jsonb_build_object('approvedRequestId', $3::text)
        where id = $1 and org_id = $2 and status = 'WAITING_FOR_APPROVAL'`, [c.run_id, orgId, requestId]);
    // A durable APPROVED decision must never leave the run stranded. Same transaction, so throwing
    // rolls the decision back with it rather than committing a half-applied approval.
    if (run.rowCount !== 1 || step.rowCount !== 1)
      throw new Error("approval could not transition the run out of WAITING_FOR_APPROVAL — rolling back the decision");
    await approvalLedger(db, orgId, c.pursuit_id, c.run_id, c.run_step_id, "APPROVAL_GRANTED",
      { actorId: decider.principal, governedActorId: decider.governedActorId, env: c.data_environment,
        reason: reason ?? "approved", before: { status: "WAITING_FOR_APPROVAL" },
        after: { status: "READY", decision: "APPROVED", requestId, decidedBy: decider.governedActorId } });
    return { status: "DECIDED", decision: "APPROVED", requestId, reason: null };
  }

  // REJECTED — terminal for this pending action. The run is CANCELLED with an explicit durable
  // reason that is NOT the policy-refusal vocabulary (owner ruling 2).
  await db.query(
    `update pursuit_run_steps set status = 'CANCELLED', ended_at = now(), updated_at = now()
      where id = $1 and org_id = $2 and status = 'WAITING_FOR_APPROVAL'`, [c.run_step_id, orgId]);
  const run = await db.query(
    `update pursuit_runs set status = 'CANCELLED', reason = 'APPROVAL_REJECTED', last_transition_at = now(), updated_at = now()
      where id = $1 and org_id = $2 and status = 'WAITING_FOR_APPROVAL'`, [c.run_id, orgId]);
  if (run.rowCount !== 1) throw new Error("rejection could not transition the run — rolling back the decision");
  await approvalLedger(db, orgId, c.pursuit_id, c.run_id, c.run_step_id, "APPROVAL_REJECTED",
    { actorId: decider.principal, governedActorId: decider.governedActorId, env: c.data_environment,
      reason: reason ?? "rejected", before: { status: "WAITING_FOR_APPROVAL" },
      after: { status: "CANCELLED", reason: "APPROVAL_REJECTED", requestId, decidedBy: decider.governedActorId } });
  return { status: "DECIDED", decision: "REJECTED", requestId, reason: "APPROVAL_REJECTED" };
}

/**
 * The Approvals read model. Only genuinely open requests — a request with ANY terminal row
 * (including INVALIDATED) is not pending and must never be offered for decision.
 */
export async function pendingApprovals(db: PoolClient, orgId: string, limit = 50): Promise<PendingApproval[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select a.id request_id, a.org_id::text org_id, a.pursuit_id::text pursuit_id, a.run_id::text run_id,
            a.run_step_id::text run_step_id, a.plan_revision_id::text plan_revision_id,
            a.skill_id, a.skill_version, a.requested_by_actor_id::text requested_by_actor_id,
            a.created_at, a.reason why, c.legal_name account,
            rv.content->'nextAction'->>'text' action_text
       from pursuit_run_approvals a
       join pursuit_runs r on r.id = a.run_id and r.org_id = a.org_id
       join pursuits p on p.id = a.pursuit_id
       left join companies c on c.id = p.account_id
       join pursuit_plan_revisions rv on rv.id = a.plan_revision_id
      where a.org_id = $1 and a.decision = 'REQUESTED'
        and r.status = 'WAITING_FOR_APPROVAL'
        and not exists (select 1 from pursuit_run_approvals t where t.request_id = a.id)
      order by a.created_at asc, a.id asc
      limit $2`, [orgId, limit]);
  return rows.map((r) => ({
    requestId: String(r.request_id), orgId: String(r.org_id), pursuitId: String(r.pursuit_id),
    runId: String(r.run_id), runStepId: String(r.run_step_id), planRevisionId: String(r.plan_revision_id),
    skillId: String(r.skill_id), skillVersion: Number(r.skill_version),
    requestedByActorId: String(r.requested_by_actor_id),
    requestedAt: (r.created_at as Date).toISOString(),
    account: (r.account as string) ?? null, actionText: (r.action_text as string) ?? null,
    whyRequired: (r.why as string) ?? "this capability requires a human decision",
  }));
}
