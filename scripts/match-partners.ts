import { getPool } from "../src/db/client";
import { matchPartners } from "../src/lib/ecosystem/match";

/** Usage: npm run match-partners -- [org-name] [target-slug] */
async function main() {
  const [orgName = "Design Partner Demo", targetSlug = "infrastructure-automation"] =
    process.argv.slice(2);

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (rows.length === 0) throw new Error(`organization not found: ${orgName}`);

    const stats = await matchPartners(db, rows[0].id, targetSlug);
    console.log(
      `matched ${stats.accounts} scored accounts against the partner ecosystem — ` +
        `${stats.fits} partner fits computed for ${targetSlug}`,
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
