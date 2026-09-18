/**
 * P7 Slice 6 — THE SURFACE COMPONENT REGISTRY. Tiny, closed, and backed only by certified primitives.
 *
 * A component is added by a reviewed code change, NEVER because a model asked for one. Each declares
 * the certified operation it may bind, and a component whose bind names a different operation is a
 * hard validation failure — so `pursuit.cohort` cannot quietly become a list, and `pursuit.list`
 * cannot quietly become an aggregate.
 *
 * TITLES ARE REGISTRY-OWNED (ruling 6). There is no `title` field anywhere in a `SurfaceSpec`, so
 * arbitrary model prose cannot sit beside a governed number even by accident.
 *
 * SLICE 7 adds exactly two entries — `pursuit.explanation` and `pursuit.destination` — so the registry
 * now spans all four certified operations. The two new ones are CONTEXT-BOUND: their compiled request
 * names a canonical object resolved from the manifest, which is what brings them under the
 * whole-surface atomicity rule below.
 */
import { createHash } from "node:crypto";
import type { ComponentKey, LayoutKey } from "./schema";
import type { IntentOperation } from "../intent/schema";

export interface ComponentDef {
  key: ComponentKey;
  /** The ONE certified operation this component may bind. */
  operation: IntentOperation;
  /** Recipient-facing title. Registry-owned, deterministic, never authored by a model. */
  title: string;
  /**
   * SLICE 8 CAPABILITIES — DECLARED, NEVER INFERRED FROM A NAME (ruling 13).
   *
   * `exportsIdentity` additionally requires the bound PLAN to declare `identityExport`: being a
   * SHOW ME component is not enough, because safety is a property of the plan's ordering and
   * disclosure contract, not of the operation.
   *
   * Depth is bounded STRUCTURALLY rather than by a counter: no component that consumes identity also
   * exports it, so a second dependency level is unrepresentable in Slice 8 rather than merely unused.
   */
  exportsIdentity: boolean;
  acceptsContextIdentity: boolean;
  acceptsComponentIdentity: boolean;
}

export const COMPONENTS: Record<ComponentKey, ComponentDef> = {
  "pursuit.list": {
    key: "pursuit.list", operation: "SHOW_ME", title: "Pursuits",
    exportsIdentity: true, acceptsContextIdentity: false, acceptsComponentIdentity: false,
  },
  // ANALYZE EXPORTS NOTHING (ruling 13). An aggregate is a statement about a cohort, not an object,
  // and no component may consume one — enforced by the flag validation reads, not by convention.
  "pursuit.cohort": {
    key: "pursuit.cohort", operation: "ANALYZE", title: "Cohort total",
    exportsIdentity: false, acceptsContextIdentity: false, acceptsComponentIdentity: false,
  },
  "pursuit.explanation": {
    key: "pursuit.explanation", operation: "EXPLAIN", title: "Explanation",
    exportsIdentity: false, acceptsContextIdentity: true, acceptsComponentIdentity: true,
  },
  "pursuit.destination": {
    key: "pursuit.destination", operation: "GO_TO", title: "Go to",
    exportsIdentity: false, acceptsContextIdentity: true, acceptsComponentIdentity: true,
  },
};

/**
 * THE OPERATIONS THAT BIND A CANONICAL OBJECT (Slice 7, ruling B).
 *
 * Keyed on the OPERATION, never on the component key, so a component added later cannot escape the
 * whole-surface atomicity rule by being named something else: it inherits the rule from the certified
 * operation it registers. A suite proves every component whose compiled request carries an object
 * reference is classified here.
 */
export const CONTEXT_BOUND_OPERATIONS: readonly IntentOperation[] = ["EXPLAIN", "GO_TO"];

export const isContextBound = (operation: IntentOperation): boolean =>
  CONTEXT_BOUND_OPERATIONS.includes(operation);

/** Closed layout vocabulary (ruling 9). No sizes, spans, styles or per-component configuration. */
export const LAYOUTS: readonly LayoutKey[] = ["stack", "grid"];

/** Bounds fan-out: every component is a governed execution (ruling 4). */
export const MAX_COMPONENTS = 4;

export const isComponentKey = (v: unknown): v is ComponentKey =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(COMPONENTS, v);
export const isLayoutKey = (v: unknown): v is LayoutKey =>
  typeof v === "string" && (LAYOUTS as readonly string[]).includes(v);

/** A digest of the component vocabulary, stamped into provenance so a surface is reproducible. */
export function componentRegistryDigest(): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.values(COMPONENTS).map((c) => [c.key, c.operation, c.title])))
    .digest("hex").slice(0, 16);
}
