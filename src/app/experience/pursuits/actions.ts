"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db/tenant";
import { currentRole } from "@/lib/auth/org";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { experienceEnabledFor, tenantFeatures } from "@/lib/pursuits/tenant-flags";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { dispatchSkill } from "@/lib/pursuits/federation/skills";
import { ACTION_CAPABILITIES } from "@/lib/experience/surface/actions";

/**
 * P7 Slice 9 — THE ONE HUMAN INVOCATION BOUNDARY for a Dynamic Surface action.
 *
 * > **An action affordance identifies a possible operation. It is not a capability token.**
 *
 * This mirrors `src/app/pursuits/[id]/actions.ts` deliberately, down to the shape: the certified
 * invocation path already exists, and building a second one would mean a second set of protections
 * to keep correct. A Next server action is POST-only by construction and carries the framework's
 * origin checks; the organization comes from `withTenant` (the session), never from the caller; the
 * role is read server-side; and the mutation goes through `dispatchSkill`, which remains the single
 * authority — registry, idempotency, eligibility, role rank, governed actor, precheck, authorize,
 * handler, and the attempt/audit record.
 *
 * THE SKILL IS FIXED HERE, NOT SUPPLIED (ruling C). There is no `skillId` parameter, so a browser
 * cannot turn one rendered affordance into a generic skill-dispatch endpoint. A generic dispatcher
 * needs its own ruling once more than one action component exists.
 *
 * THE PURSUIT ID IS UNTRUSTED ROUTING INPUT. It names WHICH object and grants nothing: the server
 * re-derives principal, org and role, and `dispatchSkill`'s `pursuitInOrg` precheck plus RLS refuse
 * a pursuit outside the actor's organization. Nothing from render time is trusted — not the role
 * that decided to show the button, not the manifest the subject came from, not the surface itself.
 *
 * IT CREATES NO P45 STATE. No plan, no run, no approval, no runtime entry point: the substrate is
 * `dispatchSkill`, named explicitly in the action registry, and the P45 control plane stays inert.
 */
export async function assemblePursuitTeamFromSurface(
  pursuitId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!pursuitId) return { ok: false, error: "Missing pursuit." };
  if (!pursuitExperienceEnabled()) return { ok: false, error: "Pursuit experience is not enabled." };

  // The capability is read from the registry, never assembled from an argument.
  const capability = ACTION_CAPABILITIES["pursuit.assemble_team"]!;
  const correlationId = randomUUID();

  const result = await withTenant(async (db, orgId) => {
    if (!(await experienceEnabledFor(db, orgId))) return { ok: false as const, error: "Not enabled for this tenant." };
    // The surface's own capability must be on, exactly as the surface's read path requires — a
    // flag can only ever narrow, so an action cannot outlive the surface that offered it.
    if (!vnextCapabilities(await tenantFeatures(db, orgId)).dynamicSurfaces) {
      return { ok: false as const, error: "This capability is not enabled here." };
    }
    // Resolved AGAIN, server-side, at click time. The render-time decision is not consulted.
    const role = await currentRole(db);
    if (role !== "owner" && role !== "operator") {
      return { ok: false as const, error: "Read-only access — ask an owner to make you an operator." };
    }
    // Keep DEMO/synthetic pursuits labeled DEMO through the ledger and recompute (never PRODUCTION).
    const env = (await db.query<{ data_environment: string }>(
      `select data_environment from pursuits where id = $1 and org_id = $2`, [pursuitId, orgId]
    )).rows[0]?.data_environment ?? "PRODUCTION";

    const dispatch = await dispatchSkill(db, capability.skillId, { type: "USER", id: null, orgId, role }, {
      pursuitId,
      // NO `args`. The capability declares `callerArguments: "NONE"`, and there is nothing to pass:
      // `assembleTeam` derives everything from the pursuit through existing product logic.
      correlationId,
      idempotencyKey: `surface-assemble-team:${pursuitId}:${correlationId}`,
      dataEnvironment: env,
    });
    return {
      ok: dispatch.status === "EXECUTED",
      error: dispatch.status === "EXECUTED" ? undefined : (dispatch.reason ?? "That action was not accepted."),
    };
  });

  if (result.ok) revalidatePath(`/pursuits/${pursuitId}`);
  return result;
}

/**
 * The form-bound wrapper. A `<form action>` must resolve to void, so this exists purely to satisfy
 * that signature — it adds no authority, reads no FormData, and cannot vary the capability or the
 * subject: both are bound server-side before the form is ever rendered.
 *
 * The outcome is intentionally not surfaced to the recipient in the first vertical. The action's
 * effect is visible where it belongs — on the pursuit itself, which `revalidatePath` refreshes —
 * and inventing a surface-local result banner would be the beginning of a surface-local action
 * state machine, which Slice 9 does not have.
 */
export async function assemblePursuitTeamFormAction(pursuitId: string, _formData: FormData): Promise<void> {
  await assemblePursuitTeamFromSurface(pursuitId);
}
