import type { PoolClient } from "pg";

/**
 * Governance ops read models (Release Gate R1-G6). The minimum an operator needs to
 * diagnose the closed loop WITHOUT SQL: the health of governed actions, the recompute
 * queue, and the external-action outbox; the dead/stuck work that needs attention; and
 * a correlation-id TRACE that stitches one logical operation across invocation → outbox
 * → receipt → recompute. Read-only projections, org-scoped by RLS.
 */

export interface GovernanceHealth {
  invocations: Record<string, number>;   // by status
  recomputes: Record<string, number>;    // by status
  outbox: Record<string, number>;        // by status
}

// The org scope comes from RLS (app.org_id GUC), so these counts are already this
// tenant's rows — no interpolated predicate (the table/column names are fixed literals).
async function countBy(db: PoolClient, table: "governed_action_invocations" | "recompute_requests" | "action_outbox"): Promise<Record<string, number>> {
  const { rows } = await db.query<{ k: string; n: string }>(`select status as k, count(*)::text n from ${table} group by status`);
  return Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
}

export async function governanceHealth(db: PoolClient, _orgId: string): Promise<GovernanceHealth> {
  return {
    invocations: await countBy(db, "governed_action_invocations"),
    recomputes: await countBy(db, "recompute_requests"),
    outbox: await countBy(db, "action_outbox"),
  };
}

export interface DeadLetter { kind: string; id: string; label: string; status: string; reason: string | null; attempts: number | null; at: string }

/** Everything that failed or is stuck and needs an operator's eyes. */
export async function deadLetters(db: PoolClient, orgId: string, limit = 100): Promise<DeadLetter[]> {
  const out: DeadLetter[] = [];
  const ob = await db.query<{ id: string; provider: string; action_family: string | null; status: string; last_error: string | null; attempts: number; updated_at: Date }>(
    `select id, provider, action_family, status, last_error, attempts, updated_at from action_outbox
      where org_id = $1 and status in ('FAILED_FINAL','COMPENSATED','FAILED') order by updated_at desc limit $2`, [orgId, limit]);
  for (const r of ob.rows) out.push({ kind: "outbox", id: r.id, label: `${r.provider}/${r.action_family ?? "?"}`, status: r.status, reason: r.last_error, attempts: r.attempts, at: r.updated_at.toISOString() });
  const rc = await db.query<{ id: string; target: string; change_type: string; status: string; reason: string | null; attempts: number; updated_at: Date }>(
    `select id, target, change_type, status, reason, attempts, updated_at from recompute_requests
      where org_id = $1 and status = 'FAILED' order by updated_at desc limit $2`, [orgId, limit]);
  for (const r of rc.rows) out.push({ kind: "recompute", id: r.id, label: `${r.target} ← ${r.change_type}`, status: r.status, reason: r.reason, attempts: r.attempts, at: r.updated_at.toISOString() });
  const iv = await db.query<{ id: string; skill_id: string; status: string; reason: string | null; requested_at: Date }>(
    `select id, skill_id, status, reason, requested_at from governed_action_invocations
      where org_id = $1 and status in ('FAILED','REJECTED','COMPENSATED') order by requested_at desc limit $2`, [orgId, limit]);
  for (const r of iv.rows) out.push({ kind: "invocation", id: r.id, label: r.skill_id, status: r.status, reason: r.reason, attempts: null, at: r.requested_at.toISOString() });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface CorrelationTrace {
  correlationId: string;
  invocations: { id: string; skillId: string; effectClass: string; status: string; reason: string | null; at: string }[];
  outbox: { id: string; provider: string; status: string; attempts: number; lastError: string | null }[];
  receipts: { id: string; provider: string; status: string; attempt: number | null; failureClass: string | null; at: string }[];
  recomputes: { id: string; target: string; status: string; reason: string | null }[];
}

/** Stitch one logical operation across the chain by its correlation id. */
export async function traceCorrelation(db: PoolClient, orgId: string, correlationId: string): Promise<CorrelationTrace> {
  const inv = await db.query<{ id: string; skill_id: string; effect_class: string; status: string; reason: string | null; requested_at: Date }>(
    `select id, skill_id, effect_class, status, reason, requested_at from governed_action_invocations where org_id=$1 and correlation_id=$2 order by requested_at`, [orgId, correlationId]);
  const ob = await db.query<{ id: string; provider: string; status: string; attempts: number; last_error: string | null }>(
    `select id, provider, status, attempts, last_error from action_outbox where org_id=$1 and correlation_id=$2 order by created_at`, [orgId, correlationId]);
  const rc = await db.query<{ id: string; target: string; status: string; reason: string | null }>(
    `select id, target, status, reason from recompute_requests where org_id=$1 and correlation_id=$2 order by created_at`, [orgId, correlationId]);
  const rcpt = await db.query<{ id: string; provider: string; status: string; attempt: number | null; failure_class: string | null; created_at: Date }>(
    `select id, provider, status, attempt, failure_class, created_at from action_receipts where org_id=$1 and correlation_id=$2 order by created_at`, [orgId, correlationId]);
  return {
    correlationId,
    invocations: inv.rows.map((r) => ({ id: r.id, skillId: r.skill_id, effectClass: r.effect_class, status: r.status, reason: r.reason, at: r.requested_at.toISOString() })),
    outbox: ob.rows.map((r) => ({ id: r.id, provider: r.provider, status: r.status, attempts: r.attempts, lastError: r.last_error })),
    receipts: rcpt.rows.map((r) => ({ id: r.id, provider: r.provider, status: r.status, attempt: r.attempt, failureClass: r.failure_class, at: r.created_at.toISOString() })),
    recomputes: rc.rows.map((r) => ({ id: r.id, target: r.target, status: r.status, reason: r.reason })),
  };
}
