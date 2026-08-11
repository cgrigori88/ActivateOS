"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { launchCampaign, sendTouchNow } from "@/lib/comms/sequence";
import { deleteTouch, upsertTouch, type TouchFields } from "@/lib/comms/authoring";

function touchFieldsFrom(formData: FormData): TouchFields {
  const highlights = String(formData.get("highlights") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: String(formData.get("name") ?? "").trim() || "Touch",
    subject: String(formData.get("subject") ?? "").trim(),
    preheader: String(formData.get("preheader") ?? "").trim() || null,
    headline: String(formData.get("headline") ?? "").trim() || null,
    body: String(formData.get("body") ?? "").trim(),
    highlights,
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim() || null,
    ctaUrl: String(formData.get("ctaUrl") ?? "").trim() || null,
    sendOffsetDays: Number(formData.get("sendOffsetDays") ?? 0) || 0,
  };
}

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

/** Add a hand-authored touch to a campaign. */
export async function addTouchAction(campaignId: string, formData: FormData): Promise<void> {
  const fields = touchFieldsFrom(formData);
  if (!fields.subject || !fields.body) throw new Error("subject and body are required");
  const pool = getPool();
  const db = await pool.connect();
  try {
    await upsertTouch(db, { campaignId, fields });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Edit an existing (unsent) touch — re-renders its HTML. */
export async function editTouchAction(touchId: string, formData: FormData): Promise<void> {
  const campaignId = await touchCampaign(touchId);
  const fields = touchFieldsFrom(formData);
  if (!fields.subject || !fields.body) throw new Error("subject and body are required");
  const pool = getPool();
  const db = await pool.connect();
  try {
    await upsertTouch(db, { campaignId, touchId, fields });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function deleteTouchAction(touchId: string): Promise<void> {
  const campaignId = await touchCampaign(touchId);
  const pool = getPool();
  const db = await pool.connect();
  try {
    await deleteTouch(db, touchId);
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Arm the whole sequence: fix the recipient, schedule every approved touch. */
export async function launchCampaignAction(campaignId: string, formData: FormData): Promise<void> {
  const to = String(formData.get("to") ?? "").trim().toLowerCase();
  if (!to) throw new Error("a recipient is required to launch");
  const startRaw = String(formData.get("startDate") ?? "").trim();
  const startDate = startRaw ? new Date(`${startRaw}T09:00:00Z`) : null;
  const pool = getPool();
  const db = await pool.connect();
  try {
    await launchCampaign(db, { campaignId, recipientEmail: to, startDate });
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
