import type pg from "pg";
import { ensureProviderRow, runProvider, type ProviderRunResult } from "./pipeline";
import { shouldRunProvider } from "./policy";
import { allProviders, registerProvider, type IntelligenceTarget } from "./provider";
import {
  BuiltWithChangeProvider,
  BuiltWithDomainProvider,
  BuiltWithFreeProvider,
} from "./providers/builtwith";
import { CareersProvider } from "./providers/careers";
import { CensysProvider } from "./providers/censys";
import { DnsProvider } from "./providers/dns";
import { GdeltProvider } from "./providers/gdelt";
import { GithubProvider } from "./providers/github";
import { HttpFingerprintProvider } from "./providers/http-fingerprint";
import { IpinfoProvider } from "./providers/ipinfo";
import { GreenhouseProvider } from "./providers/greenhouse";
import { LeverProvider } from "./providers/lever";
import { PdlCompanyProvider, PdlPeopleProvider } from "./providers/pdl";
import { SecProvider } from "./providers/sec";
import { WappalyzerProvider } from "./providers/wappalyzer";
import { WebsiteProvider } from "./providers/website";

/**
 * Two-stage research (DIRECTIVE §34, mandatory for cost efficiency):
 *
 *  STAGE 1 — CHEAP SCREEN: free providers (hiring boards, DNS, existing
 *  EDGAR) build a preliminary picture for EVERY account.
 *
 *  STAGE 2 — DEEP RESEARCH: Tavily/LLM spend goes ONLY to accounts that
 *  earn it — the escalation rules below decide, and every decision lands in
 *  research_jobs with its reason.
 */

let registered = false;
export function registerBuiltinProviders(): void {
  if (registered) return;
  registerProvider(new PdlCompanyProvider());
  registerProvider(new PdlPeopleProvider());
  registerProvider(new SecProvider());
  registerProvider(new GreenhouseProvider());
  registerProvider(new LeverProvider());
  registerProvider(new CareersProvider());
  registerProvider(new GithubProvider());
  registerProvider(new WebsiteProvider());
  registerProvider(new GdeltProvider());
  registerProvider(new DnsProvider());
  registerProvider(new HttpFingerprintProvider());
  registerProvider(new BuiltWithFreeProvider());
  registerProvider(new BuiltWithDomainProvider());
  registerProvider(new BuiltWithChangeProvider());
  registerProvider(new IpinfoProvider());
  registerProvider(new WappalyzerProvider());
  registerProvider(new CensysProvider());
  registered = true;
}

export interface ScreenOptions {
  targetSlug?: string;
  isPublicCompany?: boolean;
}

/**
 * Stage 1 — low-cost screen (§21). Consults the orchestration policy
 * (shouldRunProvider) so each provider fires only when its gates permit, and
 * every decision — run or skip — is auditable via its reason.
 */
export async function screenCompany(
  db: pg.PoolClient,
  target: IntelligenceTarget,
  opts: ScreenOptions = {},
): Promise<Record<string, ProviderRunResult>> {
  registerBuiltinProviders();
  const targetSlug = opts.targetSlug ?? "infrastructure-automation";
  const results: Record<string, ProviderRunResult> = {};
  const withSlug: IntelligenceTarget = { ...target, targetSlug };
  for (const provider of allProviders()) {
    // Every provider registers a row — disabled/specialized states must be
    // VISIBLE in the registry, never silently absent.
    await ensureProviderRow(db, provider);
    const decision = shouldRunProvider({
      providerId: provider.providerId,
      targetSlug,
      researchStage: "screen",
      isPublicCompany: opts.isPublicCompany ?? false,
      researchTriggered: false,
      enabled: !provider.disabledReason,
    });
    if (!decision.run) continue;
    // Fault isolation is inside runProvider — one failure never stops the rest.
    results[provider.providerId] = await runProvider(db, provider, withSlug, { stage: "screen" });
  }
  return results;
}

/**
 * Stage 2 — deep research per pursuit (§13, §21). Runs deep-stage providers
 * only when the policy permits: category-gated (Censys, GitHub), threshold-
 * gated (Tavily, PDL people), etc. researchTriggered=true is the account
 * having crossed the gate; a manual call can force it.
 */
export async function deepResearchCompany(
  db: pg.PoolClient,
  target: IntelligenceTarget,
  targetSlug: string,
  opts: { researchTriggered?: boolean; isPublicCompany?: boolean } = {},
): Promise<Record<string, ProviderRunResult>> {
  registerBuiltinProviders();
  const results: Record<string, ProviderRunResult> = {};
  const withSlug: IntelligenceTarget = { ...target, targetSlug };
  for (const provider of allProviders()) {
    await ensureProviderRow(db, provider);
    if (provider.costClass === "PREMIUM") continue;
    const decision = shouldRunProvider({
      providerId: provider.providerId,
      targetSlug,
      researchStage: "deep",
      isPublicCompany: opts.isPublicCompany ?? false,
      researchTriggered: opts.researchTriggered ?? true,
      enabled: !provider.disabledReason,
    });
    if (!decision.run) continue;
    results[provider.providerId] = await runProvider(db, provider, withSlug, { stage: "deep" });
  }
  return results;
}

/** Escalation rules (§21, §34) — pure and auditable. */
export interface EscalationInput {
  score: number;
  band: string;
  evidenceConfidence: number | null; // 0-100 dimension
  dataCompleteness: number | null; // 0-100
  openContradictions: number;
  estimatedValueUsd: number | null;
}

export type EscalationReason =
  | "high_propensity_low_confidence"
  | "high_value_low_completeness"
  | "signal_contradiction"
  | "score_near_threshold";

const BAND_THRESHOLDS = [80, 60, 40];

export function escalationReason(input: EscalationInput): EscalationReason | null {
  if (input.openContradictions > 0) return "signal_contradiction";
  if (
    (input.band === "very_high" || input.band === "high") &&
    input.evidenceConfidence != null &&
    input.evidenceConfidence < 60
  ) {
    return "high_propensity_low_confidence";
  }
  if (
    input.estimatedValueUsd != null &&
    input.estimatedValueUsd >= 100_000 &&
    input.dataCompleteness != null &&
    input.dataCompleteness < 50
  ) {
    return "high_value_low_completeness";
  }
  if (BAND_THRESHOLDS.some((t) => Math.abs(input.score - t) <= 5)) {
    return "score_near_threshold";
  }
  return null;
}

/**
 * Data completeness (§20): how much of the enabled screening surface has
 * actually looked at this account. Missing data is NOT low propensity —
 * this number keeps the two from being confused.
 */
export function dataCompleteness(coveredProviders: number, enabledProviders: number): number {
  if (enabledProviders === 0) return 0;
  return Math.round((coveredProviders / enabledProviders) * 100);
}

/** Evaluate an org's scored accounts and enqueue deep-research jobs. */
export async function enqueueDeepResearch(
  db: pg.PoolClient,
  orgId: string,
): Promise<{ enqueued: number }> {
  registerBuiltinProviders();
  const enabledCount = allProviders().length;

  const { rows: accounts } = await db.query<{
    company_id: string;
    score: string;
    band: string;
    confidence: string | null;
    contradictions: string;
    covered: string;
    est_value: string | null;
  }>(
    `select p.company_id, p.score, p.band,
       (select d.value from propensity_dimensions d
         where d.score_id = p.id and d.dimension = 'evidence_confidence') as confidence,
       (select count(*) from contradictions ct
         where ct.company_id = p.company_id and ct.status = 'open') as contradictions,
       (select count(distinct pr.provider_id) from provider_runs pr
         where pr.company_id = p.company_id and pr.status = 'succeeded') as covered,
       (select m.estimated_value_usd from revenue_motions m
         where m.company_id = p.company_id order by m.created_at desc limit 1) as est_value
     from (
       select distinct on (company_id) id, company_id, score, band
       from propensity_scores where org_id = $1
       order by company_id, computed_at desc
     ) p`,
    [orgId],
  );

  let enqueued = 0;
  for (const a of accounts) {
    const reason = escalationReason({
      score: Number(a.score),
      band: a.band,
      evidenceConfidence: a.confidence == null ? null : Number(a.confidence),
      dataCompleteness: dataCompleteness(Number(a.covered), enabledCount),
      openContradictions: Number(a.contradictions),
      estimatedValueUsd: a.est_value == null ? null : Number(a.est_value),
    });
    if (!reason) continue;
    const { rowCount } = await db.query(
      `insert into research_jobs (org_id, company_id, reason, priority)
       select $1, $2, $3, $4
       where not exists (
         select 1 from research_jobs
         where company_id = $2 and status = 'pending')`,
      [orgId, a.company_id, reason, Number(a.score)],
    );
    enqueued += rowCount ?? 0;
  }
  return { enqueued };
}
