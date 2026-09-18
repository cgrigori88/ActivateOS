import "server-only";
import { withTenant } from "@/lib/db/tenant";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";

/**
 * P7 Slice 10 — THE RENDER BINDING. Integrity material, and nothing else.
 *
 * > **Render binding proves "this is the subject this server rendered for this principal/scope." It
 * > does not prove "this principal is still authorized to act."**
 *
 * This module is deliberately NOT a `"use server"` file. Everything exported from one of those
 * becomes a callable endpoint, and a helper that reports who the server thinks you are has no
 * business being one. It is `server-only` instead, so it cannot reach a client bundle either.
 *
 * WHAT IT IS FOR. The values below are closed over by the rendering layer, which is what makes the
 * framework encrypt them (see `02-guides/data-security.md`: closed-over variables are encrypted; bound
 * arguments are not). On invocation the server derives the same two values INDEPENDENTLY and compares.
 * That comparison answers *"is this the affordance this server rendered for this principal in this
 * scope"* — a request-integrity question. It answers nothing about authority, which `dispatchSkill`
 * decides afterwards and alone.
 */
export interface RenderBinding {
  /** The subject the SERVER selected and rendered into this affordance. */
  subjectId: string;
  /** The principal the affordance was rendered FOR. */
  principal: string | null;
  /** The organization/scope it was rendered IN. */
  orgId: string;
}

/**
 * Who the server thinks is acting. Derived server-side, never accepted from a caller.
 *
 * `null` means no identity could be resolved — a property of the deployment's auth posture, not a
 * claim about this request. The comparison at invocation therefore discriminates only where identity
 * exists; where it does not, null equals null and the check is vacuous. That limitation is stated
 * rather than disguised as a guarantee.
 */
export async function currentPrincipal(): Promise<string | null> {
  if (!authConfigured()) return null;
  try {
    const supabase = await supabaseServer();
    return (await supabase.auth.getUser()).data.user?.id ?? null;
  } catch { return null; }
}

/** Build the binding for one rendered affordance. Reads nothing about the subject; it is not a check. */
export async function currentRenderBinding(subjectId: string): Promise<RenderBinding> {
  const principal = await currentPrincipal();
  const orgId = await withTenant(async (_db, org) => org);
  return { subjectId, principal, orgId };
}
