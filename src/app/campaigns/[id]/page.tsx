import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { TZ_OPTIONS, formatInTz } from "@/lib/comms/tz";
import { campaignAccounts, linkedLists, attachableLists, mergeAccountData, renderAngle } from "@/lib/campaigns/lists";
import {
  approveTouchAction,
  rejectTouchAction,
  sendTouchAction,
  scheduleSequenceAction,
  addTouchAction,
  editTouchAction,
  deleteTouchAction,
  aiDraftTouchesAction,
  linkListAction,
  unlinkListAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Campaign detail (Phase 9A composer): the sequence, each touch previewed as
 * real branded HTML in a sandboxed iframe, with per-touch approve / reject /
 * send. An engagement strip shows what the account is doing back.
 */

interface Touch {
  id: string;
  touch_no: number;
  name: string;
  subject: string;
  preheader: string | null;
  headline: string | null;
  status: string;
  html_body: string | null;
  body: string;
  custom_html: string | null;
  account_angle: string | null;
  highlights: string[];
  cta_label: string | null;
  cta_url: string | null;
  send_offset_days: number;
  scheduled_at: Date | null;
  rejected_reason: string | null;
  sent_at: Date | null;
}

/** Shared field set for adding or editing a touch by hand. */
function TouchFormFields({ t }: { t?: Touch }) {
  const input = "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Label</span><input name="name" defaultValue={t?.name ?? ""} placeholder="e.g. Trigger intro" className={input} /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">Day offset</span><input name="sendOffsetDays" type="number" min="0" defaultValue={t?.send_offset_days ?? 0} className={input} /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Subject</span><input name="subject" required defaultValue={t?.subject ?? ""} className={input} /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Preheader</span><input name="preheader" defaultValue={t?.preheader ?? ""} className={input} /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Headline</span><input name="headline" defaultValue={t?.headline ?? ""} className={input} /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Body (blank line between paragraphs)</span><textarea name="body" defaultValue={t?.body ?? ""} rows={4} className={input} /></label>
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-neutral-500">Highlights (one per line)</span><textarea name="highlights" defaultValue={(t?.highlights ?? []).join("\n")} rows={2} className={input} /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">CTA label</span><input name="ctaLabel" defaultValue={t?.cta_label ?? ""} placeholder="Book 20 minutes" className={input} /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-neutral-500">CTA link (optional)</span><input name="ctaUrl" defaultValue={t?.cta_url ?? ""} placeholder="https://…" className={input} /></label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-neutral-500">
          Account angle — per-recipient layer (tokens: <code className="text-neutral-400">{"{{account}} {{industry}} {{solution}} {{trigger}}"}</code>)
        </span>
        <textarea name="accountAngle" defaultValue={t?.account_angle ?? ""} rows={2} placeholder="For {{account}}, {{trigger}} is why {{industry}} teams are prioritizing {{solution}}." className={input} />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-neutral-500">Custom HTML (optional — replaces the body, keeps the branded header/footer)</span>
        <textarea name="customHtml" defaultValue={t?.custom_html ?? ""} rows={3} placeholder="<p>Paste your own HTML…</p>" className={`${input} font-mono text-xs`} />
      </label>
    </div>
  );
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; preview?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notice = sp.notice;
  const pool = getPool();

  const { rows: caRows } = await pool.query<{
    id: string;
    name: string;
    status: string;
    objective: string | null;
    audience: string | null;
    org_id: string | null;
    company_id: string;
    legal_name: string;
    primary_domain: string | null;
    motion_id: string;
    wordmark: string | null;
    recipient_email: string | null;
    launched_at: Date | null;
    send_tz: string | null;
  }>(
    `select ca.id, ca.name, ca.status, ca.objective, ca.audience,
            coalesce(ca.org_id, (select id from organizations order by created_at asc limit 1)) as org_id,
            c.id as company_id, c.legal_name, c.primary_domain, m.id as motion_id,
            bp.wordmark, ca.recipient_email, ca.launched_at, ca.send_tz
     from campaigns ca
     left join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = coalesce(ca.company_id, m.company_id)
     left join brand_profiles bp on bp.id = ca.brand_id
     where ca.id = $1`,
    [id],
  );
  if (caRows.length === 0) notFound();
  const ca = caRows[0];

  // Reach: the accounts that roll into this campaign, its linked lists, and
  // lists it could attach (top-fit ones surfaced as suggestions).
  const accounts = await campaignAccounts(pool, id);
  const lists = await linkedLists(pool, id);
  const attachable = ca.org_id ? await attachableLists(pool, id, ca.org_id) : [];
  const suggestions = attachable.filter((l) => l.suggested);

  // Per-recipient preview: resolve the account-angle layer against one account's
  // real data so the two layers (shared paragraphs + account angle) are visible.
  const previewId = sp.preview && accounts.some((a) => a.companyId === sp.preview) ? sp.preview : accounts[0]?.companyId;
  const previewAccount = accounts.find((a) => a.companyId === previewId) ?? null;
  const previewVars = previewId ? await mergeAccountData(pool, previewId) : null;

  const { rows: touches } = await pool.query<Touch>(
    `select id, touch_no, name, subject, preheader, headline, status, html_body,
            body, custom_html, account_angle, highlights, cta_label, cta_url, send_offset_days, scheduled_at, rejected_reason, sent_at
     from campaign_touches where campaign_id = $1 order by touch_no`,
    [id],
  );

  const { rows: contacts } = await pool.query<{ email: string; name: string | null; title: string | null }>(
    `select email, name, title from contacts where company_id = $1 order by name nulls last limit 25`,
    [ca.company_id],
  );

  const { rows: eng } = await pool.query<{
    engagement_score: string;
    touches_sent: number;
    opens: number;
    clicks: number;
    replies: number;
    positive_replies: number;
    last_engaged_at: Date | null;
  }>(
    `select engagement_score, touches_sent, opens, clicks, replies, positive_replies, last_engaged_at
     from engagement_scores where company_id = $1 and contact_id is null
     order by computed_at desc limit 1`,
    [ca.company_id],
  );
  const e = eng[0];

  const launched = Boolean(ca.launched_at);
  const schedulable = touches.filter((t) => t.status === "draft" || t.status === "approved").length;
  const rejectedCount = touches.filter((t) => t.status === "rejected").length;

  return (
    <main>
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/campaigns" className="hover:underline">Campaigns</Link> ›{" "}
        <Link href={`/accounts/${ca.company_id}`} className="hover:underline">{ca.legal_name}</Link>
      </div>
      <PageHeader title={ca.name} subtitle={ca.objective ?? undefined} />

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {notice}
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        <StatusBadge status={ca.status === "launched" ? "active" : ca.status} />
        {ca.audience && <span>· {ca.audience}</span>}
        {ca.primary_domain && <span>· {ca.primary_domain}</span>}
      </div>

      {/* Engagement strip — what the account does back, feeding the intelligence layer */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="tnum text-3xl font-semibold">{e ? Number(e.engagement_score).toFixed(0) : "—"}</div>
            <div className="text-xs text-neutral-500">engagement score</div>
          </div>
          {[
            ["Sent", e?.touches_sent ?? 0],
            ["Opens", e?.opens ?? 0],
            ["Clicks", e?.clicks ?? 0],
            ["Replies", e?.replies ?? 0],
            ["Positive", e?.positive_replies ?? 0],
          ].map(([label, val]) => (
            <div key={label as string}>
              <div className="tnum text-xl font-semibold">{val as number}</div>
              <div className="text-xs text-neutral-500">{label as string}</div>
            </div>
          ))}
          <p className="ml-auto max-w-xs text-[11px] text-neutral-400">
            Engagement feeds propensity, compelling-event detection, and forecasting — not just campaign copy.
          </p>
        </div>
      </Card>

      {/* Reach — the target lists that roll into this campaign, and the accounts they resolve to. */}
      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Reach</h2>
          <span className="text-xs text-neutral-400">{accounts.length} account{accounts.length === 1 ? "" : "s"} · {lists.length} list{lists.length === 1 ? "" : "s"}</span>
        </div>

        {/* Linked lists */}
        {lists.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {lists.map((l) => (
              <span key={l.populationId} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                <span className="font-medium">{l.name}</span>
                <span className="text-neutral-400">{l.partnerName ?? "org"} · {l.members}</span>
                <form action={unlinkListAction.bind(null, ca.id, l.populationId)}>
                  <button className="text-neutral-400 hover:text-red-600" title="Remove list" aria-label="Remove list">×</button>
                </form>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-xs text-neutral-500">No lists linked yet — this campaign covers just its seed account. Attach a target list so one approved sequence scales across the whole list.</p>
        )}

        {/* Add a list + AI/heuristic suggestions */}
        {attachable.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <form action={linkListAction.bind(null, ca.id)} className="flex items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Add a list</span>
                <select name="populationId" className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {attachable.map((l) => (
                    <option key={l.populationId} value={l.populationId}>{l.name} — {l.reason}</option>
                  ))}
                </select>
              </label>
              <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">Attach</button>
            </form>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-400">Suggested</span>
                {suggestions.map((l) => (
                  <form key={l.populationId} action={linkListAction.bind(null, ca.id)}>
                    <input type="hidden" name="populationId" value={l.populationId} />
                    <button className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" title={l.reason}>
                      + {l.name} <span className="text-blue-400">({l.reason})</span>
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">Suggestions are ranked by average account fit; attaching a list is always your call. Nothing sends until you approve each touch.</p>
      </Card>

      {/* Schedule the sequence — the primary way to launch a multi-touch cadence */}
      {!launched && schedulable > 0 && (
        <Card className="mb-6 border-blue-200 dark:border-blue-900">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">Schedule the sequence</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Pick who receives it and when it starts. All {schedulable} touch{schedulable === 1 ? "" : "es"} get scheduled on their
            day-offsets — touch 1 on the start date, later touches after their offset.
            {rejectedCount > 0 && ` ${rejectedCount} rejected touch${rejectedCount === 1 ? "" : "es"} stay held back.`}
          </p>
          <form action={scheduleSequenceAction.bind(null, ca.id)} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Recipient</span>
              {contacts.length > 0 ? (
                <select name="to" className="w-60 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {contacts.map((c) => (
                    <option key={c.email} value={c.email}>{c.name ? `${c.name} — ${c.email}` : c.email}</option>
                  ))}
                </select>
              ) : (
                <input name="to" type="email" required placeholder="recipient@company.com" className="w-60 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              )}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Start date</span>
              <input name="startDate" type="date" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Time</span>
              <input name="sendTime" type="time" defaultValue="09:00" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Timezone</span>
              <select name="sendTz" defaultValue="America/New_York" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                {TZ_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
              Approve all &amp; schedule
            </button>
          </form>
          <p className="mt-2 text-[11px] text-neutral-400">
            Nothing sends automatically — scheduled touches wait on <Link href="/upcoming" className="underline">Upcoming</Link> for
            your &ldquo;send now,&rdquo; unless the worker is explicitly armed. Prefer to vet each touch first? Approve or reject them
            individually below, then schedule.
          </p>
        </Card>
      )}
      {launched && ca.recipient_email && (
        <p className="mb-6 text-sm text-neutral-500">
          Scheduled — sequence targeting <span className="font-medium text-neutral-700 dark:text-neutral-300">{ca.recipient_email}</span>.{" "}
          <Link href="/upcoming" className="text-blue-700 hover:underline dark:text-blue-400">See Upcoming</Link>.
        </p>
      )}

      {/* Per-recipient preview — resolve the account-angle layer against real data. */}
      {accounts.length > 0 && (
        <Card className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Personalize per recipient</h2>
            <QuerySelect
              param="preview"
              value={previewId ?? ""}
              label="Preview for"
              options={accounts.map((a) => ({ value: a.companyId, label: a.legalName }))}
            />
            <span className="text-[11px] text-neutral-400">shared paragraphs stay constant across the list; the angle below is resolved from this account&rsquo;s data</span>
          </div>
          {previewVars && previewAccount && (
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["account", previewVars.account],
                ["industry", previewVars.industry],
                ["top-fit solution", previewVars.solution],
                ["latest signal", previewVars.trigger],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400">{k}</div>
                  <div className="truncate text-neutral-700 dark:text-neutral-300" title={String(v)}>{v || "—"}</div>
                </div>
              ))}
            </div>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
              All {accounts.length} accounts in reach
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 scroll-thin dark:border-neutral-800">
              <table className="data-table">
                <thead><tr><th>Account</th><th>Top-fit solution</th><th className="text-right">Fit</th><th className="text-right">Eng.</th><th>From list</th></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.companyId}>
                      <td><Link href={`/accounts/${a.companyId}`} className="font-medium hover:underline">{a.legalName}</Link></td>
                      <td className="text-neutral-500">{a.solution ?? "—"}</td>
                      <td className="tnum text-right">{a.score ?? "—"}</td>
                      <td className="tnum text-right text-neutral-500">{a.engagement ?? "—"}</td>
                      <td className="text-[11px] text-neutral-400">{a.sources}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      )}

      {/* Touches */}
      <div className="space-y-6">
        {touches.map((t) => (
          <Card key={t.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                Touch {t.touch_no}
              </span>
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-neutral-400">
                {t.send_offset_days === 0 ? "sends first" : `+${t.send_offset_days} day${t.send_offset_days === 1 ? "" : "s"}`}
              </span>
              <span className="ml-auto"><StatusBadge status={t.status} /></span>
            </div>

            <div className="mb-3 text-sm">
              <div><span className="text-neutral-400">Subject:</span> <span className="font-medium">{t.subject}</span></div>
              {t.preheader && <div className="text-xs text-neutral-500">{t.preheader}</div>}
            </div>

            {/* Two-layer personalization: shared body (in the preview iframe) + this per-recipient angle. */}
            {previewVars && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                  Account angle · for {previewAccount?.legalName}
                </div>
                <p className="text-sm italic text-neutral-700 dark:text-neutral-300">{renderAngle(t.account_angle, previewVars)}</p>
                {!t.account_angle && <p className="mt-1 text-[11px] text-neutral-400">Using the default template — edit this touch to tailor the angle, or let AI draft it.</p>}
              </div>
            )}

            {/* Live branded preview */}
            {t.html_body && (
              <iframe
                title={`Touch ${t.touch_no} preview`}
                srcDoc={t.html_body}
                sandbox=""
                className="mb-3 h-[520px] w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800"
              />
            )}

            {t.status === "rejected" && t.rejected_reason && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                Rejected: {t.rejected_reason}
              </p>
            )}

            {/* Per-touch controls */}
            {t.status === "sent" ? (
              <p className="text-xs text-neutral-500">
                Sent {t.sent_at ? new Date(t.sent_at).toISOString().slice(0, 16).replace("T", " ") : ""}.
              </p>
            ) : t.status === "scheduled" ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-neutral-500">
                  Scheduled for {t.scheduled_at ? formatInTz(new Date(t.scheduled_at), ca.send_tz ?? "UTC") : "—"}
                </span>
                <form action={sendTouchAction.bind(null, t.id)}>
                  <button className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
                    Send now
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                {t.status !== "approved" && (
                  <>
                    <form action={approveTouchAction.bind(null, t.id)}>
                      <button className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">
                        Approve
                      </button>
                    </form>
                    <form action={rejectTouchAction.bind(null, t.id)} className="flex items-end gap-2">
                      <input name="reason" placeholder="reason (optional)" className="w-44 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                      <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                        Reject
                      </button>
                    </form>
                  </>
                )}
                {t.status === "approved" && (
                  <form action={sendTouchAction.bind(null, t.id)} className="flex items-end gap-2">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-neutral-500">Send now (skip schedule) — recipient</span>
                      {contacts.length > 0 ? (
                        <select name="to" className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                          {contacts.map((c) => (
                            <option key={c.email} value={c.email}>
                              {c.name ? `${c.name} — ${c.email}` : c.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input name="to" type="email" placeholder="recipient@company.com" required className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                      )}
                    </label>
                    <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
                      Send
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Edit / delete (unsent touches only) */}
            {t.status !== "sent" && (
              <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                    Edit copy & timing
                  </summary>
                  <form action={editTouchAction.bind(null, t.id)} className="mt-3 space-y-3">
                    <TouchFormFields t={t} />
                    <div className="flex items-center gap-3">
                      <button className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Save & re-render</button>
                      <span className="text-[11px] text-neutral-400">Editing resets a rejected touch to draft.</span>
                    </div>
                  </form>
                  <form action={deleteTouchAction.bind(null, t.id)} className="mt-2">
                    <button className="text-xs font-medium text-red-700 hover:underline dark:text-red-400">Delete touch</button>
                  </form>
                </details>
              </div>
            )}
          </Card>
        ))}

        {/* Add touches — either/or: let AI draft, or author by hand */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
            <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Add touches</span>
            <form action={aiDraftTouchesAction.bind(null, ca.id)} className="flex items-center gap-2">
              <select name="touchCount" defaultValue="3" className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:ring-blue-800 dark:hover:bg-blue-950">
                Let AI draft touches
              </button>
              <span className="text-[11px] text-neutral-400">{ca.motion_id ? "grounded in this account's motion" : "needs a linked motion"}</span>
            </form>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">+ Write a touch by hand</summary>
            <form action={addTouchAction.bind(null, ca.id)} className="mt-3 space-y-3">
              <TouchFormFields />
              <button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">Add touch</button>
            </form>
          </details>
        </Card>
      </div>
    </main>
  );
}
