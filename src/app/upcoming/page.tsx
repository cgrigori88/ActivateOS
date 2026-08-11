import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";
import { sendScheduledAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Upcoming (Phase 9B): the dated send plan across every launched sequence —
 * what fires, to whom, and when. Due rows can be sent now; the rest wait for
 * their cadence offset (or the armed worker).
 */

interface Row {
  id: string;
  touch_no: number;
  name: string;
  subject: string;
  scheduled_at: Date | null;
  recipient_email: string | null;
  campaign_id: string;
  campaign_name: string;
  company_id: string;
  legal_name: string;
}

export default async function UpcomingPage() {
  const pool = getPool();
  const { rows } = await pool.query<Row>(
    `select t.id, t.touch_no, t.name, t.subject, t.scheduled_at,
            ca.recipient_email, ca.id as campaign_id, ca.name as campaign_name,
            c.id as company_id, c.legal_name
     from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = m.company_id
     where t.status = 'scheduled'
     order by t.scheduled_at asc nulls last`,
  );

  const now = Date.now();
  const autosend = process.env.OUTREACH_AUTOSEND === "on";
  const dueCount = rows.filter((r) => r.scheduled_at && new Date(r.scheduled_at).getTime() <= now).length;

  return (
    <main>
      <PageHeader
        title="Upcoming"
        subtitle="Scheduled sends across every launched sequence — the cadence, made concrete."
      />

      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-neutral-500">
        <span><span className="tnum text-lg font-semibold text-neutral-800 dark:text-neutral-200">{rows.length}</span> scheduled</span>
        <span><span className="tnum text-lg font-semibold text-amber-700 dark:text-amber-400">{dueCount}</span> due now</span>
        <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${autosend ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
          worker auto-send: {autosend ? "armed" : "off (manual)"}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            Nothing scheduled. Launch a sequence on the{" "}
            <Link href="/campaigns" className="text-blue-700 hover:underline dark:text-blue-400">Campaigns</Link> page to
            populate the plan.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Account</th>
                <th>Campaign · touch</th>
                <th>Subject</th>
                <th>Recipient</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = r.scheduled_at ? new Date(r.scheduled_at).getTime() <= now : false;
                return (
                  <tr key={r.id}>
                    <td className={`text-xs ${due ? "font-semibold text-amber-700 dark:text-amber-400" : "text-neutral-500"}`}>
                      {r.scheduled_at ? new Date(r.scheduled_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                      {due && <span className="ml-1">· due</span>}
                    </td>
                    <td>
                      <Link href={`/accounts/${r.company_id}`} className="hover:underline">{r.legal_name}</Link>
                    </td>
                    <td>
                      <Link href={`/campaigns/${r.campaign_id}`} className="hover:underline">{r.campaign_name}</Link>
                      <span className="text-neutral-400"> · T{r.touch_no}</span>
                    </td>
                    <td className="max-w-xs truncate text-neutral-600 dark:text-neutral-300">{r.subject}</td>
                    <td className="text-xs text-neutral-500">{r.recipient_email ?? "—"}</td>
                    <td className="text-right">
                      <form action={sendScheduledAction.bind(null, r.id)}>
                        <button className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-neutral-700 dark:text-blue-400 dark:hover:bg-blue-950">
                          Send now
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
