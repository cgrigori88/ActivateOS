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
import { mayExportIdentity } from "./identity";
import { isSelectorKey } from "../plans";
import type { ContextManifest, ProposalSource } from "../intent/schema";
import type { ComponentDependency, SurfaceCompileOutcome, SurfaceProvenance, ValidatedSurfaceSpec, ValidatedComponent } from "./schema";

export const SURFACE_COMPILER_VERSION = "p7-slice8-surface@1";

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

  const compiled: ValidatedComponent[] = [];
  /**
   * Duplicate identity, decided AFTER canonical normalization of the COMPILED bind (ruling 4) — and
   * in Slice 6 the component TYPE is also unique, because repeated types with genuinely different
   * binds are explicitly deferred to a later slice. The identity set is kept because it is the
   * semantics that survives; the type set is the narrower first-vertical rule on top of it.
   */
  const seen = new Set<string>();
  const seenTypes = new Set<string>();
  /** Which components are available to be depended ON: ones already validated ABOVE this node. */
  const upstream = new Map<string, ValidatedComponent>();

  for (const raw of spec.components as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("each component must be an object");
    const c = raw as Record<string, unknown>;
    for (const k of Object.keys(c)) {
      if (k !== "component" && k !== "bind") return fail(`unknown component key ${k}`);
    }
    if (!isComponentKey(c.component)) return fail(`unknown component ${String(c.component)}`);
    const def = COMPONENTS[c.component];

    // ── SLICE 8: is this a DEPENDENT node? ──────────────────────────────────────────────────────
    const bind = (typeof c.bind === "object" && c.bind !== null && !Array.isArray(c.bind))
      ? c.bind as Record<string, unknown> : null;
    const subject = bind?.subject;
    const dependent = !!subject && typeof subject === "object" && !Array.isArray(subject)
      && "fromComponent" in (subject as object);

    let node: ValidatedComponent;
    let identityKey: string;

    if (dependent) {
      const dep = validateDependency(subject as Record<string, unknown>, def.key, upstream);
      if (typeof dep === "string") return fail(dep);
      if (!def.acceptsComponentIdentity) return fail(`component ${def.key} does not accept component-derived identity`);

      // THE BIND IS VALIDATED NOW, NOT LATER. A dry run through the CERTIFIED compiler, against a
      // sentinel one-slot context, proves the whole bind is well-formed — its operation, its surface
      // key, its closed key set — so a malformed dependent bind is refused before anything executes.
      // The dry run's OUTPUT is discarded: only its success is consulted, and the sentinel identity
      // never reaches an execution (a suite proves it appears in no executed request).
      const probe = compileIntent({
        proposal: { ...bind, subject: { fromContext: 0 } },
        manifest: SENTINEL_CONTEXT,
        boundContextDigest: SENTINEL_CONTEXT.digest,
        source: inputs.source,
        modelId: inputs.modelId,
        promptTemplateVersion: inputs.promptTemplateVersion,
      });
      if (!probe.ok) return fail(`component ${def.key} did not compile`);
      if (probe.intent.operation !== def.operation) {
        return fail(`component ${def.key} binds ${def.operation}, not ${probe.intent.operation}`);
      }

      const { subject: _dropped, ...rest } = bind as Record<string, unknown>;
      node = { kind: "DYNAMIC", component: def.key, title: def.title, operation: def.operation, dependency: dep, bind: rest };
      // Identity covers the DEPENDENCY, not a resolved id — which does not exist yet.
      identityKey = JSON.stringify([def.key, canonical(rest), dep.fromComponent, dep.select]);
    } else {
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
      node = { kind: "STATIC", component: def.key, title: def.title, operation: def.operation, intent: intent.intent };
      // Canonical normalization: the component type plus the COMPILED request, never raw JSON bytes.
      // Two specs whose binds differ only in key order or whitespace are the same component.
      identityKey = JSON.stringify([def.key, canonical(intent.intent.request)]);
    }

    if (seen.has(identityKey)) return fail(`duplicate component ${def.key}`);
    seen.add(identityKey);
    // Slice 6: one panel per registered component type. A second `pursuit.list` bound to a different
    // view is a genuinely different composition, and it is a LATER slice's capability, not this one's.
    if (seenTypes.has(def.key)) return fail(`repeated component type ${def.key}`);
    seenTypes.add(def.key);

    compiled.push(node);
    upstream.set(def.key, node);
  }

  const anchor = compiled.find((c) => c.kind === "STATIC");
  if (!anchor || anchor.kind !== "STATIC") return fail("a surface needs at least one directly-bound component");
  const stamped = anchor.intent.provenance;

  const provenance: SurfaceProvenance = {
    specVersion: 1,
    surfaceSpecDigest: surfaceDigest(spec.layout, compiled),
    componentRegistryDigest: componentRegistryDigest(),
    // The intent compiler already stamped these; they are identical across a spec. A DYNAMIC node
    // has not compiled yet, so provenance is read from a static node — of which a dependent surface
    // always has at least one, because a dependency requires an upstream component to depend on.
    vocabularyDigest: stamped.vocabularyDigest,
    contextDigest: stamped.contextDigest,
    compilerVersion: SURFACE_COMPILER_VERSION,
    /** Stamped at EXECUTION, where a derived identity exists. Null keeps Slice 7 behaviour exact. */
    executionDigest: null,
    source: inputs.source,
    modelId: stamped.modelId,
    promptTemplateVersion: stamped.promptTemplateVersion,
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
function surfaceDigest(layout: string, components: ValidatedComponent[]): string {
  return createHash("sha256")
    .update(JSON.stringify([layout, components.map((c) => c.kind === "STATIC"
      ? [c.component, canonical(c.intent.request)]
      // A DYNAMIC node contributes its DEPENDENCY, never a resolved identity — which does not exist
      // at compile time. Its resolved identity lives in `executionDigest` instead (ruling E), which
      // is why a surface with no dynamic node keeps its Slice 7 digest byte-for-byte.
      : [c.component, canonical(c.bind), c.dependency.fromComponent, c.dependency.select])]))
    .digest("hex").slice(0, 16);
}

/**
 * VALIDATE ONE DEPENDENCY EDGE, before anything executes. Returns the edge, or the reason it is not
 * one. Every clause here is a refusal the threat model names.
 */
function validateDependency(
  subject: Record<string, unknown>, self: string, upstream: Map<string, ValidatedComponent>,
): ComponentDependency | string {
  for (const k of Object.keys(subject)) {
    if (k !== "fromComponent" && k !== "select") return `unknown dependency key ${k}`;
  }
  const from = subject.fromComponent;
  if (!isComponentKey(from)) return `unknown dependency target ${String(from)}`;
  if (from === self) return `component ${self} cannot depend on itself`;
  if (!isSelectorKey(subject.select)) return `unknown selector ${String(subject.select)}`;

  // UPSTREAM MEANS EARLIER. The array order IS the topological order, so a forward reference — and
  // therefore any cycle — is refused here rather than needing a separate cycle search.
  const source = upstream.get(from);
  if (!source) return `component ${self} depends on ${from}, which is not upstream of it`;
  if (!COMPONENTS[from].exportsIdentity) return `component ${from} does not export identity`;
  // DEPTH IS BOUNDED STRUCTURALLY: a node that CONSUMES identity is not an exporter, so it can never
  // be depended upon, and a second level cannot be expressed at all.
  if (source.kind !== "STATIC") return `component ${from} is itself derived and cannot export identity`;
  // Identity export is a per-PLAN capability, default OFF (ruling F). Being a SHOW ME is not enough.
  const view = (source.intent.request as { view?: string }).view;
  if (!view || !mayExportIdentity(view as Parameters<typeof mayExportIdentity>[0], subject.select)) {
    return `plan ${String(view)} is not certified to export identity for ${String(subject.select)}`;
  }
  return { fromComponent: from, select: subject.select };
}

/**
 * The sentinel context the compile-time dry run resolves against. Its id is never executed: the dry
 * run's output is discarded and only its success consulted. It exists so a dependent bind is fully
 * validated BEFORE execution rather than at it.
 */
const SENTINEL_ID = "00000000-0000-4000-8000-000000000000";
const SENTINEL_CONTEXT = { digest: "p7s8-sentinel", ids: Object.freeze([SENTINEL_ID]) };
export const COMPILE_SENTINEL_ID = SENTINEL_ID;
