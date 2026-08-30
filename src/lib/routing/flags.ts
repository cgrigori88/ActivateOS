/**
 * Routing feature flag (Workstream C, §59). The route-decisioning layer ships DARK behind
 * ROUTING_ENABLED (a tenant-capability gate, not an `if demo` branch). Off — the default —
 * preserves legacy behavior exactly: no route recomputation, no route surfaces. Additive
 * migrations stay inert until read. Operator-invoked route backfill is not gated here.
 */
export function routingEnabled(): boolean {
  const v = (process.env.ROUTING_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}
