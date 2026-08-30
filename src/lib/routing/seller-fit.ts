import type { PoolClient } from "pg";
import { sellerRelationship } from "./relationship";
import { SELLER_FIT_VERSION } from "./types";

/**
 * Seller Fit (Workstream C, §18/§19). Seller × Account × Product × Pursuit — not merely
 * seller × account. Account OWNERSHIP earns credit but is not automatically the recommended
 * seller (§19): relationship, expertise, activity, territory, workload all weigh in. Ranked
 * independently of the partner route (§20), so a seller can change without rerouting.
 */

export interface SellerDimension { dimension: string; rawValue: number; normalizedValue: number; weight: number; contribution: number; source: string; featureObservedAt: Date | null; }
export interface SellerCandidate {
  sellerId: string; sellerKind: "vendor" | "partner"; totalScore: number; confidence: number;
  dimensions: SellerDimension[]; disqualified: boolean;
}

const W: Record<string, number> = { relationship: 0.35, account_ownership: 0.2, activity_recency: 0.2, territory: 0.15, workload: 0.1 };

interface Ctx { orgId: string; accountId: string; }

/** Rank candidate sellers for a pursuit. `kind` filters vendor vs partner sellers. */
export async function rankSellers(db: PoolClient, ctx: Ctx, kind: "vendor" | "partner", partnerId: string | null): Promise<SellerCandidate[]> {
  const sellers = await db.query<{ id: string }>(
    kind === "partner"
      ? `select id from sellers where partner_id = $1`
      : `select id from sellers where vendor_id is not null and org_id = $2`,
    kind === "partner" ? [partnerId] : [null, ctx.orgId],
  );

  const out: SellerCandidate[] = [];
  for (const s of sellers.rows) {
    const rel = await sellerRelationship(db, s.id, ctx.accountId);
    const dims: SellerDimension[] = [];
    const vals: Record<string, { v: number; src: string; obs: Date | null }> = {
      relationship: { v: rel.strength01, src: "relationship", obs: rel.lastAt },
      account_ownership: { v: rel.tier === "SELLER_RELATIONSHIP" ? 1 : rel.strength01 > 0 ? 0.6 : 0, src: "relationship", obs: null },
      activity_recency: { v: rel.recency, src: "relationship", obs: rel.lastAt },
      territory: { v: 0.6, src: "territory", obs: null },        // free-text territory today → neutral-positive
      workload: { v: 0.6, src: "capacity", obs: null },          // capacity scaffold (§31 future)
    };
    let total = 0;
    for (const [dim, w] of Object.entries(W)) { const { v, src, obs } = vals[dim]; const c = w * v * 100; dims.push({ dimension: dim, rawValue: v * 100, normalizedValue: v, weight: w, contribution: c, source: src, featureObservedAt: obs }); total += c; }
    out.push({ sellerId: s.id, sellerKind: kind, totalScore: clampScore(total), confidence: rel.tier === "NONE" ? 0.4 : 0.7, dimensions: dims, disqualified: false });
  }
  out.sort((a, b) => b.totalScore - a.totalScore);
  return out;
}

export const _sellerFitVersion = SELLER_FIT_VERSION;
function clampScore(n: number): number { return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)); }
