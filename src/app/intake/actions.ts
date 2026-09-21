"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { asDataEnvironment } from "@/lib/pursuits/provenance";
import { supabaseServer } from "@/lib/auth/supabase";

/** The authenticated uploader, or null outside an identity session. Never from the request body. */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await (await supabaseServer()).auth.getUser();
    return data.user?.id ?? null;
  } catch { return null; }
}
import {
  analyzeCsvToBatch,
  commitCrmBatch,
  commitEnrichmentBatch,
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
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file first.");
  if (file.size > MAX_CSV_BYTES) {
    throw new Error(`File too large — the cap is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)}MB per upload.`);
  }

  const csv = await file.text();
  const kindRaw = String(formData.get("kind") ?? "book");
  const kind = kindRaw === "crm" ? ("crm" as const) : kindRaw === "enrichment" ? ("enrichment" as const) : ("book" as const);
  const sourceLabel = kind === "enrichment" ? String(formData.get("sourceLabel") ?? "").trim() : "";

  const batchId = await withTenant(async (db, orgId) => {
    await requireWrite(db); // viewers are read-only (multi-tenant slice 3)
    /**
     * BOTH OF THESE COME FROM THE SERVER, AND NEITHER CAN COME FROM THE FILE.
     *
     * The uploader was the literal string "web", so no committed import could say who ran it. The
     * provenance is the ORGANIZATION'S — a CSV may not declare itself PILOT, DEMO, CERTIFICATION or
     * PRODUCTION, because a file that names its own environment can place anything into the one
     * environment a learning corpus admits.
     *
     * An organization with no provenance recorded yields null, and the batch stays unclassified
     * rather than inheriting a guess. That is the same rule 0120 applied to credentials, one level
     * up: the thing that has not been classified must not be silently classified as PRODUCTION.
     */
    const uploadedByUserId = await currentUserId();
    const { rows: orgRows } = await db.query<{ data_environment: string | null }>(
      `select data_environment from organizations where id = $1`, [orgId]);
    const result = await analyzeCsvToBatch(db, {
      orgId,
      csv,
      filename: file.name || null,
      uploadedBy: "web",
      uploadedByUserId,
      dataEnvironment: asDataEnvironment(orgRows[0]?.data_environment ?? null),
      kind,
      sourceLabel: sourceLabel || undefined,
    });
    return result.batchId;
  });
  revalidatePath("/intake");
  redirect(`/intake/${batchId}`);
}

export async function commitImportAction(batchId: string, formData: FormData): Promise<void> {
  const { populationId, imported } = await withTenant(async (db, orgId) => {
    await requireWrite(db);

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
        `select id from partners where org_id = $1 and lower(name) = lower($2) order by id limit 1`,
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
    return { populationId: result.populationId, imported: result.imported };
  });

  revalidatePath("/intake");
  revalidatePath("/mapping");
  revalidatePath("/contacts");
  redirect(
    `/mapping?view=review&notice=${encodeURIComponent(
      `Imported ${imported} accounts — the list is pending your review before it joins the matrix.`,
    )}&pop=${populationId}`,
  );
}

/**
 * CRM lane (task #83): rows become snapshots + evidence; opportunities are
 * synced in only where the account holds nothing. Never overwrites — the
 * disagreements surface on Today as crm_vs_platform divergences.
 */
export async function commitCrmAction(batchId: string, formData: FormData): Promise<void> {
  const { snapshots, oppsCreated } = await withTenant(async (db, orgId) => {
    await requireWrite(db);

    const batch = await loadStagedBatch(db, { orgId, batchId });
    if (!batch) throw new Error("Import not found or already handled.");
    const rawTargets: Record<string, string> = {};
    for (let i = 0; i < batch.headers.length; i++) {
      const v = formData.get(`target_${i}`);
      if (typeof v === "string") rawTargets[String(i)] = v;
    }
    const targets = sanitizeTargets(rawTargets, batch.headers);
    const result = await commitCrmBatch(db, { orgId, batchId, targets });
    return { snapshots: result.snapshots, oppsCreated: result.oppsCreated };
  });

  revalidatePath("/intake");
  revalidatePath("/pipeline");
  revalidatePath("/");
  redirect(
    `/intake?notice=${encodeURIComponent(
      `CRM export synced — ${snapshots} snapshot${snapshots === 1 ? "" : "s"}, ${oppsCreated} new opportunit${oppsCreated === 1 ? "y" : "ies"} created where you held nothing. Disagreements with live records surface on Today.`,
    )}`,
  );
}

export async function commitEnrichmentAction(batchId: string, formData: FormData): Promise<void> {
  const { evidenceAdded, filled } = await withTenant(async (db, orgId) => {
    await requireWrite(db);

    const batch = await loadStagedBatch(db, { orgId, batchId });
    if (!batch) throw new Error("Import not found or already handled.");
    const rawTargets: Record<string, string> = {};
    for (let i = 0; i < batch.headers.length; i++) {
      const v = formData.get(`target_${i}`);
      if (typeof v === "string") rawTargets[String(i)] = v;
    }
    const targets = sanitizeTargets(rawTargets, batch.headers);
    const result = await commitEnrichmentBatch(db, { orgId, batchId, targets });
    return { evidenceAdded: result.evidenceAdded, filled: result.firmographicsFilled };
  });

  revalidatePath("/intake");
  revalidatePath("/accounts");
  redirect(
    `/intake?notice=${encodeURIComponent(
      `Enrichment imported — ${evidenceAdded} signal${evidenceAdded === 1 ? "" : "s"} landed as evidence (vendor named as provenance) and ${filled} account${filled === 1 ? "" : "s"} gained missing firmographics. The next scoring sweep reads all of it.`,
    )}`,
  );
}

export async function discardImportAction(batchId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await discardImportBatch(db, { orgId, batchId });
  });
  revalidatePath("/intake");
  redirect("/intake");
}


/**
 * Reverse a committed import.
 *
 * THIS IS THE ACTION THAT REMOVES THE ENGINEER FROM THE LOOP. Before it, undoing a bad pilot upload
 * meant someone with a SQL prompt guessing which rows had come from which file — and the
 * information needed to guess correctly had been deleted at commit time.
 *
 * It compensates; it does not erase. The batch, its effects and the disposition of every reversal
 * attempt all survive, including the ones that refused: a shared identity record retained by rule, a
 * field a person has since corrected, an opportunity a pursuit now depends on.
 */
export async function reverseImportAction(batchId: string): Promise<void> {
  const summary = await withTenant(async (db, orgId) => {
    await requireWrite(db);
    const { reverseBatch } = await import("@/lib/ingest/lineage");
    const { data } = await (await supabaseServer()).auth.getUser().catch(() => ({ data: { user: null } }));
    return reverseBatch(db, { orgId, batchId, userId: data.user?.id ?? null });
  });
  void summary;
  revalidatePath("/intake");
  revalidatePath(`/intake/${batchId}`);
}
