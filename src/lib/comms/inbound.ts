import type pg from "pg";
import { analyzeReply } from "../agents/conversation";
import { crossCheckLLM } from "../agents/extractor";
import { mapSignals } from "../agents/taxonomy-mapper";
import { verifyEvidence } from "../quality/verify";
import { scoreOrg } from "../scoring/score";
import type { InboundMessage } from "./provider";
import { commsConfig } from "./provider";
import { suppress } from "./send";
import { resolveThread, type ThreadCandidateIndex } from "./threading";
import { participantsSubjectKey } from "./threading";
import { stripQuoted } from "./text";

/**
 * Inbound flow (founder decision §7): verify webhook → PERSIST RAW →
 * resolve thread deterministically → normalize participants → strip quotes →
 * conversation agent → evidence through the standard quality gates →
 * signals → rescore (what-changed surfaces automatically) → recommended
 * action into the queue. The LLM never touches an unpersisted payload and
 * never decides thread ownership.
 */

const CUSTOMER_EMAIL_TRUST = 0.9; // first-party: the customer said it themselves

async function buildIndex(db: pg.PoolClient): Promise<ThreadCandidateIndex> {
  const byAlias = new Map<string, string>();
  const byInternetMessageId = new Map<string, string>();
  const byProviderMessageId = new Map<string, string>();
  const byParticipantsSubject = new Map<string, string>();

  const { rows: threads } = await db.query<{ id: string; thread_alias: string }>(
    `select id, thread_alias from communication_threads where status = 'open'`,
  );
  for (const t of threads) byAlias.set(t.thread_alias, t.id);

  const { rows: msgs } = await db.query<{
    thread_id: string;
    internet_message_id: string | null;
    provider_message_id: string | null;
    from_email: string;
    to_emails: string[];
    cc_emails: string[];
    subject: string | null;
  }>(
    `select thread_id, internet_message_id, provider_message_id,
            from_email, to_emails, cc_emails, subject
     from messages order by created_at desc limit 2000`,
  );
  for (const m of msgs) {
    if (m.internet_message_id && !byInternetMessageId.has(m.internet_message_id)) {
      byInternetMessageId.set(m.internet_message_id, m.thread_id);
    }
    if (m.provider_message_id && !byProviderMessageId.has(m.provider_message_id)) {
      byProviderMessageId.set(m.provider_message_id, m.thread_id);
    }
    const key = participantsSubjectKey(
      [m.from_email, ...m.to_emails, ...m.cc_emails],
      m.subject,
    );
    if (!byParticipantsSubject.has(key)) byParticipantsSubject.set(key, m.thread_id);
  }
  return { byAlias, byInternetMessageId, byProviderMessageId, byParticipantsSubject };
}

export interface InboundOutcome {
  status: "processed" | "triaged";
  threadId?: string;
  messageId?: string;
  responseType?: string;
  claimsVerified?: number;
  rescored?: boolean;
}

export async function processInboundMessage(
  db: pg.PoolClient,
  msg: InboundMessage,
  opts: { runIntelligence?: boolean; targetSlug?: string } = {},
): Promise<InboundOutcome> {
  const runIntelligence = opts.runIntelligence ?? true;

  const index = await buildIndex(db);
  const match = resolveThread(msg, index, commsConfig().threadsDomain);
  if (!match) {
    await db.query(
      `insert into inbound_triage (reason, payload) values ($1, $2)`,
      ["no deterministic thread match", JSON.stringify(msg)],
    );
    return { status: "triaged" };
  }

  const { rows: threadRows } = await db.query<{
    id: string;
    org_id: string | null;
    company_id: string;
    motion_id: string | null;
  }>(`select id, org_id, company_id, motion_id from communication_threads where id = $1`, [
    match.threadId,
  ]);
  const thread = threadRows[0];

  // 1. Persist raw FIRST.
  const { rows: msgRows } = await db.query<{ id: string }>(
    `insert into messages (thread_id, direction, provider_message_id, internet_message_id,
        from_email, from_name, to_emails, cc_emails, subject, text_body, html_body,
        status, received_at, raw_headers, attachment_count)
     values ($1, 'inbound', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'stored', $11, $12, $13)
     returning id`,
    [
      thread.id,
      msg.providerMessageId,
      msg.internetMessageId,
      msg.from.email,
      msg.from.name,
      msg.to,
      msg.cc,
      msg.subject,
      msg.textBody,
      msg.htmlBody,
      msg.receivedAt,
      JSON.stringify(msg.rawHeaders),
      msg.attachmentCount,
    ],
  );
  const messageId = msgRows[0].id;

  // 2. Normalize participants; the sender becomes/updates a contact.
  const { rows: contactRows } = await db.query<{ id: string }>(
    `insert into contacts (org_id, company_id, email, name, engagement_status)
     values ($1, $2, $3, $4, 'engaged')
     on conflict (org_id, email) do update
       set engagement_status = 'engaged', name = coalesce(contacts.name, excluded.name)
     returning id`,
    [thread.org_id, thread.company_id, msg.from.email, msg.from.name],
  );
  await db.query(
    `insert into message_participants (message_id, contact_id, email, role)
     values ($1, $2, $3, 'from') on conflict do nothing`,
    [messageId, contactRows[0].id, msg.from.email],
  );
  for (const [role, list] of [
    ["to", msg.to],
    ["cc", msg.cc],
  ] as const) {
    for (const email of list) {
      await db.query(
        `insert into message_participants (message_id, email, role)
         values ($1, $2, $3) on conflict do nothing`,
        [messageId, email, role],
      );
    }
  }

  await db.query(
    `insert into email_events (message_id, thread_id, event_type, payload)
     values ($1, $2, 'REPLIED', $3)`,
    [messageId, thread.id, JSON.stringify({ matchedBy: match.matchedBy })],
  );
  await db.query(
    `insert into interaction_events (org_id, company_id, motion_id, contact_id, actor, type, channel, payload)
     values ($1, $2, $3, $4, 'customer', 'REPLY_RECEIVED', 'EMAIL', $5)`,
    [
      thread.org_id,
      thread.company_id,
      thread.motion_id,
      contactRows[0].id,
      JSON.stringify({ threadId: thread.id, messageId }),
    ],
  );

  if (!runIntelligence || !msg.textBody) {
    return { status: "processed", threadId: thread.id, messageId };
  }

  // 3. Conversation intelligence on the stripped reply.
  const replyText = stripQuoted(msg.textBody);
  const { rows: companyRows } = await db.query<{ legal_name: string }>(
    `select legal_name from companies where id = $1`,
    [thread.company_id],
  );
  const { rows: motionRows } = thread.motion_id
    ? await db.query<{ thesis: string | null }>(
        `select thesis from revenue_motions where id = $1`,
        [thread.motion_id],
      )
    : { rows: [] as { thesis: string | null }[] };

  const findings = await analyzeReply(db, {
    orgId: thread.org_id,
    companyName: companyRows[0].legal_name,
    motionThesis: motionRows[0]?.thesis ?? null,
    replyText,
  });

  if (findings.response_type === "UNSUBSCRIBE") {
    await suppress(db, thread.org_id, msg.from.email, "unsubscribe");
    await db.query(
      `insert into email_events (message_id, thread_id, event_type)
       values ($1, $2, 'UNSUBSCRIBED')`,
      [messageId, thread.id],
    );
    return { status: "processed", threadId: thread.id, messageId, responseType: "UNSUBSCRIBE" };
  }

  // 4. First-party evidence, through the SAME quality gates as web research.
  await db.query(
    `insert into signal_sources (name, kind, trust_score)
     values ('customer_email', 'first_party', $1)
     on conflict (name) do nothing`,
    [CUSTOMER_EMAIL_TRUST],
  );
  let claimsVerified = 0;
  for (const c of findings.evidence_claims) {
    const { rows } = await db.query<{ id: string }>(
      `insert into evidence (org_id, company_id, source_type, claim, raw_excerpt, confidence, observed_at)
       values ($1, $2, 'customer_email', $3, $4, 0.95, $5)
       returning id`,
      [thread.org_id, thread.company_id, c.claim, c.excerpt, msg.receivedAt],
    );
    const outcome = await verifyEvidence(
      db,
      {
        id: rows[0].id,
        orgId: thread.org_id,
        companyId: thread.company_id,
        sourceName: "customer_email",
        claim: c.claim,
        rawExcerpt: c.excerpt,
        observedAt: msg.receivedAt,
        extractionConfidence: 0.95,
      },
      { crossCheck: crossCheckLLM },
    );
    if (outcome.status === "verified") claimsVerified++;
  }

  // 5. New evidence → signals → rescore; "what changed" surfaces it.
  let rescored = false;
  if (claimsVerified > 0 && thread.org_id) {
    await mapSignals(db, thread.org_id, { useLLM: Boolean(process.env.ANTHROPIC_API_KEY) });
    await scoreOrg(db, thread.org_id, opts.targetSlug ?? "infrastructure-automation");
    rescored = true;
  }

  // 6. The conversation generates work, not just records.
  const action = findings.recommended_next_action;
  await db.query(
    `insert into communication_actions (org_id, thread_id, motion_id, title, detail, due_at, confidence)
     values ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)`,
    [
      thread.org_id,
      thread.id,
      thread.motion_id,
      action.title,
      action.detail,
      action.due_in_days,
      action.confidence,
    ],
  );

  return {
    status: "processed",
    threadId: thread.id,
    messageId,
    responseType: findings.response_type,
    claimsVerified,
    rescored,
  };
}
