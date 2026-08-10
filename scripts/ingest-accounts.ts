import { readFileSync } from "node:fs";
import { getPool } from "../src/db/client";
import { importAccountsCsv } from "../src/lib/ingest/ingest-accounts";

/** Usage: npm run ingest -- <csv-path> [org-name] [partner-name] [partner-type] */
async function main() {
  const [csvPath, orgName = "PursuitOS Dev", partnerName, partnerType] = process.argv.slice(2);
  if (!csvPath) {
    console.error("usage: npm run ingest -- <csv-path> [org-name] [partner-name] [partner-type]");
    process.exit(1);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await importAccountsCsv(client, {
      orgName,
      partnerName,
      partnerType,
      filename: csvPath.split("/").pop(),
      uploadedBy: "cli",
      csv: readFileSync(csvPath, "utf8"),
    });
    for (const err of result.errors) console.warn(`line ${err.line}: ${err.message}`);
    const s = result.stats;
    console.log(
      `ingested ${result.rowCount} rows${partnerName ? ` for partner "${partnerName}"` : ""}: ` +
        `${s.created} companies created, ${s.matched} matched, ${s.aliasesAdded} aliases, ` +
        `${s.evidenceAdded} evidence rows (${s.evidenceVerified} verified, ${s.evidenceHeld} held)` +
        (result.errors.length ? `, ${result.errors.length} rows skipped` : ""),
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
