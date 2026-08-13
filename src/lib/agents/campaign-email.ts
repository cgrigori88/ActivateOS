import type pg from "pg";
import { z } from "zod";
import { completeStructuredMeta } from "../ai/client";
import { renderBrandedEmail, type EmailBrand } from "../comms/templates";

/**
 * Campaign email sequence generator (Phase 9A). From an APPROVED motion it
 * drafts a grounded, multi-touch email sequence and renders each touch to
 * branded HTML + plain text. Hard gate: the motion must be approved — this is
 * how the human-approval invariant reaches customer-facing content. Every
 * account-specific statement is grounded in the motion (already approved) and
 * verified evidence; no invented facts, numbers, or pricing.
 *
 * Output is preview-only: every touch lands as status='draft'. A human
 * approves each touch before it can send (per-touch approval, not per-campaign).
 */

const touchSchema = z.object({
  name: z.string().describe("Short internal label, e.g. 'Trigger intro' or 'Proof + CTA'"),
  subject: z.string().describe("Specific, trigger-referencing, under 70 chars, no hype"),
  preheader: z.string().describe("Inbox preview line, under 100 chars, complements the subject"),
  headline: z.string().describe("In-email headline, under 60 chars"),
  paragraphs: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe("1–3 short paragraphs. Grounded, specific, no invented facts or pricing."),
  highlights: z
    .array(z.string())
    .max(3)
    .describe("0–3 scannable proof points drawn only from evidence/motion"),
  cta_label: z.string().describe("Button text for the single call to action, e.g. 'Book 20 minutes'"),
  account_angle: z
    .string()
    .describe(
      "One sentence, the PER-RECIPIENT layer. Use these tokens verbatim where they fit: " +
        "{{account}} {{industry}} {{solution}} {{trigger}}. Keep the shared paragraphs generic enough to " +
        "scale across the whole list, and put the account-specific framing here — it is resolved from each " +
        "account's own data at send time.",
    ),
  send_offset_days: z
    .number()
    .int()
    .min(0)
    .max(60)
    .describe("Days after touch 1 to send. Touch 1 is 0; later touches ramp (e.g. 3, 7, 14)."),
});

export const sequenceSchema = z.object({
  campaign_name: z.string().describe("Short internal campaign name"),
  objective: z.string().describe("One line: what this sequence is trying to achieve"),
  audience: z.string().describe("One line: which persona/committee this sequence targets"),
  touches: z.array(touchSchema).min(1).max(5),
});

export type CampaignSequence = z.infer<typeof sequenceSchema>;

async function resolveBrand(db: pg.PoolClient, orgId: string | null): Promise<EmailBrand> {
  const { rows } = await db.query<{
    wordmark: string;
    primary_color: string;
    accent_color: string;
    footer_html: string | null;
    address_line: string | null;
    unsubscribe_url: string | null;
  }>(
    `select wordmark, primary_color, accent_color, footer_html, address_line, unsubscribe_url
     from brand_profiles where org_id is not distinct from $1
     order by is_default desc, created_at asc limit 1`,
    [orgId],
  );
  const b = rows[0];
  return {
    wordmark: b?.wordmark ?? "PursuitOS",
    primaryColor: b?.primary_color ?? "#1d4ed8",
    accentColor: b?.accent_color ?? "#0f172a",
    footerHtml: b?.footer_html ?? null,
    addressLine: b?.address_line ?? null,
    unsubscribeUrl: b?.unsubscribe_url ?? null,
  };
}

interface MotionRow {
  id: string;
  org_id: string | null;
  company_id: string;
  thesis: string | null;
  trigger_summary: string | null;
  primary_persona: string | null;
  secondary_persona: string | null;
  cta: string | null;
  status: string;
  operator_notes: string | null;
  legal_name: string;
  industry: string | null;
  employee_count: number | null;
  primary_domain: string | null;
}

/** Shared AI core: draft a grounded sequence from a motion (no campaign writes). */
async function draftSequenceForMotion(
  db: pg.PoolClient,
  args: { motionId: string; senderName: string; touchCount?: number },
): Promise<{ sequence: CampaignSequence; motion: MotionRow; brand: Awaited<ReturnType<typeof resolveBrand>>; brandId: string | null }> {
  const { rows: motions } = await db.query<MotionRow>(
    `select m.id, m.org_id, m.company_id, m.thesis, m.trigger_summary,
            m.primary_persona, m.secondary_persona, m.cta, m.status, m.operator_notes,
            c.legal_name, c.industry, c.employee_count, c.primary_domain
     from revenue_motions m join companies c on c.id = m.company_id
     where m.id = $1`,
    [args.motionId],
  );
  if (motions.length === 0) throw new Error(`motion not found: ${args.motionId}`);
  const m = motions[0];
  if (m.status !== "approved" && m.status !== "active") {
    throw new Error(`motion is '${m.status}' — sequences generate only from approved/active motions`);
  }

  const { rows: evidence } = await db.query<{ claim: string }>(
    `select distinct e.claim from agent_runs r
     cross join lateral unnest(r.input_evidence_ids) as ev(id)
     join evidence e on e.id = ev.id
     where r.motion_id = $1 and e.status = 'verified' limit 12`,
    [args.motionId],
  );

  const touchCount = Math.min(Math.max(args.touchCount ?? 3, 1), 5);
  const brand = await resolveBrand(db, m.org_id);
  const { rows: brandRows } = await db.query<{ id: string }>(
    `select id from brand_profiles where org_id is not distinct from $1 order by is_default desc, created_at asc limit 1`,
    [m.org_id],
  );
  const brandId = brandRows[0]?.id ?? null;

  const { output: sequence, meta } = await completeStructuredMeta({
    tier: "frontier",
    system: `You design a ${touchCount}-touch outbound email sequence for a partner seller, from an APPROVED revenue motion.

Hard rules:
- The motion below is human-approved ground truth. Every account-specific statement must come from it or the verified evidence — no outside knowledge, no invented numbers, no ROI figures, no pricing, no hype, no exclamation marks.
- Each touch is a short professional email (paragraphs under ~60 words each), specific to the trigger, ending on the motion's CTA.
- The sequence should escalate naturally: touch 1 opens on the trigger; later touches add a proof point or a new angle and a light nudge — never guilt or pressure.
- send_offset_days ramps across touches (touch 1 = 0, then space them out).
- Produce exactly ${touchCount} touch(es).`,
    user: `## Approved motion — ${m.legal_name}${m.industry ? ` (${m.industry})` : ""}${m.employee_count ? `, ~${m.employee_count} employees` : ""}
Thesis: ${m.thesis}
Trigger: ${m.trigger_summary}
Personas: ${m.primary_persona}${m.secondary_persona ? ` / ${m.secondary_persona}` : ""}
CTA: ${m.cta}${m.operator_notes ? `\n\n## Operator notes — human guidance, treat as authoritative steering\n${m.operator_notes}` : ""}

## Verified evidence
${evidence.map((e) => `- ${e.claim}`).join("\n") || "(none)"}

## Sender
${args.senderName}

Design the ${touchCount}-touch sequence.`,
    schema: sequenceSchema,
    maxTokens: 6144,
  });

  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_summary,
        raw_output, validated, motion_id, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms)
     values ($1, 'campaign_email_sequence', 'v1', $2, $3, $4, true, $5, 'v1', $6, $7, $8, $9)`,
    [
      m.org_id,
      meta.model,
      JSON.stringify({ motionId: args.motionId, touchCount }),
      JSON.stringify(sequence),
      args.motionId,
      meta.inputTokens,
      meta.outputTokens,
      meta.costUsd,
      meta.latencyMs,
    ],
  );

  return { sequence, motion: m, brand, brandId };
}

export async function generateCampaignSequence(
  db: pg.PoolClient,
  args: {
    motionId: string;
    senderName: string;
    touchCount?: number;
    bookingUrl?: string | null;
    source?: "user" | "ai_suggested";
  },
): Promise<{ campaignId: string; sequence: CampaignSequence }> {
  const { sequence, motion: m, brand, brandId } = await draftSequenceForMotion(db, args);

  const { rows: campaigns } = await db.query<{ id: string }>(
    `insert into campaigns (org_id, company_id, motion_id, name, status, brand_id, objective, audience, source)
     values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8) returning id`,
    [m.org_id, m.company_id, args.motionId, sequence.campaign_name, brandId, sequence.objective, sequence.audience, args.source ?? "user"],
  );
  const campaignId = campaigns[0].id;

  const snapshot = buildSnapshot(m);
  for (let i = 0; i < sequence.touches.length; i++) {
    const t = sequence.touches[i];
    const { html, text } = renderBrandedEmail(brand, {
      preheader: t.preheader,
      eyebrow: `Touch ${i + 1}`,
      headline: t.headline,
      paragraphs: t.paragraphs,
      highlights: t.highlights,
      snapshot: i === 0 ? snapshot : undefined,
      ctaLabel: t.cta_label,
      ctaUrl: args.bookingUrl ?? null,
      signoff: args.senderName,
    });
    await db.query(
      `insert into campaign_touches
        (campaign_id, touch_no, name, subject, preheader, headline, body, highlights,
         cta_label, cta_url, html_body, text_body, send_offset_days, account_angle, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft')`,
      [
        campaignId,
        i + 1,
        t.name,
        t.subject,
        t.preheader,
        t.headline,
        t.paragraphs.join("\n\n"),
        t.highlights,
        t.cta_label,
        args.bookingUrl ?? null,
        html,
        text,
        t.send_offset_days,
        t.account_angle ?? null,
      ],
    );
  }

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'CAMPAIGN_CREATED', $4)`,
    [m.org_id, args.motionId, m.company_id, JSON.stringify({ campaignId, touches: sequence.touches.length })],
  );

  return { campaignId, sequence };
}

/**
 * AI-draft touches into an EXISTING campaign (the "either/or" on the composer:
 * hand-author, or let AI draft, in the same campaign). Requires the campaign to
 * be linked to a motion for grounding; appends after the current last touch.
 */
export async function appendAiTouches(
  db: pg.PoolClient,
  args: { campaignId: string; senderName?: string; touchCount?: number },
): Promise<{ added: number }> {
  const senderName = args.senderName ?? "The PursuitOS Team";
  const { rows: caRows } = await db.query<{ motion_id: string | null }>(
    `select motion_id from campaigns where id = $1`,
    [args.campaignId],
  );
  if (caRows.length === 0) throw new Error("campaign not found");
  const motionId = caRows[0].motion_id;
  if (!motionId) {
    throw new Error("This campaign isn't linked to a motion. Add touches by hand here, or generate from a motion on the Campaigns page.");
  }

  const { sequence, motion: m, brand } = await draftSequenceForMotion(db, {
    motionId,
    senderName,
    touchCount: args.touchCount,
  });

  const { rows: maxRows } = await db.query<{ n: number }>(
    `select coalesce(max(touch_no), 0) as n from campaign_touches where campaign_id = $1`,
    [args.campaignId],
  );
  let no = Number(maxRows[0].n);
  const snapshot = buildSnapshot(m);
  for (const t of sequence.touches) {
    no += 1;
    const { html, text } = renderBrandedEmail(brand, {
      preheader: t.preheader,
      eyebrow: `Touch ${no}`,
      headline: t.headline,
      paragraphs: t.paragraphs,
      highlights: t.highlights,
      snapshot: no === 1 ? snapshot : undefined,
      ctaLabel: t.cta_label,
      ctaUrl: null,
      signoff: senderName,
    });
    await db.query(
      `insert into campaign_touches
        (campaign_id, touch_no, name, subject, preheader, headline, body, highlights,
         cta_label, html_body, text_body, send_offset_days, account_angle, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft')`,
      [args.campaignId, no, t.name, t.subject, t.preheader, t.headline, t.paragraphs.join("\n\n"),
       t.highlights, t.cta_label, html, text, t.send_offset_days, t.account_angle ?? null],
    );
  }
  return { added: sequence.touches.length };
}

function buildSnapshot(m: {
  industry: string | null;
  employee_count: number | null;
  primary_domain: string | null;
}): { label: string; value: string }[] {
  const snap: { label: string; value: string }[] = [];
  if (m.industry) snap.push({ label: "Industry", value: m.industry });
  if (m.employee_count) snap.push({ label: "Headcount", value: `~${Number(m.employee_count).toLocaleString()}` });
  if (m.primary_domain) snap.push({ label: "Domain", value: m.primary_domain });
  return snap.slice(0, 3);
}
