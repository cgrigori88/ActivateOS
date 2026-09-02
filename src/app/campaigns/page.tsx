import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { Bento, Card, PageHeader, StatusBadge, fieldClass } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { QuerySelect } from "@/components/query-select";
import { goalOptions } from "@/lib/goals/goals";
import {
  generateSequenceAction,
  createBlankCampaignAction,
  suggestCampaignsAction,
  dismissCampaignAction,
  setCampaignGoalAction,
} from "./actions";
import { deleteCampaignAction } from "./[id]/actions";
import { buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";
// AI drafting actions invoked from this segment can run tens of seconds —
// raise the serverless limit so generation never dies as a platform timeout.
export const maxDuration = 60;

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
  partner_name: string | null;
  solution: string | null;
  lists: string;
  reach: string;
  goal_id: string | null;
  goal_name: string | null;
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
  searchParams: Promise<{ notice?: string; status?: string; source?: string; partner?: string; solution?: string; goal?: string; motion?: string }>;
}) {
  const sp = await searchParams;
  const notice = sp.notice;

  const { campaigns, goals, motions, accounts } = await withTenant(async (db, orgId) => {
    const { rows: campaigns } = await db.query<CampaignRow>(
      `select ca.id, ca.name, ca.status, ca.objective, ca.created_at, ca.source,
            c.id as company_id, c.legal_name, pa.name as partner_name, n.slug as solution,
            ca.goal_id, g.name as goal_name,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id) as touches,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'approved') as approved,
            (select count(*) from campaign_touches t where t.campaign_id = ca.id and t.status = 'sent') as sent,
            (select count(*) from campaign_populations cp where cp.campaign_id = ca.id) as lists,
            (select count(distinct company_id) from (
               select pm.company_id from campaign_populations cp
                 join population_members pm on pm.population_id = cp.population_id
                 where cp.campaign_id = ca.id
               union
               select ca.company_id where ca.company_id is not null
             ) r) as reach,
            (select es.engagement_score from engagement_scores es
              where es.company_id = c.id and es.contact_id is null
              order by es.computed_at desc limit 1) as engagement
     from campaigns ca
     left join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = coalesce(ca.company_id, m.company_id)
     left join partners pa on pa.id = m.partner_id
     left join taxonomy_nodes n on n.id = m.taxonomy_node_id
     left join goals g on g.id = ca.goal_id
     where ca.dismissed_at is null
     order by ca.created_at desc`,
    );
    const goals = await goalOptions(db, orgId);

    const { rows: motions } = await db.query<MotionOption>(
      `select m.id, c.legal_name, m.primary_persona
     from revenue_motions m
     join companies c on c.id = m.company_id
     where m.status in ('approved','active')
     order by m.created_at desc limit 50`,
    );

    const { rows: accounts } = await db.query<{ id: string; legal_name: string }>(
      `select id, legal_name from companies order by legal_name asc limit 300`,
    );

    return { campaigns, goals, motions, accounts };
  });

  const suggestions = campaigns.filter((c) => c.source === "ai_suggested" && c.status === "draft");
  let rest = campaigns.filter((c) => !(c.source === "ai_suggested" && c.status === "draft"));

  // Bentos (computed before filtering the list)
  const liveN = rest.filter((c) => c.status === "launched" || c.status === "completed").length;
  const touchesSent = rest.reduce((s, c) => s + Number(c.sent), 0);
  const reachTotal = rest.reduce((s, c) => s + Number(c.reach), 0);
  const listsLinked = rest.reduce((s, c) => s + Number(c.lists), 0);
  const engs = rest.map((c) => (c.engagement == null ? null : Number(c.engagement))).filter((v): v is number => v != null);
  const avgEng = engs.length ? Math.round(engs.reduce((a, b) => a + b, 0) / engs.length) : null;

  // Filters
  if (sp.status && sp.status !== "all") rest = rest.filter((c) => c.status === sp.status);
  if (sp.source && sp.source !== "all") rest = rest.filter((c) => c.source === sp.source);
  if (sp.partner && sp.partner !== "all") rest = rest.filter((c) => (c.partner_name ?? "Direct") === sp.partner);
  if (sp.solution && sp.solution !== "all") rest = rest.filter((c) => c.solution === sp.solution);
  if (sp.goal && sp.goal !== "all") rest = rest.filter((c) => (sp.goal === "__none" ? !c.goal_id : c.goal_id === sp.goal));
  const statusOptions = [...new Set(campaigns.map((c) => c.status))];
  const partnerOptions = [...new Set(campaigns.map((c) => c.partner_name).filter(Boolean) as string[])];
  const solutionOptions = [...new Set(campaigns.map((c) => c.solution).filter(Boolean) as string[])];

  return (
    <main>
      <PageHeader
        title="Campaigns"
        subtitle="Multi-touch sequences from approved motions. Approve per touch, then send."
      />
      <RoomTabs tabs={[{ href: "/campaigns", label: "Campaigns" }, { href: "/upcoming", label: "Scheduled sends" }]} />

      {notice && (
        <div className="mb-4 rounded-inner border border-amber-300 bg-amber-50 px-4 py-2.5 text-copy text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {notice}
        </div>
      )}

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="campaigns" value={rest.length} href="/campaigns" />
        <Bento label="live" value={liveN} subs={["launched / completed"]} href="/campaigns?status=launched" />
        <Bento label="accounts in reach" value={reachTotal} subs={[`${listsLinked} list${listsLinked === 1 ? "" : "s"} linked`]} href="/contacts" />
        <Bento label="touches sent" value={touchesSent} href="/analytics" />
        <Bento label="avg engagement" value={avgEng ?? "—"} href="/analytics" />
        <Bento label="AI suggestions" value={suggestions.length} subs={["awaiting review"]} href="/campaigns?source=ai_suggested" />
      </div>

      {/* Compose — two paths: AI-generated from a motion, or hand-authored from an
          account. The id is the landing spot for the approve-motion next-step pull
          (#79), which arrives with ?motion= preselecting the play. */}
      <div id="composer" className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-copy font-semibold uppercase tracking-wide text-neutral-500">Generate from a motion</h2>
          <p className="mb-3 text-body text-neutral-500">AI drafts a grounded sequence from an approved/active motion. Each touch is a draft until you approve it.</p>
          <form action={suggestCampaignsAction} className="mb-3">
            <button className={buttonClass("primary", "sm")}>
              Ask AI to suggest campaigns →
            </button>
            <span className="ml-2 text-label text-neutral-400">drafts suggestions for motions without a campaign</span>
          </form>
          {motions.length === 0 ? (
            <p className="text-copy text-neutral-500">
              No active or approved motions yet — the pipeline creates these from account intelligence. You can still
              build a campaign by hand on the right.
            </p>
          ) : (
            <form action={generateSequenceAction} className="flex flex-wrap items-end gap-3">
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Motion</span>
                <select name="motionId" defaultValue={sp.motion} className="w-56 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900">
                  {motions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.legal_name}{m.primary_persona ? ` — ${m.primary_persona}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Touches</span>
                <select name="touchCount" defaultValue="3" className={fieldClass("md")}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Sender</span>
                <input name="senderName" placeholder="Dana Whitfield" className="w-36 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <button type="submit" className={buttonClass("primary", "md")}>Compose</button>
            </form>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-copy font-semibold uppercase tracking-wide text-neutral-500">Build by hand</h2>
          <p className="mb-3 text-body text-neutral-500">Start an empty campaign on any account, then add and schedule your own touches — no motion needed.</p>
          <form action={createBlankCampaignAction} className="flex flex-wrap items-end gap-3">
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Account</span>
              <select name="companyId" required className="w-56 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900">
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.legal_name}</option>)}
              </select>
            </label>
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Name</span>
              <input name="name" placeholder="Q3 expansion play" className="w-40 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Sender</span>
              <input name="senderName" placeholder="Dana Whitfield" className="w-36 rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <button type="submit" className={buttonClass("primary", "md")}>Create</button>
          </form>
        </Card>
      </div>

      {/* AI suggestions awaiting the human's decision */}
      {suggestions.length > 0 && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
          <h2 className="mb-1 text-copy font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">
            Suggested by the pipeline · your call
          </h2>
          <p className="mb-3 text-body text-neutral-500">
            The AI drafted these from account intelligence. Preview and edit, then <strong>you</strong> decide whether to
            approve touches and launch — or dismiss.
          </p>
          <div className="space-y-2">
            {suggestions.map((ca) => (
              <div key={ca.id} className="flex flex-wrap items-center gap-3 rounded-inner border border-blue-200 bg-white px-3 py-2 dark:border-blue-900 dark:bg-neutral-900">
                <span className="rounded-inner bg-blue-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-accent dark:bg-blue-900 dark:text-blue-300">AI</span>
                <Link href={`/campaigns/${ca.id}`} className="font-medium hover:underline">{ca.name}</Link>
                <Link href={`/accounts/${ca.company_id}`} className="text-body text-neutral-500 hover:underline">{ca.legal_name}</Link>
                <span className="text-body text-neutral-400">{ca.touches} touch{Number(ca.touches) === 1 ? "" : "es"}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Link href={`/campaigns/${ca.id}`} className="rounded-control bg-blue-700 px-3 py-1 text-body font-medium text-white hover:bg-blue-800">Review</Link>
                  <form action={dismissCampaignAction.bind(null, ca.id)}>
                    <button className={buttonClass("primary", "sm")}>Dismiss</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sequences */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-copy font-semibold uppercase tracking-wide text-neutral-500">Campaigns</h2>
        <QuerySelect param="status" value={sp.status ?? "all"} label="Status" options={[{ value: "all", label: "Any status" }, ...statusOptions.map((s) => ({ value: s, label: s }))]} />
        <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        {solutionOptions.length > 0 && (
          <QuerySelect param="solution" value={sp.solution ?? "all"} label="Solution" options={[{ value: "all", label: "Any solution" }, ...solutionOptions.map((s) => ({ value: s, label: s }))]} />
        )}
        {goals.length > 0 && (
          <QuerySelect param="goal" value={sp.goal ?? "all"} label="Goal" options={[{ value: "all", label: "Any goal" }, { value: "__none", label: "No goal" }, ...goals.map((g) => ({ value: g.id, label: g.name }))]} />
        )}
        <QuerySelect param="source" value={sp.source ?? "all"} label="Source" options={[{ value: "all", label: "Any source" }, { value: "user", label: "Human-made" }, { value: "ai_suggested", label: "AI-suggested" }]} />
        <span className="ml-auto text-body text-neutral-500">{rest.length} campaign(s)</span>
      </div>
      {rest.length === 0 ? (
        <p className="text-copy text-neutral-500">No launched or hand-built campaigns yet — compose one above{suggestions.length > 0 ? " or review a suggestion" : ""}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Account</th>
                <th>Reach</th>
                {goals.length > 0 && <th>Goal</th>}
                <th>Status</th>
                <th className="text-right">Touches</th>
                <th className="text-right">Approved</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Engagement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rest.map((ca) => (
                <tr key={ca.id}>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <Link href={`/campaigns/${ca.id}`} className="font-medium hover:underline">{ca.name}</Link>
                      {ca.source === "ai_suggested" && (
                        <span className="rounded-inner bg-blue-100 px-1 py-0.5 text-micro font-bold uppercase text-accent dark:bg-blue-900 dark:text-blue-300" title="AI-suggested, accepted by a human">AI</span>
                      )}
                    </span>
                    {ca.objective && <div className="text-label text-neutral-400">{ca.objective}</div>}
                  </td>
                  <td>
                    <Link href={`/accounts/${ca.company_id}`} className="hover:underline">{ca.legal_name}</Link>
                  </td>
                  <td>
                    {Number(ca.lists) > 0 ? (
                      <Link href={`/campaigns/${ca.id}`} className="text-body text-accent hover:underline dark:text-blue-400">
                        {ca.reach} account{Number(ca.reach) === 1 ? "" : "s"} · {ca.lists} list{Number(ca.lists) === 1 ? "" : "s"}
                      </Link>
                    ) : (
                      <Link href={`/campaigns/${ca.id}`} className="text-body text-neutral-400 hover:underline">seed only · + list</Link>
                    )}
                  </td>
                  {goals.length > 0 && (
                    <td>
                      <form action={setCampaignGoalAction.bind(null, ca.id)} className="flex items-center gap-1">
                        <select name="goalId" defaultValue={ca.goal_id ?? ""} className="max-w-[9rem] rounded-inner border border-neutral-300 bg-transparent px-1 py-0.5 text-label dark:border-neutral-700">
                          <option value="">—</option>
                          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <button className={buttonClass("subtle", "md")}>set</button>
                      </form>
                    </td>
                  )}
                  <td><StatusBadge status={ca.status === "launched" ? "active" : ca.status} /></td>
                  <td className="tnum text-right">{ca.touches}</td>
                  <td className="tnum text-right text-neutral-500">{ca.approved}</td>
                  <td className="tnum text-right text-neutral-500">{ca.sent}</td>
                  <td className="tnum text-right">
                    {ca.engagement == null ? <span className="text-neutral-400">—</span> : Number(ca.engagement).toFixed(0)}
                  </td>
                  <td className="text-right">
                    <form action={deleteCampaignAction.bind(null, ca.id)}>
                      <button className={buttonClass("subtle", "md")} title="Delete the campaign; sent emails stay in their threads">delete</button>
                    </form>
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
