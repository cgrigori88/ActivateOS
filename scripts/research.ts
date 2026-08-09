import { readFileSync } from "node:fs";
import { getPool } from "../src/db/client";
import { extractAndIngest, type ResearchDocument } from "../src/lib/agents/extractor";
import { gatherLiveDocs } from "../src/lib/research/gather";

/**
 * Run the Extractor agent on research documents for one company.
 *
 * Modes:
 *   --file <path>   fixture mode — deterministic, cheap, used in testing
 *   --live          gather documents from live sources: SEC EDGAR (free,
 *                   public companies) and Tavily web search (if
 *                   TAVILY_API_KEY is set). Same extraction, cross-check,
 *                   and quality gates either way.
 *
 * Usage:
 *   npm run research -- --org "Org" --company "Company" --file doc.txt
 *   npm run research -- --org "Org" --company "Company" --live
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org") ?? "PursuitOS Dev";
  const companyName = arg("company");
  const file = arg("file");
  const live = process.argv.includes("--live");
  const sourceType = arg("source-type") ?? "press";
  const sourceUrl = arg("source-url");

  if (!companyName || (!file && !live)) {
    console.error(
      'usage: npm run research -- --org "Org" --company "Company" (--file doc.txt | --live)',
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

    const docs: ResearchDocument[] = [];
    if (file) {
      docs.push({ sourceType, sourceUrl, text: readFileSync(file, "utf8") });
    }
    if (live) {
      docs.push(...(await gatherLiveDocs(companies[0].legal_name, "infrastructure automation")));
    }

    if (docs.length === 0) {
      console.log("no research documents gathered");
      return;
    }
    let claims = 0, verified = 0, held = 0;
    for (const doc of docs) {
      const stats = await extractAndIngest(db, {
        orgId: orgs[0].id,
        companyId: companies[0].id,
        companyName: companies[0].legal_name,
        doc,
      });
      claims += stats.claims; verified += stats.verified; held += stats.held;
    }
    console.log(
      `${companies[0].legal_name}: ${docs.length} documents, ${claims} claims extracted, ` +
        `${verified} verified, ${held} held by quality gates`,
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
