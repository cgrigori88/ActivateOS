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

export const SIGNAL_DEFS: Record<string, SignalDef> = {
  TECH_INSTALLED: { halfLifeDays: 720, family: "technology", direction: 1 },
  CONTRACT_EXPIRING: { halfLifeDays: 270, family: "trigger", direction: 1 },
  INFRA_MODERNIZATION_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 },
  AI_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 },
  SECURITY_INITIATIVE: { halfLifeDays: 180, family: "initiative", direction: 1 },
  COST_REDUCTION: { halfLifeDays: 180, family: "trigger", direction: 1 },
  M_AND_A: { halfLifeDays: 270, family: "trigger", direction: 1 },
  EXECUTIVE_CHANGE: { halfLifeDays: 180, family: "trigger", direction: 1 },
  DATACENTER_EXPANSION: { halfLifeDays: 270, family: "trigger", direction: 1 },
  PUBLIC_RFP: { halfLifeDays: 120, family: "trigger", direction: 1 },
  CLOUD_EXPANSION: { halfLifeDays: 180, family: "momentum", direction: 1 },
  HIRING_ACCELERATION: { halfLifeDays: 90, family: "momentum", direction: 1 },
  HIRING_TECH_SKILL: { halfLifeDays: 90, family: "momentum", direction: 1 },
  SPEND_ACCELERATION: { halfLifeDays: 120, family: "momentum", direction: 1 },
  PARTNER_RELATIONSHIP: { halfLifeDays: 720, family: "partner", direction: 1 },
  HIRING_FREEZE: { halfLifeDays: 120, family: "negative", direction: -1 },
  LAYOFFS: { halfLifeDays: 180, family: "negative", direction: -1 },
  BUDGET_REDUCTION: { halfLifeDays: 180, family: "negative", direction: -1 },
  RECENT_COMPETING_PURCHASE: { halfLifeDays: 365, family: "negative", direction: -1 },
  PROJECT_CANCELLATION: { halfLifeDays: 180, family: "negative", direction: -1 },
};

export const SIGNAL_TYPES = Object.keys(SIGNAL_DEFS) as [string, ...string[]];
