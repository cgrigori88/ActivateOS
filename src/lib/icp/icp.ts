import type { Pool, PoolClient } from "pg";
import { normalizeCompanyName } from "@/lib/identity/normalize";

type Db = Pool | PoolClient;

/**
 * ICP + suppression (task #83). Two different strengths on purpose:
 *
 *  - The ICP PROFILE is advisory — it renders fit chips and ranks lists, it
 *    never blocks. Unknown attributes count as unknown, not as misfit.
 *  - The SUPPRESSION LIST is a hard guardrail — suppressed accounts are
 *    excluded from motion drafting and candidate surfaces entirely.
 *    Competitors, existing customers, do-not-contact: the machine may not
 *    pursue them no matter what the scores say.
 */

export interface IcpProfile {
  industries: string[];
  employeeMin: number | null;
  employeeMax: number | null;
  geos: string[];
  notes: string | null;
}

export async function loadIcp(db: Db, orgId: string): Promise<IcpProfile | null> {
  const { rows } = await db.query<{
    industries: string[]; employee_min: number | null; employee_max: number | null;
    geos: string[]; notes: string | null;
  }>(`select industries, employee_min, employee_max, geos, notes from org_icp where org_id = $1`, [orgId]);
  if (!rows[0]) return null;
  const r = rows[0];
  const empty = r.industries.length === 0 && r.geos.length === 0 && r.employee_min == null && r.employee_max == null;
  if (empty) return null;
  return {
    industries: r.industries,
    employeeMin: r.employee_min,
    employeeMax: r.employee_max,
    geos: r.geos,
    notes: r.notes,
  };
}

export async function saveIcp(db: Db, orgId: string, icp: IcpProfile): Promise<void> {
  await db.query(
    `insert into org_icp (org_id, industries, employee_min, employee_max, geos, notes, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (org_id) do update set
       industries = excluded.industries, employee_min = excluded.employee_min,
       employee_max = excluded.employee_max, geos = excluded.geos,
       notes = excluded.notes, updated_at = now()`,
    [orgId, icp.industries, icp.employeeMin, icp.employeeMax, icp.geos, icp.notes],
  );
}

export type IcpFit = "fit" | "off_profile" | "unknown";

/** Advisory fit: every KNOWN attribute must land inside the profile; all-unknown → unknown. */
export function icpFit(
  icp: IcpProfile,
  company: { industry: string | null; employeeCount: number | null; country: string | null },
): IcpFit {
  let known = 0;
  const contains = (list: string[], v: string) => list.some((x) => x.trim().toLowerCase() === v.trim().toLowerCase());
  if (icp.industries.length > 0 && company.industry) {
    known++;
    if (!contains(icp.industries, company.industry)) return "off_profile";
  }
  if ((icp.employeeMin != null || icp.employeeMax != null) && company.employeeCount != null) {
    known++;
    if (icp.employeeMin != null && company.employeeCount < icp.employeeMin) return "off_profile";
    if (icp.employeeMax != null && company.employeeCount > icp.employeeMax) return "off_profile";
  }
  if (icp.geos.length > 0 && company.country) {
    known++;
    if (!contains(icp.geos, company.country)) return "off_profile";
  }
  return known > 0 ? "fit" : "unknown";
}

// ── Suppression ──────────────────────────────────────────────────────────────

export interface SuppressionEntry {
  id: string;
  kind: "domain" | "name";
  label: string;
  reason: string | null;
  createdAt: string;
}

export async function listSuppressions(db: Db, orgId: string): Promise<SuppressionEntry[]> {
  const { rows } = await db.query<{ id: string; kind: "domain" | "name"; label: string; reason: string | null; created_at: Date }>(
    `select id, kind, label, reason, created_at from account_suppressions where org_id = $1 order by created_at desc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, reason: r.reason,
    createdAt: new Date(r.created_at).toISOString().slice(0, 10),
  }));
}

export async function addSuppression(
  db: Db,
  orgId: string,
  entry: { kind: "domain" | "name"; value: string; reason?: string },
): Promise<void> {
  const label = entry.value.trim();
  if (!label) throw new Error("Enter a domain or company name to suppress.");
  const value =
    entry.kind === "domain"
      ? label.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
      : normalizeCompanyName(label);
  if (!value) throw new Error("Couldn't derive a matchable value from that entry.");
  await db.query(
    `insert into account_suppressions (org_id, kind, value, label, reason)
     values ($1, $2, $3, $4, nullif($5, ''))
     on conflict (org_id, kind, value) do update set label = excluded.label, reason = excluded.reason`,
    [orgId, entry.kind, value, label, entry.reason ?? ""],
  );
}

export async function removeSuppression(db: Db, orgId: string, id: string): Promise<void> {
  await db.query(`delete from account_suppressions where id = $1 and org_id = $2`, [id, orgId]);
}

/** The ids among `companyIds` the org has suppressed (domain or normalized-name match). */
export async function suppressedCompanyIds(db: Db, orgId: string, companyIds: string[]): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const { rows } = await db.query<{ id: string }>(
    `select distinct c.id from companies c
     join account_suppressions s on s.org_id = $1 and (
       (s.kind = 'domain' and c.primary_domain is not null
         and (c.primary_domain = s.value or c.primary_domain like '%.' || s.value))
       or (s.kind = 'name' and c.normalized_name = s.value)
     )
     where c.id = any($2)`,
    [orgId, companyIds],
  );
  return new Set(rows.map((r) => r.id));
}

/** SQL fragment consumers can use to exclude suppressed companies inline. */
export const NOT_SUPPRESSED_SQL = (orgParam: string, companyAlias: string) => `
  not exists (
    select 1 from account_suppressions sl
    where sl.org_id = ${orgParam} and (
      (sl.kind = 'domain' and ${companyAlias}.primary_domain is not null
        and (${companyAlias}.primary_domain = sl.value or ${companyAlias}.primary_domain like '%.' || sl.value))
      or (sl.kind = 'name' and ${companyAlias}.normalized_name = sl.value)
    )
  )`;
