"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { sendTouchNow } from "@/lib/comms/sequence";

/** Send a due (or early) scheduled touch to its campaign recipient, now. */
export async function sendScheduledAction(touchId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await sendTouchNow(db, { touchId });
  });
  revalidatePath("/upcoming");
}

/** Pull a touch back off the calendar: scheduled -> approved, date cleared.
    It can be re-scheduled from its campaign (or sent manually) any time. */
export async function unscheduleAction(touchId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await db.query(
      `update campaign_touches set status = 'approved', scheduled_at = null
       where id = $1 and status = 'scheduled'`,
      [touchId],
    );
  });
  revalidatePath("/upcoming");
}
