import type pg from "pg";

/**
 * Account-mapping populations (Phase 10). A population is a categorized list of
 * accounts owned by the host org (partner_id null) or a partner. The matrix
 * crosses org rows with a partner's columns; each cell is the accounts in both,
 * rolled up with propensity. Drill-down returns per-account rows with merged
 * attributes so any ingested field can become a column.
 */

export const CATEGORIES = [
  "customer",
  "open_opportunity",
  "prospect",
  "target",
  "segment",
  "territory",
  "vertical",
  "custom",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  customer: "Customers",
  open_opportunity: "Open Opportunities",
  prospect: "Prospects",
  target: "Targets",
  segment: "Segment",
  territory: "Territory",
  vertical: "Vertical",
  custom: "Custom",
};

export interface Population {
  id: string;
  name: string;
  category: Category;
  status: string;
  partner_id: string | null;
  members: number;
}

export interface Cell {
  count: number;
  avgScore: number | null;
  highCount: number;
}

/** Partners that have at least one population (for the matrix's partner picker). */
export async function partnersWithPopulations(
  db: pg.PoolClient,
  orgId: string,
): Promise<{ id: string; name: string; partner_type: string | null }[]> {
  const { rows } = await db.query(
    `select distinct p.id, p.name, p.partner_type
     from account_populations ap join partners p on p.id = ap.partner_id
     where ap.org_id = $1
     order by p.name`,
    [orgId],
  );
  return rows;
}

export async function listPopulations(
  db: pg.PoolClient,
  args: { orgId: string; partnerId: string | null; status?: string },
): Promise<Population[]> {
  const { rows } = await db.query<Population>(
    `select ap.id, ap.name, ap.category, ap.status, ap.partner_id,
            (select count(*) from population_members m where m.population_id = ap.id)::int as members
     from account_populations ap
     where ap.org_id = $1
       and ap.partner_id is not distinct from $2
       and ($3::text is null or ap.status = $3)
     order by ap.category, ap.name`,
    [args.orgId, args.partnerId, args.status ?? null],
  );
  return rows;
}

export interface MatrixKpi {
  accounts: number; // distinct overlapping accounts
  hot: number; // distinct high/very-high band overlapping accounts
  avg: number | null; // mean propensity across overlapping accounts
}

/** The overlap matrix: rows = org populations, cols = a partner's populations. */
export async function matrix(
  db: pg.PoolClient,
  args: { orgId: string; partnerId: string },
): Promise<{
  rows: Population[];
  cols: Population[];
  cells: Map<string, Cell>;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  kpi: MatrixKpi;
}> {
  const [rows, cols] = await Promise.all([
    listPopulations(db, { orgId: args.orgId, partnerId: null, status: "approved" }),
    listPopulations(db, { orgId: args.orgId, partnerId: args.partnerId, status: "approved" }),
  ]);

  // One pass yields cells AND per-row / per-col distinct totals (grouping sets).
  const { rows: cellRows } = await db.query<{
    row_id: string | null;
    col_id: string | null;
    n: string;
    avg_score: string | null;
    high_n: string;
  }>(
    `select rm.population_id as row_id, cm.population_id as col_id,
            count(distinct rm.company_id) as n,
            avg(ps.score) as avg_score,
            count(distinct rm.company_id) filter (where ps.band in ('high','very_high')) as high_n
     from population_members rm
     join population_members cm on cm.company_id = rm.company_id
     join account_populations rp on rp.id = rm.population_id and rp.partner_id is null and rp.org_id = $1 and rp.status = 'approved'
     join account_populations cp on cp.id = cm.population_id and cp.partner_id = $2 and cp.status = 'approved'
     left join lateral (
       select score, band from propensity_scores p
       where p.company_id = rm.company_id order by computed_at desc limit 1
     ) ps on true
     group by grouping sets ((rm.population_id, cm.population_id), (rm.population_id), (cm.population_id))`,
    [args.orgId, args.partnerId],
  );

  const cells = new Map<string, Cell>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const c of cellRows) {
    if (c.row_id && c.col_id) {
      cells.set(`${c.row_id}:${c.col_id}`, {
        count: Number(c.n),
        avgScore: c.avg_score == null ? null : Number(c.avg_score),
        highCount: Number(c.high_n),
      });
    } else if (c.row_id) {
      rowTotals.set(c.row_id, Number(c.n));
    } else if (c.col_id) {
      colTotals.set(c.col_id, Number(c.n));
    }
  }

  const { rows: kpiRows } = await db.query<{ accounts: string; hot: string; avg: string | null }>(
    `with overlap as (
       select distinct rm.company_id
       from population_members rm
       join population_members cm on cm.company_id = rm.company_id
       join account_populations rp on rp.id = rm.population_id and rp.partner_id is null and rp.org_id = $1 and rp.status = 'approved'
       join account_populations cp on cp.id = cm.population_id and cp.partner_id = $2 and cp.status = 'approved'
     )
     select count(*) as accounts,
            count(*) filter (where ps.band in ('high','very_high')) as hot,
            round(avg(ps.score)) as avg
     from overlap o
     left join lateral (
       select score, band from propensity_scores p where p.company_id = o.company_id order by computed_at desc limit 1
     ) ps on true`,
    [args.orgId, args.partnerId],
  );
  const k = kpiRows[0];
  const kpi: MatrixKpi = {
    accounts: Number(k?.accounts ?? 0),
    hot: Number(k?.hot ?? 0),
    avg: k?.avg == null ? null : Number(k.avg),
  };

  return { rows, cols, cells, rowTotals, colTotals, kpi };
}

/** Create an org-side 'target' population from a cell's shared accounts (mapping → targeting). */
export async function targetFromCell(
  db: pg.PoolClient,
  args: { orgId: string | null; rowPopId: string; colPopId: string; name: string },
): Promise<{ populationId: string; added: number }> {
  const { rows } = await db.query<{ id: string }>(
    `insert into account_populations (org_id, partner_id, name, category, status, created_by)
     values ($1, null, $2, 'target', 'approved', 'web') returning id`,
    [args.orgId, args.name],
  );
  const populationId = rows[0].id;
  const res = await db.query(
    `insert into population_members (population_id, company_id)
     select $1, rm.company_id
     from population_members rm
     join population_members cm on cm.company_id = rm.company_id and cm.population_id = $3
     where rm.population_id = $2
     on conflict do nothing`,
    [populationId, args.rowPopId, args.colPopId],
  );
  return { populationId, added: res.rowCount ?? 0 };
}

export interface IntersectionRow {
  company_id: string;
  legal_name: string;
  primary_domain: string | null;
  industry: string | null;
  employee_count: number | null;
  score: number | null;
  band: string | null;
  attributes: Record<string, unknown>;
}

/** The accounts in both a row and a column population, with merged attributes. */
export async function intersection(
  db: pg.PoolClient,
  args: { rowPopId: string; colPopId: string },
): Promise<{ row: Population | null; col: Population | null; accounts: IntersectionRow[] }> {
  const { rows: pops } = await db.query<Population>(
    `select ap.id, ap.name, ap.category, ap.status, ap.partner_id, 0 as members
     from account_populations ap where ap.id = any($1)`,
    [[args.rowPopId, args.colPopId]],
  );
  const row = pops.find((p) => p.id === args.rowPopId) ?? null;
  const col = pops.find((p) => p.id === args.colPopId) ?? null;

  const { rows: accounts } = await db.query<IntersectionRow>(
    `select c.id as company_id, c.legal_name, c.primary_domain, c.industry, c.employee_count,
            ps.score, ps.band,
            (coalesce(rm.attributes, '{}'::jsonb) || coalesce(cm.attributes, '{}'::jsonb)) as attributes
     from population_members rm
     join population_members cm on cm.company_id = rm.company_id and cm.population_id = $2
     join companies c on c.id = rm.company_id
     left join lateral (
       select score, band from propensity_scores p
       where p.company_id = c.id order by computed_at desc limit 1
     ) ps on true
     where rm.population_id = $1
     order by ps.score desc nulls last, c.legal_name`,
    [args.rowPopId, args.colPopId],
  );
  // pg returns numeric/int as strings — coerce so the UI can format them.
  const coerced = accounts.map((a) => ({
    ...a,
    score: a.score == null ? null : Number(a.score),
    employee_count: a.employee_count == null ? null : Number(a.employee_count),
  }));
  return { row, col, accounts: coerced };
}

/** Union of attribute keys across both populations' members — the column menu. */
export async function availableFields(
  db: pg.PoolClient,
  args: { rowPopId: string; colPopId: string },
): Promise<string[]> {
  const { rows } = await db.query<{ key: string }>(
    `select distinct jsonb_object_keys(attributes) as key
     from population_members
     where population_id in ($1, $2)
     order by key`,
    [args.rowPopId, args.colPopId],
  );
  return rows.map((r) => r.key);
}
