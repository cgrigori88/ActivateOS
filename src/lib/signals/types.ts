/**
 * Signal registry: every signal type carries its default half-life (decay)
 * and the scoring feature family it feeds. Negative families reduce scores
 * (PROJECT_BRIEF §4.3).
 */

export type SignalFamily =
  | "technology"
  | "trigger"
  | "initiative"
  | "momentum"
  | "partner"
  | "negative";

/**
 * Canonical signal families (DIRECTIVE §8): the vocabulary providers and
 * agents classify into. The scorer consumes the coarser scoring families
 * via CANONICAL_TO_SCORING — adding a canonical family never requires
 * touching scoring logic, only this mapping.
 */
export type CanonicalFamily =
  | "COMPANY_FIT"
  | "STRATEGIC_CHANGE"
  | "BUSINESS_TRIGGER"
  | "HIRING"
  | "ORGANIZATIONAL_CHANGE"
  | "TECHNOLOGY"
  | "TECHNOLOGY_ADJACENCY"
  | "TECHNOLOGY_CHANGE"
  | "ENGINEERING_ACTIVITY"
  | "COMMERCIAL_TIMING"
  | "PARTNER_RELATIONSHIP"
  | "SELLER_RELATIONSHIP"
  | "PURCHASE_HISTORY"
  | "CUSTOMER_ENGAGEMENT"
  | "NEGATIVE_BUSINESS"
  | "NEGATIVE_TECHNOLOGY"
  | "NEGATIVE_TIMING";

export const CANONICAL_TO_SCORING: Record<CanonicalFamily, SignalFamily> = {
  COMPANY_FIT: "initiative",
  STRATEGIC_CHANGE: "initiative",
  BUSINESS_TRIGGER: "trigger",
  HIRING: "momentum",
  ORGANIZATIONAL_CHANGE: "trigger",
  TECHNOLOGY: "technology",
  TECHNOLOGY_ADJACENCY: "technology",
  TECHNOLOGY_CHANGE: "trigger",
  ENGINEERING_ACTIVITY: "momentum",
  COMMERCIAL_TIMING: "trigger",
  PARTNER_RELATIONSHIP: "partner",
  SELLER_RELATIONSHIP: "partner",
  PURCHASE_HISTORY: "partner",
  CUSTOMER_ENGAGEMENT: "momentum",
  NEGATIVE_BUSINESS: "negative",
  NEGATIVE_TECHNOLOGY: "negative",
  NEGATIVE_TIMING: "negative",
};

export interface SignalDef {
  halfLifeDays: number;
  family: SignalFamily;
  direction: 1 | -1;
  /** canonical family for corroboration/convergence independence math */
  canonical?: CanonicalFamily;
}

/**
 * Canonical Signal Registry (BLUEPRINT §2C): agents never invent signal
 * names — they classify into this registry. Legacy names kept as rows so
 * existing data stays valid.
 */
export const SIGNAL_DEFS: Record<string, SignalDef> = {
  // Technology / installed base
  TECH_INSTALLED: { halfLifeDays: 720, family: "technology", direction: 1 },
  TECH_REMOVED: { halfLifeDays: 365, family: "technology", direction: -1 },
  // Initiatives
  INFRA_MODERNIZATION: { halfLifeDays: 180, family: "initiative", direction: 1 },
  INFRA_MODERNIZATION_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 }, // legacy alias
  AI_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 },
  CLOUD_MIGRATION: { halfLifeDays: 180, family: "initiative", direction: 1 },
  CYBERSECURITY_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 },
  SECURITY_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 }, // legacy alias
  // Triggers
  COST_REDUCTION: { halfLifeDays: 180, family: "trigger", direction: 1 },
  DATACENTER_EXPANSION: { halfLifeDays: 270, family: "trigger", direction: 1 },
  M_AND_A: { halfLifeDays: 270, family: "trigger", direction: 1 },
  CIO_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1 },
  EXECUTIVE_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1 },
  CONTRACT_EXPIRING: { halfLifeDays: 270, family: "trigger", direction: 1 },
  SOFTWARE_RENEWAL: { halfLifeDays: 270, family: "trigger", direction: 1 },
  HARDWARE_REFRESH: { halfLifeDays: 270, family: "trigger", direction: 1 },
  PUBLIC_RFP: { halfLifeDays: 120, family: "trigger", direction: 1 },
  // Momentum
  CLOUD_EXPANSION: { halfLifeDays: 180, family: "momentum", direction: 1 },
  HIRING_ACCELERATION: { halfLifeDays: 90, family: "momentum", direction: 1 },
  HIRING_TECH_SKILL: { halfLifeDays: 90, family: "momentum", direction: 1 },
  AUTOMATION_HIRING: { halfLifeDays: 90, family: "momentum", direction: 1 },
  PLATFORM_ENGINEERING_HIRING: { halfLifeDays: 90, family: "momentum", direction: 1 },
  KUBERNETES_HIRING: { halfLifeDays: 90, family: "momentum", direction: 1 },
  SPEND_ACCELERATION: { halfLifeDays: 120, family: "momentum", direction: 1 },
  CATEGORY_EXPANSION: { halfLifeDays: 180, family: "momentum", direction: 1 },
  // Partner / relationship
  PARTNER_RELATIONSHIP: { halfLifeDays: 720, family: "partner", direction: 1 },
  PARTNER_PURCHASE_HISTORY: { halfLifeDays: 365, family: "partner", direction: 1 },
  SELLER_RELATIONSHIP: { halfLifeDays: 365, family: "partner", direction: 1 },
  // Engagement (populated by Execute/Advance layers)
  CAMPAIGN_REPLY: { halfLifeDays: 60, family: "momentum", direction: 1 },
  MEETING: { halfLifeDays: 90, family: "momentum", direction: 1 },
  OPPORTUNITY: { halfLifeDays: 180, family: "trigger", direction: 1 },
  CLOSED_WON: { halfLifeDays: 720, family: "technology", direction: 1 },
  // Hiring intelligence (DIRECTIVE P0-A/B): change-over-time features, not
  // single postings. Emitted by the hiring pipeline's velocity analysis.
  PLATFORM_ENGINEERING_EXPANSION: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "HIRING" },
  AUTOMATION_HIRING_ACCELERATION: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "HIRING" },
  CLOUD_HIRING_ACCELERATION: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "HIRING" },
  AI_INFRASTRUCTURE_HIRING: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "HIRING" },
  SECURITY_TEAM_EXPANSION: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "HIRING" },
  NEW_TECHNOLOGY_LEADERSHIP: { halfLifeDays: 180, family: "trigger", direction: 1, canonical: "ORGANIZATIONAL_CHANGE" },
  // Technographic / network evidence (DIRECTIVE P0-F/G): supporting clues,
  // conservative weights — never definitive installed-base proof.
  VENDOR_INFRA_EVIDENCE: { halfLifeDays: 365, family: "technology", direction: 1, canonical: "TECHNOLOGY" },
  DNS_PROVIDER_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1, canonical: "TECHNOLOGY_CHANGE" },
  MAIL_PLATFORM_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1, canonical: "TECHNOLOGY_CHANGE" },
  SECURITY_GATEWAY_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1, canonical: "TECHNOLOGY_CHANGE" },
  // Engineering activity (DIRECTIVE P1-A)
  ENGINEERING_ACTIVITY_EXPANSION: { halfLifeDays: 120, family: "momentum", direction: 1, canonical: "ENGINEERING_ACTIVITY" },
  // Technographic change (DIRECTIVE P1-B): web-facing stack movement.
  TECHNOLOGY_ADDED: { halfLifeDays: 180, family: "trigger", direction: 1, canonical: "TECHNOLOGY_CHANGE" },
  TECHNOLOGY_STACK_CHANGE: { halfLifeDays: 120, family: "trigger", direction: 1, canonical: "TECHNOLOGY_CHANGE" },
  // Negative
  HIRING_FREEZE: { halfLifeDays: 120, family: "negative", direction: -1 },
  LAYOFFS: { halfLifeDays: 180, family: "negative", direction: -1 },
  BUDGET_REDUCTION: { halfLifeDays: 180, family: "negative", direction: -1 },
  RECENT_COMPETING_PURCHASE: { halfLifeDays: 365, family: "negative", direction: -1 },
  PROJECT_CANCELLATION: { halfLifeDays: 180, family: "negative", direction: -1 },
  PROJECT_DELAYED: { halfLifeDays: 120, family: "negative", direction: -1 },
  DEFERRED_TO_NEXT_FISCAL_YEAR: { halfLifeDays: 270, family: "negative", direction: -1 },
};

export const SIGNAL_TYPES = Object.keys(SIGNAL_DEFS) as [string, ...string[]];
