import type { PoolClient } from "pg";
import { z } from "zod";
import { createCandidateFromExtraction } from "./candidates";
import { loadPredicates } from "./predicates";
import type { ValueType } from "./identity";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * LLM Fact-candidate extractor (Workstream B, §28-31). The model's ONLY job: read a piece of
 * verified evidence and propose a STRUCTURED candidate proposition (subject / predicate /
 * object / mandatory source span). It never creates durable Facts, sets confidence, chooses
 * promotion, or touches scores — the deterministic gate remains authoritative. Two hard
 * guards enforced here regardless of what the model returns:
 *   §29 — an unknown predicate stays unresolved and cannot promote.
 *   §31 — a candidate whose quoted span is NOT present in the source is DISCARDED (no
 *          "inferred from general context" Fact; inference is a future Hypothesis, §32).
 * The extractor is injectable so the deterministic path is testable with no live model.
 */

export const ExtractedCandidateSchema = z.object({
  subject_label: z.string().min(1),
  subject_scope: z.enum(["COMPANY", "ACCOUNT", "PRODUCT", "TECHNOLOGY", "PARTNER", "SELLER", "CONTACT", "OPPORTUNITY", "PURSUIT", "RELATIONSHIP"]).default("COMPANY"),
  predicate_candidate: z.string().min(1),
  object_type: z.enum(["STRING", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "ENUM", "ENTITY_REF", "MONEY", "PERCENTAGE", "RANGE", "JSON"]),
  object_raw: z.unknown(),
  quoted_excerpt: z.string().min(1),
  extraction_confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});
export type ExtractedCandidate = z.infer<typeof ExtractedCandidateSchema>;

export interface EvidenceForExtraction {
  id: string; org_id: string; company_id: string | null; claim: string; raw_excerpt: string | null; source_type: string; status: string;
}

/** Pluggable extraction function. Default is the LLM; tests inject a deterministic stub. */
export type ExtractFn = (ev: EvidenceForExtraction, allowedPredicates: string[]) => Promise<ExtractedCandidate[]>;

export interface ExtractStats { proposed: number; created: number; discardedNoSpan: number; discardedUnverified: number; }

export async function extractFactsFromEvidence(
  db: PoolClient, orgId: string, evidenceId: string,
  opts: { extractor?: ExtractFn; env?: DataEnvironment } = {},
): Promise<ExtractStats> {
  const stats: ExtractStats = { proposed: 0, created: 0, discardedNoSpan: 0, discardedUnverified: 0 };
  const { rows } = await db.query<EvidenceForExtraction>(
    `select id, org_id, company_id, claim, raw_excerpt, source_type, status from evidence where id = $1`, [evidenceId],
  );
  const ev = rows[0];
  if (!ev) return stats;
  // Only extract from verified evidence — candidates from unverified sources can't promote anyway.
  if (ev.status !== "verified") { stats.discardedUnverified++; return stats; }

  const preds = await loadPredicates(db);
  const allowed = [...preds.keys()];
  const extractor = opts.extractor ?? llmExtractor;
  const proposals = await extractor(ev, allowed);
  stats.proposed = proposals.length;

  const sourceText = `${ev.claim}\n${ev.raw_excerpt ?? ""}`;
  for (const raw of proposals) {
    const parsed = ExtractedCandidateSchema.safeParse(raw);
    if (!parsed.success) continue;
    const c = parsed.data;
    // §31 hallucination guard: the quoted span must actually appear in the source.
    const span = c.quoted_excerpt.trim();
    const idx = sourceText.toLowerCase().indexOf(span.toLowerCase());
    if (idx < 0 || span.length < 3) { stats.discardedNoSpan++; continue; }
    await createCandidateFromExtraction(db, {
      orgId, companyId: ev.company_id, subject: { subjectScope: c.subject_scope, subjectRef: ev.company_id, subjectLabel: c.subject_label },
      predicateCandidate: c.predicate_candidate, objectType: c.object_type as ValueType, objectRaw: c.object_raw,
      sourceEvidenceId: ev.id, sourceSpanStart: idx, sourceSpanEnd: idx + span.length, quotedExcerpt: span,
      extractionConfidence: c.extraction_confidence, extractionReason: c.reason, extractedBy: extractor === llmExtractor ? "llm" : "stub", env: opts.env,
    });
    stats.created++;
  }
  return stats;
}

/** Default LLM extractor (cheap tier, strict schema). Imported lazily so tests never call it. */
const llmExtractor: ExtractFn = async (ev, allowed) => {
  const { completeStructured } = await import("../ai/client");
  const schema = z.object({ candidates: z.array(ExtractedCandidateSchema) });
  const out = await completeStructured({
    tier: "cheap",
    system:
      "Extract durable commercial FACT CANDIDATES from the evidence. A candidate is a normalized " +
      "subject–predicate–object proposition, NOT a summary. Use ONLY these predicate keys: " +
      allowed.join(", ") + ". If none fits, return no candidate. Every candidate MUST quote the exact " +
      "supporting span from the evidence text (quoted_excerpt). Do not infer beyond the text.",
    user: `Evidence (${ev.source_type}): ${ev.claim}\n\nExcerpt: ${ev.raw_excerpt ?? ""}`,
    schema,
  });
  return out.candidates ?? [];
};
