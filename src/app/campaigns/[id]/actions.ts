"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { sendOutbound } from "@/lib/comms/send";
import { deriveEngagement } from "@/lib/intel/engagement";

/**
 * Per-touch approval + send. Approval is the human-in-the-loop gate: a touch
 * cannot send until a person approves it, and each touch is approved on its
 * own so a seller can green-light touch 1 and hold the rest.
 */

async function touchCampaign(touchId: string): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ campaign_id: string }>(
    `select campaign_id from campaign_touches where id = $1`,
    [touchId],
  );
  if (rows.length === 0) throw new Error("touch not found");
  return rows[0].campaign_id;
}

export async function approveTouchAction(touchId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `update campaign_touches
       set status = 'approved', approved_by = 'web', approved_at = now(), rejected_reason = null
     where id = $1 and status in ('draft','rejected')`,
    [touchId],
  );
  revalidatePath(`/campaigns/${await touchCampaign(touchId)}`);
}

export async function rejectTouchAction(touchId: string, formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const pool = getPool();
  await pool.query(
    `update campaign_touches set status = 'rejected', rejected_reason = $2 where id = $1 and status <> 'sent'`,
    [touchId, reason],
  );
  revalidatePath(`/campaigns/${await touchCampaign(touchId)}`);
}

export async function sendTouchAction(touchId: string, formData: FormData): Promise<void> {
  const to = String(formData.get("to") ?? "").trim().toLowerCase();
  if (!to) throw new Error("a recipient is required");

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows } = await db.query<{
      campaign_id: string;
      status: string;
      subject: string;
      text_body: string | null;
      html_body: string | null;
      org_id: string | null;
      company_id: string;
      motion_id: string;
      seller_id: string | null;
      seller_name: string | null;
    }>(
      `select t.campaign_id, t.status, t.subject, t.text_body, t.html_body,
              m.org_id, m.company_id, m.id as motion_id, m.partner_seller_id as seller_id,
              s.name as seller_name
       from campaign_touches t
       join campaigns ca on ca.id = t.campaign_id
       join revenue_motions m on m.id = ca.motion_id
       left join sellers s on s.id = m.partner_seller_id
       where t.id = $1`,
      [touchId],
    );
    if (rows.length === 0) throw new Error("touch not found");
    const t = rows[0];
    if (t.status !== "approved") throw new Error("touch must be approved before it can send");

    const senderName = t.seller_name ?? "The PursuitOS Team";
    const localPart =
      senderName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") || "team";

    const result = await sendOutbound(db, {
      orgId: t.org_id,
      companyId: t.company_id,
      motionId: t.motion_id,
      identity: { displayName: senderName, localPart },
      to: [to],
      subject: t.subject,
      body: t.text_body ?? t.subject,
      html: t.html_body,
      sellerId: t.seller_id,
      mode: "facilitated",
    });

    await db.query(
      `update campaign_touches set status = 'sent', sent_at = now(), message_id = $2 where id = $1`,
      [touchId, result.messageId],
    );
    // Refresh the engagement rollup so downstream intelligence sees the send.
    await deriveEngagement(db, { orgId: t.org_id, companyId: t.company_id });

    revalidatePath(`/campaigns/${t.campaign_id}`);
  } finally {
    db.release();
  }
}
