import { getPool } from "@/db/client";
import { calibrateStages, editIntensity } from "@/lib/insights/calibration";
import { computeFunnel } from "@/lib/insights/funnel";
import type { Stage } from "@/lib/opportunities/lifecycle";
import { Bento, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Insights (BLUEPRINT Phase 7): what the outcome log says about how the
 * machine is performing — funnel conversion, declared-vs-observed stage
 * probabilities, source predictive value, agent spend, and how heavily
 * humans edit AI drafts. Every number reproducible from stored events.
 */
export default async function InsightsPage() {
  const pool = getPool();

  const [{ rows: events }, { rows: closed }, { rows: edits }, { rows: agents }, { rows: replies }] =
    await Promise.all([
      pool.query(`select event_type, motion_id from outcome_events`),
      pool.query(
        `select o.id, o.stage = 'closed_won' as won,
                coalesce(array_agg(t.to_stage) filter (where t.to_stage not in ('closed_won','closed_lost')), '{}') as stages
         from opportunities o
         left join opportunity_stage_transitions t on t.opportunity_id = o.id
         where o.stage in ('closed_won','closed_lost')
         group by o.id`,
      ),
      pool.query(`select edit_distance, length(ai_original) as draft_length from message_edits`),
      pool.query(
        `select workflow, count(*) as runs, sum(cost_usd) as cost,
                avg(latency_ms)::int as avg_latency
         from agent_runs where cost_usd is not null
         group by workflow order by cost desc`,
      ),
      pool.query(
        `select raw_output->>'response_type' as response_type, count(*) as n
         from agent_runs where workflow = 'conversation'
         group by 1 order by 2 desc`,
      ),
    ]);

  const funnel = computeFunnel(events);
  const maxCount = Math.max(1, ...funnel.map((s) => s.count));
  const calibration = calibrateStages(
    closed.map((o) => ({ stagesReached: o.stages as Stage[], won: o.won })),
  );
  const intensity = editIntensity(
    edits.map((e) => ({ editDistance: Number(e.edit_distance), draftLength: Number(e.draft_length) })),
  );
  const totalCost = agents.reduce((s, a) => s + Number(a.cost ?? 0), 0);
  const closedN = closed.length;
  const wonN = closed.filter((o) => o.won).length;
  const winRate = closedN > 0 ? Math.round((wonN / closedN) * 100) : null;
  const agentRuns = agents.reduce((s, a) => s + Number(a.runs ?? 0), 0);

  return (
    <main>
      <PageHeader
        title="Insights"
        subtitle="What the outcome log says. Declared assumptions stay visibly declared until observed data earns the right to replace them."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Bento label="closed deals" value={closedN} />
        <Bento label="win rate" value={winRate == null ? "—" : `${winRate}%`} subs={[`${wonN} won`]} />
        <Bento label="edit intensity" value={intensity ?? "—"} subs={["0 sent as-is · 1 rewritten"]} />
        <Bento label="AI runs" value={agentRuns} />
        <Bento label="AI spend" value={`$${totalCost.toFixed(2)}`} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Commercial funnel
        </h2>
        <div className="space-y-2">
          {funnel.map((s) => (
            <div key={s.key} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 text-neutral-600 dark:text-neutral-400">
                {s.label}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${(s.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="tnum w-8 text-right font-semibold">{s.count}</span>
              <span className="tnum w-14 text-right text-xs text-neutral-400">
                {s.conversion != null ? `${Math.round(s.conversion * 100)}%` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Stage probability calibration
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Declared v1 probabilities vs observed win rates. Observed shows only past 10 closed
          deals per stage; divergence beyond ±15 points flags a human review — never a silent
          weight update.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
              <th className="pb-1 font-medium">Stage</th>
              <th className="pb-1 font-medium">Declared</th>
              <th className="pb-1 font-medium">Observed</th>
              <th className="pb-1 font-medium">Sample</th>
            </tr>
          </thead>
          <tbody>
            {calibration.map((c) => (
              <tr key={c.stage} className={c.divergent ? "text-amber-700 dark:text-amber-400" : ""}>
                <td className="py-0.5">{c.stage.replace(/_/g, " ")}</td>
                <td className="tnum py-0.5">{Math.round(c.declared * 100)}%</td>
                <td className="tnum py-0.5">
                  {c.observed != null ? `${Math.round(c.observed * 100)}%` : "—"}
                </td>
                <td className="tnum py-0.5">
                  {c.sample}
                  {c.observed == null && c.sample > 0 && (
                    <span className="text-xs text-neutral-400"> (need 10)</span>
                  )}
                  {c.divergent && <span className="ml-1 text-xs font-semibold">review</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Conversation outcomes
          </h2>
          {replies.length === 0 ? (
            <p className="text-sm text-neutral-500">No customer replies analyzed yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {replies.map((r) => (
                <li key={r.response_type} className="flex justify-between">
                  <span>{(r.response_type ?? "unknown").toLowerCase().replace(/_/g, " ")}</span>
                  <span className="tnum font-semibold">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-2 text-sm text-neutral-500 dark:border-neutral-800">
            Seller edit intensity:{" "}
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {intensity != null ? intensity : "no edited drafts yet"}
            </span>
            {intensity != null && <span className="text-xs"> (0 = sent as drafted, 1 = rewritten)</span>}
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Agent spend
          </h2>
          <ul className="space-y-1 text-sm">
            {agents.map((a) => (
              <li key={a.workflow} className="flex justify-between">
                <span>
                  {a.workflow.replace(/_/g, " ")}{" "}
                  <span className="text-xs text-neutral-400">×{a.runs}</span>
                </span>
                <span className="tnum">
                  ${Number(a.cost).toFixed(3)}
                  <span className="ml-2 text-xs text-neutral-400">{a.avg_latency}ms</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-neutral-100 pt-2 text-sm dark:border-neutral-800">
            Total AI spend:{" "}
            <span className="tnum font-semibold">${totalCost.toFixed(2)}</span>
          </p>
        </Card>
      </div>
    </main>
  );
}
