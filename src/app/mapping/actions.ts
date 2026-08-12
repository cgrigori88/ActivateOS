"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { CATEGORIES, targetFromCell, type Category } from "@/lib/mapping/populations";
import { createTargetFromCompanies } from "@/lib/mapping/insights";
import { designMotion } from "@/lib/agents/motion-designer";

const MOTION_TARGET_SLUG = "infrastructure-automation";

async function soleOrgId(db: import("pg").PoolClient): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
  return rows[0]?.id ?? null;
}

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

  const pool = getPool();
  const db = await pool.connect();
  try {
    const orgId = await soleOrgId(db);
    const partnerId = side === "org" ? null : side;
    await db.query(
      `insert into account_populations (org_id, partner_id, name, category, status, created_by)
       values ($1, $2, $3, $4, 'pending', 'web')`,
      [orgId, partnerId, name, category],
    );
  } finally {
    db.release();
  }
  revalidatePath("/mapping");
}

export async function setPopulationStatusAction(populationId: string, status: string): Promise<void> {
  if (!["approved", "rejected", "pending"].includes(status)) throw new Error("invalid status");
  const pool = getPool();
  await pool.query(`update account_populations set status = $2 where id = $1`, [populationId, status]);
  revalidatePath("/mapping");
}

/** Create a target list from an AI-recommended cross-partner bucket. */
export async function createTargetListAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "Target list";
  const companyIds = String(formData.get("companyIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pool = getPool();
  const db = await pool.connect();
  let added = 0;
  try {
    const orgId = await soleOrgId(db);
    const res = await createTargetFromCompanies(db, { orgId, name, companyIds });
    added = res.added;
  } finally {
    db.release();
  }
  revalidatePath("/mapping");
  redirect(`/mapping?view=recommend&notice=${encodeURIComponent(`Created target list "${name}" with ${added} account(s).`)}`);
}

/** AI-draft a motion for a cross-partner account (grounded, lands as draft). */
export async function draftMotionAction(companyId: string): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  let motionId: string | null = null;
  let notice: string | null = null;
  try {
    const orgId = await soleOrgId(db);
    if (!orgId) throw new Error("no organization");
    const res = await designMotion(db, { orgId, companyId, targetSlug: MOTION_TARGET_SLUG });
    motionId = res.motionId;
  } catch (err) {
    notice = `Couldn't draft a motion: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    db.release();
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
  const pool = getPool();
  const db = await pool.connect();
  let added = 0;
  try {
    const orgId = await soleOrgId(db);
    const res = await targetFromCell(db, { orgId, rowPopId, colPopId, name });
    added = res.added;
  } finally {
    db.release();
  }
  revalidatePath("/mapping");
  redirect(`/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}&notice=${encodeURIComponent(`Created target list "${name}" with ${added} account(s).`)}`);
}
