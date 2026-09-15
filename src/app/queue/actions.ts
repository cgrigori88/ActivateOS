"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { resolveMotionAction } from "@/lib/motions/cadence";

/*
 * Tenant-scoped writes (2026-09-14 hardening). The action id comes from the form, so it is never
 * trusted alone: each update also requires the row to belong to the caller's org, resolved
 * server-side by withTenant. Before this pass both updates matched on id only — and with RLS
 * inert on the owner-role path (task #67), any org could resolve another org's queue item.
 */

export async function resolveActionAction(
  actionId: string,
  status: "done" | "skipped",
): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await resolveMotionAction(db, actionId, status, orgId);
  });
  revalidatePath("/queue");
}

export async function resolveCommActionAction(
  actionId: string,
  status: "done" | "dismissed",
): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await db.query(
      `update communication_actions set status = $2 where id = $1 and status = 'pending' and org_id = $3`,
      [actionId, status, orgId],
    );
  });
  revalidatePath("/queue");
}
