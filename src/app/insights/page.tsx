import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { calibrateStages, editIntensity } from "@/lib/insights/calibration";
import { computeFunnel } from "@/lib/insights/funnel";
import { STAGES, type Stage } from "@/lib/opportunities/lifecycle";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { Bento, Card, PageHeader } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { saveStageWeightsAction, setTriggerEnabledAction } from "./actions";
import { TRIGGER_CATALOG, enabledTriggers } from "@/lib/triggers/catalog";

export const dynamic = "force-dynamic";

/**
 * Insights (BLUEPRINT Phase 7): what the outcome log says about how the
 * machine is performing — funnel conversion, declared-vs-observed stage
 * probabilities, source predictive value, agent spend, and how heavily
 * humans edit AI drafts. Every number reproducible from stored events.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ wscope?: string }>;
}) {
  const sp = await searchParams;
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  const triggersOn = await enabledTriggers(pool, orgId);

  // Editable stage weights (0036): the calibration card is also the editor.
  const { rows: partnerRows } = await pool.query<{ id: string; name: string }>(
    `select id, name from partners where org_id = $1 order by name`,
    [orgId],
  );
  const stageWeights = await loadStageWeights(pool, orgId);
  const wscope = partnerRows.some((p) => p.id === sp.wscope) ? sp.wscope! : "";
  const scopeCurve = stageWeights.curveFor(wscope || null);
  const defaultCurve = stageWeights.curveFor(null);

  const [{ rows: events }, { rows: closed }, { rows: edits }, { rows: replies }] =
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
        `select raw_output->>'response_type' as response_type, count(*) as n
         from agent_runs where workflow = 'conversation'
         group by 1 order by 2 desc`,
      ),
    ]);

  const funnel = computeFunnel(events);
  const maxCount = Math.max(1, ...funnel.map((s) => s.count));
  const calibration = calibrateStages(
    closed.map((o) => ({ stagesReached: o.stages as Stage[], won: o.won })),
    scopeCurve,
  );
  const intensity = editIntensity(
    edits.map((e) => ({ editDistance: Number(e.edit_distance), draftLength: Number(e.draft_length) })),
  );
  const closedN = closed.length;
  const wonN = closed.filter((o) => o.won).length;
  const winRate = closedN > 0 ? Math.round((wonN / closedN) * 100) : null;

  return (
    <main>
      <PageHeader
        title="Insights"
        subtitle="AI calibration — what the outcome log says. Declared assumptions stay visibly declared until observed data earns the right to replace them."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Bento label="closed deals" value={closedN} href="/pipeline" />
        <Bento label="win rate" value={winRate == null ? "—" : `${winRate}%`} subs={[`${wonN} won`]} />
        <Bento label="deals won" value={wonN} href="/pipeline?stage=closed_won" />
        <Bento label="edit intensity" value={intensity ?? "—"} subs={["0 sent as-is · 1 rewritten"]} />
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Stage probability calibration
          </h2>
          <QuerySelect
            param="wscope"
            value={wscope || "all"}
            label="Weights for"
            options={[
              { value: "all", label: "Default (all partners)" },
              ...partnerRows.map((p) => ({
                value: p.id,
                label: stageWeights.overriddenPartnerIds.includes(p.id) ? `${p.name} · custom` : p.name,
              })),
            ]}
          />
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          Declared weights vs observed win rates. These weights drive the weighted pipeline
          everywhere it appears — edit them below, per partner if their funnel genuinely converts
          differently. Observed shows only past 10 closed deals per stage; divergence beyond ±15
          points flags a human review — never a silent weight update.
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

        {/* The editor — same card, so declared numbers and their controls live together. */}
        <details className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            Edit weights — {wscope ? partnerRows.find((p) => p.id === wscope)?.name : "default (all partners)"}
          </summary>
          <form action={saveStageWeightsAction} className="mt-3">
            <input type="hidden" name="scope" value={wscope} />
            <div className="flex flex-wrap items-end gap-3">
              {STAGES.map((s) => (
                <label key={s} className="text-sm">
                  <span className="mb-1 block text-xs text-neutral-500">{s.replace(/_/g, " ")} %</span>
                  <input
                    name={`w_${s}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={Math.round(scopeCurve[s] * 100)}
                    className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm tnum dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              ))}
              <button className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
                Save weights
              </button>
              <button
                name="reset"
                value="1"
                formNoValidate
                className="text-sm font-medium text-neutral-500 hover:underline"
              >
                Reset to {wscope ? "org default" : "declared v1"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              {wscope
                ? `Overrides apply only to deals attributed to this partner; unset stages inherit the org default (${STAGES.map((s) => `${Math.round(defaultCurve[s] * 100)}%`).join(" / ")}).`
                : "The org default applies to every deal without a partner-specific override."}{" "}
              Weighted pipeline on the Pipeline room recalculates immediately.
            </p>
          </form>
        </details>
      </Card>

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

      {/* Attention triggers (task #83): the named catalog of deterministic
          "this deserves attention" rules, each with an org-level switch. */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Attention triggers
        </h2>
        <p className="mb-3 text-sm text-neutral-500">
          Every rule that raises an account for attention, by name. Switch one
          off and it stops running everywhere it&rsquo;s surfaced — no hidden
          heuristics.
        </p>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {TRIGGER_CATALOG.map((t) => {
            const isOn = triggersOn.has(t.key);
            return (
              <li key={t.key} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.label}</span>
                    <span
                      className={
                        isOn
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }
                    >
                      {isOn ? "on" : "off"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-500">{t.description}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">Shows up in: {t.surfaces.join(" · ")}</p>
                </div>
                <form action={setTriggerEnabledAction} className="shrink-0 pt-0.5">
                  <input type="hidden" name="trigger" value={t.key} />
                  <input type="hidden" name="enabled" value={isOn ? "0" : "1"} />
                  <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                    {isOn ? "Turn off" : "Turn on"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>
    </main>
  );
}
