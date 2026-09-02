import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { partnerActivationHeadlines } from "@/lib/partners/intelligence";
import { calibrateStages, editIntensity } from "@/lib/insights/calibration";
import { computeFunnel } from "@/lib/insights/funnel";
import { STAGES, type Stage } from "@/lib/opportunities/lifecycle";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { Bento, Card, PageHeader, SectionHeading, Disclosure, SummaryBand } from "@/components/ui";
import { sourceOutcomeAttribution } from "@/lib/opportunities/autopsy";
import { QuerySelect } from "@/components/query-select";
import { saveStageWeightsAction, setTriggerEnabledAction } from "./actions";
import { TRIGGER_CATALOG, enabledTriggers } from "@/lib/triggers/catalog";
import { buttonClass } from "@/components/ui";

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
  const { triggersOn, partnerRows, stageWeights, events, closed, edits, replies, attribution, canonicalOutcomes, partnerHeadlines } =
    await withTenant(async (db, orgId) => {
      const triggersOn = await enabledTriggers(db, orgId);
      // Partner activation-vs-presence (P1B): separate truths per partner — no leaderboard score.
      const partnerHeadlines = await partnerActivationHeadlines(db, orgId);

      // Editable stage weights (0036): the calibration card is also the editor.
      const { rows: partnerRows } = await db.query<{ id: string; name: string }>(
        `select id, name from partners where org_id = $1 order by name`,
        [orgId],
      );
      const stageWeights = await loadStageWeights(db, orgId);

      const [{ rows: events }, { rows: closed }, { rows: edits }, { rows: replies }] =
        await Promise.all([
          db.query(`select event_type, motion_id from outcome_events`),
          db.query(
            `select o.id, o.stage = 'closed_won' as won,
                    coalesce(array_agg(t.to_stage) filter (where t.to_stage not in ('closed_won','closed_lost')), '{}') as stages
             from opportunities o
             left join opportunity_stage_transitions t on t.opportunity_id = o.id
             where o.stage in ('closed_won','closed_lost')
             group by o.id`,
          ),
          db.query(`select edit_distance, length(ai_original) as draft_length from message_edits`),
          db.query(
            `select raw_output->>'response_type' as response_type, count(*) as n
             from agent_runs where workflow = 'conversation'
             group by 1 order by 2 desc`,
          ),
        ]);

      // Source→outcome attribution (slice E): which evidence sources sat behind
      // won vs lost deals. Early-sample honesty is part of the feature.
      const attribution = await sourceOutcomeAttribution(db, orgId);

      // Canonical outcome rollup (Phase B): terminal pursuit_outcomes by attribution class — the
      // learning half made visible. Honest about a small sample; UNKNOWN shown as UNKNOWN.
      const { rows: canonicalOutcomes } = await db.query<{ outcome_label: string; cls: string; n: string; v: string | null }>(
        `select o.outcome_label, coalesce(a.human_override_class, a.attribution_class, 'NONE') as cls,
                count(*)::text n, sum(o.value_amount) v
           from pursuit_outcomes o left join attribution a on a.id = o.attribution_id
          where o.org_id = $1 and o.is_terminal
          group by 1, 2 order by 1, 2`, [orgId]);

      return { triggersOn, partnerRows, stageWeights, events, closed, edits, replies, attribution, canonicalOutcomes, partnerHeadlines };
    });

  const wscope = partnerRows.some((p) => p.id === sp.wscope) ? sp.wscope! : "";
  const scopeCurve = stageWeights.curveFor(wscope || null);
  const defaultCurve = stageWeights.curveFor(null);

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

  const attributionDeals = attribution.reduce((s_, a) => Math.max(s_, a.wonDeals + a.lostDeals), 0);

  // Canonical outcome rollup (Phase B): won/lost/no-decision by attribution class.
  const canonicalWon = canonicalOutcomes.filter((o) => o.outcome_label === "CLOSED_WON");
  const canonicalTotal = canonicalOutcomes.reduce((s_, o) => s_ + Number(o.n), 0);
  const byClass = (() => {
    const m = new Map<string, number>();
    for (const o of canonicalWon) m.set(o.cls, (m.get(o.cls) ?? 0) + Number(o.n));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();


  return (
    <main>
      <PageHeader
        title="Insights"
        subtitle="What the outcome log says. Declared assumptions stay declared until data replaces them."
      />

      <SummaryBand className="mb-6">
        <Bento label="closed deals" value={closedN} href="/pipeline" />
        <Bento label="win rate" value={winRate == null ? "—" : `${winRate}%`} subs={[`${wonN} won`]} />
        <Bento label="deals won" value={wonN} intent="positive" href="/pipeline?stage=closed_won" />
        <Bento label="edit intensity" value={intensity ?? "—"} subs={["0 sent as-is · 1 rewritten"]} />
      </SummaryBand>

      {/* Canonical outcome rollup (Phase B): terminal pursuit_outcomes by attribution class. */}
      {canonicalTotal > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">Canonical outcomes · attribution</h2>
            <span className="text-body text-neutral-400">{canonicalTotal} terminal outcome{canonicalTotal === 1 ? "" : "s"} — small sample; honest by design</span>
          </div>
          <div className="flex flex-wrap gap-2 text-copy">
            {byClass.length === 0 ? (
              <span className="text-neutral-500">No wins recorded yet.</span>
            ) : byClass.map(([cls, n]) => (
              <span key={cls} className="inline-flex items-center gap-1.5 rounded-control bg-neutral-100 px-2.5 py-1 dark:bg-neutral-800">
                <b>{n}</b> won <span className="text-neutral-500">·</span>
                <span className={cls === "UNKNOWN" ? "font-semibold text-amber-700 dark:text-amber-400" : "font-medium text-neutral-700 dark:text-neutral-300"}>{cls}</span>
              </span>
            ))}
          </div>
          <Disclosure summary="Outcome ≠ Attribution" className="mt-2">
            The count is what happened; the class is PursuitOS’s evidence-bound claim about who moved
            it. UNKNOWN is preserved where no partner route was selected.
          </Disclosure>
        </Card>
      )}

      {/* Partner activation vs presence (P1B.3): overlap ≠ activation ≠ execution — the disagreement
          IS the insight. Latency shows median + sample or UNKNOWN; no composite score, no leaderboard. */}
      {partnerHeadlines.length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">Partner activation vs presence</h2>
            <span className="text-body text-neutral-400">separate truths — presence, activation, acceptance, canonical outcomes</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-body">
              <thead>
                <tr className="text-left text-micro font-bold uppercase tracking-wide text-neutral-500">
                  <th className="px-2 py-1.5">Partner</th><th className="px-2 py-1.5">Overlap</th><th className="px-2 py-1.5">Selected routes</th>
                  <th className="px-2 py-1.5">Teams accepted</th><th className="px-2 py-1.5">Pending</th><th className="px-2 py-1.5">Median accept</th><th className="px-2 py-1.5">Canonical wins</th>
                </tr>
              </thead>
              <tbody>
                {partnerHeadlines.map((h) => (
                  <tr key={h.partnerId} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td className="px-2 py-1.5 font-semibold"><Link href={`/partners/${h.partnerId}`} className="hover:underline">{h.name}</Link></td>
                    <td className="tnum px-2 py-1.5">{h.overlap}</td>
                    <td className="tnum px-2 py-1.5">{h.selected}</td>
                    <td className="tnum px-2 py-1.5">{h.accepted}</td>
                    <td className="tnum px-2 py-1.5">{h.pending > 0 ? <span style={{ color: "var(--color-timing)" }}>{h.pending}</span> : 0}</td>
                    <td className="tnum px-2 py-1.5">{h.medianAcceptDays == null ? <span className="text-neutral-400">UNKNOWN</span> : <>{h.medianAcceptDays}d <span className="text-neutral-400">(n={h.acceptSample})</span></>}</td>
                    <td className="tnum px-2 py-1.5">{h.sample > 0 ? <>{h.won} of {h.sample}</> : <span className="text-neutral-400">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <h2 className="mb-3 text-copy font-semibold uppercase tracking-wide text-neutral-500">
          Commercial funnel
        </h2>
        <div className="space-y-2">
          {funnel.map((s) => (
            <div key={s.key} className="flex items-center gap-3 text-copy">
              <span className="w-36 shrink-0 text-neutral-600 dark:text-neutral-400">
                {s.label}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded-inner bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${(s.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="tnum w-8 text-right font-semibold">{s.count}</span>
              <span className="tnum w-14 text-right text-body text-neutral-400">
                {s.conversion != null ? `${Math.round(s.conversion * 100)}%` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">
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
        <Disclosure summary="How these weights are used" className="mb-3">
          Declared weights vs observed win rates. These weights drive the weighted pipeline
          everywhere it appears — edit them below, per partner if their funnel genuinely converts
          differently. Observed shows only the past 10 closed deals per stage; divergence beyond ±15
          points flags a human review — never a silent weight update.
        </Disclosure>
        <table className="w-full text-copy">
          <thead>
            <tr className="text-left text-body uppercase tracking-wide text-neutral-400">
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
                    <span className="text-body text-neutral-400"> (need 10)</span>
                  )}
                  {c.divergent && <span className="ml-1 text-body font-semibold">review</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* The editor — same card, so declared numbers and their controls live together. */}
        <details className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-body font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            Edit weights — {wscope ? partnerRows.find((p) => p.id === wscope)?.name : "default (all partners)"}
          </summary>
          <form action={saveStageWeightsAction} className="mt-3">
            <input type="hidden" name="scope" value={wscope} />
            <div className="flex flex-wrap items-end gap-3">
              {STAGES.map((s) => (
                <label key={s} className="text-copy">
                  <span className="mb-1 block text-body text-neutral-500">{s.replace(/_/g, " ")} %</span>
                  <input
                    name={`w_${s}`}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={Math.round(scopeCurve[s] * 100)}
                    className="w-20 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy tnum dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              ))}
              <button className={buttonClass("primary", "sm")}>
                Save weights
              </button>
              <button
                name="reset"
                value="1"
                formNoValidate
                className={buttonClass("subtle", "md")}
              >
                Reset to {wscope ? "org default" : "declared v1"}
              </button>
            </div>
            <p className="mt-2 text-label text-neutral-400">
              {wscope
                ? `Overrides apply only to deals attributed to this partner; unset stages inherit the org default (${STAGES.map((s) => `${Math.round(defaultCurve[s] * 100)}%`).join(" / ")}).`
                : "The org default applies to every deal without a partner-specific override."}{" "}
              Weighted pipeline on the Pipeline room recalculates immediately.
            </p>
          </form>
        </details>
      </Card>

      <Card>
        <h2 className="mb-3 text-copy font-semibold uppercase tracking-wide text-neutral-500">
          Conversation outcomes
        </h2>
        {replies.length === 0 ? (
          <p className="text-copy text-neutral-500">No customer replies analyzed yet.</p>
        ) : (
          <ul className="space-y-1 text-copy">
            {replies.map((r) => (
              <li key={r.response_type} className="flex justify-between">
                <span>{(r.response_type ?? "unknown").toLowerCase().replace(/_/g, " ")}</span>
                <span className="tnum font-semibold">{r.n}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-neutral-100 pt-2 text-copy text-neutral-500 dark:border-neutral-800">
          Seller edit intensity:{" "}
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
            {intensity != null ? intensity : "no edited drafts yet"}
          </span>
          {intensity != null && <span className="text-body"> (0 = sent as drafted, 1 = rewritten)</span>}
        </p>
      </Card>

      {/* Source→outcome attribution (slice E) — the learning loop's first visible dividend. */}
      {attribution.length > 0 && (
        <Card className="mb-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">What sat behind the outcomes</h2>
            <span className="text-body text-neutral-400">early sample — {attributionDeals} closed deal{attributionDeals === 1 ? "" : "s"}; patterns firm up with volume</span>
          </div>
          <ul className="space-y-1 text-copy">
            {attribution.map((a) => (
              <li key={a.sourceType} className="flex items-center justify-between gap-3">
                <span className="font-mono text-body text-neutral-500">{a.sourceType}</span>
                <span className="tnum text-neutral-600 dark:text-neutral-300">
                  behind <b className="text-positive dark:text-green-400">{a.wonDeals} won</b> · <b className="text-red-700 dark:text-red-400">{a.lostDeals} lost</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-label text-neutral-400">
            Counts deals whose account carried verified claims from each source. With volume this
            becomes source predictive value — which telemetry actually forecasts wins.
          </p>
        </Card>
      )}

      {/* Attention triggers (task #83): the named catalog of deterministic
          "this deserves attention" rules, each with an org-level switch. */}
      <Card>
        <SectionHeading hint="Every rule that raises an account for attention, by name.">
          Attention triggers
        </SectionHeading>
        <Disclosure summary="What switching one off does" className="mb-3">
          Switch a rule off and it stops running everywhere it&rsquo;s surfaced — there are no
          hidden heuristics behind these.
        </Disclosure>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {TRIGGER_CATALOG.map((t) => {
            const isOn = triggersOn.has(t.key);
            return (
              <li key={t.key} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-copy font-medium">{t.label}</span>
                    <span
                      className={
                        isOn
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-label font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "rounded-full bg-neutral-100 px-2 py-0.5 text-label font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                      }
                    >
                      {isOn ? "on" : "off"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-copy text-neutral-500">{t.description}</p>
                  <p className="mt-0.5 text-label text-neutral-400">Shows up in: {t.surfaces.join(" · ")}</p>
                </div>
                <form action={setTriggerEnabledAction} className="shrink-0 pt-0.5">
                  <input type="hidden" name="trigger" value={t.key} />
                  <input type="hidden" name="enabled" value={isOn ? "0" : "1"} />
                  <button className={buttonClass("primary", "sm")}>
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
