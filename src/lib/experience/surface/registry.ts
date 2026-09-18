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
}

export const COMPONENTS: Record<ComponentKey, ComponentDef> = {
  "pursuit.list":   { key: "pursuit.list",   operation: "SHOW_ME", title: "Pursuits" },
  "pursuit.cohort": { key: "pursuit.cohort", operation: "ANALYZE", title: "Cohort total" },
};

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
