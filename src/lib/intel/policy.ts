/**
 * Provider usage hierarchy & orchestration policy (DATA SOURCE USAGE
 * HIERARCHY command). This module centralizes WHEN each provider fires and
 * WHAT it is allowed to mean — the decision layer that sits ABOVE the
 * providers. It never scores; it only decides which evidence-gathering runs.
 *
 * Master principle: cheap/structured sources build a preliminary picture for
 * every account; expensive/deep sources investigate only accounts that earn
 * it. Optimize for information gain per dollar, not API-call count.
 */

import { isCensysRelevant } from "./providers/censys";

export type ProviderTier =
  | "TIER0_FIRST_PARTY" // customer/partner commercial data — highest value
  | "TIER1_IDENTITY" // PDL company, entity resolution — run on ~every account
  | "TIER2_SIGNAL" // cheap commercial-signal collection — the baseline pass
  | "TIER3_DEEP"; // Tavily, PDL people, Wappalyzer, Censys — selective only

export type ResearchStage = "screen" | "deep" | "manual";

/** How each provider is gated. All fields optional; absent = no gate. */
export interface ProviderPolicy {
  tier: ProviderTier;
  /** one-line purpose (the §17 source-purpose matrix) */
  purpose: string;
  /** strategic-value rank (§19); 1 = highest. NOT a scoring weight. */
  priority: number;
  /** which stage(s) this provider participates in */
  stages: ResearchStage[];
  /** SEC and similar: only for public companies with applicable filings */
  requiresPublicCompany?: boolean;
  /** GitHub/Censys: only when the target solution is in a relevant category */
  categoryRelevant?: (targetSlug: string) => boolean;
  /** PDL people / Tavily: only after the account crosses a research threshold */
  requiresResearchTrigger?: boolean;
}

// GitHub is relevant to engineering-observable categories.
const GITHUB_RELEVANT = new Set([
  "kubernetes", "container-management", "containers", "infrastructure-automation",
  "network-automation", "security-automation", "configuration-management",
  "automation", "public-cloud", "hybrid-cloud", "cloud", "ai-platforms",
  "gpu-infrastructure", "databases", "observability",
]);

/**
 * The provider policy registry. Includes providers already retrofitted into
 * the normalized architecture (greenhouse/lever/dns/ipinfo/builtwith/
 * wappalyzer/censys) AND the ad-hoc sources still being retrofitted
 * (pdl_company/pdl_people/sec_edgar/tavily/website/github/gdelt) so the
 * orchestration policy is complete and testable now.
 */
export const PROVIDER_POLICY: Record<string, ProviderPolicy> = {
  // ── Tier 0: first-party commercial data (highest value when supplied) ──
  customer_outcomes: { tier: "TIER0_FIRST_PARTY", purpose: "historical wins/losses", priority: 1, stages: ["screen"] },
  partner_transactions: { tier: "TIER0_FIRST_PARTY", purpose: "partner transaction/relationship history", priority: 2, stages: ["screen"] },
  installed_base: { tier: "TIER0_FIRST_PARTY", purpose: "installed products & renewals", priority: 7, stages: ["screen"] },

  // ── Tier 1: identity + firmographic base profile ──
  pdl_company: { tier: "TIER1_IDENTITY", purpose: "identity / firmographics / ICP fit", priority: 5, stages: ["screen"] },

  // ── Tier 2: cheap commercial-signal collection ──
  sec_edgar: {
    tier: "TIER2_SIGNAL",
    purpose: "strategic initiative / economic trigger / negative business",
    priority: 3,
    stages: ["screen", "deep"],
    requiresPublicCompany: true,
  },
  greenhouse: { tier: "TIER2_SIGNAL", purpose: "hiring momentum", priority: 4, stages: ["screen"] },
  lever: { tier: "TIER2_SIGNAL", purpose: "hiring momentum", priority: 4, stages: ["screen"] },
  careers: { tier: "TIER2_SIGNAL", purpose: "hiring momentum (no ATS)", priority: 4, stages: ["screen"] },
  website: { tier: "TIER2_SIGNAL", purpose: "first-party strategic change", priority: 6, stages: ["screen"] },
  gdelt: { tier: "TIER2_SIGNAL", purpose: "corporate-event discovery radar", priority: 10, stages: ["screen"] },
  github: {
    tier: "TIER2_SIGNAL",
    purpose: "engineering activity / momentum",
    priority: 8,
    stages: ["screen", "deep"],
    categoryRelevant: (slug) => GITHUB_RELEVANT.has(slug),
  },
  builtwith: { tier: "TIER2_SIGNAL", purpose: "technographic evidence", priority: 9, stages: ["screen", "deep"] },
  dns: { tier: "TIER2_SIGNAL", purpose: "inexpensive technology fingerprint", priority: 9, stages: ["screen"] },
  http_fingerprint: { tier: "TIER2_SIGNAL", purpose: "web-tech fingerprint", priority: 9, stages: ["screen"] },
  ipinfo: { tier: "TIER2_SIGNAL", purpose: "network context", priority: 13, stages: ["screen"] },

  // ── Tier 3: deep research — selective, expensive ──
  tavily: {
    tier: "TIER3_DEEP",
    purpose: "investigation / corroboration / ambiguity resolution",
    priority: 11,
    stages: ["deep"],
    requiresResearchTrigger: true,
  },
  pdl_people: {
    tier: "TIER3_DEEP",
    purpose: "buying committee / persona identification",
    priority: 5,
    stages: ["deep"],
    requiresResearchTrigger: true,
  },
  wappalyzer: { tier: "TIER3_DEEP", purpose: "technographic corroboration", priority: 12, stages: ["deep"] },
  censys: {
    tier: "TIER3_DEEP",
    purpose: "specialized public-infrastructure research",
    priority: 14,
    stages: ["deep"],
    categoryRelevant: isCensysRelevant,
  },
  common_crawl: { tier: "TIER3_DEEP", purpose: "historical company-change intelligence", priority: 15, stages: ["deep"] },
};

export interface ProviderDecisionContext {
  providerId: string;
  targetSlug: string;
  researchStage: ResearchStage;
  isPublicCompany: boolean;
  /** true once the account has crossed the deep-research gate (§12) */
  researchTriggered: boolean;
  /** provider registry state — disabled providers never run */
  enabled: boolean;
}

export interface ProviderDecision {
  run: boolean;
  reason: string;
}

/**
 * The provider decision function (§20): given an account's context and a
 * provider, decide whether that provider should run now — and always return
 * WHY, so orchestration is auditable. Pure and fully testable.
 */
export function shouldRunProvider(ctx: ProviderDecisionContext): ProviderDecision {
  const policy = PROVIDER_POLICY[ctx.providerId];
  if (!policy) return { run: false, reason: "no policy registered" };
  if (!ctx.enabled) return { run: false, reason: "provider disabled" };

  if (!policy.stages.includes(ctx.researchStage)) {
    return { run: false, reason: `not a ${ctx.researchStage}-stage provider` };
  }
  if (policy.requiresPublicCompany && !ctx.isPublicCompany) {
    return { run: false, reason: "no applicable SEC/public-company filings" };
  }
  if (policy.categoryRelevant && !policy.categoryRelevant(ctx.targetSlug)) {
    return { run: false, reason: `not relevant to ${ctx.targetSlug}` };
  }
  // Deep-only triggers apply in the deep stage; a manual run overrides them.
  if (
    policy.requiresResearchTrigger &&
    ctx.researchStage === "deep" &&
    !ctx.researchTriggered
  ) {
    return { run: false, reason: "account has not crossed the research threshold" };
  }
  return { run: true, reason: `tier ${policy.tier}: ${policy.purpose}` };
}

/** Strategic-value ordering (§19) — architectural usage, NOT scoring weight. */
export function sourcePriorityOrder(): string[] {
  return Object.entries(PROVIDER_POLICY)
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([id]) => id);
}
