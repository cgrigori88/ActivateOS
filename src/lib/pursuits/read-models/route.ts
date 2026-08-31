import type { PoolClient } from "pg";
import type { RouteComparisonView, RouteCandidateView, RouteDimensionCell, ScoreReason, RoutePathStep } from "./types";
import { scoreView, type Caller } from "./helpers";

/**
 * Route comparison read model (Workstream D, §15-20/§39/§40). Compares candidates by DIMENSION
 * (not just totals), keeps unknown distinct from zero (§17), shows recommendation vs selection
 * (§18), and — critically — filters disclosure SERVER-SIDE (§39): the internal (full) explanation
 * is returned ONLY when the caller holds internal disclosure; otherwise it is null and the browser
 * never receives it (§40/§65). Confidential reasons are generalized in the shareable set.
 */

const DIMENSION_LABELS: Record<string, string> = {
  account_relationship: "Relationship", product_capability: "Capability", seller_coverage: "Seller coverage",
  transaction_adjacency: "Transaction adjacency", territory_alignment: "Territory", strategic_alignment: "Strategic",
  historical_performance: "History", vertical_alignment: "Vertical",
};
const CONFIDENTIAL_CLASSES = new Set(["TRANSACTION_CONFIDENTIAL", "PII", "RESTRICTED"]);
const GENERALIZED: Record<string, string> = {
  TRANSACTION_ADJACENCY: "Recent channel activity strengthens this route",
  STRONG_ACCOUNT_RELATIONSHIP: "Existing customer relationship",
  RELEVANT_CAPABILITY: "Relevant delivery capability",
  DIRECT_ROUTE_AVAILABLE: "Vendor can engage directly",
};

function dimBand(v: number | null): RouteDimensionCell {
  if (v == null) return { band: "unknown", known: false, label: "Not available" };
  const band = v >= 80 ? "very_high" : v >= 60 ? "high" : v >= 40 ? "moderate" : "low";
  const label = band === "very_high" ? "Very strong" : band === "high" ? "Strong" : band === "moderate" ? "Moderate" : "Weak";
  return { band, known: true, label };
}

async function buildCandidate(db: PoolClient, snapshotId: string, candId: string, row: CandRow, caller: Caller, dimensionKeys: string[]): Promise<RouteCandidateView> {
  const dimsRows = await db.query<{ dimension: string; normalized_value: string | null }>(
    `select dimension, normalized_value from route_candidate_dimensions where candidate_id = $1`, [candId]);
  const dimMap = new Map(dimsRows.rows.map((d) => [d.dimension, d.normalized_value == null ? null : Number(d.normalized_value) * 100]));
  const dimensions: Record<string, RouteDimensionCell> = {};
  for (const k of dimensionKeys) dimensions[k] = dimBand(dimMap.has(k) ? dimMap.get(k)! : null);   // absent dimension = unknown (§17)

  const reasonRows = await db.query<{ reason_code: string; polarity: number; detail: string; ref_type: string | null; ref_id: string | null; disclosure_class: string }>(
    `select reason_code, polarity, detail, ref_type, ref_id, disclosure_class from route_candidate_reasons where candidate_id = $1`, [candId]);
  const shareable: ScoreReason[] = [];
  const internal: ScoreReason[] = [];
  for (const r of reasonRows.rows) {
    const confidential = CONFIDENTIAL_CLASSES.has(r.disclosure_class);
    internal.push({ text: r.detail, polarity: r.polarity as 1 | -1, refType: r.ref_type ?? undefined, refId: r.ref_id });
    if (r.disclosure_class === "RESTRICTED" || r.disclosure_class === "PII") continue;
    shareable.push({ text: confidential ? (GENERALIZED[r.reason_code] ?? "Additional channel signal") : (GENERALIZED[r.reason_code] ?? r.detail), polarity: r.polarity as 1 | -1 });
  }

  const disq = await db.query<{ code: string; severity: string; detail: string }>(`select code, severity, detail from route_candidate_disqualifiers where candidate_id = $1`, [candId]);
  const synthetic = dimMap.has("transaction_adjacency") && await hasSyntheticTx(db, caller.orgId);
  void snapshotId;
  return {
    key: candId, label: row.label, topology: row.route_topology, rank: row.rank, disqualified: row.disqualified,
    routeScore: scoreView("route", row.total_score), partnerActivation: scoreView("partner_activation", row.partner_activation_score),
    suitability: scoreView("suitability", row.suitability_score), readiness: scoreView("activation_readiness", row.activation_readiness_score),
    confidence: scoreView("route_confidence", row.candidate_confidence),
    dimensions, reasonsShareable: shareable,
    reasonsInternal: caller.canSeeInternal ? internal : null,   // §39: withheld entirely when not permitted
    disqualifiers: disq.rows.map((d) => ({ code: d.code, severity: d.severity as "HARD" | "SOFT", detail: d.detail })),
    synthetic,
  };
}

async function hasSyntheticTx(db: PoolClient, orgId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text n from transaction_features where org_id = $1 and is_simulated = true`, [orgId]);
  return Number(rows[0].n) > 0;
}

interface CandRow { id: string; label: string; route_topology: string; rank: number; disqualified: boolean; total_score: number | null; partner_activation_score: number | null; suitability_score: number | null; activation_readiness_score: number | null; candidate_confidence: number | null; is_recommended: boolean; is_selected: boolean; }

export async function getRouteComparison(db: PoolClient, caller: Caller, pursuitId: string): Promise<RouteComparisonView> {
  const dimensionKeys = ["account_relationship", "product_capability", "seller_coverage", "transaction_adjacency", "territory_alignment"];
  const snap = await db.query<{ id: string; recommended_partner_id: string | null; selected_partner_id: string | null; route_status: string }>(
    `select id, recommended_partner_id, selected_partner_id, route_status from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId]);
  if (!snap.rows[0]) return { path: [], recommended: null, selected: null, selectionMatchesRecommendation: true, overrideReason: null, overrideCategory: null, alternatives: [], changeEvents: [], dimensionKeys, decided: false, selectedKey: null, recomputePending: false };
  const snapshotId = snap.rows[0].id;
  const decided = snap.rows[0].route_status === "SELECTED";

  const cands = await db.query<CandRow & { partner_id: string | null; distributor_id: string | null }>(
    `select rc.id, rc.route_topology, rc.rank, rc.disqualified, rc.total_score, rc.partner_activation_score,
            rc.suitability_score, rc.activation_readiness_score, rc.candidate_confidence, rc.is_recommended, rc.is_selected,
            rc.partner_id, rc.distributor_id,
            coalesce(p.name, d.name, 'Direct') label
       from route_candidates rc
       left join partners p on p.id = rc.partner_id
       left join partners d on d.id = rc.distributor_id
      where rc.route_snapshot_id = $1 order by rc.rank`, [snapshotId]);

  const views: RouteCandidateView[] = [];
  for (const c of cands.rows) views.push(await buildCandidate(db, snapshotId, c.id, { ...c, total_score: c.total_score == null ? null : Number(c.total_score), partner_activation_score: num(c.partner_activation_score), suitability_score: num(c.suitability_score), activation_readiness_score: num(c.activation_readiness_score), candidate_confidence: num(c.candidate_confidence) }, caller, dimensionKeys));

  const recommended = views.find((_, i) => cands.rows[i].is_recommended) ?? null;
  const selected = views.find((_, i) => cands.rows[i].is_selected) ?? null;
  const selectedKey = selected?.key ?? null;   // the raw selection, kept even when it == recommendation
  const alternatives = views.filter((v) => v !== recommended);

  // Recompute-pending (R12/loop-honesty): a decision enqueues READINESS/TODAY recomputes; until the
  // worker drains them, downstream state has not settled — surfaced so the UI never implies it has.
  const pend = await db.query<{ n: string }>(
    `select count(*)::text n from recompute_requests where pursuit_id = $1 and status in ('PENDING','RUNNING')`, [pursuitId]);
  const recomputePending = Number(pend.rows[0].n) > 0;

  // Participant path.
  const parts = await db.query<{ participant_role: string; sequence: number; pname: string | null; dname: string | null }>(
    `select rp.participant_role, rp.sequence, p.name pname, d.name dname from pursuit_route_participants rp
       left join partners p on p.id = rp.partner_id left join partners d on d.id = rp.distributor_id
      where rp.route_snapshot_id = $1 order by rp.sequence`, [snapshotId]);
  const path: RoutePathStep[] = parts.rows.map((p) => ({ role: p.participant_role, label: p.pname ?? p.dname ?? p.participant_role.charAt(0) + p.participant_role.slice(1).toLowerCase(), sequence: p.sequence }));

  // Override reason (latest partner override) + route change events.
  const ov = await db.query<{ reason: string | null; human_decision: { category?: string } }>(
    `select reason, human_decision from pursuit_overrides where pursuit_id = $1 and field = 'partner' order by created_at desc limit 1`, [pursuitId]);
  const selectionMatches = (snap.rows[0].selected_partner_id ?? null) === (snap.rows[0].recommended_partner_id ?? null) || !selected;
  const synthetic = await hasSyntheticTx(db, caller.orgId);
  const changes = await db.query<{ recorded_at: Date; before_state: { recommendedPartnerId?: string } | null; after_state: { recommendedPartnerId?: string } | null; reason: string | null }>(
    `select recorded_at, before_state, after_state, reason from change_ledger where pursuit_id = $1 and change_type = 'ROUTE_RECOMMENDATION_CHANGED' order by recorded_at asc`, [pursuitId]);
  const nameOf = async (id: string | null | undefined) => id ? (await db.query<{ name: string }>(`select name from partners where id = $1`, [id])).rows[0]?.name ?? "—" : "Direct";
  const changeEvents = [];
  for (const c of changes.rows) changeEvents.push({ at: c.recorded_at.toISOString(), before: await nameOf(c.before_state?.recommendedPartnerId), after: await nameOf(c.after_state?.recommendedPartnerId), trigger: c.reason ?? "New intelligence", synthetic });

  return {
    path, recommended, selected: selectionMatches ? null : selected, selectionMatchesRecommendation: selectionMatches,
    overrideReason: selectionMatches ? null : (ov.rows[0]?.reason ?? null),
    overrideCategory: selectionMatches ? null : (ov.rows[0]?.human_decision?.category ?? null),
    alternatives, changeEvents, dimensionKeys, decided, selectedKey, recomputePending,
  };
}

function num(v: unknown): number | null { return v == null ? null : Number(v); }
