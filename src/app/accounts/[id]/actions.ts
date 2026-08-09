"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";

/** Partner-manager gate on routing: accept or decline the recommended team. */
export async function setTeamStatusAction(
  teamId: string,
  status: "accepted" | "declined",
): Promise<void> {
  const pool = getPool();
  const db = await pool.connect();
  try {
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
    revalidatePath(`/accounts/${rows[0].company_id}`);
  } finally {
    db.release();
  }
}
