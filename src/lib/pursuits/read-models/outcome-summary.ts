import type { PoolClient } from "pg";

/**
 * Pursuit outcome + attribution summary (Phase B3 UX projection). A calm, evidence-bound read of the
 * canonical learning state for one pursuit: the latest commercial outcome, the attribution CLAIM
 * (with the human override winning if present), why it was assigned, and whether the decision's
 * recompute has settled. Read-only; never recomputes; renders UNKNOWN as UNKNOWN.
 */
export interface PursuitOutcomeSummary {
  latest: { label: string; isTerminal: boolean; occurredAt: string; valueAmount: number | null } | null;
  attribution: {
    effectiveClass: string;      // human override wins over the machine claim
    machineClass: string;
    overridden: boolean;
    subjectKind: string;
    subjectLabel: string | null;
    reason: string | null;
    modelVersion: string;
  } | null;
  recomputePending: boolean;     // an outcome-triggered recompute is still draining
  totalOutcomes: number;
}

export async function getPursuitOutcomeSummary(db: PoolClient, pursuitId: string): Promise<PursuitOutcomeSummary> {
  const total = Number((await db.query<{ n: string }>(`select count(*)::text n from pursuit_outcomes where pursuit_id = $1`, [pursuitId])).rows[0].n);
  const oc = (await db.query<{ outcome_label: string; is_terminal: boolean; occurred_at: Date; value_amount: string | null; attribution_id: string | null }>(
    `select outcome_label, is_terminal, occurred_at, value_amount, attribution_id
       from pursuit_outcomes where pursuit_id = $1 order by occurred_at desc limit 1`, [pursuitId])).rows[0];

  let attribution: PursuitOutcomeSummary["attribution"] = null;
  if (oc?.attribution_id) {
    const at = (await db.query<{ attribution_class: string; human_override_class: string | null; subject_kind: string; subject_label: string | null; reason: string | null; model_version: string }>(
      `select attribution_class, human_override_class, subject_kind, subject_label, reason, model_version from attribution where id = $1`, [oc.attribution_id])).rows[0];
    if (at) attribution = {
      effectiveClass: at.human_override_class ?? at.attribution_class, machineClass: at.attribution_class,
      overridden: at.human_override_class != null, subjectKind: at.subject_kind, subjectLabel: at.subject_label,
      reason: at.reason, modelVersion: at.model_version,
    };
  }

  // Recompute-pending: an OUTCOME_RECORDED (or any) recompute still in flight for this pursuit.
  const hasRecompute = (await db.query<{ r: string | null }>(`select to_regclass('public.recompute_requests') as r`)).rows[0]?.r;
  const recomputePending = hasRecompute
    ? Number((await db.query<{ n: string }>(`select count(*)::text n from recompute_requests where pursuit_id = $1 and status in ('PENDING','RUNNING')`, [pursuitId])).rows[0].n) > 0
    : false;

  return {
    latest: oc ? { label: oc.outcome_label, isTerminal: oc.is_terminal, occurredAt: oc.occurred_at.toISOString(), valueAmount: oc.value_amount === null ? null : Number(oc.value_amount) } : null,
    attribution, recomputePending, totalOutcomes: total,
  };
}
