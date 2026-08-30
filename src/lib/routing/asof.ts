import type { PoolClient } from "pg";

/**
 * Route history + as-of reconstruction (Workstream C, §28/§43). Route snapshots are append-only
 * and versioned, so "what did we recommend at time T" is answerable, and historical route
 * scoring never leaks future information (the scorer only reads features with
 * feature_observed_at ≤ the snapshot's as_of, enforced in route-model/partner-activation).
 */

export interface RouteSnapshotRow { id: string; seq: number; as_of: Date; route_topology: string; recommended_partner_id: string | null; selected_partner_id: string | null; route_score: number | null; route_confidence: number | null; route_status: string; }

/** The route snapshot in effect as-of time `t` (the newest whose as_of ≤ t). */
export async function routeAsOf(db: PoolClient, pursuitId: string, t: Date): Promise<RouteSnapshotRow | null> {
  const { rows } = await db.query(
    `select id, seq, as_of, route_topology, recommended_partner_id, selected_partner_id, route_score, route_confidence, route_status
       from pursuit_route_snapshots where pursuit_id = $1 and as_of <= $2 order by seq desc limit 1`, [pursuitId, t],
  );
  return rows[0] ? cast(rows[0]) : null;
}

export async function routeHistory(db: PoolClient, pursuitId: string): Promise<RouteSnapshotRow[]> {
  const { rows } = await db.query(
    `select id, seq, as_of, route_topology, recommended_partner_id, selected_partner_id, route_score, route_confidence, route_status
       from pursuit_route_snapshots where pursuit_id = $1 order by seq asc`, [pursuitId],
  );
  return rows.map(cast);
}

function cast(r: Record<string, unknown>): RouteSnapshotRow {
  return {
    id: r.id as string, seq: r.seq as number, as_of: r.as_of as Date, route_topology: r.route_topology as string,
    recommended_partner_id: (r.recommended_partner_id as string) ?? null, selected_partner_id: (r.selected_partner_id as string) ?? null,
    route_score: r.route_score != null ? Number(r.route_score) : null, route_confidence: r.route_confidence != null ? Number(r.route_confidence) : null,
    route_status: r.route_status as string,
  };
}
