import type { CanonicalFamily } from "../signals/types";

/**
 * Data completeness by category (§24): how thoroughly each dimension of an
 * account has been researched — kept strictly SEPARATE from propensity.
 * Missing data is not low intent; a high-propensity / low-completeness
 * account is a research target, not a weak account.
 */

export const COVERAGE_CATEGORIES = [
  "identity",
  "strategic",
  "hiring",
  "technology",
  "engineering",
  "relationship",
  "timing",
  "people",
] as const;
export type CoverageCategory = (typeof COVERAGE_CATEGORIES)[number];

/** Which providers, having run, count as coverage for each category. */
const CATEGORY_PROVIDERS: Record<CoverageCategory, string[]> = {
  identity: ["pdl_company"],
  strategic: ["sec_edgar", "website", "gdelt"],
  hiring: ["greenhouse", "lever", "careers"],
  technology: ["builtwith_free", "builtwith_domain", "dns", "http_fingerprint", "wappalyzer", "censys"],
  engineering: ["github"],
  relationship: ["partner_transactions", "customer_outcomes"],
  timing: ["sec_edgar", "installed_base", "renewals"],
  people: ["pdl_people"],
};

/** Canonical families that, if present as evidence, also satisfy a category. */
const CATEGORY_FAMILIES: Partial<Record<CoverageCategory, CanonicalFamily[]>> = {
  strategic: ["STRATEGIC_CHANGE", "BUSINESS_TRIGGER"],
  hiring: ["HIRING"],
  technology: ["TECHNOLOGY", "TECHNOLOGY_CHANGE", "TECHNOLOGY_ADJACENCY"],
  engineering: ["ENGINEERING_ACTIVITY"],
  timing: ["COMMERCIAL_TIMING"],
  relationship: ["PARTNER_RELATIONSHIP", "SELLER_RELATIONSHIP", "PURCHASE_HISTORY"],
};

export interface CompletenessInput {
  /** provider ids that ran successfully for this account */
  providersRun: Set<string>;
  /** canonical families for which the account has verified evidence */
  familiesPresent: Set<string>;
}

export interface CompletenessResult {
  byCategory: Record<CoverageCategory, boolean>;
  /** 0-100: share of categories with any coverage */
  overall: number;
  /** categories with no coverage yet — the research to-do list */
  gaps: CoverageCategory[];
}

export function computeCompleteness(input: CompletenessInput): CompletenessResult {
  const byCategory = {} as Record<CoverageCategory, boolean>;
  for (const cat of COVERAGE_CATEGORIES) {
    const providerHit = CATEGORY_PROVIDERS[cat].some((p) => input.providersRun.has(p));
    const familyHit = (CATEGORY_FAMILIES[cat] ?? []).some((f) => input.familiesPresent.has(f));
    byCategory[cat] = providerHit || familyHit;
  }
  const covered = COVERAGE_CATEGORIES.filter((c) => byCategory[c]).length;
  return {
    byCategory,
    overall: Math.round((covered / COVERAGE_CATEGORIES.length) * 100),
    gaps: COVERAGE_CATEGORIES.filter((c) => !byCategory[c]),
  };
}
