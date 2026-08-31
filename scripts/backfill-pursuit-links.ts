/**
 * Deterministic legacy → canonical linkage backfill (canonical micro-loop, item 7).
 *
 * Populates opportunities.pursuit_id / revenue_motions.pursuit_id ONLY where the canonical
 * relationship is DETERMINISTICALLY provable from existing data — i.e. the legacy row's company
 * has EXACTLY ONE live canonical Pursuit (status not terminal, not merged away). Where a company
 * has zero or several live pursuits the link is genuinely ambiguous, so the row is LEFT UNLINKED
 * and classified as unresolved — never guessed. Idempotent (already-linked rows are skipped).
 *
 * Prints the four required counts per entity: deterministic / ambiguous-unresolved / already-linked
 * / new-path-enforced. Run: DEMO_URL=… npx tsx scripts/backfill-pursuit-links.ts [--apply]
 * (dry-run by default; --apply writes).
 */
import { Pool, type PoolClient } from "pg";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const APPLY = process.argv.includes("--apply");

const LIVE = `status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null`;

interface Counts { deterministic: number; ambiguous: number; alreadyLinked: number; total: number; }

async function backfill(db: PoolClient, table: "opportunities" | "revenue_motions", orgId: string): Promise<Counts> {
  const c: Counts = { deterministic: 0, ambiguous: 0, alreadyLinked: 0, total: 0 };
  const rows = (await db.query<{ id: string; company_id: string | null; pursuit_id: string | null }>(
    `select id, company_id, pursuit_id from ${table} where org_id = $1`, [orgId])).rows;
  for (const r of rows) {
    c.total++;
    if (r.pursuit_id) { c.alreadyLinked++; continue; }
    if (!r.company_id) { c.ambiguous++; continue; }
    // Deterministic iff the company has exactly one live pursuit.
    const live = (await db.query<{ id: string }>(
      `select id from pursuits where org_id = $1 and account_id = $2 and ${LIVE}`, [orgId, r.company_id])).rows;
    if (live.length === 1) {
      c.deterministic++;
      if (APPLY) await db.query(`update ${table} set pursuit_id = $2 where id = $1`, [r.id, live[0].id]);
    } else {
      c.ambiguous++; // 0 live (nothing to link) or >1 (genuinely ambiguous) — left unlinked.
    }
  }
  return c;
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    const orgs = (await db.query<{ id: string }>(`select id from organizations`)).rows;
    const totals: Record<string, Counts> = {
      opportunities: { deterministic: 0, ambiguous: 0, alreadyLinked: 0, total: 0 },
      revenue_motions: { deterministic: 0, ambiguous: 0, alreadyLinked: 0, total: 0 },
    };
    for (const org of orgs) {
      for (const table of ["opportunities", "revenue_motions"] as const) {
        await db.query("begin"); await db.query("select set_config('app.org_id',$1,true)", [org.id]);
        const c = await backfill(db, table, org.id);
        await db.query(APPLY ? "commit" : "rollback");
        const t = totals[table];
        t.deterministic += c.deterministic; t.ambiguous += c.ambiguous; t.alreadyLinked += c.alreadyLinked; t.total += c.total;
      }
    }
    console.log(`\n[backfill-pursuit-links] ${APPLY ? "APPLIED" : "DRY-RUN (pass --apply to write)"} — deterministic-only, ambiguous left unlinked:\n`);
    for (const table of ["opportunities", "revenue_motions"] as const) {
      const t = totals[table];
      console.log(`  ${table}:`);
      console.log(`    deterministic backfill     : ${t.deterministic}`);
      console.log(`    ambiguous / unresolved     : ${t.ambiguous}   (left unlinked — never guessed)`);
      console.log(`    already linked             : ${t.alreadyLinked}`);
      console.log(`    new-path enforced          : 0   (creation-time linkage is the deferred outcome-bridge phase)`);
      console.log(`    total rows                 : ${t.total}\n`);
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("[backfill-pursuit-links] fatal:", e); process.exit(1); });
