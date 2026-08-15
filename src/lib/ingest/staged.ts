import type pg from "pg";
import { extractDomain, normalizeCompanyName } from "../identity/normalize";
import { resolveCompany, type CompanyCandidate } from "../identity/resolve";
import { verifyEvidence } from "../quality/verify";
import {
  profileColumns,
  proposeMapping,
  sniffCsv,
  customKey,
  FIELD_BY_KEY,
  type ColumnMapping,
  type ColumnProfile,
} from "./detect";

/**
 * Staged CSV intake (task #48): analyze → human mapping review → commit.
 *
 * The raw rows are staged in import_rows (tenant-RLS'd) between the two steps
 * and deleted the moment the operator commits or discards — the platform holds
 * a partner's raw book no longer than the decision requires. Analysis is
 * deterministic and local (no AI, nothing leaves the tenant).
 */

export const MAX_CSV_BYTES = 8 * 1024 * 1024; // keep under the action body limit
export const MAX_CSV_ROWS = 10_000;
const STALE_BATCH_DAYS = 7;

// ── Analyze ──────────────────────────────────────────────────────────────────

export interface AnalyzeResult {
  batchId: string;
  rowCount: number;
  profiles: ColumnProfile[];
  proposal: ColumnMapping[];
}

export async function analyzeCsvToBatch(
  db: pg.PoolClient,
  args: { orgId: string; csv: string; filename: string | null; uploadedBy?: string },
): Promise<AnalyzeResult> {
  if (Buffer.byteLength(args.csv, "utf8") > MAX_CSV_BYTES) {
    throw new Error(`File too large — the cap is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)}MB per upload.`);
  }
  const sniffed = sniffCsv(args.csv);
  if (sniffed.rows.length === 0) throw new Error("No data rows found in the file.");
  if (sniffed.rows.length > MAX_CSV_ROWS) {
    throw new Error(`Too many rows (${sniffed.rows.length.toLocaleString()}) — the cap is ${MAX_CSV_ROWS.toLocaleString()} per upload. Split the file.`);
  }

  const profiles = profileColumns(sniffed.headers, sniffed.rows);
  const proposal = proposeMapping(profiles);

  // Housekeeping: staged rows of abandoned reviews don't linger.
  await db.query(
    `delete from import_rows using import_batches b
     where b.id = import_rows.batch_id and b.org_id = $1
       and b.status = 'analyzed' and b.created_at < now() - interval '${STALE_BATCH_DAYS} days'`,
    [args.orgId],
  );
  await db.query(
    `update import_batches set status = 'discarded', error = 'expired unreviewed'
     where org_id = $1 and status = 'analyzed' and created_at < now() - interval '${STALE_BATCH_DAYS} days'`,
    [args.orgId],
  );

  const { rows: batchRows } = await db.query<{ id: string }>(
    `insert into import_batches (org_id, filename, uploaded_by, row_count, status, mapping)
     values ($1, $2, $3, $4, 'analyzed', $5) returning id`,
    [
      args.orgId,
      args.filename,
      args.uploadedBy ?? null,
      sniffed.rows.length,
      JSON.stringify({
        delimiter: sniffed.delimiter,
        hasHeaderRow: sniffed.hasHeaderRow,
        headers: sniffed.headers,
        profiles,
        proposal,
      }),
    ],
  );
  const batchId = batchRows[0].id;

  // Bulk-stage rows: one INSERT per 500-row chunk via jsonb array expansion.
  for (let i = 0; i < sniffed.rows.length; i += 500) {
    const chunk = sniffed.rows.slice(i, i + 500);
    await db.query(
      `insert into import_rows (batch_id, row_no, data)
       select $1, ($2 + o.ord - 1)::int, o.cells
       from jsonb_array_elements($3::jsonb) with ordinality as o(cells, ord)`,
      [batchId, i + 1, JSON.stringify(chunk)],
    );
  }

  return { batchId, rowCount: sniffed.rows.length, profiles, proposal };
}

// ── Commit ───────────────────────────────────────────────────────────────────

/** Attribute keys that land on the company record itself, not (only) the member. */
const COMPANY_CORE = new Set(["company", "domain", "industry", "employees"]);

export interface CommitArgs {
  orgId: string;
  batchId: string;
  /** confirmed mapping: column index → target key ("" = skip) */
  targets: Record<number, string>;
  /** which target keys the operator surfaces (population.selected_fields) */
  surfaced: string[];
  population: { name: string; category: string; partnerId: string | null };
}

export interface CommitResult {
  populationId: string;
  imported: number;
  skippedNoCompany: number;
  matched: number;
  created: number;
  contactsUpserted: number;
  evidenceAdded: number;
}

const CSV_TRUST = 0.85;

export async function commitImportBatch(db: pg.PoolClient, args: CommitArgs): Promise<CommitResult> {
  const { rows: batchRows } = await db.query<{ id: string; status: string; mapping: { headers: string[] } | null }>(
    `select id, status, mapping from import_batches where id = $1 and org_id = $2`,
    [args.batchId, args.orgId],
  );
  const batch = batchRows[0];
  if (!batch) throw new Error("Import not found (or it belongs to another organization).");
  if (batch.status !== "analyzed") throw new Error(`Import is ${batch.status} — only an analyzed upload can be committed.`);

  // The company column is the anchor; refuse to import rows into nothing.
  const companyCol = Object.entries(args.targets).find(([, t]) => t === "company")?.[0];
  if (companyCol == null) throw new Error("Map one column to Company name first — accounts need an identity.");
  const companyIdx = Number(companyCol);

  await db.query(`update import_batches set status = 'importing' where id = $1`, [args.batchId]);

  try {
    const { rows: staged } = await db.query<{ row_no: number; data: string[] }>(
      `select row_no, data from import_rows where batch_id = $1 order by row_no`,
      [args.batchId],
    );

    // Identity candidates once, matched in memory per row (same approach as
    // the fixed-schema ingest — the resolver needs the whole candidate set).
    const { rows: existing } = await db.query<{
      id: string;
      normalized_name: string;
      primary_domain: string | null;
      country: string | null;
    }>(`select id, normalized_name, primary_domain, country from companies`);
    const candidates: CompanyCandidate[] = existing.map((c) => ({
      id: c.id,
      normalizedName: c.normalized_name,
      primaryDomain: c.primary_domain,
      country: c.country,
    }));

    await db.query(
      `insert into signal_sources (name, kind, trust_score, audit_sample_rate)
       values ('customer_csv', 'first_party', $1, 0.05) on conflict (name) do nothing`,
      [CSV_TRUST],
    );

    // Population first — members attach as rows resolve. Status 'pending':
    // every import walks through the same human review gate as shared lists.
    const { rows: popRows } = await db.query<{ id: string }>(
      `insert into account_populations (org_id, partner_id, name, category, status, source_batch_id, created_by, selected_fields)
       values ($1, $2, $3, $4, 'pending', $5, 'csv_intake', $6) returning id`,
      [args.orgId, args.population.partnerId, args.population.name, args.population.category, args.batchId, args.surfaced],
    );
    const populationId = popRows[0].id;

    const surfacedSet = new Set(args.surfaced);
    const result: CommitResult = {
      populationId,
      imported: 0,
      skippedNoCompany: 0,
      matched: 0,
      created: 0,
      contactsUpserted: 0,
      evidenceAdded: 0,
    };

    for (const row of staged) {
      const cells = row.data;
      const get = (key: string): string => {
        const idx = Object.entries(args.targets).find(([, t]) => t === key)?.[0];
        return idx == null ? "" : (cells[Number(idx)] ?? "").trim();
      };

      const companyName = (cells[companyIdx] ?? "").trim();
      if (!companyName) {
        result.skippedNoCompany++;
        continue;
      }

      const domain = get("domain") ? extractDomain(get("domain")) : null;
      const normalized = normalizeCompanyName(companyName);
      const resolution = resolveCompany({ name: companyName, domain }, candidates);

      let companyId: string;
      if (resolution) {
        companyId = resolution.companyId;
        result.matched++;
      } else {
        const employeesRaw = get("employees").replace(/[,\s]/g, "");
        const { rows: inserted } = await db.query<{ id: string }>(
          `insert into companies (legal_name, normalized_name, primary_domain, industry, employee_count)
           values ($1, $2, $3, nullif($4, ''), $5) returning id`,
          [companyName, normalized, domain, get("industry"), /^\d+$/.test(employeesRaw) ? Number(employeesRaw) : null],
        );
        companyId = inserted[0].id;
        candidates.push({ id: companyId, normalizedName: normalized, primaryDomain: domain });
        result.created++;
      }

      await db.query(
        `insert into company_aliases (company_id, alias, alias_type, source)
         values ($1, $2, 'name', 'customer_csv') on conflict do nothing`,
        [companyId, companyName],
      );

      // Member attributes: every kept, non-core mapped value — canonical keys
      // and custom pass-through keys alike. This is what the matrix/review
      // screens read, filtered by the surfaced set at display time.
      const attributes: Record<string, string> = {};
      for (const [idxStr, target] of Object.entries(args.targets)) {
        if (!target || target === "company") continue;
        const v = (cells[Number(idxStr)] ?? "").trim();
        if (!v) continue;
        if (COMPANY_CORE.has(target)) continue; // lives on the company record
        attributes[target] = v.slice(0, 500);
      }

      await db.query(
        `insert into population_members (population_id, company_id, attributes)
         values ($1, $2, $3)
         on conflict (population_id, company_id)
         do update set attributes = population_members.attributes || excluded.attributes`,
        [populationId, companyId, JSON.stringify(attributes)],
      );
      result.imported++;

      // Partner-list membership keeps Intake analytics + screening working.
      if (args.population.partnerId) {
        await db.query(
          `insert into partner_accounts (org_id, partner_id, company_id, batch_id, target_product, installed)
           values ($1, $2, $3, $4, nullif($5, ''), $6)
           on conflict (partner_id, company_id) do update set
             batch_id = excluded.batch_id,
             target_product = coalesce(excluded.target_product, partner_accounts.target_product),
             installed = partner_accounts.installed or excluded.installed`,
          [args.orgId, args.population.partnerId, companyId, args.batchId, get("target_product"), !!get("installed_products")],
        );
      }

      // Buying-side contact, when the file carries one and the field is kept.
      const contactEmail = get("contact_email").toLowerCase();
      if (contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) {
        await db.query(
          `insert into contacts (org_id, company_id, email, name, title, phone, contact_type, source)
           values ($1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''), 'end_user', 'manual')
           on conflict (org_id, email) where source <> 'population' do update set
             company_id = coalesce(contacts.company_id, excluded.company_id),
             name = coalesce(excluded.name, contacts.name),
             title = coalesce(excluded.title, contacts.title),
             phone = coalesce(excluded.phone, contacts.phone)`,
          [args.orgId, companyId, contactEmail, get("contact_name"), get("contact_title"), get("contact_phone")],
        );
        result.contactsUpserted++;
      }

      // Installed-product claims become evidence — first-party data still
      // walks through the quality gates like any other source.
      const installed = get("installed_products");
      if (installed) {
        for (const product of installed.split(/[;|]/).map((p) => p.trim()).filter(Boolean).slice(0, 10)) {
          const claim = `Customer-reported installed product: ${product}`;
          const { rows: ev } = await db.query<{ id: string }>(
            `insert into evidence (org_id, company_id, source_type, claim, raw_excerpt, confidence, observed_at)
             values ($1, $2, 'customer_csv', $3, $4, 0.9, now()) returning id`,
            [args.orgId, companyId, claim, claim],
          );
          result.evidenceAdded++;
          await verifyEvidence(db, {
            id: ev[0].id,
            orgId: args.orgId,
            companyId,
            sourceName: "customer_csv",
            claim,
            rawExcerpt: claim,
            observedAt: new Date(),
            extractionConfidence: 0.9,
          });
        }
      }
    }

    // Close out: counts onto the batch, staged rows GONE (data minimization).
    await db.query(`delete from import_rows where batch_id = $1`, [args.batchId]);
    await db.query(
      `update import_batches set status = 'imported', matched_count = $2, created_count = $3, evidence_count = $4,
         partner_id = $5,
         mapping = mapping || jsonb_build_object('confirmed', $6::jsonb, 'surfaced', $7::jsonb)
       where id = $1`,
      [
        args.batchId,
        result.matched,
        result.created,
        result.evidenceAdded,
        args.population.partnerId,
        JSON.stringify(args.targets),
        JSON.stringify(args.surfaced),
      ],
    );
    return result;
  } catch (err) {
    await db.query(`update import_batches set status = 'failed', error = $2 where id = $1`, [
      args.batchId,
      err instanceof Error ? err.message : String(err),
    ]);
    throw err;
  }
}

// ── Discard ──────────────────────────────────────────────────────────────────

export async function discardImportBatch(db: pg.PoolClient, args: { orgId: string; batchId: string }): Promise<void> {
  const { rowCount } = await db.query(
    `update import_batches set status = 'discarded' where id = $1 and org_id = $2 and status = 'analyzed'`,
    [args.batchId, args.orgId],
  );
  if (!rowCount) throw new Error("Import not found or not discardable.");
  await db.query(`delete from import_rows where batch_id = $1`, [args.batchId]);
}

// ── Shared helpers for the review screen ────────────────────────────────────

export interface StagedBatch {
  id: string;
  filename: string | null;
  rowCount: number;
  createdAt: Date;
  headers: string[];
  hasHeaderRow: boolean;
  profiles: ColumnProfile[];
  proposal: ColumnMapping[];
  preview: string[][]; // first rows for the mapped preview
}

export async function loadStagedBatch(
  db: pg.PoolClient,
  args: { orgId: string; batchId: string; previewRows?: number },
): Promise<StagedBatch | null> {
  const { rows } = await db.query<{
    id: string;
    filename: string | null;
    row_count: number;
    created_at: Date;
    mapping: {
      headers: string[];
      hasHeaderRow: boolean;
      profiles: ColumnProfile[];
      proposal: ColumnMapping[];
    } | null;
  }>(
    `select id, filename, row_count, created_at, mapping
     from import_batches where id = $1 and org_id = $2 and status = 'analyzed'`,
    [args.batchId, args.orgId],
  );
  const b = rows[0];
  if (!b || !b.mapping) return null;
  const { rows: preview } = await db.query<{ data: string[] }>(
    `select data from import_rows where batch_id = $1 order by row_no limit $2`,
    [args.batchId, args.previewRows ?? 5],
  );
  return {
    id: b.id,
    filename: b.filename,
    rowCount: Number(b.row_count),
    createdAt: b.created_at,
    headers: b.mapping.headers,
    hasHeaderRow: b.mapping.hasHeaderRow,
    profiles: b.mapping.profiles,
    proposal: b.mapping.proposal,
    preview: preview.map((r) => r.data),
  };
}

/** Validate a confirmed mapping posted from the review form. */
export function sanitizeTargets(raw: Record<string, string>, headers: string[]): Record<number, string> {
  const out: Record<number, string> = {};
  const seen = new Set<string>();
  for (const [idxStr, targetRaw] of Object.entries(raw)) {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= headers.length) continue;
    const target = targetRaw.trim();
    if (!target) continue; // skipped column
    // canonical keys pass through; anything else is re-sanitized as custom
    const key = FIELD_BY_KEY.has(target) ? target : customKey(target);
    if (seen.has(key)) continue; // one column per field — first wins
    seen.add(key);
    out[idx] = key;
  }
  return out;
}
