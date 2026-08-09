/**
 * Pursuit routing v1 (BLUEPRINT Phase 2) — pure, deterministic. Given ranked
 * partner fits and current workload, choose who actually pursues each
 * account: the best-fit partner WITH capacity, and their best-positioned
 * seller. Every skip is recorded with its reason — routing decisions are
 * explainable or they don't ship.
 */

export interface RankedFit {
  partnerId: string;
  partnerName: string;
  fitId: string;
  score: number;
}

export interface CapacityState {
  /** active (recommended/accepted) pursuits per partner */
  active: Map<string, number>;
  /** capacity per partner; missing/null = unconstrained */
  capacity: Map<string, number | null>;
}

export interface RoutingDecision {
  chosen: RankedFit | null;
  skipped: { partnerId: string; partnerName: string; reason: string }[];
}

/** Pick the best-fit partner that still has capacity; record why others lost. */
export function choosePartner(rankedFits: RankedFit[], state: CapacityState): RoutingDecision {
  const skipped: RoutingDecision["skipped"] = [];
  for (const fit of rankedFits) {
    const cap = state.capacity.get(fit.partnerId) ?? null;
    const active = state.active.get(fit.partnerId) ?? 0;
    if (cap != null && active >= cap) {
      skipped.push({
        partnerId: fit.partnerId,
        partnerName: fit.partnerName,
        reason: `at capacity (${active}/${cap} active pursuits)`,
      });
      continue;
    }
    return { chosen: fit, skipped };
  }
  return { chosen: null, skipped };
}

export interface SellerCandidate {
  sellerId: string;
  name: string;
  /** seller_account_relationships.strength for this account, 0..100; null = no relationship */
  relationshipStrength: number | null;
}

/**
 * Best seller for the pursuit: strongest account relationship wins; with no
 * relationships anywhere, the partner still pursues but unassigned (the
 * partner decides internally) — we never invent a preference.
 */
export function chooseSeller(candidates: SellerCandidate[]): SellerCandidate | null {
  const withRelationship = candidates.filter((c) => c.relationshipStrength != null);
  if (withRelationship.length === 0) return null;
  return withRelationship.reduce((best, c) =>
    c.relationshipStrength! > best.relationshipStrength! ? c : best,
  );
}
