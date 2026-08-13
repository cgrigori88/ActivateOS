import type pg from "pg";
import { generateThreadAlias, threadAddress } from "./alias";
import { commsConfig } from "./provider";
import { ResendProvider, resendConfigured } from "./resend";
import { editDistance } from "./text";

/**
 * Outbound orchestration. Invariants (founder decisions §3, §10, §13):
 *  - suppression is checked before EVERY send, no exceptions;
 *  - the message row is persisted BEFORE the provider is called;
 *  - only human-approved content goes out — the AI draft rides along in
 *    ai_draft and edits are logged to message_edits (learning loop);
 *  - Mode A sends "Name via PursuitOS" from the engage domain with
 *    Reply-To on the thread alias; Mode B never sends — it packages the
 *    draft for the seller's own mailbox with the thread alias on CC.
 */

export async function checkSuppression(
  db: pg.PoolClient,
  orgId: string | null,
  emails: string[],
): Promise<string[]> {
  if (emails.length === 0) return [];
  const { rows } = await db.query<{ email: string }>(
    `select email from suppression_list
     where (org_id = $1 or org_id is null) and email = any($2)`,
    [orgId, emails.map((e) => e.toLowerCase().trim())],
  );
  return rows.map((r) => r.email);
}

export async function suppress(
  db: pg.PoolClient,
  orgId: string | null,
  email: string,
  reason: "unsubscribe" | "hard_bounce" | "spam_complaint" | "manual" | "customer_policy",
): Promise<void> {
  await db.query(
    `insert into suppression_list (org_id, email, reason) values ($1, $2, $3)
     on conflict (org_id, email) do nothing`,
    [orgId, email.toLowerCase().trim(), reason],
  );
  await db.query(
    `update contacts set engagement_status = case
       when $3 in ('unsubscribe') then 'opted_out'
       when $3 in ('hard_bounce') then 'bounced'
       else 'do_not_contact' end
     where org_id = $1 and email = $2`,
    [orgId, email.toLowerCase().trim(), reason],
  );
}

export async function ensureThread(
  db: pg.PoolClient,
  args: { orgId: string | null; companyId: string; motionId: string | null; campaignId?: string | null },
): Promise<{ threadId: string; alias: string }> {
  if (args.motionId) {
    const { rows } = await db.query<{ id: string; thread_alias: string }>(
      `select id, thread_alias from communication_threads
       where motion_id = $1 and status = 'open' order by created_at desc limit 1`,
      [args.motionId],
    );
    if (rows.length > 0) return { threadId: rows[0].id, alias: rows[0].thread_alias };
  }
  const alias = generateThreadAlias();
  const { rows } = await db.query<{ id: string }>(
    `insert into communication_threads (org_id, company_id, motion_id, campaign_id, thread_alias)
     values ($1, $2, $3, $4, $5) returning id`,
    [args.orgId, args.companyId, args.motionId, args.campaignId ?? null, alias],
  );
  return { threadId: rows[0].id, alias };
}

export interface OutboundRequest {
  orgId: string | null;
  companyId: string;
  motionId: string | null;
  identity: { displayName: string; localPart: string };
  to: string[];
  /** Copied contacts. Suppressed CCs are dropped (the send proceeds); a suppressed TO refuses the send. */
  cc?: string[];
  subject: string;
  body: string; // human-approved final text
  html?: string | null; // human-approved branded HTML (campaigns); text is the fallback
  aiDraft?: string | null; // untouched AI draft, if one existed
  sellerId?: string | null;
  mode: "facilitated" | "seller_assisted";
}

export interface OutboundResult {
  threadId: string;
  messageId: string;
  status: "sent" | "draft";
  /** Mode B: what the seller needs — the CC address that captures the thread. */
  ccAddress?: string;
}

export async function sendOutbound(
  db: pg.PoolClient,
  req: OutboundRequest,
): Promise<OutboundResult> {
  const cfg = commsConfig();
  const suppressed = await checkSuppression(db, req.orgId, req.to);
  if (suppressed.length > 0) {
    throw new Error(`recipient suppressed: ${suppressed.join(", ")} — send refused`);
  }
  // CC list: normalized, deduped against TO, and suppression-FILTERED — a
  // suppressed copy drops off rather than blocking the primary send.
  const toSet = new Set(req.to.map((e) => e.toLowerCase().trim()));
  let ccList = [...new Set((req.cc ?? []).map((e) => e.toLowerCase().trim()).filter((e) => e && !toSet.has(e)))];
  if (ccList.length > 0) {
    const ccSuppressed = new Set(await checkSuppression(db, req.orgId, ccList));
    ccList = ccList.filter((e) => !ccSuppressed.has(e));
  }

  const { threadId, alias } = await ensureThread(db, {
    orgId: req.orgId,
    companyId: req.companyId,
    motionId: req.motionId,
  });
  const replyTo = threadAddress(alias, cfg.threadsDomain);
  const fromEmail = `${req.identity.localPart}+${alias.replace(/^m_/, "")}@${cfg.outboundDomain}`;

  // Persist FIRST — the provider call may fail; the record must not.
  const { rows: msgRows } = await db.query<{ id: string }>(
    `insert into messages (thread_id, direction, from_email, from_name, to_emails, cc_emails,
        subject, text_body, html_body, ai_draft, status)
     values ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      threadId,
      req.mode === "facilitated" ? fromEmail : "seller-mailbox",
      req.identity.displayName,
      req.to,
      req.mode === "seller_assisted" ? [...ccList, replyTo] : ccList,
      req.subject,
      req.body,
      req.html ?? null,
      req.aiDraft ?? null,
      req.mode === "facilitated" ? "queued" : "draft",
    ],
  );
  const messageId = msgRows[0].id;

  // Human edits are training data (founder decision §11).
  if (req.aiDraft && req.aiDraft !== req.body) {
    await db.query(
      `insert into message_edits (message_id, ai_original, human_final, edit_distance, seller_id)
       values ($1, $2, $3, $4, $5)`,
      [messageId, req.aiDraft, req.body, editDistance(req.aiDraft, req.body), req.sellerId ?? null],
    );
  }

  if (req.mode === "seller_assisted") {
    // Mode B: PursuitOS drafts; the seller sends from their own mailbox and
    // CCs the thread address so the conversation is captured.
    return { threadId, messageId, status: "draft", ccAddress: replyTo };
  }

  if (!resendConfigured()) {
    await db.query(`update messages set status = 'failed' where id = $1`, [messageId]);
    throw new Error("RESEND_API_KEY not configured — message persisted as failed, nothing sent");
  }

  const provider = new ResendProvider();
  const result = await provider.send({
    from: { name: `${req.identity.displayName} via PursuitOS`, email: fromEmail },
    to: req.to,
    cc: ccList.length > 0 ? ccList : undefined,
    replyTo,
    subject: req.subject,
    text: req.body,
    html: req.html ?? undefined,
  });

  await db.query(
    `update messages set provider_message_id = $2, status = 'sent', sent_at = now() where id = $1`,
    [messageId, result.providerMessageId],
  );
  await db.query(
    `insert into email_events (message_id, thread_id, event_type, payload)
     values ($1, $2, 'SENT', $3)`,
    [messageId, threadId, JSON.stringify({ provider: "resend" })],
  );
  await db.query(
    `insert into interaction_events (org_id, company_id, motion_id, actor, type, channel, payload)
     values ($1, $2, $3, $4, 'MESSAGE_SENT', 'EMAIL', $5)`,
    [
      req.orgId,
      req.companyId,
      req.motionId,
      req.identity.displayName,
      JSON.stringify({ threadId, messageId }),
    ],
  );
  return { threadId, messageId, status: "sent" };
}
