import type { TransactionSignalProvider, TransactionFeatureOut, FeatureRequest, FederatedAnswer } from "./provider";

/**
 * Synthetic distributor provider (Workstream C, §46/§47). A DERIVED-mode provider for the
 * demo/verification only — every feature is flagged simulated and clearly labeled. NEVER
 * implies a live distributor feed. Used to demonstrate transaction truth strengthening a route
 * (the TD SYNNEX hero) without any real connection.
 */

export interface SyntheticFeatureSpec { companyId: string; features: TransactionFeatureOut[]; federated?: FederatedAnswer; }

export function syntheticDistributorProvider(name: string, specs: SyntheticFeatureSpec[]): TransactionSignalProvider {
  const byCompany = new Map(specs.map((s) => [s.companyId, s]));
  return {
    name, mode: "DERIVED", isSimulated: true,
    async fetchFeatures(req: FeatureRequest): Promise<TransactionFeatureOut[]> {
      const spec = byCompany.get(req.canonicalCompanyId);
      // Label every synthetic feature so it can never be mistaken for a live signal.
      return (spec?.features ?? []).map((f) => ({ ...f, featureText: `${f.featureText ?? ""} [synthetic distributor-derived signal for demonstration]`.trim() }));
    },
    async query(req: FeatureRequest): Promise<FederatedAnswer> {
      return byCompany.get(req.canonicalCompanyId)?.federated ?? { present: false };
    },
  };
}
