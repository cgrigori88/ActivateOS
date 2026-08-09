import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { resolveActionAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The action queue (BLUEPRINT Phase 4): every dated cadence step across all
 * active motions, overdue first. This is the seller/operator's worklist —
 * the place where "activated" becomes "worked".
 */
export default async function QueuePage() {
  const pool = getPool();
  const { rows: actions } = await pool.query(
    `select a.id, a.step, a.action, a.due_at, a.status,
            m.id as motion_id, c.legal_name, c.id as company_id,
            pa.name as partner_name, s.name as seller_name
     from motion_actions a
     join revenue_motions m on m.id = a.motion_id
     join companies c on c.id = m.company_id
     left join partners pa on pa.id = m.partner_id
     left join sellers s on s.id = m.partner_seller_id
     where a.status = 'pending' and m.status = 'active'
     order by a.due_at, a.step`,
  );

  const { rows: recent } = await pool.query(
    `select a.action, a.status, a.completed_at, c.legal_name
     from motion_actions a
     join revenue_motions m on m.id = a.motion_id
     join companies c on c.id = m.company_id
     where a.status in ('done','skipped')
     order by a.completed_at desc limit 8`,
  );

  const now = Date.now();

  return (
    <main>
      <PageHeader
        title="Action queue"
        subtitle="Every dated step across active motions. Overdue first — activation means scheduled work, not a status."
      />

      {actions.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nothing pending. Actions appear here when a motion goes active — its play cadence
          becomes dated steps automatically.
        </p>
      ) : (
        <div className="space-y-3">
          {actions.map((a) => {
            const due = new Date(a.due_at);
            const overdue = due.getTime() < now;
            return (
              <Card key={a.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm">
                      <span
                        className={
                          overdue
                            ? "font-semibold text-red-700 dark:text-red-400"
                            : "font-medium text-neutral-500"
                        }
                      >
                        {overdue ? "overdue · " : ""}
                        {due.toISOString().slice(0, 10)}
                      </span>{" "}
                      · step {a.step} ·{" "}
                      <Link
                        href={`/briefs/${a.motion_id}`}
                        className="font-semibold hover:underline"
                      >
                        {a.legal_name}
                      </Link>
                      {a.partner_name && (
                        <span className="text-neutral-500"> via {a.partner_name}</span>
                      )}
                      {a.seller_name && (
                        <span className="text-neutral-500"> / {a.seller_name}</span>
                      )}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {a.action}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <form action={resolveActionAction.bind(null, a.id, "done")}>
                      <button
                        type="submit"
                        className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                      >
                        Done
                      </button>
                    </form>
                    <form action={resolveActionAction.bind(null, a.id, "skipped")}>
                      <button
                        type="submit"
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                      >
                        Skip
                      </button>
                    </form>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Recently resolved
          </h2>
          <ul className="space-y-1.5">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span
                  className={
                    r.status === "done"
                      ? "text-green-700 dark:text-green-400"
                      : "text-neutral-400"
                  }
                >
                  {r.status}
                </span>
                <span>
                  {r.legal_name} — {r.action}
                </span>
                <span className="ml-auto shrink-0 text-xs text-neutral-400">
                  {new Date(r.completed_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
