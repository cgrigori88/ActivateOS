import { getPool } from "../src/db/client";
import { scoreOrg } from "../src/lib/scoring/score";

/** Usage: npm run score -- [org-name] [target-node-slug] */
async function main() {
  const [orgName = "PursuitOS Dev", targetSlug = "infrastructure-automation"] =
    process.argv.slice(2);

  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (rows.length === 0) throw new Error(`organization not found: ${orgName}`);

    const { scored } = await scoreOrg(client, rows[0].id, targetSlug);
    console.log(`scored ${scored} companies for ${targetSlug}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
