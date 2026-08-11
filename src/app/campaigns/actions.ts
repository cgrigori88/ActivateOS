"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { generateCampaignSequence } from "@/lib/agents/campaign-email";
import { createBlankCampaign } from "@/lib/comms/authoring";

/**
 * Generate a multi-touch email sequence from an APPROVED motion, then jump to
 * the new campaign. Every touch lands as a draft for per-touch human approval.
 */
export async function generateSequenceAction(formData: FormData): Promise<void> {
  const motionId = String(formData.get("motionId") ?? "").trim();
  const touchCount = Number(formData.get("touchCount") ?? 3);
  const senderName = String(formData.get("senderName") ?? "").trim() || "The PursuitOS Team";
  if (!motionId) throw new Error("motionId is required");

  const pool = getPool();
  const db = await pool.connect();
  let campaignId: string;
  try {
    const res = await generateCampaignSequence(db, {
      motionId,
      senderName,
      touchCount: Number.isFinite(touchCount) ? touchCount : 3,
    });
    campaignId = res.campaignId;
  } finally {
    db.release();
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}

/**
 * Create an empty campaign on an account — no motion required. The seller
 * authors touches by hand on the detail page. This is the manual path that
 * doesn't wait on the AI pipeline.
 */
export async function createBlankCampaignAction(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || "New campaign";
  const senderName = String(formData.get("senderName") ?? "").trim() || null;
  if (!companyId) throw new Error("an account is required");

  const pool = getPool();
  const db = await pool.connect();
  let campaignId: string;
  try {
    const { rows } = await db.query<{ org_id: string | null }>(`select org_id from companies where id = $1`, [companyId]);
    if (rows.length === 0) throw new Error("account not found");
    const res = await createBlankCampaign(db, { orgId: rows[0].org_id, companyId, name, senderName });
    campaignId = res.campaignId;
  } finally {
    db.release();
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}
