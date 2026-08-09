import { getPool } from "../src/db/client";
import { mapSignals } from "../src/lib/agents/taxonomy-mapper";
import { enqueueDeepResearch, screenCompany } from "../src/lib/intel/screen";
import { scoreOrg } from "../src/lib/scoring/score";

/**
 * Manual account test harness (DIRECTIVE §32): run the full intelligence
 * screen for one company and print everything — provider results, evidence,
 * signals, scores — the workflow for evaluating real accounts before pilots.
 *
 * Usage:
 *   npm run intel -- --org "Org" --company "Company" [--domain example.com]
 *                    [--target infrastructure-automation] [--create]
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org") ?? "Design Partner Demo";
  const companyName = arg("company");
  const domain = arg("domain");
  const targetSlug = arg("target") ?? "infrastructure-automation";
  const create = process.argv.includes("--create");
  if (!companyName) {
    console.error('usage: npm run intel -- --org "Org" --company "Company" [--domain d] [--create]');
    process.exit(1);
  }

  const pool = getPool();
  const db = await pool.connect();
  try {
    let { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (orgs.length === 0 && create) {
      orgs = (
        await db.query<{ id: string }>(
          `insert into organizations (name) values ($1) returning id`,
          [orgName],
        )
      ).rows;
    }
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);
    const orgId = orgs[0].id;

    let { rows: companies } = await db.query<{ id: string; legal_name: string; primary_domain: string | null }>(
      `select id, legal_name, primary_domain from companies
       where legal_name ilike $1 or primary_domain = $2 limit 1`,
      [companyName, domain ?? null],
    );
    if (companies.length === 0 && create) {
      companies = (
        await db.query<{ id: string; legal_name: string; primary_domain: string | null }>(
          `insert into companies (legal_name, normalized_name, primary_domain)
           values ($1, lower($1), $2) returning id, legal_name, primary_domain`,
          [companyName, domain ?? null],
        )
      ).rows;
    }
    if (companies.length === 0) throw new Error(`company not found: ${companyName} (use --create)`);
    const company = companies[0];

    console.log(`\n═ INTELLIGENCE RUN — ${company.legal_name} (${company.primary_domain ?? "no domain"})\n`);
    const started = Date.now();

    const results = await screenCompany(db, {
      orgId,
      companyId: company.id,
      companyName: company.legal_name,
      domain: domain ?? company.primary_domain,
    });
    console.log("─ Stage 1: cheap screen");
    for (const [id, r] of Object.entries(results)) {
      console.log(
        `  ${id.padEnd(12)} ${r.status.padEnd(10)} records=${r.recordsReceived} ` +
          `new=${r.newObservations} evidence=${r.evidenceCreated} signals=${r.signalsCreated}` +
          (r.error ? ` error=${r.error.slice(0, 80)}` : ""),
      );
    }

    const mapStats = await mapSignals(db, orgId, {
      useLLM: Boolean(process.env.ANTHROPIC_API_KEY),
    });
    console.log(
      `─ Signal mapping: +${mapStats.mappedDeterministic + mapStats.mappedLLM} mapped, ${mapStats.skipped} skipped`,
    );

    await scoreOrg(db, orgId, targetSlug);
    const { rows: scores } = await db.query(
      `select p.score, p.band, p.positive_points, p.negative_points
       from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
       where p.company_id = $1 and n.slug = $2 order by p.computed_at desc limit 1`,
      [company.id, targetSlug],
    );
    if (scores.length > 0) {
      const s = scores[0];
      console.log(
        `─ Score (${targetSlug}): ${Number(s.score).toFixed(0)}/100 (${s.band}) ` +
          `+${Number(s.positive_points ?? 0).toFixed(0)}/-${Math.abs(Number(s.negative_points ?? 0)).toFixed(0)}`,
      );
      const { rows: dims } = await db.query(
        `select d.dimension, d.value from propensity_dimensions d
         join propensity_scores p on p.id = d.score_id
         where p.company_id = $1 order by p.computed_at desc, d.dimension limit 7`,
        [company.id],
      );
      console.log("  " + dims.map((d) => `${d.dimension}=${Number(d.value).toFixed(0)}`).join(" "));
    } else {
      console.log(`─ No score yet for ${targetSlug} (no verified signals mapped)`);
    }

    const { rows: evidence } = await db.query(
      `select claim, status, provider_id, computed_confidence from evidence
       where company_id = $1 order by collected_at desc limit 12`,
      [company.id],
    );
    console.log(`─ Evidence (latest ${evidence.length}):`);
    for (const e of evidence) {
      console.log(
        `  [${e.status}] (${e.provider_id ?? "n/a"}, ${Number(e.computed_confidence ?? 0).toFixed(2)}) ${e.claim.slice(0, 100)}`,
      );
    }

    const { enqueued } = await enqueueDeepResearch(db, orgId);
    console.log(`─ Deep-research queue: ${enqueued} new job(s)`);
    console.log(`─ Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
