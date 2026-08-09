import type pg from "pg";
import { extractDomain, normalizeCompanyName } from "../identity/normalize";
import { resolveCompany, type CompanyCandidate } from "../identity/resolve";
import { verifyEvidence } from "../quality/verify";
import type { AccountRow } from "./csv";

export interface IngestStats {
  created: number;
  matched: number;
  aliasesAdded: number;
  evidenceAdded: number;
  evidenceVerified: number;
  evidenceHeld: number; // quarantined or rejected by the quality gates
}

/** First-party customer data starts at high (not perfect) trust. */
const CUSTOMER_CSV_TRUST = 0.85;

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
  const stats: IngestStats = {
    created: 0,
    matched: 0,
    aliasesAdded: 0,
    evidenceAdded: 0,
    evidenceVerified: 0,
    evidenceHeld: 0,
  };

  await db.query(
    `insert into signal_sources (name, kind, trust_score, audit_sample_rate)
     values ('customer_csv', 'first_party', $1, 0.05)
     on conflict (name) do nothing`,
    [CUSTOMER_CSV_TRUST],
  );

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
      const claim = `Customer-reported installed product: ${product}`;
      const { rows: inserted } = await db.query<{ id: string }>(
        `insert into evidence (org_id, company_id, source_type, claim, raw_excerpt, confidence, observed_at)
         values ($1, $2, 'customer_csv', $3, $4, 0.9, now())
         returning id`,
        [orgId, companyId, claim, claim],
      );
      stats.evidenceAdded++;

      const outcome = await verifyEvidence(db, {
        id: inserted[0].id,
        orgId,
        companyId,
        sourceName: "customer_csv",
        claim,
        rawExcerpt: claim,
        observedAt: new Date(),
        extractionConfidence: 0.9,
      });
      if (outcome.status === "verified") stats.evidenceVerified++;
      else stats.evidenceHeld++;
    }
  }

  return stats;
}
