import { getPool } from "../src/db/client";
import { extractAndIngest } from "../src/lib/agents/extractor";
import { mapSignals } from "../src/lib/agents/taxonomy-mapper";
import { gatherLiveDocs } from "../src/lib/research/gather";
import { scoreOrg } from "../src/lib/scoring/score";

/**
 * Refresh runner (BLUEPRINT §50): acts on the refresh tiers the scorer sets.
 * Finds companies whose next_refresh_at has arrived, optionally re-researches
 * them from live sources, remaps new evidence into signals, and rescores —
 * so hot accounts stay fresh weekly while cold ones are revisited quarterly.
 *
 * Usage:
 *   npm run refresh -- --org "Org" [--target slug] [--live] [--limit N] [--dry-run]
 *
 * Without --live it re-maps + rescores from evidence already in the system
 * (free). --live adds EDGAR/Tavily research per due company (uses API keys).
 * Designed to be run on a schedule; each run is idempotent.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org") ?? "Design Partner Demo";
  const targetSlug = arg("target") ?? "infrastructure-automation";
  const live = process.argv.includes("--live");
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(arg("limit") ?? 10);

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);
    const orgId = orgs[0].id;

    // Hot accounts first: the tier ordering makes a capped run spend its
    // budget where propensity is highest.
    const { rows: due } = await db.query<{
      id: string;
      legal_name: string;
      refresh_tier: string;
      next_refresh_at: Date;
    }>(
      `select c.id, c.legal_name, c.refresh_tier, c.next_refresh_at
       from companies c
       where c.next_refresh_at <= now()
         and exists (select 1 from evidence e where e.company_id = c.id and e.org_id = $1)
       order by array_position(array['very_high','high','medium','low'], c.refresh_tier),
                c.next_refresh_at
       limit $2`,
      [orgId, limit],
    );

    if (due.length === 0) {
      console.log("no accounts due for refresh");
      return;
    }
    console.log(`${due.length} account(s) due for refresh:`);
    for (const c of due) {
      console.log(
        `  ${c.legal_name} [${c.refresh_tier}] due ${c.next_refresh_at.toISOString().slice(0, 10)}`,
      );
    }
    if (dryRun) return;

    if (live) {
      for (const c of due) {
        console.log(`researching ${c.legal_name}...`);
        const docs = await gatherLiveDocs(c.legal_name, targetSlug.replace(/-/g, " "));
        let claims = 0, verified = 0;
        for (const doc of docs) {
          const stats = await extractAndIngest(db, {
            orgId,
            companyId: c.id,
            companyName: c.legal_name,
            doc,
          });
          claims += stats.claims;
          verified += stats.verified;
        }
        console.log(`  ${docs.length} documents, ${claims} claims, ${verified} verified`);
      }
    }

    const useLLM = Boolean(process.env.ANTHROPIC_API_KEY);
    const mapStats = await mapSignals(db, orgId, { useLLM });
    console.log(
      `mapped ${mapStats.mappedDeterministic + mapStats.mappedLLM} new signals, ` +
        `${mapStats.skipped} skipped`,
    );

    const { scored } = await scoreOrg(db, orgId, targetSlug);
    console.log(`rescored ${scored} companies for ${targetSlug}`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
