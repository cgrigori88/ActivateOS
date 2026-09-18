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
 * THE CAPABILITY GATE IS THE CANONICAL ONE (ruling 1). `vnextCapabilities` owns the Dynamic Surfaces
 * dependency chain; this module asks it rather than restating it, so the conjunction cannot drift.
 * Tenant Pursuit Experience entitlement is ALSO enforced independently inside each component's
 * governed execution, which is where it has always been enforced.
 */
import { withTenant, withTenantOrg } from "@/lib/db/tenant";
import { tenantFeatures } from "@/lib/pursuits/tenant-flags";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { runCompiledIntent } from "../intent/run";
import { surfaceAvailability, type ExecutedComponent } from "./availability";
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

  // EVERY component executes first, into a LOCAL that never escapes on the failure path. Each runs
  // INDEPENDENTLY against canonical state under the CURRENT principal; nothing is threaded between
  // them, so one component's output is never another's input — and no result can flow back into the
  // context that named the object.
  const executed: ExecutedComponent[] = [];
  for (const c of validated.components) {
    executed.push({ operation: c.operation, execution: await runCompiledIntent(c.intent, principal) });
  }

  // THE ATOMIC DECISION, taken ONCE over the WHOLE executed set — because the property being decided
  // is a property of the surface, not of a component. Everything already executed is dropped here,
  // unreturned. The outcome has nowhere to put a component, a reason or a count, so this branch
  // could not disclose which component failed even if a caller wanted it to.
  if (surfaceAvailability(executed) === "NOT_AVAILABLE") return { ok: false, error: "NOT_AVAILABLE" };

  const components: SurfaceResultComponents = validated.components.map((c, i) => ({
    component: c.component,
    title: c.title,
    interpretedAs: c.intent.interpretedAs,
    view: c.intent.provenance.view ?? null,
    outcome: executed[i].execution,
  }));

  return { ok: true, result: { layout: validated.spec.layout, components, provenance: validated.provenance } };
}

type SurfaceResultComponents = Extract<SurfaceOutcome, { ok: true }>["result"]["components"];
