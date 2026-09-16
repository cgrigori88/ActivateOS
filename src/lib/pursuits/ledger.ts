import type { PoolClient } from "pg";
import type { Materiality } from "./materiality";
import type { DataEnvironment } from "./lineage";

/**
 * Universal, append-only Change Ledger (Workstream A, §13-14). A core product
 * primitive powering What Changed?, Today, agent reasoning, audit, learning, and
 * state reconstruction — NOT merely an audit table. Actor (who) is distinct from
 * trigger (cause). Append-only: never updated or deleted in the app path.
 */

export type ChangeType =
  | "PURSUIT_CREATED" | "PURSUIT_MIGRATED" | "STATUS_CHANGED" | "SCORE_CHANGED"
  | "TIMING_CHANGED" | "FACT_PROMOTED" | "FACT_SUPERSEDED" | "CONTRADICTION_DETECTED"
  | "PARTNER_ROUTE_CHANGED" | "SELLER_ROUTE_CHANGED" | "TEAM_CHANGED" | "MOTION_CHANGED"
  | "ACTION_CREATED" | "ACTION_COMPLETED" | "CUSTOMER_ENGAGED" | "OPPORTUNITY_LINKED"
  | "OUTCOME_RECORDED" | "PURSUIT_MERGED" | "PURSUIT_SPLIT" | "OVERRIDE_RECORDED"
  | "EXPECTED_VALUE_CHANGED"
  // Workstream B — Facts / Intelligence (§26)
  | "FACT_CANDIDATE_CREATED" | "FACT_CONFIDENCE_CHANGED" | "FACT_DISPUTED" | "FACT_STALE"
  | "FACT_EXPIRED" | "FACT_REJECTED" | "FACT_LINKED_TO_PURSUIT" | "CONVERGENCE_CHANGED"
  | "WHY_NOW_CHANGED"
  // Workstream C — Routing / Ecosystem Decisioning (§13/§18/§51)
  | "ROUTE_RECOMMENDATION_CHANGED" | "PARTNER_SELECTED" | "PARTNER_OVERRIDE"
  | "SELLER_RECOMMENDATION_CHANGED" | "SELLER_ASSIGNED" | "PARTNER_DECLINED"
  | "ROUTE_OUTCOME_RECORDED" | "TEAM_MEMBER_INVITED" | "TEAM_MEMBER_ACCEPTED"
  | "TEAM_MEMBER_DECLINED" | "ENTITY_RESOLUTION_REVIEW" | "TRANSACTION_SIGNAL_INGESTED"
  // Workstream E — Federation / governed execution / outcome loop (0084)
  | "FACT_ACCEPTED" | "ROUTE_SELECTED" | "PARTICIPANT_INVITED" | "PARTICIPANT_JOINED"
  | "PARTICIPANT_LEFT" | "PARTICIPANT_DECLINED" | "PARTICIPANT_REVOKED" | "ACCESS_GRANTED"
  | "ACCESS_REVOKED" | "TEAM_MEMBER_ASSIGNED" | "INTRO_REQUESTED" | "INTRO_ACCEPTED"
  | "OUTREACH_SENT" | "REPLY_RECEIVED" | "MEETING_BOOKED" | "OPPORTUNITY_CREATED"
  | "STAGE_CHANGED" | "PURSUIT_WON" | "PURSUIT_LOST" | "PURSUIT_DORMANT" | "READINESS_CHANGED"
  | "ACTION_INVOKED" | "ACTION_EXECUTED" | "CONTRIBUTION_ADDED" | "CONTRIBUTION_REVOKED"
  // Intelligence Wave P1C — governed stakeholder role assertions (append-only history)
  | "STAKEHOLDER_ROLE_ASSERTED"
  // vNext Slice 2A — Pursuit Coordination (0103). Human plan decisions and system-detected review
  // triggers only; a system recommendation is a proposal and lives in pursuit_plan_revisions.
  | "PLAN_DECIDED" | "PLAN_REVIEW_REQUIRED" | "GOAL_REPLACED"
  // P45-1 governed runtime (0109). A run transition is a change to the pursuit's execution state,
  // so it belongs in the universal ledger rather than a parallel runtime log.
  | "RUN_STARTED" | "RUN_PAUSED" | "RUN_RESUMED" | "RUN_COMPLETED" | "RUN_FAILED"
  | "RUN_BLOCKED" | "RUN_CANCELLED";

export type ActorType = "USER" | "AGENT" | "WORKER" | "SYSTEM" | "IMPORT" | "API";
export type TriggerType =
  | "EVIDENCE_VERIFIED" | "FACT_PROMOTED" | "INTERACTION_RECEIVED" | "SCHEDULED_REFRESH"
  | "USER_OVERRIDE" | "CRM_SYNC" | "PARTNER_DECISION" | "MODEL_RECALCULATION"
  | "MIGRATION" | "MANUAL" | "CONTRADICTION" | "EVENT_TRIGGERED" | "GOVERNED_ACTION";

export interface ChangeEvent {
  orgId: string;
  pursuitId?: string | null;
  entityType: string;
  entityId?: string | null;
  changeType: ChangeType;
  before?: unknown;
  after?: unknown;
  materiality?: Materiality;
  reason?: string | null;
  actorType?: ActorType | null;
  actorId?: string | null;
  triggerType?: TriggerType | null;
  triggerId?: string | null;
  modelVersion?: string | null;
  agentRunId?: string | null;
  dataEnvironment?: DataEnvironment;
  occurredAt?: Date;
  /**
   * P45-1 governed-runtime linkage (migration 0109), all optional and all written IN THE INSERT.
   *
   * WHY THEY LIVE HERE AND NOT IN A FOLLOW-UP UPDATE. `change_ledger` is APPEND-ONLY: `app_rw`
   * holds INSERT and SELECT and nothing else, deliberately, so that history is corrected by
   * appending rather than by rewriting. The runtime's first implementation inserted the row and
   * then UPDATEd it to attach this linkage, which works as the owner and is refused as `app_rw`
   * ("permission denied for table change_ledger", SQLSTATE 42501) — so no run could complete under
   * the real runtime identity. Defect P45-D1, found by the hosted functional gate.
   *
   * The fix is to carry the linkage into the original INSERT. The append-only invariant is
   * therefore strengthened, not relaxed: no caller needs UPDATE on this table, and none has it.
   */
  runId?: string | null;
  runStepId?: string | null;
  invocationId?: string | null;
  governedActorId?: string | null;
}

/** Append one change event. Assumes an open withTenant transaction. */
export async function recordChange(db: PoolClient, e: ChangeEvent): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into change_ledger (
       org_id, pursuit_id, entity_type, entity_id, change_type, before_state, after_state,
       materiality, reason, actor_type, actor_id, trigger_type, trigger_id, model_version,
       agent_run_id, data_environment, occurred_at,
       run_id, run_step_id, invocation_id, governed_actor_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, coalesce($17, now()),
       $18,$19,$20,$21)
     returning id`,
    [
      e.orgId, e.pursuitId ?? null, e.entityType, e.entityId ?? null, e.changeType,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      e.materiality ?? "MEDIUM", e.reason ?? null, e.actorType ?? "SYSTEM", e.actorId ?? null,
      e.triggerType ?? null, e.triggerId ?? null, e.modelVersion ?? null, e.agentRunId ?? null,
      e.dataEnvironment ?? "PRODUCTION", e.occurredAt ?? null,
      // Absent for every pre-existing caller, which is exactly the pre-P45 behaviour.
      e.runId ?? null, e.runStepId ?? null, e.invocationId ?? null, e.governedActorId ?? null,
    ],
  );
  return rows[0].id;
}
