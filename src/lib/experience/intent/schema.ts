/**
 * P7 Slice 5 — THE TWO ENVELOPES, and why there are two.
 *
 *   utterance → [ model ] → ModelProposal → deterministic compiler → CompiledIntent → certified P7
 *
 * `ModelProposal` is authored by the model and is **untrusted input**. It gains no authority from
 * being machine-generated: it is exactly as trusted as a query string, and is validated by the same
 * kind of closed-vocabulary validator that refuses an unregistered metric.
 *
 * `CompiledIntent` is produced ONLY by deterministic application code, after validation. The model
 * cannot emit one, cannot supply its provenance, and cannot override it (ruling 4) — which is what
 * makes provenance a record of *which compiler ran* rather than a claim the model makes about itself.
 *
 * WHAT THE MODEL CANNOT SAY. There is no field here for SQL, a path, a URL, a table, a column, an
 * organization, a principal, a filter, a metric definition, a cohort, an `asOf`, or a canonical id.
 * Those are not rejected by validation — they are **unrepresentable**, which is the same discipline
 * that kept a cross-org cohort (Slice 3) and an arbitrary route (Slice 4) out of their request shapes.
 */
import type { ViewKey } from "../plans";
import type { GoToRequest, SurfaceKey } from "../types";

/** The closed set of operations the model may propose. All read-only, all already certified. */
export type IntentOperation = "SHOW_ME" | "ANALYZE" | "EXPLAIN" | "GO_TO";

/**
 * A reference into the ContextManifest — never a UUID (ruling 2). The model points at something the
 * transport already established this recipient may see; it cannot mint an identifier, so it cannot be
 * used as an object-existence probe.
 */
export interface ContextRef {
  fromContext: number;
}

/** The closed vocabulary of things that can be missing. The QUESTION is rendered from the registry. */
export type ClarificationKey = "view" | "subject" | "operation";

/**
 * What the MODEL emits. Untrusted, and deliberately not the thing that executes.
 *
 * There is no `confidence` field, by design: a confidence score invites a threshold, and a threshold
 * is a place where a system quietly decides to act on something it does not understand.
 */
export type ModelProposal =
  | { operation: "SHOW_ME"; view: string }
  | { operation: "ANALYZE"; view: string }
  | { operation: "EXPLAIN"; subject: ContextRef }
  | { operation: "GO_TO"; subject: ContextRef; surface: string }
  | { operation: "NEEDS_CLARIFICATION"; missing: string }
  | { operation: "UNSUPPORTED" };

/**
 * One slot of interpretable context, built by deterministic code from ALREADY recipient-authorized
 * material. `label` is a governed cell that survived disclosure, or a class-generic fallback — the
 * same rule Slice 4 applied to navigation labels, for the same reason.
 */
export interface ContextSlot {
  class: "pursuit";
  /** Recipient-safe only. Never a raw value, never a withheld one. */
  label: string;
}

/**
 * The immutable manifest a proposal is bound to (ruling 2). `digest` covers the ordered slots, so a
 * proposal cannot be replayed against a different context to retarget its reference.
 */
export interface ContextManifest {
  manifestVersion: 1;
  slots: ContextSlot[];
  /** Stable digest of the ordered slots AND their ids — order changes change the digest. */
  digest: string;
  /** The canonical ids behind the slots. NEVER sent to the model; resolved only by the compiler. */
  readonly ids: readonly string[];
}

/**
 * Where a proposal came from. **Provenance only — never an authority distinction.** A hand-authored
 * proposal and a model-authored one pass through the identical parse → validate → compile → govern
 * path and can express exactly the same things; this field records which happened, and nothing reads
 * it to decide what may run.
 */
export type ProposalSource = "HAND_AUTHORED" | "MODEL";

/**
 * Compiler-stamped provenance. Enough to reproduce which compiler produced a proposal, and read by no
 * authorization or disclosure path — a suite proves that. The model cannot write any of it, and a
 * caller that tries to supply it is refused by the closed proposal schema.
 *
 * Model fields are `null` for a hand-authored proposal rather than fabricated: recording a model that
 * was never called would make provenance a story instead of a record.
 */
export interface IntentProvenance {
  proposalSchemaVersion: 1;
  source: ProposalSource;
  compilerVersion: string;
  /** null unless a model actually produced this proposal. */
  promptTemplateVersion: string | null;
  vocabularyDigest: string;
  contextDigest: string;
  /** null unless a model actually produced this proposal. */
  modelId: string | null;
  operation: IntentOperation;
  view?: ViewKey;
}

/** Produced ONLY by deterministic code. `request` is an already-certified shape, never a new one. */
export interface CompiledIntent {
  operation: IntentOperation;
  request: { view: ViewKey } | { subjectId: string } | GoToRequest;
  /** The recipient-facing statement of what will run, composed from registry metadata (ruling 8). */
  interpretedAs: string;
  provenance: IntentProvenance;
}

export type CompileOutcome =
  | { ok: true; intent: CompiledIntent }
  /** Non-executing. The question is rendered from the registry, never by the model (ruling 7). */
  | { ok: false; state: "NEEDS_CLARIFICATION"; missing: ClarificationKey }
  /** Non-executing. The request cannot be represented by the certified grammar. */
  | { ok: false; state: "UNSUPPORTED" };

export type { SurfaceKey, ViewKey };
