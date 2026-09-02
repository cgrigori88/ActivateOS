import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { partnerActivationHeadlines } from "@/lib/partners/intelligence";
import { calibrateStages, editIntensity } from "@/lib/insights/calibration";
import { computeFunnel } from "@/lib/insights/funnel";
import { STAGES, type Stage } from "@/lib/opportunities/lifecycle";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { Bento, Card, PageHeader, SectionHeading, Disclosure, SummaryBand, BlockLabel } from "@/components/ui";
import { EvidenceModel } from "@/components/evidence-model";
import { RoomTabs } from "@/components/room-tabs";
import { sourceOutcomeAttribution } from "@/lib/opportunities/autopsy";
import { QuerySelect } from "@/components/query-select";
import { saveStageWeightsAction, setTriggerEnabledAction } from "./actions";
import { TRIGGER_CATALOG, enabledTriggers } from "@/lib/triggers/catalog";
import { buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Insights (Wave 5 §3) — what the outcome log says about how the machine is
 * performing: funnel conversion, declared-vs-observed stage probabilities,
 * source predictive value, and how heavily humans edit AI drafts. Every number
 * reproducible from stored events.
 *
 * WHAT WAS WRONG. The room was a wall of correct numbers with no reading. A
 * four-deal win rate sat in the same weight of type as a rule; a table of
 * declared-vs-observed probabilities said "review" without saying what a
 * reviewer would conclude; and a source attribution list showed "behind 2 won ·
 * 1 lost" with no statement of whether three deals mean anything. A number a
 * reader cannot weigh is not an insight, it is a measurement left on the floor.
 *
 * There was also a straightforward IA error: two observed measurements —
 * conversation outcomes and source attribution — sat underneath the "Declared
 * assumptions" heading, which claimed the opposite of what they are.
 *
 * WHAT IT DOES NOW. Each block carries a Reading: what was observed, what it
 * may suggest, how much confidence the sample supports, and what would
 * strengthen it. The confidence band is derived from the sample size alone and
 * says so — it is a statement about how much evidence there is, not a
 * statistical claim about the effect. Nothing is concluded that the counts do
 * not support, and where the sample is too thin the Reading says that instead
 * of offering an interpretation.
 *
 * Presentation only: no scoring, weighting or calibration logic changes.
 */

/** Sample-size bands. A statement about evidence volume, never about effect size. */
function band(n: number): { word: string; tone?: string } {
  if (n === 0) return { word: "no sample yet", tone: "var(--ink-faint)" };
  if (n < 10) return { word: "too thin to read", tone: "var(--color-accent-risk)" };
  if (n < 30) return { word: "provisional", tone: "var(--color-timing)" };
  return { word: "reasonable", tone: "var(--color-positive)" };
}

/**
 * The Reading: the four things a number needs before a person can act on it.
 * `suggests` is omitted deliberately when the sample cannot carry a reading —
 * an interpretation offered over four data points is worse than none.
 */
function Reading({
  suggests,
  n,
  unit,
  strengthen,
}: {
  suggests?: string;
  n: number;
  unit: string;
  strengthen: string;
}) {
  const b = band(n);
  return (
    <div className="mt-3 border-t pt-2.5 text-body" style={{ borderColor: "var(--border-subtle)" }}>
      <dl className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: "auto 1fr" }}>
        <dt className="text-label font-semibold uppercase tracking-[0.04em] ink-faint">Suggests</dt>
        <dd className="ink-soft">
          {suggests ?? (
            <span className="ink-muted">
              {n === 0
                ? `Nothing has been recorded here yet, so there is no direction to read.`
                : `${n} ${unit}${n === 1 ? "" : "s"} cannot carry a reading. The counts stand; the interpretation is withheld.`}
            </span>
          )}
        </dd>
        <dt className="text-label font-semibold uppercase tracking-[0.04em] ink-faint">Confidence</dt>
        <dd>
          <span className="font-semibold" style={{ color: b.tone }}>{b.word}</span>
          <span className="ink-muted"> — {n} {unit}{n === 1 ? "" : "s"} behind it</span>
        </dd>
        <dt className="text-label font-semibold uppercase tracking-[0.04em] ink-faint">Strengthen</dt>
        <dd className="ink-muted">{strengthen}</dd>
      </dl>
    </div>
  );
}

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

  // Readings that depend on the data are computed here so the JSX stays a layout.
  const unknownWins = byClass.find(([cls]) => cls === "UNKNOWN")?.[1] ?? 0;
  const funnelTotal = funnel.reduce((t, s) => t + s.count, 0);
  const biggestDrop = funnel
    .map((s, i) => ({ s, prev: funnel[i - 1], drop: i > 0 ? funnel[i - 1].count - s.count : 0 }))
    .filter((x) => x.prev && x.drop > 0)
    .sort((a, b) => b.drop - a.drop)[0];
  const divergent = calibration.filter((c) => c.divergent);
  const readable = calibration.filter((c) => c.observed != null);
  const attributionSpread = attribution.filter((a) => a.wonDeals + a.lostDeals > 0);
  const pendingReps = partnerHeadlines.filter((h) => h.pending > 0);
  const partnerSample = partnerHeadlines.reduce((t, h) => t + h.sample, 0);

  return (
    <main>
      <PageHeader
        title="Insights"
        subtitle="What the outcome log says. Declared assumptions stay declared until data replaces them."
      />
      {/* §11: Insights and Outreach analytics are the two halves of "what did we
          learn" — one from closed outcomes, one from what was sent. They were
          two unrelated rail entries. */}
      <RoomTabs tabs={[{ href: "/insights", label: "Insights" }, { href: "/analytics", label: "Outreach analytics" }]} />
      <EvidenceModel
        current="insights"
        steps={{ insights: { detail: `${closedN} closed deal${closedN === 1 ? "" : "s"} on record` } }}
      />

      {/* The single most important thing about this room is the size of what it
          is reading from. Stating it once up front is what stops every figure
          below from being read as a measurement. */}
      <Card className="mb-4">
        <p className="text-title font-semibold ink">
          {closedN === 0
            ? "Nothing has closed yet, so there is nothing to learn from."
            : `Everything here is read from ${closedN} closed deal${closedN === 1 ? "" : "s"}.`}
        </p>
        <p className="mt-1 text-body ink-muted">
          {closedN >= 30
            ? "That is enough history to treat the directions below as real, though not enough to treat any single figure as precise."
            : "That is a direction, not a measurement. Each block below states what it may suggest, how much the sample supports it, and what would make it firmer."}
        </p>
      </Card>

      <SummaryBand className="mb-6">
        <Bento label="closed deals" value={closedN} href="/pipeline" />
        <Bento label="win rate" value={winRate == null ? "—" : `${winRate}%`} subs={[`${wonN} won`]} />
        <Bento label="deals won" value={wonN} intent="positive" href="/pipeline?stage=closed_won" />
        <Bento label="edit intensity" value={intensity ?? "—"} subs={["0 sent as-is · 1 rewritten"]} />
      </SummaryBand>

      <SectionHeading hint="What the record says happened. Counts first, then what they may mean.">
        Observed outcomes
      </SectionHeading>

      {/* Canonical outcome rollup (Phase B): terminal pursuit_outcomes by attribution class. */}
      {canonicalTotal > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <BlockLabel className="mb-0">Canonical outcomes · attribution</BlockLabel>
            <span className="text-body text-neutral-400">{canonicalTotal} terminal outcome{canonicalTotal === 1 ? "" : "s"}</span>
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
            The count is what happened; the class is PursuitOS&rsquo;s evidence-bound claim about who moved
            it. UNKNOWN is preserved where no partner route was selected.
          </Disclosure>
          <Reading
            n={canonicalTotal}
            unit="terminal outcome"
            suggests={
              canonicalTotal === 0
                ? undefined
                : unknownWins > 0
                  ? `${unknownWins} of the recorded wins carry no attributable partner route. Either those deals genuinely ran direct, or a route was taken that nobody selected in the system — those are very different problems and the record cannot currently tell them apart.`
                  : "Every win recorded as a canonical outcome carries an attributable route, so the settlement ledger and the outcome log are telling the same story about the deals both of them see."
            }
            strengthen="Selecting a route on a pursuit before it closes — an outcome attributed after the fact is a reconstruction, not a record."
          />
        </Card>
      )}

      {/* Partner activation vs presence (P1B.3): overlap ≠ activation ≠ execution — the disagreement
          IS the insight. Latency shows median + sample or UNKNOWN; no composite score, no leaderboard. */}
      {partnerHeadlines.length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <BlockLabel className="mb-0">Partner activation vs presence</BlockLabel>
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
          <Reading
            n={partnerSample}
            unit="attributed deal"
            suggests={
              pendingReps.length > 0
                ? `${pendingReps.map((h) => h.name).join(", ")} ${pendingReps.length === 1 ? "has" : "have"} routes selected on our side that the partner has not accepted. Presence is not activation: an unaccepted route buys nothing, however large the overlap.`
                : "Every selected route has been accepted, so activation is keeping pace with presence."
            }
            strengthen="Enough accepted routes per partner to give median acceptance time a sample — the latency column is the one that separates an engaged partner from a listed one."
          />
        </Card>
      )}

      <Card className="mb-6">
        <BlockLabel>Commercial funnel</BlockLabel>
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
        <Reading
          n={funnelTotal}
          unit="recorded event"
          suggests={
            biggestDrop
              ? `The largest fall-off is between ${biggestDrop.prev.label.toLowerCase()} and ${biggestDrop.s.label.toLowerCase()} — ${biggestDrop.drop} of ${biggestDrop.prev.count}. If one stage is where the machine loses most of its work, that is the stage worth instrumenting before any other.`
              : undefined
          }
          strengthen="Events logged at every stage rather than at the ones that happen to have automation behind them — a stage that is never written to reads as a fall-off it did not cause."
        />
      </Card>

      {/* Source→outcome attribution (slice E) — the learning loop's first visible dividend. */}
      {attribution.length > 0 && (
        <Card className="mb-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <BlockLabel className="mb-0">What sat behind the outcomes</BlockLabel>
            <span className="text-body text-neutral-400">deals whose account carried verified claims from each source</span>
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
          <Reading
            n={attributionDeals}
            unit="closed deal"
            suggests={
              attributionDeals >= 10 && attributionSpread.length > 0
                ? "Sources are beginning to separate on outcome. Treat the ordering as a hypothesis about which telemetry forecasts wins, and test it before letting it change what gets collected."
                : undefined
            }
            strengthen="Closed deals, mostly. Below roughly ten per source a single lost deal reverses the ordering, which is why no source is ranked here yet."
          />
        </Card>
      )}

      <Card className="mb-6">
        <BlockLabel>Conversation outcomes</BlockLabel>
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
        <Reading
          n={edits.length}
          unit="edited draft"
          suggests={
            intensity == null
              ? undefined
              : intensity >= 0.5
                ? "Sellers are rewriting more of each draft than they keep. That is a verdict on the drafting, not on the seller — the skill behind these messages is the thing to change."
                : "Sellers are keeping most of what is drafted, which is the signal that the drafting is close enough to be worth reviewing rather than replacing."
          }
          strengthen="More edited drafts across more sellers. One seller's habits are not a measure of draft quality."
        />
      </Card>

      <SectionHeading hint="Numbers a human chose. They stay declared until enough outcomes replace them.">
        Declared assumptions
      </SectionHeading>

      <Card className="mb-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <BlockLabel className="mb-0">Stage probability calibration</BlockLabel>
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

        <Reading
          n={closedN}
          unit="closed deal"
          suggests={
            readable.length === 0
              ? undefined
              : divergent.length > 0
                ? `${divergent.map((c) => c.stage.replace(/_/g, " ")).join(", ")} ${divergent.length === 1 ? "is" : "are"} more than 15 points away from the declared weight. The weight is a human assumption and stays one until somebody changes it here — nothing recalibrates itself.`
                : "Where there is enough history to compare, the declared weights and observed outcomes agree. The assumptions are holding."
          }
          strengthen="Ten closed deals per stage. Until then the observed column is blank by design rather than filled with a number a reader would act on."
        />

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

      {/* Attention triggers (task #83): the named catalog of deterministic
          "this deserves attention" rules, each with an org-level switch. */}
      <SectionHeading hint="Deterministic rules, not a model. Each one is named and switchable.">
        What raises an account
      </SectionHeading>
      <Card>
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
                  <button className={buttonClass("secondary", "sm")}>
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
