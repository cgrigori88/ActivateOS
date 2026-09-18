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
export function getAnthropic(apiKey?: string | null): Anthropic {
  // A tenant-supplied key (BYO-model, slice C) gets its own client: their
  // data rides their AI contract. The cached default serves everyone else.
  if (apiKey) return new Anthropic({ apiKey });
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

/**
 * A CAPABILITY-SCOPED CREDENTIAL (P7 Slice 5).
 *
 * > Provider credentials are capability-scoped inputs, not ambient application authority. A feature
 * > may not become provider-capable merely because another feature's credential exists.
 *
 * `getAnthropic(apiKey?)` falls back to global discovery when no key is supplied — correct for the
 * callers that have always used it, and exactly wrong for a feature whose whole point is that it
 * consumes ONE named credential and nothing else. A caller that passed `undefined` by accident would
 * silently acquire the ambient key.
 *
 * So the fail-closed property is made structural rather than remembered. `ScopedCredential` is
 * branded: the only way to obtain one is `scopedCredential()`, which returns **null** when the
 * variable is absent or blank. A call site with no credential therefore has no value to pass and
 * cannot type-check its way into the global path — there is nothing to forget.
 */
declare const SCOPED_CREDENTIAL: unique symbol;
export interface ScopedCredential {
  readonly [SCOPED_CREDENTIAL]: true;
  readonly apiKey: string;
}

/** Returns null when the named credential is absent or blank. Never reads any other variable. */
export function scopedCredential(raw: string | undefined | null): ScopedCredential | null {
  const apiKey = (raw ?? "").trim();
  return apiKey.length > 0 ? ({ apiKey } as unknown as ScopedCredential) : null;
}

export class ModelRefusalError extends Error {
  constructor(public category: string | null) {
    super(`model declined the request (category: ${category ?? "unknown"})`);
  }
}

/** List prices per million tokens, for AI cost tracking (BLUEPRINT §49). */
const PRICING: Record<ModelTier, { input: number; output: number }> = {
  cheap: { input: 1, output: 5 },
  frontier: { input: 5, output: 25 },
};

export interface CallMeta {
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Schema-constrained completion (AGENT_LAYER rule: every workflow output is
 * validated against a typed schema; free-form text never leaves an agent).
 * Returns observability metadata alongside the output (BLUEPRINT §48–49).
 */
export async function completeStructuredMeta<T extends z.ZodType>(opts: {
  tier: ModelTier;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
  /** Tenant-supplied key (BYO-model): the call runs on their contract. */
  apiKey?: string | null;
}): Promise<{ output: z.infer<T>; meta: CallMeta }> {
  const anthropic = getAnthropic(opts.apiKey);
  const started = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS[opts.tier],
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });
  const latencyMs = Date.now() - started;

  if (response.stop_reason === "refusal") {
    throw new ModelRefusalError(response.stop_details?.category ?? null);
  }
  if (response.parsed_output == null) {
    throw new Error("model output failed schema validation");
  }
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const price = PRICING[opts.tier];
  return {
    output: response.parsed_output,
    meta: {
      model: MODELS[opts.tier],
      tier: opts.tier,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
      latencyMs,
    },
  };
}

export async function completeStructured<T extends z.ZodType>(opts: {
  tier: ModelTier;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const { output } = await completeStructuredMeta(opts);
  return output;
}

/**
 * Schema-constrained completion on an EXPLICIT capability-scoped credential.
 *
 * `credential` is required and non-nullable, so this function cannot reach `getAnthropic()`'s global
 * discovery: a caller without a credential cannot call it at all. It delegates to the same
 * `completeStructuredMeta` seam every other surface uses — no second structured-output
 * implementation, no second provider abstraction, and no change to any existing caller.
 */
export async function completeStructuredScoped<T extends z.ZodType>(opts: {
  credential: ScopedCredential;
  tier: ModelTier;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}): Promise<{ output: z.infer<T>; meta: CallMeta }> {
  return completeStructuredMeta({
    tier: opts.tier,
    system: opts.system,
    user: opts.user,
    schema: opts.schema,
    maxTokens: opts.maxTokens,
    apiKey: opts.credential.apiKey,
  });
}
