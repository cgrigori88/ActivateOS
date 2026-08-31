"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db/tenant";
import { currentRole } from "@/lib/auth/org";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { experienceEnabledFor } from "@/lib/pursuits/tenant-flags";
import { dispatchSkill } from "@/lib/pursuits/federation/skills";

/**
 * Governed route decision (canonical micro-loop). The Pursuit detail route panel calls this; it is
 * the ONLY human entry point and it goes through the single mutation authority (`dispatchSkill`),
 * never a bespoke write. `select` approves the recommended route; `override` records a human
 * decision that diverges from the recommendation (reason required). Authorization, effect-class
 * routing, idempotency, audit (governed_action_invocations) and the recompute enqueue all happen
 * inside the governed path. A correlation id ties the invocation to the recompute chain.
 */
export async function decideRouteAction(
  pursuitId: string,
  candidateKey: string,
  mode: "select" | "override",
  reason: string | null,
  category: string | null,
): Promise<{ ok: boolean; status?: string; error?: string; correlationId?: string; invocationId?: string | null }> {
  if (!pursuitId || !candidateKey) return { ok: false, error: "Missing pursuit or route candidate." };
  if (mode === "override" && !(reason && reason.trim())) return { ok: false, error: "An override needs a reason — the recommendation is preserved either way." };
  if (!pursuitExperienceEnabled()) return { ok: false, error: "Pursuit experience is not enabled." };

  const correlationId = randomUUID();
  const result = await withTenant(async (db, orgId) => {
    if (!(await experienceEnabledFor(db, orgId))) return { ok: false as const, error: "Not enabled for this tenant." };
    const role = await currentRole(db);
    // The dispatch boundary re-checks permission; this is the polite app-layer refusal.
    if (role !== "owner" && role !== "operator") return { ok: false as const, error: "Read-only access — ask an owner to make you an operator." };

    // Keep DEMO/synthetic pursuits labeled DEMO through the ledger + recompute (never PRODUCTION).
    const env = (await db.query<{ data_environment: string }>(`select data_environment from pursuits where id = $1`, [pursuitId])).rows[0]?.data_environment ?? "PRODUCTION";

    const skillId = mode === "override" ? "override_partner_route" : "select_partner_route";
    const dispatch = await dispatchSkill(db, skillId, { type: "USER", id: null, orgId, role }, {
      pursuitId,
      args: { candidateKey, reason: reason ?? undefined, category: category ?? undefined },
      correlationId,
      idempotencyKey: `route-decision:${pursuitId}:${candidateKey}:${correlationId}`,
      dataEnvironment: env,
    });
    return { ok: dispatch.status === "EXECUTED", status: dispatch.status, error: dispatch.status === "EXECUTED" ? undefined : (dispatch.reason ?? "Decision was not accepted."), invocationId: dispatch.invocationId };
  });

  if (result.ok) {
    revalidatePath(`/pursuits/${pursuitId}`);
    revalidatePath("/");
  }
  return { ...result, correlationId };
}
