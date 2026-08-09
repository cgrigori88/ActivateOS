import { getPool } from "../src/db/client";
import { runScreeningSweepLocked } from "../src/lib/intel/screen-runner";

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
    const { rows: orgs } = orgName
      ? await db.query<{ id: string; name: string }>(`select id, name from organizations where name = $1`, [orgName])
      : await db.query<{ id: string; name: string }>(`select id, name from organizations order by name`);
    if (orgs.length === 0) throw new Error(orgName ? `organization not found: ${orgName}` : "no organizations");

    for (const org of orgs) {
      console.log(`\n═ SCREENING SWEEP — ${org.name}\n`);
      const s = await runScreeningSweepLocked(db, org.id, { targetSlug, limit });
      if (s.locked) {
        console.log("  ⚠ another pipeline run holds the lock — skipping\n");
        continue;
      }
      for (const a of s.accounts) {
        console.log(`  ${a.company.padEnd(24)} +${a.evidence} evidence`);
      }
      console.log(
        `─ Screened ${s.screened} · +${s.evidenceCreated} evidence · ${s.enqueued} deep-research job(s) enqueued\n`,
      );
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
