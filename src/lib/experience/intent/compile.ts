/**
 * P7 Slice 5 — THE DETERMINISTIC COMPILER. Pure, synchronous, and the only thing that grants meaning.
 *
 * > The model proposes intent. PursuitOS determines meaning and execution.
 *
 * This module takes an UNTRUSTED `ModelProposal` and either produces a `CompiledIntent` whose request
 * is an already-certified shape, or refuses. It never approximates: an unrepresentable request becomes
 * `UNSUPPORTED`, and an ambiguous one becomes `NEEDS_CLARIFICATION` — **never the broader view**
 * (ruling 1). Choosing the bigger answer when unsure is exactly the authority the model must not have,
 * and it is not an authority this module claims on the model's behalf either.
 *
 * NO BEST-EFFORT SUBSTITUTION. An unknown view, surface or clarification key is refused by name, with
 * no nearest match and no "did you mean" — the same refusal `validatePlan` already makes for an
 * unregistered metric. A guess here would be the compiler deciding what the user meant.
 *
 * IT HOLDS NO DATABASE HANDLE and calls no model. A proposal cannot cause a read from here; execution
 * happens later, through the boundaries Slices 1–4 already certified.
 */
import { PLANS, isViewKey } from "../plans";
import { DESTINATIONS, destinationKey } from "../registry";
import { resolveContextRef } from "./context";
import { CLARIFICATIONS, interpretedAs, vocabularyDigest } from "./vocabulary";
import type {
  ClarificationKey, CompileOutcome, IntentProvenance, ModelProposal, ProposalSource, ResolutionContext, ViewKey,
} from "./schema";

/** Bumped when the compiler's semantics change. Stamped into provenance; never read for authority. */
export const COMPILER_VERSION = "p7-slice5-compiler@1";

export interface CompileInputs {
  /** The untrusted model output, `unknown` on purpose: it arrives as JSON from a provider. */
  proposal: unknown;
  /**
   * The context the proposal is bound to, and the digest it was issued against.
   *
   * SLICE 8 widened this from `ContextManifest` to the minimum resolution needs, so an execution-time
   * derived identity can be compiled by THIS compiler rather than a second one. The compiler cannot
   * tell the two apart, and must not: it resolves an index against a digest either way.
   */
  manifest: ResolutionContext;
  boundContextDigest: string;
  /**
   * Provenance the COMPILER stamps. The model cannot supply or override any of it (ruling 4), and a
   * caller that puts these in the proposal is refused by the closed schema below.
   *
   * `source` is provenance, never authority: both sources traverse the identical path and can express
   * exactly the same things.
   */
  source: ProposalSource;
  /** Ignored unless `source` is MODEL — a hand-authored proposal never records a model that did not run. */
  modelId?: string | null;
  promptTemplateVersion?: string | null;
}

const unsupported = (): CompileOutcome => ({ ok: false, state: "UNSUPPORTED" });
const clarify = (missing: ClarificationKey): CompileOutcome => ({ ok: false, state: "NEEDS_CLARIFICATION", missing });

export function compileIntent(inputs: CompileInputs): CompileOutcome {
  const p = inputs.proposal;
  // Malformed structured output executes nothing, and is not repaired into something adjacent.
  if (typeof p !== "object" || p === null || Array.isArray(p)) return unsupported();
  const proposal = p as Partial<ModelProposal> & Record<string, unknown>;

  // UNKNOWN KEYS ARE REJECTED, not ignored. This is what keeps a path, url, orgId, filter, metric,
  // asOf or raw id UNREPRESENTABLE rather than merely unused — a silently dropped field would be a
  // silently changed question.
  const allowed: Record<string, readonly string[]> = {
    SHOW_ME: ["operation", "view"],
    ANALYZE: ["operation", "view"],
    EXPLAIN: ["operation", "subject"],
    GO_TO: ["operation", "subject", "surface"],
    NEEDS_CLARIFICATION: ["operation", "missing"],
    UNSUPPORTED: ["operation"],
  };
  const op = proposal.operation;
  if (typeof op !== "string" || !(op in allowed)) return unsupported();
  for (const k of Object.keys(proposal)) if (!allowed[op].includes(k)) return unsupported();

  if (op === "UNSUPPORTED") return unsupported();
  if (op === "NEEDS_CLARIFICATION") {
    const missing = proposal.missing;
    // Even the clarification key is closed vocabulary; free text is not a key.
    if (typeof missing !== "string" || !(CLARIFICATIONS as readonly string[]).includes(missing)) return unsupported();
    return clarify(missing as ClarificationKey);
  }

  const fromModel = inputs.source === "MODEL";
  const stamp = (operation: IntentProvenance["operation"], view?: ViewKey): IntentProvenance => ({
    proposalSchemaVersion: 1,
    source: inputs.source,
    compilerVersion: COMPILER_VERSION,
    // A hand-authored proposal records NO model and NO prompt: a provider that was never called is
    // not provenance, it is fiction. Forced here rather than trusted from the caller.
    promptTemplateVersion: fromModel ? (inputs.promptTemplateVersion ?? null) : null,
    vocabularyDigest: vocabularyDigest(),
    contextDigest: inputs.manifest.digest,
    modelId: fromModel ? (inputs.modelId ?? null) : null,
    operation,
    ...(view ? { view } : {}),
  });

  // ── SHOW_ME / ANALYZE: a registered ViewKey, and nothing else (ruling 1) ──────────────────────
  if (op === "SHOW_ME" || op === "ANALYZE") {
    const view = proposal.view;
    if (typeof view !== "string") return unsupported();
    if (!isViewKey(view)) return unsupported();          // unknown view: refused, never approximated
    // ANALYZE is available only where the fixed plan already carries a registered aggregate. Asking
    // to analyze a view that has none is not widened into one that does.
    if (op === "ANALYZE" && PLANS[view].plan.aggregate === false) return unsupported();
    return {
      ok: true,
      intent: {
        operation: op,
        request: { view },
        interpretedAs: interpretedAs(op, view),
        provenance: stamp(op, view),
      },
    };
  }

  // ── EXPLAIN / GO_TO: a governed context reference, never an id (ruling 2) ─────────────────────
  const subject = proposal.subject as { fromContext?: unknown } | undefined;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return unsupported();
  for (const k of Object.keys(subject)) if (k !== "fromContext") return unsupported();
  // An empty context means there is nothing to name: ask, rather than search (Slice 5 has no search).
  if (inputs.manifest.ids.length === 0) return clarify("subject");

  const subjectId = resolveContextRef(inputs.manifest, inputs.boundContextDigest, subject.fromContext);
  if (subjectId === null) return unsupported();          // out of range, non-integer, or stale digest

  if (op === "EXPLAIN") {
    return {
      ok: true,
      intent: {
        operation: "EXPLAIN",
        request: { subjectId },
        interpretedAs: interpretedAs("EXPLAIN"),
        provenance: stamp("EXPLAIN"),
      },
    };
  }

  const surface = proposal.surface;
  if (typeof surface !== "string" || !DESTINATIONS[destinationKey("pursuit", surface)]) return unsupported();
  return {
    ok: true,
    intent: {
      operation: "GO_TO",
      // The already-certified Slice 4 request shape, built here — not carried from the model.
      request: { requestVersion: 1, ref: { class: "pursuit", id: subjectId }, surface: surface as "canonical" },
      interpretedAs: interpretedAs("GO_TO"),
      provenance: stamp("GO_TO"),
    },
  };
}
