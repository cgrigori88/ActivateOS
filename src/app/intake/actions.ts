"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import {
  analyzeCsvToBatch,
  commitImportBatch,
  discardImportBatch,
  loadStagedBatch,
  sanitizeTargets,
  MAX_CSV_BYTES,
} from "@/lib/ingest/staged";
import { CATEGORIES } from "@/lib/mapping/populations";

/**
 * Staged CSV intake (task #48). Upload → analyze (parse + profile + propose a
 * mapping, stage rows tenant-side) → the operator reviews the mapping and
 * chooses surfaced fields → commit resolves rows into the identity graph and
 * a pending population. Everything runs in-app against the tenant's own data;
 * the file's content never goes to a third party during analysis.
 */

export async function analyzeUploadAction(formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool); // viewers are read-only (multi-tenant slice 3)
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file first.");
  if (file.size > MAX_CSV_BYTES) {
    throw new Error(`File too large — the cap is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)}MB per upload.`);
  }

  const csv = await file.text();
  const db = await pool.connect();
  let batchId: string;
  try {
    const result = await analyzeCsvToBatch(db, {
      orgId,
      csv,
      filename: file.name || null,
      uploadedBy: "web",
    });
    batchId = result.batchId;
  } finally {
    db.release();
  }
  revalidatePath("/intake");
  redirect(`/intake/${batchId}`);
}

export async function commitImportAction(batchId: string, formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");

  const db = await pool.connect();
  let populationId: string;
  let imported = 0;
  try {
    const batch = await loadStagedBatch(db, { orgId, batchId });
    if (!batch) throw new Error("Import not found or already handled.");

    // Column targets: inputs named target_<index>. Unknown/duplicate targets
    // are dropped server-side — the client is a convenience, not the gate.
    const rawTargets: Record<string, string> = {};
    for (let i = 0; i < batch.headers.length; i++) {
      const v = formData.get(`target_${i}`);
      if (typeof v === "string") rawTargets[String(i)] = v;
    }
    const targets = sanitizeTargets(rawTargets, batch.headers);

    // Surfaced fields — only keys that are actually mapped can be surfaced.
    const mappedKeys = new Set(Object.values(targets));
    const surfaced = formData
      .getAll("surfaced")
      .map((v) => String(v))
      .filter((k) => mappedKeys.has(k));

    const name = String(formData.get("name") ?? "").trim() || batch.filename || "Imported list";
    const categoryRaw = String(formData.get("category") ?? "custom");
    const category = (CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : "custom";

    // Partner: an existing one, a new one by name, or none (our own list).
    let partnerId: string | null = null;
    const partnerSel = String(formData.get("partnerId") ?? "");
    const newPartner = String(formData.get("newPartner") ?? "").trim();
    if (partnerSel === "new" && newPartner) {
      const type = String(formData.get("newPartnerType") ?? "reseller");
      const existing = await db.query<{ id: string }>(
        `select id from partners where org_id = $1 and lower(name) = lower($2) limit 1`,
        [orgId, newPartner],
      );
      partnerId =
        existing.rows[0]?.id ??
        (
          await db.query<{ id: string }>(
            `insert into partners (org_id, name, partner_type) values ($1, $2, $3) returning id`,
            [orgId, newPartner, type],
          )
        ).rows[0].id;
    } else if (partnerSel && partnerSel !== "none" && partnerSel !== "new") {
      const { rows } = await db.query<{ id: string }>(`select id from partners where id = $1 and org_id = $2`, [
        partnerSel,
        orgId,
      ]);
      partnerId = rows[0]?.id ?? null;
    }

    const result = await commitImportBatch(db, {
      orgId,
      batchId,
      targets,
      surfaced,
      population: { name, category, partnerId },
    });
    populationId = result.populationId;
    imported = result.imported;
  } finally {
    db.release();
  }

  revalidatePath("/intake");
  revalidatePath("/mapping");
  revalidatePath("/contacts");
  redirect(
    `/mapping?view=review&notice=${encodeURIComponent(
      `Imported ${imported} accounts — the list is pending your review before it joins the matrix.`,
    )}&pop=${populationId}`,
  );
}

export async function discardImportAction(batchId: string): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const db = await pool.connect();
  try {
    await discardImportBatch(db, { orgId, batchId });
  } finally {
    db.release();
  }
  revalidatePath("/intake");
  redirect("/intake");
}
