"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { currentActor } from "@/lib/partnerships/partnerships";
import { addMeetingNote } from "@/lib/context/meetings";

/** Meeting notes (task #86): each note is also first-party evidence + engagement. */
export async function addMeetingNoteAction(companyId: string, formData: FormData): Promise<void> {
  const note = {
    metAt: String(formData.get("metAt") ?? ""),
    title: String(formData.get("title") ?? ""),
    attendees: String(formData.get("attendees") ?? ""),
    body: String(formData.get("body") ?? ""),
    createdBy: await currentActor(),
  };
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await addMeetingNote(db, orgId, companyId, note);
  });
  revalidatePath(`/accounts/${companyId}`);
  redirect(`/accounts/${companyId}?notice=${encodeURIComponent("Meeting recorded — it now grounds the AI, counts as engagement, and appears on the timeline.")}`);
}

/** Partner-manager gate on routing: accept or decline the recommended team. */
export async function setTeamStatusAction(
  teamId: string,
  status: "accepted" | "declined",
): Promise<void> {
  const companyId = await withTenant(async (db) => {
    const { rows } = await db.query<{
      org_id: string | null;
      company_id: string;
    }>(
      `update pursuit_teams set status = $2
       where id = $1 and status = 'recommended'
       returning org_id, company_id`,
      [teamId, status],
    );
    if (rows.length === 0) throw new Error("team not found or already decided");
    await db.query(
      `insert into outcome_events (org_id, company_id, event_type, payload)
       values ($1, $2, $3, $4)`,
      [
        rows[0].org_id,
        rows[0].company_id,
        status === "accepted" ? "TEAM_ACCEPTED" : "TEAM_DECLINED",
        JSON.stringify({ teamId }),
      ],
    );
    return rows[0].company_id;
  });
  revalidatePath(`/accounts/${companyId}`);
}
