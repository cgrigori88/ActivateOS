import type { Pool, PoolClient } from "pg";
import { verifyEvidence } from "../quality/verify";

type Db = Pool | PoolClient;

/**
 * Meeting notes (task #86): the engagement signal email can't see.
 *
 * v1 is the manual lane — a seller records that a meeting happened and what
 * it said. Each note becomes:
 *  - a meeting_notes row (timeline, digests, engagement-decay gate), and
 *  - first-party EVIDENCE through the standard quality gates, so the motion
 *    designer grounds on what was actually said in the room.
 *
 * Calendar OAuth (meeting metadata) and forwarded Teams/Meet recap emails
 * later feed this same table — the surfaces built here don't change.
 */

export interface MeetingNote {
  id: string;
  metAt: string;
  title: string | null;
  attendees: string | null;
  body: string;
  createdBy: string | null;
}

export async function addMeetingNote(
  db: PoolClient,
  orgId: string,
  companyId: string,
  note: { metAt: string; title?: string; attendees?: string; body: string; createdBy?: string },
): Promise<void> {
  const body = note.body.trim().slice(0, 8000);
  if (!body) throw new Error("Write what happened in the meeting.");
  if (Number.isNaN(Date.parse(note.metAt))) throw new Error("Pick the meeting date.");
  const metAt = new Date(note.metAt).toISOString().slice(0, 10);
  const title = note.title?.trim().slice(0, 200) || null;
  const attendees = note.attendees?.trim().slice(0, 500) || null;

  const { rows: company } = await db.query<{ legal_name: string }>(
    `select legal_name from companies where id = $1`,
    [companyId],
  );
  if (!company[0]) throw new Error("Account not found.");

  await db.query(
    `insert into meeting_notes (org_id, company_id, met_at, title, attendees, body, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId, companyId, metAt, title, attendees, body, note.createdBy ?? null],
  );

  // The meeting as evidence: first-party, seller-reported, quality-gated.
  await db.query(
    `insert into signal_sources (name, kind, trust_score, audit_sample_rate)
     values ('meeting', 'first_party', 0.85, 0.05) on conflict (name) do nothing`,
  );
  const claim = `Meeting ${metAt}${title ? ` — ${title}` : ""}${attendees ? ` (with ${attendees})` : ""}: ${body.slice(0, 400)}`;
  const { rows: ev } = await db.query<{ id: string }>(
    `insert into evidence (org_id, company_id, source_type, claim, raw_excerpt, confidence, observed_at)
     values ($1, $2, 'meeting', $3, $4, 0.85, $5) returning id`,
    [orgId, companyId, claim, body.slice(0, 2000), `${metAt}T12:00:00Z`],
  );
  await verifyEvidence(db, {
    id: ev[0].id,
    orgId,
    companyId,
    sourceName: "meeting",
    claim,
    rawExcerpt: body.slice(0, 2000),
    observedAt: new Date(`${metAt}T12:00:00Z`),
    extractionConfidence: 0.85,
  });
}

export async function listMeetingNotes(db: Db, orgId: string, companyId: string, limit = 10): Promise<MeetingNote[]> {
  const { rows } = await db.query<{
    id: string; met_at: string; title: string | null; attendees: string | null; body: string; created_by: string | null;
  }>(
    `select id, met_at::text, title, attendees, body, created_by
     from meeting_notes where org_id = $1 and company_id = $2
     order by met_at desc, created_at desc limit $3`,
    [orgId, companyId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    metAt: r.met_at,
    title: r.title,
    attendees: r.attendees,
    body: r.body,
    createdBy: r.created_by,
  }));
}
