import type { PoolClient } from "pg";
import { recordChange } from "../pursuits/ledger";
import type { OutcomeLabel } from "./types";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Route outcomes (Workstream C, §40-42). The first route-learning substrate: what we
 * recommended, what was selected, what happened, and how fast. Enough structure is retained
 * (recommended vs selected route, intervention, timing) that future incrementality analysis is
 * possible — without building causal models now. Directional only.
 */

export async function recordRouteOutcome(
  db: PoolClient, orgId: string, pursuitId: string, label: OutcomeLabel,
  opts: { routeSnapshotId?: string | null; intervention?: unknown; occurredAt?: Date; env?: DataEnvironment; isSimulated?: boolean } = {},
): Promise<string> {
  const env = opts.env ?? "PRODUCTION";
  const occurredAt = opts.occurredAt ?? new Date();

  // time-to-event since the route was first recommended (§41).
  const rec = await db.query<{ calculated_at: Date }>(
    `select calculated_at from pursuit_route_snapshots where pursuit_id = $1 order by seq asc limit 1`, [pursuitId],
  );
  const seconds = rec.rows[0] ? (occurredAt.getTime() - rec.rows[0].calculated_at.getTime()) / 1000 : null;

  const snap = await db.query<{ recommended_partner_id: string | null; selected_partner_id: string | null }>(
    `select recommended_partner_id, selected_partner_id from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId],
  );

  const { rows } = await db.query<{ id: string }>(
    `insert into route_outcomes
       (org_id, pursuit_id, route_snapshot_id, outcome_label, recommended_route, selected_route, intervention,
        occurred_at, seconds_since_recommended, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [orgId, pursuitId, opts.routeSnapshotId ?? null, label,
     snap.rows[0] ? JSON.stringify({ partnerId: snap.rows[0].recommended_partner_id }) : null,
     snap.rows[0] ? JSON.stringify({ partnerId: snap.rows[0].selected_partner_id }) : null,
     opts.intervention ? JSON.stringify(opts.intervention) : null, occurredAt, seconds, env, opts.isSimulated ?? false],
  );
  await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit", entityId: pursuitId, changeType: "ROUTE_OUTCOME_RECORDED",
    materiality: label === "WON" || label === "LOST" ? "HIGH" : "MEDIUM", reason: `Route outcome: ${label}`,
    actorType: "SYSTEM", triggerType: "CRM_SYNC", dataEnvironment: env, after: { label, secondsSinceRecommended: seconds },
  });
  return rows[0].id;
}
