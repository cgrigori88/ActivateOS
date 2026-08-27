import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Per-period revenue & pipeline targets. A target is the ONLY hand-typed number
 * — actuals are computed from opportunities every render, so the bar can't
 * drift from the pipeline it claims to describe. Periods are calendar years:
 * open pipeline lands in its expected-close year, won revenue in its close
 * year. Partner attribution follows opportunity → motion → partner; no partner
 * = base (direct) business, partner = joint (co-sell) — the same split as the
 * pipeline roll-up graph.
 */

export type TargetMetric = "pipeline" | "revenue";

export interface TargetRow {
  id: string | null; // null = no target set, actuals only
  partnerId: string | null; // null = overall
  partnerName: string | null;
  periodYear: number;
  metric: TargetMetric;
  targetUsd: number | null;
  actualUsd: number;
  baseUsd: number; // overall rows only: direct portion
  jointUsd: number; // overall rows only: partner-attributed portion
  attainmentPct: number | null;
}

export async function listTargets(db: Db, orgId: string): Promise<TargetRow[]> {
  // Actuals by (year, partner): open pipeline + won revenue.
  const { rows: actuals } = await db.query<{ yr: string; partner_id: string | null; partner_name: string | null; pipeline: string; revenue: string }>(
    `select x.yr, x.partner_id, p.name as partner_name,
            sum(x.pipeline) as pipeline, sum(x.revenue) as revenue
     from (
       select extract(year from coalesce(o.expected_close_date, o.created_at))::int as yr,
              m.partner_id, coalesce(o.amount_usd, 0) as pipeline, 0 as revenue
       from opportunities o left join revenue_motions m on m.id = o.motion_id
       where o.stage not like 'closed%'
       union all
       select extract(year from coalesce(o.closed_at, o.updated_at))::int,
              m.partner_id, 0, coalesce(o.amount_usd, 0)
       from opportunities o left join revenue_motions m on m.id = o.motion_id
       where o.stage = 'closed_won'
     ) x
     left join partners p on p.id = x.partner_id
     group by x.yr, x.partner_id, p.name`,
  );

  const { rows: targets } = await db.query<{ id: string; partner_id: string | null; partner_name: string | null; period_year: number; metric: TargetMetric; target_usd: string }>(
    `select t.id, t.partner_id, p.name as partner_name, t.period_year, t.metric, t.target_usd
     from revenue_targets t left join partners p on p.id = t.partner_id
     where t.org_id = $1`,
    [orgId],
  );

  // Index actuals: per (year, metric): overall total + base/joint split + per-partner.
  const key = (yr: number, metric: TargetMetric, partnerId: string | null) => `${yr}:${metric}:${partnerId ?? "_all"}`;
  const actual = new Map<string, number>();
  const partnerNames = new Map<string, string>();
  for (const a of actuals) {
    const yr = Number(a.yr);
    if (a.partner_id && a.partner_name) partnerNames.set(a.partner_id, a.partner_name);
    for (const metric of ["pipeline", "revenue"] as const) {
      const v = Number(a[metric]);
      if (!v) continue;
      actual.set(key(yr, metric, a.partner_id), (actual.get(key(yr, metric, a.partner_id)) ?? 0) + v);
      actual.set(key(yr, metric, null), (actual.get(key(yr, metric, null)) ?? 0) + v);
      if (a.partner_id) {
        const jk = `${yr}:${metric}:_joint`;
        actual.set(jk, (actual.get(jk) ?? 0) + v);
      }
    }
  }

  // Rows = every (year, metric, partner|overall) that has a target OR actuals.
  const wanted = new Map<string, TargetRow>();
  const ensure = (yr: number, metric: TargetMetric, partnerId: string | null, partnerName: string | null) => {
    const k = key(yr, metric, partnerId);
    if (wanted.has(k)) return wanted.get(k)!;
    const act = actual.get(k) ?? 0;
    const joint = partnerId == null ? actual.get(`${yr}:${metric}:_joint`) ?? 0 : 0;
    const row: TargetRow = {
      id: null,
      partnerId,
      partnerName,
      periodYear: yr,
      metric,
      targetUsd: null,
      actualUsd: act,
      baseUsd: partnerId == null ? act - joint : 0,
      jointUsd: joint,
      attainmentPct: null,
    };
    wanted.set(k, row);
    return row;
  };

  for (const t of targets) {
    const row = ensure(t.period_year, t.metric, t.partner_id, t.partner_name);
    row.id = t.id;
    row.targetUsd = Number(t.target_usd);
    row.attainmentPct = row.targetUsd > 0 ? Math.round((row.actualUsd / row.targetUsd) * 100) : null;
  }
  // Actual-only rows: overall + per-partner where money exists.
  for (const a of actuals) {
    const yr = Number(a.yr);
    for (const metric of ["pipeline", "revenue"] as const) {
      if (!Number(a[metric])) continue;
      ensure(yr, metric, null, null);
      if (a.partner_id) ensure(yr, metric, a.partner_id, a.partner_name);
    }
  }

  return [...wanted.values()].sort(
    (a, b) =>
      a.periodYear - b.periodYear ||
      a.metric.localeCompare(b.metric) ||
      (a.partnerId == null ? -1 : b.partnerId == null ? 1 : (a.partnerName ?? "").localeCompare(b.partnerName ?? "")),
  );
}

export async function upsertTarget(
  db: Db,
  args: { orgId: string; partnerId: string | null; periodYear: number; metric: TargetMetric; targetUsd: number },
): Promise<void> {
  // Partial unique indexes can't be targeted by ON CONFLICT with a nullable
  // column — do a manual upsert.
  const { rowCount } = await db.query(
    `update revenue_targets set target_usd = $5
     where org_id = $1 and partner_id is not distinct from $2 and period_year = $3 and metric = $4`,
    [args.orgId, args.partnerId, args.periodYear, args.metric, args.targetUsd],
  );
  if (!rowCount) {
    await db.query(
      `insert into revenue_targets (org_id, partner_id, period_year, metric, target_usd)
       values ($1, $2, $3, $4, $5)`,
      [args.orgId, args.partnerId, args.periodYear, args.metric, args.targetUsd],
    );
  }
}

export async function deleteTarget(db: Db, orgId: string, targetId: string): Promise<void> {
  // FLOW-2 fix: org-scoped so a foreign target id can't be deleted.
  await db.query(`delete from revenue_targets where id = $1 and org_id = $2`, [targetId, orgId]);
}
