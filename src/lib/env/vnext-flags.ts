/**
 * vNext roadmap feature flags (Session 0 scaffolding).
 *
 * WHY A SEPARATE MODULE. The existing tenant flag system
 * (`src/lib/pursuits/tenant-flags.ts`) is the enforcement authority for shipped
 * capabilities: `live_for(org, flag) === envEnabled(flag) && org_features.<flag>`,
 * fail-closed, audited through `org_feature_changes`. These vNext flags do not
 * replace it and must never be mistaken for it. They answer a narrower question:
 * "is this unbuilt roadmap capability visible in THIS deployment at all?"
 *
 * That distinction matters because the two layers have different lifetimes. A
 * vNext flag exists so a half-built capability can live on `main`-adjacent
 * branches and be exercised in a preview deployment while staying dark in the
 * demo. Once a capability is real, it graduates: it gains an `org_features`
 * column and moves under the tenant system, and its vNext flag is retired.
 * Keeping the staging gate out of `org_features` avoids migrating the demo
 * database for features that do not exist yet.
 *
 * THE COMPOSITION RULE — the part that keeps this safe.
 *
 *   A vNext flag is only ever an ADDITIONAL, NARROWING gate.
 *
 * It can hide a surface. It can never reveal one, never widen a scope, never
 * satisfy a permission check, and never stand in for the tenant gate. Every
 * reader below therefore takes the already-resolved `TenantFeatureView` and
 * ANDs against it, so a caller cannot reach a vNext capability without first
 * having passed `tenantFeatures(db, orgId)`. That is a structural guarantee
 * rather than a convention: there is no exported reader that consults a vNext
 * flag alone for a user-facing capability.
 *
 * DEFAULT OFF EVERYWHERE. Unset resolves to false, and an unrecognised value
 * resolves to false — the same truthiness contract the existing flags use, so
 * one mental model covers both systems. Demo and production set none of these,
 * so they are dark by omission rather than by configuration.
 *
 * RUNTIME, NOT BUILD TIME. These are deliberately not `NEXT_PUBLIC_*`. Next
 * evaluates server-only env vars at request time and never inlines them into the
 * client bundle (see `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`),
 * so flag state cannot leak to the browser. Note the deployment nuance: Vercel
 * applies an env-var change only to NEW deployments, so flipping a flag on a
 * hosted environment still requires a redeploy.
 *
 * SESSION 0 SCOPE: names, parsing, and composition only. No capability behind
 * any of these flags is implemented yet.
 */
import type { TenantFeatureView } from "@/lib/pursuits/tenant-flags";

export type VNextFlag =
  | "context_health"
  | "pursuit_state"
  | "pursuit_memory"
  | "pursuit_intelligence"
  | "next_best_action"
  | "pursuit_coordination"
  | "pursuit_attention"
  | "control_plane"
  | "dynamic_surfaces";

/**
 * Flag → env var. The `VNEXT_` prefix marks the staging lane; the `_ENABLED`
 * suffix matches the convention already used by `PURSUITS_ENABLED`,
 * `FACTS_ENABLED`, `ROUTING_ENABLED` and friends, so the whole flag surface
 * greps as one family.
 */
const ENV_VAR: Record<VNextFlag, string> = {
  context_health: "VNEXT_CONTEXT_HEALTH_ENABLED",
  pursuit_state: "VNEXT_PURSUIT_STATE_ENABLED",
  pursuit_memory: "VNEXT_PURSUIT_MEMORY_ENABLED",
  pursuit_intelligence: "VNEXT_PURSUIT_INTELLIGENCE_ENABLED",
  next_best_action: "VNEXT_NEXT_BEST_ACTION_ENABLED",
  pursuit_coordination: "VNEXT_PURSUIT_COORDINATION_ENABLED",
  pursuit_attention: "VNEXT_PURSUIT_ATTENTION_ENABLED",
  control_plane: "VNEXT_CONTROL_PLANE_ENABLED",
  dynamic_surfaces: "VNEXT_DYNAMIC_SURFACES_ENABLED",
};

export const VNEXT_ENV_VARS: readonly string[] = Object.values(ENV_VAR);

/**
 * Raw deployment switch for one vNext flag. Exported for operator surfaces and
 * tests ONLY — it is not an authorization answer. User-facing code must go
 * through `vnextCapabilities`, which cannot be reached without the tenant gate.
 */
export function vnextEnvEnabled(flag: VNextFlag): boolean {
  const v = (process.env[ENV_VAR[flag]] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/** True when any vNext flag is armed — used to label preview/operator surfaces. */
export function vnextLaneActive(): boolean {
  return (Object.keys(ENV_VAR) as VNextFlag[]).some(vnextEnvEnabled);
}

export interface VNextCapabilityView {
  /** Freshness + coverage of a pursuit's supporting context. */
  contextHealth: boolean;
  /** What PursuitOS currently believes is happening. */
  pursuitState: boolean;
  /** Chronological read-model over the append-only change ledger. */
  pursuitMemory: boolean;
  /** Why this pursuit / why now / what's missing. */
  pursuitIntelligence: boolean;
  /**
   * The single recommended next move. RESERVED — never implemented. The P3
   * amendment replaced isolated next-best-action with Goal → Plan → Motion →
   * Action, which ships as `pursuitCoordination` (D-025). Kept so no deployment
   * that already names the variable changes meaning.
   */
  nextBestAction: boolean;
  /** Pursuit Goal → Pursuit Plan → Motion → Action, on Pursuit Detail (Slice 2A). */
  pursuitCoordination: boolean;
  /**
   * Pursuit attention on Today and plan lineage on Queue (Slice 2B). Derived from the
   * Slice 2A plan — it cannot exist without it.
   */
  pursuitAttention: boolean;
  /** Thin backend registry/observability primitives. Not a user surface. */
  controlPlane: boolean;
  /** Task-specific composed views over canonical data. */
  dynamicSurfaces: boolean;
}

const OFF: VNextCapabilityView = {
  contextHealth: false, pursuitState: false, pursuitMemory: false,
  pursuitIntelligence: false, nextBestAction: false, pursuitCoordination: false,
  pursuitAttention: false, controlPlane: false, dynamicSurfaces: false,
};

/**
 * Resolve every vNext capability for a caller whose tenant gate has ALREADY been
 * resolved. Taking `TenantFeatureView` as a parameter — rather than reading it
 * here — is the whole point: the type system makes it impossible to ask this
 * question without first having asked the authoritative one.
 *
 * Dependency chains mirror the product's real substrate:
 *   • every pursuit-facing capability requires the existing `experience`
 *     capability, because all of them read pursuits, facts and routes;
 *   • intelligence requires state and memory — an explanation with no belief and
 *     no history to cite is exactly the "generated narrative replacing canonical
 *     evidence" failure the product forbids;
 *   • next-best action requires intelligence, so a recommendation can always
 *     name its reason;
 *   • pursuit coordination requires intelligence for the same reason: a plan's
 *     focus and its "why" are composed from the Slice 1 context, and a plan that
 *     could render without it would be recommending from nothing;
 *   • pursuit attention requires coordination: every attention reason is derived from a
 *     pursuit plan's standing (awaiting a decision, needing review, its approved action), so
 *     with no plan there is nothing for it to derive;
 *   • dynamic surfaces require intelligence, since they compose its outputs;
 *   • control plane is backend-only and deliberately independent of
 *     `experience` — it is infrastructure, not a pursuit surface.
 */
export function vnextCapabilities(tenant: TenantFeatureView): VNextCapabilityView {
  const controlPlane = vnextEnvEnabled("control_plane");
  if (!tenant.experience) return { ...OFF, controlPlane };

  const contextHealth = vnextEnvEnabled("context_health");
  const pursuitState = vnextEnvEnabled("pursuit_state");
  const pursuitMemory = vnextEnvEnabled("pursuit_memory");
  const pursuitIntelligence = vnextEnvEnabled("pursuit_intelligence") && pursuitState && pursuitMemory;
  const nextBestAction = vnextEnvEnabled("next_best_action") && pursuitIntelligence;
  const pursuitCoordination = vnextEnvEnabled("pursuit_coordination") && pursuitIntelligence;
  const pursuitAttention = vnextEnvEnabled("pursuit_attention") && pursuitCoordination;
  const dynamicSurfaces = vnextEnvEnabled("dynamic_surfaces") && pursuitIntelligence;

  return {
    contextHealth, pursuitState, pursuitMemory,
    pursuitIntelligence, nextBestAction, pursuitCoordination, pursuitAttention, controlPlane, dynamicSurfaces,
  };
}
