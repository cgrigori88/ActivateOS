import type pg from "pg";
import { sendOutbound } from "./send";
import { deriveEngagement } from "../intel/engagement";
import { addDays, normalizeTz, zonedToUtc } from "./tz";
import { dispatchSkill, type Actor } from "../pursuits/federation/skills";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Sequence cadence (Phase 9B). Launching a campaign turns its approved touches
 * into a dated send plan; a due touch either waits for a human "send now" or,
 * when the worker is armed (OUTREACH_AUTOSEND=on), is sent by the drainer.
 *
 * The recipient is set at launch and lives on the campaign, so every touch in
 * the sequence goes to the same committee member (multi-recipient sequences
 * are a later refinement).
 */

export interface LaunchResult {
  scheduled: number;
  firstAt: Date | null;
}

/**
 * Arm a campaign: fix the recipient and schedule every approved touch at a real
 * local wall time (send time + timezone) on its offset day, DST-correct.
 */
export async function launchCampaign(
  db: pg.PoolClient,
  args: {
    campaignId: string;
    recipientEmail: string;
    recipientContactId?: string | null;
    startDate?: string | null; // 'YYYY-MM-DD'; defaults to today
    sendTime?: string | null; // 'HH:MM' local; defaults to 09:00
    sendTz?: string | null; // IANA zone; defaults to Eastern
    now?: Date;
  },
): Promise<LaunchResult> {
  const now = args.now ?? new Date();
  const to = args.recipientEmail.trim().toLowerCase();
  if (!to) throw new Error("a recipient is required to launch");

  const tz = normalizeTz(args.sendTz);
  const time = args.sendTime && /^\d{1,2}:\d{2}$/.test(args.sendTime) ? args.sendTime : "09:00";
  const startStr = args.startDate && /^\d{4}-\d{2}-\d{2}$/.test(args.startDate)
    ? args.startDate
    : now.toISOString().slice(0, 10);

  const { rows: approved } = await db.query<{ id: string; send_offset_days: number }>(
    `select id, send_offset_days from campaign_touches
     where campaign_id = $1 and status = 'approved' order by touch_no`,
    [args.campaignId],
  );
  if (approved.length === 0) throw new Error("no approved touches — approve at least one before launching");

  await db.query(
    `update campaigns set status = 'launched', launched_at = $2, start_date = $5,
       send_time = $6, send_tz = $7, recipient_email = $3, recipient_contact_id = $4
     where id = $1`,
    [args.campaignId, now, to, args.recipientContactId ?? null, startStr, time, tz],
  );

  let firstAt: Date | null = null;
  for (const t of approved) {
    // Each touch fires at the chosen local time on (start + offset) days.
    let at = zonedToUtc(addDays(startStr, t.send_offset_days), time, tz);
    if (at.getTime() < now.getTime()) at = now; // never schedule into the past
    if (!firstAt || at < firstAt) firstAt = at;
    await db.query(`update campaign_touches set status = 'scheduled', scheduled_at = $2 where id = $1`, [t.id, at]);
  }
  return { scheduled: approved.length, firstAt };
}

/** Send one touch to the campaign's recipient. Used by manual "send now" and the drainer. */
export async function sendTouchNow(
  db: pg.PoolClient,
  args: { touchId: string; overrideTo?: string | null },
): Promise<{ messageId: string }> {
  const { rows } = await db.query<{
    campaign_id: string;
    status: string;
    subject: string;
    text_body: string | null;
    html_body: string | null;
    recipient_email: string | null;
    cc_emails: string[] | null;
    org_id: string | null;
    company_id: string | null;
    m_company: string | null;
    motion_id: string | null;
    campaign_sender: string | null;
    seller_id: string | null;
    seller_name: string | null;
  }>(
    `select t.campaign_id, t.status, t.subject, t.text_body, t.html_body, t.cc_emails,
            ca.recipient_email, ca.org_id, ca.company_id, ca.sender_name as campaign_sender,
            m.company_id as m_company, m.id as motion_id,
            m.partner_seller_id as seller_id, s.name as seller_name
     from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     left join revenue_motions m on m.id = ca.motion_id
     left join sellers s on s.id = m.partner_seller_id
     where t.id = $1`,
    [args.touchId],
  );
  if (rows.length === 0) throw new Error("touch not found");
  const t = rows[0];
  if (t.status !== "approved" && t.status !== "scheduled") {
    throw new Error(`touch is '${t.status}' — only approved/scheduled touches send`);
  }
  const companyId = t.company_id ?? t.m_company;
  if (!companyId) throw new Error("campaign has no account");
  const to = (args.overrideTo ?? t.recipient_email ?? "").trim().toLowerCase();
  if (!to) throw new Error("no recipient set — launch the campaign or pass a recipient");

  const senderName = t.campaign_sender ?? t.seller_name ?? "The PursuitOS Team";
  const localPart = senderName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") || "team";

  const result = await sendOutbound(db, {
    orgId: t.org_id,
    companyId,
    motionId: t.motion_id,
    identity: { displayName: senderName, localPart },
    to: [to],
    cc: t.cc_emails ?? [],
    subject: t.subject,
    body: t.text_body ?? t.subject,
    html: t.html_body,
    sellerId: t.seller_id,
    mode: "facilitated",
  });

  await db.query(
    `update campaign_touches set status = 'sent', sent_at = now(), message_id = $2 where id = $1`,
    [args.touchId, result.messageId],
  );
  await db.query(
    `update campaigns set status = 'completed'
     where id = $1 and not exists (
       select 1 from campaign_touches x where x.campaign_id = $1 and x.status in ('scheduled','approved')
     )`,
    [t.campaign_id],
  );
  await deriveEngagement(db, { orgId: t.org_id, companyId });
  return { messageId: result.messageId };
}

/**
 * Drain due scheduled touches. Only sends when armed; otherwise reports what is
 * due so an operator can send manually. Returns the touches it acted on.
 */
export async function drainScheduledTouches(
  db: pg.PoolClient,
  args?: { now?: Date; limit?: number },
): Promise<{ due: number; enqueued: number; errors: string[] }> {
  const now = args?.now ?? new Date();
  const limit = args?.limit ?? 50;

  // R1-G4: a due, approved touch is ENQUEUED as a governed EXTERNAL_ACTION — it is not
  // sent here. The outbox executor performs the send (gated, retried, receipted). This
  // function no longer touches a provider; drafting/approval ≠ execution.
  const { rows: due } = await db.query<{ id: string; org_id: string | null; data_environment: string | null }>(
    `select t.id, ca.org_id, ca.data_environment from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     where t.status = 'scheduled' and t.scheduled_at is not null and t.scheduled_at <= $1
       and ca.recipient_email is not null
     order by t.scheduled_at asc limit $2`,
    [now, limit],
  );

  const errors: string[] = [];
  let enqueued = 0;
  for (const t of due) {
    if (!t.org_id) { errors.push(`${t.id}: campaign has no org`); continue; }
    try {
      const actor: Actor = { type: "WORKER", id: "scheduler", orgId: t.org_id, role: "operator" };
      const r = await dispatchSkill(db, "send_campaign_touch", actor, {
        args: { touchId: t.id }, idempotencyKey: `send:${t.id}`,
        dataEnvironment: (t.data_environment as DataEnvironment) ?? "PRODUCTION",
      });
      if (r.status === "EXECUTING" || r.status === "EXECUTED") enqueued++;
      else errors.push(`${t.id}: ${r.status}${r.reason ? " " + r.reason : ""}`);
    } catch (err) {
      errors.push(`${t.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { due: due.length, enqueued, errors };
}
