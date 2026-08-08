import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { z } from "zod";
import { completeStructured } from "../ai/client";

/**
 * Motion Designer (docs/AGENT_LAYER.md §3) — the first frontier-tier
 * workflow. Instantiates a play template against a scored account.
 *
 * Grounding rules enforced here:
 *  - context contains ONLY verified evidence (queried by status);
 *  - the output must cite evidence ids from that set (validated);
 *  - output is schema-constrained; no invented numbers requested or kept;
 *  - the motion lands as a DRAFT — human approval gates anything customer-facing;
 *  - the full run is logged to agent_runs; MOTION_CREATED event emitted.
 */

export const motionSchema = z.object({
  thesis: z
    .string()
    .describe("2-4 sentence customer thesis grounded ONLY in the cited evidence"),
  trigger_summary: z.string().describe("One sentence naming the compelling event(s)"),
  primary_persona: z.string(),
  secondary_persona: z.string(),
  cta: z.string().describe("The concrete low-friction offer, drawn from the play"),
  confidence: z.enum(["low", "medium", "high"]),
  cited_evidence_ids: z
    .array(z.string())
    .describe("Ids of every evidence item the thesis and trigger rely on"),
});

export type MotionDraft = z.infer<typeof motionSchema>;

/** Citations must reference provided evidence and be substantive (pure, tested). */
export function validateCitations(
  cited: string[],
  available: Set<string>,
): { ok: boolean; reason?: string } {
  if (cited.length < 2) return { ok: false, reason: "fewer than 2 citations" };
  const unknown = cited.filter((id) => !available.has(id));
  if (unknown.length > 0) return { ok: false, reason: `unknown evidence ids: ${unknown.join(", ")}` };
  return { ok: true };
}

const WORKFLOW = "motion_designer";
const WORKFLOW_VERSION = "v1";
const MODEL_TIER = "frontier" as const;

export async function designMotion(
  db: pg.PoolClient,
  args: { orgId: string; companyId: string; targetSlug: string },
): Promise<{ motionId: string; draft: MotionDraft }> {
  const { rows: companies } = await db.query<{ legal_name: string; industry: string | null; employee_count: number | null }>(
    `select legal_name, industry, employee_count from companies where id = $1`,
    [args.companyId],
  );
  if (companies.length === 0) throw new Error("company not found");
  const company = companies[0];

  const { rows: scores } = await db.query<{ id: string; score: string; band: string; node_id: string }>(
    `select p.id, p.score, p.band, p.taxonomy_node_id as node_id
     from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 and n.slug = $2 order by p.computed_at desc limit 1`,
    [args.companyId, args.targetSlug],
  );
  if (scores.length === 0) throw new Error(`no score for ${args.targetSlug} — run scoring first`);
  const score = scores[0];

  const { rows: plays } = await db.query<{ id: string; definition: unknown }>(
    `select pt.id, pt.definition from play_templates pt
     join taxonomy_nodes n on n.id = pt.taxonomy_node_id
     where n.slug = $1 and pt.status = 'active' order by pt.version desc limit 1`,
    [args.targetSlug],
  );
  if (plays.length === 0) throw new Error(`no active play template for ${args.targetSlug}`);
  const play = plays[0];

  // Evidence-gated context: verified rows only.
  const { rows: evidence } = await db.query<{ id: string; claim: string; source_type: string; observed_at: Date }>(
    `select id, claim, source_type, observed_at from evidence
     where company_id = $1 and status = 'verified' order by observed_at desc limit 40`,
    [args.companyId],
  );
  if (evidence.length < 2) throw new Error("not enough verified evidence to design a motion");
  const availableIds = new Set(evidence.map((e) => e.id));

  let solutionProfile = "";
  try {
    solutionProfile = readFileSync(
      join(process.cwd(), "knowledge", "solutions", `${args.targetSlug}.json`),
      "utf8",
    );
  } catch {
    /* profile optional */
  }

  const system = `You design Revenue Motions for a channel-revenue platform. You instantiate the given play template against one account.

Hard rules:
- Every factual statement about the account MUST come from the provided evidence list; cite the ids you used in cited_evidence_ids. Do not use outside knowledge about the company.
- Do not invent numbers, market sizes, or ROI figures. Economic framing comes from the play/solution profile only, phrased qualitatively.
- The thesis follows the play's thesis_template structure, filled with evidence-backed specifics.
- The CTA must be the play's offer (or fallback), not a new invention.
- Confidence reflects evidence strength: 'high' only when trigger AND momentum evidence both exist.`;

  const user = `## Account
${company.legal_name}${company.industry ? ` — ${company.industry}` : ""}${company.employee_count ? `, ~${company.employee_count} employees` : ""}
Propensity: ${Number(score.score).toFixed(0)}/100 (${score.band}) for ${args.targetSlug}

## Verified evidence (id: claim)
${evidence.map((e) => `${e.id}: [${e.source_type}, ${e.observed_at.toISOString().slice(0, 10)}] ${e.claim}`).join("\n")}

## Play template
${JSON.stringify(play.definition, null, 2)}

${solutionProfile ? `## Solution profile\n${solutionProfile}` : ""}

Design the Revenue Motion.`;

  const draft = await completeStructured({
    tier: MODEL_TIER,
    system,
    user,
    schema: motionSchema,
    maxTokens: 4096,
  });

  const citation = validateCitations(draft.cited_evidence_ids, availableIds);

  // Decision log — recorded whether or not validation passed (audit trail).
  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_evidence_ids, input_summary, raw_output, validated)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      args.orgId,
      WORKFLOW,
      WORKFLOW_VERSION,
      MODEL_TIER,
      evidence.map((e) => e.id),
      JSON.stringify({ companyId: args.companyId, targetSlug: args.targetSlug, score: score.score }),
      JSON.stringify(draft),
      citation.ok,
    ],
  );
  if (!citation.ok) throw new Error(`motion rejected: ${citation.reason}`);

  const { rows: motions } = await db.query<{ id: string }>(
    `insert into revenue_motions (org_id, company_id, taxonomy_node_id, play_template_id,
        propensity_score_id, status, thesis, trigger_summary, primary_persona,
        secondary_persona, cta, confidence)
     values ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      args.orgId,
      args.companyId,
      score.node_id,
      play.id,
      score.id,
      draft.thesis,
      draft.trigger_summary,
      draft.primary_persona,
      draft.secondary_persona,
      draft.cta,
      draft.confidence,
    ],
  );

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'MOTION_CREATED', $4)`,
    [args.orgId, motions[0].id, args.companyId, JSON.stringify({ cited: draft.cited_evidence_ids })],
  );

  return { motionId: motions[0].id, draft };
}
