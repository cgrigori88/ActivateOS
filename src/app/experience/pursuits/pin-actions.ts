"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { dynamicSurfacesEnabled } from "@/lib/experience/surface/assemble";
import { deletePin, renamePin } from "@/lib/experience/surface/pin-repository";
import { currentPrincipal } from "./binding";

/**
 * P7 Slice 12 — THE TWO EXPLICIT LIFECYCLE MUTATIONS for a saved surface definition.
 *
 * > **Opening/rendering a pin is read-only. Rename and delete require explicit user mutation intent.**
 *
 * WHY THIS IS A SERVER ACTION AND NOT A SEARCH PARAM. `?open=` is a GET, and a GET is issued by
 * crawlers, prefetchers, link previews, the browser's own speculative navigation and anything that
 * follows a URL. Renaming or deleting durable state from one would mean a render could destroy data
 * — so these live behind POST-only server actions carrying the framework's origin checks, exactly
 * like `./actions.ts`, rather than behind `?rename=` and `?delete=`.
 *
 * WHAT THE CALLER MAY SUPPLY, AND WHAT IT BUYS THEM. The pin id, and for rename the new display
 * name. That is all, and the id grants NOTHING: it names WHICH row, and the repository re-scopes
 * every statement by `org_id` AND `created_by_user_id` derived server-side. A caller naming someone
 * else's pin gets the same answer as one naming a pin that never existed.
 *
 * WHAT THE CALLER MAY NOT SUPPLY, by construction rather than by validation: the organization (it
 * comes from the session through `withTenant`), the creator (it comes from `currentPrincipal()`),
 * the definition bytes, the digest, or any semantic content. There is no parameter for any of them,
 * so there is nothing to check.
 *
 * RENAME IS NOT AN EDIT. It reaches `renamePin`, which sets `name` and `updated_at` and nothing
 * else; the definition column is not in the statement and `definitionDigest` is computed from the
 * definition alone, so neither can move because a label changed.
 *
 * NEITHER OUTCOME IS REPORTED BACK. Both redirect to the same place whether or not anything
 * happened, because "not yours" and "not there" are ONE answer everywhere else in this slice — a
 * distinguishable failure here would make a peer's pin probeable through the mutation boundary
 * after the read boundary refused to leak it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The same two gates the read path passes, re-asked at mutation time.
 *
 * A capability can only ever narrow, so a saved pin must not remain mutable after the surface that
 * created it has been turned off for the tenant. `null` means "do nothing" — never a partial
 * mutation and never an explanation of which gate refused.
 */
async function mutatingPrincipal(): Promise<string | null> {
  if (!pursuitExperienceEnabled()) return null;
  if (!(await dynamicSurfacesEnabled())) return null;
  return currentPrincipal();
}

/** Rename a saved definition. DISPLAY METADATA ONLY. */
export async function renamePinnedSurface(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  if (UUID.test(id)) {
    const principal = await mutatingPrincipal();
    // `renamePin` re-scopes by org AND creator; a foreign or missing pin simply does not match.
    if (principal) await renamePin(principal, id, name);
    revalidatePath("/experience/pursuits");
  }
  // Same destination on every path — see the header note on indistinguishable outcomes.
  redirect(`/experience/pursuits?open=${id}`);
}

/** Hard-delete a saved definition. The row and nothing else. */
export async function deletePinnedSurface(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (UUID.test(id)) {
    const principal = await mutatingPrincipal();
    if (principal) await deletePin(principal, id);
    revalidatePath("/experience/pursuits");
  }
  redirect("/experience/pursuits");
}
