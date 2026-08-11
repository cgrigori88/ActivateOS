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
 * Ask the pipeline (worker) to draft AI-suggested campaigns for motions that
 * don't have one yet. Generation runs on the worker — where the AI pipeline
 * lives — not in the serverless request. Everything it drafts is a suggestion
 * the human still reviews and decides on.
 */
export async function suggestCampaignsAction(): Promise<void> {
  const base = process.env.WORKER_URL;
  const secret = process.env.RESEARCH_TRIGGER_SECRET;
  if (!base || !secret) {
    throw new Error("Suggestions need the worker: set WORKER_URL and RESEARCH_TRIGGER_SECRET.");
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/suggest?limit=3`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`Suggest failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  revalidatePath("/campaigns");
}

/** Dismiss an AI-suggested campaign the seller doesn't want. */
export async function dismissCampaignAction(campaignId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`update campaigns set dismissed_at = now() where id = $1`, [campaignId]);
  revalidatePath("/campaigns");
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
