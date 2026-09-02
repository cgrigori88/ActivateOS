import Link from "next/link";
import { Bento, Card, PageHeader } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { withTenant } from "@/lib/db/tenant";
import { sendScheduledAction, unscheduleAction } from "./actions";
import { buttonClass } from "@/components/ui";

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
  const { rows } = await withTenant(
    async (db) =>
      await db.query<Row>(
        `select t.id, t.touch_no, t.name, t.subject, t.scheduled_at,
            ca.recipient_email, ca.id as campaign_id, ca.name as campaign_name,
            c.id as company_id, c.legal_name
     from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     left join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = coalesce(ca.company_id, m.company_id)
     where t.status = 'scheduled'
     order by t.scheduled_at asc nulls last`,
      ),
  );

  const now = Date.now();
  const autosend = process.env.OUTREACH_AUTOSEND === "on";
  const dueCount = rows.filter((r) => r.scheduled_at && new Date(r.scheduled_at).getTime() <= now).length;

  return (
    <main>
      <PageHeader
        title="Scheduled sends"
        subtitle="The dated send plan across every launched sequence — the cadence, made concrete."
      />
      <RoomTabs tabs={[{ href: "/campaigns", label: "Campaigns" }, { href: "/upcoming", label: "Scheduled sends" }]} />

      {/* items-stretch + a sub line on both tiles keeps the pair the same height */}
      <div className="mb-4 flex flex-wrap items-stretch gap-3">
        <Bento label="scheduled" value={rows.length} subs={["queued sends with a date"]} />
        <Bento label="due now" value={dueCount} subs={[dueCount > 0 ? "waiting on a person to send" : "all future-dated"]} />
        {/* Wave 4 §6/§12: "worker auto-send: armed / off (manual)" described the
            transport, not the guarantee. This is a DISABLED state in §12's sense —
            the capability exists and is switched off — and that is what an operator
            needs to know, because it determines whether a scheduled touch will leave
            the building without them. Same flag, same two states, named in the terms
            of the promise rather than the machinery. */}
        <span className={`ml-auto self-start rounded-inner px-2.5 py-1 text-label font-semibold ${autosend ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
          {autosend ? "Automatic sending is ON" : "Automatic sending is off — every send is a person's action"}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-copy text-neutral-500">
            Nothing scheduled. Launch a sequence on the{" "}
            <Link href="/campaigns" className="text-accent hover:underline dark:text-blue-400">Campaigns</Link> page to
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
                    <td className={`text-body ${due ? "font-semibold text-amber-700 dark:text-amber-400" : "text-neutral-500"}`}>
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
                    <td className="text-body text-neutral-500">{r.recipient_email ?? "—"}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/campaigns/${r.campaign_id}`}
                          className="text-body font-medium text-neutral-500 hover:underline"
                          title="Edit copy, timing, CC and recipient on the campaign page"
                        >
                          Edit
                        </Link>
                        <form action={unscheduleAction.bind(null, r.id)}>
                          <button
                            className={buttonClass("primary", "sm")}
                            title="Take it off the calendar — back to approved; re-schedule from the campaign any time"
                          >
                            Unschedule
                          </button>
                        </form>
                        <form action={sendScheduledAction.bind(null, r.id)}>
                          <button className={buttonClass("primary", "sm")}>
                            Send now
                          </button>
                        </form>
                      </div>
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
