"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { generateCampaignSequence } from "@/lib/agents/campaign-email";
import { createBlankCampaign } from "@/lib/comms/authoring";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";

/**
 * Generate a multi-touch email sequence from an APPROVED motion, then jump to
 * the new campaign. Every touch lands as a draft for per-touch human approval.
 */
export async function generateSequenceAction(formData: FormData): Promise<void> {
  const motionId = String(formData.get("motionId") ?? "").trim();
  const touchCount = Number(formData.get("touchCount") ?? 3);
  const senderName = String(formData.get("senderName") ?? "").trim() || "The PursuitOS Team";
  if (!motionId) {
    redirect(`/campaigns?notice=${encodeURIComponent("Pick an approved motion first — campaigns generate from approved motions, and every motion here already has one.")}`);
  }

  let campaignId: string | null = null;
  let notice: string | null = null;
  try {
    campaignId = await withTenant(async (db) => {
      await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
      const res = await generateCampaignSequence(db, {
        motionId,
        senderName,
        touchCount: Number.isFinite(touchCount) ? touchCount : 3,
      });
      return res.campaignId;
    });
  } catch (err) {
    // AI generation needs Anthropic credentials in this environment; surface a
    // notice rather than a crash screen.
    notice = `Couldn't generate: ${err instanceof Error ? err.message : String(err)}`;
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
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
  });
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
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // FLOW-1 fix: org-scoped so a foreign campaign id can't be retargeted.
    await db.query(`update campaigns set goal_id = $2 where id = $1 and org_id = $3`, [campaignId, goalId, orgId]);
  });
  revalidatePath("/campaigns");
  revalidatePath("/goals");
}

/** Dismiss an AI-suggested campaign the seller doesn't want. */
export async function dismissCampaignAction(campaignId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // FLOW-1 fix: org-scoped.
    await db.query(`update campaigns set dismissed_at = now() where id = $1 and org_id = $2`, [campaignId, orgId]);
  });
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

  const campaignId = await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // Companies aren't org-scoped by a column — resolve the org from any related
    // row, falling back to the caller's org.
    const { rows } = await db.query<{ org_id: string | null }>(
      `select coalesce(
         (select org_id from revenue_motions where company_id = $1 and org_id is not null limit 1),
         (select org_id from propensity_scores where company_id = $1 and org_id is not null limit 1),
         (select org_id from partner_accounts where company_id = $1 and org_id is not null limit 1),
         $2::uuid
       ) as org_id`,
      [companyId, orgId],
    );
    const res = await createBlankCampaign(db, { orgId: rows[0]?.org_id ?? null, companyId, name, senderName });
    return res.campaignId;
  });
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}`);
}
