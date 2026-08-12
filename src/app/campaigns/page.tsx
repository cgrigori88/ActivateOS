import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, PageHeader, StatusBadge } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import {
  generateSequenceAction,
  createBlankCampaignAction,
  suggestCampaignsAction,
  dismissCampaignAction,
} from "./actions";

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
  source: string;
  created_at: Date;
}

interface MotionOption {
  id: string;
  legal_name: string;
  primary_persona: string | null;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; status?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const notice = sp.notice;
  const pool = getPool();

  const { rows: campaigns } = await pool.query<CampaignRow>(
    `select ca.id, ca.name, ca.status, ca.objective, ca.created_at, ca.source,
            c.id as company_id, c.legal_name,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id) as touches,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'approved') as approved,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'sent') as sent,
            (select es.engagement_score from engagement_scores es
              where es.company_id = c.id and es.contact_id is null
              order by es.computed_at desc limit 1) as engagement
     from campaigns ca
     left join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = coalesce(ca.company_id, m.company_id)
     where ca.dismissed_at is null
     order by ca.created_at desc`,
  );

  const suggestions = campaigns.filter((c) => c.source === "ai_suggested" && c.status === "draft");
  let rest = campaigns.filter((c) => !(c.source === "ai_suggested" && c.status === "draft"));

  // Bentos (computed before filtering the list)
  const liveN = rest.filter((c) => c.status === "launched" || c.status === "completed").length;
  const touchesSent = rest.reduce((s, c) => s + Number(c.sent), 0);
  const engs = rest.map((c) => (c.engagement == null ? null : Number(c.engagement))).filter((v): v is number => v != null);
  const avgEng = engs.length ? Math.round(engs.reduce((a, b) => a + b, 0) / engs.length) : null;

  // Filters
  if (sp.status && sp.status !== "all") rest = rest.filter((c) => c.status === sp.status);
  if (sp.source && sp.source !== "all") rest = rest.filter((c) => c.source === sp.source);
  const statusOptions = [...new Set(campaigns.map((c) => c.status))];

  const { rows: motions } = await pool.query<MotionOption>(
    `select m.id, c.legal_name, m.primary_persona
     from revenue_motions m
     join companies c on c.id = m.company_id
     where m.status in ('approved','active')
     order by m.created_at desc limit 50`,
  );

  const { rows: accounts } = await pool.query<{ id: string; legal_name: string }>(
    `select id, legal_name from companies order by legal_name asc limit 300`,
  );

  return (
    <main>
      <PageHeader
        title="Campaigns"
        subtitle="Branded, multi-touch email sequences composed from approved motions — preview, approve per touch, then send."
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {notice}
        </div>
      )}

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Bento label="campaigns" value={rest.length} />
        <Bento label="live" value={liveN} subs={["launched / completed"]} />
        <Bento label="touches sent" value={touchesSent} />
        <Bento label="avg engagement" value={avgEng ?? "—"} />
        <Bento label="AI suggestions" value={suggestions.length} subs={["awaiting review"]} />
      </div>

      {/* Compose — two paths: AI-generated from a motion, or hand-authored from an account */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Generate from a motion</h2>
          <p className="mb-3 text-xs text-neutral-500">AI drafts a grounded sequence from an approved/active motion. Each touch is a draft until you approve it.</p>
          <form action={suggestCampaignsAction} className="mb-3">
            <button className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:ring-blue-800 dark:hover:bg-blue-950">
              Ask AI to suggest campaigns →
            </button>
            <span className="ml-2 text-[11px] text-neutral-400">drafts suggestions for motions without a campaign</span>
          </form>
          {motions.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No active or approved motions yet — the pipeline creates these from account intelligence. You can still
              build a campaign by hand on the right.
            </p>
          ) : (
            <form action={generateSequenceAction} className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Motion</span>
                <select name="motionId" className="w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
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
                <span className="mb-1 block text-xs text-neutral-500">Sender</span>
                <input name="senderName" placeholder="Dana Whitfield" className="w-36 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <button type="submit" className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Compose</button>
            </form>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Build by hand</h2>
          <p className="mb-3 text-xs text-neutral-500">Start an empty campaign on any account, then add and schedule your own touches — no motion needed.</p>
          <form action={createBlankCampaignAction} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Account</span>
              <select name="companyId" required className="w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.legal_name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Name</span>
              <input name="name" placeholder="Q3 expansion play" className="w-40 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Sender</span>
              <input name="senderName" placeholder="Dana Whitfield" className="w-36 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <button type="submit" className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">Create</button>
          </form>
        </Card>
      </div>

      {/* AI suggestions awaiting the human's decision */}
      {suggestions.length > 0 && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">
            Suggested by the pipeline · your call
          </h2>
          <p className="mb-3 text-xs text-neutral-500">
            The AI drafted these from account intelligence. Preview and edit, then <strong>you</strong> decide whether to
            approve touches and launch — or dismiss.
          </p>
          <div className="space-y-2">
            {suggestions.map((ca) => (
              <div key={ca.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-900 dark:bg-neutral-900">
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900 dark:text-blue-300">AI</span>
                <Link href={`/campaigns/${ca.id}`} className="font-medium hover:underline">{ca.name}</Link>
                <Link href={`/accounts/${ca.company_id}`} className="text-xs text-neutral-500 hover:underline">{ca.legal_name}</Link>
                <span className="text-xs text-neutral-400">{ca.touches} touch{Number(ca.touches) === 1 ? "" : "es"}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Link href={`/campaigns/${ca.id}`} className="rounded-md bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800">Review</Link>
                  <form action={dismissCampaignAction.bind(null, ca.id)}>
                    <button className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800">Dismiss</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sequences */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Campaigns</h2>
        <QuerySelect param="status" value={sp.status ?? "all"} label="Status" options={[{ value: "all", label: "Any status" }, ...statusOptions.map((s) => ({ value: s, label: s }))]} />
        <QuerySelect param="source" value={sp.source ?? "all"} label="Source" options={[{ value: "all", label: "Any source" }, { value: "user", label: "Human-made" }, { value: "ai_suggested", label: "AI-suggested" }]} />
        <span className="ml-auto text-xs text-neutral-500">{rest.length} campaign(s)</span>
      </div>
      {rest.length === 0 ? (
        <p className="text-sm text-neutral-500">No launched or hand-built campaigns yet — compose one above{suggestions.length > 0 ? " or review a suggestion" : ""}.</p>
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
              {rest.map((ca) => (
                <tr key={ca.id}>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <Link href={`/campaigns/${ca.id}`} className="font-medium hover:underline">{ca.name}</Link>
                      {ca.source === "ai_suggested" && (
                        <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] font-bold uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-300" title="AI-suggested, accepted by a human">AI</span>
                      )}
                    </span>
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
