"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { sendTouchNow } from "@/lib/comms/sequence";

/** Send a due (or early) scheduled touch to its campaign recipient, now. */
export async function sendScheduledAction(touchId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await sendTouchNow(db, { orgId, touchId });
  });
  revalidatePath("/upcoming");
}

/** Pull a touch back off the calendar: scheduled -> approved, date cleared.
    It can be re-scheduled from its campaign (or sent manually) any time. */
export async function unscheduleAction(touchId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // campaign_touches has no org_id — scope via its parent campaign's org.
    await db.query(
      `update campaign_touches t set status = 'approved', scheduled_at = null
       from campaigns c
       where t.id = $1 and t.status = 'scheduled' and c.id = t.campaign_id and c.org_id = $2`,
      [touchId, orgId],
    );
  });
  revalidatePath("/upcoming");
}
