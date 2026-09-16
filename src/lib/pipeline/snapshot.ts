import type { Pool, PoolClient } from "pg";
import { weightedPipelineValue } from "@/lib/opportunities/lifecycle";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import type { Stage } from "@/lib/opportunities/lifecycle";

type Db = Pool | PoolClient;

/**
 * The canonical daily pipeline snapshot writer (D-P1).
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
 * Deliberately unchanged: the canonical business rules (what counts as open, how amounts aggregate,
 * the stage-weight curve with per-partner overrides, the CRM tie-out) and the read-triggered write
 * ("history accrues just by looking"). Only today's row is ever written — `taken_on` is the database's
 * `now()::date` and is never caller-supplied — so prior-date rows are immutable by construction.
 *
 * CONCURRENCY. Two requests may still race on the primary key, but because every writer recomputes
 * the SAME canonical state, every racing write carries identical values. Last-write-wins becomes
 * harmless and the upsert is genuinely idempotent; no locking is needed.
 */
export async function upsertCanonicalPipelineSnapshot(db: Db, orgId: string): Promise<void> {
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

  // Today's row only. `taken_on` comes from the database, never from a caller.
  await db.query(
    `insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd)
     values ($1, now()::date, $2, $3, $4, $5)
     on conflict (org_id, taken_on) do update
       set open_count = excluded.open_count, open_usd = excluded.open_usd,
           weighted_usd = excluded.weighted_usd, crm_usd = excluded.crm_usd`,
    [orgId, openCount, openUsd, weightedUsd, crmUsd],
  );
}
