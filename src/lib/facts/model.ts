import type { PoolClient } from "pg";
import { factIdentityKey, factValueKey, type FactSubject, type NormalizedObject } from "./identity";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment, DataLineage } from "../pursuits/lineage";
import type { FreshnessPolicy } from "./predicates";

/**
 * Durable Fact create/upsert (Workstream B, §7/§8/§14/§15). The ONLY writer of durable
 * `facts` rows. Enforces the two invariants of the identity split:
 *   - one CURRENT fact per semantic SLOT (fact_identity_key) — a new, different value in an
 *     occupied slot SUPERSEDES the incumbent (append-only; the old row is preserved);
 *   - identical values (fact_value_key) are idempotent — re-observation re-confirms, never
 *     duplicates.
 * Assumes an open withTenant/withTenantOrg transaction; the caller owns the txn + org GUC.
 * The heavy pipeline already serializes recompute under a Postgres advisory lock.
 */

export type UpsertFactMode = "CREATED" | "MATCHED" | "SUPERSEDED_PRIOR";

export interface UpsertFactInput {
  orgId: string;
  subject: FactSubject;
  companyId?: string | null;
  predicateKey: string;
  object: NormalizedObject;
  polarity?: 1 | -1;
  confidence: number;
  confidenceModelVersion?: string | null;
  provenanceClass: string;
  originKind: "EVIDENCE_PROMOTION" | "SIGNAL_PROMOTION" | "CONVERGENCE" | "HUMAN" | "IMPORT" | "AGENT_PROPOSED";
  family?: string | null;
  freshnessPolicy?: FreshnessPolicy;
  halfLifeDays?: number | null;
  asOf: Date;
  validFrom?: Date | null;
  validUntil?: Date | null;
  occurredAt?: Date | null;
  observedAt: Date;
  createdByActorType?: "system" | "agent" | "human" | "import" | "api";
  createdByActorId?: string | null;
  createdVia?: string;
  dataEnvironment?: DataEnvironment;
  dataLineage?: DataLineage | null;
  isSimulated?: boolean;
}

export interface UpsertFactResult { id: string; mode: UpsertFactMode; identityKey: string; valueKey: string; }

const ACTIVE = `status in ('CURRENT','DISPUTED','STALE') and superseded_by is null`;

export async function upsertFact(db: PoolClient, input: UpsertFactInput): Promise<UpsertFactResult> {
  const identityKey = factIdentityKey(input.orgId, input.subject, input.predicateKey);
  const valueKey = factValueKey(input.orgId, input.subject, input.predicateKey, input.object);

  // 1) Idempotent value match — same proposition already live. Re-confirm, do not duplicate.
  const same = await db.query<{ id: string; status: string; confidence: string; observed_last_at: Date }>(
    `select id, status, confidence, observed_last_at from facts
      where org_id = $1 and fact_value_key = $2 and ${ACTIVE} limit 1 for update`,
    [input.orgId, valueKey],
  );
  if (same.rows[0]) {
    const row = same.rows[0];
    const newObserved = input.observedAt > row.observed_last_at ? input.observedAt : row.observed_last_at;
    await db.query(
      `update facts set last_confirmed_at = now(), observed_last_at = $2,
              confidence = greatest(confidence, $3),
              status = case when status = 'STALE' then 'CURRENT' else status end,
              updated_at = now() where id = $1`,
      [row.id, newObserved, input.confidence],
    );
    return { id: row.id, mode: "MATCHED", identityKey, valueKey };
  }

  // 2) Slot occupied by a different CURRENT value → supersede the incumbent (append-only).
  const incumbent = await db.query<{ id: string }>(
    `select id from facts where org_id = $1 and fact_identity_key = $2 and status = 'CURRENT' limit 1 for update`,
    [input.orgId, identityKey],
  );
  let supersedesId: string | null = null;
  if (incumbent.rows[0]) {
    supersedesId = incumbent.rows[0].id;
    await db.query(`update facts set status = 'SUPERSEDED', last_material_change_at = now(), updated_at = now() where id = $1`, [supersedesId]);
  }

  // 3) Insert the new durable Fact.
  const ins = await db.query<{ id: string }>(
    `insert into facts (
       org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
       object_type, object_value, date_value, number_value, text_value, boolean_value, entity_ref,
       money_amount, money_currency, polarity, status, confidence, confidence_model_version,
       provenance_class, origin_kind, as_of, valid_from, valid_until, occurred_at, observed_at,
       first_confirmed_at, last_confirmed_at, half_life_days, freshness_policy, family, supersedes,
       fact_identity_key, fact_value_key, data_environment, data_lineage, is_simulated,
       created_by_actor_type, created_by_actor_id, created_via
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'CURRENT',$17,$18,$19,$20,
       $21,$22,$23,$24,$25, now(), now(), $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
     returning id`,
    [
      input.orgId, input.subject.subjectScope, input.subject.subjectRef ?? null, input.subject.subjectLabel,
      input.companyId ?? null, input.predicateKey, input.object.objectType, input.object.objectValue,
      input.object.dateValue ?? null, input.object.numberValue ?? null, input.object.textValue ?? null,
      input.object.booleanValue ?? null, input.object.entityRef ?? null, input.object.moneyAmount ?? null,
      input.object.moneyCurrency ?? null, input.polarity ?? 1, input.confidence, input.confidenceModelVersion ?? null,
      input.provenanceClass, input.originKind, input.asOf, input.validFrom ?? null, input.validUntil ?? null,
      input.occurredAt ?? null, input.observedAt, input.halfLifeDays ?? null, input.freshnessPolicy ?? "DECAYING",
      input.family ?? null, supersedesId, identityKey, valueKey, input.dataEnvironment ?? "PRODUCTION",
      input.dataLineage ?? null, input.isSimulated ?? false, input.createdByActorType ?? "system",
      input.createdByActorId ?? null, input.createdVia ?? null,
    ],
  );
  const id = ins.rows[0].id;

  if (supersedesId) {
    await db.query(`update facts set superseded_by = $2 where id = $1`, [supersedesId, id]);
    await recordChange(db, {
      orgId: input.orgId, pursuitId: null, entityType: "fact", entityId: supersedesId,
      changeType: "FACT_SUPERSEDED", materiality: "MEDIUM", reason: "Superseded by newer value in same slot",
      actorType: "SYSTEM", triggerType: "MODEL_RECALCULATION", dataEnvironment: input.dataEnvironment ?? "PRODUCTION",
      before: { status: "CURRENT" }, after: { status: "SUPERSEDED", supersededBy: id },
    });
  }

  await recordChange(db, {
    orgId: input.orgId, pursuitId: null, entityType: "fact", entityId: id,
    changeType: "FACT_PROMOTED", materiality: "HIGH",
    reason: `Fact promoted (${input.predicateKey})`,
    actorType: input.createdByActorType === "human" ? "USER" : input.originKind === "IMPORT" ? "IMPORT" : "SYSTEM",
    actorId: input.createdByActorId ?? null,
    triggerType: input.originKind === "EVIDENCE_PROMOTION" ? "EVIDENCE_VERIFIED" : input.originKind === "SIGNAL_PROMOTION" ? "FACT_PROMOTED" : "MANUAL",
    dataEnvironment: input.dataEnvironment ?? "PRODUCTION",
    after: { predicateKey: input.predicateKey, valueKey, confidence: input.confidence },
  });

  return { id, mode: supersedesId ? "SUPERSEDED_PRIOR" : "CREATED", identityKey, valueKey };
}

export async function getFact(db: PoolClient, id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query(`select * from facts where id = $1`, [id]);
  return rows[0] ?? null;
}
