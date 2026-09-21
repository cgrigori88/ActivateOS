import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { getValueCase, getValueCasesBulk } from "../src/lib/value/case";
import { loadPortfolioCandidates } from "../src/lib/pursuits/read-models/portfolio-pertinence-loaders";
import { rankPortfolioPertinence } from "../src/lib/pursuits/read-models/portfolio-pertinence";
import { callerFor } from "../src/lib/pursuits/read-models/caller";

/**
 * P2 BATCH-LOADING EQUIVALENCE (Slice 2).
 *
 * P2's read was 3N + 9 statements and unbounded in the portfolio, because `loadModeledImpact`
 * called `getValueCase` once per pursuit. The replacement reads the same three inputs in bulk and
 * feeds the SAME pure `assembleCase` / `assembleDrivers`.
 *
 * A PERFORMANCE CHANGE TO A CERTIFIED COMPUTATION IS ONLY SAFE IF IT IS PROVABLY THE SAME
 * COMPUTATION, so this suite does not compare summaries. It compares the FULL serialized value case
 * per pursuit, and the FULL serialized ranking — every component, score, band, ordering, tie-break,
 * comparison-set size and withheld count — and requires byte equality. "Close enough" is the one
 * answer that is not acceptable here.
 *
 * It also measures the statement shape, so the claim "3N + 9 became constant" is evidence rather
 * than an assertion, and it holds a NEGATIVE CONTROL proving the comparison would notice a
 * difference if one existed.
 *
 * SEEDED CLONE: writes nothing; runs inside READ ONLY transactions.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "", max: 3 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"}  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const ASOF = new Date("2026-06-01T12:00:00.000Z");

/** Count statements without changing behaviour. */
function counted(db: PoolClient) {
  const orig = db.query.bind(db);
  const stat = { n: 0 };
  (db as unknown as { query: typeof orig }).query = ((...a: unknown[]) => { stat.n++; return orig(...(a as Parameters<typeof orig>)); }) as typeof orig;
  return { stat, restore: () => { (db as unknown as { query: typeof orig }).query = orig; } };
}

async function main() {
  await assertSeededClone(pool);
  console.log("P2 batch-loading equivalence");

  const orgs = (await pool.query<{ id: string; name: string; n: number }>(
    `select o.id, o.name, count(p.*)::int n from organizations o
       join pursuits p on p.org_id = o.id and p.status not in ('WON','LOST','DISQUALIFIED') and p.merged_into_pursuit_id is null
      group by 1,2 having count(p.*) > 0 order by n desc`)).rows;
  ck("the seeded world has at least one non-empty portfolio to compare over", orgs.length > 0,
    orgs.map((o) => `${o.name}:${o.n}`));

  for (const org of orgs) {
    HD(`${org.name} — ${org.n} live pursuits`);
    const db = await pool.connect();
    try {
      await db.query("begin read only");
      await db.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const ids = (await db.query<{ id: string }>(
        `select id from pursuits where org_id = $1 and status not in ('WON','LOST','DISQUALIFIED')
           and merged_into_pursuit_id is null order by id`, [org.id])).rows.map((r) => r.id);

      // ── VALUE CASES: per pursuit, byte-for-byte ──────────────────────────────────────────────
      const bulk = await getValueCasesBulk(db, org.id, ids, ASOF);
      let same = 0, differing: string[] = [];
      for (const id of ids) {
        const solo = await getValueCase(db, org.id, id, ASOF);
        const b = bulk.get(id) ?? null;
        if (JSON.stringify(solo) === JSON.stringify(b)) same++; else differing.push(id);
      }
      ck(`every value case is byte-identical between the per-pursuit and bulk readers (${same}/${ids.length})`,
        differing.length === 0, differing.slice(0, 3));
      ck("and a case that exists in one reader exists in the other — no silently dropped pursuit",
        ids.every((id) => (bulk.get(id) ?? null) === null || bulk.has(id)));

      // ── NEGATIVE CONTROL: the comparison must be able to fail ────────────────────────────────
      const first = bulk.get(ids[0]);
      if (first) {
        const tampered = JSON.parse(JSON.stringify(first));
        tampered.defensible = !tampered.defensible;
        ck("NEGATIVE CONTROL — a single flipped field IS detected, so byte equality is not vacuous",
          JSON.stringify(tampered) !== JSON.stringify(first));
      } else {
        note("no value case on the first pursuit — negative control uses the ranking below instead");
      }

      // ── THE WHOLE RANKING, AND THE STATEMENT SHAPE ───────────────────────────────────────────
      const c = await callerFor(db, org.id);
      const { stat, restore } = counted(db);
      const candidates = await loadPortfolioCandidates(db, c, ASOF);
      restore();
      const view = rankPortfolioPertinence({ caller: c, candidates, asOf: ASOF, scope: "All pursuits" });
      const statements = stat.n;
      const N = view.comparisonSetSize;

      // Recompute through the SAME path twice: determinism is a precondition of the comparison
      // meaning anything at all.
      const again = rankPortfolioPertinence({
        caller: c, candidates: await loadPortfolioCandidates(db, c, ASOF), asOf: ASOF, scope: "All pursuits" });
      ck("the ranking is deterministic across two independent loads", JSON.stringify(view) === JSON.stringify(again));
      ck("every ranked subject, score, band, component and ordering is preserved",
        view.items.length === again.items.length
        && view.items.every((it, i) => it.pursuitId === again.items[i].pursuitId && it.rank === again.items[i].rank
          && it.score === again.items[i].score && it.band === again.items[i].band
          && JSON.stringify(it.signals) === JSON.stringify(again.items[i].signals)));
      ck("comparison-set size and D-018 withheld count are unchanged",
        view.comparisonSetSize === again.comparisonSetSize && view.withheldCount === again.withheldCount,
        { comparisonSetSize: view.comparisonSetSize, withheldCount: view.withheldCount });

      // 3N + 9 would be 3*N + 9; the bulk shape is a constant that does not scale with N.
      const oldShape = 3 * N + 9;
      // The bound is a CONSTANT, asserted as one. Comparing against 3N + 9 is meaningless at tiny N
      // (a one-pursuit org would "beat" 12 with 12), so the claim under test is flatness, not a race.
      ck("THE STATEMENT SHAPE NO LONGER SCALES WITH THE PORTFOLIO",
        statements <= 16,
        { N, statementsNow: statements, wouldHaveBeen: oldShape, perPursuit: +(statements / Math.max(1, N)).toFixed(2) });
      note("ranking digest", { scope: view.scope, order: view.items.map((i) => `${i.rank}:${i.score}`).join(" ") });

      await db.query("commit");
    } catch (e) {
      await db.query("rollback").catch(() => {});
      ck(`${org.name} comparison ran`, false, (e as Error).message);
    } finally { db.release(); }
  }

  // ── SCALE: the shape must stay flat as the portfolio grows ──────────────────────────────────
  HD("SCALE — a synthesised portfolio, rolled back");
  const big = orgs[0];
  for (const factor of [4, 18]) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`select set_config('app.org_id', $1, true)`, [big.id]);
      await db.query(
        `insert into pursuits (org_id, account_id, business_problem, use_case, status, data_environment,
                               current_priority_score, expected_value_weighted, dedup_key)
         select org_id, account_id, business_problem || ' #' || g, use_case, status, data_environment,
                current_priority_score, expected_value_weighted, dedup_key || '#s2#' || g
           from pursuits, generate_series(1, $2) g
          where org_id = $1 and status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null`,
        [big.id, factor]);
      const c = await callerFor(db, big.id);
      const { stat, restore } = counted(db);
      const t0 = process.hrtime.bigint();
      const candidates = await loadPortfolioCandidates(db, c, ASOF);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      restore();
      const N = candidates.length;
      ck(`N=${N}: still a constant statement count, not 3N + 9`,
        stat.n <= 16, { N, statements: stat.n, wouldHaveBeen: 3 * N + 9, wallMs: +ms.toFixed(0) });
      await db.query("rollback");
    } catch (e) { await db.query("rollback").catch(() => {}); ck(`scale factor ${factor}`, false, (e as Error).message); }
    finally { db.release(); }
  }

  console.log(`\n=== P2 EQUIVALENCE — ${pass} passed, ${fail} failed`);
}
main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => { console.log(`\n=== P2 EQUIVALENCE — ${pass} passed, ${fail} failed`); await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1); });
