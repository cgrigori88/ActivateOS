import { getPool } from "../src/db/client";
import { runScreeningSweepAllOrgs } from "../src/lib/intel/screen-runner";

/**
 * Screening sweep runner: re-screen an org's portfolio (or every org's), then
 * re-map, re-score, and enqueue deep research — keeping research_jobs filled.
 * The front of the autonomous loop; run it on a daily-ish cadence.
 *
 * Usage:
 *   npm run screen -- [--org "Org name"] [--target slug] [--limit 25]
 *   (no --org → sweep every organization)
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org");
  const targetSlug = arg("target");
  const limit = arg("limit") ? Number(arg("limit")) : 25;

  const pool = getPool();
  const db = await pool.connect();
  try {
    const result = await runScreeningSweepAllOrgs(db, { orgName, targetSlug, limit });
    if (result.byOrg.length === 0 && !result.locked) {
      throw new Error(orgName ? `organization not found: ${orgName}` : "no organizations");
    }
    for (const { org, summary } of result.byOrg) {
      console.log(`\n═ SCREENING SWEEP — ${org}\n`);
      for (const a of summary.accounts) {
        console.log(`  ${a.company.padEnd(24)} +${a.evidence} evidence`);
      }
      console.log(
        `─ Screened ${summary.screened} · +${summary.evidenceCreated} evidence · ${summary.enqueued} deep-research job(s) enqueued\n`,
      );
    }
    if (result.locked) console.log("⚠ another pipeline run holds the lock — stopped early\n");
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
