import { getPool } from "../src/db/client";
import { mapSignals } from "../src/lib/agents/taxonomy-mapper";

/** Usage: npm run map-signals -- [org-name] [--llm] */
async function main() {
  const args = process.argv.slice(2);
  const useLLM = args.includes("--llm");
  const orgName = args.filter((a) => a !== "--llm")[0] ?? "ActivateOS Dev";

  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (rows.length === 0) throw new Error(`organization not found: ${orgName}`);

    const stats = await mapSignals(client, rows[0].id, { useLLM });
    console.log(
      `mapped ${stats.mappedDeterministic} signals deterministically, ` +
        `${stats.mappedLLM} via model, ${stats.skipped} skipped` +
        (useLLM ? "" : " (run with --llm and ANTHROPIC_API_KEY to classify non-product claims)"),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
