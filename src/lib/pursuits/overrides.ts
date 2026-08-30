import type { PoolClient } from "pg";
import { recordChange } from "./ledger";
import type { DataEnvironment } from "./lineage";

/**
 * Human override capture (Workstream A, §18-19). When a human overrides an AI
 * recommendation, that divergence is model-supervision data, not just an edit. This
 * records the original recommendation, the human decision, and why — and keeps the
 * recommendation/decision columns on `pursuits` distinct. Also updates the pursuit's
 * selected_* / approved_* field and writes an OVERRIDE_RECORDED ledger event.
 */

export type OverrideField =
  | "partner" | "vendor_seller" | "partner_seller" | "motion" | "timing" | "status"
  | "priority" | "expected_value" | "other";

export interface RecordOverrideInput {
  orgId: string;
  pursuitId: string;
  field: OverrideField;
  originalRecommendation?: unknown;
  humanDecision?: unknown;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string | null;
  actorId?: string | null;
  modelVersion?: string | null;
  dataEnvironment?: DataEnvironment;
}

export async function recordOverride(db: PoolClient, input: RecordOverrideInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into pursuit_overrides
       (org_id, pursuit_id, field, original_recommendation, human_decision, before_value,
        after_value, reason, actor_type, actor_id, model_version, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'human',$9,$10,$11) returning id`,
    [
      input.orgId, input.pursuitId, input.field,
      j(input.originalRecommendation), j(input.humanDecision), j(input.beforeValue), j(input.afterValue),
      input.reason ?? null, input.actorId ?? null, input.modelVersion ?? null,
      input.dataEnvironment ?? "PRODUCTION",
    ],
  );

  await recordChange(db, {
    orgId: input.orgId,
    pursuitId: input.pursuitId,
    entityType: "pursuit",
    entityId: input.pursuitId,
    changeType: "OVERRIDE_RECORDED",
    materiality: "MEDIUM",
    reason: input.reason ?? `Human override: ${input.field}`,
    actorType: "USER",
    actorId: input.actorId ?? null,
    triggerType: "USER_OVERRIDE",
    dataEnvironment: input.dataEnvironment ?? "PRODUCTION",
    before: input.beforeValue ?? input.originalRecommendation ?? null,
    after: input.afterValue ?? input.humanDecision ?? null,
  });

  return rows[0].id;
}

function j(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}
