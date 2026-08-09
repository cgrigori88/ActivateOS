import { getPool } from "../src/db/client";
import { computeSourceIntel, type ScoredEvidenceRow } from "../src/lib/quality/source-intel";

/**
 * Evaluate every source's predictive value: which sources' evidence powers
 * the accounts that score hot? Reads only LATEST scores per company ×
 * solution so re-scores don't double-count. Run after scoring.
 *
 * Usage: npm run source-intel -- [org-name]
 */
async function main() {
  const orgName = process.argv[2] ?? "Design Partner Demo";
  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);

    const { rows } = await db.query<{ source_type: string; evidence_id: string; band: string }>(
      `with latest as (
         select distinct on (p.company_id, p.taxonomy_node_id) p.id, p.band
         from propensity_scores p
         where p.org_id = $1
         order by p.company_id, p.taxonomy_node_id, p.computed_at desc)
       select e.source_type, e.id as evidence_id, l.band
       from latest l
       join score_features f on f.score_id = l.id
       cross join lateral unnest(f.evidence_ids) as ev(id)
       join evidence e on e.id = ev.id`,
      [orgs[0].id],
    );

    const intel = computeSourceIntel(
      rows.map(
        (r): ScoredEvidenceRow => ({
          sourceType: r.source_type,
          evidenceId: r.evidence_id,
          band: r.band,
        }),
      ),
    );

    for (const [source, s] of intel) {
      await db.query(
        `update signal_sources
         set predictive_value = $2, scored_evidence = $3, high_band_evidence = $4,
             intel_evaluated_at = now()
         where name = $1`,
        [source, s.predictiveValue, s.scoredEvidence, s.highBandEvidence],
      );
      console.log(
        `${source}: ${s.scoredEvidence} evidence in latest scores, ` +
          `${s.highBandEvidence} in high bands → predictive value ${s.predictiveValue}`,
      );
    }
    if (intel.size === 0) console.log("no scored evidence found — run scoring first");
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
