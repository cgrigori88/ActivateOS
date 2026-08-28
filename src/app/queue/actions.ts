"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { resolveMotionAction } from "@/lib/motions/cadence";

export async function resolveActionAction(
  actionId: string,
  status: "done" | "skipped",
): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await resolveMotionAction(db, actionId, status);
  });
  revalidatePath("/queue");
}

export async function resolveCommActionAction(
  actionId: string,
  status: "done" | "dismissed",
): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await db.query(
      `update communication_actions set status = $2 where id = $1 and status = 'pending'`,
      [actionId, status],
    );
  });
  revalidatePath("/queue");
}
