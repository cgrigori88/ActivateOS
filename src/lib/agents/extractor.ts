import type pg from "pg";
import { z } from "zod";
import { completeStructured, completeStructuredMeta } from "../ai/client";
import { verifyEvidence, type CrossChecker } from "../quality/verify";

/**
 * Extractor workflow (docs/AGENT_LAYER.md §3): research text in, evidence
 * rows out. The extractor may only assert what the text supports and must
 * quote the supporting excerpt; a SECOND model (different prompt) cross-checks
 * every claim during verification. Extraction confidence never becomes final
 * confidence on its own — see src/lib/quality/confidence.ts.
 */

export const extractionSchema = z.object({
  claims: z.array(
    z.object({
      claim: z
        .string()
        .describe("One specific, self-contained factual assertion about the company"),
      excerpt: z
        .string()
        .describe("Verbatim quote from the source text that supports the claim"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("How directly the excerpt supports the claim"),
    }),
  ),
});

const EXTRACTOR_SYSTEM = `You extract factual claims about a company from source text for a B2B revenue-intelligence system.

Rules:
- Extract only facts that are explicitly supported by the text. Never infer, combine outside knowledge, or speculate.
- Each claim must be one specific assertion (a hiring pattern, an installed technology, a stated initiative, a contract or budget event, an executive change, layoffs or freezes).
- Quote the exact supporting excerpt verbatim for every claim.
- Include NEGATIVE facts (layoffs, budget cuts, cancelled projects, competing purchases) — they matter as much as positive ones.
- Skip marketing fluff, opinions, and generic statements. Fewer high-quality claims beat many weak ones.
- If the text contains nothing extractable, return an empty list.`;

export interface ResearchDocument {
  sourceType: string; // e.g. 'website','press','job_posting','sec_filing'
  sourceUrl?: string;
  text: string;
  observedAt?: Date;
}

/** Stage [2] model cross-check: a different model+prompt judging support only. */
export const crossCheckLLM: CrossChecker = async (claim, excerpt) => {
  const verdict = await completeStructured({
    tier: "cheap",
    system:
      "You verify claims against source excerpts. Judge ONLY whether the excerpt supports the claim as stated — not whether the claim is plausible. Be strict: partial or indirect support is not support.",
    user: `Claim: ${claim}\n\nExcerpt: ${excerpt}\n\nIs the claim directly supported by the excerpt?`,
    schema: z.object({
      supported: z.boolean(),
      confidence: z.number().min(0).max(1),
    }),
    maxTokens: 512,
  });
  return verdict;
};

export interface ExtractionStats {
  claims: number;
  verified: number;
  held: number;
}

/** Run extraction on one document and push every claim through the quality gates. */
export async function extractAndIngest(
  db: pg.PoolClient,
  args: {
    orgId: string | null;
    companyId: string;
    companyName: string;
    doc: ResearchDocument;
  },
): Promise<ExtractionStats> {
  const { doc } = args;
  const { output, meta } = await completeStructuredMeta({
    tier: "cheap",
    system: EXTRACTOR_SYSTEM,
    user:
      `Company: ${args.companyName}\nSource type: ${doc.sourceType}\n` +
      `Source URL: ${doc.sourceUrl ?? "n/a"}\n\nSource text:\n${doc.text.slice(0, 24000)}`,
    schema: extractionSchema,
    maxTokens: 8192,
  });

  // Agent observability (BLUEPRINT §48–49): every workflow run is logged.
  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_summary,
        raw_output, validated, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms)
     values ($1, 'extractor', 'v1', $2, $3, $4, true, 'v1', $5, $6, $7, $8)`,
    [
      args.orgId,
      meta.model,
      JSON.stringify({ companyId: args.companyId, sourceType: doc.sourceType, sourceUrl: doc.sourceUrl ?? null }),
      JSON.stringify({ claims: output.claims.length }),
      meta.inputTokens,
      meta.outputTokens,
      meta.costUsd,
      meta.latencyMs,
    ],
  );

  const stats: ExtractionStats = { claims: output.claims.length, verified: 0, held: 0 };
  const observedAt = doc.observedAt ?? new Date();

  for (const c of output.claims) {
    const { rows } = await db.query<{ id: string }>(
      `insert into evidence (org_id, company_id, source_type, source_url, claim, raw_excerpt, confidence, observed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [args.orgId, args.companyId, doc.sourceType, doc.sourceUrl ?? null, c.claim, c.excerpt, c.confidence, observedAt],
    );

    const outcome = await verifyEvidence(
      db,
      {
        id: rows[0].id,
        orgId: args.orgId,
        companyId: args.companyId,
        sourceName: doc.sourceType,
        claim: c.claim,
        rawExcerpt: c.excerpt,
        observedAt,
        extractionConfidence: c.confidence,
      },
      { crossCheck: crossCheckLLM },
    );
    if (outcome.status === "verified") stats.verified++;
    else stats.held++;
  }
  return stats;
}
