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
 * THE CAPABILITY GATE IS THE CANONICAL ONE (ruling 1). `vnextCapabilities` owns the Dynamic Surfaces
 * dependency chain; this module asks it rather than restating it, so the conjunction cannot drift.
 * Tenant Pursuit Experience entitlement is ALSO enforced independently inside each component's
 * governed execution, which is where it has always been enforced.
 */
import { withTenant, withTenantOrg } from "@/lib/db/tenant";
import { tenantFeatures } from "@/lib/pursuits/tenant-flags";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { runCompiledIntent } from "../intent/run";
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
 * either produces every component or was never called.
 */
export async function assembleSurface(
  validated: ValidatedSurfaceSpec, principal?: ExecutionPrincipal,
): Promise<SurfaceOutcome> {
  if (!(await dynamicSurfacesEnabled(principal))) return { ok: false, error: "CAPABILITY_DENIED" };

  const components: SurfaceResultComponents = [];
  for (const c of validated.components) {
    // Each component executes INDEPENDENTLY against canonical state. Nothing is threaded between
    // them: one component's output is never another's input, so there is no path by which a
    // component could consume data governance withheld from it.
    components.push({
      component: c.component,
      title: c.title,
      interpretedAs: c.intent.interpretedAs,
      view: c.intent.provenance.view ?? null,
      outcome: await runCompiledIntent(c.intent, principal),
    });
  }

  return { ok: true, result: { layout: validated.spec.layout, components, provenance: validated.provenance } };
}

type SurfaceResultComponents = Extract<SurfaceOutcome, { ok: true }>["result"]["components"];
