import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { approveTouchAction, rejectTouchAction, sendTouchAction } from "./actions";

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
  cta_label: string | null;
  send_offset_days: number;
  rejected_reason: string | null;
  sent_at: Date | null;
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();

  const { rows: caRows } = await pool.query<{
    id: string;
    name: string;
    status: string;
    objective: string | null;
    audience: string | null;
    company_id: string;
    legal_name: string;
    primary_domain: string | null;
    motion_id: string;
    wordmark: string | null;
  }>(
    `select ca.id, ca.name, ca.status, ca.objective, ca.audience,
            c.id as company_id, c.legal_name, c.primary_domain, m.id as motion_id,
            bp.wordmark
     from campaigns ca
     join revenue_motions m on m.id = ca.motion_id
     join companies c on c.id = m.company_id
     left join brand_profiles bp on bp.id = ca.brand_id
     where ca.id = $1`,
    [id],
  );
  if (caRows.length === 0) notFound();
  const ca = caRows[0];

  const { rows: touches } = await pool.query<Touch>(
    `select id, touch_no, name, subject, preheader, headline, status, html_body,
            cta_label, send_offset_days, rejected_reason, sent_at
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

  return (
    <main>
      <div className="mb-1 text-xs text-neutral-400">
        <Link href="/campaigns" className="hover:underline">Campaigns</Link> ›{" "}
        <Link href={`/accounts/${ca.company_id}`} className="hover:underline">{ca.legal_name}</Link>
      </div>
      <PageHeader title={ca.name} subtitle={ca.objective ?? undefined} />

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
                      <span className="mb-1 block text-xs text-neutral-500">Recipient</span>
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
          </Card>
        ))}
      </div>
    </main>
  );
}
