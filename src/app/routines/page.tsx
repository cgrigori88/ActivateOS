import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Card, PageHeader } from "@/components/ui";
import { ROUTINE_CATALOG, listRoutines } from "@/lib/routines/routines";
import { resendConfigured } from "@/lib/comms/resend";
import { runRoutineNowAction, saveRoutineConfigAction, toggleRoutineAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Routines (task #73, Phase A): the org's standing agent staff — a CATALOG of
 * known jobs, each with a visible guardrail, a cadence, and its run history.
 * Deliberately not free-text automation: every routine's blast radius is
 * known, and v1 routines are read-only digests.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const input = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export default async function RoutinesPage() {
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const routines = await listRoutines(pool, orgId);
  const { rows: runs } = await pool.query<{
    routine_id: string;
    ran_at: Date;
    status: string;
    summary: Record<string, unknown>;
    output: string | null;
  }>(
    `select rr.routine_id, rr.ran_at, rr.status, rr.summary, rr.output
     from routine_runs rr join routines r on r.id = rr.routine_id
     where r.org_id = $1 order by rr.ran_at desc limit 20`,
    [orgId],
  );
  const canEmail = resendConfigured();

  return (
    <main>
      <PageHeader
        title="Routines"
        subtitle="Your standing staff — scheduled jobs from a known catalog, each with a visible guardrail. Digests summarize and surface; nothing here sends outreach or changes revenue state."
      />

      <div className="space-y-4">
        {ROUTINE_CATALOG.map((cat) => {
          const r = routines.find((x) => x.kind === cat.kind)!;
          const myRuns = runs.filter((x) => x.routine_id === r.id).slice(0, 3);
          return (
            <Card key={cat.kind}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{cat.label}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
                  {cat.cadence}
                </span>
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-micro font-medium text-green-800 ring-1 ring-inset ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900">
                  {cat.guardrail}
                </span>
                <form action={toggleRoutineAction.bind(null, r.id)} className="ml-auto">
                  <input type="hidden" name="enable" value={r.enabled ? "0" : "1"} />
                  <button
                    className={`rounded-md px-3 py-1 text-xs font-medium ${
                      r.enabled
                        ? "bg-green-700 text-white hover:bg-green-800"
                        : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                    }`}
                  >
                    {r.enabled ? "On — click to pause" : "Off — click to enable"}
                  </button>
                </form>
              </div>
              <p className="mb-3 max-w-2xl text-xs text-neutral-500">{cat.description}</p>

              <form action={saveRoutineConfigAction.bind(null, r.id)} className="mb-3 flex flex-wrap items-end gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-neutral-500">Run at (UTC hour)</span>
                  <input name="hourUtc" type="number" min={0} max={23} defaultValue={r.config.hourUtc ?? 7} className={`${input} w-20 tnum`} />
                </label>
                {cat.kind === "account_digest" && (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-neutral-500">Day</span>
                    <select name="weekday" defaultValue={String(r.config.weekday ?? 1)} className={input}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                )}
                {cat.kind === "morning_brief" && (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-neutral-500">
                      Email to{!canEmail ? " (email delivery needs Resend configured — the brief still runs and shows here)" : ""}
                    </span>
                    <input name="recipient" type="email" defaultValue={r.config.recipient ?? ""} placeholder="you@company.com" className={`${input} w-64`} />
                  </label>
                )}
                <button className="rounded-md px-3 py-1.5 text-xs font-medium text-accent ring-1 ring-inset ring-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:ring-blue-800 dark:hover:bg-blue-950">
                  Save
                </button>
              </form>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <form action={runRoutineNowAction.bind(null, r.id)}>
                  <button className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800">Run now</button>
                </form>
                <span className="text-label text-neutral-400">
                  {r.last_run_at ? `last ran ${new Date(r.last_run_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "never ran"}
                </span>
              </div>

              {myRuns.length > 0 && (
                <div className="space-y-2">
                  {myRuns.map((run, i) => (
                    <details key={i} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800" open={i === 0 && cat.kind === "morning_brief"}>
                      <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                        <span className={run.status === "ok" ? "font-medium text-positive dark:text-green-400" : "font-medium text-red-700 dark:text-red-400"}>
                          {run.status}
                        </span>{" "}
                        · {new Date(run.ran_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                        {" · "}
                        {Object.entries(run.summary).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                      </summary>
                      {run.output && (
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-sans text-xs leading-relaxed dark:bg-neutral-950">
                          {run.output}
                        </pre>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
