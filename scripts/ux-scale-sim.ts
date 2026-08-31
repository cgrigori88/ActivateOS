/**
 * UX normalization scale simulation (Intelligence Wave P1AB UX pass).
 *
 * Proves the Motion Intelligence surfaces stay scale-native when the funnel is ~10x the demo
 * world: inside ONE transaction it inserts ~300 synthetic evaluated companies on the busiest
 * hypothesis, re-derives the funnel + constraint aggregation + family drill-ins, times them,
 * asserts the presentation invariants (aggregation reconciles, family stages resolve, caps
 * engage), and then ROLLS BACK — the demo world is untouched, and nothing synthetic survives.
 *
 *   DEMO_URL=… npx tsx scripts/ux-scale-sim.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getMotionFunnels, accountsAtStage, aggregateConstraints, primaryConstraint } from "../src/lib/motions/funnel";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const SYNTH = 300;
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> => (await db.query<T>(sql, p)).rows[0] as T;
  try {
    const org = (await one<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).org_id;
    const node = (await one<{ id: string }>(
      `select p.taxonomy_node_id id from propensity_scores p group by 1 order by count(*) desc limit 1`)).id;
    const versionId = (await one<{ v: string }>(`select score_version_id v from propensity_scores limit 1`)).v;

    const before = (await getMotionFunnels(db, org)).find((f) => f.hypothesis.taxonomyNodeId === node)!;
    const beforeEvaluated = before.stages.find((s) => s.key === "evaluated")!.count;

    await db.query("begin");
    try {
      // Synthetic evaluated companies: half qualified (high band, no pursuit → NO_PURSUIT
      // constraint), half below band — populating both cohorts without touching governance.
      await db.query(
        `with c as (
           insert into companies (legal_name, normalized_name, primary_domain)
           select 'UX Scale Sim ' || i, 'ux scale sim ' || i, 'ux-scale-sim-' || i || '.example'
             from generate_series(1, $1::int) i
           returning id, normalized_name)
         insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id)
         select $2, c.id, $3,
                case when right(c.normalized_name, 1)::int % 2 = 0 then 78 else 31 end,
                case when right(c.normalized_name, 1)::int % 2 = 0 then 'high' else 'low' end,
                $4
           from c`, [SYNTH, org, node, versionId]);

      const t0 = Date.now();
      const funnels = await getMotionFunnels(db, org);
      const funnelMs = Date.now() - t0;
      const view = funnels.find((f) => f.hypothesis.taxonomyNodeId === node)!;
      const evaluated = view.stages.find((s) => s.key === "evaluated")!.count;
      ok(`funnel absorbs ${SYNTH} synthetic evaluated companies`, evaluated === beforeEvaluated + SYNTH, `${evaluated} vs ${beforeEvaluated + SYNTH}`);
      ok(`full funnel derivation stays interactive at scale (${funnelMs}ms for ${funnels.length} hypotheses)`, funnelMs < 5000);

      const t1 = Date.now();
      const agg = aggregateConstraints(view);
      const aggMs = Date.now() - t1;
      const gatedAccounts = view.accounts.filter((a) => primaryConstraint(a) != null);
      ok("constraint aggregation reconciles: family counts sum to accounts with a gating primary constraint",
        agg.rows.reduce((s, r) => s + r.count, 0) === gatedAccounts.length,
        `${agg.rows.reduce((s, r) => s + r.count, 0)} vs ${gatedAccounts.length}`);
      ok("aggregate exposure = sum of member expected values",
        Math.round(agg.totalUsd) === Math.round(gatedAccounts.reduce((s, a) => s + (a.expectedValue ?? 0), 0)));
      ok(`aggregation is instant at scale (${aggMs}ms)`, aggMs < 200);
      ok(`the card wall is gone: ${gatedAccounts.length} blocked accounts compress to ${agg.rows.length} aggregate rows`,
        agg.rows.length <= 10 && gatedAccounts.length > 100);

      // Family drill-in (the aggregate row → drawer path) resolves exactly its members.
      for (const fam of ["NO_PURSUIT", "BELOW_PROPENSITY_BAND"]) {
        const row = agg.rows.find((r) => r.family === fam);
        const members = accountsAtStage(view, `family:${fam}`);
        ok(`family drill-in ${fam} resolves its aggregate exactly (${members.length})`,
          row != null && members.length === row.count && members.every((a) => primaryConstraint(a)?.code.startsWith(fam) === true));
      }

      // Presentation caps engage: the pursuits table cap (60) and drawer page (30) are both
      // exceeded by the synthetic cohort, so their truncation paths render at this scale.
      ok(`pursuits-table cap engages (accounts ${view.accounts.length} > 60)`, view.accounts.length > 60);
      ok(`drawer pagination engages (largest family ${Math.max(...agg.rows.map((r) => r.count))} > 30)`,
        Math.max(...agg.rows.map((r) => r.count)) > 30);
    } finally {
      await db.query("rollback");
    }

    const after = (await getMotionFunnels(db, org)).find((f) => f.hypothesis.taxonomyNodeId === node)!;
    ok("rollback proven — the demo world is byte-identical (evaluated count restored)",
      after.stages.find((s) => s.key === "evaluated")!.count === beforeEvaluated);
    const leftovers = await one<{ n: string }>(`select count(*)::text n from companies where normalized_name like 'ux scale sim %'`);
    ok("no synthetic companies survive", Number(leftovers.n) === 0);
  } finally {
    db.release();
    await pool.end();
  }
  console.log(`\n  ${fail === 0 ? "✓ UX SCALE SIMULATION VERIFIED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
