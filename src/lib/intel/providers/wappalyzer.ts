import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * Wappalyzer technographics (DIRECTIVE P1-C) — adapter present, provider
 * DISABLED: the Technology Lookup API is not available on the current free
 * plan. Registered with enabled=false and the reason on record so the state
 * is visible in provider tooling, per the directive's provider-disabled
 * requirement. If a paid plan is ever justified (BuiltWith-vs-Wappalyzer
 * comparison, §P1-C), implement fetch/normalize behind the same
 * TechnographicProvider pattern as BuiltWith and clear disabledReason.
 */
export class WappalyzerProvider implements IntelligenceProvider {
  providerId = "wappalyzer";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.75;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];
  disabledReason = "DISABLED_NO_PLAN_ACCESS";

  async fetch(_target: IntelligenceTarget): Promise<RawObservationInput[]> {
    return []; // disabled — the pipeline skips before this runs anyway
  }

  normalize(): EvidenceCandidate[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: false, detail: this.disabledReason };
  }
}
