"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CATEGORIES, targetFromCell, type Category } from "@/lib/mapping/populations";
import { createTargetFromCompanies } from "@/lib/mapping/insights";
import { createMultiVendorCampaign } from "@/lib/campaigns/multi-vendor";
import { designMotion } from "@/lib/agents/motion-designer";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";

const MOTION_TARGET_SLUG = "infrastructure-automation";

/**
 * Propose a population (list). Created 'pending' so the other side vets it
 * before it maps. `side` = 'org' (host) or a partner id.
 */
export async function createPopulationAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "custom");
  const category: Category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as Category) : "custom";
  const side = String(formData.get("side") ?? "org");
  if (!name) throw new Error("a name is required");

  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const partnerId = side === "org" ? null : side;
    await db.query(
      `insert into account_populations (org_id, partner_id, name, category, status, created_by)
       values ($1, $2, $3, $4, 'pending', 'web')`,
      [orgId, partnerId, name, category],
    );
  });
  revalidatePath("/mapping");
}

export async function setPopulationStatusAction(populationId: string, status: string): Promise<void> {
  if (!["approved", "rejected", "pending"].includes(status)) throw new Error("invalid status");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // FLOW-1 fix: org-scoped so a foreign list id can't be approved/rejected.
    await db.query(`update account_populations set status = $2 where id = $1 and org_id = $3`, [populationId, status, orgId]);
  });
  revalidatePath("/mapping");
}

/**
 * Accept a pushed list for mapping, recording which fields carry into the
 * matrix (the reviewer's decision). Empty selection = keep all detected fields.
 */
export async function acceptPopulationAction(populationId: string, formData: FormData): Promise<void> {
  const fields = formData.getAll("fields").map((f) => String(f)).filter(Boolean);
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // FLOW-1 fix: org-scoped.
    await db.query(
      `update account_populations set status = 'approved', selected_fields = $2 where id = $1 and org_id = $3`,
      [populationId, fields.length ? fields : null, orgId],
    );
  });
  revalidatePath("/mapping");
  redirect(`/mapping?view=review&notice=${encodeURIComponent(`Accepted list with ${fields.length || "all"} field(s) mapped.`)}`);
}

/** Create a target list from an AI-recommended cross-partner bucket. */
export async function createTargetListAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Target list";
  const companyIds = String(formData.get("companyIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Provenance: the workbench posts source=web (a person picked the accounts);
  // absent means the AI-recommend view created it.
  const createdBy = String(formData.get("source") ?? "") === "web" ? "web" : "ai";
  const added = await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const res = await createTargetFromCompanies(db, { orgId, name, companyIds, createdBy });
    return res.added;
  });
  revalidatePath("/mapping");
  redirect(`/mapping?view=recommend&notice=${encodeURIComponent(`Created target list "${name}" with ${added} account(s).`)}`);
}

/**
 * Create the whole multi-vendor package from a suggested partner combo:
 * named list → campaign → partners attached with roles. Lands as a draft
 * campaign; touches and launch stay human-gated.
 */
export async function createMultiVendorCampaignAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Multi-vendor play";
  const companyIds = String(formData.get("companyIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // partners field: "id:role,id:role"
  const partners = String(formData.get("partners") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, role] = s.split(":");
      return { id, role: (role || "co_sell") as import("@/lib/campaigns/multi-vendor").PartnerRole };
    });
  if (companyIds.length === 0 || partners.length < 2) throw new Error("a multi-vendor play needs accounts and 2+ partners");

  const campaignId = await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const res = await createMultiVendorCampaign(db, { orgId, name, companyIds, partners });
    return res.campaignId;
  });
  revalidatePath("/mapping");
  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaignId}?notice=${encodeURIComponent(`Multi-vendor play "${name}" created — list linked, ${partners.length} partners attached. Draft touches next.`)}`);
}

/** Generate motions for a selected set of accounts (bounded, AI, graceful). */
export async function generateMotionsForSelectionAction(formData: FormData): Promise<void> {
  const ids = String(formData.get("companyIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  let ok = 0;
  let fail = 0;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    for (const companyId of ids) {
      try {
        await designMotion(db, { orgId, companyId, targetSlug: MOTION_TARGET_SLUG });
        ok++;
      } catch {
        fail++;
      }
    }
  });
  revalidatePath("/mapping");
  const msg = ok > 0 ? `Drafted ${ok} motion(s)${fail ? `, ${fail} skipped (no score/evidence or AI off)` : ""}.` : `Couldn't draft motions (${fail} skipped — needs scores/evidence and AI configured).`;
  redirect(`/mapping?view=recommend&notice=${encodeURIComponent(msg)}`);
}

/** AI-draft a motion for a cross-partner account (grounded, lands as draft). */
export async function draftMotionAction(companyId: string): Promise<void> {
  let motionId: string | null = null;
  let notice: string | null = null;
  try {
    motionId = await withTenant(async (db, orgId) => {
      await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
      const res = await designMotion(db, { orgId, companyId, targetSlug: MOTION_TARGET_SLUG });
      return res.motionId;
    });
  } catch (err) {
    notice = `Couldn't draft a motion: ${err instanceof Error ? err.message : String(err)}`;
  }
  revalidatePath("/mapping");
  redirect(motionId ? `/briefs/${motionId}` : `/mapping?view=recommend&notice=${encodeURIComponent(notice ?? "failed")}`);
}

/**
 * Turn a matrix cell into a target list — mapping becomes targeting. Creates an
 * approved org-side 'target' population from the cell's shared accounts.
 */
export async function targetFromCellAction(rowPopId: string, colPopId: string, formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Target list";
  const partnerId = String(formData.get("partner") ?? "").trim();
  const added = await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const res = await targetFromCell(db, { orgId, rowPopId, colPopId, name });
    return res.added;
  });
  revalidatePath("/mapping");
  redirect(`/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}&notice=${encodeURIComponent(`Created target list "${name}" with ${added} account(s).`)}`);
}
