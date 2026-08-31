/**
 * Lifecycle read-path performance (P2A). Measures the queries the new surfaces actually run, on the
 * demo world, as the non-owner app_rw role with RLS active — the same path a request takes.
 *
 *   npx tsx scripts/lifecycle-perf.ts
 */
import { Pool, type PoolClient } from "pg";
import { loadLifecycleFacts, eventsForAccount, primaryLifecycleEvent } from "../src/lib/lifecycle/state";
import { getLifecycleHorizon } from "../src/lib/lifecycle/horizon";
import { renewalProjection } from "../src/lib/lifecycle/projection";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RUNS = 20;

async function timed(label: string, fn: () => Promise<unknown>) {
  await fn(); // warm
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint();
    await fn();
    ms.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  ms.sort((a, b) => a - b);
  const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))].toFixed(1);
  console.log(`  ${label.padEnd(46)} p50 ${p(0.5).padStart(7)}ms   p95 ${p(0.95).padStart(7)}ms`);
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    const accounts = (await db.query<{ n: string }>(`select count(*)::text n from companies`)).rows[0].n;
    const facts = (await db.query<{ n: string }>(
      `select count(*)::text n from facts where org_id=$1 and date_value is not null`, [org])).rows[0].n;
    console.log(`\nLifecycle read path — ${accounts} accounts, ${facts} dated facts, ${RUNS} runs each (RLS on)\n`);

    await timed("loadLifecycleFacts (whole book)", () => loadLifecycleFacts(db, org, null));
    await timed("derive all states (load + derive, whole book)", async () => {
      for (const [, rows] of await loadLifecycleFacts(db, org, null)) primaryLifecycleEvent(eventsForAccount(rows));
    });
    await timed("getLifecycleHorizon 90d (⌘K + Today + Motions)", () => getLifecycleHorizon(db, org, { days: 90 }));
    await timed("getLifecycleHorizon 30d", () => getLifecycleHorizon(db, org, { days: 30 }));
    await timed("renewalProjection 120d (Pipeline radar)", () => renewalProjection(db, org, { days: 120, limit: 12 }));
    await timed("renewalProjection 90d, one account (digest)", async () => {
      const c = (await db.query<{ id: string }>(`select id from companies limit 1`)).rows[0].id;
      return renewalProjection(db, org, { days: 90, companyIds: [c], limit: 2 });
    });

    // ── At scale. Seeded inside a transaction that is ALWAYS rolled back, so the demo world is
    //    unchanged. This is the number that matters: the read path is O(dated facts in scope). ──
    const N = Number(process.env.SCALE ?? 5000);
    await db.query("begin");
    try {
      await db.query(
        `insert into companies (id, legal_name, normalized_name)
         select gen_random_uuid(), 'PerfCo ' || g, 'perfco' || g from generate_series(1,$1) g`, [N]);
      await db.query(
        `insert into facts (id, org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
                            object_type, object_value, date_value, polarity, status, confidence, provenance_class,
                            origin_kind, as_of, observed_at, observed_first_at, observed_last_at,
                            freshness_policy, family, fact_identity_key, fact_value_key,
                            data_environment, is_simulated, created_by_actor_type, created_via)
         select gen_random_uuid(), $1, 'COMPANY', c.id, c.legal_name, c.id, 'renewal_date',
                'DATE', '{}'::jsonb, now()::date + ((random()*300)::int), 1, 'CURRENT', 0.7, 'CUSTOMER_DECLARED',
                'IMPORT', now(), now(), now(), now(),
                'VALID_UNTIL', 'trigger', 'perf:' || c.id, 'perf:' || c.id,
                'DEMO', true, 'SYSTEM', 'lifecycle-perf'
           from companies c where c.legal_name like 'PerfCo %'`, [org]);
      const scaled = (await db.query<{ n: string }>(
        `select count(*)::text n from facts where org_id=$1 and date_value is not null`, [org])).rows[0].n;
      console.log(`\nAt scale — ${N} extra accounts, ${scaled} dated facts in scope\n`);
      await timed("loadLifecycleFacts (whole book)", () => loadLifecycleFacts(db, org, null));
      await timed("derive all states (load + derive, whole book)", async () => {
        for (const [, rows] of await loadLifecycleFacts(db, org, null)) primaryLifecycleEvent(eventsForAccount(rows));
      });
      await timed("getLifecycleHorizon 90d", () => getLifecycleHorizon(db, org, { days: 90 }));
      await timed("renewalProjection 120d", () => renewalProjection(db, org, { days: 120, limit: 12 }));
    } finally {
      await db.query("rollback");
    }
    console.log("");
  } finally {
    db.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
