import type { PoolClient } from "pg";
import { scorePartnerActivation, type PartnerActivation, type Dimension, type Reason, type Disqualifier } from "./partner-activation";
import { activationReadiness } from "./readiness";
import { rankSellers } from "./seller-fit";
import type { RouteTopology } from "./types";

/**
 * Route candidate generation (Workstream C, §4/§5/§13). Produces EVERY viable candidate — one
 * per capable partner, a DIRECT candidate, and a DISTRIBUTOR_LED candidate where a distributor
 * exists — each fully scored and explainable. Hard-disqualified candidates are retained (marked
 * disqualified) but excluded from recommendation. Route score, partner-activation score,
 * suitability, readiness and confidence are all distinct (§7/§8/§9).
 */

export interface PursuitCtx { orgId: string; accountId: string; productCategoryId: string | null; pursuitType: string | null; }

export interface RankedCandidate {
  partnerId: string | null; distributorId: string | null; topology: RouteTopology;
  rank: number; isRecommended: boolean;
  totalScore: number; partnerActivationScore: number; suitabilityScore: number;
  activationReadinessScore: number; candidateConfidence: number;
  disqualified: boolean; hardDisqualified: boolean;
  dimensions: Dimension[]; reasons: Reason[]; disqualifiers: Disqualifier[];
}

/** Data-completeness-aware route confidence (§10) — distinct from route score (§9). */
function routeConfidence(pa: PartnerActivation): number {
  let c = 0.3 + 0.5 * pa.dataCompleteness;
  if (pa.transactionAvailable) c += 0.15;
  return Math.min(1, c) * 100;
}

export async function getPursuitCtx(db: PoolClient, pursuitId: string): Promise<PursuitCtx & { pursuitId: string }> {
  const { rows } = await db.query<{ org_id: string; account_id: string; product_category_id: string | null; pursuit_type: string | null }>(
    `select org_id, account_id, product_category_id, pursuit_type from pursuits where id = $1`, [pursuitId],
  );
  if (!rows[0]) throw new Error(`pursuit ${pursuitId} not found`);
  return { pursuitId, orgId: rows[0].org_id, accountId: rows[0].account_id, productCategoryId: rows[0].product_category_id, pursuitType: rows[0].pursuit_type };
}

export async function generateRouteCandidates(db: PoolClient, pursuitId: string, asOf = new Date()): Promise<{ ctx: PursuitCtx; candidates: RankedCandidate[] }> {
  const ctx = await getPursuitCtx(db, pursuitId);
  const partners = await db.query<{ id: string; partner_type: string | null }>(`select id, partner_type from partners where org_id = $1`, [ctx.orgId]);

  const cands: RankedCandidate[] = [];
  for (const p of partners.rows) {
    const pa = await scorePartnerActivation(db, ctx, p.id, asOf);
    const readiness = await activationReadiness(db, ctx.orgId, pursuitId, ctx.accountId, p.id, ctx.pursuitType, pa);
    const isDistributor = p.partner_type === "distributor";
    cands.push({
      partnerId: isDistributor ? null : p.id, distributorId: isDistributor ? p.id : null,
      topology: isDistributor ? "DISTRIBUTOR_LED" : "PARTNER_LED",
      rank: 0, isRecommended: false,
      totalScore: pa.partnerActivationScore, partnerActivationScore: pa.partnerActivationScore,
      suitabilityScore: pa.suitabilityScore, activationReadinessScore: readiness.readinessScore,
      candidateConfidence: routeConfidence(pa),
      disqualified: pa.hardDisqualified, hardDisqualified: pa.hardDisqualified,
      dimensions: pa.dimensions, reasons: pa.reasons, disqualifiers: pa.disqualifiers,
    });
  }

  // DIRECT candidate (§13) — vendor-to-customer, always a valid alternative.
  const vendorSellers = await rankSellers(db, { orgId: ctx.orgId, accountId: ctx.accountId }, "vendor", null);
  const directBase = 45 + (vendorSellers[0] ? vendorSellers[0].totalScore * 0.2 : 0);
  cands.push({
    partnerId: null, distributorId: null, topology: "DIRECT", rank: 0, isRecommended: false,
    totalScore: clampScore(directBase), partnerActivationScore: 0, suitabilityScore: clampScore(directBase),
    activationReadinessScore: vendorSellers[0] ? 70 : 40, candidateConfidence: 55,
    disqualified: false, hardDisqualified: false,
    dimensions: [{ dimension: "direct_vendor_coverage", rawValue: directBase, normalizedValue: directBase / 100, weight: 1, contribution: directBase, source: "relationship", featureObservedAt: null }],
    reasons: [{ reasonCode: "DIRECT_ROUTE_AVAILABLE", polarity: 1, weight: 1, detail: "Vendor can engage the customer directly", refType: "seller", refId: vendorSellers[0]?.sellerId ?? null, disclosureClass: "INTERNAL" }],
    disqualifiers: [],
  });

  // Rank: recommendable candidates by score desc, then disqualified ones after.
  const ok = cands.filter((c) => !c.hardDisqualified).sort((a, b) => b.totalScore - a.totalScore);
  const bad = cands.filter((c) => c.hardDisqualified).sort((a, b) => b.totalScore - a.totalScore);
  let rank = 1;
  for (const c of ok) { c.rank = rank++; c.isRecommended = c.rank === 1; }
  for (const c of bad) { c.rank = rank++; }
  return { ctx, candidates: [...ok, ...bad] };
}

function clampScore(n: number): number { return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)); }
