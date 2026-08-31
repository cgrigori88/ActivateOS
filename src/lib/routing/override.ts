import type { PoolClient } from "pg";
import { recordAndEnqueue } from "../pursuits/federation/events";
import { recordOverride } from "../pursuits/overrides";
import type { OverrideCategory } from "./types";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Route selection & override (Workstream C, §1/§17/§25/§26/§55). Selection is distinct from
 * recommendation; when the human picks a non-recommended route it is captured as an OVERRIDE
 * with the original ranking, reason, and a normalized category — supervision data. Strategic
 * overrides read AS overrides (§55), never by bending score weights. Route changes never fork
 * the Pursuit (§19).
 *
 * Canonical micro-loop: this is the ONE authoritative route mutation. The governed skills
 * `select_partner_route` / `override_partner_route` call it inside `dispatchSkill`; committing a
 * decision records the material event AND enqueues its recompute via `recordAndEnqueue` (the
 * producer) so the reactive half of the loop runs. It intentionally enqueues only the targets the
 * dependency map assigns to PARTNER_SELECTED/PARTNER_OVERRIDE (READINESS/TODAY) — never a ROUTE
 * recompute, which would rebuild the snapshot and drop the human selection. Recommendation ≠
 * decision survives recompute.
 */

export interface SelectResult { isOverride: boolean; selectedPartnerId: string | null; }

/**
 * Resolve a route candidate (by its id, the read-model `key`) to its partner/distributor and
 * commit the decision through the single mutation path. Used by the governed route-decision skills.
 */
export async function selectRouteByCandidate(
  db: PoolClient, pursuitId: string, candidateId: string,
  opts: { actorId?: string | null; reason?: string; category?: OverrideCategory; env?: DataEnvironment; correlationId?: string | null },
): Promise<SelectResult> {
  const cand = (await db.query<{ partner_id: string | null; distributor_id: string | null }>(
    `select rc.partner_id, rc.distributor_id
       from route_candidates rc
       join pursuit_route_snapshots s on s.id = rc.route_snapshot_id
      where rc.id = $1 and s.pursuit_id = $2 and s.is_current`, [candidateId, pursuitId])).rows[0];
  if (!cand) throw new Error(`route candidate ${candidateId} not found on the current snapshot for pursuit ${pursuitId}`);
  return selectPartnerRoute(db, pursuitId, { partnerId: cand.partner_id, distributorId: cand.distributor_id, ...opts });
}

export async function selectPartnerRoute(
  db: PoolClient, pursuitId: string,
  opts: { partnerId: string | null; distributorId?: string | null; actorId?: string | null; reason?: string; category?: OverrideCategory; env?: DataEnvironment; correlationId?: string | null },
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
  // Record the material decision AND enqueue its recompute (the producer path). PARTNER_SELECTED /
  // PARTNER_OVERRIDE map to READINESS/TODAY only — the selection stands; no ROUTE rebuild.
  await recordAndEnqueue(db, {
    orgId, pursuitId, entityType: "pursuit", entityId: pursuitId,
    changeType: isOverride ? "PARTNER_OVERRIDE" : "PARTNER_SELECTED", materiality: "HIGH",
    reason: isOverride ? `Route override (${opts.category ?? "OTHER"}): ${opts.reason ?? ""}` : "Recommended route selected",
    actorType: "USER", actorId: opts.actorId ?? null, triggerType: "USER_OVERRIDE", dataEnvironment: env,
    before: { recommendedPartnerId: recommended }, after: { selectedPartnerId: opts.partnerId, category: opts.category ?? null },
  }, { correlationId: opts.correlationId ?? null });
  return { isOverride, selectedPartnerId: opts.partnerId ?? null };
}
