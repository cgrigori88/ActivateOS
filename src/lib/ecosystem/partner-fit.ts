import { band, type ScoreResult } from "../scoring/compute";

/**
 * Partner Fit v1 (BLUEPRINT Phase 2) — pure, deterministic, explainable.
 * Answers: of the partners who COULD pursue this account × solution, who is
 * best positioned? Same discipline as propensity: weighted features, every
 * contribution preserved with its reason, no model call anywhere.
 */

export const PARTNER_FIT_VERSION = "fit-v1-rules";

export const FIT_WEIGHTS: Record<string, number> = {
  capability: 0.35, // can they deliver this solution?
  relationship: 0.3, // do they already know this account?
  territory: 0.2, // do they cover this industry/geo?
  seller_coverage: 0.15, // does a named seller hold the relationship?
};

export interface PartnerProfile {
  partnerId: string;
  name: string;
  /** capability strength by taxonomy slug, 0..1 (certified handled upstream) */
  capabilities: Map<string, number>;
  industries: string[]; // empty = unrestricted
  countries: string[]; // empty = unrestricted
  /** partner_relationships.strength for this account, 0..100, null if none */
  relationshipStrength: number | null;
  tenureMonths: number | null;
  /** seller_account_relationships strengths for this account via this partner's sellers */
  sellerStrengths: number[];
}

export interface AccountContext {
  industry: string | null;
  country: string | null;
}

export interface PartnerFitResult extends ScoreResult {
  partnerId: string;
  partnerName: string;
  details: Map<string, string>;
}

const TENURE_BONUS_CAP = 0.15; // long-standing relationships edge out new ones
const TENURE_HORIZON_MONTHS = 36;

export function computePartnerFit(
  partner: PartnerProfile,
  account: AccountContext,
  targetSlug: string,
): PartnerFitResult {
  const details = new Map<string, string>();

  const capability = partner.capabilities.get(targetSlug) ?? 0;
  details.set(
    "capability",
    capability > 0 ? `delivers ${targetSlug} (strength ${capability})` : `no ${targetSlug} practice`,
  );

  let relationship = 0;
  if (partner.relationshipStrength != null) {
    relationship = Math.min(1, partner.relationshipStrength / 100);
    if (partner.tenureMonths) {
      relationship = Math.min(
        1,
        relationship +
          TENURE_BONUS_CAP * Math.min(1, partner.tenureMonths / TENURE_HORIZON_MONTHS),
      );
    }
    details.set(
      "relationship",
      `existing account relationship (${partner.relationshipStrength}/100` +
        (partner.tenureMonths ? `, ${partner.tenureMonths} months)` : ")"),
    );
  } else {
    details.set("relationship", "no existing account relationship");
  }

  // Coverage: an empty list means the partner is unrestricted on that axis.
  // Unknown account attributes score neutral — absence of data is not a no.
  const industryFit =
    partner.industries.length === 0
      ? 1
      : account.industry
        ? partner.industries.includes(account.industry)
          ? 1
          : 0
        : 0.5;
  const countryFit =
    partner.countries.length === 0
      ? 1
      : account.country
        ? partner.countries.includes(account.country)
          ? 1
          : 0
        : 0.5;
  const territory = industryFit * 0.6 + countryFit * 0.4;
  details.set(
    "territory",
    `industry ${industryFit === 1 ? "covered" : industryFit === 0.5 ? "unknown" : "not covered"}, ` +
      `geo ${countryFit === 1 ? "covered" : countryFit === 0.5 ? "unknown" : "not covered"}`,
  );

  const sellerCoverage =
    partner.sellerStrengths.length > 0
      ? Math.min(1, Math.max(...partner.sellerStrengths) / 100)
      : 0;
  details.set(
    "seller_coverage",
    partner.sellerStrengths.length > 0
      ? `strongest seller relationship ${Math.max(...partner.sellerStrengths)}/100`
      : "no seller holds this account",
  );

  const raw: Record<string, number> = {
    capability,
    relationship,
    territory,
    seller_coverage: sellerCoverage,
  };
  const features = Object.entries(FIT_WEIGHTS).map(([feature, weight]) => ({
    feature,
    raw: raw[feature],
    contribution: Math.min(1, raw[feature]) * weight * 100,
    evidenceIds: [] as string[],
  }));
  const score = Math.max(0, Math.min(100, features.reduce((s, f) => s + f.contribution, 0)));

  return {
    partnerId: partner.partnerId,
    partnerName: partner.name,
    score,
    band: band(score),
    features,
    details,
  };
}

/** Rank all partners for one account × solution; capability is a hard gate. */
export function rankPartners(
  partners: PartnerProfile[],
  account: AccountContext,
  targetSlug: string,
): PartnerFitResult[] {
  return partners
    .filter((p) => (p.capabilities.get(targetSlug) ?? 0) > 0)
    .map((p) => computePartnerFit(p, account, targetSlug))
    .sort((a, b) => b.score - a.score);
}
