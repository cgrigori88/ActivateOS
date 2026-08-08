import type pg from "pg";
import { extractDomain, normalizeCompanyName } from "../identity/normalize";
import { resolveCompany, type CompanyCandidate } from "../identity/resolve";
import type { AccountRow } from "./csv";

export interface IngestStats {
  created: number;
  matched: number;
  aliasesAdded: number;
  evidenceAdded: number;
}

/**
 * Upsert accounts into the identity graph. Existing-product claims from the
 * customer CSV are stored as evidence rows (source_type 'customer_csv') —
 * even first-party data obeys the evidence-gating rule.
 */
export async function ingestAccounts(
  db: pg.PoolClient,
  orgId: string,
  rows: AccountRow[],
): Promise<IngestStats> {
  const stats: IngestStats = { created: 0, matched: 0, aliasesAdded: 0, evidenceAdded: 0 };

  const { rows: existing } = await db.query<{
    id: string;
    normalized_name: string;
    primary_domain: string | null;
    country: string | null;
  }>("select id, normalized_name, primary_domain, country from companies");

  const candidates: CompanyCandidate[] = existing.map((c) => ({
    id: c.id,
    normalizedName: c.normalized_name,
    primaryDomain: c.primary_domain,
    country: c.country,
  }));

  for (const row of rows) {
    const domain = row.domain ? extractDomain(row.domain) : null;
    const normalized = normalizeCompanyName(row.companyName);
    const resolution = resolveCompany({ name: row.companyName, domain }, candidates);

    let companyId: string;
    if (resolution) {
      companyId = resolution.companyId;
      stats.matched++;
    } else {
      const { rows: inserted } = await db.query<{ id: string }>(
        `insert into companies (legal_name, normalized_name, primary_domain, industry, employee_count)
         values ($1, $2, $3, nullif($4, ''), $5)
         returning id`,
        [row.companyName, normalized, domain, row.industry, row.employeeCount],
      );
      companyId = inserted[0].id;
      candidates.push({ id: companyId, normalizedName: normalized, primaryDomain: domain });
      stats.created++;
    }

    const aliasResult = await db.query(
      `insert into company_aliases (company_id, alias, alias_type, source)
       values ($1, $2, 'name', 'customer_csv')
       on conflict do nothing`,
      [companyId, row.companyName],
    );
    stats.aliasesAdded += aliasResult.rowCount ?? 0;

    for (const product of row.existingProducts) {
      const evidenceResult = await db.query(
        `insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at)
         values ($1, $2, 'customer_csv', $3, 0.9, now())`,
        [orgId, companyId, `Customer-reported installed product: ${product}`],
      );
      stats.evidenceAdded += evidenceResult.rowCount ?? 0;
    }
  }

  return stats;
}
