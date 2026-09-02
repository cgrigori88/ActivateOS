import Link from "next/link";
import { Bento, Card, PageHeader, fieldClass } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { listGoals, METRICS, METRIC_LABEL, formatMetric, type Goal } from "@/lib/goals/goals";
import { listTargets, type TargetRow } from "@/lib/goals/targets";
import { withTenant } from "@/lib/db/tenant";
import { createGoalAction, setGoalStatusAction, upsertTargetAction, deleteTargetAction } from "./actions";
import { formatMoney } from "@/lib/format/money";
import { buttonClass } from "@/components/ui";

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
  const { all, targets, partnerRows } = await withTenant(async (db, orgId) => ({
    all: await listGoals(db, orgId),
    targets: await listTargets(db, orgId),
    // org-scoped: the target-scope dropdown must not list other tenants' partners.
    partnerRows: (await db.query<{ id: string; name: string }>(
      `select id, name from partners where org_id = $1 order by name`,
      [orgId],
    )).rows,
  }));
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
        subtitle="Targets with progress computed from the linked motions and campaigns."
      />

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Bento label="active goals" value={active.length} href="/goals?status=active" />
        <Bento label="behind pace" value={behind} subs={["need attention"]} href="/goals?status=active" />
        <Bento label="at target" value={achieved} href="/goals?status=achieved" />
        <Bento label="all goals" value={all.length} href="/goals?status=all" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="status" value={sp.status ?? "active"} label="Status" options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "achieved", label: "Achieved" }, { value: "missed", label: "Missed" }, { value: "archived", label: "Archived" }]} />
        <QuerySelect param="due" value={sp.due ?? "all"} label="Due within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <span className="ml-auto text-body text-neutral-500">{goals.length} goal(s)</span>
      </div>

      {/* Create */}
      <Card className="mb-6">
        <h2 className="mb-3 text-copy font-semibold uppercase tracking-wide text-neutral-500">New goal</h2>
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
        <p className="mt-2 text-label text-neutral-400">Link motions and campaigns to a goal from their pages — progress rolls up automatically from what&rsquo;s linked.</p>
      </Card>

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
                  <span className="font-semibold">{g.name}</span>
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
                {g.description && <p className="mt-2 text-body text-neutral-500">{g.description}</p>}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Revenue & pipeline targets — per period, overall and per partner ── */}
      <section className="mt-10">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">Revenue &amp; pipeline targets</h2>
          <span className="text-label text-neutral-400">targets are typed; actuals compute from opportunities — base (direct) vs joint (co-sell)</span>
        </div>

        {/* Set a target */}
        <Card className="mb-4">
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
