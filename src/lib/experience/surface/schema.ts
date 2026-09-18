/**
 * P7 Slice 6 — DYNAMIC PURSUIT SURFACES: the shapes.
 *
 * > **Generated interfaces may compose PursuitOS. They may not redefine PursuitOS.**
 *
 *   SurfaceSpec proposal → FULL deterministic validation → certified component executions
 *     → deterministic SurfaceResult → transport rendering
 *
 * THE DECISIVE CHOICE: a component's `bind` is a Slice 5 `ModelProposal` (ruling 2). A component does
 * not describe a query — it names an operation the certified compiler already validates. Composition
 * is therefore *layout + an ordered list of proposals*, and everything Slice 5 made unrepresentable
 * stays unrepresentable for free: no SQL, no table or column name, no URL, no model-supplied UUID, no
 * filter, no metric definition, no `asOf`, no organization, no permission, no executable code.
 * **There is no second grammar to audit**, and widening Dynamic Surfaces means widening Slice 5
 * deliberately first.
 */
import type { ModelProposal, IntentOperation } from "../intent/schema";
import type { IntentExecution } from "../intent/run";

/** Closed presentation vocabulary (ruling 9). Presentation only — never an input to execution. */
export type LayoutKey = "stack" | "grid";

/** Closed component vocabulary. Four; a fifth is a reviewed code change, never a model request. */
export type ComponentKey = "pursuit.list" | "pursuit.cohort" | "pursuit.explanation" | "pursuit.destination";

export interface ComponentSpec {
  component: ComponentKey;
  /** EXACTLY a Slice 5 proposal. Untrusted, and compiled by the certified compiler. */
  bind: ModelProposal;
}

export interface SurfaceSpec {
  specVersion: 1;
  layout: LayoutKey;
  components: ComponentSpec[];
}

/**
 * Compiler-owned provenance. Recorded, never rendered (ruling 6) — the spec digest included. None of
 * these fields confers authority, and a suite proves no governance path reads them.
 */
export interface SurfaceProvenance {
  specVersion: 1;
  /** Digest of the VALIDATED spec: layout plus the ordered, canonically-normalized component binds. */
  surfaceSpecDigest: string;
  componentRegistryDigest: string;
  vocabularyDigest: string;
  contextDigest: string;
  compilerVersion: string;
  source: "HAND_AUTHORED" | "MODEL";
  /** null unless a model actually ran — a provider that never ran is not recorded as if it had. */
  modelId: string | null;
  promptTemplateVersion: string | null;
}

/** A spec that has passed the WHOLE validation, with every component already compiled (ruling 3). */
export interface ValidatedSurfaceSpec {
  spec: SurfaceSpec;
  components: {
    component: ComponentKey;
    /** Registry-owned (ruling 6). Never model prose. */
    title: string;
    operation: IntentOperation;
    /** The compiled, certified intent this component will execute. */
    intent: import("../intent/schema").CompiledIntent;
  }[];
  provenance: SurfaceProvenance;
}

/** The HEADLESS result. No React, no HTML, no framework type (ruling 11). */
export interface SurfaceResult {
  layout: LayoutKey;
  components: {
    component: ComponentKey;
    title: string;
    /** Deterministic, registry-composed: what this component actually ran. */
    interpretedAs: string;
    /** The registered ViewKey this component bound, where its operation takes one. Registry data. */
    view: string | null;
    /** The ALREADY-GOVERNED Slice 1–4 output. */
    outcome: IntentExecution;
  }[];
  provenance: SurfaceProvenance;
}

/**
 * Why a surface was not produced. `CAPABILITY_DENIED` is the flag/entitlement conjunction; `INVALID`
 * is the whole-spec rejection, and it carries no per-component detail — a surface that named which
 * component failed would be a partial surface described in words.
 *
 * `NOT_AVAILABLE` is Slice 7's whole-surface atomic failure (ruling B): a context-bound component
 * could not produce its certified available result, so the ENTIRE surface is withdrawn. It is
 * STRUCTURALLY INCAPABLE of saying more — there is no `detail`, no component key, no operation, no
 * index and no count, so no caller can accidentally render which component failed, whether the target
 * once existed, whether governance changed, or whether navigation specifically was unavailable. The
 * type is the mechanism, not a convention a renderer is asked to respect.
 */
export type SurfaceOutcome =
  | { ok: true; result: SurfaceResult }
  | { ok: false; error: "CAPABILITY_DENIED" }
  | { ok: false; error: "INVALID"; detail: string }
  | { ok: false; error: "NOT_AVAILABLE" };

export type SurfaceCompileOutcome =
  | { ok: true; validated: ValidatedSurfaceSpec }
  | { ok: false; detail: string };
