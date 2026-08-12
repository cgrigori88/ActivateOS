import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, MiniBar, PageHeader, StatusBadge } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { goalOptions } from "@/lib/goals/goals";
import { currentOrgId } from "@/lib/auth/org";
import {
  abandonMotionAction,
  activateMotionAction,
  approveMotionAction,
  completeMotionAction,
  rejectMotionAction,
  setMotionGoalAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_ORDER = ["draft", "approved", "active", "completed", "abandoned"];

interface MotionRow {
  id: string;
  status: string;
  thesis: string;
  trigger_summary: string;
  cta: string;
  confidence: string;
  company_id: string;
  legal_name: string;
  slug: string;
  industry: string | null;
  outcome: string | null;
  estimated_value_usd: string | null;
  effort: number | null;
  propensity: string | null;
  partner_name: string | null;
  goal_id: string | null;
  goal_name: string | null;
}

const GROUPS: Record<string, { label: string; key: (m: MotionRow) => string }> = {
  status: { label: "Status", key: (m) => m.status },
  solution: { label: "Solution / play", key: (m) => m.slug },
  vertical: { label: "Vertical", key: (m) => m.industry ?? "—" },
  partner: { label: "Partner", key: (m) => m.partner_name ?? "Direct" },
  goal: { label: "Goal", key: (m) => m.goal_name ?? "No goal" },
  company: { label: "Company", key: (m) => m.legal_name },
};

export default async function MotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; partner?: string; goal?: string; group?: string }>;
}) {
  const sp = await searchParams;
  const groupKey = GROUPS[sp.group ?? "status"] ? (sp.group ?? "status") : "status";
  const group = GROUPS[groupKey];

  const pool = getPool();
  const { rows: all } = await pool.query<MotionRow>(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.cta, m.confidence,
            m.company_id, c.legal_name, n.slug, c.industry, m.outcome,
            m.estimated_value_usd, m.effort, p.score as propensity, pa.name as partner_name,
            m.goal_id, g.name as goal_name
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     left join propensity_scores p on p.id = m.propensity_score_id
     left join partners pa on pa.id = m.partner_id
     left join goals g on g.id = m.goal_id
     order by m.created_at desc limit 500`,
  );
  const orgId = await currentOrgId(pool);
  const goals = orgId ? await goalOptions(pool, orgId) : [];

  const partnerOptions = [...new Set(all.map((m) => m.partner_name).filter(Boolean) as string[])];
  const motions = all.filter(
    (m) =>
      (!sp.status || sp.status === "all" || m.status === sp.status) &&
      (!sp.partner || sp.partner === "all" || m.partner_name === sp.partner) &&
      (!sp.goal || sp.goal === "all" || (sp.goal === "__none" ? !m.goal_id : m.goal_id === sp.goal)),
  );

  // Bentos
  const activeN = motions.filter((m) => m.status === "active").length;
  const props = motions.map((m) => (m.propensity == null ? null : Number(m.propensity))).filter((v): v is number => v != null);
  const avgProp = props.length ? Math.round(props.reduce((a, b) => a + b, 0) / props.length) : null;
  const estPipe = motions.reduce((s, m) => s + Number(m.estimated_value_usd ?? 0), 0);
  const expected = motions.reduce((s, m) => s + (Number(m.estimated_value_usd ?? 0) * Number(m.propensity ?? 0)) / 100, 0);
  const wonN = motions.filter((m) => m.outcome === "won").length;

  // Group + chart
  const groups = new Map<string, MotionRow[]>();
  for (const m of motions) {
    const k = group.key(m);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  const orderKeys = (keys: string[]) =>
    groupKey === "status" ? STATUS_ORDER.filter((s) => keys.includes(s)) : keys.sort((a, b) => (groups.get(b)!.length - groups.get(a)!.length));
  // Status grouping shows the full lifecycle, empty statuses included, so the
  // shape of the funnel is always visible; other groupings show their top 10.
  const chartRows =
    groupKey === "status"
      ? STATUS_ORDER.map((s) => ({ label: s, value: groups.get(s)?.length ?? 0 }))
      : [...groups.entries()].map(([label, ms]) => ({ label, value: ms.length })).sort((a, b) => b.value - a.value).slice(0, 10);

  return (
    <main>
      <PageHeader title="Motions" subtitle="Agents propose, you dispose — grouped and filtered so it holds at scale. Approvals feed the learning loop." />

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="motions" value={motions.length} />
        <Bento label="active" value={activeN} subs={[`${wonN} won`]} />
        <Bento label="avg propensity" value={avgProp ?? "—"} />
        <Bento label="est. pipeline" value={`$${Math.round(estPipe / 1000)}k`} />
        <Bento label="expected" value={`$${Math.round(expected / 1000)}k`} subs={["value × propensity"]} />
        <Bento label="partners" value={partnerOptions.length} />
      </div>

      {/* Filters + group-by */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="status" value={sp.status ?? "all"} label="Status" options={[{ value: "all", label: "Any status" }, ...STATUS_ORDER.map((s) => ({ value: s, label: s }))]} />
        <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        {goals.length > 0 && (
          <QuerySelect param="goal" value={sp.goal ?? "all"} label="Goal" options={[{ value: "all", label: "Any goal" }, { value: "__none", label: "No goal" }, ...goals.map((g) => ({ value: g.id, label: g.name }))]} />
        )}
        <QuerySelect param="group" value={groupKey} label="Group by" options={Object.entries(GROUPS).map(([k, g]) => ({ value: k, label: g.label }))} />
        <span className="ml-auto text-xs text-neutral-500">{motions.length} motion(s)</span>
      </div>

      {motions.length === 0 ? (
        <p className="text-sm text-neutral-500">No motions match — clear a filter, or score accounts and run design-motion.</p>
      ) : (
        <>
          {/* Chart */}
          <Card className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Motions by {group.label.toLowerCase()}</h2>
            <MiniBar rows={chartRows} />
          </Card>

          {/* Grouped list */}
          {orderKeys([...groups.keys()]).map((k) => (
            <section key={k} className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {groupKey === "status" ? <StatusBadge status={k} /> : <span>{k}</span>}
                <span className="tnum text-neutral-400">{groups.get(k)!.length}</span>
              </h2>
              <div className="space-y-3">
                {groups.get(k)!.map((m) => (
                  <Card key={m.id}>
                    <p className="mb-1 text-sm">
                      <Link href={`/accounts/${m.company_id}`} className="font-semibold hover:underline">{m.legal_name}</Link>
                      <span className="text-neutral-400"> — {m.slug}</span>
                      {m.industry && <span className="ml-1 text-xs text-neutral-400">· {m.industry}</span>}
                      <span className="ml-2 text-xs text-neutral-400">({m.confidence} confidence)</span>
                      <Link href={`/briefs/${m.id}`} className="ml-2 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Brief →</Link>
                      {m.outcome && <span className={`ml-2 text-xs font-semibold uppercase ${m.outcome === "won" ? "text-green-700 dark:text-green-400" : "text-neutral-500"}`}>{m.outcome.replace(/_/g, " ")}</span>}
                    </p>
                    {(m.estimated_value_usd != null || m.partner_name) && (
                      <p className="mb-1 text-xs text-neutral-500">
                        {m.estimated_value_usd != null && (
                          <>
                            ~${Math.round(Number(m.estimated_value_usd) / 1000)}k estimated
                            {m.propensity != null && ` · $${Math.round((Number(m.estimated_value_usd) * Number(m.propensity)) / 100 / 1000)}k expected at ${Number(m.propensity).toFixed(0)}`}
                            {m.effort != null && ` · effort ${m.effort}/5`}
                          </>
                        )}
                        {m.partner_name && <>{m.estimated_value_usd != null && " · "}via {m.partner_name}</>}
                      </p>
                    )}
                    {goals.length > 0 && (
                      <form action={setMotionGoalAction.bind(null, m.id)} className="mb-1 flex items-center gap-1.5 text-xs">
                        <span className="text-neutral-400">Goal:</span>
                        <select name="goalId" defaultValue={m.goal_id ?? ""} className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700">
                          <option value="">— none —</option>
                          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <button className="font-medium text-blue-700 hover:underline dark:text-blue-400">set</button>
                        {m.goal_name && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">{m.goal_name}</span>}
                      </form>
                    )}
                    <details className="mb-1">
                      <summary className="cursor-pointer text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">Thesis &amp; trigger</summary>
                      <p className="mb-2 mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{m.thesis}</p>
                      <p className="text-sm text-neutral-500"><span className="font-medium">Trigger:</span> {m.trigger_summary}<br /><span className="font-medium">CTA:</span> {m.cta}</p>
                    </details>
                    {m.status === "draft" && (
                      <div className="mt-3 flex gap-2">
                        <form action={approveMotionAction.bind(null, m.id)}><button className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800">Approve</button></form>
                        <form action={rejectMotionAction.bind(null, m.id)}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">Reject</button></form>
                      </div>
                    )}
                    {m.status === "approved" && (
                      <div className="mt-3 flex gap-2">
                        <form action={activateMotionAction.bind(null, m.id)}><button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">Activate</button></form>
                        <form action={abandonMotionAction.bind(null, m.id)}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">Abandon</button></form>
                      </div>
                    )}
                    {m.status === "active" && (
                      <div className="mt-3 flex gap-2">
                        <form action={completeMotionAction.bind(null, m.id, "won")}><button className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800">Complete — won</button></form>
                        <form action={completeMotionAction.bind(null, m.id, "lost")}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">Complete — lost</button></form>
                        <form action={completeMotionAction.bind(null, m.id, "no_decision")}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">No decision</button></form>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
