import type pg from "pg";
import { PROVIDER_POLICY, type ProviderTier } from "./policy";
import { allProviders } from "./provider";
import { registerBuiltinProviders } from "./screen";

/**
 * Provider health & registry state (DIRECTIVE §44). Merges the in-CODE
 * registry — the source of truth for what exists, its tier/purpose, and its
 * live disabled state (credit/plan gates read env at call time) — with DB run
 * statistics from provider_runs. A provider that is disabled or has never run
 * is VISIBLE here, never silently absent.
 */

export interface ProviderHealthRow {
  providerId: string;
  providerType: string;
  costClass: string;
  tier: ProviderTier | "UNSCOPED";
  purpose: string;
  priority: number;
  stages: string[];
  disabledReason?: string;
  allowedForScreening: boolean;
  // run stats (all-time, across companies)
  runs: number;
  succeeded: number;
  failed: number;
  skipped: number;
  evidence: number;
  costUsd: number;
  lastStatus: string | null;
  lastRunAt: Date | null;
}

const TIER_ORDER: Record<string, number> = {
  TIER0_FIRST_PARTY: 0,
  TIER1_IDENTITY: 1,
  TIER2_SIGNAL: 2,
  TIER3_DEEP: 3,
  UNSCOPED: 4,
};

export async function loadProviderHealth(pool: pg.Pool): Promise<ProviderHealthRow[]> {
  registerBuiltinProviders();

  const { rows: stats } = await pool.query(
    `select provider_id,
            count(*) as runs,
            count(*) filter (where status = 'succeeded') as succeeded,
            count(*) filter (where status = 'failed') as failed,
            count(*) filter (where status = 'skipped') as skipped,
            coalesce(sum(evidence_created), 0) as evidence,
            coalesce(sum(cost_usd), 0) as cost_usd,
            max(finished_at) as last_run_at,
            (array_agg(status order by started_at desc))[1] as last_status
     from provider_runs group by provider_id`,
  );
  const byId = new Map(stats.map((r) => [r.provider_id, r]));

  const rows: ProviderHealthRow[] = allProviders().map((p) => {
    const policy = PROVIDER_POLICY[p.providerId];
    const s = byId.get(p.providerId);
    return {
      providerId: p.providerId,
      providerType: p.providerType,
      costClass: p.costClass,
      tier: policy?.tier ?? "UNSCOPED",
      purpose: policy?.purpose ?? "—",
      priority: policy?.priority ?? 99,
      stages: policy?.stages ?? [],
      disabledReason: p.disabledReason,
      allowedForScreening: p.allowedForScreening !== false,
      runs: s ? Number(s.runs) : 0,
      succeeded: s ? Number(s.succeeded) : 0,
      failed: s ? Number(s.failed) : 0,
      skipped: s ? Number(s.skipped) : 0,
      evidence: s ? Number(s.evidence) : 0,
      costUsd: s ? Number(s.cost_usd) : 0,
      lastStatus: s ? s.last_status : null,
      lastRunAt: s ? s.last_run_at : null,
    };
  });

  return rows.sort(
    (a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || (a.priority - b.priority),
  );
}

export const TIER_LABELS: Record<string, string> = {
  TIER0_FIRST_PARTY: "Tier 0 · First-party",
  TIER1_IDENTITY: "Tier 1 · Identity",
  TIER2_SIGNAL: "Tier 2 · Signal (screen)",
  TIER3_DEEP: "Tier 3 · Deep (selective)",
  UNSCOPED: "Unscoped",
};
