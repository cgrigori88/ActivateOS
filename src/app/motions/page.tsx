import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { approveMotionAction, rejectMotionAction } from "./actions";

export const dynamic = "force-dynamic";

const ORDER = ["draft", "approved", "active", "completed", "abandoned"];

export default async function MotionsPage() {
  const pool = getPool();
  const { rows: motions } = await pool.query(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.cta, m.confidence,
            m.company_id, c.legal_name, n.slug
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
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
                </p>
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
              </Card>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
