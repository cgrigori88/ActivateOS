import type { PoolClient } from "pg";
import { recordChange, type ChangeType, type ActorType, type TriggerType } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Fact lifecycle (Workstream B, §6/§7/§15). Durable states only — CANDIDATE lives in
 * fact_candidates, never here. States stay DISTINCT (never collapsed into one "inactive"):
 * STALE (freshness lapsed) ≠ SUPERSEDED (a newer fact replaced it) ≠ DISPUTED (credible
 * contradiction) ≠ EXPIRED (past validity) ≠ REJECTED (withdrawn). transitionFact is the
 * ONLY sanctioned status path: it locks the row, validates, writes, and appends a ledger
 * event. Nothing is hard-deleted — history stays reconstructable.
 */

export const FACT_STATUSES = ["CURRENT", "DISPUTED", "STALE", "SUPERSEDED", "EXPIRED", "REJECTED"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const TERMINAL_FACT_STATUSES: FactStatus[] = ["SUPERSEDED", "EXPIRED", "REJECTED"];

export const ALLOWED_FACT_TRANSITIONS: Record<FactStatus, FactStatus[]> = {
  CURRENT: ["DISPUTED", "STALE", "SUPERSEDED", "EXPIRED", "REJECTED"],
  DISPUTED: ["CURRENT", "SUPERSEDED", "REJECTED"],
  STALE: ["CURRENT", "SUPERSEDED", "EXPIRED", "REJECTED"],
  SUPERSEDED: [],
  EXPIRED: [],
  REJECTED: [],
};

const STATUS_TO_CHANGE: Record<FactStatus, ChangeType> = {
  CURRENT: "FACT_CONFIDENCE_CHANGED",
  DISPUTED: "FACT_DISPUTED",
  STALE: "FACT_STALE",
  SUPERSEDED: "FACT_SUPERSEDED",
  EXPIRED: "FACT_EXPIRED",
  REJECTED: "FACT_REJECTED",
};

export class IllegalFactTransition extends Error {
  constructor(from: string, to: string) {
    super(`Illegal fact transition: ${from} → ${to}`);
    this.name = "IllegalFactTransition";
  }
}

export function canTransitionFact(from: FactStatus, to: FactStatus): boolean {
  return ALLOWED_FACT_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface FactTransitionContext {
  reason?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
  triggerType?: TriggerType | null;
  supersededBy?: string | null;   // when to === SUPERSEDED
}

export interface FactTransitionResult { changed: boolean; from: FactStatus; to: FactStatus; }

export async function transitionFact(
  db: PoolClient, factId: string, to: FactStatus, ctx: FactTransitionContext = {},
): Promise<FactTransitionResult> {
  const locked = await db.query<{ org_id: string; company_id: string | null; status: FactStatus; data_environment: DataEnvironment }>(
    `select org_id, company_id, status, data_environment from facts where id = $1 for update`, [factId],
  );
  if (!locked.rows[0]) throw new Error(`Fact ${factId} not found`);
  const { org_id: orgId, status: from, data_environment: env } = locked.rows[0];
  if (from === to) return { changed: false, from, to };
  if (!canTransitionFact(from, to)) throw new IllegalFactTransition(from, to);

  await db.query(
    `update facts set status = $2, superseded_by = coalesce($3, superseded_by),
            last_material_change_at = now(), updated_at = now() where id = $1`,
    [factId, to, ctx.supersededBy ?? null],
  );

  await recordChange(db, {
    orgId, pursuitId: null, entityType: "fact", entityId: factId,
    changeType: STATUS_TO_CHANGE[to],
    materiality: TERMINAL_FACT_STATUSES.includes(to) || to === "DISPUTED" ? "HIGH" : "MEDIUM",
    reason: ctx.reason ?? `Fact ${from} → ${to}`,
    actorType: ctx.actorType ?? "SYSTEM", actorId: ctx.actorId ?? null,
    triggerType: ctx.triggerType ?? "MODEL_RECALCULATION", dataEnvironment: env,
    before: { status: from }, after: { status: to },
  });
  return { changed: true, from, to };
}
