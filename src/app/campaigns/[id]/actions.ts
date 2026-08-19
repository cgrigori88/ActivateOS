"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { requireWrite } from "@/lib/auth/org";
import { launchCampaign, sendTouchNow } from "@/lib/comms/sequence";
import { deleteTouch, upsertTouch, type TouchFields } from "@/lib/comms/authoring";
import { appendAiTouches } from "@/lib/agents/campaign-email";
import { linkPopulation, unlinkPopulation } from "@/lib/campaigns/lists";

/** Attach target lists (one or many) so their accounts roll into the campaign. */
export async function linkListAction(campaignId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const ids = formData.getAll("populationId").map((v) => String(v).trim()).filter(Boolean);
  if (ids.length === 0) return;
  const pool = getPool();
  for (const populationId of ids) await linkPopulation(pool, campaignId, populationId, "web");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

/** Link a motion so AI drafting has approved grounding (thesis, trigger, CTA, evidence). */
export async function linkMotionAction(campaignId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const motionId = String(formData.get("motionId") ?? "").trim();
  if (!motionId) return;
  await getPool().query(`update campaigns set motion_id = $2 where id = $1`, [campaignId, motionId]);
  revalidatePath(`/campaigns/${campaignId}`);
}

/**
 * Delete a campaign outright — drafts most often, but any campaign may go.
 * Touches and list links cascade; anything already SENT lives on in its
 * communication thread (messages are the record, the campaign was the vehicle).
 */
export async function deleteCampaignAction(campaignId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  await getPool().query(`delete from campaigns where id = $1`, [campaignId]);
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

/** Remove a target list from the campaign (accounts stop rolling in). */
export async function unlinkListAction(campaignId: string, populationId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  await unlinkPopulation(pool, campaignId, populationId);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
}

/** Comma/semicolon/whitespace-separated emails -> validated, deduped, lowercased. */
function parseCcList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) seen.add(e);
  }
  return [...seen].slice(0, 10); // a CC line, not a mailing list
}

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
    customHtml: String(formData.get("customHtml") ?? "").trim() || null,
    accountAngle: String(formData.get("accountAngle") ?? "").trim() || null,
    ccEmails: parseCcList(String(formData.get("cc") ?? "")),
  };
}

/** Let AI draft touches into this campaign (needs a linked motion for grounding). */
export async function aiDraftTouchesAction(campaignId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const touchCount = Number(formData.get("touchCount") ?? 3) || 3;
  const senderName = String(formData.get("senderName") ?? "").trim() || undefined;
  const pool = getPool();
  const db = await pool.connect();
  let notice: string | null = null;
  try {
    await appendAiTouches(db, { campaignId, touchCount, senderName });
  } catch (err) {
    notice = err instanceof Error ? err.message : String(err);
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
  if (notice) redirect(`/campaigns/${campaignId}?notice=${encodeURIComponent(notice)}`);
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
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
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
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
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
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const fields = touchFieldsFrom(formData);
  if (!fields.subject || (!fields.body && !fields.customHtml)) {
    throw new Error("a subject and either a body or custom HTML are required");
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    await upsertTouch(db, { campaignId, fields });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
  // Keep the composer open (and in view) so the next touch can be written
  // immediately — sequences are authored several touches at a time.
  redirect(`/campaigns/${campaignId}?compose=1#add-touches`);
}

/** Edit an existing (unsent) touch — re-renders its HTML. */
export async function editTouchAction(touchId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const campaignId = await touchCampaign(touchId);
  const fields = touchFieldsFrom(formData);
  if (!fields.subject || (!fields.body && !fields.customHtml)) {
    throw new Error("a subject and either a body or custom HTML are required");
  }
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
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
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

/**
 * Schedule the whole sequence in one step: approve every unsent, non-rejected
 * touch, then launch on the chosen start date so each fires on its offset.
 * (Reject individual touches first if you want to hold them back.)
 */
function scheduleArgsFrom(formData: FormData) {
  return {
    recipientEmail: String(formData.get("to") ?? "").trim().toLowerCase(),
    startDate: String(formData.get("startDate") ?? "").trim() || null,
    sendTime: String(formData.get("sendTime") ?? "").trim() || null,
    sendTz: String(formData.get("sendTz") ?? "").trim() || null,
  };
}

export async function scheduleSequenceAction(campaignId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const args = scheduleArgsFrom(formData);
  if (!args.recipientEmail) throw new Error("a recipient is required to schedule");

  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query(
      `update campaign_touches set status = 'approved', approved_by = 'web', approved_at = now()
       where campaign_id = $1 and status = 'draft'`,
      [campaignId],
    );
    await launchCampaign(db, { campaignId, ...args });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
  // Next-step pull (#79): a launched sequence lives on the dated send plan now.
  redirect(`/campaigns/${campaignId}?launched=1`);
}

/** Arm the sequence using only the touches already approved. */
export async function launchCampaignAction(campaignId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const args = scheduleArgsFrom(formData);
  if (!args.recipientEmail) throw new Error("a recipient is required to launch");
  const pool = getPool();
  const db = await pool.connect();
  try {
    await launchCampaign(db, { campaignId, ...args });
  } finally {
    db.release();
  }
  revalidatePath(`/campaigns/${campaignId}`);
  // Next-step pull (#79): a launched sequence lives on the dated send plan now.
  redirect(`/campaigns/${campaignId}?launched=1`);
}

/** Send a single touch now (pre-launch to a chosen recipient, or a due scheduled touch). */
export async function sendTouchAction(touchId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
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
