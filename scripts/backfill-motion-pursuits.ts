/**
 * P0.2 — deterministic revenue_motions.pursuit_id backfill.
 *
 * Applies the ONE shared linkage rule (src/lib/motions/pursuit-link.ts) to every motion whose
 * pursuit_id is NULL: exactly-one pursuit on (org, account, category) links; else exactly-one
 * LIVE pursuit links; anything else stays NULL and is REPORTED, never guessed.
 *
 * Prints the required report: already linked / deterministically backfilled / ambiguous / no
 * matching pursuit. Idempotent — re-running changes nothing once linked.
 *
 *   DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo npx tsx scripts/backfill-motion-pursuits.ts
 */
import { Pool } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { resolveDeterministicPursuit } from "../src/lib/motions/pursuit-link";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

async function main() {
  const pool = new Pool({ connectionString: URL });
  // Refuses unless the TARGET database says it is synthetic (0102). An exported
  // production DEMO_URL is the realistic accident; the database answers, not the env.
  await assertSyntheticDatabase(pool, "demo motion→pursuit backfill");
  const c = await pool.connect();
  try {
    const already = Number((await c.query<{ n: string }>(`select count(*)::text n from revenue_motions where pursuit_id is not null`)).rows[0].n);
    const { rows } = await c.query<{ id: string; org_id: string; company_id: string; taxonomy_node_id: string | null; name: string }>(
      `select m.id, m.org_id, m.company_id, m.taxonomy_node_id, c.legal_name as name
         from revenue_motions m join companies c on c.id = m.company_id
        where m.pursuit_id is null order by c.legal_name`);

    let backfilled = 0, ambiguous = 0, none = 0;
    for (const m of rows) {
      const link = await resolveDeterministicPursuit(c, m.org_id, m.company_id, m.taxonomy_node_id);
      if (link.pursuitId) {
        await c.query(`update revenue_motions set pursuit_id = $2 where id = $1 and pursuit_id is null`, [m.id, link.pursuitId]);
        backfilled++;
        console.log(`  linked   ${m.name} (${link.reason})`);
      } else if (link.reason === "ambiguous") {
        ambiguous++;
        console.log(`  AMBIGUOUS ${m.name} — multiple live pursuits on the category; left NULL (never guessed)`);
      } else {
        none++;
        console.log(`  no match ${m.name} — no pursuit on (org, account, category); left NULL`);
      }
    }
    console.log(`\n[backfill-motion-pursuits] already linked: ${already} · deterministically backfilled: ${backfilled} · ambiguous (left NULL): ${ambiguous} · no matching pursuit: ${none}\n`);
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
