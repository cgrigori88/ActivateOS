import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";

export const dynamic = "force-dynamic";

/**
 * Outreach Analytics (Phase 9C): how the whole outreach program is performing —
 * the funnel from send to meeting, the weekly activity trend, the multi-touch
 * cadence, and the funnel cut by propensity band (does higher-propensity
 * targeting actually convert better?). Complements /insights, which is about
 * motion → revenue outcomes; this is about the outreach layer itself.
 */

interface Funnel {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  positive: number;
  meetings: number;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const sp = await searchParams;
  const windowDays = ["30", "90"].includes(sp.window ?? "") ? Number(sp.window) : null;
  const evWhere = windowDays ? `where occurred_at >= now() - interval '${windowDays} days'` : "";
  const pool = getPool();

  const [{ rows: eventAgg }, { rows: outcomeAgg }, { rows: trend }, { rows: cadence }, { rows: segments }, { rows: surges }] =
    await Promise.all([
      pool.query<{ sent: string; opened: string; clicked: string; replied: string }>(
        `select
           count(*) filter (where event_type = 'SENT') as sent,
           count(*) filter (where event_type = 'OPENED') as opened,
           count(*) filter (where event_type = 'CLICKED') as clicked,
           count(*) filter (where event_type = 'REPLIED') as replied
         from email_events ${evWhere}`,
      ),
      pool.query<{ positive: string; meetings: string }>(
        `select
           count(*) filter (where event_type = 'POSITIVE_RESPONSE') as positive,
           count(*) filter (where event_type = 'MEETING_BOOKED') as meetings
         from outcome_events ${evWhere}`,
      ),
      pool.query<{ wk: Date; sent: string; opened: string; replied: string }>(
        `select date_trunc('week', occurred_at) as wk,
                count(*) filter (where event_type = 'SENT') as sent,
                count(*) filter (where event_type = 'OPENED') as opened,
                count(*) filter (where event_type = 'REPLIED') as replied
         from email_events
         where occurred_at >= now() - interval '8 weeks'
         group by 1 order by 1`,
      ),
      pool.query<{ touch_no: number; total: string; sent: string; scheduled: string; pending: string }>(
        `select touch_no,
                count(*) as total,
                count(*) filter (where status = 'sent') as sent,
                count(*) filter (where status = 'scheduled') as scheduled,
                count(*) filter (where status in ('draft','approved','rejected')) as pending
         from campaign_touches group by touch_no order by touch_no`,
      ),
      pool.query<{ band: string; sent: string; opened: string; replied: string }>(
        `with latest as (
           select distinct on (company_id) company_id, band
           from propensity_scores order by company_id, computed_at desc
         )
         select coalesce(l.band, 'unscored') as band,
                count(*) filter (where e.event_type = 'SENT') as sent,
                count(*) filter (where e.event_type = 'OPENED') as opened,
                count(*) filter (where e.event_type = 'REPLIED') as replied
         from email_events e
         join messages m on m.id = e.message_id
         join communication_threads t on t.id = m.thread_id
         left join latest l on l.company_id = t.company_id
         ${windowDays ? `where e.occurred_at >= now() - interval '${windowDays} days'` : ""}
         group by 1`,
      ),
      pool.query<{ company_id: string; legal_name: string; payload: { clicks?: number; replies?: number; positive?: number } | null; occurred_at: Date }>(
        `select ie.company_id, c.legal_name, ie.payload, ie.occurred_at
         from interaction_events ie
         join companies c on c.id = ie.company_id
         where ie.type = 'ENGAGEMENT_SURGE'
         order by ie.occurred_at desc limit 12`,
      ),
    ]);

  const f: Funnel = {
    sent: Number(eventAgg[0]?.sent ?? 0),
    opened: Number(eventAgg[0]?.opened ?? 0),
    clicked: Number(eventAgg[0]?.clicked ?? 0),
    replied: Number(eventAgg[0]?.replied ?? 0),
    positive: Number(outcomeAgg[0]?.positive ?? 0),
    meetings: Number(outcomeAgg[0]?.meetings ?? 0),
  };
  const funnelSteps: { label: string; value: number; of: number }[] = [
    { label: "Sent", value: f.sent, of: f.sent },
    { label: "Opened", value: f.opened, of: f.sent },
    { label: "Clicked", value: f.clicked, of: f.opened },
    { label: "Replied", value: f.replied, of: f.opened },
    { label: "Positive", value: f.positive, of: f.replied },
    { label: "Meetings", value: f.meetings, of: f.positive },
  ];

  const trendMax = Math.max(1, ...trend.map((t) => Number(t.sent)));
  const cadenceMax = Math.max(1, ...cadence.map((c) => Number(c.total)));
  const bandOrder = ["very_high", "high", "medium", "low", "unscored"];
  const segRows = [...segments].sort((a, b) => bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band));

  const hasData = f.sent > 0 || cadence.length > 0;

  return (
    <main>
      <PageHeader
        title="Outreach analytics"
        subtitle="The outreach layer's own performance — funnel, trend, cadence, and conversion by propensity band."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="window" value={sp.window ?? "all"} label="Timeframe" options={[{ value: "all", label: "All time" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} />
        <span className="text-xs text-neutral-400">funnel &amp; segment conversion; the 8-week trend is fixed</span>
      </div>

      {!hasData && (
        <Card className="mb-6">
          <p className="text-sm text-neutral-500">
            No outreach activity yet. Compose and send a sequence on the{" "}
            <Link href="/campaigns" className="text-blue-700 hover:underline dark:text-blue-400">Campaigns</Link> page —
            every send, open, and reply lands here.
          </p>
        </Card>
      )}

      {/* Compelling events — engagement surges feeding the intelligence layer */}
      {surges.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Compelling events — engagement surges
          </h2>
          <div className="flex flex-wrap gap-2">
            {surges.map((s, i) => {
              const p = s.payload ?? {};
              const bits = [p.positive ? `${p.positive} positive` : null, p.replies ? `${p.replies} reply` : null, p.clicks ? `${p.clicks} click` : null].filter(Boolean).join(" · ");
              return (
                <Link
                  key={i}
                  href={`/accounts/${s.company_id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:hover:bg-amber-900"
                >
                  <span aria-hidden>⚡</span>
                  <span className="font-medium">{s.legal_name}</span>
                  <span className="text-xs text-amber-700 dark:text-amber-400">{bits || "engaged"}</span>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-neutral-400">
            Each surge lifts the account&apos;s momentum feature in propensity — engagement is scored, not just logged.
          </p>
        </Card>
      )}

      {/* Funnel */}
      <Card className="mb-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Outreach funnel</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {funnelSteps.map((s, i) => (
            <div key={s.label} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="tnum text-2xl font-semibold">{s.value.toLocaleString()}</div>
              <div className="text-xs text-neutral-500">{s.label}</div>
              {i > 0 && <div className="mt-1 text-[11px] text-neutral-400">{pct(s.value, s.of)} of prior</div>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity trend */}
        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Activity — last 8 weeks</h2>
          {trend.length === 0 ? (
            <p className="text-sm text-neutral-400">No activity in range.</p>
          ) : (
            <div className="flex items-end gap-2" style={{ height: 140 }}>
              {trend.map((t) => (
                <div key={t.wk.toString()} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full items-end justify-center gap-[2px]" style={{ height: 110 }}>
                    <span className="w-2 rounded-t bg-blue-600" style={{ height: `${(Number(t.sent) / trendMax) * 100}%` }} title={`${t.sent} sent`} />
                    <span className="w-2 rounded-t bg-sky-400" style={{ height: `${(Number(t.opened) / trendMax) * 100}%` }} title={`${t.opened} opened`} />
                    <span className="w-2 rounded-t bg-green-500" style={{ height: `${(Number(t.replied) / trendMax) * 100}%` }} title={`${t.replied} replied`} />
                  </div>
                  <span className="text-[9px] text-neutral-400">{new Date(t.wk).toISOString().slice(5, 10)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-4 text-[11px] text-neutral-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-600" /> sent</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400" /> opened</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-500" /> replied</span>
          </div>
        </Card>

        {/* Cadence */}
        <Card>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Multi-touch cadence</h2>
          {cadence.length === 0 ? (
            <p className="text-sm text-neutral-400">No touches composed yet.</p>
          ) : (
            <div className="space-y-2">
              {cadence.map((c) => (
                <div key={c.touch_no} className="flex items-center gap-3">
                  <span className="w-10 shrink-0 text-xs text-neutral-500">T{c.touch_no}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    <div className="flex h-full">
                      <div className="bg-green-500" style={{ width: `${(Number(c.sent) / cadenceMax) * 100}%` }} title={`${c.sent} sent`} />
                      <div className="bg-sky-400" style={{ width: `${(Number(c.scheduled) / cadenceMax) * 100}%` }} title={`${c.scheduled} scheduled`} />
                      <div className="bg-neutral-300 dark:bg-neutral-600" style={{ width: `${(Number(c.pending) / cadenceMax) * 100}%` }} title={`${c.pending} pending`} />
                    </div>
                  </div>
                  <span className="tnum w-8 text-right text-xs text-neutral-500">{c.total}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-4 text-[11px] text-neutral-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-500" /> sent</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400" /> scheduled</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-neutral-300 dark:bg-neutral-600" /> pending</span>
          </div>
        </Card>
      </div>

      {/* Funnel by segment */}
      <Card className="mt-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Conversion by propensity band</h2>
        {segRows.length === 0 ? (
          <p className="text-sm text-neutral-400">No sends to segment yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th className="text-right">Sent</th>
                  <th className="text-right">Opened</th>
                  <th className="text-right">Open rate</th>
                  <th className="text-right">Replied</th>
                  <th className="text-right">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {segRows.map((s) => {
                  const sent = Number(s.sent), opened = Number(s.opened), replied = Number(s.replied);
                  return (
                    <tr key={s.band}>
                      <td className="font-medium capitalize">{s.band.replace(/_/g, " ")}</td>
                      <td className="tnum text-right">{sent}</td>
                      <td className="tnum text-right text-neutral-500">{opened}</td>
                      <td className="tnum text-right">{pct(opened, sent)}</td>
                      <td className="tnum text-right text-neutral-500">{replied}</td>
                      <td className="tnum text-right">{pct(replied, sent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-neutral-400">
          If higher bands don&apos;t convert better, propensity needs recalibration — this table is the feedback signal.
        </p>
      </Card>
    </main>
  );
}
