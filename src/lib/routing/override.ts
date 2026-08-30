import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import { recordOverride } from "../pursuits/overrides";
import type { OverrideCategory } from "./types";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Route selection & override (Workstream C, §1/§17/§25/§26/§55). Selection is distinct from
 * recommendation; when the human picks a non-recommended route it is captured as an OVERRIDE
 * with the original ranking, reason, and a normalized category — supervision data. Strategic
 * overrides read AS overrides (§55), never by bending score weights. Route changes never fork
 * the Pursuit (§19).
 */

export interface SelectResult { isOverride: boolean; selectedPartnerId: string | null; }

export async function selectPartnerRoute(
  db: PoolClient, pursuitId: string,
  opts: { partnerId: string | null; distributorId?: string | null; actorId?: string | null; reason?: string; category?: OverrideCategory; env?: DataEnvironment },
): Promise<SelectResult> {
  const env = opts.env ?? "PRODUCTION";
  const snap = await db.query<{ id: string; org_id: string; recommended_partner_id: string | null }>(
    `select id, org_id, recommended_partner_id from pursuit_route_snapshots where pursuit_id = $1 and is_current for update`, [pursuitId],
  );
  if (!snap.rows[0]) throw new Error(`no current route snapshot for pursuit ${pursuitId}`);
  const { id: snapshotId, org_id: orgId, recommended_partner_id: recommended } = snap.rows[0];
  const isOverride = (opts.partnerId ?? null) !== (recommended ?? null);

  await db.query(`update route_candidates set is_selected = false where route_snapshot_id = $1`, [snapshotId]);
  await db.query(
    `update route_candidates set is_selected = true where route_snapshot_id = $1 and (partner_id is not distinct from $2) and (distributor_id is not distinct from $3)`,
    [snapshotId, opts.partnerId, opts.distributorId ?? null],
  );
  await db.query(
    `update pursuit_route_snapshots set selected_partner_id = $2, selected_distributor_id = $3, route_status = 'SELECTED' where id = $1`,
    [snapshotId, opts.partnerId, opts.distributorId ?? null],
  );
  await db.query(`update pursuits set selected_partner_id = $2, updated_at = now() where id = $1`, [pursuitId, opts.partnerId]);

  if (isOverride) {
    // Preserve the original recommendation + ranking snapshot for learning.
    const ranking = await db.query(`select partner_id, rank, total_score from route_candidates where route_snapshot_id = $1 order by rank`, [snapshotId]);
    await recordOverride(db, {
      orgId, pursuitId, field: "partner",
      originalRecommendation: { recommendedPartnerId: recommended, ranking: ranking.rows },
      humanDecision: { selectedPartnerId: opts.partnerId, category: opts.category ?? "OTHER" },
      beforeValue: recommended, afterValue: opts.partnerId, reason: opts.reason ?? null, actorId: opts.actorId ?? null,
    });
  }
  await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit", entityId: pursuitId,
    changeType: isOverride ? "PARTNER_OVERRIDE" : "PARTNER_SELECTED", materiality: "HIGH",
    reason: isOverride ? `Route override (${opts.category ?? "OTHER"}): ${opts.reason ?? ""}` : "Recommended route selected",
    actorType: "USER", actorId: opts.actorId ?? null, triggerType: "USER_OVERRIDE", dataEnvironment: env,
    before: { recommendedPartnerId: recommended }, after: { selectedPartnerId: opts.partnerId, category: opts.category ?? null },
  });
  return { isOverride, selectedPartnerId: opts.partnerId ?? null };
}
