import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import {
  abandonMotionAction,
  activateMotionAction,
  approveMotionAction,
  completeMotionAction,
  rejectMotionAction,
} from "./actions";

export const dynamic = "force-dynamic";

const ORDER = ["draft", "approved", "active", "completed", "abandoned"];

export default async function MotionsPage() {
  const pool = getPool();
  const { rows: motions } = await pool.query(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.cta, m.confidence,
            m.company_id, c.legal_name, n.slug, m.outcome,
            m.estimated_value_usd, m.effort, p.score as propensity,
            pa.name as partner_name
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     left join propensity_scores p on p.id = m.propensity_score_id
     left join partners pa on pa.id = m.partner_id
     order by m.created_at desc limit 100`,
  );
  const byStatus = new Map<string, typeof motions>();
  for (const m of motions) {
    const list = byStatus.get(m.status) ?? [];
    list.push(m);
    byStatus.set(m.status, list);
  }

  return (
    <main>
      <PageHeader
        title="Motions"
        subtitle="Agents propose, you dispose. Approvals, rejections, and edits feed the learning loop."
      />
      {motions.length === 0 && (
        <p className="text-sm text-neutral-500">
          No motions yet — score accounts, then run design-motion on the strongest.
        </p>
      )}
      {ORDER.filter((s) => byStatus.has(s)).map((status) => (
        <section key={status} className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            <StatusBadge status={status} />
            <span className="tnum">{byStatus.get(status)!.length}</span>
          </h2>
          <div className="space-y-4">
            {byStatus.get(status)!.map((m) => (
              <Card key={m.id}>
                <p className="mb-1 text-sm">
                  <Link href={`/accounts/${m.company_id}`} className="font-semibold hover:underline">
                    {m.legal_name}
                  </Link>{" "}
                  <span className="text-neutral-400">— {m.slug}</span>
                  <span className="ml-2 text-xs text-neutral-400">({m.confidence} confidence)</span>
                  <Link
                    href={`/briefs/${m.id}`}
                    className="ml-2 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    Brief →
                  </Link>
                  {m.outcome && (
                    <span
                      className={`ml-2 text-xs font-semibold uppercase ${
                        m.outcome === "won"
                          ? "text-green-700 dark:text-green-400"
                          : "text-neutral-500"
                      }`}
                    >
                      {m.outcome.replace(/_/g, " ")}
                    </span>
                  )}
                </p>
                {(m.estimated_value_usd != null || m.partner_name) && (
                  <p className="mb-1 text-xs text-neutral-500">
                    {m.estimated_value_usd != null && (
                      <>
                        ~${Math.round(Number(m.estimated_value_usd) / 1000)}k estimated
                        {m.propensity != null &&
                          ` · $${Math.round((Number(m.estimated_value_usd) * Number(m.propensity)) / 100 / 1000)}k expected at ${Number(m.propensity).toFixed(0)} propensity`}
                        {m.effort != null && ` · effort ${m.effort}/5`}
                      </>
                    )}
                    {m.partner_name && (
                      <>
                        {m.estimated_value_usd != null && " · "}
                        via {m.partner_name}
                      </>
                    )}
                  </p>
                )}
                <p className="mb-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {m.thesis}
                </p>
                <p className="text-sm text-neutral-500">
                  <span className="font-medium">Trigger:</span> {m.trigger_summary}
                  <br />
                  <span className="font-medium">CTA:</span> {m.cta}
                </p>
                {m.status === "draft" && (
                  <div className="mt-3 flex gap-2">
                    <form action={approveMotionAction.bind(null, m.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                      >
                        Approve
                      </button>
                    </form>
                    <form action={rejectMotionAction.bind(null, m.id)}>
                      <button
                        type="submit"
                        className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                )}
                {m.status === "approved" && (
                  <div className="mt-3 flex gap-2">
                    <form action={activateMotionAction.bind(null, m.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                      >
                        Activate
                      </button>
                    </form>
                    <form action={abandonMotionAction.bind(null, m.id)}>
                      <button
                        type="submit"
                        className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                      >
                        Abandon
                      </button>
                    </form>
                  </div>
                )}
                {m.status === "active" && (
                  <div className="mt-3 flex gap-2">
                    <form action={completeMotionAction.bind(null, m.id, "won")}>
                      <button
                        type="submit"
                        className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                      >
                        Complete — won
                      </button>
                    </form>
                    <form action={completeMotionAction.bind(null, m.id, "lost")}>
                      <button
                        type="submit"
                        className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950"
                      >
                        Complete — lost
                      </button>
                    </form>
                    <form action={completeMotionAction.bind(null, m.id, "no_decision")}>
                      <button
                        type="submit"
                        className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                      >
                        No decision
                      </button>
                    </form>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
