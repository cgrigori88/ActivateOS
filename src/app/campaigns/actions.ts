"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { generateCampaignSequence } from "@/lib/agents/campaign-email";
import { createBlankCampaign } from "@/lib/comms/authoring";
import { currentOrgId } from "@/lib/auth/org";

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
  let campaignId: string | null = null;
  let notice: string | null = null;
  try {
    const res = await generateCampaignSequence(db, {
      motionId,
      senderName,
      touchCount: Number.isFinite(touchCount) ? touchCount : 3,
    });
    campaignId = res.campaignId;
  } catch (err) {
    // AI generation needs Anthropic credentials in this environment; surface a
    // notice rather than a crash screen.
    notice = `Couldn't generate: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    db.release();
  }
  revalidatePath("/campaigns");
  redirect(campaignId ? `/campaigns/${campaignId}` : `/campaigns?notice=${encodeURIComponent(notice ?? "generation failed")}`);
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
  let notice: string;
  if (!base || !secret) {
    notice = "AI suggestions run on the pipeline worker — set WORKER_URL and RESEARCH_TRIGGER_SECRET (not configured here).";
  } else {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/suggest?limit=3`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) notice = `Suggestion request failed (${res.status}).`;
      else {
        const data = (await res.json()) as { suggested?: number };
        notice = data.suggested ? `Drafted ${data.suggested} suggestion(s) for review.` : "No new motions to suggest campaigns for.";
      }
    } catch {
      notice = "Couldn't reach the pipeline worker for suggestions.";
    }
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns?notice=${encodeURIComponent(notice)}`);
}

/** Link (or unlink) a campaign to a S.M.A.R.T. goal so its touches roll up. */
export async function setCampaignGoalAction(campaignId: string, formData: FormData): Promise<void> {
  const goalId = String(formData.get("goalId") ?? "").trim() || null;
  await getPool().query(`update campaigns set goal_id = $2 where id = $1`, [campaignId, goalId]);
  revalidatePath("/campaigns");
  revalidatePath("/goals");
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
    // Companies aren't org-scoped by a column — resolve the org from any related
    // row, falling back to the sole organization.
    const tenantOrgId = await currentOrgId(db);
    const { rows } = await db.query<{ org_id: string | null }>(
      `select coalesce(
         (select org_id from revenue_motions where company_id = $1 and org_id is not null limit 1),
         (select org_id from propensity_scores where company_id = $1 and org_id is not null limit 1),
         (select org_id from partner_accounts where company_id = $1 and org_id is not null limit 1),
         $2::uuid
       ) as org_id`,
      [companyId, tenantOrgId],
    );
    const res = await createBlankCampaign(db, { orgId: rows[0]?.org_id ?? null, companyId, name, senderName });
    campaignId = res.campaignId;
  } finally {
    db.release();
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}
