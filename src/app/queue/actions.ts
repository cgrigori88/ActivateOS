"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { resolveMotionAction } from "@/lib/motions/cadence";

export async function resolveActionAction(
  actionId: string,
  status: "done" | "skipped",
): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await resolveMotionAction(db, actionId, status);
  } finally {
    db.release();
  }
  revalidatePath("/queue");
}
