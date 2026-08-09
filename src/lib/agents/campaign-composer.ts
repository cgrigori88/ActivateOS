import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { z } from "zod";
import { completeStructuredMeta } from "../ai/client";

/**
 * Campaign Composer (docs/AGENT_LAYER.md §3): approved motion → seller-facing
 * campaign assets. Hard gate: the motion MUST be approved — this workflow
 * refuses drafts, which is how the human-approval invariant reaches
 * customer-facing content. Output is grounded in the motion (already
 * human-approved) plus the play's cadence and objection library.
 */

export const campaignSchema = z.object({
  campaign_name: z.string().describe("Short internal campaign name"),
  seller_playbook: z
    .string()
    .describe("One-page markdown play: why this account, why now, what to do, escalation"),
  outreach_email: z.object({
    subject: z.string(),
    body: z
      .string()
      .describe("Partner-seller opening email per cadence step 1. Grounded, specific, no invented facts, no pricing."),
  }),
  discovery_questions: z.array(z.string()).min(4).max(8),
  objection_cards: z.array(
    z.object({ objection: z.string(), response: z.string() }),
  ),
});

export type CampaignDraft = z.infer<typeof campaignSchema>;

export async function composeCampaign(
  db: pg.PoolClient,
  motionId: string,
): Promise<{ campaignId: string; draft: CampaignDraft }> {
  const { rows: motions } = await db.query(
    `select m.*, c.legal_name, c.industry, c.employee_count, n.slug as target_slug,
            pt.definition as play
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     join play_templates pt on pt.id = m.play_template_id
     where m.id = $1`,
    [motionId],
  );
  if (motions.length === 0) throw new Error(`motion not found: ${motionId}`);
  const motion = motions[0];
  if (motion.status !== "approved") {
    throw new Error(`motion is '${motion.status}' — campaigns compose only from APPROVED motions`);
  }

  let solutionProfile = "";
  try {
    solutionProfile = readFileSync(
      join(process.cwd(), "knowledge", "solutions", `${motion.target_slug}.json`),
      "utf8",
    );
  } catch {
    /* optional */
  }

  const system = `You compose channel campaign assets from an APPROVED Revenue Motion for partner sellers.

Hard rules:
- The motion below is human-approved ground truth. Every account-specific fact must come from it — do not add facts, numbers, ROI figures, or pricing.
- The outreach email is from a partner seller to the customer: short (under 150 words), specific to the trigger, professional, no hype, no exclamation marks, ends on the motion's CTA.
- The seller playbook is for a busy partner seller: scannable markdown, concrete next actions, includes the play's escalation criteria.
- Discovery questions probe the trigger and the play's qualification framework.
- Objection cards adapt the play's objection library to this account's context.`;

  const user = `## Approved Revenue Motion
Account: ${motion.legal_name}${motion.industry ? ` — ${motion.industry}` : ""}${motion.employee_count ? `, ~${motion.employee_count} employees` : ""}
Solution: ${motion.target_slug}
Thesis: ${motion.thesis}
Trigger: ${motion.trigger_summary}
Personas: ${motion.primary_persona} / ${motion.secondary_persona}
CTA: ${motion.cta}
Confidence: ${motion.confidence}

## Play template
${JSON.stringify(motion.play, null, 2)}

${solutionProfile ? `## Solution profile\n${solutionProfile}` : ""}

Compose the campaign assets.`;

  const { output: draft, meta } = await completeStructuredMeta({
    tier: "frontier",
    system,
    user,
    schema: campaignSchema,
    maxTokens: 8192,
  });

  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_summary,
        raw_output, validated, motion_id, prompt_version, input_tokens, output_tokens,
        cost_usd, latency_ms)
     values ($1, 'campaign_composer', 'v1', $2, $3, $4, true, $5, 'v1', $6, $7, $8, $9)`,
    [
      motion.org_id,
      meta.model,
      JSON.stringify({ motionId }),
      JSON.stringify(draft),
      motionId,
      meta.inputTokens,
      meta.outputTokens,
      meta.costUsd,
      meta.latencyMs,
    ],
  );

  const { rows: campaigns } = await db.query<{ id: string }>(
    `insert into campaigns (org_id, motion_id, name, status) values ($1, $2, $3, 'draft') returning id`,
    [motion.org_id, motionId, draft.campaign_name],
  );
  const campaignId = campaigns[0].id;

  const assets: { type: string; title: string; content: string }[] = [
    { type: "seller_playbook", title: "Seller playbook", content: draft.seller_playbook },
    {
      type: "outreach_email",
      title: draft.outreach_email.subject,
      content: `Subject: ${draft.outreach_email.subject}\n\n${draft.outreach_email.body}`,
    },
    {
      type: "discovery_guide",
      title: "Discovery guide",
      content: draft.discovery_questions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    },
    {
      type: "objection_cards",
      title: "Objection handling",
      content: draft.objection_cards.map((o) => `**${o.objection}**\n${o.response}`).join("\n\n"),
    },
  ];
  for (const a of assets) {
    await db.query(
      `insert into campaign_assets (campaign_id, asset_type, title, content) values ($1, $2, $3, $4)`,
      [campaignId, a.type, a.title, a.content],
    );
  }

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'CAMPAIGN_CREATED', $4)`,
    [motion.org_id, motionId, motion.company_id, JSON.stringify({ campaignId, assets: assets.length })],
  );

  return { campaignId, draft };
}
