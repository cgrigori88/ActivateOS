import { getPool } from "../src/db/client";
import { assemblePursuitTeams } from "../src/lib/ecosystem/teams";

/** Usage: npm run assemble-teams -- [org-name] [target-slug] */
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

    const stats = await assemblePursuitTeams(db, rows[0].id, targetSlug);
    console.log(
      `pursuit teams for ${targetSlug}: ${stats.assembled} assembled/updated, ` +
        `${stats.unchanged} unchanged, ${stats.unrouted} unroutable (no partner with capacity)`,
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
