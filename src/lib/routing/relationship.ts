import type { PoolClient } from "pg";

/**
 * Relationship Truth (Workstream C, §15-17). The second truth layer: distinguishes account
 * overlap from an active relationship from a named-contact relationship, and makes strength
 * TEMPORAL — a strong relationship with no recent engagement decays. Human-asserted
 * relationships keep their provenance and never silently equal interaction-derived ones.
 */

export type RelationshipTier =
  | "NONE" | "ACCOUNT_OVERLAP" | "ACTIVE_RELATIONSHIP" | "SELLER_RELATIONSHIP" | "EXECUTIVE_RELATIONSHIP";

const DAY = 86_400_000;
/** Recency factor: full weight if seen within 90d, decays toward 0.3 by ~2y, floor 0.2. */
export function recencyFactor(lastAt: Date | null, now = new Date()): number {
  if (!lastAt) return 0.5;             // unknown recency → neutral
  const days = Math.max(0, (now.getTime() - lastAt.getTime()) / DAY);
  if (days <= 90) return 1;
  if (days >= 730) return 0.2;
  return 1 - 0.8 * ((days - 90) / 640);
}

export interface PartnerRel { strength01: number; tier: RelationshipTier; tenureMonths: number; confidence: number; }

export async function partnerRelationship(db: PoolClient, partnerId: string, companyId: string): Promise<PartnerRel> {
  const { rows } = await db.query<{ strength: string; tenure_months: number }>(
    `select strength, tenure_months from partner_relationships where partner_id = $1 and company_id = $2`,
    [partnerId, companyId],
  );
  if (!rows[0]) return { strength01: 0, tier: "NONE", tenureMonths: 0, confidence: 0.4 };
  const s = Number(rows[0].strength) / 100;
  const tier: RelationshipTier = s >= 0.6 ? "ACTIVE_RELATIONSHIP" : s > 0 ? "ACCOUNT_OVERLAP" : "NONE";
  // Tenure lends confidence, not raw strength.
  const confidence = Math.min(0.95, 0.5 + Math.min(rows[0].tenure_months, 36) / 36 * 0.4);
  return { strength01: s, tier, tenureMonths: rows[0].tenure_months, confidence };
}

export interface SellerRel { strength01: number; tier: RelationshipTier; recency: number; lastAt: Date | null; }

export async function sellerRelationship(db: PoolClient, sellerId: string, companyId: string): Promise<SellerRel> {
  const { rows } = await db.query<{ strength: string; last_interaction_at: Date | null }>(
    `select strength, last_interaction_at from seller_account_relationships where seller_id = $1 and company_id = $2`,
    [sellerId, companyId],
  );
  if (!rows[0]) return { strength01: 0, tier: "NONE", recency: 0.5, lastAt: null };
  const recency = recencyFactor(rows[0].last_interaction_at);
  const s = (Number(rows[0].strength) / 100) * recency;   // temporal: stale relationship weakens (§16)
  const tier: RelationshipTier = s >= 0.6 ? "SELLER_RELATIONSHIP" : s > 0 ? "ACTIVE_RELATIONSHIP" : "NONE";
  return { strength01: s, tier, recency, lastAt: rows[0].last_interaction_at };
}
