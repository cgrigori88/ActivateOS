import { getOwnerPool } from "../src/db/client";
import { recomputeRoute } from "../src/lib/routing/route-model";

/**
 * Idempotent route backfill (Workstream C). Recomputes a durable route snapshot for every LIVE
 * pursuit, per org.
 *
 *   npm run routes:backfill -- --dry-run    # compute + roll back (no writes)
 *   npm run routes:backfill                 # commit per org
 *
 * PRODUCTION RULE (binding, §62): dry-run FIRST; inspect the report; run for real only after
 * explicit approval. ROUTING_ENABLED stays OFF for production tenants.
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getOwnerPool();
  const { rows: orgs } = await pool.query<{ id: string; name: string | null }>(`select id, name from organizations order by created_at asc`);
  console.log(`[routes:backfill] ${orgs.length} org(s); mode=${dryRun ? "DRY-RUN (rollback)" : "COMMIT"}`);
  let total = 0, changed = 0;
  for (const org of orgs) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const { rows: pursuits } = await db.query<{ id: string }>(`select id from pursuits where org_id = $1 and status not in ('WON','LOST','DISQUALIFIED')`, [org.id]);
      let orgChanged = 0;
      for (const p of pursuits) { const r = await recomputeRoute(db, p.id); total++; if (r.changed) { orgChanged++; changed++; } }
      await db.query(dryRun ? "rollback" : "commit");
      console.log(`[routes:backfill] org=${org.name ?? org.id.slice(0, 8)} pursuits=${pursuits.length} routed=${pursuits.length} changed=${orgChanged}`);
    } catch (err) {
      try { await db.query("rollback"); } catch { /* broken conn */ }
      console.error(`[routes:backfill] org=${org.id} FAILED:`, err instanceof Error ? err.message : err);
      throw err;
    } finally { db.release(); }
  }
  console.log(`[routes:backfill] TOTAL routed=${total} changed=${changed}` + (dryRun ? "  (rolled back)" : ""));
  await pool.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
