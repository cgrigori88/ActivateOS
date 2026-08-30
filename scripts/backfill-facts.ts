import { getOwnerPool } from "../src/db/client";
import { backfillFactsOrg, type FactsBackfillReport } from "../src/lib/facts/backfill";

/**
 * Idempotent Facts backfill (Workstream B, §18/§37). Promotes existing verified signals into
 * Facts through the deterministic gate, per org.
 *
 *   npm run facts:backfill -- --dry-run     # compute + roll back, print anomaly report
 *   npm run facts:backfill                  # commit per org
 *
 * PRODUCTION RULE (binding): the production run is dry-run FIRST; the report is inspected and
 * explicitly approved before any real backfill. Do not enable FACTS_ENABLED for prod tenants.
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pool = getOwnerPool();
  const { rows: orgs } = await pool.query<{ id: string; name: string | null }>(`select id, name from organizations order by created_at asc`);
  console.log(`[facts:backfill] ${orgs.length} org(s); mode=${dryRun ? "DRY-RUN (rollback)" : "COMMIT"}`);

  const reports: FactsBackfillReport[] = [];
  for (const org of orgs) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const rep = await backfillFactsOrg(db, org.id);
      await db.query(dryRun ? "rollback" : "commit");
      reports.push(rep);
      console.log(
        `[facts:backfill] org=${org.name ?? org.id.slice(0, 8)} signals=${rep.signalsSeen} ` +
        `promoted=${rep.promoted} review=${rep.reviewRequired} rejected=${rep.rejected} ` +
        `unmapped=${rep.unmappedSignals} competing=${rep.competingValues} linked=${rep.factsLinkedToPursuits}`,
      );
      console.log(`             predicates=${JSON.stringify(rep.predicateDistribution)} provenance=${JSON.stringify(rep.provenanceDistribution)} conf=${JSON.stringify(rep.confidenceBuckets)}`);
    } catch (err) {
      try { await db.query("rollback"); } catch { /* broken conn */ }
      console.error(`[facts:backfill] org=${org.id} FAILED:`, err instanceof Error ? err.message : err);
      throw err;
    } finally {
      db.release();
    }
  }
  const t = reports.reduce((a, r) => ({ signals: a.signals + r.signalsSeen, promoted: a.promoted + r.promoted, review: a.review + r.reviewRequired, rejected: a.rejected + r.rejected }), { signals: 0, promoted: 0, review: 0, rejected: 0 });
  console.log(`[facts:backfill] TOTAL signals=${t.signals} promoted=${t.promoted} review=${t.review} rejected=${t.rejected}` + (dryRun ? "  (rolled back)" : ""));
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
