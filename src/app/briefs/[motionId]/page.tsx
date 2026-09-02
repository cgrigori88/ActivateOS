import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { commsConfig } from "@/lib/comms/provider";
import { resendConfigured } from "@/lib/comms/resend";
import { threadAddress } from "@/lib/comms/alias";
import { BackLink, Card, EvidenceLine, PageHeader, StatusBadge, BlockLabel } from "@/components/ui";
import { CONFIDENCE_FORMULA, contextConfidence } from "@/lib/context/confidence";
import { promoteMotionAction } from "@/app/pipeline/actions";
import { generateDraftAction, sendDraftAction } from "./actions";
import { formatMoney } from "@/lib/format/money";
import { buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const data = await withTenant(async (db, orgId) => {
    const { rows: motions } = await db.query(
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
    if (motions.length === 0) return null;
    const m = motions[0];

    const { rows: cited } = await db.query(
      `select distinct e.id, e.claim, e.source_type, e.observed_at
     from agent_runs r
     cross join lateral unnest(r.input_evidence_ids) as ev(id)
     join evidence e on e.id = ev.id
     where r.motion_id = $1 and e.status = 'verified'
     order by e.observed_at desc limit 12`,
      [motionId],
    );

    const { rows: assets } = await db.query(
      `select a.asset_type, a.title, a.content
     from campaign_assets a join campaigns cp on cp.id = a.campaign_id
     where cp.motion_id = $1 order by a.created_at`,
      [motionId],
    );

    const { rows: steps } = await db.query(
      `select step, action, due_at, status from motion_actions
     where motion_id = $1 order by step`,
      [motionId],
    );

    const { rows: threads } = await db.query(
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
      const result = await db.query(
        `select id, direction, from_name, from_email, subject, text_body, ai_draft,
              status, to_emails, created_at
       from messages where thread_id = $1 order by created_at`,
        [thread.id],
      );
      threadMessages = result.rows;
    }

    // Confidence stamp: how trustworthy the record behind this brief is, at a glance.
    const confidence = await contextConfidence(db, orgId, m.company_id);

    return { m, cited, assets, steps, thread, threadMessages, confidence };
  });
  if (!data) return <main>Unknown motion.</main>;
  const { m, cited, assets, steps, thread, threadMessages, confidence } = data;

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
      {/* Both nav links share the pos-backlink treatment so they sit on one
          baseline at the same size/weight — ← back on the left, forward → on
          the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/motions" label="Motions" />
        <Link href={`/accounts/${m.company_id}`} className="pos-backlink">
          {m.legal_name} account
          <span aria-hidden>→</span>
        </Link>
      </div>
      <PageHeader
        title={`Activation brief — ${m.legal_name}`}
        subtitle={`${m.slug} · ${m.industry ?? ""}${m.employee_count ? ` · ~${m.employee_count} employees` : ""}`}
      />
      {confidence && (
        <p className="-mt-3 mb-4 text-body text-neutral-500" title={CONFIDENCE_FORMULA}>
          Grounded in a record at <b className={confidence.score >= 70 ? "text-emerald-700 dark:text-emerald-400" : confidence.score >= 40 ? "text-amber-700 dark:text-amber-400" : "text-rose-700 dark:text-rose-400"}>context confidence {confidence.score}</b> — {confidence.verifiedN} verified claims across {confidence.sourceTypes} source type{confidence.sourceTypes === 1 ? "" : "s"}{confidence.freshDays != null ? `, newest ${confidence.freshDays === 0 ? "today" : `${confidence.freshDays}d ago`}` : ""}.
        </p>
      )}

      <Card className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <StatusBadge status={m.status} />
          {m.propensity != null && (
            <span className="text-copy text-neutral-500">
              propensity {Number(m.propensity).toFixed(0)} ({m.band})
            </span>
          )}
          {m.estimated_value_usd != null && (
            <span className="text-copy text-neutral-500">
              · ~{formatMoney(Number(m.estimated_value_usd))} estimated
            </span>
          )}
          {m.partner_name && (
            <span className="ml-auto text-copy font-medium">
              {m.partner_name}
              {m.seller_name && ` / ${m.seller_name}`}
            </span>
          )}
        </div>
        <BlockLabel>
          Why this account, why now
        </BlockLabel>
        <p className="mb-3 leading-relaxed">{m.thesis}</p>
        <p className="text-copy text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">Trigger: </span>
          {m.trigger_summary}
        </p>
        <p className="text-copy text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">Personas: </span>
          {m.primary_persona} · {m.secondary_persona}
        </p>
        <p className="text-copy text-neutral-600 dark:text-neutral-400">
          <span className="font-medium text-neutral-800 dark:text-neutral-200">The ask: </span>
          {m.cta}
        </p>
        {m.status === "active" && (
          <form action={promoteMotionAction.bind(null, motionId)} className="mt-3">
            <button
              type="submit"
              className={buttonClass("primary", "md")}
            >
              Promote to opportunity
            </button>
          </form>
        )}
      </Card>

      {/* Every brief shows the same sections — a section with nothing in it
          explains where its content comes from, rather than vanishing and
          making two briefs look like two different products. */}
      <Card className="mb-6">
        <BlockLabel>
          Evidence behind this motion
        </BlockLabel>
        {cited.length > 0 ? (
          <ul className="ml-4 list-disc space-y-1">
            {cited.map((e) => (
              <EvidenceLine
                key={e.id}
                claim={e.claim}
                meta={`${e.source_type}, ${new Date(e.observed_at).toISOString().slice(0, 10)}`}
              />
            ))}
          </ul>
        ) : (
          <p className="text-copy text-neutral-400">
            No cited evidence on this motion yet — citations attach when the AI designer grounds a
            motion in verified evidence, or as research on{" "}
            <Link href={`/accounts/${m.company_id}`} className="text-accent hover:underline dark:text-blue-400">
              the account
            </Link>{" "}
            verifies new claims.
          </p>
        )}
      </Card>

      <Card className="mb-6">
        <BlockLabel>
          Cadence
        </BlockLabel>
        {steps.length === 0 ? (
          <p className="text-copy text-neutral-400">
            No cadence yet — dated pursuit steps are generated when the motion is activated with a
            pursuit plan, and they land in the{" "}
            <Link href="/queue" className="text-accent hover:underline dark:text-blue-400">
              action queue
            </Link>{" "}
            as they come due.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {steps.map((s) => (
              <li key={s.step} className="flex items-center gap-3 text-copy">
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
                <span className="ml-auto shrink-0 text-body text-neutral-400">
                  {s.status === "pending"
                    ? `due ${new Date(s.due_at).toISOString().slice(0, 10)}`
                    : s.status}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mb-6">
        <BlockLabel>
          Conversation
        </BlockLabel>
        {!["approved", "active"].includes(m.status) && threadMessages.length === 0 ? (
          <p className="text-copy text-neutral-400">
            {m.status === "completed"
              ? "This motion is completed — no conversation was captured on it."
              : "Outreach opens when the motion is approved — then a 1:1 draft can be generated and sent (or packaged for the partner seller), with replies captured on a thread alias."}
          </p>
        ) : (
        <>
          {thread && (
            <p className="mb-3 text-body text-neutral-500">
              Thread alias:{" "}
              <code className="rounded-inner bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                {threadAddress(thread.thread_alias, cfg.threadsDomain)}
              </code>{" "}
              — seller-sent replies CC this address to be captured.
            </p>
          )}

          {sentOrStored.map((msg) => (
            <div
              key={msg.id}
              className={`mb-3 rounded-inner p-3 text-copy ${
                msg.direction === "inbound"
                  ? "bg-sky-50 dark:bg-sky-950"
                  : "bg-neutral-50 dark:bg-neutral-950"
              }`}
            >
              <p className="mb-1 text-body text-neutral-500">
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
              className="mb-3 rounded-inner border border-amber-200 bg-amber-50 p-3 text-copy dark:border-amber-900 dark:bg-amber-950"
            >
              <p className="mb-1 text-body font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Ready for seller — send from your own mailbox
              </p>
              <p className="mb-2 text-body text-neutral-600 dark:text-neutral-400">
                To: {msg.to_emails.join(", ")} · CC{" "}
                <code className="rounded-inner bg-white/60 px-1 dark:bg-black/30">
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
              <p className="text-body font-medium uppercase tracking-wide text-neutral-500">
                AI draft — review, edit, then approve
              </p>
              <input
                name="to"
                type="email"
                required
                placeholder="recipient@customer.com"
                className="w-full rounded-control border border-neutral-300 bg-transparent px-3 py-1.5 text-copy dark:border-neutral-700"
              />
              <input
                name="subject"
                defaultValue={draft.subject ?? ""}
                required
                className="w-full rounded-control border border-neutral-300 bg-transparent px-3 py-1.5 text-copy font-medium dark:border-neutral-700"
              />
              <textarea
                name="body"
                defaultValue={draft.text_body ?? ""}
                required
                rows={10}
                className="w-full rounded-control border border-neutral-300 bg-transparent px-3 py-2 text-copy leading-relaxed dark:border-neutral-700"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  name="mode"
                  value="facilitated"
                  disabled={!canSendDirect}
                  className={buttonClass("primary", "md")}
                >
                  Approve &amp; send via PursuitOS
                </button>
                <button
                  type="submit"
                  name="mode"
                  value="seller_assisted"
                  className={buttonClass("primary", "md")}
                >
                  Package for seller
                </button>
              </div>
              {/* Wave 4 §6/§11: this named an environment variable to a commercial
                  operator — "until Resend is configured (RESEND_API_KEY)". The vendor
                  and the secret are implementation; what the reader needs is the
                  business state, whether it blocks them, and what still works. The
                  limitation is not softened: sending is off, and the copy says so
                  plainly rather than hinting it might already work. */}
              {!canSendDirect && (
                <p className="text-body text-neutral-400">
                  <b className="ink-muted">External sending is not configured</b>, so PursuitOS cannot
                  send anything from here. “Package for seller” prepares the outreach for a person to
                  send. An administrator can enable direct sending in <Link href="/admin" className="underline">Admin</Link>.
                </p>
              )}
            </form>
          ) : ["approved", "active"].includes(m.status) ? (
            <form action={generateDraftAction.bind(null, motionId)}>
              <button
                type="submit"
                className={buttonClass("primary", "md")}
              >
                Generate outreach draft
              </button>
              <p className="mt-2 text-label text-neutral-400">
                A single 1:1 email for this motion&apos;s conversation — review, then send via
                PursuitOS or package for the partner seller; replies are captured here. For
                one-to-many sequenced sends, use a{" "}
                <Link href="/campaigns" className="text-accent hover:underline dark:text-blue-400">
                  campaign
                </Link>
                .
              </p>
            </form>
          ) : null}
        </>
        )}
      </Card>

      {assets.length > 0 && (
        <Card>
          <BlockLabel>
            Campaign assets
          </BlockLabel>
          {assets.map((a) => (
            <details key={a.asset_type} className="mb-2" open={a.asset_type === "outreach_email"}>
              <summary className="cursor-pointer text-copy font-medium hover:underline">
                {a.title}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-inner bg-neutral-50 p-3 font-sans text-copy leading-relaxed dark:bg-neutral-950">
                {a.content}
              </pre>
            </details>
          ))}
        </Card>
      )}
    </main>
  );
}
