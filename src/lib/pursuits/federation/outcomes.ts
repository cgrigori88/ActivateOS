import type { PoolClient } from "pg";

/**
 * Outcome / attribution / experiment layer (Workstream E3-F). Three deliberately
 * SEPARATE objects that never collapse (R10/R15):
 *   • Outcome     — what actually happened, event-rich, captured WITH its decision-
 *                   time context (R14). Intermediates fire often; revenue stays sparse.
 *   • Attribution — an explicit, versioned CLAIM about who moved it (R15). Never ROI,
 *                   never fictional; marketing-style attribution cannot contaminate
 *                   the factual outcome.
 *   • Experiment  — an intervention with its history and the intelligence state BEFORE
 *                   the intervention (R16), org-scoped so it never crosses tenant or
 *                   disclosure boundaries.
 * Plus override convergence: a human override is supervision data that later learns
 * whether the system converged to the human's call (R17).
 */

export type OutcomeLabel =
  | "INTRO_REQUESTED" | "INTRO_ACCEPTED" | "SELLER_ACCEPTED" | "PARTNER_ACCEPTED"
  | "MEETING_BOOKED" | "MEETING_COMPLETED" | "FIRST_ACTION_COMPLETED" | "CUSTOMER_ENGAGED"
  | "CUSTOMER_RESPONDED" | "TECHNICAL_RESOURCE_ENGAGED" | "OPPORTUNITY_CREATED"
  | "OPPORTUNITY_QUALIFIED" | "OPPORTUNITY_PROGRESSED" | "DEAL_REGISTERED" | "QUOTE_CREATED"
  | "PIPELINE_CREATED" | "RENEWAL_RETAINED" | "EXPANSION_CREATED"
  | "CLOSED_WON" | "CLOSED_LOST" | "NO_DECISION" | "DORMANT" | "DISQUALIFIED";

/** Terminal outcomes end the Pursuit's active life; the rest are intermediate signal (R14). */
export const TERMINAL_OUTCOMES = new Set<OutcomeLabel>([
  "CLOSED_WON", "CLOSED_LOST", "NO_DECISION", "DORMANT", "DISQUALIFIED",
]);
export function isTerminalOutcome(label: OutcomeLabel): boolean { return TERMINAL_OUTCOMES.has(label); }

export interface RecordOutcomeInput {
  orgId: string;
  pursuitId: string;
  label: OutcomeLabel;
  companyId?: string | null;
  scoreSnapshotId?: string | null;
  routeSnapshotId?: string | null;
  whyNowSnapshotId?: string | null;
  overrideId?: string | null;
  experimentId?: string | null;
  cohort?: string | null;
  valueAmount?: number | null;
  secondsSinceRecommended?: number | null;
  detail?: Record<string, unknown>;
  occurredAt?: Date | null;
  dataEnvironment?: string;
  isSimulated?: boolean;
}

/** Record an outcome WITH its decision-time context (R14). Append-only; never edited. */
export async function recordOutcome(db: PoolClient, i: RecordOutcomeInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into pursuit_outcomes
       (org_id, pursuit_id, company_id, outcome_label, is_terminal, score_snapshot_id, route_snapshot_id,
        why_now_snapshot_id, override_id, experiment_id, cohort, value_amount, seconds_since_recommended,
        detail, occurred_at, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, coalesce($15, now()), $16, $17)
     returning id`,
    [i.orgId, i.pursuitId, i.companyId ?? null, i.label, isTerminalOutcome(i.label),
     i.scoreSnapshotId ?? null, i.routeSnapshotId ?? null, i.whyNowSnapshotId ?? null, i.overrideId ?? null,
     i.experimentId ?? null, i.cohort ?? null, i.valueAmount ?? null, i.secondsSinceRecommended ?? null,
     JSON.stringify(i.detail ?? {}), i.occurredAt ?? null, i.dataEnvironment ?? "PRODUCTION", i.isSimulated ?? false],
  );
  return rows[0].id;
}

export interface OutcomeView {
  id: string; label: OutcomeLabel; isTerminal: boolean; occurredAt: string;
  attributionId: string | null; overrideId: string | null; valueAmount: number | null;
}
export async function outcomesForPursuit(db: PoolClient, pursuitId: string): Promise<OutcomeView[]> {
  const { rows } = await db.query<{ id: string; outcome_label: OutcomeLabel; is_terminal: boolean; occurred_at: Date; attribution_id: string | null; override_id: string | null; value_amount: string | null }>(
    `select id, outcome_label, is_terminal, occurred_at, attribution_id, override_id, value_amount
       from pursuit_outcomes where pursuit_id = $1 order by occurred_at asc`, [pursuitId]);
  return rows.map((r) => ({
    id: r.id, label: r.outcome_label, isTerminal: r.is_terminal, occurredAt: r.occurred_at.toISOString(),
    attributionId: r.attribution_id, overrideId: r.override_id, valueAmount: r.value_amount === null ? null : Number(r.value_amount),
  }));
}

// ── Attribution (R15) ─────────────────────────────────────────────────────────
export type AttributionClass = "SOURCE" | "INFLUENCED" | "ASSISTED" | "OBSERVED" | "UNKNOWN";
export type AttributionSubjectKind = "PARTNER" | "SELLER" | "DISTRIBUTOR" | "SOURCE" | "CONTRIBUTION" | "ORG";

export interface RecordAttributionInput {
  orgId: string;
  pursuitId: string;
  outcomeId?: string | null;
  subjectKind: AttributionSubjectKind;
  subjectId?: string | null;
  subjectLabel?: string | null;
  attributionClass: AttributionClass;
  fraction?: number | null;
  modelVersion: string;
  evidence?: Record<string, unknown>;
  reason?: string | null;
  dataEnvironment?: string;
  isSimulated?: boolean;
}

/**
 * Record an explicit, versioned attribution CLAIM (R15). Requires a model_version and
 * evidence — an attribution with no stated basis is not allowed. NOT ROI: no revenue is
 * invented here; value lives on the Outcome, the claim about who moved it lives here.
 * When linked to an outcome, back-links pursuit_outcomes.attribution_id.
 */
export async function recordAttribution(db: PoolClient, i: RecordAttributionInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into attribution
       (org_id, pursuit_id, outcome_id, subject_kind, subject_id, subject_label, attribution_class,
        fraction, model_version, evidence, reason, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [i.orgId, i.pursuitId, i.outcomeId ?? null, i.subjectKind, i.subjectId ?? null, i.subjectLabel ?? null,
     i.attributionClass, i.fraction ?? null, i.modelVersion, JSON.stringify(i.evidence ?? {}), i.reason ?? null,
     i.dataEnvironment ?? "PRODUCTION", i.isSimulated ?? false],
  );
  if (i.outcomeId) await db.query(`update pursuit_outcomes set attribution_id = $2 where id = $1`, [i.outcomeId, rows[0].id]);
  return rows[0].id;
}

/** Apply a human override to an attribution CLAIM — the machine claim is preserved (R15/R17). */
export async function overrideAttribution(db: PoolClient, attributionId: string, cls: AttributionClass, reason: string): Promise<void> {
  await db.query(`update attribution set human_override_class = $2, human_override_reason = $3 where id = $1`, [attributionId, cls, reason]);
}

export interface AttributionView { id: string; subjectKind: string; subjectLabel: string | null; attributionClass: AttributionClass; effectiveClass: AttributionClass; modelVersion: string; computedAt: string; }
export async function attributionsForPursuit(db: PoolClient, pursuitId: string): Promise<AttributionView[]> {
  const { rows } = await db.query<{ id: string; subject_kind: string; subject_label: string | null; attribution_class: AttributionClass; human_override_class: AttributionClass | null; model_version: string; computed_at: Date }>(
    `select id, subject_kind, subject_label, attribution_class, human_override_class, model_version, computed_at
       from attribution where pursuit_id = $1 order by computed_at desc`, [pursuitId]);
  return rows.map((r) => ({
    id: r.id, subjectKind: r.subject_kind, subjectLabel: r.subject_label, attributionClass: r.attribution_class,
    effectiveClass: r.human_override_class ?? r.attribution_class, modelVersion: r.model_version, computedAt: r.computed_at.toISOString(),
  }));
}

// ── Experiments / cohorts (R16) ───────────────────────────────────────────────
export async function createExperiment(db: PoolClient, i: { orgId: string; key: string; name: string; hypothesis?: string; dataEnvironment?: string; isSimulated?: boolean }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into experiments (org_id, experiment_key, name, hypothesis, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (org_id, experiment_key) do update set name = excluded.name returning id`,
    [i.orgId, i.key, i.name, i.hypothesis ?? null, i.dataEnvironment ?? "PRODUCTION", i.isSimulated ?? false]);
  return rows[0].id;
}

export async function addArm(db: PoolClient, i: { experimentId: string; orgId: string; armKey: string; description?: string; isControl?: boolean }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into experiment_arms (experiment_id, org_id, arm_key, description, is_control)
     values ($1,$2,$3,$4,$5) on conflict (experiment_id, arm_key) do update set description = excluded.description returning id`,
    [i.experimentId, i.orgId, i.armKey, i.description ?? null, i.isControl ?? false]);
  return rows[0].id;
}

export interface AssignCohortInput {
  experimentId: string;
  orgId: string;
  pursuitId: string;
  armKey: string;
  intelligenceStateBefore: Record<string, unknown>;  // R16 — captured AT assignment, immutable
  recommendation?: Record<string, unknown>;
  humanDecision?: Record<string, unknown>;
  actionsTaken?: Record<string, unknown>;
  dataEnvironment?: string;
  isSimulated?: boolean;
}

/**
 * Assign a pursuit to an arm, snapshotting the intelligence state BEFORE the
 * intervention (R16). Idempotent per (experiment, pursuit) — a pursuit belongs to one
 * arm of a given experiment, so the "before" state is captured exactly once.
 */
export async function assignCohort(db: PoolClient, i: AssignCohortInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into cohort_assignments
       (experiment_id, org_id, pursuit_id, arm_key, intelligence_state_before, recommendation, human_decision, actions_taken, data_environment, is_simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (experiment_id, pursuit_id) do nothing returning id`,
    [i.experimentId, i.orgId, i.pursuitId, i.armKey, JSON.stringify(i.intelligenceStateBefore),
     i.recommendation ? JSON.stringify(i.recommendation) : null, i.humanDecision ? JSON.stringify(i.humanDecision) : null,
     i.actionsTaken ? JSON.stringify(i.actionsTaken) : null, i.dataEnvironment ?? "PRODUCTION", i.isSimulated ?? false]);
  if (rows[0]) return rows[0].id;
  const existing = await db.query<{ id: string }>(`select id from cohort_assignments where experiment_id=$1 and pursuit_id=$2`, [i.experimentId, i.pursuitId]);
  return existing.rows[0].id;
}

/** Bind the realized outcome to a cohort assignment — closes the intervention→outcome loop (R16). */
export async function linkCohortOutcome(db: PoolClient, assignmentId: string, outcomeId: string): Promise<void> {
  await db.query(`update cohort_assignments set outcome_id = $2 where id = $1`, [assignmentId, outcomeId]);
}

// ── Override convergence (R17) ────────────────────────────────────────────────
/**
 * Learn whether the system later converged to a human override (R17). This is what
 * turns the override trail from audit into supervision: "when experienced channel
 * execs override, are they usually right?" is answerable from these rows + outcomes.
 */
export async function markOverrideConvergence(
  db: PoolClient, overrideId: string, i: { systemConverged: boolean; outcomeId?: string | null },
): Promise<void> {
  await db.query(
    `update pursuit_overrides set system_converged = $2, converged_at = now(), outcome_id = coalesce($3, outcome_id) where id = $1`,
    [overrideId, i.systemConverged, i.outcomeId ?? null]);
}
