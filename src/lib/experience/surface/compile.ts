/**
 * P7 Slice 6 — THE SURFACE COMPILER. Pure, synchronous, and total before anything executes.
 *
 * WHOLE-SPEC ATOMICITY IS THE SAFETY ARGUMENT (ruling 3). The entire spec is parsed, every field
 * validated and every component compiled BEFORE a single governed execution happens. If any part
 * fails, the whole surface is rejected and **zero** components run.
 *
 * The dangerous design — the one this exists to refuse — is *build the full surface, then remove the
 * panels the principal may not see*, because the **gap itself discloses** that something is there. A
 * surface is never built and then edited: it is validated whole, or it does not exist. That is the
 * same shape as Slice 2's omitted statements and Slice 3's cohort membership.
 *
 * IT COMPILES, IT DOES NOT INTERPRET. Every component's bind goes through `compileIntent` — the Slice 5
 * compiler that is already hosted-accepted — so a surface cannot express anything an intent could not.
 * This module holds no database handle and calls no model.
 *
 * SLICE 7 CHANGES NOTHING HERE BUT THE VERSION STAMP. Context-bound components are compiled by the
 * path that was ALREADY threaded through this function: the manifest and the digest a component's bind
 * is bound to are forwarded to `compileIntent`, which resolves `{fromContext:n}` against exactly that
 * manifest and refuses — out of range, non-integer, or a stale digest — rather than retargeting. That
 * substrate was built in Slice 6 and simply had no component that exercised it (ruling C).
 */
import { createHash } from "node:crypto";
import { compileIntent } from "../intent/compile";
import { COMPONENTS, MAX_COMPONENTS, componentRegistryDigest, isComponentKey, isLayoutKey } from "./registry";
import type { ContextManifest, ProposalSource } from "../intent/schema";
import type { SurfaceCompileOutcome, SurfaceProvenance, ValidatedSurfaceSpec } from "./schema";

export const SURFACE_COMPILER_VERSION = "p7-slice7-surface@1";

export interface SurfaceCompileInputs {
  /** The untrusted spec — from a model or a caller; neither has more authority than the other. */
  spec: unknown;
  manifest: ContextManifest;
  boundContextDigest: string;
  source: ProposalSource;
  modelId?: string | null;
  promptTemplateVersion?: string | null;
}

const fail = (detail: string): SurfaceCompileOutcome => ({ ok: false, detail });

export function compileSurface(inputs: SurfaceCompileInputs): SurfaceCompileOutcome {
  const s = inputs.spec;
  if (typeof s !== "object" || s === null || Array.isArray(s)) return fail("spec must be an object");
  const spec = s as Record<string, unknown>;

  // Unknown keys are REJECTED, not ignored: this is what keeps a style block, a title, a URL, a
  // filter or an organization unrepresentable rather than merely unused.
  for (const k of Object.keys(spec)) {
    if (k !== "specVersion" && k !== "layout" && k !== "components") return fail(`unknown spec key ${k}`);
  }
  if (spec.specVersion !== 1) return fail("specVersion must be 1");
  if (!isLayoutKey(spec.layout)) return fail(`unknown layout ${String(spec.layout)}`);

  if (!Array.isArray(spec.components)) return fail("components must be an array");
  if (spec.components.length === 0) return fail("a surface needs at least one component");
  if (spec.components.length > MAX_COMPONENTS) return fail(`a surface may hold at most ${MAX_COMPONENTS} components`);

  const compiled: ValidatedSurfaceSpec["components"] = [];
  /**
   * Duplicate identity, decided AFTER canonical normalization of the COMPILED bind (ruling 4) — and
   * in Slice 6 the component TYPE is also unique, because repeated types with genuinely different
   * binds are explicitly deferred to a later slice. The identity set is kept because it is the
   * semantics that survives; the type set is the narrower first-vertical rule on top of it.
   */
  const seen = new Set<string>();
  const seenTypes = new Set<string>();

  for (const raw of spec.components as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("each component must be an object");
    const c = raw as Record<string, unknown>;
    for (const k of Object.keys(c)) {
      if (k !== "component" && k !== "bind") return fail(`unknown component key ${k}`);
    }
    if (!isComponentKey(c.component)) return fail(`unknown component ${String(c.component)}`);
    const def = COMPONENTS[c.component];

    // The bind is compiled by the CERTIFIED compiler, bound to the same manifest and digest.
    const intent = compileIntent({
      proposal: c.bind,
      manifest: inputs.manifest,
      boundContextDigest: inputs.boundContextDigest,
      source: inputs.source,
      modelId: inputs.modelId,
      promptTemplateVersion: inputs.promptTemplateVersion,
    });
    // A component that needs clarification is not a surface component: a surface is composed of
    // things that will run, and a half-specified panel is a partial surface by another name.
    if (!intent.ok) return fail(`component ${def.key} did not compile`);
    // A component may bind ONLY its own registered operation — a cohort cannot become a list.
    if (intent.intent.operation !== def.operation) {
      return fail(`component ${def.key} binds ${def.operation}, not ${intent.intent.operation}`);
    }

    // Canonical normalization: the component type plus the COMPILED request, never raw JSON bytes.
    // Two specs whose binds differ only in key order or whitespace are the same component.
    const identity = JSON.stringify([def.key, canonical(intent.intent.request)]);
    if (seen.has(identity)) return fail(`duplicate component ${def.key}`);
    seen.add(identity);
    // Slice 6: one panel per registered component type. A second `pursuit.list` bound to a different
    // view is a genuinely different composition, and it is a LATER slice's capability, not this one's.
    if (seenTypes.has(def.key)) return fail(`repeated component type ${def.key}`);
    seenTypes.add(def.key);

    compiled.push({ component: def.key, title: def.title, operation: def.operation, intent: intent.intent });
  }

  const provenance: SurfaceProvenance = {
    specVersion: 1,
    surfaceSpecDigest: surfaceDigest(spec.layout, compiled),
    componentRegistryDigest: componentRegistryDigest(),
    // The intent compiler already stamped these on every component; they are identical across a spec.
    vocabularyDigest: compiled[0].intent.provenance.vocabularyDigest,
    contextDigest: compiled[0].intent.provenance.contextDigest,
    compilerVersion: SURFACE_COMPILER_VERSION,
    source: inputs.source,
    modelId: compiled[0].intent.provenance.modelId,
    promptTemplateVersion: compiled[0].intent.provenance.promptTemplateVersion,
  };

  return {
    ok: true,
    validated: {
      spec: { specVersion: 1, layout: spec.layout, components: spec.components as ValidatedSurfaceSpec["spec"]["components"] },
      components: compiled,
      provenance,
    },
  };
}

/** Key-order-independent canonical form, so normalization is about MEANING and not serialization. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

/**
 * THE EXECUTION-IDENTITY DIGEST (Slice 7, ruling A).
 *
 * > `surfaceSpecDigest` is a POST-COMPILATION execution-identity digest, not a hash of the raw
 * > submitted `SurfaceSpec`.
 *
 * It covers the layout and the ordered, canonically-normalized COMPILED components — so for a
 * context-bound component the resolved canonical identity participates, and two manifests with
 * identical recipient-visible labels but different objects produce DIFFERENT execution identity. That
 * is the property replay needs, and it is why this is deliberately not redefined around the raw
 * `{fromContext:n}` reference.
 *
 * The asymmetry is intentional: `SHOW_ME`/`ANALYZE` bind no object and stay identity-independent;
 * `EXPLAIN`/`GO_TO` become identity-sensitive after resolution. Replay identity is the PAIR
 * `surfaceSpecDigest + contextDigest`, which is why both are stamped separately below.
 *
 * A canonical id participating in a HASH is not a canonical id being disclosed: this is recorded as
 * provenance, never rendered (ruling 6), and a suite proves no resolved identifier is newly
 * serialized into any recipient-visible surface because the digest was computed from one.
 */
function surfaceDigest(layout: string, components: ValidatedSurfaceSpec["components"]): string {
  return createHash("sha256")
    .update(JSON.stringify([layout, components.map((c) => [c.component, canonical(c.intent.request)])]))
    .digest("hex").slice(0, 16);
}
