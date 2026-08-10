import type pg from "pg";
import { extractDomain, normalizeCompanyName } from "../identity/normalize";
import { resolveCompany, type CompanyCandidate } from "../identity/resolve";
import { verifyEvidence } from "../quality/verify";
import { parseAccountsCsv, type AccountRow } from "./csv";

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
export interface IngestOptions {
  /** tag every account onto this partner's list (Intake / Mapping membership) */
  partnerId?: string;
  /** provenance link to the import_batches row */
  batchId?: string;
}

export async function ingestAccounts(
  db: pg.PoolClient,
  orgId: string,
  rows: AccountRow[],
  opts: IngestOptions = {},
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

    // Partner-list membership — the backbone of Intake analytics + Mapping
    // overlap, and the org-portfolio linkage the screening sweep relies on.
    if (opts.partnerId) {
      await db.query(
        `insert into partner_accounts (org_id, partner_id, company_id, batch_id, target_product, installed)
         values ($1, $2, $3, $4, nullif($5, ''), $6)
         on conflict (partner_id, company_id) do update set
           batch_id = excluded.batch_id,
           target_product = coalesce(excluded.target_product, partner_accounts.target_product),
           installed = partner_accounts.installed or excluded.installed`,
        [orgId, opts.partnerId, companyId, opts.batchId ?? null, row.targetProduct, row.existingProducts.length > 0],
      );
    }

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

export interface ImportResult {
  batchId: string;
  orgId: string;
  partnerId: string | null;
  rowCount: number;
  stats: IngestStats;
  errors: { line: number; message: string }[];
}

/**
 * End-to-end CSV import for one partner: resolve org + partner, open an
 * import_batch, ingest the rows (tagging partner-list membership), and close
 * the batch with match stats. The single entry point for the Intake upload
 * (worker) and the CLI, so both produce identical analytics.
 */
export async function importAccountsCsv(
  db: pg.PoolClient,
  opts: {
    orgName: string;
    partnerName?: string;
    partnerType?: string;
    filename?: string;
    uploadedBy?: string;
    csv: string;
  },
): Promise<ImportResult> {
  const { rows, errors } = parseAccountsCsv(opts.csv);

  const { rows: orgRows } = await db.query<{ id: string }>(
    `insert into organizations (name) values ($1) on conflict do nothing returning id`,
    [opts.orgName],
  );
  const orgId =
    orgRows[0]?.id ??
    (await db.query<{ id: string }>(`select id from organizations where name = $1`, [opts.orgName])).rows[0].id;

  let partnerId: string | null = null;
  if (opts.partnerName) {
    const type = opts.partnerType ?? "reseller";
    const existing = await db.query<{ id: string }>(
      `select id from partners where org_id = $1 and lower(name) = lower($2) limit 1`,
      [orgId, opts.partnerName],
    );
    partnerId =
      existing.rows[0]?.id ??
      (
        await db.query<{ id: string }>(
          `insert into partners (org_id, name, partner_type) values ($1, $2, $3) returning id`,
          [orgId, opts.partnerName, type],
        )
      ).rows[0].id;
  }

  const { rows: batchRows } = await db.query<{ id: string }>(
    `insert into import_batches (org_id, partner_id, filename, uploaded_by, row_count, status)
     values ($1, $2, $3, $4, $5, 'importing') returning id`,
    [orgId, partnerId, opts.filename ?? null, opts.uploadedBy ?? null, rows.length],
  );
  const batchId = batchRows[0].id;

  try {
    const stats = await ingestAccounts(db, orgId, rows, { partnerId: partnerId ?? undefined, batchId });
    await db.query(
      `update import_batches set matched_count = $2, created_count = $3, evidence_count = $4, status = 'imported'
       where id = $1`,
      [batchId, stats.matched, stats.created, stats.evidenceAdded],
    );
    return { batchId, orgId, partnerId, rowCount: rows.length, stats, errors };
  } catch (err) {
    await db.query(`update import_batches set status = 'failed', error = $2 where id = $1`, [
      batchId,
      err instanceof Error ? err.message : String(err),
    ]);
    throw err;
  }
}
