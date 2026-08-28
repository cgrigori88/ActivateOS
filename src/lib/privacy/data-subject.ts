import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { audit } from "@/lib/partnerships/partnerships";

type Db = Pool | PoolClient;

/**
 * GDPR data-subject rights (RISK-2): per-person export (Art. 20) and erasure
 * (Art. 17) over the CRM personal data a tenant controls — the people it
 * tracks, not its own platform users.
 *
 * Scope and why:
 *  - Covered tables carry a data subject's identifiable data keyed by email:
 *    `contacts` (buying committee), `sellers` (partner/vendor reps),
 *    `messages` (email correspondence, org-scoped via its thread), and
 *    `meeting_notes` (free-text attendees/body).
 *  - NOT covered here: `org_members` / Supabase `auth.users` — those are the
 *    tenant's own platform accounts; erasing one is account closure, a
 *    different flow (remove the member on Admin, delete the auth user).
 *
 * Erasure is anonymize-in-place, not row deletion: `contacts` and `sellers`
 * are referenced by many FKs (opportunities, motions, engagement, teams).
 * Nulling/tombstoning the identifiers removes the personal data while keeping
 * the non-personal business record and its relationships intact — an accepted
 * Art. 17 approach. Everything runs in ONE transaction; the audit trail stores
 * a SHA-256 of the email, never the email itself, so the log can't re-introduce
 * the PII it just erased.
 *
 * Tenant scoping is mandatory on every query: an owner can only reach data
 * subjects inside their own org.
 */

export type DataSubjectSummary = {
  email: string;
  contacts: number;
  sellers: number;
  messagesAuthored: number;   // messages the subject sent (from_email)
  messagesRecipient: number;  // messages where the subject is a to/cc recipient
  meetingNotes: number;       // notes naming the subject in attendees/body
  total: number;
};

export type DataSubjectExport = {
  subject: string;
  org_id: string;
  generated_at: string;
  note: string;
  records: {
    contacts: Record<string, unknown>[];
    sellers: Record<string, unknown>[];
    messages: Record<string, unknown>[];
    meeting_notes: Record<string, unknown>[];
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize + validate; throws on a non-email so callers fail loud. */
export function normalizeEmail(raw: string): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address to identify the data subject.");
  return email;
}

function emailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

/**
 * Count what a request would touch, per table — the preview an owner sees
 * before erasing. Read-only, tenant-scoped.
 */
export async function findDataSubject(db: Db, orgId: string, rawEmail: string): Promise<DataSubjectSummary> {
  const email = normalizeEmail(rawEmail);
  const { rows } = await db.query<{
    contacts: string; sellers: string; msg_from: string; msg_rcpt: string; notes: string;
  }>(
    `select
       (select count(*) from contacts c where c.org_id = $1 and lower(c.email) = $2) as contacts,
       (select count(*) from sellers s where s.org_id = $1 and lower(s.email) = $2) as sellers,
       (select count(*) from messages m join communication_threads t on t.id = m.thread_id
          where t.org_id = $1 and lower(m.from_email) = $2) as msg_from,
       (select count(*) from messages m join communication_threads t on t.id = m.thread_id
          where t.org_id = $1 and exists (
            select 1 from unnest(m.to_emails || m.cc_emails) as e where lower(e) = $2
          )) as msg_rcpt,
       (select count(*) from meeting_notes n where n.org_id = $1
          and (n.attendees ilike '%' || $3 || '%' or n.body ilike '%' || $3 || '%')) as notes`,
    [orgId, email, email],
  );
  const r = rows[0];
  const contacts = Number(r.contacts);
  const sellers = Number(r.sellers);
  const messagesAuthored = Number(r.msg_from);
  const messagesRecipient = Number(r.msg_rcpt);
  const meetingNotes = Number(r.notes);
  return {
    email,
    contacts,
    sellers,
    messagesAuthored,
    messagesRecipient,
    meetingNotes,
    total: contacts + sellers + messagesAuthored + messagesRecipient + meetingNotes,
  };
}

/**
 * Portable export (Art. 20): every record naming the subject, as JSON. Full
 * rows — this is the subject's own data being returned to them.
 */
export async function exportDataSubject(db: Db, orgId: string, rawEmail: string): Promise<DataSubjectExport> {
  const email = normalizeEmail(rawEmail);
  const [contacts, sellers, messages, notes] = await Promise.all([
    db.query(`select * from contacts where org_id = $1 and lower(email) = $2 order by created_at`, [orgId, email]),
    db.query(`select * from sellers where org_id = $1 and lower(email) = $2 order by created_at`, [orgId, email]),
    db.query(
      `select m.* from messages m join communication_threads t on t.id = m.thread_id
       where t.org_id = $1 and (
         lower(m.from_email) = $2
         or exists (select 1 from unnest(m.to_emails || m.cc_emails) as e where lower(e) = $2)
       ) order by m.created_at`,
      [orgId, email],
    ),
    db.query(
      `select * from meeting_notes where org_id = $1
       and (attendees ilike '%' || $2 || '%' or body ilike '%' || $2 || '%') order by created_at`,
      [orgId, email],
    ),
  ]);
  return {
    subject: email,
    org_id: orgId,
    generated_at: new Date().toISOString(),
    note:
      "Personal data held about this subject in this workspace. Covers CRM contacts, partner/vendor sellers, " +
      "email correspondence, and meeting notes. Platform-account data (org membership, sign-in) is managed " +
      "separately and is not part of this export.",
    records: {
      contacts: contacts.rows,
      sellers: sellers.rows,
      messages: messages.rows,
      meeting_notes: notes.rows,
    },
  };
}

export type ErasureResult = {
  email: string;
  contacts: number;
  sellers: number;
  messagesAuthored: number;
  messagesRecipient: number;
  meetingNotes: number;
  total: number;
};

/**
 * Irreversible erasure (Art. 17): anonymize every record naming the subject,
 * in one transaction, tenant-scoped. Returns per-table counts of what changed.
 *
 * Must be given a checked-out client (PoolClient) so the whole thing is atomic;
 * the caller owns BEGIN/COMMIT/ROLLBACK via runErasure below.
 */
async function eraseWithin(db: PoolClient, orgId: string, email: string): Promise<ErasureResult> {
  const tombstone = `erased-${emailHash(email).slice(0, 12)}@redacted.invalid`;

  // contacts: email is NOT NULL → tombstone it; null every other identifier.
  const contacts = await db.query(
    `update contacts set
       email = $3, name = null, title = null, phone = null, location = null, attributes = '{}'::jsonb
     where org_id = $1 and lower(email) = $2`,
    [orgId, email, tombstone],
  );

  // sellers: email is nullable → null it; blank the name.
  const sellers = await db.query(
    `update sellers set name = '[erased]', email = null, territory = null
     where org_id = $1 and lower(email) = $2`,
    [orgId, email],
  );

  // messages the subject AUTHORED (from_email): strip sender identity and the
  // body they wrote (their personal content), scoped to this org's threads.
  const msgFrom = await db.query(
    `update messages m set
       from_email = $3, from_name = null, subject = null,
       text_body = null, html_body = null, ai_draft = null, raw_headers = null
     from communication_threads t
     where m.thread_id = t.id and t.org_id = $1 and lower(m.from_email) = $2`,
    [orgId, email, tombstone],
  );

  // messages where the subject is a RECIPIENT: remove their address from the
  // to/cc arrays (case-insensitively) without touching the rest of the row.
  const msgRcpt = await db.query(
    `update messages m set
       to_emails = array(select e from unnest(m.to_emails) as e where lower(e) <> $2),
       cc_emails = array(select e from unnest(m.cc_emails) as e where lower(e) <> $2)
     from communication_threads t
     where m.thread_id = t.id and t.org_id = $1 and exists (
       select 1 from unnest(m.to_emails || m.cc_emails) as e where lower(e) = $2
     )`,
    [orgId, email],
  );

  // meeting_notes: literal, escaped, case-insensitive redaction of the email
  // wherever it appears in the free-text attendees/body.
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const notes = await db.query(
    `update meeting_notes set
       attendees = regexp_replace(coalesce(attendees, ''), $3, '[erased]', 'gi'),
       body = regexp_replace(body, $3, '[erased]', 'gi')
     where org_id = $1 and (attendees ilike '%' || $2 || '%' or body ilike '%' || $2 || '%')`,
    [orgId, email, escaped],
  );

  return {
    email,
    contacts: contacts.rowCount ?? 0,
    sellers: sellers.rowCount ?? 0,
    messagesAuthored: msgFrom.rowCount ?? 0,
    messagesRecipient: msgRcpt.rowCount ?? 0,
    meetingNotes: notes.rowCount ?? 0,
    total:
      (contacts.rowCount ?? 0) + (sellers.rowCount ?? 0) + (msgFrom.rowCount ?? 0) +
      (msgRcpt.rowCount ?? 0) + (notes.rowCount ?? 0),
  };
}

/**
 * Public entry: runs the erasure and audits it with the email HASH (never the
 * email). The transaction is owned by the caller (withTenant) — RISK-1: the
 * whole thing runs inside the caller's tenant-pinned transaction, so it also
 * scopes under RLS at the app_rw cutover.
 */
export async function eraseDataSubject(db: PoolClient, orgId: string, rawEmail: string): Promise<ErasureResult> {
  const email = normalizeEmail(rawEmail);
  const result = await eraseWithin(db, orgId, email);
  // The fact of erasure is itself a record we may keep; store only the hash.
  await audit(db, orgId, "privacy.subject_erased", {
    email_sha256: emailHash(email),
    contacts: result.contacts,
    sellers: result.sellers,
    messages_authored: result.messagesAuthored,
    messages_recipient: result.messagesRecipient,
    meeting_notes: result.meetingNotes,
  });
  return result;
}
