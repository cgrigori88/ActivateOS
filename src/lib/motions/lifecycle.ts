import type pg from "pg";
import { createMotionActions } from "./cadence";

/**
 * Motion lifecycle (BLUEPRINT Phase 3): draft → approved → active → closed.
 * Transitions are an explicit whitelist — a motion can never skip its human
 * approval gate or reopen after closing. Every transition lands in the
 * outcome-event log with a timestamp.
 */

export type MotionStatus = "draft" | "approved" | "active" | "completed" | "abandoned";
export type MotionOutcome = "won" | "lost" | "no_decision";

export const ALLOWED_TRANSITIONS: Record<MotionStatus, MotionStatus[]> = {
  draft: ["approved", "abandoned"],
  approved: ["active", "abandoned"],
  active: ["completed", "abandoned"],
  completed: [],
  abandoned: [],
};

export function canTransition(from: MotionStatus, to: MotionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const EVENT_BY_TARGET: Record<string, string> = {
  active: "MOTION_ACTIVATED",
  completed: "MOTION_COMPLETED",
  abandoned: "MOTION_ABANDONED",
};

/**
 * Transition a motion. Completion requires an outcome — a motion never
 * closes without saying how it ended; that outcome is the raw material of
 * the learning loop (Phase 7).
 */
export async function transitionMotion(
  db: pg.PoolClient,
  motionId: string,
  to: Exclude<MotionStatus, "draft" | "approved">,
  opts: { outcome?: MotionOutcome } = {},
): Promise<void> {
  if (to === "completed" && !opts.outcome) {
    throw new Error("completing a motion requires an outcome (won/lost/no_decision)");
  }

  const { rows } = await db.query<{
    org_id: string | null;
    company_id: string;
    status: MotionStatus;
  }>(`select org_id, company_id, status from revenue_motions where id = $1`, [motionId]);
  if (rows.length === 0) throw new Error(`motion not found: ${motionId}`);
  const motion = rows[0];
  if (!canTransition(motion.status, to)) {
    throw new Error(`illegal transition: ${motion.status} → ${to}`);
  }

  const sets = [`status = $2`];
  if (to === "active") sets.push(`activated_at = now()`);
  if (to === "completed" || to === "abandoned") sets.push(`closed_at = now()`);
  const params: unknown[] = [motionId, to];
  if (opts.outcome) {
    params.push(opts.outcome);
    sets.push(`outcome = $${params.length}`);
  }
  await db.query(`update revenue_motions set ${sets.join(", ")} where id = $1`, params);

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      motion.org_id,
      motionId,
      motion.company_id,
      EVENT_BY_TARGET[to],
      JSON.stringify({ from: motion.status, outcome: opts.outcome ?? null }),
    ],
  );

  // Activation means scheduled work: the play cadence becomes dated actions.
  if (to === "active") {
    await createMotionActions(db, motionId);
  }
}
