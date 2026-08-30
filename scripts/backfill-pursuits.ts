import { getOwnerPool } from "../src/db/client";
import { backfillOrg, type BackfillStats } from "../src/lib/pursuits/reparent";

/**
 * Idempotent Pursuit backfill (Workstream A). Promotes legacy motions/teams/
 * opportunities/campaigns into canonical Pursuits, per org, deterministically.
 *
 *   npm run pursuits:backfill -- --dry-run     # compute + roll back (no writes)
 *   npm run pursuits:backfill                  # commit per org
 *
 * Runs each org in its own transaction with the app.org_id GUC set, so writes are
 * RLS-scoped exactly as the app would scope them. Uses the OWNER pool to enumerate
 * orgs and to run (backfill is a system/migration operation).
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getOwnerPool();

  const { rows: orgs } = await pool.query<{ id: string; name: string | null }>(
    `select id, name from organizations order by created_at asc`,
  );
  console.log(`[backfill] ${orgs.length} org(s); mode=${dryRun ? "DRY-RUN (rollback)" : "COMMIT"}`);

  const totals: BackfillStats = {
    orgId: "*", motionsSeen: 0, pursuitsCreated: 0, pursuitsMatched: 0,
    teamsAttached: 0, opportunitiesLinked: 0, campaignsLinked: 0, snapshotsSeeded: 0,
  };

  for (const org of orgs) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const s = await backfillOrg(db, org.id);
      await db.query(dryRun ? "rollback" : "commit");
      console.log(
        `[backfill] org=${org.name ?? org.id.slice(0, 8)} motions=${s.motionsSeen} ` +
        `created=${s.pursuitsCreated} matched=${s.pursuitsMatched} teams=${s.teamsAttached} ` +
        `opps=${s.opportunitiesLinked} camps=${s.campaignsLinked} snaps=${s.snapshotsSeeded}`,
      );
      totals.motionsSeen += s.motionsSeen;
      totals.pursuitsCreated += s.pursuitsCreated;
      totals.pursuitsMatched += s.pursuitsMatched;
      totals.teamsAttached += s.teamsAttached;
      totals.opportunitiesLinked += s.opportunitiesLinked;
      totals.campaignsLinked += s.campaignsLinked;
      totals.snapshotsSeeded += s.snapshotsSeeded;
    } catch (err) {
      try { await db.query("rollback"); } catch { /* broken conn */ }
      console.error(`[backfill] org=${org.id} FAILED:`, err instanceof Error ? err.message : err);
      throw err;
    } finally {
      db.release();
    }
  }

  console.log(
    `[backfill] TOTAL motions=${totals.motionsSeen} created=${totals.pursuitsCreated} ` +
    `matched=${totals.pursuitsMatched} teams=${totals.teamsAttached} opps=${totals.opportunitiesLinked} ` +
    `camps=${totals.campaignsLinked} snaps=${totals.snapshotsSeeded}` + (dryRun ? "  (rolled back)" : ""),
  );
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
