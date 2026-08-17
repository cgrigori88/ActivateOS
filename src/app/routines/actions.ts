"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { runRoutine, type RoutineRow } from "@/lib/routines/routines";

/**
 * Routines control (task #73). Toggle/config are operator-level (requireWrite,
 * same as every other data action); the routines themselves are read-only
 * digests, so "Run now" is safe to expose inline — locally it runs in-process,
 * in production the worker runs the schedule and this button runs on demand.
 */

async function routineForOrg(routineId: string): Promise<{ pool: ReturnType<typeof getPool>; routine: RoutineRow }> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const { rows } = await pool.query<RoutineRow>(
    `select id, org_id, kind, enabled, config, state, last_run_at from routines where id = $1 and org_id = $2`,
    [routineId, orgId],
  );
  if (!rows[0]) throw new Error("Routine not found.");
  return { pool, routine: rows[0] };
}

export async function toggleRoutineAction(routineId: string, formData: FormData): Promise<void> {
  const { pool, routine } = await routineForOrg(routineId);
  const enable = formData.get("enable") === "1";
  await pool.query(`update routines set enabled = $2 where id = $1`, [routine.id, enable]);
  revalidatePath("/routines");
}

export async function saveRoutineConfigAction(routineId: string, formData: FormData): Promise<void> {
  const { pool, routine } = await routineForOrg(routineId);
  const hourUtc = Math.min(23, Math.max(0, Number(formData.get("hourUtc") ?? 7) || 0));
  const config: Record<string, unknown> = { ...routine.config, hourUtc };
  if (routine.kind === "morning_brief") {
    const recipient = String(formData.get("recipient") ?? "").trim().toLowerCase();
    if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipient)) throw new Error("That recipient email doesn't look valid.");
    config.recipient = recipient || undefined;
  }
  if (routine.kind === "account_digest") {
    config.weekday = Math.min(6, Math.max(0, Number(formData.get("weekday") ?? 1) || 0));
  }
  await pool.query(`update routines set config = $2 where id = $1`, [routine.id, JSON.stringify(config)]);
  revalidatePath("/routines");
}

export async function runRoutineNowAction(routineId: string): Promise<void> {
  const { pool, routine } = await routineForOrg(routineId);
  await runRoutine(pool, routine);
  revalidatePath("/routines");
  revalidatePath("/accounts");
}
