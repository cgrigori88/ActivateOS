"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { requireWrite } from "@/lib/auth/org";
import { sendTouchNow } from "@/lib/comms/sequence";

/** Send a due (or early) scheduled touch to its campaign recipient, now. */
export async function sendScheduledAction(touchId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await sendTouchNow(db, { touchId });
  } finally {
    db.release();
  }
  revalidatePath("/upcoming");
}

/** Pull a touch back off the calendar: scheduled -> approved, date cleared.
    It can be re-scheduled from its campaign (or sent manually) any time. */
export async function unscheduleAction(touchId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  await getPool().query(
    `update campaign_touches set status = 'approved', scheduled_at = null
     where id = $1 and status = 'scheduled'`,
    [touchId],
  );
  revalidatePath("/upcoming");
}
