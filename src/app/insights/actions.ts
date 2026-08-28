"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { STAGES } from "@/lib/opportunities/lifecycle";
import { isTriggerKey, setTriggerEnabled } from "@/lib/triggers/catalog";

/**
 * Editable stage weights (migration 0036). Scope "" = the org default curve;
 * a partner id = that partner's override. Values arrive as whole percents.
 * Saving writes only stages that differ from what fallback would produce is
 * NOT attempted — explicit rows are stored for every stage in the scope, so
 * the operator sees exactly what they set. Reset deletes the scope's rows and
 * the declared v1 curve (or org default, for a partner) takes over again.
 */
export async function saveStageWeightsAction(formData: FormData): Promise<void> {
  const scope = String(formData.get("scope") ?? "").trim();
  const partnerId = scope || null;
  const reset = formData.get("reset") === "1";

  // Pure validation up front: parse + range-check every supplied stage weight
  // before opening the tenant transaction.
  const weights: { stage: string; probability: number }[] = [];
  if (!reset) {
    for (const stage of STAGES) {
      const raw = String(formData.get(`w_${stage}`) ?? "").trim();
      if (!raw) continue;
      const pct = Number(raw);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error(`"${stage.replace(/_/g, " ")}" must be between 0 and 100 (got ${raw}).`);
      }
      weights.push({ stage, probability: pct / 100 });
    }
  }

  await withTenant(async (db, orgId) => {
    await requireWrite(db);

    if (partnerId) {
      const { rows } = await db.query(`select 1 from partners where id = $1 and org_id = $2`, [partnerId, orgId]);
      if (rows.length === 0) throw new Error("Unknown partner for this organization.");
    }

    if (reset) {
      await db.query(
        `delete from stage_weights where org_id = $1 and partner_id is not distinct from $2`,
        [orgId, partnerId],
      );
      return;
    }

    for (const w of weights) {
      await db.query(
        `insert into stage_weights (org_id, partner_id, stage, probability, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (org_id, partner_id, stage) do update
           set probability = excluded.probability, updated_at = now()`,
        [orgId, partnerId, w.stage, w.probability],
      );
    }
  });

  revalidatePath("/insights");
  revalidatePath("/pipeline");
}

/**
 * Attention-trigger toggles (task #83): flip one catalog trigger on or off
 * for the org. The catalog itself lives in code — this only stores the
 * preference; every surface that runs the trigger re-reads it on render.
 */
export async function setTriggerEnabledAction(formData: FormData): Promise<void> {
  const key = String(formData.get("trigger") ?? "").trim();
  if (!isTriggerKey(key)) throw new Error(`Unknown trigger "${key}".`);
  const enabled = String(formData.get("enabled")) === "1";

  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await setTriggerEnabled(db, orgId, key, enabled);
  });

  revalidatePath("/insights");
  revalidatePath("/");
  revalidatePath("/pipeline");
}
