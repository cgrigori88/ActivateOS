/**
 * Facts feature flag (Workstream B, §40). The Fact layer ships DARK behind FACTS_ENABLED
 * (a tenant-capability gate, not an `if demo` branch). Off — the default — means the live
 * pipeline behaves exactly as before Workstream B: no promotion hooks fire, no Fact
 * surfaces render. Additive migrations stay inert until read. Flipping the flag back to
 * unset is a clean, data-preserving rollback.
 *
 * Operator-invoked backfill (`npm run facts:backfill`) is intentionally NOT gated here — it
 * is an explicit migration step, dry-run-first, never automated.
 */
export function factsEnabled(): boolean {
  const v = (process.env.FACTS_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}
