import { getPool } from "../src/db/client";
import { enrichCompanyByDomain, pdlAvailable } from "../src/lib/research/pdl";

/**
 * Fill missing firmographics (industry, employee count, geography) from PDL
 * for companies that have a domain. Each hit consumes one PDL credit —
 * only companies missing data are queried.
 *
 * Usage: npm run enrich -- [org-name]
 */
async function main() {
  if (!pdlAvailable()) {
    console.error("PDL_API_KEY is not set");
    process.exit(1);
  }
  const orgName = process.argv[2] ?? "PursuitOS Dev";
  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows } = await db.query<{ id: string; legal_name: string; primary_domain: string }>(
      `select distinct c.id, c.legal_name, c.primary_domain
       from companies c
       join company_aliases a on a.company_id = c.id
       where c.primary_domain is not null
         and (c.industry is null or c.employee_count is null or c.country is null)`,
    );
    let enriched = 0, misses = 0;
    for (const c of rows) {
      const result = await enrichCompanyByDomain(c.primary_domain);
      if (!result) {
        misses++;
        continue;
      }
      await db.query(
        `update companies set
           industry = coalesce(industry, $2),
           employee_count = coalesce(employee_count, $3),
           country = coalesce(country, $4),
           state = coalesce(state, $5),
           updated_at = now()
         where id = $1`,
        [c.id, result.industry, result.employeeCount, result.country, result.region],
      );
      enriched++;
      console.log(`${c.legal_name}: ${result.industry ?? "?"}, ~${result.employeeCount ?? "?"} employees`);
    }
    console.log(`enriched ${enriched}, no PDL match for ${misses} (of ${rows.length} candidates)`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
