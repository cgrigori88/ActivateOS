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

export interface SignalDef {
  halfLifeDays: number;
  family: SignalFamily;
  direction: 1 | -1;
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
