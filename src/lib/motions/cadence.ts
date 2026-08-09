import type pg from "pg";

/**
 * Cadence instantiation (BLUEPRINT Phase 4): the play's seller cadence —
 * abstract steps with day offsets — becomes concrete dated actions the
 * moment a motion activates. Pure math on the activation date; skipping
 * weekends keeps due dates actionable.
 */

export interface CadenceStep {
  step: number;
  action: string;
  day: number; // offset in days from activation
}

/** Shift a date off Saturday/Sunday onto the following Monday. */
export function nextBusinessDay(d: Date): Date {
  const out = new Date(d);
  const dow = out.getUTCDay();
  if (dow === 6) out.setUTCDate(out.getUTCDate() + 2);
  else if (dow === 0) out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

export function instantiateCadence(
  steps: CadenceStep[],
  activatedAt: Date,
): { step: number; action: string; dueAt: Date }[] {
  return [...steps]
    .sort((a, b) => a.step - b.step)
    .map((s) => ({
      step: s.step,
      action: s.action,
      dueAt: nextBusinessDay(new Date(activatedAt.getTime() + s.day * 86_400_000)),
    }));
}

/** Create the action queue for a newly-activated motion (idempotent). */
export async function createMotionActions(
  db: pg.PoolClient,
  motionId: string,
  activatedAt: Date = new Date(),
): Promise<number> {
  const { rows } = await db.query<{ org_id: string | null; definition: unknown }>(
    `select m.org_id, pt.definition
     from revenue_motions m join play_templates pt on pt.id = m.play_template_id
     where m.id = $1`,
    [motionId],
  );
  if (rows.length === 0) throw new Error(`motion not found: ${motionId}`);
  const cadence = (rows[0].definition as { seller_cadence?: CadenceStep[] }).seller_cadence;
  if (!cadence || cadence.length === 0) return 0;

  let created = 0;
  for (const a of instantiateCadence(cadence, activatedAt)) {
    const { rowCount } = await db.query(
      `insert into motion_actions (org_id, motion_id, step, action, due_at)
       values ($1, $2, $3, $4, $5)
       on conflict (motion_id, step) do nothing`,
      [rows[0].org_id, motionId, a.step, a.action, a.dueAt],
    );
    created += rowCount ?? 0;
  }
  return created;
}

/** Mark an action done/skipped and log the event. */
export async function resolveMotionAction(
  db: pg.PoolClient,
  actionId: string,
  status: "done" | "skipped",
): Promise<void> {
  const { rows } = await db.query<{
    org_id: string | null;
    motion_id: string;
    company_id: string;
    step: number;
  }>(
    `update motion_actions a set status = $2, completed_at = now()
     from revenue_motions m
     where a.id = $1 and a.status = 'pending' and m.id = a.motion_id
     returning a.org_id, a.motion_id, m.company_id, a.step`,
    [actionId, status],
  );
  if (rows.length === 0) throw new Error(`action not found or already resolved: ${actionId}`);
  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      rows[0].org_id,
      rows[0].motion_id,
      rows[0].company_id,
      status === "done" ? "ACTION_DONE" : "ACTION_SKIPPED",
      JSON.stringify({ step: rows[0].step }),
    ],
  );
}
