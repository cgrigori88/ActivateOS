"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { requireWrite } from "@/lib/auth/org";
import { resolveMotionAction } from "@/lib/motions/cadence";

export async function resolveActionAction(
  actionId: string,
  status: "done" | "skipped",
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await resolveMotionAction(db, actionId, status);
  } finally {
    db.release();
  }
  revalidatePath("/queue");
}

export async function resolveCommActionAction(
  actionId: string,
  status: "done" | "dismissed",
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query(
      `update communication_actions set status = $2 where id = $1 and status = 'pending'`,
      [actionId, status],
    );
  } finally {
    db.release();
  }
  revalidatePath("/queue");
}
