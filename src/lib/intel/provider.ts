/**
 * Normalized intelligence-provider architecture (DIRECTIVE §1).
 *
 * Every external source flows: SOURCE → RAW RECORD → ENTITY RESOLUTION →
 * EVIDENCE → SIGNAL EXTRACTION → TAXONOMY MAPPING → TRUST/CONFIDENCE →
 * CORROBORATION → SCORING → MOTION.
 *
 * Providers produce observations and evidence candidates. They NEVER touch
 * a propensity score, and no provider-specific logic exists downstream of
 * the Evidence boundary — the scorer reasons about signal families only.
 */

import type { CanonicalFamily } from "../signals/types";

export type ProviderType =
  | "FIRST_PARTY"
  | "CUSTOMER_UPLOAD"
  | "PARTNER_UPLOAD"
  | "PUBLIC_COMPANY"
  | "PUBLIC_NEWS"
  | "HIRING"
  | "DEVELOPER"
  | "TECHNOGRAPHIC"
  | "NETWORK"
  | "CORPORATE_EVENT"
  | "FIRMOGRAPHIC"
  | "PEOPLE"
  | "COMMUNICATION"
  | "PRODUCT_USAGE"
  | "PREMIUM_INTENT"
  | "DISTRIBUTOR";

export type CostClass = "FREE" | "LOW_COST" | "CUSTOMER_OWNED" | "PREMIUM";

export interface IntelligenceTarget {
  orgId: string | null;
  companyId: string;
  companyName: string;
  domain: string | null;
  /** provider-specific handles discovered earlier (e.g. greenhouse board token) */
  handles?: Record<string, string>;
}

export interface RawObservationInput {
  externalRecordId?: string;
  sourceUrl?: string;
  sourcePublishedAt?: Date | null;
  payload: unknown;
  /** stable hash of the meaningful content — the dedupe/change-detection key */
  contentHash: string;
  costUsd?: number;
}

export interface EvidenceCandidate {
  claim: string;
  excerpt?: string;
  sourceUrl?: string;
  confidence: number; // extraction confidence 0..1
  firstParty: boolean;
  publishedAt?: Date | null;
  observedAt?: Date;
  /** provider's suggested classification — the central pipeline may override */
  suggestedSignalType?: string;
  suggestedNodeSlug?: string;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
}

export interface IntelligenceProvider {
  providerId: string;
  providerType: ProviderType;
  costClass: CostClass;
  supportedFamilies: CanonicalFamily[];
  /**
   * Initial source-trust prior for the quality gates. A company's own job
   * board is first-party fact (high); an interpreted DNS artifact is a clue
   * (lower). Trust still EVOLVES from audit outcomes after bootstrap.
   */
  sourceTrustPrior: number;
  sourceKind: "first_party" | "external";
  /** optional cheap discovery (e.g. find the careers board token) */
  discover?(target: IntelligenceTarget): Promise<Record<string, string> | null>;
  fetch(target: IntelligenceTarget): Promise<RawObservationInput[]>;
  /**
   * Turn this fetch's observations plus provider history into evidence
   * candidates. `current` is the complete present state (isNew marks
   * observations unseen before); `history` is prior stored observations —
   * what makes velocity and change-over-time features possible.
   */
  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[];
  healthCheck(): Promise<ProviderHealth>;
}

const registry = new Map<string, IntelligenceProvider>();

export function registerProvider(p: IntelligenceProvider): void {
  registry.set(p.providerId, p);
}

export function getProvider(id: string): IntelligenceProvider | undefined {
  return registry.get(id);
}

export function allProviders(): IntelligenceProvider[] {
  return [...registry.values()];
}
