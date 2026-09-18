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
import type { SelectorKey } from "../plans";
import type { IntentExecution } from "../intent/run";

/** Closed presentation vocabulary (ruling 9). Presentation only — never an input to execution. */
export type LayoutKey = "stack" | "grid";

/** Closed component vocabulary. Four; a fifth is a reviewed code change, never a model request. */
export type ComponentKey = "pursuit.list" | "pursuit.cohort" | "pursuit.explanation" | "pursuit.destination"
  | "pursuit.assemble_team";

/**
 * SLICE 8 — the ONLY shape that expresses a component dependency. Closed, typed, and referencing a
 * component by its registered KEY, because one-component-per-type already makes that a unique closed
 * namespace inside a validated surface. An integer index would be indistinguishable in shape from the
 * row reference the threat model must forbid.
 *
 * There is no field here for a UUID, a field name, a path, a URL, SQL, a metric, a filter, an
 * expression or a model-authored transformation — they are UNREPRESENTABLE, not merely rejected.
 */
export interface ComponentDependency {
  fromComponent: ComponentKey;
  select: SelectorKey;
}

export const isComponentDependency = (v: unknown): v is ComponentDependency =>
  !!v && typeof v === "object" && !Array.isArray(v) && "fromComponent" in v;

export interface ComponentSpec {
  component: ComponentKey;
  /**
   * EXACTLY a Slice 5 proposal — or, in Slice 8, one whose `subject` is a component dependency
   * instead of a recipient `ContextRef`. Untrusted either way, and compiled by the certified compiler:
   * a dependent bind has its subject resolved at execution and is then compiled by the SAME
   * `compileIntent`, so there is no second grammar.
   */
  bind: ModelProposal | (Omit<Extract<ModelProposal, { operation: "EXPLAIN" | "GO_TO" }>, "subject"> & { subject: ComponentDependency });
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
  /**
   * SLICE 8 (ruling E). Domain-separated, over the ordered dynamic-binding facts, and stamped at
   * EXECUTION because that is when a derived identity exists. `null` for a surface with no
   * component-derived edge — which is why such a surface keeps its Slice 7 provenance byte-for-byte.
   */
  executionDigest: string | null;
  source: "HAND_AUTHORED" | "MODEL";
  /** null unless a model actually ran — a provider that never ran is not recorded as if it had. */
  modelId: string | null;
  promptTemplateVersion: string | null;
}

/**
 * ONE VALIDATED NODE. Slice 8 splits it in two, and the split is the whole architecture:
 *
 *   STATIC   — its subject was known at compile time, so it is ALREADY a certified `CompiledIntent`.
 *   DYNAMIC  — its subject is produced by an upstream governed read, so it cannot be compiled yet.
 *
 * A dynamic node is NOT half-validated. Its component, operation, bind shape, dependency legality,
 * upstream export permission and selector were all decided before execution; only the identity VALUE
 * is outstanding, and a value is data, not a validation input.
 */
export type ValidatedComponent =
  /**
   * SLICE 9. An ACTION node is validated to a CAPABILITY and a SUBJECT, and nothing else. There is
   * no `intent`, because an action is deliberately not an intent: the Slice 5 grammar stays
   * read-only by construction, so nothing consequential can ever arrive through it.
   */
  | {
      kind: "ACTION";
      component: ComponentKey;
      title: string;
      /** The registered capability this affordance stands for. Registry-owned. */
      capability: import("./actions").ActionCapability;
      /** The governed subject, resolved from the recipient's pre-existing context at compile time. */
      subjectId: string;
    }
  | {
      kind: "STATIC";
      component: ComponentKey;
      /** Registry-owned (ruling 6). Never model prose. */
      title: string;
      operation: IntentOperation;
      /** The compiled, certified intent this component will execute. */
      intent: import("../intent/schema").CompiledIntent;
    }
  | {
      kind: "DYNAMIC";
      component: ComponentKey;
      title: string;
      operation: IntentOperation;
      dependency: ComponentDependency;
      /** The validated bind, minus the subject that execution will resolve. Never a new grammar. */
      bind: Record<string, unknown>;
    };

/** A spec that has passed the WHOLE validation (ruling 3), in deterministic topological order. */
export interface ValidatedSurfaceSpec {
  spec: SurfaceSpec;
  components: ValidatedComponent[];
  provenance: SurfaceProvenance;
}

/**
 * ONE component's headless result. Slice 9 makes it a union, because an ACTION component produced no
 * governed output — it produced a governed AFFORDANCE, and giving it an empty `outcome` would invite
 * a renderer to treat the two as the same kind of thing.
 */
export type SurfaceComponentResult =
  | {
      kind: "READ";
      component: ComponentKey;
      title: string;
      /** Deterministic, registry-composed: what this component actually ran. */
      interpretedAs: string;
      /** The registered ViewKey this component bound, where its operation takes one. Registry data. */
      view: string | null;
      /** The ALREADY-GOVERNED Slice 1–4 output. */
      outcome: IntentExecution;
    }
  | {
      kind: "ACTION";
      component: ComponentKey;
      title: string;
      interpretedAs: string;
      /** The registered capability key, for the transport to name. NOT authority. */
      capability: string;
      /** The governed subject the affordance refers to. Untrusted routing input on the way back. */
      subjectId: string;
      /**
       * Whether the affordance is OFFERED to this viewer — a disclosure decision taken at render.
       * It is emphatically not a permission: the real decision happens again, on click, inside the
       * certified dispatch pipeline. Nothing downstream may read this as authorization.
       */
      offered: boolean;
    };

/** The HEADLESS result. No React, no HTML, no framework type (ruling 11). */
export interface SurfaceResult {
  layout: LayoutKey;
  components: SurfaceComponentResult[];
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
  | { ok: false; error: "NOT_AVAILABLE" }
  /**
   * An APPLICATION failure, and deliberately NOT `NOT_AVAILABLE`. An unexpected exception, a
   * malformed internal result, an infrastructure or provider failure and a programming defect are
   * not disclosure semantics, and relabelling one as governed unavailability would tell the
   * recipient something false about governance while hiding a bug behind a disclosure word.
   */
  | { ok: false; error: "FAILED" }
  /**
   * SLICE 8 (ruling D). A COMPOSITION outcome, and deliberately none of the others: the certified
   * upstream governed result was VALID and contained no row from which the registered selector could
   * produce the required identity.
   *
   * It is not `NOT_AVAILABLE` — nothing became undisclosable, and no target was ever identified, so
   * claiming one is unavailable would assert something false. It is not `FAILED` — an empty
   * authorized set is a certified correct answer (Slices 1 and 3), not a defect. And it is never
   * zero-as-data, an index failure, a nearest row or a default.
   *
   * Bare, like the others: it names no component, so it reveals no internal topology.
   */
  | { ok: false; error: "NO_SELECTABLE_RESULT" };

export type SurfaceCompileOutcome =
  | { ok: true; validated: ValidatedSurfaceSpec }
  | { ok: false; detail: string };
