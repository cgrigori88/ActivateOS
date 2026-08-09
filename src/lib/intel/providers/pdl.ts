import type pg from "pg";
import { normalizeDomain } from "../domain";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * People Data Labs, split per §3 / §22:
 *
 *   pdl_company — Tier 1 IDENTITY, SCREEN, enabled. Canonical firmographics
 *                 for the company entity + ICP context. NEVER person-search
 *                 credits here. Firmographics establish FIT, not intent — so
 *                 this produces provenance EVIDENCE and enriches the company
 *                 record, but emits NO propensity signal (size/industry never
 *                 become purchase intent).
 *
 *   pdl_people  — Tier 3 PEOPLE, DEEP, threshold-gated. Only after an account
 *                 crosses the research gate, and only the motion-relevant
 *                 personas — never every employee. Mandatory for credit
 *                 efficiency; the policy layer enforces the gate.
 */

const COMPANY_API = "https://api.peopledatalabs.com/v5/company/enrich";
const PERSON_API = "https://api.peopledatalabs.com/v5/person/search";

function apiKey(): string | null {
  return process.env.PDL_API_KEY ?? null;
}

// ── Company (Tier 1 identity) ────────────────────────────────────────────────

export interface PdlCompanyRecord {
  name: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  region: string | null;
  founded: number | null;
  ticker: string | null; // present → public company (feeds the SEC gate)
  type: string | null; // public / private / etc.
  summary: string | null;
}

export class PdlCompanyProvider implements IntelligenceProvider {
  providerId = "pdl_company";
  providerType = "FIRMOGRAPHIC" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.85;
  sourceKind = "external" as const;
  supportedFamilies = ["COMPANY_FIT" as const];
  minRefreshHours = 24 * 90; // firmographics change slowly

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = apiKey();
    const domain = normalizeDomain(target.domain);
    if (!key || !domain) return []; // SKIP_NO_DOMAIN — identity needs a domain

    const res = await fetch(`${COMPANY_API}?website=${encodeURIComponent(domain)}`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`pdl_company HTTP ${res.status}`);
    const d = (await res.json()) as {
      status: number;
      name?: string;
      industry?: string;
      employee_count?: number;
      location?: { country?: string; region?: string };
      founded?: number;
      ticker?: string;
      type?: string;
      summary?: string;
    };
    if (d.status !== 200) return [];
    const rec: PdlCompanyRecord = {
      name: d.name ?? null,
      industry: d.industry ?? null,
      employeeCount: d.employee_count ?? null,
      country: d.location?.country ?? null,
      region: d.location?.region ?? null,
      founded: d.founded ?? null,
      ticker: d.ticker ?? null,
      type: d.type ?? null,
      summary: d.summary ?? null,
    };
    return [
      {
        sourceUrl: `https://peopledatalabs.com/company/${domain}`,
        payload: { domain, record: rec },
        contentHash: contentHash(`pdlco:${domain}:${rec.employeeCount}:${rec.industry}:${rec.ticker}`),
        costUsd: 0.01,
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const { record } = current[0].payload as { domain: string; record: PdlCompanyRecord };
    const facts: string[] = [];
    if (record.industry) facts.push(`operates in ${record.industry}`);
    if (record.employeeCount) facts.push(`~${record.employeeCount.toLocaleString()} employees`);
    if (record.country) facts.push(`headquartered in ${record.country}`);
    if (record.founded) facts.push(`founded ${record.founded}`);
    if (record.ticker) facts.push(`publicly traded (${record.ticker})`);
    if (facts.length === 0) return [];

    // Firmographic EVIDENCE only — NO suggestedSignalType. Establishes
    // identity/fit and provenance; never inflates purchase propensity (§3).
    return [
      {
        claim: `${target.companyName} firmographic profile: ${facts.join(", ")}`,
        sourceUrl: `https://peopledatalabs.com`,
        confidence: 0.85,
        firstParty: false,
      },
    ];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const key = apiKey();
    if (!key) return { ok: false, detail: "PDL_API_KEY not set" };
    return { ok: true, detail: "PDL company enrich configured" };
  }
}

/**
 * Apply PDL firmographics to the company entity — identity enrichment.
 * Called after screening; reads the latest pdl_company observation and
 * fills employee_count / industry / country where the record is thin.
 * Returns whether the account is public (has a ticker) for the SEC gate.
 */
export async function applyPdlFirmographics(
  db: pg.PoolClient,
  companyId: string,
): Promise<{ isPublic: boolean }> {
  const { rows } = await db.query<{ raw_payload: { record: PdlCompanyRecord } }>(
    `select raw_payload from raw_observations
     where provider_id = 'pdl_company' and company_id = $1
     order by observed_at desc limit 1`,
    [companyId],
  );
  if (rows.length === 0) return { isPublic: false };
  const r = rows[0].raw_payload.record;
  await db.query(
    `update companies set
       employee_count = coalesce(employee_count, $2),
       industry = coalesce(industry, $3),
       country = coalesce(country, $4)
     where id = $1`,
    [companyId, r.employeeCount, r.industry, r.country],
  );
  return { isPublic: Boolean(r.ticker) };
}

// ── People (Tier 3 deep, threshold-gated) ────────────────────────────────────

/**
 * The technical buying committee for an infrastructure/platform motion (§3),
 * expressed in PDL's STRUCTURED enums rather than free-text titles — PDL's
 * search rejects `query_string`, and structured clauses match far more
 * reliably. Senior levels × the engineering role captures CTO / VP Eng /
 * VP Infrastructure / VP Platform / Director Cloud without one query per title.
 */
const MOTION_LEVELS = ["cxo", "vp", "director"];
const MOTION_ROLE = "engineering";

export interface PdlPersonRecord {
  fullName: string | null;
  jobTitle: string | null;
  jobRole: string | null;
}

export class PdlPeopleProvider implements IntelligenceProvider {
  providerId = "pdl_people";
  providerType = "PEOPLE" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.8;
  sourceKind = "external" as const;
  supportedFamilies = ["CUSTOMER_ENGAGEMENT" as const];
  allowedForScreening = false; // deep only — never during baseline screen
  minRefreshHours = 24 * 30;

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = apiKey();
    const domain = normalizeDomain(target.domain);
    if (!key || !domain) return [];

    // Targeted: only the senior technical committee, capped small (§22).
    const query = {
      query: {
        bool: {
          must: [
            { term: { job_company_website: domain } },
            { terms: { job_title_levels: MOTION_LEVELS } },
            { term: { job_title_role: MOTION_ROLE } },
          ],
        },
      },
      size: 5,
    };
    const res = await fetch(PERSON_API, {
      method: "POST",
      headers: { "X-Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(15_000),
    });
    // No match / no credits / query rejected on this plan — absence, never an error.
    if (res.status === 404 || res.status === 402 || res.status === 400) return [];
    if (!res.ok) throw new Error(`pdl_people HTTP ${res.status}`);
    const d = (await res.json()) as {
      status: number;
      data?: { full_name?: string; job_title?: string; job_title_role?: string }[];
    };
    if (d.status !== 200 || !d.data) return [];
    const people: PdlPersonRecord[] = d.data.map((p) => ({
      fullName: p.full_name ?? null,
      jobTitle: p.job_title ?? null,
      jobRole: p.job_title_role ?? null,
    }));
    return [
      {
        payload: { domain, people },
        contentHash: contentHash(`pdlppl:${domain}:${people.map((p) => p.fullName).sort().join(",")}`),
        costUsd: 0.05,
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const { people } = current[0].payload as { people: PdlPersonRecord[] };
    return people
      .filter((p) => p.fullName && p.jobTitle)
      .map((p) => ({
        claim: `${p.fullName} holds ${p.jobTitle} at ${target.companyName}`,
        confidence: 0.8,
        firstParty: false,
      }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: Boolean(apiKey()), detail: apiKey() ? "PDL person search configured" : "PDL_API_KEY not set" };
  }
}
