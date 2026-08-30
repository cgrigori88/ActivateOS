/**
 * Pilot commissioning helper — inspect and (only when explicitly asked) set tenant
 * feature flags through the AUDITED, fail-closed path. READ-ONLY BY DEFAULT.
 *
 * This does NOT enable anything on its own. `--list` is a safe precondition/verification
 * read. A single `--set` performs exactly one audited flag change (never bulk), writing
 * both org_features and the org_feature_changes audit row via setOrgFeature.
 *
 * Inspect (safe, read-only):
 *   DATABASE_URL='postgres://…' npx tsx scripts/pilot-flags.ts --list [--org <id>]
 *
 * Set ONE flag (authorized operator action — writes an audit row):
 *   DATABASE_URL='postgres://…RW/owner…' npx tsx scripts/pilot-flags.ts \
 *     --org <uuid> --set federation --on --reason "pilot org X commissioning" --changed-by "<operator>"
 *
 * Env masters (the deployment kill-switch, set in the host, NOT here) gate whether a
 * per-org flag is actually live: live_for(org,flag) = envMaster(flag) && org_features.flag.
 */
import { Pool, type PoolClient } from "pg";
import { setOrgFeature, envEnabled, type FeatureFlag } from "../src/lib/pursuits/tenant-flags";

const FLAGS: FeatureFlag[] = ["pursuits", "facts", "routing", "pursuit_experience", "federation", "governed_action", "outcome_learning"];
const ENV_MASTER: Record<FeatureFlag, string> = {
  pursuits: "PURSUITS_ENABLED", facts: "FACTS_ENABLED", routing: "ROUTING_ENABLED",
  pursuit_experience: "PURSUIT_EXPERIENCE_ENABLED", federation: "FEDERATION_ENABLED",
  governed_action: "GOVERNED_ACTION_ENABLED", outcome_learning: "OUTCOME_LEARNING_ENABLED",
};

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
function has(name: string): boolean { return process.argv.includes(name); }

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error("set DATABASE_URL"); process.exit(1); }

async function withTenantTx<T>(pool: Pool, orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const pool = new Pool({ connectionString: CONN, max: 1 });
  try {
    // Show the deployment kill-switches as this process sees them (fail-closed if unset).
    console.log("env masters (deployment kill-switch, as seen by THIS process):");
    for (const f of FLAGS) console.log(`  ${ENV_MASTER[f].padEnd(26)} ${envEnabled(f) ? "ON" : "off"}`);

    if (has("--set")) {
      const orgId = arg("--org"); const flag = arg("--set") as FeatureFlag;
      const on = has("--on"); const off = has("--off");
      if (!orgId) { console.error("--set requires --org <uuid>"); process.exit(1); }
      if (!FLAGS.includes(flag)) { console.error(`unknown flag '${flag}' — one of: ${FLAGS.join(", ")}`); process.exit(1); }
      if (on === off) { console.error("specify exactly one of --on / --off"); process.exit(1); }
      const reason = arg("--reason") ?? null; const changedBy = arg("--changed-by") ?? null;
      await withTenantTx(pool, orgId, (c) => setOrgFeature(c, orgId, flag, on, { reason, changedBy }));
      console.log(`\n✓ audited: org ${orgId} · ${flag} → ${on ? "ON" : "OFF"} (reason: ${reason ?? "—"}, by: ${changedBy ?? "—"})`);
      console.log(`  live_for(org,${flag}) = envMaster(${ENV_MASTER[flag]}=${envEnabled(flag) ? "ON" : "off"}) AND org_features.${flag}=${on ? "true" : "false"} ⇒ ${envEnabled(flag) && on ? "LIVE" : "DARK"}`);
    }

    // Always print the current per-org state (the verification read).
    const only = arg("--org");
    const rows = (await pool.query<{ org_id: string; name: string } & Record<FeatureFlag, boolean>>(
      `select o.id as org_id, o.name, f.pursuits, f.facts, f.routing, f.pursuit_experience, f.federation, f.governed_action, f.outcome_learning
         from organizations o left join org_features f on f.org_id = o.id
        ${only ? "where o.id = $1" : ""} order by o.created_at asc`, only ? [only] : [])).rows;
    console.log(`\nper-org flags (${rows.length} org${rows.length === 1 ? "" : "s"}):`);
    for (const r of rows) {
      const on = FLAGS.filter((f) => (r as Record<string, unknown>)[f] === true);
      console.log(`  ${r.name}  [${r.org_id}]`);
      console.log(`    ON: ${on.length ? on.join(", ") : "(none — dark, fail-closed)"}`);
    }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error("[pilot-flags] fatal:", e); process.exit(2); });
