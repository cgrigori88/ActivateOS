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

export function getAnthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — agent workflows need it (deterministic pipelines run without it)",
      );
    }
    client = new Anthropic();
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
