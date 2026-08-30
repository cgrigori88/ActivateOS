import type { PoolClient } from "pg";
import { buildExplanation } from "./explanation";
import type { Reason } from "./partner-activation";

/**
 * Populate Why Now's partner_route_relevance (Workstream C, §34/§48/§49). Completes the scaffold
 * Workstream B left, from the CURRENT route snapshot's recommended candidate. Every element
 * references real route reason ids; carries both an INTERNAL and a policy-safe SHAREABLE
 * explanation. Never fabricates — null when no route is recommended.
 */

export interface PartnerRouteRelevance {
  partner_id: string | null;
  candidate_id: string | null;
  route_score: number | null;
  route_confidence: number | null;
  internal: { code: string; text: string; polarity: number }[];
  shareable: { code: string; text: string; polarity: number }[];
}

export async function populatePartnerRouteRelevance(db: PoolClient, pursuitId: string): Promise<PartnerRouteRelevance | null> {
  const snap = await db.query<{ id: string; recommended_partner_id: string | null; route_score: string | null; route_confidence: string | null }>(
    `select id, recommended_partner_id, route_score, route_confidence from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId],
  );
  if (!snap.rows[0]) { await mergeWhyNow(db, pursuitId, null); return null; }
  const cand = await db.query<{ id: string }>(`select id from route_candidates where route_snapshot_id = $1 and is_recommended limit 1`, [snap.rows[0].id]);
  const candidateId = cand.rows[0]?.id ?? null;

  const reasonRows = candidateId
    ? (await db.query<{ reason_code: string; polarity: number; weight: string | null; detail: string; ref_type: string | null; ref_id: string | null; disclosure_class: string }>(
        `select reason_code, polarity, weight, detail, ref_type, ref_id, disclosure_class from route_candidate_reasons where candidate_id = $1`, [candidateId])).rows
    : [];
  const reasons: Reason[] = reasonRows.map((r) => ({ reasonCode: r.reason_code, polarity: (r.polarity as 1 | -1), weight: Number(r.weight ?? 0), detail: r.detail, refType: r.ref_type ?? "", refId: r.ref_id, disclosureClass: r.disclosure_class }));

  const rel: PartnerRouteRelevance = {
    partner_id: snap.rows[0].recommended_partner_id,
    candidate_id: candidateId,
    route_score: snap.rows[0].route_score != null ? Number(snap.rows[0].route_score) : null,
    route_confidence: snap.rows[0].route_confidence != null ? Number(snap.rows[0].route_confidence) : null,
    internal: buildExplanation(reasons, "internal"),
    shareable: buildExplanation(reasons, "shareable"),
  };
  await mergeWhyNow(db, pursuitId, rel);
  return rel;
}

async function mergeWhyNow(db: PoolClient, pursuitId: string, rel: PartnerRouteRelevance | null): Promise<void> {
  const { rows } = await db.query<{ why_now: Record<string, unknown> | null }>(`select why_now from pursuits where id = $1`, [pursuitId]);
  const wn = (rows[0]?.why_now ?? {}) as Record<string, unknown>;
  wn.partner_route_relevance = rel;
  await db.query(`update pursuits set why_now = $2, updated_at = now() where id = $1`, [pursuitId, JSON.stringify(wn)]);
}
