import type { PoolClient } from "pg";
import {
  recordOutcome, recordAttribution, markOverrideConvergence, outcomeExistsForSource,
  isTerminalOutcome, type OutcomeLabel, type AttributionClass, type AttributionSubjectKind,
} from "../federation/outcomes";
import { recordAndEnqueue } from "../federation/events";
import { outcomeLearningEnabledFor } from "../tenant-flags";
import type { DataEnvironment } from "../lineage";

/**
 * Canonical outcome + attribution bridge (Phase B). The ONE authoritative path from a legacy
 * commercial system event (opportunity close/progress/create, motion completion) into the canonical
 * Pursuit learning loop: outcome → attribution → recompute. It never runs a parallel outcome system —
 * it reuses recordOutcome / recordAttribution / recordAndEnqueue.
 *
 * Discipline:
 *  - Only fires for an event carrying a DETERMINISTIC pursuit_id; a null link is skipped, never guessed.
 *  - Idempotent per sourceRef (0095): the same event never produces two canonical outcomes.
 *  - Outcome ≠ Attribution: the outcome records what happened; attribution is a versioned, evidence-
 *    bound CLAIM about PursuitOS's relationship to it. Causation is never inferred from mere presence,
 *    and OBSERVED is never silently promoted to INFLUENCED/SOURCE.
 *  - Gated on outcome_learning: sparse demo/off-tenant events cannot rewrite production assumptions.
 *  - The legacy outcome_events write is untouched (strangler dual-write).
 */

export const OUTCOME_BRIDGE_MODEL_VERSION = "outcome-bridge/v1";

export interface BridgeInput {
  orgId: string | null;
  pursuitId: string | null;
  companyId: string | null;
  label: OutcomeLabel;
  valueAmount?: number | null;
  /** Deterministic idempotency key, e.g. `opp:<id>:CLOSED_WON` or `motion:<id>:completed:no_decision`. */
  sourceRef: string;
  dataEnvironment?: string;
  occurredAt?: Date | null;
}

export interface BridgeResult {
  skipped: boolean;
  reason?: string;
  outcomeId?: string;
  attributionId?: string | null;
  attributionClass?: AttributionClass;
}

/**
 * Compute an honest, evidence-bound attribution for a pursuit outcome from the SELECTED route.
 * Conservative by construction: a human-selected partner route is INFLUENCED (the partner is on the
 * decided commercial path — a decision, cited as evidence); no partner route ⇒ UNKNOWN (attribution
 * to a partner is not determinable). SOURCE / ASSISTED / OBSERVED are never auto-assigned — they
 * require richer evidence and remain available via human override. Never invents a subject.
 */
async function computeAttribution(db: PoolClient, pursuitId: string): Promise<{
  subjectKind: AttributionSubjectKind; subjectId: string | null; subjectLabel: string | null;
  attributionClass: AttributionClass; reason: string; evidence: Record<string, unknown>;
}> {
  const snap = (await db.query<{ id: string; selected_partner_id: string | null }>(
    `select id, selected_partner_id from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId])).rows[0];
  const selected = snap?.selected_partner_id ?? null;
  if (!selected) {
    return { subjectKind: "ORG", subjectId: null, subjectLabel: null, attributionClass: "UNKNOWN",
      reason: "No selected partner route — attribution to a partner is not determinable.", evidence: { routeSnapshotId: snap?.id ?? null } };
  }
  const pname = (await db.query<{ name: string }>(`select name from partners where id = $1`, [selected])).rows[0]?.name ?? null;
  return { subjectKind: "PARTNER", subjectId: selected, subjectLabel: pname, attributionClass: "INFLUENCED",
    reason: "Outcome on a pursuit whose commercial route the human selected through this partner — influenced (not claimed as sourced without origination evidence).",
    evidence: { routeSnapshotId: snap.id, selectedPartnerId: selected, basis: "human-selected route decision" } };
}

/** Link the outcome to the latest partner override and mark whether the system converged to it (R17). */
async function linkConvergence(db: PoolClient, pursuitId: string, outcomeId: string): Promise<void> {
  const ov = (await db.query<{ id: string }>(
    `select id from pursuit_overrides where pursuit_id = $1 and field = 'partner' order by created_at desc limit 1`, [pursuitId])).rows[0];
  if (!ov) return;
  const snap = (await db.query<{ recommended_partner_id: string | null; selected_partner_id: string | null }>(
    `select recommended_partner_id, selected_partner_id from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuitId])).rows[0];
  const converged = !!snap && (snap.recommended_partner_id ?? null) === (snap.selected_partner_id ?? null);
  await markOverrideConvergence(db, ov.id, { systemConverged: converged, outcomeId });
}

export async function bridgePursuitOutcome(db: PoolClient, input: BridgeInput): Promise<BridgeResult> {
  if (!input.orgId || !input.pursuitId) return { skipped: true, reason: "no deterministic pursuit link" };
  if (!(await outcomeLearningEnabledFor(db, input.orgId))) return { skipped: true, reason: "outcome_learning not enabled for org" };

  // Idempotency: a retried/duplicate source event does not create a second outcome.
  const existing = await outcomeExistsForSource(db, input.orgId, input.sourceRef);
  if (existing) return { skipped: false, reason: "idempotent replay", outcomeId: existing, attributionId: null };

  // The canonical outcome inherits the pursuit's data environment — a DEMO pursuit stays DEMO/simulated,
  // so synthetic outcomes are never labeled PRODUCTION and cannot masquerade as real learning.
  const env = input.dataEnvironment
    ?? (await db.query<{ data_environment: string }>(`select data_environment from pursuits where id = $1`, [input.pursuitId])).rows[0]?.data_environment
    ?? "PRODUCTION";

  const routeSnapshotId = (await db.query<{ id: string }>(
    `select id from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [input.pursuitId])).rows[0]?.id ?? null;

  const outcomeId = await recordOutcome(db, {
    orgId: input.orgId, pursuitId: input.pursuitId, companyId: input.companyId ?? null, label: input.label,
    valueAmount: input.valueAmount ?? null, routeSnapshotId, sourceRef: input.sourceRef,
    dataEnvironment: env, occurredAt: input.occurredAt ?? null, isSimulated: env !== "PRODUCTION",
    detail: { sourceRef: input.sourceRef },
  });

  const attr = await computeAttribution(db, input.pursuitId);
  const attributionId = await recordAttribution(db, {
    orgId: input.orgId, pursuitId: input.pursuitId, outcomeId, subjectKind: attr.subjectKind,
    subjectId: attr.subjectId, subjectLabel: attr.subjectLabel, attributionClass: attr.attributionClass,
    modelVersion: OUTCOME_BRIDGE_MODEL_VERSION, evidence: attr.evidence, reason: attr.reason,
    dataEnvironment: env, isSimulated: env !== "PRODUCTION",
  });

  await linkConvergence(db, input.pursuitId, outcomeId);

  // Feed the reactive half: OUTCOME_RECORDED → READINESS/TODAY recompute (terminal is HIGH).
  await recordAndEnqueue(db, {
    orgId: input.orgId, pursuitId: input.pursuitId, entityType: "pursuit", entityId: input.pursuitId,
    changeType: "OUTCOME_RECORDED", materiality: isTerminalOutcome(input.label) ? "HIGH" : "MEDIUM",
    reason: `Commercial outcome: ${input.label}`, actorType: "SYSTEM", triggerType: "CRM_SYNC",
    dataEnvironment: env as DataEnvironment, occurredAt: input.occurredAt ?? undefined,
    before: {}, after: { label: input.label, valueAmount: input.valueAmount ?? null, attributionClass: attr.attributionClass },
  });

  return { skipped: false, outcomeId, attributionId, attributionClass: attr.attributionClass };
}
