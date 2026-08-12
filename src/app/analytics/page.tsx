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

  const [{ rows: companyRows }, { rows: outcomeRows }, { rows: drRows }, { rows: valueRows }, { rows: touchRows }, { rows: dailyRows }, { rows: segments }, { rows: surges }] =
    await Promise.all([
      // Per-account funnel position (+ raw email counts for the Sent bar).
      pool.query<{ company_id: string; sent_ct: string; opened_ct: string; replied_ct: string }>(
        `select t.company_id,
                count(*) filter (where e.event_type = 'SENT') as sent_ct,
                count(*) filter (where e.event_type = 'OPENED') as opened_ct,
                count(*) filter (where e.event_type = 'REPLIED') as replied_ct
         from email_events e
         join messages m on m.id = e.message_id
         join communication_threads t on t.id = m.thread_id
         ${windowDays ? `where e.occurred_at >= now() - interval '${windowDays} days'` : ""}
         group by t.company_id`,
      ),
      pool.query<{ company_id: string; event_type: string }>(
        `select distinct company_id, event_type from outcome_events
         where event_type in ('POSITIVE_RESPONSE','NEGATIVE_RESPONSE','MEETING_BOOKED')
         ${windowDays ? `and occurred_at >= now() - interval '${windowDays} days'` : ""}`,
      ),
      pool.query<{ company_id: string }>(
        `select distinct company_id from deal_registrations
         where status in ('submitted','approved')
         ${windowDays ? `and created_at >= now() - interval '${windowDays} days'` : ""}`,
      ),
      // Associated pipeline per account (open + won — what the cohort is worth).
      pool.query<{ company_id: string; v: string }>(
        `select company_id, sum(amount_usd) as v from opportunities
         where stage <> 'closed_lost' and amount_usd is not null group by company_id`,
      ),
      // Sent vs responded, by touch — a touch "responded" if its message got a reply.
      pool.query<{ touch_no: number; sent: string; responded: string }>(
        `select t.touch_no,
                count(distinct t.id) filter (where t.status = 'sent') as sent,
                count(distinct t.id) filter (where e.id is not null) as responded
         from campaign_touches t
         left join email_events e on e.message_id = t.message_id and e.event_type = 'REPLIED'
         group by t.touch_no order by t.touch_no`,
      ),
      // Daily activity, fixed 28-day window.
      pool.query<{ d: string; sent: string; opened: string; replied: string }>(
        `select date_trunc('day', occurred_at)::date::text as d,
                count(*) filter (where event_type = 'SENT') as sent,
                count(*) filter (where event_type = 'OPENED') as opened,
                count(*) filter (where event_type = 'REPLIED') as replied
         from email_events
         where occurred_at >= now() - interval '28 days'
         group by 1 order by 1`,
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

  // ── Account-level funnel cohorts ──────────────────────────────────────────
  const emailsSent = companyRows.reduce((s, r) => s + Number(r.sent_ct), 0);
  const sentSet = new Set(companyRows.filter((r) => Number(r.sent_ct) > 0).map((r) => r.company_id));
  const openedSet = new Set(companyRows.filter((r) => Number(r.opened_ct) > 0).map((r) => r.company_id));
  const repliedSet = new Set(companyRows.filter((r) => Number(r.replied_ct) > 0).map((r) => r.company_id));
  const positiveSet = new Set(outcomeRows.filter((r) => r.event_type === "POSITIVE_RESPONSE").map((r) => r.company_id));
  const negativeSet = new Set(outcomeRows.filter((r) => r.event_type === "NEGATIVE_RESPONSE").map((r) => r.company_id));
  const meetingSet = new Set(outcomeRows.filter((r) => r.event_type === "MEETING_BOOKED").map((r) => r.company_id));
  const neutralSet = new Set([...repliedSet].filter((id) => !positiveSet.has(id) && !negativeSet.has(id)));
  const drSet = new Set(drRows.map((r) => r.company_id));

  const valueOf = new Map(valueRows.map((r) => [r.company_id, Number(r.v)]));
  const usd = (set: Set<string>) => [...set].reduce((s, id) => s + (valueOf.get(id) ?? 0), 0);
  const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

  // Per-stage colors are semantic and row-labeled (identity comes from the row,
  // not a series legend). In-bar text is white on these fills in both modes.
  const stages: { key: string; label: string; set: Set<string>; extra?: string; fill: string }[] = [
    { key: "sent", label: "Sent", set: sentSet, extra: `${emailsSent} email${emailsSent === 1 ? "" : "s"}`, fill: "#404040" },
    { key: "opened", label: "Opened", set: openedSet, fill: "#2563eb" },
    { key: "replied", label: "Replied", set: repliedSet, fill: "#0d9488" },
    { key: "positive", label: "Positive", set: positiveSet, fill: "#16a34a" },
    { key: "neutral", label: "Neutral", set: neutralSet, fill: "#ca8a04" },
    { key: "negative", label: "Negative", set: negativeSet, fill: "#dc2626" },
    { key: "meeting", label: "Meeting", set: meetingSet, fill: "#d97706" },
    { key: "dr", label: "Deal reg", set: drSet, fill: "#7c3aed" },
  ];
  const cohort = Math.max(1, sentSet.size);
  const conv = (a: Set<string>, b: Set<string>) => (a.size > 0 ? Math.round((b.size / a.size) * 100) : null);
  const figures: { label: string; value: number | null; tone: string }[] = [
    { label: "sent → opened", value: conv(sentSet, openedSet), tone: "text-blue-700 dark:text-blue-400" },
    { label: "opened → replied", value: conv(openedSet, repliedSet), tone: "text-teal-700 dark:text-teal-400" },
    { label: "replied → positive", value: conv(repliedSet, positiveSet), tone: "text-green-700 dark:text-green-400" },
    { label: "positive → meeting", value: conv(positiveSet, meetingSet), tone: "text-amber-700 dark:text-amber-400" },
    { label: "meeting → deal reg", value: conv(meetingSet, drSet), tone: "text-violet-700 dark:text-violet-400" },
  ];

  // ── Touch + daily-trend series (palette validated light+dark: amber/blue/green) ──
  const touches = touchRows.map((t) => ({ no: t.touch_no, sent: Number(t.sent), responded: Number(t.responded) }));
  const touchMax = Math.max(1, ...touches.map((t) => t.sent));

  const dayMap = new Map(dailyRows.map((r) => [r.d, { sent: Number(r.sent), opened: Number(r.opened), replied: Number(r.replied) }]));
  const days: { d: string; sent: number; opened: number; replied: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ d, ...(dayMap.get(d) ?? { sent: 0, opened: 0, replied: 0 }) });
  }
  const trendMax = Math.max(1, ...days.flatMap((x) => [x.sent, x.opened, x.replied]));
  const SERIES: { key: "sent" | "opened" | "replied"; label: string; stroke: string }[] = [
    { key: "sent", label: "Sent", stroke: "#d97706" },
    { key: "opened", label: "Opened", stroke: "#2563eb" },
    { key: "replied", label: "Replied", stroke: "#16a34a" },
  ];
  const W = 640, H = 170, PL = 10, PR = 10, PT = 14, PB = 22;
  const px = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, days.length - 1);
  const py = (v: number) => PT + (1 - v / trendMax) * (H - PT - PB);

  const bandOrder = ["very_high", "high", "medium", "low", "unscored"];
  const segRows = [...segments].sort((a, b) => bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band));

  const hasData = emailsSent > 0 || touches.length > 0;

  return (
    <main>
      <PageHeader
        title="Outreach analytics"
        subtitle="The outreach layer's own performance — funnel, trend, cadence, and conversion by propensity band."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="window" value={sp.window ?? "all"} label="Timeframe" options={[{ value: "all", label: "All time" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} />
        <span className="text-xs text-neutral-400">funnel &amp; segment conversion; the daily trend is fixed at 28 days</span>
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

      {/* Funnel — account cohorts as bars, $ of associated pipeline on the right */}
      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Outreach funnel</h2>
          <span className="text-[11px] text-neutral-400">bar = % of contacted accounts · right = associated pipeline $</span>
        </div>
        <div className="space-y-1.5">
          {stages.map((s) => {
            const n = s.set.size;
            const w = Math.max(n > 0 ? 1.5 : 0, Math.round((n / cohort) * 100));
            const inBar = w >= 28;
            const label = `${n} account${n === 1 ? "" : "s"}${s.extra ? ` · ${s.extra}` : ""}`;
            return (
              <div key={s.key} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-xs text-neutral-500">{s.label}</span>
                <div className="relative h-6 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                  <div className="flex h-full items-center rounded" style={{ width: `${w}%`, backgroundColor: s.fill }} title={`${s.label}: ${label}`}>
                    {inBar && <span className="truncate px-2 text-[11px] font-medium text-white">{label}</span>}
                  </div>
                  {!inBar && (
                    <span className="absolute top-1/2 -translate-y-1/2 text-[11px] font-medium text-neutral-600 dark:text-neutral-300" style={{ left: `calc(${w}% + 8px)` }}>
                      {label}
                    </span>
                  )}
                </div>
                <span className="tnum w-16 shrink-0 text-right text-xs font-medium">{money(usd(s.set))}</span>
                <span className="tnum w-10 shrink-0 text-right text-[11px] text-neutral-400">{Math.round((n / cohort) * 100)}%</span>
              </div>
            );
          })}
        </div>
        {/* Conversion figures — the numbers a user actually retells */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-3 lg:grid-cols-5 dark:border-neutral-800">
          {figures.map((f) => (
            <div key={f.label} className="text-center">
              <div className={`tnum text-2xl font-bold ${f.tone}`}>{f.value == null ? "—" : `${f.value}%`}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">{f.label}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Multi-touch: sent vs responded, by touch */}
        <Card>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Multi-touch cadence</h2>
            <span className="flex gap-3 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-600" /> Sent</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-600" /> Responded</span>
            </span>
          </div>
          <p className="mb-3 text-xs text-neutral-500">Sent vs responded, by touch — which step in the sequence actually earns replies.</p>
          {touches.length === 0 ? (
            <p className="text-sm text-neutral-400">No touches composed yet.</p>
          ) : (
            <div className="flex items-end justify-around gap-4" style={{ height: 170 }}>
              {touches.map((t) => {
                const rate = t.sent > 0 ? Math.round((t.responded / t.sent) * 100) : null;
                return (
                  <div key={t.no} className="flex h-full flex-1 flex-col items-center justify-end">
                    <div className="flex w-full max-w-[7rem] flex-1 items-end justify-center gap-1">
                      <div className="flex w-1/2 flex-col items-center justify-end self-stretch">
                        <span className="tnum mb-0.5 text-[10px] text-neutral-500">{t.sent}</span>
                        <div className="w-full rounded-t bg-blue-600" style={{ height: `${(t.sent / touchMax) * 100}%`, minHeight: t.sent > 0 ? 3 : 0 }} title={`Touch ${t.no}: ${t.sent} sent`} />
                      </div>
                      <div className="flex w-1/2 flex-col items-center justify-end self-stretch">
                        <span className="tnum mb-0.5 text-[10px] text-neutral-500">{t.responded}</span>
                        <div className="w-full rounded-t bg-green-600" style={{ height: `${(t.responded / touchMax) * 100}%`, minHeight: t.responded > 0 ? 3 : 0 }} title={`Touch ${t.no}: ${t.responded} responded`} />
                      </div>
                    </div>
                    <div className="mt-1.5 text-center">
                      <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">Touch {t.no}</div>
                      <div className="tnum text-[10px] text-neutral-400">{rate == null ? "—" : `${rate}%`}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Daily activity trend — 28 days of sends / opens / replies */}
        <Card>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Activity trend</h2>
            <span className="text-[11px] text-neutral-400">{days[0]?.d} → {days[days.length - 1]?.d}</span>
          </div>
          <p className="mb-2 text-xs text-neutral-500">Daily sends · opens · replies — hover a point for the day&apos;s exact counts.</p>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily sends, opens and replies over the last 28 days">
            {/* recessive baseline + midline */}
            <line x1={PL} x2={W - PR} y1={py(0)} y2={py(0)} className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth="1" />
            <line x1={PL} x2={W - PR} y1={py(trendMax / 2)} y2={py(trendMax / 2)} className="stroke-neutral-100 dark:stroke-neutral-800/60" strokeWidth="1" />
            {SERIES.map((s) => (
              <polyline
                key={s.key}
                fill="none"
                stroke={s.stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={days.map((x, i) => `${px(i)},${py(x[s.key])}`).join(" ")}
              />
            ))}
            {/* hover targets: one invisible fat dot per day per series, native tooltip */}
            {SERIES.map((s) =>
              days.map((x, i) => (
                <circle key={`${s.key}:${x.d}`} cx={px(i)} cy={py(x[s.key])} r="8" fill="transparent">
                  <title>{`${x.d} · ${s.label}: ${x[s.key]}`}</title>
                </circle>
              )),
            )}
            {/* visible dots only where there is activity, ringed to separate overlaps */}
            {SERIES.map((s) =>
              days.map((x, i) =>
                x[s.key] > 0 ? (
                  <circle key={`v${s.key}:${x.d}`} cx={px(i)} cy={py(x[s.key])} r="3" fill={s.stroke} className="stroke-white dark:stroke-neutral-900" strokeWidth="1.5" pointerEvents="none" />
                ) : null,
              ),
            )}
            {/* peak label — the one number worth printing */}
            {(() => {
              let best = { v: 0, i: 0, s: SERIES[0] };
              for (const s of SERIES) days.forEach((x, i) => { if (x[s.key] > best.v) best = { v: x[s.key], i, s }; });
              return best.v > 0 ? (
                <text x={px(best.i)} y={py(best.v) - 8} textAnchor="middle" fontSize="10" fontWeight="600" className="fill-neutral-600 dark:fill-neutral-300">
                  {best.v}
                </text>
              ) : null;
            })()}
            {/* date ticks */}
            {days.map((x, i) =>
              i % 4 === 0 ? (
                <text key={x.d} x={px(i)} y={H - 6} textAnchor="middle" fontSize="9" className="fill-neutral-400">
                  {x.d.slice(5)}
                </text>
              ) : null,
            )}
          </svg>
          <div className="mt-2 flex gap-4 text-[11px] text-neutral-500">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.stroke }} /> {s.label}</span>
            ))}
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
