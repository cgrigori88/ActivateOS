"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { STAGES } from "@/lib/opportunities/lifecycle";

/**
 * Editable stage weights (migration 0036). Scope "" = the org default curve;
 * a partner id = that partner's override. Values arrive as whole percents.
 * Saving writes only stages that differ from what fallback would produce is
 * NOT attempted — explicit rows are stored for every stage in the scope, so
 * the operator sees exactly what they set. Reset deletes the scope's rows and
 * the declared v1 curve (or org default, for a partner) takes over again.
 */
export async function saveStageWeightsAction(formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");

  const scope = String(formData.get("scope") ?? "").trim();
  const partnerId = scope || null;

  if (partnerId) {
    const { rows } = await pool.query(`select 1 from partners where id = $1 and org_id = $2`, [partnerId, orgId]);
    if (rows.length === 0) throw new Error("Unknown partner for this organization.");
  }

  if (formData.get("reset") === "1") {
    await pool.query(
      `delete from stage_weights where org_id = $1 and partner_id is not distinct from $2`,
      [orgId, partnerId],
    );
    revalidatePath("/insights");
    revalidatePath("/pipeline");
    return;
  }

  for (const stage of STAGES) {
    const raw = String(formData.get(`w_${stage}`) ?? "").trim();
    if (!raw) continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error(`"${stage.replace(/_/g, " ")}" must be between 0 and 100 (got ${raw}).`);
    }
    await pool.query(
      `insert into stage_weights (org_id, partner_id, stage, probability, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (org_id, partner_id, stage) do update
         set probability = excluded.probability, updated_at = now()`,
      [orgId, partnerId, stage, pct / 100],
    );
  }

  revalidatePath("/insights");
  revalidatePath("/pipeline");
}
