import type pg from "pg";
import { z } from "zod";
import { completeStructured } from "../../ai/client";
import { crossCheckLLM } from "../../agents/extractor";
import { researchQueries, tavilyAvailable, tavilySearch } from "../../research/tavily";
import { claimFingerprint } from "../../quality/checks";
import { verifyEvidence } from "../../quality/verify";
import { SIGNAL_DEFS } from "../../signals/types";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * Tavily deep-research provider + investigator (DIRECTIVE §12, P0-E companion).
 *
 * Two roles, both deep-tier and selective (Tavily credits are metered):
 *
 *  1. TavilyProvider — INVESTIGATION. Runs a small set of targeted web queries
 *     about an escalated account and extracts specific, CITED claims as
 *     evidence. Secondary web source, so a moderate trust prior; it stands on
 *     its own and also corroborates other providers when claims align.
 *
 *  2. investigateCandidates — CORROBORATION. Closes the GDELT/Common Crawl
 *     radar loop: takes the cheap radar's unconfirmed candidates and sends
 *     Tavily to confirm them. A confirmed candidate becomes VERIFIED evidence
 *     carrying Tavily's credible citation — the radar pointed us where to look,
 *     the investigator supplied the proof. Unconfirmed candidates are left as
 *     they were; press is never promoted on its own.
 */

// ── Provider (investigation) ─────────────────────────────────────────────────

const MAX_RESULTS_PER_QUERY = 3;
const MAX_EVIDENCE_CHARS = 12_000;

const researchSchema = z.object({
  findings: z.array(
    z.object({
      claim: z.string().describe("One specific, sourced assertion about the company"),
      excerpt: z.string().describe("Verbatim sentence from the search result supporting it"),
      source_url: z.string().describe("The result URL the excerpt came from"),
      signal_type: z
        .enum([
          "AI_INITIATIVE", "CLOUD_MIGRATION", "CYBERSECURITY_INITIATIVE", "M_AND_A",
          "NEW_PRODUCT", "PARTNERSHIP", "GEOGRAPHIC_EXPANSION", "NEW_FACILITY",
          "LAYOFFS", "BUDGET_REDUCTION", "NONE",
        ])
        .describe("Best-fit signal type, or NONE for context-only findings"),
    }),
  ),
});

interface TavilyResultRow {
  query: string;
  title: string;
  url: string;
  content: string;
}

export class TavilyProvider implements IntelligenceProvider {
  providerId = "tavily";
  providerType = "PUBLIC_NEWS" as const;
  costClass = "LOW_COST" as const; // metered web-search credits
  sourceTrustPrior = 0.6; // secondary web research — credible but not primary
  sourceKind = "external" as const;
  supportedFamilies = ["STRATEGIC_CHANGE" as const, "BUSINESS_TRIGGER" as const, "NEGATIVE_BUSINESS" as const];
  allowedForScreening = false; // deep/manual only — never the cheap screen
  minRefreshHours = 24 * 7; // weekly at most; credits are finite

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!tavilyAvailable() || !target.companyName) return [];
    const hint = (target.targetSlug ?? "infrastructure automation").replace(/-/g, " ");
    const seen = new Set<string>();
    const out: RawObservationInput[] = [];
    for (const query of researchQueries(target.companyName, hint)) {
      let results: { title: string; url: string; content: string }[];
      try {
        results = await tavilySearch(query, MAX_RESULTS_PER_QUERY);
      } catch {
        continue; // one failed query never aborts the run
      }
      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({
          externalRecordId: r.url,
          sourceUrl: r.url,
          payload: { query, title: r.title, url: r.url, content: r.content.slice(0, 6_000) } as TavilyResultRow,
          contentHash: contentHash(`tavily:${r.url}`),
        });
      }
    }
    return out;
  }

  async normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): Promise<EvidenceCandidate[]> {
    const fresh = current.filter((c) => c.isNew).map((c) => c.payload as TavilyResultRow);
    if (fresh.length === 0) return [];

    const corpus = fresh
      .map((r, i) => `[${i}] ${r.title}\nURL: ${r.url}\n${r.content}`)
      .join("\n---\n")
      .slice(0, MAX_EVIDENCE_CHARS);

    let extracted;
    try {
      extracted = await completeStructured({
        tier: "cheap",
        system:
          "You extract specific, sourced commercial-intelligence findings about a company from web " +
          "search results. Each finding must be a concrete assertion (a strategic initiative, corporate " +
          "event, partnership, expansion, or negative development) with a VERBATIM supporting sentence and " +
          "the URL it came from. Ignore generic marketing copy and anything not about this company. " +
          "Return an empty list if nothing specific is supported.",
        user: `Company: ${target.companyName}\n\nResults:\n${corpus}`,
        schema: researchSchema,
        maxTokens: 2048,
      });
    } catch {
      return []; // extraction failure → no fabricated evidence
    }

    return extracted.findings.map((f) => ({
      claim: f.claim,
      excerpt: f.excerpt,
      sourceUrl: f.source_url,
      confidence: 0.7,
      firstParty: false,
      suggestedSignalType: f.signal_type === "NONE" ? undefined : f.signal_type,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    return tavilyAvailable()
      ? { ok: true, detail: "Tavily search configured" }
      : { ok: false, detail: "TAVILY_API_KEY not set" };
  }
}

// ── Investigator (corroboration of radar candidates) ─────────────────────────

/** Providers whose evidence is a cheap RADAR lead worth confirming (§26). */
const RADAR_PROVIDERS = ["gdelt", "common_crawl"];

const verdictSchema = z.object({
  corroborated: z.boolean().describe("Do the search results independently confirm the claim?"),
  confidence: z.number().min(0).max(1),
  best_url: z.string().describe("The single most credible confirming URL, or empty if none"),
  justification: z.string().describe("One verbatim sentence from a result that confirms the claim"),
});

/** Keywords from a candidate claim to build a focused investigation query. */
export function investigationQuery(companyName: string, claim: string): string {
  // Drop the radar's framing ("news coverage indicates …") and keep the event.
  const core = claim
    .replace(/^news coverage indicates\s+/i, "")
    .replace(/^common crawl history shows\s+/i, "")
    .replace(/\(present in crawl[^)]*\)/i, "")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `"${companyName}" ${core}`;
}

export interface InvestigationResult {
  investigated: number;
  corroborated: number;
  evidenceCreated: number;
}

/**
 * Send Tavily to confirm this account's unconfirmed radar candidates. Each
 * confirmed candidate yields VERIFIED, cited Tavily evidence for the same
 * event (fingerprint-aligned so the two sources corroborate). Deep-only and
 * capped for credit control.
 */
export async function investigateCandidates(
  db: pg.PoolClient,
  target: IntelligenceTarget,
  opts: { limit?: number } = {},
): Promise<InvestigationResult> {
  const result: InvestigationResult = { investigated: 0, corroborated: 0, evidenceCreated: 0 };
  if (!tavilyAvailable()) return result;

  const limit = opts.limit ?? 5;
  const { rows: candidates } = await db.query<{
    id: string;
    claim: string;
    source_url: string | null;
    provider_id: string;
  }>(
    `select id, claim, source_url, provider_id
     from evidence
     where company_id = $1 and provider_id = any($2)
       and status in ('quarantined', 'rejected')
     order by collected_at desc
     limit $3`,
    [target.companyId, RADAR_PROVIDERS, limit],
  );

  for (const cand of candidates) {
    result.investigated++;
    let results: { title: string; url: string; content: string }[];
    try {
      results = await tavilySearch(investigationQuery(target.companyName, cand.claim), 4);
    } catch {
      continue;
    }
    if (results.length === 0) continue;

    const corpus = results
      .map((r, i) => `[${i}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 2_000)}`)
      .join("\n---\n")
      .slice(0, 10_000);

    let verdict;
    try {
      verdict = await completeStructured({
        tier: "cheap",
        system:
          "You are verifying whether web search results independently CONFIRM a specific claim about a " +
          "company. Only answer corroborated=true when a result clearly supports the claim; if the results " +
          "are unrelated, generic, or only tangentially mention it, answer false. Quote a verbatim " +
          "confirming sentence when true.",
        user: `Claim: ${cand.claim}\n\nResults:\n${corpus}`,
        schema: verdictSchema,
        maxTokens: 512,
      });
    } catch {
      continue;
    }
    if (!verdict.corroborated || verdict.confidence < 0.5 || !verdict.best_url) continue;
    result.corroborated++;

    // Tavily evidence for the SAME event → shares the candidate's fingerprint,
    // so the two independent sources corroborate. Its own trust + cross-check
    // let it clear verification even when the radar lead could not.
    const fp = claimFingerprint(target.companyId, cand.claim);
    const { rows: existing } = await db.query<{ id: string }>(
      `select id from evidence where company_id = $1 and provider_id = 'tavily' and claim_fingerprint = $2 limit 1`,
      [target.companyId, fp],
    );
    if (existing.length > 0) continue; // already investigated this lead

    const { rows: evRows } = await db.query<{ id: string }>(
      `insert into evidence (org_id, company_id, source_type, source_url, claim, raw_excerpt,
          confidence, observed_at, provider_id, first_party, published_at)
       values ($1, $2, 'tavily', $3, $4, $5, $6, now(), 'tavily', false, null)
       returning id`,
      [target.orgId, target.companyId, verdict.best_url, cand.claim, verdict.justification, verdict.confidence],
    );

    const outcome = await verifyEvidence(
      db,
      {
        id: evRows[0].id,
        orgId: target.orgId,
        companyId: target.companyId,
        sourceName: "tavily",
        claim: cand.claim,
        rawExcerpt: verdict.justification,
        observedAt: new Date(),
        extractionConfidence: verdict.confidence,
      },
      { crossCheck: crossCheckLLM },
    );
    result.evidenceCreated++;

    // Re-verify the radar candidate so its corroboration count now sees Tavily.
    await verifyEvidence(
      db,
      {
        id: cand.id,
        orgId: target.orgId,
        companyId: target.companyId,
        sourceName: cand.provider_id,
        claim: cand.claim,
        rawExcerpt: cand.claim,
        observedAt: new Date(),
        extractionConfidence: 0.45,
      },
      { random: () => 1 }, // no re-sampling into the review queue
    );

    // Promote a signal for the now-verified event, mirroring the pipeline.
    const inferred = inferSignalType(cand.claim);
    if (outcome.status === "verified" && inferred) {
      const def = SIGNAL_DEFS[inferred];
      if (def) {
        await db.query(
          `insert into signals (org_id, company_id, signal_type, direction, magnitude, confidence,
              observed_at, half_life_days, evidence_id, first_seen, last_seen)
           values ($1, $2, $3, $4, 1, (select computed_confidence from evidence where id = $5), now(), $6, $5, now(), now())`,
          [target.orgId, target.companyId, inferred, def.direction, evRows[0].id, def.halfLifeDays],
        );
      }
    }
  }
  return result;
}

/** Recover the radar candidate's intended signal type from its claim text. */
function inferSignalType(claim: string): string | undefined {
  const c = claim.toLowerCase();
  if (/\bpartner|partnership|alliance\b/.test(c)) return "PARTNERSHIP";
  if (/\bacqui|merger|acquisition\b/.test(c)) return "M_AND_A";
  if (/\blaunch|unveil|introduc|releas|product\b/.test(c)) return "NEW_PRODUCT";
  if (/\bdata ?center|facility|new office\b/.test(c)) return "NEW_FACILITY";
  if (/\bexpand|expansion|market\b/.test(c)) return "GEOGRAPHIC_EXPANSION";
  if (/\bappoint|names?\b.*\b(ceo|cto|cio)\b|leadership\b/.test(c)) return "NEW_TECHNOLOGY_LEADERSHIP";
  if (/\bai\b|artificial intelligence\b/.test(c)) return "AI_INITIATIVE";
  if (/\bcloud\b/.test(c)) return "CLOUD_MIGRATION";
  if (/\bsecurity\b/.test(c)) return "CYBERSECURITY_INITIATIVE";
  return undefined;
}
