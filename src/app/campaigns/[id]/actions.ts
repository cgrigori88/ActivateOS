"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { launchCampaign, sendTouchNow } from "@/lib/comms/sequence";

/**
 * Per-touch approval, campaign launch, and send. Approval is the human gate:
 * a touch cannot send or be scheduled until a person approves it, and each
 * touch is approved on its own.
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

/** Arm the whole sequence: fix the recipient, schedule every approved touch. */
export async function launchCampaignAction(campaignId: string, formData: FormData): Promise<void> {
  const to = String(formData.get("to") ?? "").trim().toLowerCase();
  if (!to) throw new Error("a recipient is required to launch");
  const pool = getPool();
  const db = await pool.connect();
  try {
    await launchCampaign(db, { campaignId, recipientEmail: to });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Send a single touch now (pre-launch to a chosen recipient, or a due scheduled touch). */
export async function sendTouchAction(touchId: string, formData: FormData): Promise<void> {
  const override = String(formData.get("to") ?? "").trim().toLowerCase() || null;
  const pool = getPool();
  const db = await pool.connect();
  try {
    await sendTouchNow(db, { touchId, overrideTo: override });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${await touchCampaign(touchId)}`);
}
