import { readFileSync } from "node:fs";
import { getPool } from "../src/db/client";
import { parseAccountsCsv } from "../src/lib/ingest/csv";
import { ingestAccounts } from "../src/lib/ingest/ingest-accounts";

/** Usage: npm run ingest -- <csv-path> [org-name] */
async function main() {
  const [csvPath, orgName = "PursuitOS Dev"] = process.argv.slice(2);
  if (!csvPath) {
    console.error("usage: npm run ingest -- <csv-path> [org-name]");
    process.exit(1);
  }

  const { rows, errors } = parseAccountsCsv(readFileSync(csvPath, "utf8"));
  for (const err of errors) console.warn(`line ${err.line}: ${err.message}`);

  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows: orgRows } = await client.query<{ id: string }>(
      `insert into organizations (name) values ($1)
       on conflict do nothing
       returning id`,
      [orgName],
    );
    const orgId =
      orgRows[0]?.id ??
      (await client.query<{ id: string }>("select id from organizations where name = $1", [orgName]))
        .rows[0].id;

    const stats = await ingestAccounts(client, orgId, rows);
    console.log(
      `ingested ${rows.length} rows: ${stats.created} companies created, ` +
        `${stats.matched} matched, ${stats.aliasesAdded} aliases, ` +
        `${stats.evidenceAdded} evidence rows (${stats.evidenceVerified} verified, ` +
        `${stats.evidenceHeld} held by quality gates)` +
        (errors.length ? `, ${errors.length} rows skipped` : ""),
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
