import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { generateSequenceAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Campaigns (Phase 9A): branded multi-touch email sequences composed from
 * approved motions. Each row is a sequence; the composer lives one click in.
 */

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  company_id: string;
  legal_name: string;
  touches: string;
  approved: string;
  sent: string;
  engagement: string | null;
  created_at: Date;
}

interface MotionOption {
  id: string;
  legal_name: string;
  primary_persona: string | null;
}

export default async function CampaignsPage() {
  const pool = getPool();

  const { rows: campaigns } = await pool.query<CampaignRow>(
    `select ca.id, ca.name, ca.status, ca.objective, ca.created_at,
            c.id as company_id, c.legal_name,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id) as touches,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'approved') as approved,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'sent') as sent,
            (select es.engagement_score from engagement_scores es
              where es.company_id = c.id and es.contact_id is null
              order by es.computed_at desc limit 1) as engagement
     from campaigns ca
     join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = m.company_id
     order by ca.created_at desc`,
  );

  const { rows: motions } = await pool.query<MotionOption>(
    `select m.id, c.legal_name, m.primary_persona
     from revenue_motions m
     join companies c on c.id = m.company_id
     where m.status in ('approved','active')
       and not exists (select 1 from campaigns ca where ca.motion_id = m.id)
     order by m.created_at desc limit 25`,
  );

  return (
    <main>
      <PageHeader
        title="Campaigns"
        subtitle="Branded, multi-touch email sequences composed from approved motions — preview, approve per touch, then send."
      />

      {/* Compose */}
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">New sequence</h2>
        {motions.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No approved motions without a campaign yet. Approve a motion on the{" "}
            <Link href="/motions" className="text-blue-700 hover:underline dark:text-blue-400">Motions</Link> page first.
          </p>
        ) : (
          <form action={generateSequenceAction} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Approved motion</span>
              <select name="motionId" className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {motions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.legal_name}{m.primary_persona ? ` — ${m.primary_persona}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Touches</span>
              <select name="touchCount" defaultValue="3" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Sender name</span>
              <input name="senderName" placeholder="e.g. Dana Whitfield" className="w-44 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <button type="submit" className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
              Compose
            </button>
          </form>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          The sequence is grounded in the approved motion and verified evidence — no invented facts. Each touch is a
          draft until you approve it.
        </p>
      </Card>

      {/* Sequences */}
      {campaigns.length === 0 ? (
        <p className="text-sm text-neutral-500">No campaigns yet — compose one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Account</th>
                <th>Status</th>
                <th className="text-right">Touches</th>
                <th className="text-right">Approved</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((ca) => (
                <tr key={ca.id}>
                  <td>
                    <Link href={`/campaigns/${ca.id}`} className="font-medium hover:underline">{ca.name}</Link>
                    {ca.objective && <div className="text-[11px] text-neutral-400">{ca.objective}</div>}
                  </td>
                  <td>
                    <Link href={`/accounts/${ca.company_id}`} className="hover:underline">{ca.legal_name}</Link>
                  </td>
                  <td><StatusBadge status={ca.status === "launched" ? "active" : ca.status} /></td>
                  <td className="tnum text-right">{ca.touches}</td>
                  <td className="tnum text-right text-neutral-500">{ca.approved}</td>
                  <td className="tnum text-right text-neutral-500">{ca.sent}</td>
                  <td className="tnum text-right">
                    {ca.engagement == null ? <span className="text-neutral-400">—</span> : Number(ca.engagement).toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
