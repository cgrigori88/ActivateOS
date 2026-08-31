/**
 * Value Case read-path performance (P2B). Measured as app_rw with RLS active — the request path.
 *   npx tsx scripts/value-perf.ts
 */
import { Pool, type PoolClient } from "pg";
import { loadDrivers } from "../src/lib/value/drivers";
import { getValueCase } from "../src/lib/value/case";
import { toPartnerValueCase } from "../src/lib/value/projection";
import { aggregateValue } from "../src/lib/value/aggregate";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RUNS = 20;
async function timed(label: string, fn: () => Promise<unknown>) {
  await fn();
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) { const t = process.hrtime.bigint(); await fn(); ms.push(Number(process.hrtime.bigint() - t) / 1e6); }
  ms.sort((a, b) => a - b);
  const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))].toFixed(1);
  console.log(`  ${label.padEnd(46)} p50 ${p(0.5).padStart(7)}ms   p95 ${p(0.95).padStart(7)}ms`);
}
async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    const p = (await db.query<{ id: string; account_id: string }>(
      `select p.id, p.account_id from pursuits p join companies c on c.id=p.account_id
        where p.org_id=$1 and c.legal_name ilike '%Globex%' limit 1`, [org])).rows[0];
    const n = (await db.query<{ n: string }>(
      `select count(*)::text n from facts f join fact_predicates fp on fp.key=f.predicate_key
        where f.org_id=$1 and fp.family='economic'`, [org])).rows[0].n;
    console.log(`\nValue Case read path — ${n} economic facts, ${RUNS} runs each (RLS on)\n`);
    await timed("loadDrivers (one account)", () => loadDrivers(db, org, p.account_id));
    await timed("getValueCase (drivers + 3 truths + sensitivity)", () => getValueCase(db, org, p.id));
    await timed("toPartnerValueCase (recompute from disclosable)", async () => {
      const vc = await getValueCase(db, org, p.id); return vc && toPartnerValueCase(vc);
    });
    await timed("aggregateValue (Motions, whole book)", () => aggregateValue(db, org));
    console.log("");
  } finally { db.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
