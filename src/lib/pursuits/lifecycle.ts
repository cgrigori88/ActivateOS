import type { PoolClient } from "pg";
import { recordChange, type ActorType, type TriggerType } from "./ledger";
import type { DataEnvironment } from "./lineage";

/**
 * Pursuit lifecycle (Workstream A, §11 / §22-23). ALL status changes go through the
 * single service `transitionPursuit`; no UI or agent sets `pursuits.status` directly.
 * The transition map is DATA and permits non-linear reality (regress on contradiction,
 * reactivate from DORMANT, re-route, etc.). DORMANT is LIVE (reactivatable), not
 * terminal. Concurrency: the row is locked FOR UPDATE inside the caller's txn.
 */

export const PURSUIT_STATUSES = [
  "DETECTED", "RESEARCHING", "REVIEW_REQUIRED", "QUALIFIED", "ROUTED", "MOTION_DESIGNED",
  "READY_TO_ACTIVATE", "ACTIVATING", "ACTIVE", "CUSTOMER_ENGAGED", "OPPORTUNITY_CREATED",
  "WON", "LOST", "DORMANT", "DISQUALIFIED",
] as const;
export type PursuitStatus = (typeof PURSUIT_STATUSES)[number];

/** Terminal states have no outbound transitions. DORMANT is deliberately NOT terminal. */
export const TERMINAL_STATUSES: PursuitStatus[] = ["WON", "LOST", "DISQUALIFIED"];
export const LIVE_STATUSES: PursuitStatus[] = PURSUIT_STATUSES.filter(
  (s) => !TERMINAL_STATUSES.includes(s),
);

export const ALLOWED_TRANSITIONS: Record<PursuitStatus, PursuitStatus[]> = {
  DETECTED: ["RESEARCHING", "DISQUALIFIED", "DORMANT"],
  RESEARCHING: ["REVIEW_REQUIRED", "QUALIFIED", "DISQUALIFIED", "DORMANT"],
  REVIEW_REQUIRED: ["QUALIFIED", "RESEARCHING", "ROUTED", "DISQUALIFIED", "DORMANT"],
  QUALIFIED: ["ROUTED", "REVIEW_REQUIRED", "DISQUALIFIED", "DORMANT"],
  ROUTED: ["MOTION_DESIGNED", "QUALIFIED", "REVIEW_REQUIRED", "DISQUALIFIED", "DORMANT"],
  MOTION_DESIGNED: ["READY_TO_ACTIVATE", "ROUTED", "REVIEW_REQUIRED", "DISQUALIFIED", "DORMANT"],
  READY_TO_ACTIVATE: ["ACTIVATING", "MOTION_DESIGNED", "REVIEW_REQUIRED", "DISQUALIFIED", "DORMANT"],
  ACTIVATING: ["ACTIVE", "READY_TO_ACTIVATE", "REVIEW_REQUIRED", "DISQUALIFIED", "DORMANT"],
  ACTIVE: ["CUSTOMER_ENGAGED", "REVIEW_REQUIRED", "LOST", "DISQUALIFIED", "DORMANT"],
  CUSTOMER_ENGAGED: ["OPPORTUNITY_CREATED", "ACTIVE", "REVIEW_REQUIRED", "LOST", "DISQUALIFIED", "DORMANT"],
  OPPORTUNITY_CREATED: ["WON", "LOST", "CUSTOMER_ENGAGED", "REVIEW_REQUIRED", "DORMANT"],
  DORMANT: ["RESEARCHING", "QUALIFIED", "DISQUALIFIED"],
  WON: [],
  LOST: [],
  DISQUALIFIED: [],
};

export class IllegalPursuitTransition extends Error {
  constructor(from: string, to: string) {
    super(`Illegal pursuit transition: ${from} → ${to}`);
    this.name = "IllegalPursuitTransition";
  }
}

export function canTransition(from: PursuitStatus, to: PursuitStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionContext {
  reason?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
  triggerType?: TriggerType | null;
  triggerId?: string | null;
  agentRunId?: string | null;
}

export interface TransitionResult {
  changed: boolean;
  from: PursuitStatus;
  to: PursuitStatus;
}

/**
 * The ONLY sanctioned way to change a Pursuit's status. Locks the row, validates the
 * transition, writes it, and records a STATUS_CHANGED ledger event. Idempotent for a
 * no-op (to === current). Assumes an open withTenant/withTenantOrg transaction.
 */
export async function transitionPursuit(
  db: PoolClient,
  pursuitId: string,
  to: PursuitStatus,
  ctx: TransitionContext = {},
): Promise<TransitionResult> {
  const locked = await db.query<{ org_id: string; status: PursuitStatus; data_environment: DataEnvironment }>(
    `select org_id, status, data_environment from pursuits where id = $1 for update`,
    [pursuitId],
  );
  const cur = locked.rows[0];
  if (!cur) throw new Error(`Pursuit ${pursuitId} not found`);
  const from = cur.status;

  if (from === to) return { changed: false, from, to };
  if (!canTransition(from, to)) throw new IllegalPursuitTransition(from, to);

  await db.query(
    `update pursuits set status = $2, last_material_change_at = now(), updated_at = now() where id = $1`,
    [pursuitId, to],
  );

  await recordChange(db, {
    orgId: cur.org_id,
    pursuitId,
    entityType: "pursuit",
    entityId: pursuitId,
    changeType: "STATUS_CHANGED",
    materiality: TERMINAL_STATUSES.includes(to) ? "HIGH" : "MEDIUM",
    reason: ctx.reason ?? `${from} → ${to}`,
    actorType: ctx.actorType ?? "SYSTEM",
    actorId: ctx.actorId ?? null,
    triggerType: ctx.triggerType ?? "MANUAL",
    triggerId: ctx.triggerId ?? null,
    agentRunId: ctx.agentRunId ?? null,
    dataEnvironment: cur.data_environment,
    before: { status: from },
    after: { status: to },
  });

  return { changed: true, from, to };
}
