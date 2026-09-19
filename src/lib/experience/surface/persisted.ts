/**
 * P7 Slice 12 — THE PERSISTED SURFACE DEFINITION. Pure, closed, and deliberately not a SurfaceSpec.
 *
 * > **A pinned surface may persist a validated presentation/query definition. It may not persist
 * > governed results, derived identities, authority, disclosure decisions or execution state.**
 *
 * > **Persist the question/workspace, never the answer or the authority.**
 *
 * ── WHY THIS IS A SEPARATE TYPE, AND NOT `SurfaceSpec` ──────────────────────────────────────────
 *
 * > **Persistence is opt-in by field/type, never inherited from the runtime SurfaceSpec shape.**
 *
 * If persistence reused `SurfaceSpec`, every field a later slice adds to it would become durable the
 * moment it was added — silently, with no review, and discovered later as data. Building the
 * persisted form field by field inverts that: a new runtime field is **not** persistable until
 * someone writes it into this file on purpose.
 *
 * AND `ValidatedSurfaceSpec` IS NOT PERSISTABLE AT ALL — this is the trap worth naming, because it
 * is the type whose NAME most suggests it is the right one. It carries a `CompiledIntent` per
 * component, and for `EXPLAIN`/`GO_TO` that request holds a RESOLVED canonical `subjectId`. Storing
 * it would durably record a governed object reference under the word "definition".
 *
 * WHAT SLICE 12 DOES NOT PERSIST, by construction rather than by care: recipient context bindings
 * (`{fromContext:n}` is an index into a REQUEST-SCOPED manifest, so persisting it would mean "slot n
 * of whatever context you happen to have next time" — a silent retarget dressed as reuse), component
 * dependencies and their resolved identities, ACTION components, and anything an execution produced.
 */
import { createHash } from "node:crypto";
import { COMPONENTS } from "./registry";
import { isViewKey, PLANS } from "../plans";
import type { ComponentKey, LayoutKey } from "./schema";

/** The persisted schema's own version, independent of `specVersion` and of any compiler version. */
export const PERSISTED_DEFINITION_VERSION = 1;

/**
 * THE PERSISTABLE COMPONENTS. Slice 12 v1 persists only components that need **no** recipient
 * context and **no** upstream dependency, which leaves exactly the two whose bind is a registered
 * view key. `EXPLAIN` and `GO_TO` are excluded because their subject is request-scoped context;
 * `pursuit.assemble_team` is excluded because it is an ACTION.
 */
export const PERSISTABLE_COMPONENTS = ["pursuit.list", "pursuit.cohort"] as const;
export type PersistableComponentKey = (typeof PERSISTABLE_COMPONENTS)[number];

/**
 * THE EXHAUSTIVENESS FORCE (ruling G). Every registered component is classified here, so adding one
 * to the registry without deciding whether it may be persisted is a COMPILE ERROR rather than a
 * silent default. `never` is the point: an unclassified key has nowhere to go.
 */
const PERSISTABILITY: Record<ComponentKey, "PERSISTABLE" | "NOT_PERSISTABLE"> = {
  "pursuit.list": "PERSISTABLE",
  "pursuit.cohort": "PERSISTABLE",
  // Request-scoped subject: durable persistence would silently retarget (ruling B).
  "pursuit.explanation": "NOT_PERSISTABLE",
  "pursuit.destination": "NOT_PERSISTABLE",
  // ACTION — structurally excluded from persistence in Slice 12 (ruling G).
  "pursuit.assemble_team": "NOT_PERSISTABLE",
};

export const isPersistableComponent = (k: unknown): k is PersistableComponentKey =>
  typeof k === "string" && k in PERSISTABILITY
  && PERSISTABILITY[k as ComponentKey] === "PERSISTABLE"
  // The registry's OWN declaration must agree: a READ kind, and no action capability. Classified
  // above AND declared there — two sources that must both say yes.
  && COMPONENTS[k as ComponentKey].kind === "READ";

/** One persisted component. The bind is a registered view key and nothing else — no subject exists. */
export interface PersistedComponent {
  component: PersistableComponentKey;
  operation: "SHOW_ME" | "ANALYZE";
  view: string;
}

/** The closed persisted shape. Every field here was added deliberately; nothing is inherited. */
export interface PersistedSurfaceDefinition {
  definitionVersion: typeof PERSISTED_DEFINITION_VERSION;
  layout: LayoutKey;
  components: PersistedComponent[];
  /**
   * NON-AUTHORITATIVE audit metadata, exactly as Slice 5 defined it: it records which path produced
   * the definition and is read by nothing that decides what may run. A model-authored definition is
   * executed without ever calling a model again.
   */
  source: "HAND_AUTHORED" | "MODEL";
}

/** Why a validated surface could not be persisted. Closed, and never a partial save. */
export type PersistOutcome =
  | { ok: true; definition: PersistedSurfaceDefinition }
  | { ok: false; reason: string };

/**
 * Build the persisted form from an ALREADY-VALIDATED spec's structural content.
 *
 * It takes the pre-execution spec, never the validated/compiled one — so there is no code path by
 * which a resolved `subjectId` could reach persistence, because this function is never handed one.
 */
export function toPersistedDefinition(
  layout: unknown, components: unknown, source: "HAND_AUTHORED" | "MODEL",
): PersistOutcome {
  if (layout !== "stack" && layout !== "grid") return { ok: false, reason: `unknown layout ${String(layout)}` };
  if (!Array.isArray(components) || components.length === 0) return { ok: false, reason: "a definition needs at least one component" };

  const out: PersistedComponent[] = [];
  for (const raw of components) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "each component must be an object" };
    const c = raw as Record<string, unknown>;
    for (const k of Object.keys(c)) {
      if (k !== "component" && k !== "bind") return { ok: false, reason: `unknown component key ${k}` };
    }
    if (!isPersistableComponent(c.component)) {
      return { ok: false, reason: `component ${String(c.component)} is not persistable` };
    }
    const bind = c.bind;
    if (typeof bind !== "object" || bind === null || Array.isArray(bind)) return { ok: false, reason: "each bind must be an object" };
    const b = bind as Record<string, unknown>;
    // A SUBJECT OF ANY KIND IS A REFUSAL, not a field to drop: a caller asking to persist a
    // context-bound or dependency-bound component must be told no, not quietly given something else.
    for (const k of Object.keys(b)) {
      if (k !== "operation" && k !== "view") return { ok: false, reason: `a persisted bind cannot carry ${k}` };
    }
    if (b.operation !== "SHOW_ME" && b.operation !== "ANALYZE") {
      return { ok: false, reason: `operation ${String(b.operation)} is not persistable` };
    }
    if (typeof b.view !== "string" || !isViewKey(b.view)) return { ok: false, reason: `unknown view ${String(b.view)}` };
    if (COMPONENTS[c.component].operation !== b.operation) {
      return { ok: false, reason: `component ${c.component} binds ${COMPONENTS[c.component].operation}` };
    }
    out.push({ component: c.component, operation: b.operation, view: b.view });
  }
  return { ok: true, definition: { definitionVersion: PERSISTED_DEFINITION_VERSION, layout, components: out, source } };
}

/**
 * Validate a definition that came BACK from storage. A stored row is untrusted input on the way out:
 * the registry may have moved since it was written, and a database is not a trust boundary.
 *
 * `DEFINITION_UNAVAILABLE` is deterministic and total — a retired view, an unregistered component or
 * an unknown layout produces it, and never a nearest match, a migration or a repair.
 */
export type LoadOutcome =
  | { ok: true; definition: PersistedSurfaceDefinition }
  | { ok: false; reason: "DEFINITION_UNAVAILABLE"; detail: string };

export function validatePersistedDefinition(value: unknown): LoadOutcome {
  const bad = (detail: string): LoadOutcome => ({ ok: false, reason: "DEFINITION_UNAVAILABLE", detail });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return bad("not an object");
  const d = value as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (!["definitionVersion", "layout", "components", "source"].includes(k)) return bad(`unknown field ${k}`);
  }
  if (d.definitionVersion !== PERSISTED_DEFINITION_VERSION) return bad(`unsupported definition version ${String(d.definitionVersion)}`);
  if (d.layout !== "stack" && d.layout !== "grid") return bad(`unknown layout ${String(d.layout)}`);
  if (d.source !== "HAND_AUTHORED" && d.source !== "MODEL") return bad(`unknown source ${String(d.source)}`);
  if (!Array.isArray(d.components) || d.components.length === 0) return bad("no components");

  for (const raw of d.components) {
    if (typeof raw !== "object" || raw === null) return bad("malformed component");
    const c = raw as Record<string, unknown>;
    for (const k of Object.keys(c)) {
      if (!["component", "operation", "view"].includes(k)) return bad(`unknown component field ${k}`);
    }
    // RE-ASKED AGAINST THE CURRENT REGISTRY, not against what was legal at save time.
    if (!isPersistableComponent(c.component)) return bad(`component ${String(c.component)} is no longer persistable`);
    if (c.operation !== "SHOW_ME" && c.operation !== "ANALYZE") return bad(`operation ${String(c.operation)} is not persistable`);
    if (typeof c.view !== "string" || !isViewKey(c.view)) return bad(`view ${String(c.view)} is no longer registered`);
    if (COMPONENTS[c.component as ComponentKey].operation !== c.operation) return bad(`component ${String(c.component)} no longer binds ${String(c.operation)}`);
    // ANALYZE is available only where the registered plan still carries an aggregate.
    if (c.operation === "ANALYZE" && PLANS[c.view as keyof typeof PLANS].plan.aggregate === false) {
      return bad(`view ${c.view} no longer carries an aggregate`);
    }
  }
  return { ok: true, definition: d as unknown as PersistedSurfaceDefinition };
}

/**
 * DEFINITION IDENTITY — domain-separated from execution identity (ruling C).
 *
 * > `definitionDigest` identifies **what was saved**. `surfaceSpecDigest` / `executionDigest`
 * > identify **what was executed**.
 *
 * `surfaceSpecDigest` is deliberately NOT reused: Slice 7 recorded it as a post-compilation
 * execution-identity digest, and for a context-bound component it incorporates a resolved canonical
 * identity. A stored definition must not carry an execution artefact in its identity.
 *
 * Display metadata is excluded, so a rename cannot change it.
 */
export function definitionDigest(d: PersistedSurfaceDefinition): string {
  return createHash("sha256")
    .update(JSON.stringify(["p7s12.definition", d.definitionVersion, d.layout,
      d.components.map((c) => [c.component, c.operation, c.view])]))
    .digest("hex").slice(0, 16);
}

/** The spec shape a loaded definition compiles through — the ordinary certified path, unchanged. */
export function toSurfaceSpec(d: PersistedSurfaceDefinition): { specVersion: 1; layout: LayoutKey; components: { component: ComponentKey; bind: { operation: string; view: string } }[] } {
  return {
    specVersion: 1,
    layout: d.layout,
    components: d.components.map((c) => ({ component: c.component, bind: { operation: c.operation, view: c.view } })),
  };
}
