import { withTenant } from "@/lib/db/tenant";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { vnextEnvEnabled } from "@/lib/env/vnext-flags";
import type { PoolClient } from "pg";
import { currentRole } from "@/lib/auth/org";
import { resumeRun, startRun, pauseRun, resumeAfterPause, cancelRun, type ExecuteResult, type RunRow, type StartRunArgs } from "./runtime";
import { decideApproval, pendingApprovals, type DecisionOutcome, type PendingApproval } from "./approvals";

/**
 * The request-triggered entry point for the governed Pursuit Runtime (P45-1, Slice 1).
 *
 * WHY REQUEST-TRIGGERED AND NOT A WORKER. The existing worker runs on the OWNER pool, which
 * bypasses RLS. Making that the execution identity for the runtime would hand ambient mutation
 * authority to a background process, which is precisely the posture H1 spent eight gates removing.
 * A request already carries an authenticated org context, so Slice 1 executes under `app_rw` +
 * `withTenant` and the question is deferred — not answered badly. See PART K of the gate: a future
 * worker needs a two-stage model (narrow discovery of which org has due work, then execution for
 * that org under app_rw + withTenant), and that gets its own design slice before activation.
 *
 * DOUBLE-GATED, OFF BY DEFAULT. Both must be true: the deployment-level `VNEXT_CONTROL_PLANE_ENABLED`
 * (backend-only, deliberately independent of the pursuit-experience flag) and the per-org
 * `org_features.governed_action`. With either off, every entry point below refuses and the runtime
 * is inert — no table is read, no row is written, and no existing surface changes.
 */

export class RuntimeDisabledError extends Error {
  constructor() { super("the governed runtime is not enabled for this deployment or organization"); }
}

/**
 * Both gates, evaluated per call — a flag flipped off mid-run stops the NEXT step, not merely new
 * runs. Exported so the gate itself is provable: an unexercised gate is an unproven gate.
 */
export async function runtimeEnabled(db: PoolClient, orgId: string): Promise<boolean> {
  if (!vnextEnvEnabled("control_plane")) return false;
  // The per-org column, read DIRECTLY — deliberately not `governedActionEnabledFor`.
  //
  // That helper returns the tail of a dependency chain: governedAction requires federation, which
  // requires experience, which requires pursuits AND facts AND routing AND pursuit_experience, each
  // additionally env-gated. It is the right answer for the FEDERATION SURFACE, which cannot render
  // without the pursuit experience underneath it.
  //
  // It is the wrong answer here. `control_plane` is documented in vnext-flags.ts as "backend-only
  // and deliberately independent of experience — it is infrastructure, not a pursuit surface", so
  // routing the runtime through that chain would contradict the flag's own design and make backend
  // execution depend on which UI surfaces an org happens to have switched on.
  //
  // The gate is still DOUBLE and still defaults OFF: the deployment flag plus this org column. When
  // a later slice exposes the runtime on a pursuit surface, that SURFACE must apply its own tenant
  // gate — a read-model gate is not an execution gate, and vice versa.
  const { rows } = await db.query<{ governed_action: boolean }>(
    `select governed_action from org_features where org_id = $1`, [orgId]);
  return rows[0]?.governed_action === true;
}

async function assertEnabled(db: PoolClient, orgId: string): Promise<void> {
  if (!(await runtimeEnabled(db, orgId))) throw new RuntimeDisabledError();
}

/**
 * Start a run for a decided plan action and immediately attempt its first step.
 *
 * The acting identity is the REQUEST's, never the run's: `dispatchSkill` re-derives eligibility,
 * permission and preconditions from it, and the governed actor's grant is checked in addition.
 */
export async function startAndRun(args: StartRunArgs): Promise<{ run: RunRow; execution: ExecuteResult }> {
  return withTenant(async (db, orgId) => {
    await assertEnabled(db, orgId);
    const role = await currentRole(db);
    const run = await startRun(db, orgId, args);
    const execution = await resumeRun(db, orgId, run.id, { type: "USER", id: args.initiatedByUserId ?? null, orgId, role });
    return { run, execution };
  });
}

/** Resume an existing run from durable state alone. Safe to call after a crash, deploy or long gap. */
export async function continueRun(runId: string, userId?: string | null): Promise<ExecuteResult> {
  return withTenant(async (db, orgId) => {
    await assertEnabled(db, orgId);
    const role = await currentRole(db);
    return resumeRun(db, orgId, runId, { type: "USER", id: userId ?? null, orgId, role });
  });
}

/** Human steering. Each is a first-class transition recorded in the ledger, not an exception path. */
export async function pause(runId: string, reason?: string, userId?: string | null) {
  return withTenant(async (db, orgId) => { await assertEnabled(db, orgId); return pauseRun(db, orgId, runId, reason, userId); });
}
export async function resume(runId: string, reason?: string, userId?: string | null) {
  return withTenant(async (db, orgId) => { await assertEnabled(db, orgId); return resumeAfterPause(db, orgId, runId, reason, userId); });
}
export async function cancel(runId: string, reason: string, userId?: string | null) {
  return withTenant(async (db, orgId) => { await assertEnabled(db, orgId); return cancelRun(db, orgId, runId, reason, userId); });
}


/**
 * P45-2 — the approval decision boundary.
 *
 * THE IDENTITY RULE (owner ruling 1). These entry points NEVER accept a client-supplied approver.
 * The principal is resolved server-side, and if it cannot be resolved the call FAILS CLOSED. That
 * matters more here than anywhere else in the runtime: an approver identity that a caller can assert
 * is not an approval, it is a request to be trusted.
 *
 * Where this leaves us, stated plainly rather than papered over:
 *   • RUNTIME AUTHORIZATION is provable today — governed actor, ACTIVE lifecycle, same org,
 *     principal match, live grant for the decision capability, tenant/RLS — all enforced server-side.
 *   • PRODUCTION HUMAN IDENTITY is NOT proven, because application auth is not configured in this
 *     deployment: `currentRole()` returns "owner" for every caller and no principal resolves. The
 *     server model is therefore deliberately stricter than the demo can exercise, and a harness may
 *     prove the workflow with explicitly constructed governed actors.
 * Nothing below is weakened to accommodate that gap.
 */
export class NoTrustedPrincipalError extends Error {
  constructor() { super("no trusted principal could be resolved — refusing to record an approval decision"); }
}

/** The server's own answer to "who is acting", never the caller's. Null means: fail closed. */
async function trustedPrincipal(db: PoolClient): Promise<string | null> {
  if (!authConfigured()) return null;          // demo/Basic-Auth: there is no human identity to trust
  try {
    const supabase = await supabaseServer();
    return (await supabase.auth.getUser()).data.user?.id ?? null;
  } catch { return null; }
}

/** Pending approvals for the caller's org. Read-only; INVALIDATED and decided requests never appear. */
export async function listPendingApprovals(limit = 50): Promise<PendingApproval[]> {
  return withTenant(async (db, orgId) => {
    if (!(await runtimeEnabled(db, orgId))) throw new RuntimeDisabledError();
    return pendingApprovals(db, orgId, limit);
  });
}

/**
 * Approve or reject a pending request from the interactive surface.
 *
 * The deciding governed actor is resolved from the TRUSTED principal — a caller cannot nominate one.
 * With no trusted principal this refuses rather than guessing, which is why the interactive path is
 * currently unusable in the demo posture and the harness path exists for acceptance.
 */
export async function decide(
  requestId: string, decision: "APPROVED" | "REJECTED", reason?: string,
): Promise<DecisionOutcome> {
  return withTenant(async (db, orgId) => {
    if (!(await runtimeEnabled(db, orgId))) throw new RuntimeDisabledError();
    const principal = await trustedPrincipal(db);
    if (!principal) throw new NoTrustedPrincipalError();
    // The actor is looked up BY the trusted principal. There is no parameter through which a caller
    // could name a different one.
    const { rows } = await db.query<{ id: string }>(
      `select id from governed_actors
        where org_id = $1 and principal_user_id = $2 and actor_type = 'USER' and lifecycle = 'ACTIVE'`,
      [orgId, principal]);
    if (!rows[0]) throw new NoTrustedPrincipalError();
    const role = await currentRole(db);
    return decideApproval(db, orgId, requestId, decision,
      { governedActorId: rows[0].id, principal, actor: { type: "USER", id: principal, orgId, role } }, reason);
  });
}
