import type { PoolClient } from "pg";
import { pursuitDedupKey, normalizeUseCase, type PursuitIdentity } from "./dedup";
import type { DataEnvironment, DataLineage } from "./lineage";
import { recordChange } from "./ledger";

/**
 * Pursuit creation/update (Workstream A, §20 / §K). Idempotent and concurrency-safe:
 * the same underlying trigger processed twice must not create duplicate LIVE pursuits.
 * Returns a result MODE rather than blindly inserting.
 */

export const PURSUIT_TYPES = [
  "NET_NEW", "CROSS_SELL", "UPSELL", "RENEWAL_ATTACH", "EXPANSION",
  "COMPETITIVE_DISPLACEMENT", "MIGRATION", "WIN_BACK", "CONSOLIDATION",
  "MODERNIZATION", "OTHER", "UNCLASSIFIED",
] as const;
export type PursuitType = (typeof PURSUIT_TYPES)[number];

export type UpsertMode = "CREATED" | "MATCHED_EXISTING" | "REACTIVATED";

export interface UpsertPursuitInput extends PursuitIdentity {
  pursuitType: PursuitType;
  pursuitTypeSource?: string | null;
  pursuitTypeConfidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  businessProblem?: string | null;
  strategicInitiative?: string | null;
  createdByActorType?: "system" | "agent" | "human" | "import" | "api";
  createdByActorId?: string | null;
  createdVia?:
    | "SYSTEM_DETECTED" | "USER_CREATED" | "MOTION_MIGRATION" | "OPPORTUNITY_MIGRATION"
    | "IMPORT" | "API" | "AGENT_PROPOSED" | "PARTNER_PROPOSED";
  originatingMotionId?: string | null;
  originatingSignalId?: string | null;
  originatingEvidenceId?: string | null;
  originatingAgentRunId?: string | null;
  dataEnvironment?: DataEnvironment;
  dataLineage?: DataLineage | null;
  isSimulated?: boolean;
  /** When the matched pursuit is DORMANT, reactivate it (else leave as-is). */
  reactivateDormant?: boolean;
}

export interface UpsertResult {
  id: string;
  mode: UpsertMode;
  dedupKey: string;
}

const LIVE_PREDICATE = `status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null`;

/**
 * Insert-or-match a Pursuit by its deterministic thesis identity. Assumes it runs
 * inside a withTenant/withTenantOrg transaction (the caller owns the txn + org GUC).
 */
export async function upsertPursuit(db: PoolClient, input: UpsertPursuitInput): Promise<UpsertResult> {
  const dedupKey = pursuitDedupKey(input);
  const useCase = normalizeUseCase(input.useCase) || null;

  // Concurrency-safe create: ON CONFLICT against the partial unique index (live rows).
  // A concurrent duplicate loses the race and returns no row → we then match.
  const ins = await db.query<{ id: string }>(
    `insert into pursuits (
       org_id, account_id, product_id, product_category_id, pursuit_type,
       pursuit_type_source, pursuit_type_confidence, use_case, business_problem,
       strategic_initiative, dedup_key, created_by_actor_type, created_by_actor_id,
       created_via, originating_motion_id, originating_signal_id, originating_evidence_id,
       originating_agent_run_id, data_environment, data_lineage, is_simulated
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     on conflict (org_id, dedup_key) where (${LIVE_PREDICATE})
     do nothing
     returning id`,
    [
      input.orgId, input.accountId, input.productId ?? null, input.productCategoryId ?? null,
      input.pursuitType, input.pursuitTypeSource ?? null, input.pursuitTypeConfidence ?? null,
      useCase, input.businessProblem ?? null, input.strategicInitiative ?? null, dedupKey,
      input.createdByActorType ?? "system", input.createdByActorId ?? null,
      input.createdVia ?? "SYSTEM_DETECTED", input.originatingMotionId ?? null,
      input.originatingSignalId ?? null, input.originatingEvidenceId ?? null,
      input.originatingAgentRunId ?? null, input.dataEnvironment ?? "PRODUCTION",
      input.dataLineage ?? null, input.isSimulated ?? false,
    ],
  );

  if (ins.rows[0]) {
    const id = ins.rows[0].id;
    // §40: migrated pursuits get one PURSUIT_MIGRATED bootstrap event, not per-field noise.
    const isMigration = (input.createdVia ?? "").includes("MIGRATION");
    await recordChange(db, {
      orgId: input.orgId,
      pursuitId: id,
      entityType: "pursuit",
      entityId: id,
      changeType: isMigration ? "PURSUIT_MIGRATED" : "PURSUIT_CREATED",
      materiality: "HIGH",
      reason: isMigration
        ? `Created from legacy ${input.createdVia === "OPPORTUNITY_MIGRATION" ? "opportunity" : "revenue motion"} during Pursuit transformation`
        : `Pursuit detected (${input.createdVia ?? "SYSTEM_DETECTED"})`,
      actorType: input.createdByActorType === "human" ? "USER" : isMigration ? "IMPORT" : "SYSTEM",
      actorId: input.createdByActorId ?? null,
      triggerType: isMigration ? "MIGRATION" : "MANUAL",
      dataEnvironment: input.dataEnvironment ?? "PRODUCTION",
      after: { dedupKey, pursuitType: input.pursuitType },
    });
    return { id, mode: "CREATED", dedupKey };
  }

  // Conflict → a live pursuit already owns this thesis. Match it.
  const existing = await db.query<{ id: string; status: string }>(
    `select id, status from pursuits
      where org_id = $1 and dedup_key = $2 and ${LIVE_PREDICATE}
      limit 1`,
    [input.orgId, dedupKey],
  );
  const row = existing.rows[0];
  if (!row) {
    // Extremely rare: the conflicting row transitioned to terminal between insert and
    // select. Retry once as a fresh create.
    return upsertPursuit(db, input);
  }

  if (row.status === "DORMANT" && input.reactivateDormant) {
    await db.query(`update pursuits set status = 'RESEARCHING', last_material_change_at = now(), updated_at = now() where id = $1`, [row.id]);
    await recordChange(db, {
      orgId: input.orgId, pursuitId: row.id, entityType: "pursuit", entityId: row.id,
      changeType: "STATUS_CHANGED", materiality: "MEDIUM", reason: "Reactivated by new trigger",
      actorType: "SYSTEM", triggerType: "MANUAL", dataEnvironment: input.dataEnvironment ?? "PRODUCTION",
      before: { status: "DORMANT" }, after: { status: "RESEARCHING" },
    });
    return { id: row.id, mode: "REACTIVATED", dedupKey };
  }

  await db.query(`update pursuits set updated_at = now() where id = $1`, [row.id]);
  return { id: row.id, mode: "MATCHED_EXISTING", dedupKey };
}

export interface PursuitRow {
  id: string;
  org_id: string;
  account_id: string;
  product_id: string | null;
  product_category_id: string | null;
  pursuit_type: string;
  status: string;
  dedup_key: string;
  current_score_snapshot_id: string | null;
  data_environment: string;
  [k: string]: unknown;
}

export async function getPursuit(db: PoolClient, id: string): Promise<PursuitRow | null> {
  const { rows } = await db.query<PursuitRow>(`select * from pursuits where id = $1`, [id]);
  return rows[0] ?? null;
}
