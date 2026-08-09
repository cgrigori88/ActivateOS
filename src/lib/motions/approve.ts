import type pg from "pg";

/**
 * Motion approval — the human gate (AGENT_LAYER rule 6: agents propose,
 * people dispose). Approval edits are captured as diffs on the agent run
 * (invariant: human corrections are never discarded — they are the raw
 * material of the learning loop).
 */

export type EditableField = "thesis" | "trigger_summary" | "primary_persona" | "secondary_persona" | "cta";
export const EDITABLE_FIELDS: EditableField[] = [
  "thesis",
  "trigger_summary",
  "primary_persona",
  "secondary_persona",
  "cta",
];

/** Pure: compute the human-edit diff for the decision log. */
export function computeMotionDiff(
  original: Record<string, string | null>,
  edits: Partial<Record<EditableField, string>>,
): Record<string, { from: string | null; to: string }> {
  const diff: Record<string, { from: string | null; to: string }> = {};
  for (const field of EDITABLE_FIELDS) {
    const to = edits[field];
    if (to != null && to !== original[field]) diff[field] = { from: original[field], to };
  }
  return diff;
}

export async function approveMotion(
  db: pg.PoolClient,
  motionId: string,
  edits: Partial<Record<EditableField, string>> = {},
): Promise<{ edited: boolean }> {
  const { rows } = await db.query(
    `select id, org_id, company_id, status, thesis, trigger_summary,
            primary_persona, secondary_persona, cta
     from revenue_motions where id = $1`,
    [motionId],
  );
  if (rows.length === 0) throw new Error(`motion not found: ${motionId}`);
  const motion = rows[0];
  if (motion.status !== "draft") throw new Error(`motion is ${motion.status}, not draft`);

  const diff = computeMotionDiff(motion, edits);
  const edited = Object.keys(diff).length > 0;

  const sets: string[] = [`status = 'approved'`, `approved_at = now()`];
  const params: unknown[] = [motionId];
  for (const [field, change] of Object.entries(diff)) {
    params.push(change.to);
    sets.push(`${field} = $${params.length}`);
  }
  await db.query(`update revenue_motions set ${sets.join(", ")} where id = $1`, params);

  await db.query(
    `update agent_runs set human_decision = $2, human_diff = $3
     where motion_id = $1 and workflow = 'motion_designer'`,
    [motionId, edited ? "edited" : "approved", edited ? JSON.stringify(diff) : null],
  );

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'MOTION_APPROVED', $4)`,
    [motion.org_id, motionId, motion.company_id, JSON.stringify({ edited, fields: Object.keys(diff) })],
  );
  return { edited };
}

export async function rejectMotion(db: pg.PoolClient, motionId: string, note?: string): Promise<void> {
  const { rows } = await db.query(
    `update revenue_motions set status = 'abandoned' where id = $1 and status = 'draft'
     returning org_id, company_id`,
    [motionId],
  );
  if (rows.length === 0) throw new Error(`motion not found or not a draft: ${motionId}`);

  await db.query(
    `update agent_runs set human_decision = 'rejected', human_diff = $2
     where motion_id = $1 and workflow = 'motion_designer'`,
    [motionId, note ? JSON.stringify({ note }) : null],
  );
  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'MOTION_REJECTED', $4)`,
    [rows[0].org_id, motionId, rows[0].company_id, JSON.stringify({ note: note ?? null })],
  );
}
