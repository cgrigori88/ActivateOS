import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, PageHeader } from "@/components/ui";
import { currentOrgId, currentRole } from "@/lib/auth/org";
import { authConfigured } from "@/lib/auth/supabase";
import { inviteMemberAction, setMemberRoleAction, removeMemberAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin (task #64) — the platform-operations side of the app, owners only.
 * Two concerns, one room:
 *  - ACCESS: who is in the org and what they may do (invite / role / remove).
 *  - AI OPERATIONS: what the agents and providers are doing — runs, spend,
 *    latency, human overrides, provider errors, queue depth. The observability
 *    that was deliberately removed from user-facing Insights lives here, where
 *    the audience is the platform operator.
 */

const ROLES = ["owner", "operator", "viewer"] as const;
const ROLE_HINT: Record<string, string> = {
  owner: "Runs the org's people + everything below",
  operator: "Runs the org's data — approve, send, edit",
  viewer: "Read-only everywhere",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const sp = await searchParams;
  const pool = getPool();
  const role = await currentRole(pool);

  if (role !== "owner") {
    return (
      <main>
        <PageHeader title="Admin" subtitle="Platform operations." />
        <Card><p className="text-sm text-neutral-500">Owner access required — ask an owner of your organization.</p></Card>
      </main>
    );
  }

  const orgId = await currentOrgId(pool);

  // ── Access ────────────────────────────────────────────────────────────────
  const { rows: members } = orgId
    ? await pool.query<{ user_id: string; email: string | null; role: string; created_at: Date; last_sign_in_at: Date | null }>(
        `select m.user_id, u.email, m.role, m.created_at, u.last_sign_in_at
         from org_members m join auth.users u on u.id = m.user_id
         where m.org_id = $1 order by m.created_at asc`,
        [orgId],
      )
    : { rows: [] };

  // ── AI operations ─────────────────────────────────────────────────────────
  const [{ rows: agents }, { rows: recentRuns }, { rows: providerErrors }, { rows: queues }] = await Promise.all([
    pool.query<{ workflow: string; n: string; cost: string | null; ms: string | null; overridden: string }>(
      `select workflow, count(*) as n, round(sum(cost_usd)::numeric, 3) as cost,
              round(avg(latency_ms))::int as ms,
              count(*) filter (where human_decision in ('edited','rejected')) as overridden
       from agent_runs group by workflow order by n desc`,
    ),
    pool.query<{ workflow: string; model: string; cost_usd: string | null; latency_ms: number | null; human_decision: string | null; created_at: Date }>(
      `select workflow, model, cost_usd, latency_ms, human_decision, created_at
       from agent_runs order by created_at desc limit 10`,
    ),
    pool.query<{ provider_id: string; error: string | null; status: string; finished_at: Date | null }>(
      `select provider_id, error, status, finished_at from provider_runs
       where status = 'failed' or error is not null
       order by finished_at desc nulls last limit 8`,
    ),
    pool.query<{ research_pending: string; research_running: string; review_pending: string; touches_scheduled: string }>(
      `select
         (select count(*) from research_jobs where status = 'pending') as research_pending,
         (select count(*) from research_jobs where status = 'running') as research_running,
         (select count(*) from review_queue where status = 'pending') as review_pending,
         (select count(*) from campaign_touches where status = 'scheduled') as touches_scheduled`,
    ),
  ]);
  const qd = queues[0];
  const totalRuns = agents.reduce((s, a) => s + Number(a.n), 0);
  const totalCost = agents.reduce((s, a) => s + Number(a.cost ?? 0), 0);

  // Worker heartbeat (only when configured; never blocks the page long).
  let workerStatus = "not configured";
  if (process.env.WORKER_URL) {
    try {
      const res = await fetch(`${process.env.WORKER_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
      workerStatus = res.ok ? "healthy" : `unhealthy (${res.status})`;
    } catch {
      workerStatus = "unreachable";
    }
  }

  const input = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <main>
      <PageHeader
        title="Admin"
        subtitle="Platform operations, owners only — who has access, and what the AI layer is doing. User-facing screens stay clean; the machinery is watched from here."
      />

      {sp.notice && (
        <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          {sp.notice}
        </div>
      )}

      {/* ── Access ── */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Access</h2>
      <Card className="mb-4">
        {!authConfigured() ? (
          <p className="text-sm text-neutral-500">
            Identity isn&apos;t configured on this deployment — member management activates once
            <code className="mx-1">NEXT_PUBLIC_SUPABASE_*</code> is set. Basic Auth gates everything meanwhile.
          </p>
        ) : (
          <>
            {members.length === 0 ? (
              <p className="mb-3 text-sm text-neutral-500">No members yet — create the owner on the <Link href="/login" className="text-blue-700 hover:underline dark:text-blue-400">sign-in page</Link> first.</p>
            ) : (
              <div className="mb-4 overflow-x-auto scroll-thin">
                <table className="data-table">
                  <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Last sign-in</th><th></th></tr></thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id}>
                        <td className="font-medium">{m.email ?? m.user_id}</td>
                        <td>
                          <form action={setMemberRoleAction.bind(null, m.user_id)} className="flex items-center gap-1.5">
                            <select name="role" defaultValue={m.role} title={ROLE_HINT[m.role]} className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700">
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button className="text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400">set</button>
                          </form>
                        </td>
                        <td className="text-xs text-neutral-500">{new Date(m.created_at).toISOString().slice(0, 10)}</td>
                        <td className="text-xs text-neutral-500">{m.last_sign_in_at ? new Date(m.last_sign_in_at).toISOString().slice(0, 10) : "never"}</td>
                        <td className="text-right">
                          <form action={removeMemberAction.bind(null, m.user_id)}>
                            <button className="text-[11px] font-medium text-red-700 hover:underline dark:text-red-400">remove</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Invite a member</h3>
            <p className="mb-3 text-xs text-neutral-500">
              You set a temporary password and share it out-of-band — nothing secret travels by URL or email.
              They change it from the sign-in page after first login.
            </p>
            <form action={inviteMemberAction} className="flex flex-wrap items-end gap-3">
              <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Email</span><input name="email" type="email" required className={`${input} w-56`} /></label>
              <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Temporary password (12+)</span><input name="password" type="text" required minLength={12} autoComplete="off" className={`${input} w-52`} /></label>
              <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Role</span>
                <select name="role" defaultValue="operator" className={input}>
                  {ROLES.map((r) => <option key={r} value={r} title={ROLE_HINT[r]}>{r}</option>)}
                </select>
              </label>
              <button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Add member</button>
            </form>
          </>
        )}
      </Card>

      {/* ── AI operations ── */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">AI operations</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="agent runs" value={totalRuns} />
        <Bento label="AI spend" value={`$${totalCost.toFixed(2)}`} />
        <Bento label="research queue" value={Number(qd.research_pending)} subs={[`${qd.research_running} running`]} />
        <Bento label="evidence to review" value={Number(qd.review_pending)} />
        <Bento label="touches scheduled" value={Number(qd.touches_scheduled)} />
        <Bento label="worker" value={workerStatus === "healthy" ? "✓" : workerStatus === "not configured" ? "—" : "✗"} subs={[workerStatus]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Agent workflows · spend, latency, human overrides</h3>
          {agents.length === 0 ? (
            <p className="text-sm text-neutral-500">No agent runs recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400"><th className="pb-1 font-medium">Workflow</th><th className="pb-1 text-right font-medium">Runs</th><th className="pb-1 text-right font-medium">Cost</th><th className="pb-1 text-right font-medium">Avg ms</th><th className="pb-1 text-right font-medium">Overridden</th></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.workflow}>
                    <td className="py-0.5">{a.workflow.replace(/_/g, " ")}</td>
                    <td className="tnum py-0.5 text-right">{a.n}</td>
                    <td className="tnum py-0.5 text-right">{a.cost == null ? "—" : `$${a.cost}`}</td>
                    <td className="tnum py-0.5 text-right">{a.ms ?? "—"}</td>
                    <td className="tnum py-0.5 text-right text-neutral-500">{a.overridden}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-2 text-[11px] text-neutral-400 dark:border-neutral-800">
            Override rate is the health metric: rising human edits/rejections on a workflow = its prompts or grounding are drifting.
          </p>
        </Card>

        <Card>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Provider failures · latest</h3>
          {providerErrors.length === 0 ? (
            <p className="text-sm text-neutral-500">No provider failures recorded. Full registry on <Link href="/provider-health" className="text-blue-700 hover:underline dark:text-blue-400">Provider health</Link>.</p>
          ) : (
            <ul className="space-y-1.5">
              {providerErrors.map((e, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{e.provider_id}</span>
                  <span className="text-neutral-400"> · {e.status}{e.finished_at ? ` · ${new Date(e.finished_at).toISOString().slice(0, 10)}` : ""}</span>
                  {e.error && <div className="truncate text-neutral-500" title={e.error}>{e.error.slice(0, 120)}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-2 text-[11px] text-neutral-400 dark:border-neutral-800">
            Deeper cuts live on <Link href="/provider-health" className="underline">Provider health</Link> and <Link href="/insights" className="underline">Insights</Link>; error tracking &amp; alerting (Sentry-class) is tracked on the security roadmap.
          </p>
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent agent runs</h3>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead><tr><th>When</th><th>Workflow</th><th>Model</th><th className="text-right">Cost</th><th className="text-right">Latency</th><th>Human decision</th></tr></thead>
              <tbody>
                {recentRuns.map((r, i) => (
                  <tr key={i}>
                    <td className="text-xs text-neutral-500">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>{r.workflow.replace(/_/g, " ")}</td>
                    <td className="text-xs text-neutral-500">{r.model}</td>
                    <td className="tnum text-right">{r.cost_usd == null ? "—" : `$${Number(r.cost_usd).toFixed(3)}`}</td>
                    <td className="tnum text-right">{r.latency_ms == null ? "—" : `${r.latency_ms}ms`}</td>
                    <td className="text-xs">{r.human_decision ?? <span className="text-neutral-400">pending</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
