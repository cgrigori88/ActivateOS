import type { Pool, PoolClient } from "pg";
import { getAnthropic } from "@/lib/ai/client";
import { MCP_TOOLS } from "@/lib/agents/mcp-tools";
import { resolveOrgAnthropicKey } from "@/lib/ai/org-keys";
import { decideToolScope, scopeSystemNote } from "./ask-scope";

/**
 * Ask-the-record: a conversational answer over the org's OWN MCP tool surface.
 * The model never sees raw tables — it sees ONLY the read tools of the MCP
 * surface, so an answer can only contain what the record (and the caller's
 * tenant) actually holds. R1-G1: EVERY write tool is excluded — no governed
 * mutation, and in particular no cross-tenant write (request_warm_intro), is
 * ever an autonomous tool for this LLM. The ask surface reads.
 *
 * Cheap tier on purpose (two-tier routing rule): synthesis over tool results
 * is routine volume, not judgment-heavy design work.
 */

const ASK_MODEL = "claude-haiku-4-5";
const MAX_ROUNDS = 6;

const SYSTEM = `You answer questions about this tenant's revenue record using only the provided tools.
Rules:
- Ground every claim in tool results; if the record doesn't hold the answer, say so plainly.
- Cite specifics (account names, amounts, dates, sources) rather than generalities.
- Keep answers tight: a direct answer first, then the two or three facts that support it.
- Never invent accounts, numbers, or events. Never speculate about data you did not retrieve.`;

export interface AskResult {
  answer: string;
  toolCalls: { tool: string; args: Record<string, unknown> }[];
  model: string;
}

/**
 * P2C-0 §2: the ecosystem scope is now a REQUIRED input, not an optional nicety. `companyIds`
 * null = no narrowing (scope ALL); an array = the authorized set, enforced at the tool boundary
 * before anything becomes model-visible context. See ask-scope.ts.
 */
export interface AskOptions { companyIds?: string[] | null }

export async function askTheRecord(
  pool: Pool | PoolClient, orgId: string, question: string, opts: AskOptions = {},
): Promise<AskResult> {
  const companyIds = opts.companyIds ?? null;
  const tools = MCP_TOOLS.filter((t) => !t.write);
  const anthropic = getAnthropic(await resolveOrgAnthropicKey(pool, orgId));

  const apiTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as { type: "object"; [k: string]: unknown },
  }));

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: question.slice(0, 2000) },
  ];
  const toolCalls: AskResult["toolCalls"] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: ASK_MODEL,
      max_tokens: 1500,
      system: SYSTEM + scopeSystemNote(companyIds),
      tools: apiTools,
      // The SDK's message types are stricter than our accumulating array.
      messages: messages as never,
    });

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      const result = { answer: answer || "The record holds no answer to that.", toolCalls, model: ASK_MODEL };
      await pool.query(
        `insert into ask_exchanges (org_id, question, answer, tool_calls, model) values ($1, $2, $3, $4, $5)`,
        [orgId, question.slice(0, 2000), result.answer, JSON.stringify(toolCalls), ASK_MODEL],
      );
      return result;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: unknown[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const tool = tools.find((t) => t.name === block.name);
      const args = (block.input ?? {}) as Record<string, unknown>;
      toolCalls.push({ tool: block.name, args });
      let payload: unknown;
      try {
        if (!tool) {
          payload = { error: "unknown tool" };
        } else {
          // Scope is enforced BEFORE the tool runs — a refused call never produces out-of-scope
          // rows, so nothing outside the authorized set can reach the model's context window.
          const decision = await decideToolScope(pool, orgId, tool, args, companyIds);
          payload = decision.allowed ? await tool.run(pool, orgId, args) : decision.refusal;
        }
      } catch (err) {
        payload = { error: err instanceof Error ? err.message : "tool failed" };
      }
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(payload).slice(0, 20_000),
      });
    }
    messages.push({ role: "user", content: results });
  }

  throw new Error("The question needed more tool rounds than the ask surface allows.");
}
