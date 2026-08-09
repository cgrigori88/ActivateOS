import Link from "next/link";
import { getPool } from "@/db/client";
import { commsConfig } from "@/lib/comms/provider";
import { resendConfigured } from "@/lib/comms/resend";
import { threadAddress } from "@/lib/comms/alias";
import { Card, EvidenceLine, PageHeader, StatusBadge } from "@/components/ui";
import { generateDraftAction, sendDraftAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Activation Brief (BLUEPRINT Phase 4): everything a partner seller needs to
 * work one motion, on one page — why this account, why now, the evidence,
 * who pursues, what to send, what to say, and the dated cadence. Grounded
 * top to bottom in verified evidence and the approved motion.
 */
export default async function BriefPage({
  params,
}: {
  params: Promise<{ motionId: string }>;
}) {
  const { motionId } = await params;
  const pool = getPool();

  const { rows: motions } = await pool.query(
    `select m.*, c.legal_name, c.industry, c.employee_count, c.id as company_id,
            n.slug, pa.name as partner_name, pa.partner_type, s.name as seller_name,
            p.score as propensity, p.band
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     left join partners pa on pa.id = m.partner_id
     left join sellers s on s.id = m.partner_seller_id
     left join propensity_scores p on p.id = m.propensity_score_id
     where m.id = $1`,
    [motionId],
  );
  if (motions.length === 0) return <main>Unknown motion.</main>;
  const m = motions[0];

  const { rows: cited } = await pool.query(
    `select distinct e.id, e.claim, e.source_type, e.observed_at
     from agent_runs r
     cross join lateral unnest(r.input_evidence_ids) as ev(id)
     join evidence e on e.id = ev.id
     where r.motion_id = $1 and e.status = 'verified'
     order by e.observed_at desc limit 12`,
    [motionId],
  );

  const { rows: assets } = await pool.query(
    `select a.asset_type, a.title, a.content
     from campaign_assets a join campaigns cp on cp.id = a.campaign_id
     where cp.motion_id = $1 order by a.created_at`,
    [motionId],
  );

  const { rows: steps } = await pool.query(
    `select step, action, due_at, status from motion_actions
     where motion_id = $1 order by step`,
    [motionId],
  );

  const { rows: threads } = await pool.query(
    `select id, thread_alias from communication_threads
     where motion_id = $1 and status = 'open' order by created_at desc limit 1`,
    [motionId],
  );
  const thread = threads[0] ?? null;
  let threadMessages: {
    id: string;
    direction: string;
    from_name: string | null;
    from_email: string;
    subject: string | null;
    text_body: string | null;
    ai_draft: string | null;
    status: string;
    to_emails: string[];
    created_at: Date;
  }[] = [];
  if (thread) {
    const result = await pool.query(
      `select id, direction, from_name, from_email, subject, text_body, ai_draft,
              status, to_emails, created_at
       from messages where thread_id = $1 order by created_at`,
      [thread.id],
    );
    threadMessages = result.rows;
  }
  const draft = threadMessages.find(
    (x) => x.direction === "outbound" && x.status === "draft" && x.from_email === "pending",
  );
  const packaged = threadMessages.filter(
    (x) => x.status === "draft" && x.from_email === "seller-mailbox",
  );
  const sentOrStored = threadMessages.filter((x) => x.status !== "draft");
  const cfg = commsConfig();
  const canSendDirect = resendConfigured();

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href={`/accounts/${m.company_id}`} className="text-neutral-500 hover:underline">
          ← {m.legal_name}
        </Link>
      </p>
      <PageHeader
        title={`Activation brief — ${m.legal_name}`}
        subtitle={`${m.slug} · ${m.industry ?? ""}${m.employee_count ? ` · ~${m.employee_count} employees` : ""}`}
      />

      <Card className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <StatusBadge status={m.status} />
          {m.propensity != null && (
            <span className="text-sm text-neutral-500">
              propensity {Number(m.propensity).toFixed(0)} ({m.band})
            </span>
          )}
          {m.estimated_value_usd != null && (
            <span className="text-sm text-neutral-500">
              · ~${Math.round(Number(m.estimated_value_usd) / 1000)}k estimated
            </span>
          )}
          {m.partner_name && (
            <span className="ml-auto text-sm font-medium">
              {m.partner_name}
              {m.seller_name && ` / ${m.seller_name}`}
            </span>
          )}
        </div>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Why this account, why now
        </h2>
        <p className="mb-3 leading-relaxed">{m.thesis}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">Trigger: </span>
          {m.trigger_summary}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">Personas: </span>
          {m.primary_persona} · {m.secondary_persona}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">The ask: </span>
          {m.cta}
        </p>
      </Card>

      {cited.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Evidence behind this motion
          </h2>
          <ul className="ml-4 list-disc space-y-1">
            {cited.map((e) => (
              <EvidenceLine
                key={e.id}
                claim={e.claim}
                meta={`${e.source_type}, ${new Date(e.observed_at).toISOString().slice(0, 10)}`}
              />
            ))}
          </ul>
        </Card>
      )}

      {steps.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Cadence
          </h2>
          <ol className="space-y-1.5">
            {steps.map((s) => (
              <li key={s.step} className="flex items-center gap-3 text-sm">
                <span className="tnum w-5 text-right font-semibold text-neutral-400">
                  {s.step}
                </span>
                <span
                  className={
                    s.status === "done"
                      ? "text-neutral-400 line-through"
                      : s.status === "skipped"
                        ? "text-neutral-400"
                        : ""
                  }
                >
                  {s.action}
                </span>
                <span className="ml-auto shrink-0 text-xs text-neutral-400">
                  {s.status === "pending"
                    ? `due ${new Date(s.due_at).toISOString().slice(0, 10)}`
                    : s.status}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {["approved", "active"].includes(m.status) && (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Conversation
          </h2>
          {thread && (
            <p className="mb-3 text-xs text-neutral-500">
              Thread alias:{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                {threadAddress(thread.thread_alias, cfg.threadsDomain)}
              </code>{" "}
              — seller-sent replies CC this address to be captured.
            </p>
          )}

          {sentOrStored.map((msg) => (
            <div
              key={msg.id}
              className={`mb-3 rounded-lg p-3 text-sm ${
                msg.direction === "inbound"
                  ? "bg-sky-50 dark:bg-sky-950"
                  : "bg-neutral-50 dark:bg-neutral-950"
              }`}
            >
              <p className="mb-1 text-xs text-neutral-500">
                {msg.direction === "inbound" ? "← " : "→ "}
                <span className="font-medium">{msg.from_name ?? msg.from_email}</span>
                {msg.to_emails.length > 0 && ` to ${msg.to_emails.join(", ")}`} ·{" "}
                {new Date(msg.created_at).toISOString().slice(0, 10)} · {msg.status}
              </p>
              {msg.subject && <p className="font-medium">{msg.subject}</p>}
              <pre className="mt-1 whitespace-pre-wrap font-sans leading-relaxed">
                {msg.text_body}
              </pre>
            </div>
          ))}

          {packaged.map((msg) => (
            <div
              key={msg.id}
              className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Ready for seller — send from your own mailbox
              </p>
              <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
                To: {msg.to_emails.join(", ")} · CC{" "}
                <code className="rounded bg-white/60 px-1 dark:bg-black/30">
                  {thread && threadAddress(thread.thread_alias, cfg.threadsDomain)}
                </code>{" "}
                so PursuitOS captures the conversation.
              </p>
              <p className="font-medium">{msg.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans leading-relaxed">
                {msg.text_body}
              </pre>
            </div>
          ))}

          {draft ? (
            <form action={sendDraftAction.bind(null, motionId)} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                AI draft — review, edit, then approve
              </p>
              <input
                name="to"
                type="email"
                required
                placeholder="recipient@customer.com"
                className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-700"
              />
              <input
                name="subject"
                defaultValue={draft.subject ?? ""}
                required
                className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm font-medium dark:border-neutral-700"
              />
              <textarea
                name="body"
                defaultValue={draft.text_body ?? ""}
                required
                rows={10}
                className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm leading-relaxed dark:border-neutral-700"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  name="mode"
                  value="facilitated"
                  disabled={!canSendDirect}
                  className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Approve &amp; send via PursuitOS
                </button>
                <button
                  type="submit"
                  name="mode"
                  value="seller_assisted"
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-700 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                >
                  Package for seller
                </button>
              </div>
              {!canSendDirect && (
                <p className="text-xs text-neutral-400">
                  Direct sending is disabled until Resend is configured (RESEND_API_KEY) —
                  “Package for seller” works now.
                </p>
              )}
            </form>
          ) : (
            <form action={generateDraftAction.bind(null, motionId)}>
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
              >
                Generate outreach draft
              </button>
            </form>
          )}
        </Card>
      )}

      {assets.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Campaign assets
          </h2>
          {assets.map((a) => (
            <details key={a.asset_type} className="mb-2" open={a.asset_type === "outreach_email"}>
              <summary className="cursor-pointer text-sm font-medium hover:underline">
                {a.title}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 font-sans text-sm leading-relaxed dark:bg-neutral-950">
                {a.content}
              </pre>
            </details>
          ))}
        </Card>
      )}
    </main>
  );
}
