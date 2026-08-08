import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Two-tier model routing (PROJECT_BRIEF §5): the cheap tier handles
 * extraction, classification, taxonomy mapping, and cross-checks (~80%+ of
 * calls); the frontier tier is reserved for revenue-motion design and other
 * judgment-heavy work. Never route routine volume through the frontier tier.
 */
export type ModelTier = "cheap" | "frontier";

const MODELS: Record<ModelTier, string> = {
  cheap: "claude-haiku-4-5",
  frontier: "claude-opus-5",
};

let client: Anthropic | null = null;

/**
 * Credentials resolve in the SDK's standard order: ANTHROPIC_API_KEY →
 * ANTHROPIC_AUTH_TOKEN → an OAuth profile stored by `ant auth login`
 * (Claude-subscription auth). No key needs to be configured in this codebase.
 */
export function getAnthropic(): Anthropic {
  if (!client) {
    try {
      client = new Anthropic();
    } catch (err) {
      throw new Error(
        "No Anthropic credentials found. Either run `ant auth login` (uses your Claude " +
          "subscription) or set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN. " +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return client;
}

export class ModelRefusalError extends Error {
  constructor(public category: string | null) {
    super(`model declined the request (category: ${category ?? "unknown"})`);
  }
}

/**
 * Schema-constrained completion (AGENT_LAYER rule: every workflow output is
 * validated against a typed schema; free-form text never leaves an agent).
 */
export async function completeStructured<T extends z.ZodType>(opts: {
  tier: ModelTier;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.parse({
    model: MODELS[opts.tier],
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });

  if (response.stop_reason === "refusal") {
    throw new ModelRefusalError(response.stop_details?.category ?? null);
  }
  if (response.parsed_output == null) {
    throw new Error("model output failed schema validation");
  }
  return response.parsed_output;
}
