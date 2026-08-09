import type pg from "pg";
import { z } from "zod";
import { completeStructuredMeta } from "../ai/client";

/**
 * Conversation Intelligence (founder decision §7–8): runs AFTER the raw
 * message is safely persisted, on the stripped reply text only. Produces
 * structured commercial findings; its factual claims about the customer
 * become first-party Evidence and flow through the SAME quality gates as
 * everything else — a customer email is trusted, not exempt.
 */

export const conversationSchema = z.object({
  response_type: z.enum([
    "POSITIVE",
    "NEUTRAL",
    "NEGATIVE",
    "REFERRAL",
    "NOT_NOW",
    "WRONG_CONTACT",
    "QUESTION",
    "UNSUBSCRIBE",
  ]),
  intent_strength: z.number().min(0).max(100),
  topics: z.array(z.string()),
  objections: z.array(z.string()),
  customer_needs: z.array(z.string()),
  technologies_mentioned: z.array(z.string()),
  competitors_mentioned: z.array(z.string()),
  timing_signals: z.array(z.string()),
  budget_signals: z.array(z.string()),
  stakeholders_mentioned: z.array(z.string()),
  recommended_next_action: z.object({
    title: z.string(),
    detail: z.string(),
    due_in_days: z.number().min(0).max(30),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  evidence_claims: z.array(
    z.object({
      claim: z
        .string()
        .describe("One specific factual assertion the customer made about their situation"),
      excerpt: z.string().describe("Verbatim quote from the customer's message"),
    }),
  ),
});

export type ConversationFindings = z.infer<typeof conversationSchema>;

const SYSTEM = `You analyze an inbound customer email reply for a B2B revenue-intelligence system.

Rules:
- Work ONLY from the customer's message text provided. Never infer facts they did not state.
- evidence_claims must each be a specific factual assertion (an active evaluation, a named stakeholder, a timeline, a budget statement, a technology in use) with its verbatim excerpt.
- UNSUBSCRIBE only when the customer asks to stop being contacted.
- intent_strength reflects commercial intent in THIS message: a confirmed active evaluation with a timeline is 85+, polite interest 40-60, a brush-off under 25.
- recommended_next_action is one concrete step a seller should take, grounded in what the customer asked for or signaled.`;

export async function analyzeReply(
  db: pg.PoolClient,
  args: {
    orgId: string | null;
    companyName: string;
    motionThesis: string | null;
    replyText: string;
  },
): Promise<ConversationFindings> {
  const { output, meta } = await completeStructuredMeta({
    tier: "cheap",
    system: SYSTEM,
    user:
      `Account: ${args.companyName}\n` +
      (args.motionThesis ? `Active motion thesis: ${args.motionThesis}\n` : "") +
      `\nCustomer reply:\n${args.replyText.slice(0, 12000)}`,
    schema: conversationSchema,
    maxTokens: 4096,
  });

  await db.query(
    `insert into agent_runs (org_id, workflow, workflow_version, model, input_summary,
        raw_output, validated, prompt_version, input_tokens, output_tokens, cost_usd, latency_ms)
     values ($1, 'conversation', 'v1', $2, $3, $4, true, 'v1', $5, $6, $7, $8)`,
    [
      args.orgId,
      meta.model,
      JSON.stringify({ company: args.companyName, chars: args.replyText.length }),
      JSON.stringify(output),
      meta.inputTokens,
      meta.outputTokens,
      meta.costUsd,
      meta.latencyMs,
    ],
  );
  return output;
}
