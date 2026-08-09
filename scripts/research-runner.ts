import { getPool } from "../src/db/client";
import { runPendingResearchLocked } from "../src/lib/intel/research-runner";

/**
 * Drain the deep-research queue: process pending research_jobs (written by
 * enqueueDeepResearch when accounts cross an escalation gate), running deep
 * research + re-scoring for each.
 *
 * Usage:
 *   npm run research -- [--org "Org name"] [--limit 10]
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org");
  const limit = arg("limit") ? Number(arg("limit")) : 10;

  const pool = getPool();
  const db = await pool.connect();
  try {
    let orgId: string | undefined;
    if (orgName) {
      const { rows } = await db.query<{ id: string }>(
        `select id from organizations where name = $1`,
        [orgName],
      );
      if (rows.length === 0) throw new Error(`organization not found: ${orgName}`);
      orgId = rows[0].id;
    }

    const { rows: pending } = await db.query<{ n: string }>(
      `select count(*) as n from research_jobs where status = 'pending'${orgId ? " and org_id = $1" : ""}`,
      orgId ? [orgId] : [],
    );
    console.log(`\n═ RESEARCH QUEUE — ${pending[0].n} pending job(s)${orgName ? ` for ${orgName}` : ""}\n`);

    const summary = await runPendingResearchLocked(db, { limit, orgId });
    if (summary.locked) {
      console.log("  ⚠ another research run holds the lock — skipping this pass\n");
      return;
    }
    for (const j of summary.jobs) {
      const mark = j.status === "done" ? "✓" : "✗";
      console.log(`  ${mark} ${j.company.padEnd(24)} [${j.reason}] ${j.detail}`);
    }
    console.log(
      `\n─ Processed ${summary.processed} · done ${summary.done} · failed ${summary.failed}\n`,
    );
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
