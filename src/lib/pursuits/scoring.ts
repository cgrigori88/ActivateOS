import type { PoolClient } from "pg";
import { recordChange } from "./ledger";
import { priorityDeltaMateriality } from "./materiality";
import type { DataEnvironment } from "./lineage";

/**
 * Append-only, versioned Pursuit scoring (Workstream A, §7-11). A recompute writes a
 * NEW immutable snapshot (dimensions + contributions), atomically promotes it to
 * current, and refreshes the denormalized `pursuits.current_*` cache — all in the
 * caller's transaction. Hard invariants:
 *   §8  the UI never sees a half-written score (single txn; rollback on failure);
 *   §9  exactly one current snapshot per pursuit (DB partial-unique index + row lock);
 *   §10 every contribution keeps evidence lineage;
 *   §11 every feature carries feature_observed_at (as-of / leakage prevention).
 * Directional labeling lives on score_versions.label (e.g. 'v0-directional-…').
 */

export type Dimension =
  | "purchase_propensity" | "evidence_confidence" | "timing" | "solution_fit"
  | "partner_activation" | "seller_activation" | "pursuit_priority";

export type Band = "very_high" | "high" | "medium" | "low";

export interface DimensionValue {
  dimension: Dimension;
  value: number;
  band?: Band | null;
}

export interface Contribution {
  dimension: Dimension;
  featureName: string;
  provenanceType?: string | null;
  rawValue?: number | null;
  normalizedValue?: number | null;
  weight?: number | null;
  contribution: number;
  evidenceReference?: string | null;
  referenceKind?: "evidence" | "fact" | "signal" | "relationship" | "transaction_signal" | "reference" | null;
  /** As-of eligibility (§11). Null ONLY for timeless reference metadata. */
  featureObservedAt?: Date | null;
}

export interface WriteSnapshotInput {
  pursuitId: string;
  scoreVersionId: string;
  asOf?: Date;
  dimensions: DimensionValue[];
  contributions: Contribution[];
  dataEnvironment?: DataEnvironment;
  reason?: string | null;
}

const DIMENSION_TO_CACHE: Record<Dimension, string> = {
  purchase_propensity: "current_purchase_propensity_score",
  evidence_confidence: "current_evidence_confidence_score",
  timing: "current_timing_score",
  solution_fit: "current_solution_fit_score",
  partner_activation: "current_partner_activation_score",
  seller_activation: "current_seller_activation_score",
  pursuit_priority: "current_priority_score",
};

export interface WriteSnapshotResult {
  snapshotId: string;
  seq: number;
  priorityDelta: number | null;
}

export async function writeScoreSnapshot(db: PoolClient, input: WriteSnapshotInput): Promise<WriteSnapshotResult> {
  // Lock the pursuit → serialize concurrent recomputes (§9). Read prior priority for delta.
  const locked = await db.query<{ org_id: string; current_priority_score: string | null; data_environment: DataEnvironment }>(
    `select org_id, current_priority_score, data_environment from pursuits where id = $1 for update`,
    [input.pursuitId],
  );
  const p = locked.rows[0];
  if (!p) throw new Error(`Pursuit ${input.pursuitId} not found`);
  const env = input.dataEnvironment ?? (p.data_environment as DataEnvironment);

  const seqRes = await db.query<{ next: number }>(
    `select coalesce(max(seq), 0) + 1 as next from pursuit_score_snapshots where pursuit_id = $1`,
    [input.pursuitId],
  );
  const seq = Number(seqRes.rows[0].next);

  // Demote the current snapshot FIRST so the one-current partial-unique index never
  // sees two current rows for this pursuit.
  await db.query(
    `update pursuit_score_snapshots set is_current = false where pursuit_id = $1 and is_current`,
    [input.pursuitId],
  );

  const snap = await db.query<{ id: string }>(
    `insert into pursuit_score_snapshots (org_id, pursuit_id, score_version_id, seq, as_of, is_current, data_environment)
     values ($1,$2,$3,$4, coalesce($5, now()), true, $6) returning id`,
    [p.org_id, input.pursuitId, input.scoreVersionId, seq, input.asOf ?? null, env],
  );
  const snapshotId = snap.rows[0].id;

  for (const d of input.dimensions) {
    await db.query(
      `insert into pursuit_score_dimensions (snapshot_id, dimension, value, band) values ($1,$2,$3,$4)`,
      [snapshotId, d.dimension, d.value, d.band ?? null],
    );
  }
  for (const c of input.contributions) {
    await db.query(
      `insert into pursuit_score_contributions
         (snapshot_id, dimension, feature_name, provenance_type, raw_value, normalized_value,
          weight, contribution, evidence_reference, reference_kind, feature_observed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        snapshotId, c.dimension, c.featureName, c.provenanceType ?? null, c.rawValue ?? null,
        c.normalizedValue ?? null, c.weight ?? null, c.contribution, c.evidenceReference ?? null,
        c.referenceKind ?? null, c.featureObservedAt ?? null,
      ],
    );
  }

  // Refresh the cache from the new snapshot's dimensions (§7 cache, not authority).
  const dimMap = new Map(input.dimensions.map((d) => [d.dimension, d.value]));
  const sets: string[] = ["current_score_snapshot_id = $2"];
  const vals: unknown[] = [input.pursuitId, snapshotId];
  let i = 3;
  for (const [dim, col] of Object.entries(DIMENSION_TO_CACHE)) {
    const v = dimMap.get(dim as Dimension);
    if (v !== undefined) { sets.push(`${col} = $${i}`); vals.push(v); i++; }
  }
  sets.push("updated_at = now()");
  await db.query(`update pursuits set ${sets.join(", ")} where id = $1`, vals);

  const prevPriority = p.current_priority_score == null ? null : Number(p.current_priority_score);
  const newPriority = dimMap.get("pursuit_priority") ?? null;
  const priorityDelta = prevPriority != null && newPriority != null ? newPriority - prevPriority : null;

  await recordChange(db, {
    orgId: p.org_id,
    pursuitId: input.pursuitId,
    entityType: "score",
    entityId: snapshotId,
    changeType: "SCORE_CHANGED",
    materiality: priorityDelta != null ? priorityDeltaMateriality(priorityDelta) : "LOW",
    reason: input.reason ?? "Score recomputed",
    actorType: "WORKER",
    triggerType: "MODEL_RECALCULATION",
    dataEnvironment: env,
    before: prevPriority != null ? { pursuit_priority: prevPriority } : null,
    after: newPriority != null ? { pursuit_priority: newPriority, seq } : { seq },
  });

  return { snapshotId, seq, priorityDelta };
}
