import type pg from "pg";
import { SIGNAL_DEFS } from "../signals/types";
import { computeCompleteness, type CompletenessResult } from "./completeness";

/**
 * Read-only intelligence surface for one company (DIRECTIVE §43). Assembles
 * the account room's "what do we actually know, and how well do we know it"
 * view from the evidence / provider_runs / signals tables. Pure data assembly —
 * never scores, never mutates.
 */

export interface EvidenceRow {
  claim: string;
  sourceType: string | null;
  providerId: string | null;
  status: string;
  stance: string;
  confidence: number | null;
  firstParty: boolean | null;
  collectedAt: Date;
}

export interface ProviderCoverageRow {
  providerId: string;
  status: string; // latest run status
  runs: number;
  succeeded: number;
  evidence: number;
  lastRunAt: Date | null;
}

export interface CompanyIntel {
  evidence: EvidenceRow[];
  completeness: CompletenessResult;
  coverage: ProviderCoverageRow[];
  counts: { verified: number; quarantined: number; rejected: number; total: number };
}

/** Canonical families the company has any signal for — feeds completeness. */
function familiesFromSignalTypes(types: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of types) {
    const canonical = SIGNAL_DEFS[t]?.canonical;
    if (canonical) out.add(canonical);
  }
  return out;
}

export async function loadCompanyIntel(pool: pg.Pool | pg.PoolClient, companyId: string): Promise<CompanyIntel> {
  const [evidenceRes, coverageRes, signalRes] = await Promise.all([
    pool.query(
      `select claim, source_type, provider_id, status, stance, computed_confidence, first_party, collected_at
       from evidence where company_id = $1
       order by collected_at desc limit 40`,
      [companyId],
    ),
    pool.query(
      `select provider_id,
              count(*) as runs,
              count(*) filter (where status = 'succeeded') as succeeded,
              coalesce(sum(evidence_created), 0) as evidence,
              max(finished_at) as last_run_at,
              (array_agg(status order by started_at desc))[1] as latest_status
       from provider_runs where company_id = $1
       group by provider_id
       order by max(finished_at) desc nulls last`,
      [companyId],
    ),
    pool.query(`select distinct signal_type from signals where company_id = $1`, [companyId]),
  ]);

  const evidence: EvidenceRow[] = evidenceRes.rows.map((r) => ({
    claim: r.claim,
    sourceType: r.source_type,
    providerId: r.provider_id,
    status: r.status,
    stance: r.stance ?? "supports",
    confidence: r.computed_confidence == null ? null : Number(r.computed_confidence),
    firstParty: r.first_party,
    collectedAt: r.collected_at,
  }));

  const counts = {
    total: evidence.length,
    verified: evidence.filter((e) => e.status === "verified").length,
    quarantined: evidence.filter((e) => e.status === "quarantined").length,
    rejected: evidence.filter((e) => e.status === "rejected").length,
  };

  const coverage: ProviderCoverageRow[] = coverageRes.rows.map((r) => ({
    providerId: r.provider_id,
    status: r.latest_status,
    runs: Number(r.runs),
    succeeded: Number(r.succeeded),
    evidence: Number(r.evidence),
    lastRunAt: r.last_run_at,
  }));

  const providersRun = new Set(coverage.filter((c) => c.succeeded > 0).map((c) => c.providerId));
  const familiesPresent = familiesFromSignalTypes(signalRes.rows.map((r) => r.signal_type));
  const completeness = computeCompleteness({ providersRun, familiesPresent });

  return { evidence, completeness, coverage, counts };
}
