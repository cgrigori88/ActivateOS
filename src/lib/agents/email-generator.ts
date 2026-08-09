import type pg from "pg";
import { z } from "zod";
import { completeStructuredMeta } from "../ai/client";

/**
 * Email Generator (Phase 5C): drafts the opening outreach email from an
 * approved/active motion — preview only, never sent without a human.
 * Grounded in the motion (already human-approved) and cited evidence;
 * no invented facts, no numbers, no pricing.
 */

export const emailDraftSchema = z.object({
  subject: z.string().describe("Specific, trigger-referencing, under 70 chars, no hype"),
  body: z
    .string()
    .describe(
      "Complete email body under 150 words: opening, why-relevant (evidence-grounded), " +
        "hypothesis, CTA, sign-off with the sender's name. No placeholders.",
    ),
});

export async function generateOutreachDraft(
  db: pg.PoolClient,
  args: { motionId: string; senderName: string },
): Promise<{ subject: string; body: string }> {
  const { rows } = await db.query(
    `select m.org_id, m.thesis, m.trigger_summary, m.primary_persona, m.cta,
            c.legal_name, c.industry
     from revenue_motions m join companies c on c.id = m.company_id
     where m.id = $1 and m.status in ('approved','active')`,
    [args.motionId],
  );
  if (rows.length === 0) throw new Error("motion not found or not approved/active");
  const m = rows[0];

  const { rows: evidence } = await db.query<{ claim: string }>(
    `select distinct e.claim from agent_runs r
     cross join lateral unnest(r.input_evidence_ids) as ev(id)
     join evidence e on e.id = ev.id
     where r.motion_id = $1 and e.status = 'verified' limit 10`,
    [args.motionId],
  );

  const { output, meta } = await completeStructuredMeta({
    tier: "frontier",
    system: `You draft the opening outreach email for a partner seller. Hard rules:
- Every account-specific statement must come from the approved motion and evidence below. No outside knowledge, no invented numbers, no pricing, no hype, no exclamation marks.
- Under 150 words. Professional, specific to the trigger, ends on the motion's CTA.
- Sign off with the sender's name exactly as given.`,
    user: `## Approved motion — ${m.legal_name}${m.industry ? ` (${m.industry})` : ""}
Thesis: ${m.thesis}
Trigger: ${m.trigger_summary}
Persona: ${m.primary_persona}
CTA: ${m.cta}

## Verified evidence
${evidence.map((e) => `- ${e.claim}`).join("\n")}

## Sender
${args.senderName}

Draft the email.`,
    schema: emailDraftSchema,
    maxTokens: 2048,
  });

  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_summary,
        raw_output, validated, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms)
     values ($1, 'email_generator', 'v1', $2, $3, $4, true, 'v1', $5, $6, $7, $8)`,
    [
      m.org_id,
      meta.model,
      JSON.stringify({ motionId: args.motionId }),
      JSON.stringify(output),
      meta.inputTokens,
      meta.outputTokens,
      meta.costUsd,
      meta.latencyMs,
    ],
  );
  return output;
}
