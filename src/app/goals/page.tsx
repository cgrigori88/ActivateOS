import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, PageHeader } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { listGoals, METRICS, METRIC_LABEL, formatMetric, type Goal } from "@/lib/goals/goals";
import { createGoalAction, setGoalStatusAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Goals (#55) — S.M.A.R.T. objectives whose progress is computed from the
 * motions & campaigns linked to them. Pace (progress vs time elapsed) turns each
 * target into an on-track / behind signal, and a due-window filter keeps the
 * view to what matters in the next 7 / 30 / 90 days.
 */

const PACE_TONE: Record<Goal["pace"], string> = {
  ahead: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  on_track: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
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
  const pool = getPool();
  const { rows: orgRows } = await pool.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
  const orgId = orgRows[0]?.id;
  const all = orgId ? await listGoals(pool, orgId) : [];

  const dueDays = ["7", "30", "90"].includes(sp.due ?? "") ? Number(sp.due) : null;
  const goals = all.filter((g) => {
    if (sp.status && sp.status !== "all" && g.status !== sp.status) return false;
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
        subtitle="S.M.A.R.T. targets — Specific, Measurable, Achievable, Relevant, Time-bound. Progress is computed from the motions and campaigns linked to each goal, so it never drifts from reality."
      />

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Bento label="active goals" value={active.length} />
        <Bento label="behind pace" value={behind} subs={["need attention"]} />
        <Bento label="at target" value={achieved} />
        <Bento label="all goals" value={all.length} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="status" value={sp.status ?? "active"} label="Status" options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "achieved", label: "Achieved" }, { value: "missed", label: "Missed" }, { value: "archived", label: "Archived" }]} />
        <QuerySelect param="due" value={sp.due ?? "all"} label="Due within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <span className="ml-auto text-xs text-neutral-500">{goals.length} goal(s)</span>
      </div>

      {/* Create */}
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">New goal</h2>
        <form action={createGoalAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Specific goal</span><input name="name" required placeholder="e.g. $2M co-sell pipeline in H2" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Measure</span>
            <select name="metric" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Target (raw number, e.g. 2000000)</span><input name="target" type="number" required min="1" placeholder="2000000" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Baseline (start-from)</span><input name="baseline" type="number" min="0" defaultValue="0" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Due date (time-bound)</span><input name="dueDate" type="date" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Owner</span><input name="owner" placeholder="Dana" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
          <div className="flex items-end"><button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">Create goal</button></div>
        </form>
        <p className="mt-2 text-[11px] text-neutral-400">Link motions and campaigns to a goal from their pages — progress rolls up automatically from what&rsquo;s linked.</p>
      </Card>

      {goals.length === 0 ? (
        <p className="text-sm text-neutral-500">No goals match — {all.length === 0 ? "create your first above." : "clear a filter."}</p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const kind = metricKind(g.metric);
            const barTone = g.pace === "behind" ? "bg-red-500" : g.pace === "ahead" ? "bg-green-500" : "bg-blue-500";
            return (
              <Card key={g.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{g.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PACE_TONE[g.pace]}`}>{PACE_LABEL[g.pace]}</span>
                  {g.status !== "active" && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-500 dark:bg-neutral-800">{g.status}</span>}
                  <span className="ml-auto text-xs text-neutral-400">
                    {g.motionsLinked} motion{g.motionsLinked === 1 ? "" : "s"} · {g.campaignsLinked} campaign{g.campaignsLinked === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="mb-1 flex items-baseline justify-between text-sm">
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
                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
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
                        <form action={setGoalStatusAction.bind(null, g.id, "achieved")}><button className="font-medium text-green-700 hover:underline dark:text-green-400">mark achieved</button></form>
                        <form action={setGoalStatusAction.bind(null, g.id, "archived")}><button className="font-medium text-neutral-500 hover:underline">archive</button></form>
                      </>
                    )}
                    {g.status !== "active" && (
                      <form action={setGoalStatusAction.bind(null, g.id, "active")}><button className="font-medium text-blue-700 hover:underline dark:text-blue-400">reactivate</button></form>
                    )}
                  </span>
                </div>
                {g.description && <p className="mt-2 text-xs text-neutral-500">{g.description}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
