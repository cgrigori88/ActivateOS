"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { sendTouchNow } from "@/lib/comms/sequence";

/** Send a due (or early) scheduled touch to its campaign recipient, now. */
export async function sendScheduledAction(touchId: string): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await sendTouchNow(db, { touchId });
  } finally {
    db.release();
  }
  revalidatePath("/upcoming");
}
