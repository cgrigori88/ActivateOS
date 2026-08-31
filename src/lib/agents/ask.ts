import type { Pool, PoolClient } from "pg";
import { resolveOrgAnthropicKey } from "@/lib/ai/org-keys";
import { answerQuestion, type AnswerEnvelope, type AnswerOptions } from "@/lib/interpret/answer";
import { logAnswer } from "@/lib/interpret/log";

/**
 * Ask-the-record — rebuilt on the P2C-1 interpreter contract.
 *
 * WHAT THIS USED TO BE, and why it changed. Ask was an autonomous tool-calling agent: the model
 * held a loop over the org's MCP read tools, received their JSON payloads into its context, and
 * then WROTE THE ANSWER ITSELF. Every read was authorised (RLS, and after P2C-0 the ecosystem
 * scope too), so nothing leaked — but the model was the author of record. Three problems follow
 * from that, and none of them are fixable by prompting harder:
 *
 *   1. The answer's fidelity to the record was a property of the model's behaviour, not of the
 *      system. Nothing structurally prevented a plausible sentence the retrieved rows did not
 *      support.
 *   2. Real commercial payloads — amounts, dates, named stakeholders — sat in a model context
 *      window on every question, to produce an answer the deterministic resolvers could have
 *      produced from the same rows without the model seeing any of them.
 *   3. PursuitOS was running two query systems: ⌘K on the deterministic registry, Ask on a
 *      free-form agent. They answered the same questions differently, and would have drifted
 *      further with every intent added to one of them.
 *
 * P2C-1 §1/§8/§10 replaces all three. The model now sees the question and a catalog of intent
 * keys, and emits `{intentKey, slots}` — nothing else. The canonical resolver produces every
 * record, amount, date, stakeholder, route, readiness, outcome, attribution, value and lifecycle
 * state, exactly as it does for ⌘K, and this surface renders that output. No commercial data is
 * placed in a model context at any point in the flow.
 *
 * The MCP tool surface itself is untouched and still serves BYO-bots at /api/mcp; what was retired
 * is PursuitOS answering its own operators through a model that writes prose.
 */

export interface AskResult {
  envelope: AnswerEnvelope;
  model: string | null;
}

export interface AskOptions {
  /** The authorized company set (P2C-0 §2). `null` = no narrowing. */
  companyIds?: string[] | null;
  /** Skip the interpreter — the deterministic registry only. */
  deterministicOnly?: boolean;
}

export async function askTheRecord(
  pool: Pool | PoolClient, orgId: string, question: string, opts: AskOptions = {},
): Promise<AskResult> {
  // A tenant-supplied key still applies: their question rides their AI contract (BYO-model).
  // Resolution failure is not fatal — the interpreter tier is optional by construction, so Ask
  // degrades to the deterministic registry rather than erroring.
  let apiKey: string | null = null;
  try { apiKey = await resolveOrgAnthropicKey(pool, orgId); } catch { apiKey = null; }

  const answerOpts: AnswerOptions = {
    companyIds: opts.companyIds ?? null,
    apiKey,
    deterministicOnly: opts.deterministicOnly ?? false,
  };

  // `answerQuestion` wants a client (resolvers issue several statements); a Pool satisfies the
  // same query surface for these read-only paths.
  const envelope = await answerQuestion(pool as PoolClient, orgId, question, answerOpts);
  await logAnswer(pool, orgId, envelope, envelope.model);
  return { envelope, model: envelope.model };
}
