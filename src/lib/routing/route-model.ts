import type { PoolClient } from "pg";
import { generateRouteCandidates, type RankedCandidate, type PursuitCtx } from "./candidates";
import { ROUTE_MODEL_VERSION, PARTNER_FIT_VERSION, SELLER_FIT_VERSION, type ParticipantRole } from "./types";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Durable route snapshot writer (Workstream C, §1/§3/§13/§28/§56). Append-only + one-current +
 * versioned. Persists the FULL candidate set (alternatives are first-class), dimensions,
 * reasons, disqualifiers, and the participant path. Caches the current recommendation onto the
 * pursuits recommended-partner and current-partner-activation-score columns (cache only — the
 * snapshot is authority). Emits ROUTE_RECOMMENDATION_CHANGED when the recommended partner
 * changes. Does NOT mutate base partner-fit history (§56).
 */

export interface WriteRouteResult { snapshotId: string; seq: number; recommendedPartnerId: string | null; recommendedCandidateId: string | null; changed: boolean; }

export async function recomputeRoute(db: PoolClient, pursuitId: string, asOf = new Date(), env: DataEnvironment = "PRODUCTION"): Promise<WriteRouteResult> {
  const { ctx, candidates } = await generateRouteCandidates(db, pursuitId, asOf);
  return persistRoute(db, pursuitId, ctx, candidates, asOf, env);
}

export async function persistRoute(
  db: PoolClient, pursuitId: string, ctx: PursuitCtx, candidates: RankedCandidate[], asOf: Date, env: DataEnvironment,
): Promise<WriteRouteResult> {
  const top = candidates.find((c) => c.isRecommended) ?? null;

  // Prior snapshot: recommendation (for change detection) AND the authorized human selection.
  // CANONICAL INVARIANT: a recompute may change the recommendation, but it MUST NOT erase a human
  // decision. `recommended` is regenerated below; a prior SELECTED route is carried forward onto the
  // new snapshot so recommendation ≠ decision survives the recompute. Only a subsequent governed
  // decision (selectPartnerRoute) may change the selection — never this score/belief refresh.
  const prior = await db.query<{ recommended_partner_id: string | null; selected_partner_id: string | null; selected_distributor_id: string | null; route_status: string | null }>(
    `select recommended_partner_id, selected_partner_id, selected_distributor_id, route_status from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId],
  );
  const priorPartner = prior.rows[0]?.recommended_partner_id ?? null;
  const wasSelected = prior.rows[0]?.route_status === "SELECTED" || prior.rows[0]?.selected_partner_id != null;
  const carriedPartner = wasSelected ? (prior.rows[0]?.selected_partner_id ?? null) : null;
  const carriedDistributor = wasSelected ? (prior.rows[0]?.selected_distributor_id ?? null) : null;

  const seqRow = await db.query<{ seq: number }>(`select coalesce(max(seq),0)+1 seq from pursuit_route_snapshots where pursuit_id = $1`, [pursuitId]);
  const seq = seqRow.rows[0].seq;
  await db.query(`update pursuit_route_snapshots set is_current = false where pursuit_id = $1 and is_current`, [pursuitId]);

  // A carried human decision keeps the snapshot SELECTED; otherwise the fresh recommendation stands.
  const status = wasSelected ? "SELECTED" : !top ? "REVIEW_REQUIRED" : "RECOMMENDED";
  const snap = await db.query<{ id: string }>(
    `insert into pursuit_route_snapshots
       (org_id, pursuit_id, seq, is_current, as_of, route_topology, recommended_partner_id, recommended_distributor_id,
        route_score, route_confidence, route_status, route_model_version, partner_fit_version, seller_fit_version,
        created_by_actor_type, data_environment, selected_partner_id, selected_distributor_id)
     values ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'system',$14,$15,$16) returning id`,
    [ctx.orgId, pursuitId, seq, asOf, top?.topology ?? "PARTNER_LED", top?.partnerId ?? null, top?.distributorId ?? null,
     top?.totalScore ?? null, top?.candidateConfidence ?? null, status, ROUTE_MODEL_VERSION, PARTNER_FIT_VERSION, SELLER_FIT_VERSION, env,
     carriedPartner, carriedDistributor],
  );
  const snapshotId = snap.rows[0].id;
  let recommendedCandidateId: string | null = null;

  for (const c of candidates) {
    const cand = await db.query<{ id: string }>(
      `insert into route_candidates
         (route_snapshot_id, org_id, partner_id, distributor_id, route_topology, rank, is_recommended, is_selected,
          total_score, partner_activation_score, suitability_score, activation_readiness_score, candidate_confidence, disqualified)
       values ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,$12,$13) returning id`,
      [snapshotId, ctx.orgId, c.partnerId, c.distributorId, c.topology, c.rank, c.isRecommended,
       c.totalScore, c.partnerActivationScore, c.suitabilityScore, c.activationReadinessScore, c.candidateConfidence, c.disqualified],
    );
    const candId = cand.rows[0].id;
    if (c.isRecommended) recommendedCandidateId = candId;
    for (const d of c.dimensions) {
      await db.query(
        `insert into route_candidate_dimensions (candidate_id, dimension, raw_value, normalized_value, weight, contribution, source, feature_observed_at, model_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [candId, d.dimension, d.rawValue, d.normalizedValue, d.weight, d.contribution, d.source, d.featureObservedAt, ROUTE_MODEL_VERSION],
      );
    }
    for (const r of c.reasons) {
      await db.query(
        `insert into route_candidate_reasons (candidate_id, org_id, reason_code, polarity, weight, detail, ref_type, ref_id, disclosure_class)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [candId, ctx.orgId, r.reasonCode, r.polarity, r.weight, r.detail, r.refType, r.refId, r.disclosureClass],
      );
    }
    for (const q of c.disqualifiers) {
      await db.query(
        `insert into route_candidate_disqualifiers (candidate_id, code, severity, ref_type, ref_id, detail) values ($1,$2,$3,$4,$5,$6)`,
        [candId, q.code, q.severity, q.refType, q.refId, q.detail],
      );
    }
  }

  // Carry the human selection onto the regenerated candidate set (recommendation ≠ decision).
  // If the previously-selected route is still a candidate, mark it selected; the snapshot-level
  // selected_partner_id is preserved regardless (set above), so the decision is never lost.
  if (wasSelected) {
    await db.query(
      `update route_candidates set is_selected = true
        where route_snapshot_id = $1 and (partner_id is not distinct from $2) and (distributor_id is not distinct from $3)`,
      [snapshotId, carriedPartner, carriedDistributor],
    );
  }

  // Participant path for the recommended topology.
  if (top) {
    const path: { role: ParticipantRole; partnerId: string | null; distributorId: string | null }[] = [{ role: "VENDOR", partnerId: null, distributorId: null }];
    if (top.topology === "DISTRIBUTOR_LED" && top.distributorId) path.push({ role: "DISTRIBUTOR", partnerId: null, distributorId: top.distributorId });
    if (top.partnerId) path.push({ role: "RESELLER", partnerId: top.partnerId, distributorId: null });
    path.push({ role: "CUSTOMER", partnerId: null, distributorId: null });
    let sequence = 1;
    for (const step of path) {
      await db.query(
        `insert into pursuit_route_participants (org_id, pursuit_id, route_snapshot_id, partner_id, distributor_id, participant_role, sequence)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.orgId, pursuitId, snapshotId, step.partnerId, step.distributorId, step.role, sequence++],
      );
    }
  }

  // Cache current recommendation onto pursuits (cache only).
  await db.query(
    `update pursuits set recommended_partner_id = $2, current_partner_activation_score = $3, updated_at = now() where id = $1`,
    [pursuitId, top?.partnerId ?? null, top?.partnerActivationScore ?? null],
  );

  const changed = priorPartner !== (top?.partnerId ?? null);
  if (changed) {
    await recordChange(db, {
      orgId: ctx.orgId, pursuitId, entityType: "pursuit", entityId: pursuitId,
      changeType: "ROUTE_RECOMMENDATION_CHANGED", materiality: "HIGH",
      reason: `Recommended route → ${top?.topology ?? "none"} (${top?.partnerId ? "partner" : "direct"})`,
      actorType: "SYSTEM", triggerType: "MODEL_RECALCULATION", dataEnvironment: env,
      before: { recommendedPartnerId: priorPartner }, after: { recommendedPartnerId: top?.partnerId ?? null, routeScore: top?.totalScore ?? null, seq },
    });
  }
  return { snapshotId, seq, recommendedPartnerId: top?.partnerId ?? null, recommendedCandidateId, changed };
}
