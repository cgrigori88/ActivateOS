/**
 * Pursuit feature flag (Workstream A, §41 step 15 / §K rollback path).
 *
 * The entire Pursuit domain ships DARK. Migrations 0063-0068 are additive and
 * inert until something reads Pursuit tables; this flag is the single gate the
 * app and worker check before exposing Pursuit surfaces or running Pursuit
 * detection/backfill in an automated context. Defaults OFF — an unset or
 * unrecognized value means disabled. Flipping it back to unset is a clean,
 * data-preserving rollback (the additive tables simply go unread again).
 *
 * Backfill via `npm run pursuits:backfill` is intentionally NOT gated by this
 * flag: it is an explicit, operator-invoked migration step, not an automated
 * surface.
 */
export function pursuitsEnabled(): boolean {
  const v = (process.env.PURSUITS_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}
