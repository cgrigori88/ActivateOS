import { readFileSync } from "node:fs";
import { getPool } from "../src/db/client";
import { extractAndIngest } from "../src/lib/agents/extractor";

/**
 * Run the Extractor agent on a research document for one company.
 *
 * Fixture mode (today): --file <path> supplies the document text, so the
 * agent pipeline can be exercised deterministically and cheaply.
 * Live source connectors (Tavily search, SEC EDGAR) plug in here next —
 * they only change where the document text comes from; extraction,
 * cross-check, and the quality gates are identical.
 *
 * Usage:
 *   npm run research -- --org "Org Name" --company "Company Name" \
 *     --file path/to/doc.txt [--source-type press] [--source-url https://...]
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org") ?? "ActivateOS Dev";
  const companyName = arg("company");
  const file = arg("file");
  const sourceType = arg("source-type") ?? "press";
  const sourceUrl = arg("source-url");

  if (!companyName || !file) {
    console.error(
      'usage: npm run research -- --org "Org" --company "Company" --file doc.txt [--source-type press]',
    );
    process.exit(1);
  }

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);

    const { rows: companies } = await db.query<{ id: string; legal_name: string }>(
      `select c.id, c.legal_name from companies c
       where c.legal_name ilike $1 or c.normalized_name = lower($1)
       limit 2`,
      [companyName],
    );
    if (companies.length === 0) throw new Error(`company not found: ${companyName}`);
    if (companies.length > 1) throw new Error(`ambiguous company name: ${companyName}`);

    const stats = await extractAndIngest(db, {
      orgId: orgs[0].id,
      companyId: companies[0].id,
      companyName: companies[0].legal_name,
      doc: { sourceType, sourceUrl, text: readFileSync(file, "utf8") },
    });
    console.log(
      `${companies[0].legal_name}: ${stats.claims} claims extracted, ` +
        `${stats.verified} verified, ${stats.held} held by quality gates`,
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
