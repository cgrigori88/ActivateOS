import type { Pool, PoolClient } from "pg";
import { weightedPipelineValue } from "@/lib/opportunities/lifecycle";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import type { Stage } from "@/lib/opportunities/lifecycle";

type Db = Pool | PoolClient;

/**
 * The explicit daily pipeline ANALYTICAL sample producer (D-P1 · D-HIST-2).
 *
 * WHAT ONE ROW MEANS. `pipeline_snapshots` is keyed `(org_id, taken_on)` — one row per org per day —
 * and it means exactly one thing: **the canonical, unfiltered daily pipeline state for that org**.
 * The schema has no timeframe, filter, scope or source dimension, and both consumers read it that
 * way (the week-ago comparison and the calibration card on /pipeline).
 *
 * THE DEFECT THIS EXISTS TO CLOSE. /pipeline used to compute `open`, `total` and `weighted` from its
 * RENDERED set and pass them into an inline upsert. That set is narrowed by `?timeframe=` (and by the
 * active ecosystem scope), so simply LOOKING at a filtered view overwrote the canonical row with
 * filtered totals. On the hosted world a 7-day view would have persisted `open_count = 0,
 * open_usd = 0` over a true 11 / $8,040,000 — a read poisoning canonical history.
 *
 * WHY THE SIGNATURE IS `(db, orgId)` AND NOTHING ELSE. A guard like `if (timeframe == null) write(...)`
 * would close today's instance and leave the class open: any future filter applied to the page's
 * opportunity set would silently poison again. Instead this writer accepts NO caller-computed value —
 * not open_count, open_usd, weighted_usd, crm_usd, timeframe, or any opportunity list — and derives
 * every persisted field itself from the org's FULL unfiltered opportunity set. Filtered-view
 * poisoning is impossible by API shape, not by caller discipline.
 *
 * D-HIST-2 — WHAT CHANGED, AND WHY.
 *
 * This is no longer reachable from a render. "History accrues just by looking" meant a row existed
 * because somebody opened the page, so the series recorded the audience rather than the business,
 * while both consumers reason about it as a daily sample. It is now driven by the worker's existing
 * daily sweep, and it is ANALYTICAL history — a derived sample of canonical state, never canonical
 * truth, and never evidence that a user visited anything.
 *
 * THREE PROPERTIES THE CONTRACT TURNS ON:
 *
 *   · PROVENANCE IS EXPLICIT. Every row states `scheduled_daily_v1`. The column has no default, so a
 *     producer that forgets fails instead of quietly writing legacy-looking data.
 *   · THE DATE IS UTC, EXPLICITLY. `taken_on` is `(now() at time zone 'utc')::date`, not the session's
 *     idea of today — the local clone and the deployed runtime disagreed by five to six hours a day.
 *   · FIRST WRITE WINS. `on conflict do nothing`: the day's sample is the FIRST successful producer
 *     run for that org on that UTC date. A retry cannot revise it, because otherwise page-view timing
 *     would simply have been replaced by job-retry timing.
 *
 * It is a daily sample keyed to a UTC date — NOT a midnight snapshot. The producer runs when the
 * worker's sweep runs, and no claim is made that the instant is midnight.
 *
 * Deliberately unchanged: the canonical business rules (what counts as open, how amounts aggregate,
 * the stage-weight curve with per-partner overrides, the CRM tie-out). Prior-date rows remain
 * immutable by construction, since only today's UTC date is ever written.
 *
 * TENANT ENUMERATION IS NOT THIS FUNCTION'S JOB. It takes one `orgId`. The worker owns deciding which
 * organizations are due, using the all-org authority it already has for screening and backups.
 */
export async function producePipelineSnapshot(db: Db, orgId: string): Promise<void> {
  // The org's FULL opportunity set — no ecosystem scope, no timeframe horizon, no board filters.
  // The `join companies` mirrors the page's canonical source exactly.
  const { rows } = await db.query<{ stage: string; amount_usd: string | null; partner_id: string | null }>(
    `select o.stage, o.amount_usd, m.partner_id
       from opportunities o
       join companies c on c.id = o.company_id
       left join revenue_motions m on m.id = o.motion_id and m.org_id = o.org_id
      where o.org_id = $1`,
    [orgId],
  );

  const open = rows.filter((o) => !o.stage.startsWith("closed"));
  const openCount = open.length;
  const openUsd = open.reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);

  // The org's editable stage curve with per-partner overrides — the same source the page renders from.
  const stageWeights = await loadStageWeights(db, orgId);
  const weightedUsd = weightedPipelineValue(
    rows.map((o) => ({
      stage: o.stage as Stage,
      amountUsd: o.amount_usd ? Number(o.amount_usd) : null,
      probability: stageWeights.weightFor(o.partner_id ?? null, o.stage as Stage),
    })),
  );

  // The CRM tie-out total, by the existing canonical semantics: the latest reported row per
  // (company, opportunity name), open stages only, amounts present. Null when the org has no CRM
  // export at all — which is exactly what the previous `tieOut?.crmUsd ?? null` persisted.
  const { rows: crmRows } = await db.query<{ crm: string }>(
    `select sum(s.amount_usd) as crm
       from (select distinct on (company_id, lower(opportunity_name)) company_id, opportunity_name, amount_usd, stage
               from crm_snapshots where org_id = $1
              order by company_id, lower(opportunity_name), reported_at desc, id desc) s
      where s.stage not in ('closed_won', 'closed_lost') and s.amount_usd is not null`,
    [orgId],
  );
  const crmUsd = crmRows[0]?.crm == null ? null : Number(crmRows[0].crm);

  // Today's UTC row only, with explicit provenance, and FIRST WRITE WINS. `taken_on` comes from the
  // database in UTC, never from a caller and never from the session's timezone.
  await db.query(
    `insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd, source)
     values ($1, (now() at time zone 'utc')::date, $2, $3, $4, $5, 'scheduled_daily_v1')
     on conflict (org_id, taken_on) do nothing`,
    [orgId, openCount, openUsd, weightedUsd, crmUsd],
  );
}
