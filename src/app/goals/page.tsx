import Link from "next/link";
import { Bento, Card, PageHeader, fieldClass, BlockLabel } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { listGoals, METRICS, METRIC_LABEL, formatMetric, type Goal } from "@/lib/goals/goals";
import { listTargets, type TargetRow } from "@/lib/goals/targets";
import { withTenant } from "@/lib/db/tenant";
import { createGoalAction, setGoalStatusAction, upsertTargetAction, deleteTargetAction } from "./actions";
import { formatMoney } from "@/lib/format/money";
import { buttonClass } from "@/components/ui";
import { OperatingModel } from "@/components/operating-model";
import { goalChain, goalBlockers, type GoalChain } from "@/lib/goals/chain";

export const dynamic = "force-dynamic";

/**
 * Goals (#55) — S.M.A.R.T. objectives whose progress is computed from the
 * motions & campaigns linked to them. Pace (progress vs time elapsed) turns each
 * target into an on-track / behind signal, and a due-window filter keeps the
 * view to what matters in the next 7 / 30 / 90 days.
 */

const PACE_TONE: Record<Goal["pace"], string> = {
  ahead: "bg-green-100 text-positive dark:bg-green-950 dark:text-green-300",
  on_track: "bg-blue-100 text-accent dark:bg-blue-950 dark:text-blue-300",
  behind: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  none: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};
const PACE_LABEL: Record<Goal["pace"], string> = { ahead: "Ahead", on_track: "On track", behind: "Behind", none: "No due date" };
const metricKind = (m: string) => METRICS.find((x) => x.key === m)?.kind ?? "count";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; due?: string }>;
}) {
  const sp = await searchParams;
  // RISK-1 adoption (task #67): all reads run under withTenant, which pins the
  // session to the caller's org. Inert on the owner connection; real isolation
  // once DATABASE_URL points at app_rw.
  const { all, targets, partnerRows, chains } = await withTenant(async (db, orgId) => {
    const all = await listGoals(db, orgId);
    // Wave 3 §3/§6: the chain behind each goal — which motions carry it, what
    // pipeline they have produced, and what is standing in the way. Walked from
    // existing foreign keys by one shared read model so Goals, Motions and
    // Pipeline cannot disagree about the spine.
    const chains = new Map<string, GoalChain>();
    for (const g of all) chains.set(g.id, await goalChain(db, g.id));
    return {
      all,
      targets: await listTargets(db, orgId),
      // org-scoped: the target-scope dropdown must not list other tenants' partners.
      partnerRows: (await db.query<{ id: string; name: string }>(
        `select id, name from partners where org_id = $1 order by name`,
        [orgId],
      )).rows,
      chains,
    };
  });
  const currentYear = new Date().getFullYear();

  const dueDays = ["7", "30", "90"].includes(sp.due ?? "") ? Number(sp.due) : null;
  const statusFilter = sp.status ?? "active"; // matches the select's default — bare /goals shows active goals
  const goals = all.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (dueDays != null) {
      if (g.daysLeft == null) return false;
      if (g.daysLeft < 0 || g.daysLeft > dueDays) return false;
    }
    return true;
  });

  const active = all.filter((g) => g.status === "active");
  const behind = active.filter((g) => g.pace === "behind").length;
  const achieved = all.filter((g) => g.status === "achieved" || g.progressPct >= 100).length;

  return (
    <main>
      <PageHeader
        title="Goals"
        subtitle="What we are trying to achieve — and the motions carrying it."
      />

      {/* Wave 3 §2/§6: the level of the operating model this room occupies. */}
      <OperatingModel
        current="goal"
        steps={{
          goal: { label: active.length === 1 ? active[0].name : `${active.length} active`, detail: `${active.length + (all.length - active.length)} total` },
          motion: { href: "/motions", detail: `${all.reduce((s, g) => s + g.motionsLinked, 0)} linked to goals` },
          pursuit: { href: "/pursuits" },
          pipeline: { href: "/pipeline" },
        }}
      />

      {/*
        Wave 3 §3 — the KPI band is gone.

        Four tiles sat above what was, in this tenant, a single goal: "1 active
        goals", "0 behind pace", "0 at target", "1 all goals". Two of them counted
        the same one goal twice and two read zero, so 200px of the first viewport
        was spent restating the thing directly beneath it. A count of goals is not
        an instrument; it is a fact about a list, and the list is right there.

        Where the counts still say something — how many need attention — they now
        sit on the filter row as a clause, and the filters that act on them are the
        same controls they always were.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="status" value={sp.status ?? "active"} label="Status" options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "achieved", label: "Achieved" }, { value: "missed", label: "Missed" }, { value: "archived", label: "Archived" }]} />
        <QuerySelect param="due" value={sp.due ?? "all"} label="Due within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <span className="ml-auto text-body text-neutral-500">
          {goals.length} goal{goals.length === 1 ? "" : "s"}
          {behind > 0 && <span style={{ color: "var(--color-accent-risk)" }}> · {behind} behind pace</span>}
          {achieved > 0 && <span className="ink-faint"> · {achieved} at target</span>}
        </span>
      </div>

      {/* Create — behind a fold. Setting a goal is a rare act; reading how the
          live ones are tracking is the daily one, and an eight-field form at the
          top of the room made the rare act the page's headline. */}
      <details className="group mb-6">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-accent hover:underline dark:text-blue-400">
          <span className="text-title leading-none" aria-hidden>+</span> New goal
        </summary>
        <Card className="mt-2.5">
        <form action={createGoalAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-copy sm:col-span-2"><span className="mb-1 block text-body text-neutral-500">Specific goal</span><input name="name" required placeholder="e.g. $2M co-sell pipeline in H2" className={`${fieldClass("md")} w-full`} /></label>
          <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Measure</span>
            <select name="metric" className={`${fieldClass("md")} w-full`}>
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Target (raw number, e.g. 2000000)</span><input name="target" type="number" required min="1" placeholder="2000000" className={`${fieldClass("md")} w-full`} /></label>
          <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Baseline (start-from)</span><input name="baseline" type="number" min="0" defaultValue="0" className={`${fieldClass("md")} w-full`} /></label>
          <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Due date (time-bound)</span><input name="dueDate" type="date" className={`${fieldClass("md")} w-full`} /></label>
          <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Owner</span><input name="owner" placeholder="Dana" className={`${fieldClass("md")} w-full`} /></label>
          <div className="flex items-end"><button className={buttonClass("primary", "md")}>Create goal</button></div>
        </form>
        <p className="mt-2 text-label ink-faint">Link motions and campaigns to a goal from their pages — progress rolls up automatically from what&rsquo;s linked.</p>
        </Card>
      </details>

      {goals.length === 0 ? (
        <p className="text-copy text-neutral-500">No goals match — {all.length === 0 ? "create your first above." : "clear a filter."}</p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const kind = metricKind(g.metric);
            const barTone = g.pace === "behind" ? "bg-red-500" : g.pace === "ahead" ? "bg-green-500" : "bg-blue-500";
            return (
              <Card key={g.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link href={`/goals/${g.id}`} className="font-semibold hover:underline">{g.name}</Link>
                  {/* pace only means something while the goal is live; done/archived goals keep just their status */}
                  {g.status === "active" && <span className={`rounded-inner px-1.5 py-0.5 text-micro font-medium ${PACE_TONE[g.pace]}`}>{PACE_LABEL[g.pace]}</span>}
                  {g.status !== "active" && <span className="rounded-inner bg-neutral-100 px-1.5 py-0.5 text-micro font-medium uppercase text-neutral-500 dark:bg-neutral-800">{g.status}</span>}
                  <span className="ml-auto text-body text-neutral-400">
                    {g.motionsLinked} motion{g.motionsLinked === 1 ? "" : "s"} · {g.campaignsLinked} campaign{g.campaignsLinked === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="mb-1 flex items-baseline justify-between text-copy">
                  <span className="text-neutral-500">{METRIC_LABEL[g.metric]}</span>
                  <span className="tnum">
                    <span className="font-semibold">{formatMetric(kind, g.current, g.unit)}</span>
                    <span className="text-neutral-400"> / {formatMetric(kind, g.target, g.unit)}</span>
                    <span className="ml-2 text-neutral-500">{g.progressPct}%</span>
                  </span>
                </div>
                <div className="relative mb-2 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div className={`h-full ${barTone}`} style={{ width: `${g.progressPct}%` }} />
                  {g.timePct != null && (
                    <div className="absolute top-0 h-full w-px bg-neutral-500" style={{ left: `${g.timePct}%` }} title={`${g.timePct}% of time elapsed`} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-body text-neutral-500">
                  {g.dueDate ? (
                    <span>
                      Due {g.dueDate}
                      {g.daysLeft != null && (g.daysLeft >= 0 ? ` · ${g.daysLeft} day${g.daysLeft === 1 ? "" : "s"} left` : ` · ${-g.daysLeft} day${g.daysLeft === -1 ? "" : "s"} overdue`)}
                      {g.timePct != null && ` · ${g.timePct}% elapsed`}
                    </span>
                  ) : (
                    <span className="text-neutral-400">No due date — add one to track pace</span>
                  )}
                  {g.owner && <span>· {g.owner}</span>}
                  <span className="ml-auto flex gap-2">
                    {g.status === "active" && (
                      <>
                        <form action={setGoalStatusAction.bind(null, g.id, "achieved")}><button className={buttonClass("subtle", "md")}>mark achieved</button></form>
                        <form action={setGoalStatusAction.bind(null, g.id, "archived")}><button className={buttonClass("subtle", "md")}>archive</button></form>
                      </>
                    )}
                    {g.status !== "active" && (
                      <form action={setGoalStatusAction.bind(null, g.id, "active")}><button className={buttonClass("subtle", "md")}>reactivate</button></form>
                    )}
                  </span>
                </div>
                {/* Who is carrying it (Wave 2 §8). A rolled-up target that cannot
                    say which partners produced it is still a slide; this is the
                    difference between reporting and operating. Shares come from
                    the same linked motions the progress bar is computed over. */}
                {g.contributors.length > 0 && (
                  <div className="mt-3 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-micro font-bold uppercase tracking-[0.05em] ink-faint">Contributing partners</span>
                      {/* The two figures on this page are different measures and a
                          reader will notice. Named here, at the number, before the
                          question forms — not as a paragraph, and not implying they
                          should reconcile. */}
                      <span className="text-label ink-faint"
                        title="Goal progress counts motion-level contribution linked to this goal. The pipeline roll-up below counts opportunity-level joint/co-sell pipeline. Different objects, different totals.">
                        motion-level · the roll-up below is opportunity-level
                      </span>
                    </div>
                    <div className="space-y-1">
                      {g.contributors.map((c) => (
                        <div key={c.name} className="flex items-center gap-3 text-body">
                          <span className="w-28 shrink-0 truncate font-medium ink-soft">{c.name}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                            <div className="h-full rounded-full" style={{ width: `${g.current > 0 ? Math.round((c.usd / g.current) * 100) : 0}%`, background: "var(--color-route)" }} />
                          </div>
                          <span className="tnum w-16 shrink-0 text-right font-semibold">{formatMoney(c.usd)}</span>
                          <span className="w-20 shrink-0 text-right text-label ink-faint">{c.motions} motion{c.motions === 1 ? "" : "s"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/*
                  Wave 3 §3 — "Why are we ahead/behind?"

                  The card could show a percentage and a partner split but never
                  what was CARRYING the number: which motions are linked, what
                  pipeline they have produced, and what is standing in the way. A
                  reader could see 25% and had nowhere to go with it.

                  This is the chain, walked from the same foreign keys the progress
                  bar is computed over, and it is where the reader leaves this room
                  for the next level of the model.
                */}
                {(() => {
                  const chain = chains.get(g.id);
                  if (!chain || chain.motions.length === 0) return null;
                  const blockers = goalBlockers(chain);
                  return (
                    <div className="mt-3 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-micro font-bold uppercase tracking-[0.05em] ink-faint">Carried by</span>
                        <Link href={`/goals/${g.id}`} className="text-label font-semibold text-accent hover:underline dark:text-blue-400">
                          Open the goal →
                        </Link>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-body">
                        <span className="ink-muted">
                          <b className="ink">{chain.motions.length}</b> motion{chain.motions.length === 1 ? "" : "s"}
                        </span>
                        <span className="ink-muted">
                          <b className="ink">{chain.oppCount}</b> opportunit{chain.oppCount === 1 ? "y" : "ies"} produced
                        </span>
                        <span className="ink-muted">
                          <b className="ink">{formatMoney(chain.openPipelineUsd)}</b> open pipeline
                          <span className="ink-faint"> (opportunity-level)</span>
                        </span>
                      </div>

                      {blockers.length > 0 && (
                        <div className="mt-2.5 space-y-1">
                          {blockers.map((b, i) => (
                            <Link key={i} href={b.href}
                              className="flex flex-wrap items-baseline gap-x-2 rounded-control px-2 py-1 text-body transition-colors hover:bg-[var(--surface-inset)]"
                              style={{ background: "color-mix(in srgb, var(--color-accent-attention) 7%, transparent)" }}>
                              <span aria-hidden className="h-1.5 w-1.5 shrink-0 self-center rounded-full" style={{ background: "var(--color-accent-attention)" }} />
                              <b className="ink">{b.label}</b>
                              {b.usd != null && b.usd > 0 && <span className="tnum ink-muted">{formatMoney(b.usd)} held up</span>}
                              <span className="ink-faint">— {b.detail}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {g.description && <p className="mt-2.5 text-body ink-faint">{g.description}</p>}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Revenue & pipeline targets — per period, overall and per partner ──
          Wave 3 §3/§8: the period targets are a real instrument, but the FORM that
          types one is configuration, and it led this section with four inputs and a
          button directly under the goals. Setting a target is a quarterly act;
          reading attainment is the daily one. The bars stay in the open; the form
          that authors them goes behind disclosure, the same treatment "New goal"
          already had. Nothing is removed and no figure moves. */}
      <section className="mt-10">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <BlockLabel>Revenue &amp; pipeline targets</BlockLabel>
          <span className="text-label text-neutral-400">targets are typed; actuals compute from opportunities — base (direct) vs joint (co-sell)</span>
        </div>

        {/* Set a target */}
        <details className="group mb-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-accent hover:underline dark:text-blue-400">
            <span className="text-title leading-none" aria-hidden>+</span> Set a period target
          </summary>
          <Card className="mt-2.5">
          <form action={upsertTargetAction} className="flex flex-wrap items-end gap-3">
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Year</span>
              <input name="periodYear" type="number" defaultValue={currentYear} min="2000" max="2100" className="w-24 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Metric</span>
              <select name="metric" className={fieldClass("md")}>
                <option value="pipeline">Open pipeline ($)</option>
                <option value="revenue">Won revenue ($)</option>
              </select>
            </label>
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Scope</span>
              <select name="partnerId" className="w-48 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900">
                <option value="">Overall</option>
                {partnerRows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Target (raw $, e.g. 500000)</span>
              <input name="targetUsd" type="number" required min="1" placeholder="500000" className="w-36 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <button className={buttonClass("primary", "md")}>Set target</button>
          </form>
          </Card>
        </details>

        {targets.length === 0 ? (
          <Card><p className="text-copy text-neutral-500">No targets or tracked pipeline yet — set a target above; the bars fill from real opportunities.</p></Card>
        ) : (
          (() => {
            const groups = new Map<string, TargetRow[]>();
            for (const t of targets) {
              const k = `${t.periodYear}·${t.metric}`;
              (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
            }
            return (
              <div className="space-y-4">
                {[...groups.entries()].map(([k, rows]) => {
                  const [yr, metric] = k.split("·");
                  return (
                    <Card key={k}>
                      <h3 className="mb-3 text-body font-semibold uppercase tracking-wide text-neutral-500">
                        {yr} · {metric === "pipeline" ? "open pipeline" : "won revenue"}
                      </h3>
                      <div className="space-y-2.5">
                        {rows.map((t) => {
                          const target = t.targetUsd;
                          const pct = target && target > 0 ? Math.min(100, Math.round((t.actualUsd / target) * 100)) : null;
                          const basePct = t.actualUsd > 0 && pct != null ? (t.baseUsd / t.actualUsd) * pct : 0;
                          const jointPct = t.actualUsd > 0 && pct != null ? (t.jointUsd / t.actualUsd) * pct : 0;
                          const over = target != null && t.actualUsd > target;
                          return (
                            <div key={`${t.partnerId ?? "_all"}`} className="flex items-center gap-3">
                              <span className={`w-44 shrink-0 truncate text-body ${t.partnerId == null ? "font-semibold text-neutral-800 dark:text-neutral-200" : "pl-3 text-neutral-600 dark:text-neutral-300"}`}>
                                {t.partnerName ?? "Overall"}
                              </span>
                              <div className="relative h-4 flex-1 overflow-hidden rounded-inner bg-neutral-100 dark:bg-neutral-800">
                                {t.partnerId == null ? (
                                  <div className="flex h-full">
                                    <div className="bg-neutral-400 dark:bg-neutral-600" style={{ width: `${pct != null ? basePct : t.actualUsd > 0 ? 60 : 0}%` }} title={`base ${formatMoney(t.baseUsd)}`} />
                                    <div className="bg-teal-500" style={{ width: `${pct != null ? jointPct : t.actualUsd > 0 ? 40 : 0}%` }} title={`joint ${formatMoney(t.jointUsd)}`} />
                                  </div>
                                ) : (
                                  <div className="h-full bg-teal-500" style={{ width: `${pct ?? (t.actualUsd > 0 ? 100 : 0)}%` }} />
                                )}
                              </div>
                              <span className="tnum w-56 shrink-0 text-right text-body">
                                <span className={over ? "font-semibold text-positive dark:text-green-400" : "font-medium"}>{formatMoney(t.actualUsd)}</span>
                                {target != null ? (
                                  <span className="text-neutral-400"> / {formatMoney(target)} · {t.attainmentPct}%</span>
                                ) : (
                                  <span className="text-neutral-400"> · no target</span>
                                )}
                                {t.partnerId == null && t.jointUsd > 0 && (
                                  <span className="text-teal-600 dark:text-teal-400"> +{formatMoney(t.jointUsd)} joint</span>
                                )}
                              </span>
                              {t.id && (
                                <form action={deleteTargetAction.bind(null, t.id)}>
                                  <button className="text-neutral-300 hover:text-red-600 dark:text-neutral-600" title="Remove target" aria-label="Remove target">×</button>
                                </form>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            );
          })()
        )}
      </section>
    </main>
  );
}
