/**
 * P7 Slice 6 — THE HEADLESS ASSEMBLER.
 *
 *   ValidatedSurfaceSpec → SurfaceResult
 *
 * No React, no HTML, no framework type (ruling 11). The web renderer consumes this value; a future
 * API, MCP or Slack adapter consumes the same one and reproduces no composition or governance logic —
 * structurally, because an adapter receives a value, not a query, and holds no database handle.
 *
 * COMPONENTS CONSUME GOVERNED OUTPUTS; THEY DO NOT BECOME NEW READERS. Every component executes
 * through `runCompiledIntent`, which delegates to `executePursuitQuery` and `resolveGoTo` — the
 * boundaries certified in Slices 1–4. Slice 6 adds no read path, so every P6 decision is still made
 * exactly where it is made today, and no component can see another's raw data: each receives only its
 * own already-governed output.
 *
 * SLICE 7 — WHOLE-SURFACE ATOMICITY AT EXECUTION TIME (ruling B). Slice 6 made the surface atomic at
 * COMPILE time: validated whole or not built at all. Context-bound components add a second moment
 * where a surface can become partial, because a spec that compiled at T1 executes at T2 — and
 * governance may have moved. So the same rule is applied again, here: if a context-bound component
 * cannot produce its certified available result, the WHOLE surface is withdrawn and NOTHING is
 * returned. No surviving sibling, no placeholder, no empty card, no gap, no component-specific error,
 * and no difference in component count.
 *
 * WHY EXECUTE-THEN-DISCARD RATHER THAN PRE-CHECK (ruling B2). Asking "may this principal see that
 * object?" before running the component would mean a SECOND authority resolver beside P6 — two places
 * that must agree forever, which is the defect, not the safeguard. Instead each component calls the
 * boundary that already decides, and the result is discarded if the surface cannot stand. This is
 * sound because every component here is READ-ONLY; it would not be sound for a mutating one.
 *
 * IT DOES NOT AUTHORIZE PARTIAL STREAMING FOLLOWED BY RETRACTION. The transport invariant is that no
 * component result becomes recipient-observable before whole-surface success is determined: this
 * function returns a single already-finalized value, and React is handed that value or nothing.
 *
 * SLICE 8 — TOPOLOGICAL EXECUTION AND DERIVED IDENTITY. The validated graph is already in
 * topological order (a dependency may only name a component validated ABOVE it), so execution is
 * still a single forward pass. An exporting component's governed result is reduced by a registered
 * selector to ONE identity; consumers compile against that through the SAME certified compiler.
 *
 * UPSTREAM VISIBILITY IS NOT DOWNSTREAM AUTHORIZATION. A derived identity names a CANDIDATE. Every
 * consumer still executes through its own certified P6/P7 boundary under the current principal, and
 * the handle carries no field that could be mistaken for a decision.
 *
 * THE SELECTION CONSUMES THE GOVERNED RESULT — the very object the upstream component produced, not
 * a fresh, broader query run to find an identity. There is no second read here to govern.
 *
 * THE CAPABILITY GATE IS THE CANONICAL ONE (ruling 1). `vnextCapabilities` owns the Dynamic Surfaces
 * dependency chain; this module asks it rather than restating it, so the conjunction cannot drift.
 * Tenant Pursuit Experience entitlement is ALSO enforced independently inside each component's
 * governed execution, which is where it has always been enforced.
 */
import { COMPONENTS } from "./registry";
import { interpretedAs } from "../intent/vocabulary";
import { withTenant, withTenantOrg } from "@/lib/db/tenant";
import { tenantFeatures } from "@/lib/pursuits/tenant-flags";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { runCompiledIntent } from "../intent/run";
import { compileIntent } from "../intent/compile";
import { surfaceDisposition, type ExecutedComponent } from "./availability";
import { asResolutionContext, executionDigest, selectIdentity, type DerivedIdentityContext } from "./identity";
import type { ComponentKey } from "./schema";
import type { ExecutionPrincipal } from "../principal";
import { principalOrgId } from "../principal";
import type { SurfaceOutcome, ValidatedSurfaceSpec } from "./schema";

/**
 * Is the Dynamic Surfaces capability enabled for this principal's organization?
 *
 * Deliberately NOT a reimplementation: it reads the tenant's own feature row and hands it to the
 * canonical `vnextCapabilities`, whose declared dependency chain (dynamic_surfaces requires
 * pursuit_intelligence, which requires pursuit_state and pursuit_memory, all beneath the tenant's
 * experience entitlement) stays the single source of truth.
 */
export async function dynamicSurfacesEnabled(principal?: ExecutionPrincipal): Promise<boolean> {
  const read = async (db: Parameters<typeof tenantFeatures>[0], orgId: string) =>
    vnextCapabilities(await tenantFeatures(db, orgId)).dynamicSurfaces;
  if (principal) {
    const orgId = principalOrgId(principal);
    return withTenantOrg(orgId, (db) => read(db, orgId));
  }
  return withTenant((db, orgId) => read(db, orgId));
}

/**
 * Execute a validated spec. By the time this runs, the WHOLE spec has compiled — so this function
 * either produces every component or produces none.
 */
export async function assembleSurface(
  validated: ValidatedSurfaceSpec, principal?: ExecutionPrincipal,
): Promise<SurfaceOutcome> {
  if (!(await dynamicSurfacesEnabled(principal))) return { ok: false, error: "CAPABILITY_DENIED" };

  // EVERY component executes first, into LOCALS that never escape on a failure path. Each runs
  // against canonical state under the CURRENT principal; only IDENTITY flows between them, and only
  // along an edge the compiler already validated.
  const executed: ExecutedComponent[] = [];
  const results: (Awaited<ReturnType<typeof runCompiledIntent>> | null)[] = [];
  const exported = new Map<ComponentKey, DerivedIdentityContext>();
  const bindings: { consumer: ComponentKey; derived: DerivedIdentityContext }[] = [];

  for (const c of validated.components) {
    let intent;
    if (c.kind === "STATIC") {
      intent = c.intent;
    } else {
      // The upstream identity, resolved from the result its component ALREADY produced.
      const derived = exported.get(c.dependency.fromComponent);
      // NOTHING TO SELECT is a composition outcome, not a governance one, and not a defect: the
      // upstream result was valid and simply held no selectable row. No fallback is invented here —
      // no nearest row, no default, no previous context (ruling D).
      if (!derived) return { ok: false, error: "NO_SELECTABLE_RESULT" };

      // Compiled by the SAME certified compiler, through the narrow adapter: one slot, so the
      // resolver's own refusals (digest mismatch, out of range, non-integer) still apply unchanged.
      const compiled = compileIntent({
        proposal: { ...c.bind, subject: { fromContext: 0 } },
        manifest: asResolutionContext(derived),
        boundContextDigest: derived.digest,
        source: validated.provenance.source,
        modelId: validated.provenance.modelId,
        promptTemplateVersion: validated.provenance.promptTemplateVersion,
      });
      // The bind was already proven well-formed at compile time, so a failure here is an internal
      // inconsistency rather than anything the recipient did — and it is NOT a governed absence.
      if (!compiled.ok) return { ok: false, error: "FAILED" };
      intent = compiled.intent;
      bindings.push({ consumer: c.component, derived });
    }

    const outcome = await runCompiledIntent(intent, principal);
    executed.push({ operation: c.operation, execution: outcome });
    results.push(outcome);

    // EXPORT, but only what the registry certified and only from a governed result this component
    // actually produced. A component that exports nothing simply never reaches this.
    if (c.kind === "STATIC" && COMPONENTS[c.component].exportsIdentity
        && outcome.kind === "RESULT" && outcome.outcome.ok) {
      const selector = selectorFor(validated, c.component);
      if (selector) {
        const derived = selectIdentity(outcome.outcome.result, selector, c.component);
        if (derived) exported.set(c.component, derived);
      }
    }
  }

  // THE ATOMIC DECISION, taken ONCE over the WHOLE executed set — because the property being decided
  // is a property of the surface, not of a component. Everything already executed is dropped here,
  // unreturned. The outcome has nowhere to put a component, a reason or a count, so this branch
  // could not disclose which component failed even if a caller wanted it to.
  //
  // The disposition keeps GOVERNED unavailability, the entitlement conjunction and an APPLICATION
  // defect apart, and is defect-first, so a bug can never arrive wearing a disclosure word.
  const disposition = surfaceDisposition(executed);
  if (disposition !== "AVAILABLE") return { ok: false, error: disposition };

  // A dependent component whose upstream exported nothing never got here — but a surface whose
  // dependency was satisfied must have produced every binding it validated.
  if (validated.components.some((c) => c.kind === "DYNAMIC") && bindings.length === 0) {
    return { ok: false, error: "NO_SELECTABLE_RESULT" };
  }

  const components: SurfaceResultComponents = validated.components.map((c, i) => ({
    component: c.component,
    title: c.title,
    interpretedAs: c.kind === "STATIC" ? c.intent.interpretedAs : INTERPRETED[c.operation],
    view: c.kind === "STATIC" ? (c.intent.provenance.view ?? null) : null,
    outcome: results[i]!,
  }));

  const provenance = { ...validated.provenance, executionDigest: executionDigest(bindings) };

  return { ok: true, result: { layout: validated.spec.layout, components, provenance } };
}

type SurfaceResultComponents = Extract<SurfaceOutcome, { ok: true }>["result"]["components"];

/** Registry-composed wording for a derived component. Never model prose, never names the object. */
const INTERPRETED: Record<string, string> = {
  EXPLAIN: interpretedAs("EXPLAIN"),
  GO_TO: interpretedAs("GO_TO"),
  SHOW_ME: interpretedAs("SHOW_ME"),
  ANALYZE: interpretedAs("ANALYZE"),
};

/** The selector every consumer of this component asked for — validated identical by the compiler. */
function selectorFor(validated: ValidatedSurfaceSpec, source: ComponentKey) {
  for (const c of validated.components) {
    if (c.kind === "DYNAMIC" && c.dependency.fromComponent === source) return c.dependency.select;
  }
  return null;
}
