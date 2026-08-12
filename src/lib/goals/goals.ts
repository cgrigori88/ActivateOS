import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * S.M.A.R.T. goals. Progress on the measurable metric is computed from the
 * motions and campaigns linked to the goal — never hand-typed — so it can't
 * drift from reality. Pace compares progress against elapsed time toward the
 * due date, which is what turns a target into a signal.
 */

export type Metric = "pipeline_usd" | "won_usd" | "opps_won" | "motions_won" | "touches_sent" | "custom";

export interface MetricMeta {
  key: Metric;
  label: string;
  kind: "usd" | "count";
  computed: boolean; // false = human-entered (manual_value)
}

export const METRICS: MetricMeta[] = [
  { key: "pipeline_usd", label: "Pipeline created ($)", kind: "usd", computed: true },
  { key: "won_usd", label: "Won value ($)", kind: "usd", computed: true },
  { key: "opps_won", label: "Opportunities won", kind: "count", computed: true },
  { key: "motions_won", label: "Motions won", kind: "count", computed: true },
  { key: "touches_sent", label: "Touches sent", kind: "count", computed: true },
  { key: "custom", label: "Custom (manual)", kind: "count", computed: false },
];
export const METRIC_LABEL: Record<Metric, string> = Object.fromEntries(METRICS.map((m) => [m.key, m.label])) as Record<Metric, string>;

export interface Goal {
  id: string;
  name: string;
  description: string | null;
  metric: Metric;
  target: number;
  baseline: number;
  current: number;
  unit: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  owner: string | null;
  motionsLinked: number;
  campaignsLinked: number;
  progressPct: number; // 0..100 toward target
  timePct: number | null; // 0..100 of the window elapsed (null if no dates)
  daysLeft: number | null;
  pace: "ahead" | "on_track" | "behind" | "none";
}

export function formatMetric(kind: "usd" | "count", v: number, unit?: string | null): string {
  if (kind === "usd") return `$${Math.round(v / 1000)}k`;
  return `${Math.round(v)}${unit ? ` ${unit}` : ""}`;
}

function computePace(progressPct: number, timePct: number | null): Goal["pace"] {
  if (timePct == null) return "none";
  if (progressPct >= 100) return "ahead";
  const slack = progressPct - timePct;
  if (slack >= 5) return "ahead";
  if (slack <= -15) return "behind";
  return "on_track";
}

export async function listGoals(db: Db, orgId: string): Promise<Goal[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    description: string | null;
    metric: Metric;
    target_value: string;
    baseline_value: string;
    manual_value: string | null;
    unit: string | null;
    start_date: string | null;
    due_date: string | null;
    status: string;
    owner: string | null;
    motions_pipeline: string;
    motions_won_usd: string;
    motions_won: string;
    touches_sent: string;
    opps_won: string;
    motions_linked: string;
    campaigns_linked: string;
  }>(
    `select g.*,
       (select coalesce(sum(m.estimated_value_usd),0) from revenue_motions m where m.goal_id = g.id) as motions_pipeline,
       (select coalesce(sum(m.estimated_value_usd),0) from revenue_motions m where m.goal_id = g.id and m.outcome = 'won') as motions_won_usd,
       (select count(*) from revenue_motions m where m.goal_id = g.id and m.outcome = 'won') as motions_won,
       (select count(*) from campaign_touches t join campaigns ca on ca.id = t.campaign_id where ca.goal_id = g.id and t.status = 'sent') as touches_sent,
       (select count(*) from opportunities o join revenue_motions m on m.id = o.motion_id where m.goal_id = g.id and o.stage = 'closed_won') as opps_won,
       (select count(*) from revenue_motions m where m.goal_id = g.id) as motions_linked,
       (select count(*) from campaigns ca where ca.goal_id = g.id) as campaigns_linked
     from goals g
     where g.org_id = $1
     order by (g.status = 'active') desc, g.due_date asc nulls last, g.created_at desc`,
    [orgId],
  );

  const today = new Date();
  return rows.map((r) => {
    const metric = r.metric;
    const raw: Record<Metric, number> = {
      pipeline_usd: Number(r.motions_pipeline),
      won_usd: Number(r.motions_won_usd),
      opps_won: Number(r.opps_won),
      motions_won: Number(r.motions_won),
      touches_sent: Number(r.touches_sent),
      custom: r.manual_value == null ? 0 : Number(r.manual_value),
    };
    const target = Number(r.target_value);
    const baseline = Number(r.baseline_value);
    const current = raw[metric];
    const denom = target - baseline;
    const progressPct = denom > 0 ? Math.max(0, Math.min(100, Math.round(((current - baseline) / denom) * 100))) : current >= target ? 100 : 0;

    let timePct: number | null = null;
    let daysLeft: number | null = null;
    if (r.start_date && r.due_date) {
      const start = new Date(r.start_date).getTime();
      const due = new Date(r.due_date).getTime();
      const span = due - start;
      if (span > 0) timePct = Math.max(0, Math.min(100, Math.round(((today.getTime() - start) / span) * 100)));
      daysLeft = Math.ceil((due - today.getTime()) / 86_400_000);
    }

    return {
      id: r.id,
      name: r.name,
      description: r.description,
      metric,
      target,
      baseline,
      current,
      unit: r.unit,
      startDate: r.start_date,
      dueDate: r.due_date,
      status: r.status,
      owner: r.owner,
      motionsLinked: Number(r.motions_linked),
      campaignsLinked: Number(r.campaigns_linked),
      progressPct,
      timePct,
      daysLeft,
      pace: computePace(progressPct, timePct),
    };
  });
}

/** Lightweight goal options for assignment dropdowns / filters. */
export async function goalOptions(db: Db, orgId: string): Promise<{ id: string; name: string; status: string }[]> {
  const { rows } = await db.query<{ id: string; name: string; status: string }>(
    `select id, name, status from goals where org_id = $1 order by (status = 'active') desc, name`,
    [orgId],
  );
  return rows;
}

export async function createGoal(
  db: Db,
  args: { orgId: string | null; name: string; description: string | null; metric: Metric; target: number; baseline: number; unit: string | null; dueDate: string | null; owner: string | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into goals (org_id, name, description, metric, target_value, baseline_value, unit, due_date, owner)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [args.orgId, args.name, args.description, args.metric, args.target, args.baseline, args.unit, args.dueDate, args.owner],
  );
  return rows[0].id;
}

export async function setGoalStatus(db: Db, goalId: string, status: string): Promise<void> {
  await db.query(`update goals set status = $2 where id = $1`, [goalId, status]);
}

export async function setGoalManualValue(db: Db, goalId: string, value: number): Promise<void> {
  await db.query(`update goals set manual_value = $2 where id = $1`, [goalId, value]);
}
