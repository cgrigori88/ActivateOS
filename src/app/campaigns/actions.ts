"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { generateCampaignSequence } from "@/lib/agents/campaign-email";

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
