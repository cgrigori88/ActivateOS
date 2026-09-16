import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { dispatchSkill, type Actor } from "@/lib/pursuits/federation/skills";
import { recordChange, type ChangeType } from "@/lib/pursuits/ledger";
import type { DataEnvironment } from "@/lib/pursuits/lineage";

/**
 * The governed Pursuit Runtime — P45-1, Slice 1.
 *
 * WHAT THIS IS. P3 says what should happen (a decided plan revision). P4 says who or what may do
 * it (a governed actor holding a capability grant). THIS says what is happening now, what happened,
 * what is next, and how to resume.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not a second mutation boundary. A step never performs a side
 * effect itself: it calls `dispatchSkill`, which remains the single consequential-action boundary
 * and keeps its idempotency, eligibility, permission, loop-guard, precondition, cross-tenant
 * authority and outbox routing exactly as certified. The runtime's whole job is to make one
 * governed invocation DURABLE, RESUMABLE and ATTRIBUTABLE.
 *
 * THE PIN (owner ruling 5). A run is bound to the plan revision that justified it, forever, along
 * with the `basis_fingerprint` captured at start. If that revision is superseded, the run is
 * CANCELLED with reason PLAN_SUPERSEDED. It is never retargeted at the new revision — a different
 * decision deserves a different run, and silently re-pointing one would attribute work to a
 * decision nobody made.
 *
 * NO IN-MEMORY CONTINUATION IS AUTHORITATIVE. Everything needed to resume is persisted before and
 * after the dispatch, so recovery after a crash, deploy or multi-day gap is a QUERY, never a
 * memory read. `resumeRun` is deliberately callable with nothing but an org and a run id.
 *
 * SLICE 1 SCOPE. One step, request-triggered, under `app_rw` + `withTenant`. No worker drain (the
 * owner pool must not become ambient mutation authority for runtime execution — that needs its own
 * design slice), no AGENT actors, no approval workflow, and no EXTERNAL_ACTION.
 */

export type RunStatus =
  | "PENDING" | "READY" | "RUNNING" | "WAITING_FOR_APPROVAL" | "BLOCKED" | "PAUSED"
  | "RETRYABLE_FAILURE" | "TERMINAL_FAILURE" | "COMPLETED" | "CANCELLED";

/** Terminal states never transition again. `resumeRun` refuses them rather than re-running work. */
export const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(["COMPLETED", "CANCELLED", "TERMINAL_FAILURE"]);

/** States from which a request-triggered execution may legitimately proceed. */
const RESUMABLE: ReadonlySet<RunStatus> = new Set<RunStatus>(["PENDING", "READY", "RUNNING", "RETRYABLE_FAILURE"]);

const sha = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/**
 * Canonical argument ordering, so a step's identity does not depend on key insertion order. Two
 * dispatches that mean the same thing must hash the same, or "replay" would silently become "a new
 * consequential action".
 */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort()
      .map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Step identity: same run, same position, same skill+version, same meaning ⇒ same key. */
export const stepIdempotencyKey = (runId: string, seq: number, skillId: string, skillVersion: number, args: unknown): string =>
  `run:${runId}:${seq}:${skillId}:v${skillVersion}:${sha(canonical(args))}`;

export interface StartRunArgs {
  pursuitId: string;
  planId: string;
  planRevisionId: string;
  governedActorId: string;
  initiatedByUserId?: string | null;
  skillId: string;
  skillVersion?: number;
  args?: Record<string, unknown>;
  milestoneKey?: string | null;
  maxAttempts?: number;
  dataEnvironment?: DataEnvironment;
}

export interface RunRow {
  id: string; status: RunStatus; reason: string | null; correlationId: string;
  planRevisionId: string; basisFingerprint: string; currentStepId: string | null;
}

/**
 * Create a run pinned to a decided plan revision, plus its single Slice-1 step.
 *
 * The revision must belong to this org and this plan, and must be a DECISION that was not REJECTED
 * — a recommendation nobody accepted is not authority to act. The `basis_fingerprint` is copied
 * here and never recomputed: it is the record of what the world looked like when the decision was
 * made, which is what later evaluation (P8) needs.
 */
export async function startRun(db: PoolClient, orgId: string, a: StartRunArgs): Promise<RunRow> {
  const skillVersion = a.skillVersion ?? 1;
  const env = a.dataEnvironment ?? "PRODUCTION";

  // Org-scoped read of the pin. This is the repository's certified cross-org guard (explicit
  // org_id in the predicate) layered on top of RLS, not a substitute for it.
  const { rows: rev } = await db.query<{ id: string; kind: string; decision: string | null; basis_fingerprint: string; plan_id: string; pursuit_id: string }>(
    `select id, kind, decision, basis_fingerprint, plan_id, pursuit_id
       from pursuit_plan_revisions where id = $1 and org_id = $2 and plan_id = $3 and pursuit_id = $4`,
    [a.planRevisionId, orgId, a.planId, a.pursuitId]);
  if (!rev[0]) throw new Error("plan revision not found in this org/plan/pursuit");
  if (rev[0].kind !== "DECISION" || rev[0].decision === "REJECTED")
    throw new Error("a run may only be started from a non-rejected plan DECISION");

  // A superseded plan cannot authorise NEW work (owner ruling 5).
  const { rows: plan } = await db.query<{ status: string }>(
    `select status from pursuit_plans where id = $1 and org_id = $2`, [a.planId, orgId]);
  if (!plan[0]) throw new Error("plan not found in this org");
  if (plan[0].status === "SUPERSEDED" || plan[0].status === "CLOSED")
    throw new Error(`plan is ${plan[0].status}; start a run from the current plan instead`);

  // Run identity. Deterministic, so a retried creation collapses onto the same run rather than
  // opening a second execution of one decision.
  const runKey = `run:${a.pursuitId}:${a.planRevisionId}:${a.skillId}:v${skillVersion}:${sha(canonical(a.args ?? {}))}`;
  const { rows: existing } = await db.query<{ id: string; status: RunStatus; reason: string | null; correlation_id: string; plan_revision_id: string; basis_fingerprint: string; current_step_id: string | null }>(
    `select id, status, reason, correlation_id, plan_revision_id, basis_fingerprint, current_step_id
       from pursuit_runs where org_id = $1 and idempotency_key = $2`, [orgId, runKey]);
  if (existing[0]) {
    return { id: existing[0].id, status: existing[0].status, reason: existing[0].reason,
             correlationId: existing[0].correlation_id, planRevisionId: existing[0].plan_revision_id,
             basisFingerprint: existing[0].basis_fingerprint, currentStepId: existing[0].current_step_id };
  }

  const { rows: run } = await db.query<{ id: string; correlation_id: string }>(
    `insert into pursuit_runs
       (org_id, pursuit_id, plan_id, plan_revision_id, governed_actor_id, initiated_by_user_id,
        status, idempotency_key, basis_fingerprint, data_environment)
     values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)
     returning id, correlation_id`,
    [orgId, a.pursuitId, a.planId, a.planRevisionId, a.governedActorId, a.initiatedByUserId ?? null,
     runKey, rev[0].basis_fingerprint, env]);
  const runId = run[0].id;

  const { rows: step } = await db.query<{ id: string }>(
    `insert into pursuit_run_steps
       (org_id, run_id, seq, skill_id, skill_version, args, status, max_attempts, milestone_key, idempotency_key)
     values ($1,$2,1,$3,$4,$5,'PENDING',$6,$7,$8) returning id`,
    [orgId, runId, a.skillId, skillVersion, JSON.stringify(a.args ?? {}), a.maxAttempts ?? 3,
     a.milestoneKey ?? null, stepIdempotencyKey(runId, 1, a.skillId, skillVersion, a.args ?? {})]);

  await db.query(`update pursuit_runs set current_step_id = $2, status = 'READY', last_transition_at = now(), updated_at = now() where id = $1 and org_id = $3`,
    [runId, step[0].id, orgId]);

  await ledger(db, orgId, a.pursuitId, runId, step[0].id, null, "RUN_STARTED",
    { actorId: a.initiatedByUserId ?? null, governedActorId: a.governedActorId, env,
      reason: `Run started for ${a.skillId}`,
      before: null, after: { status: "READY", planRevisionId: a.planRevisionId, skillId: a.skillId, seq: 1 } });

  return { id: runId, status: "READY", reason: null, correlationId: run[0].correlation_id,
           planRevisionId: a.planRevisionId, basisFingerprint: rev[0].basis_fingerprint, currentStepId: step[0].id };
}

/** One ledger row per runtime transition. There is no parallel runtime event log. */
async function ledger(
  db: PoolClient, orgId: string, pursuitId: string, runId: string, stepId: string | null,
  invocationId: string | null, changeType: string,
  o: { actorId?: string | null; governedActorId?: string | null; env: DataEnvironment; reason: string;
       before: unknown; after: unknown; correlationId?: string | null },
): Promise<void> {
  // GOVERNED_ACTION is the existing trigger vocabulary and is exactly what a runtime transition is.
  // Inventing a RUNTIME trigger would add a second word for one concept (0109 §5b).
  const ledgerId = await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit_run", entityId: runId,
    changeType: changeType as ChangeType, materiality: "MEDIUM", reason: o.reason,
    actorType: "USER", actorId: o.actorId ?? null, triggerType: "GOVERNED_ACTION",
    dataEnvironment: o.env, before: o.before ?? undefined, after: o.after ?? undefined,
  });
  // The runtime linkage columns (0109) are additive and outside recordChange's contract, so they
  // are set on the row it just wrote — addressed by the id it RETURNED, never by re-querying for
  // "the most recent matching row", which would pick the wrong one under concurrency.
  await db.query(
    `update change_ledger set run_id = $2, run_step_id = $3, invocation_id = $4, governed_actor_id = $5
      where id = $1 and org_id = $6`,
    [ledgerId, runId, stepId, invocationId, o.governedActorId ?? null, orgId]);
}

async function loadRun(db: PoolClient, orgId: string, runId: string) {
  const { rows } = await db.query<{
    id: string; pursuit_id: string; plan_id: string; plan_revision_id: string; governed_actor_id: string;
    initiated_by_user_id: string | null; status: RunStatus; current_step_id: string | null;
    correlation_id: string; basis_fingerprint: string; data_environment: DataEnvironment; reason: string | null;
  }>(`select id, pursuit_id, plan_id, plan_revision_id, governed_actor_id, initiated_by_user_id, status,
             current_step_id, correlation_id, basis_fingerprint, data_environment, reason
        from pursuit_runs where id = $1 and org_id = $2`, [runId, orgId]);
  return rows[0] ?? null;
}

async function transitionRun(
  db: PoolClient, orgId: string, runId: string, pursuitId: string, from: RunStatus, to: RunStatus,
  o: { reason: string; changeType: string; stepId?: string | null; invocationId?: string | null;
       actorId?: string | null; governedActorId?: string | null; env: DataEnvironment; continuation?: unknown },
): Promise<void> {
  await db.query(
    `update pursuit_runs set status = $2, reason = $3, last_transition_at = now(), updated_at = now(),
            continuation = coalesce($4::jsonb, continuation), locked_at = null
      where id = $1 and org_id = $5`,
    [runId, to, o.reason, o.continuation === undefined ? null : JSON.stringify(o.continuation), orgId]);
  await ledger(db, orgId, pursuitId, runId, o.stepId ?? null, o.invocationId ?? null, o.changeType,
    { actorId: o.actorId, governedActorId: o.governedActorId, env: o.env, reason: o.reason,
      before: { status: from }, after: { status: to } });
}

/** Human steering — a first-class transition, never an exception path. */
export async function pauseRun(db: PoolClient, orgId: string, runId: string, reason = "Paused by a person", userId?: string | null): Promise<RunStatus> {
  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");
  if (TERMINAL.has(run.status)) return run.status;
  await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "PAUSED",
    { reason, changeType: "RUN_PAUSED", stepId: run.current_step_id, actorId: userId, governedActorId: run.governed_actor_id, env: run.data_environment });
  await db.query(`update pursuit_run_steps set status = 'PAUSED', updated_at = now() where org_id = $1 and run_id = $2 and status in ('PENDING','READY','RETRYABLE_FAILURE')`, [orgId, runId]);
  return "PAUSED";
}

export async function resumeAfterPause(db: PoolClient, orgId: string, runId: string, reason = "Resumed by a person", userId?: string | null): Promise<RunStatus> {
  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");
  if (run.status !== "PAUSED") return run.status;
  await transitionRun(db, orgId, runId, run.pursuit_id, "PAUSED", "READY",
    { reason, changeType: "RUN_RESUMED", stepId: run.current_step_id, actorId: userId, governedActorId: run.governed_actor_id, env: run.data_environment });
  await db.query(`update pursuit_run_steps set status = 'READY', updated_at = now() where org_id = $1 and run_id = $2 and status = 'PAUSED'`, [orgId, runId]);
  return "READY";
}

export async function cancelRun(db: PoolClient, orgId: string, runId: string, reason: string, userId?: string | null): Promise<RunStatus> {
  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");
  if (TERMINAL.has(run.status)) return run.status;
  await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "CANCELLED",
    { reason, changeType: "RUN_CANCELLED", stepId: run.current_step_id, actorId: userId, governedActorId: run.governed_actor_id, env: run.data_environment });
  await db.query(`update pursuit_run_steps set status = 'CANCELLED', updated_at = now() where org_id = $1 and run_id = $2 and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE')`, [orgId, runId]);
  return "CANCELLED";
}

/**
 * The pin check. A run whose plan revision is no longer the live one is CANCELLED, never
 * retargeted. Cancellation does NOT undo an effect that already completed — the runtime has no
 * authority to invent a compensation that the skill registry did not declare.
 */
async function cancelIfSuperseded(db: PoolClient, orgId: string, run: NonNullable<Awaited<ReturnType<typeof loadRun>>>): Promise<boolean> {
  const { rows } = await db.query<{ plan_status: string; is_live_revision: boolean }>(
    `select p.status as plan_status,
            exists (select 1 from pursuit_plan_revisions r
                     where r.plan_id = p.id and r.org_id = $2 and r.kind = 'DECISION'
                       and r.revision_no > (select revision_no from pursuit_plan_revisions
                                             where id = $3 and org_id = $2)) = false as is_live_revision
       from pursuit_plans p where p.id = $1 and p.org_id = $2`,
    [run.plan_id, orgId, run.plan_revision_id]);
  const superseded = !rows[0] || rows[0].plan_status === "SUPERSEDED" || rows[0].plan_status === "CLOSED" || !rows[0].is_live_revision;
  if (!superseded) return false;
  await transitionRun(db, orgId, run.id, run.pursuit_id, run.status, "CANCELLED",
    { reason: "PLAN_SUPERSEDED", changeType: "RUN_CANCELLED", stepId: run.current_step_id,
      governedActorId: run.governed_actor_id, env: run.data_environment });
  await db.query(`update pursuit_run_steps set status = 'CANCELLED', updated_at = now() where org_id = $1 and run_id = $2 and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE')`, [orgId, run.id]);
  return true;
}

export interface ExecuteResult { runStatus: RunStatus; stepStatus: string; invocationId: string | null; reason: string | null; dispatched: boolean }

/**
 * Request-triggered execution of the run's next eligible step.
 *
 * Everything it needs comes from the database. Call it after a crash, a deploy, a pause or a
 * three-day gap and it behaves identically, because there is no in-process state to lose.
 */
export async function resumeRun(db: PoolClient, orgId: string, runId: string, actor: Actor): Promise<ExecuteResult> {
  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");
  if (TERMINAL.has(run.status)) return { runStatus: run.status, stepStatus: "—", invocationId: null, reason: run.reason, dispatched: false };
  if (run.status === "PAUSED") return { runStatus: "PAUSED", stepStatus: "PAUSED", invocationId: null, reason: "paused — resume first", dispatched: false };
  if (!RESUMABLE.has(run.status)) return { runStatus: run.status, stepStatus: "—", invocationId: null, reason: `not resumable from ${run.status}`, dispatched: false };

  if (await cancelIfSuperseded(db, orgId, run))
    return { runStatus: "CANCELLED", stepStatus: "CANCELLED", invocationId: null, reason: "PLAN_SUPERSEDED", dispatched: false };

  const { rows: steps } = await db.query<{
    id: string; seq: number; skill_id: string; skill_version: number; args: Record<string, unknown>;
    status: string; attempt: number; max_attempts: number; next_attempt_at: Date | null;
    idempotency_key: string; milestone_key: string | null;
  }>(`select id, seq, skill_id, skill_version, args, status, attempt, max_attempts, next_attempt_at,
             idempotency_key, milestone_key
        from pursuit_run_steps
       where org_id = $1 and run_id = $2 and status in ('PENDING','READY','RUNNING','RETRYABLE_FAILURE')
       order by seq asc, id asc limit 1`, [orgId, runId]);

  if (!steps[0]) {
    await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "COMPLETED",
      { reason: "all steps complete", changeType: "RUN_COMPLETED", governedActorId: run.governed_actor_id, env: run.data_environment });
    return { runStatus: "COMPLETED", stepStatus: "COMPLETED", invocationId: null, reason: null, dispatched: false };
  }
  const step = steps[0];

  if (step.next_attempt_at && step.next_attempt_at.getTime() > Date.now())
    return { runStatus: run.status, stepStatus: step.status, invocationId: null, reason: "backoff not elapsed", dispatched: false };

  if (step.attempt >= step.max_attempts) {
    await db.query(`update pursuit_run_steps set status = 'TERMINAL_FAILURE', ended_at = now(), updated_at = now() where id = $1 and org_id = $2`, [step.id, orgId]);
    await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "TERMINAL_FAILURE",
      { reason: "retry budget exhausted", changeType: "RUN_FAILED", stepId: step.id, governedActorId: run.governed_actor_id, env: run.data_environment });
    return { runStatus: "TERMINAL_FAILURE", stepStatus: "TERMINAL_FAILURE", invocationId: null, reason: "retry budget exhausted", dispatched: false };
  }

  // ── BEFORE DISPATCH: persist RUNNING with this attempt's identity ──────────────────────────────
  // If the process dies immediately after this, recovery finds a RUNNING step with a known
  // idempotency_key. Re-dispatching it is safe because dispatchSkill replays the existing
  // invocation for that key rather than acting twice.
  const attempt = step.attempt + 1;
  await db.query(
    `update pursuit_run_steps set status = 'RUNNING', attempt = $3, started_at = coalesce(started_at, now()), updated_at = now()
      where id = $1 and org_id = $2`, [step.id, orgId, attempt]);
  await db.query(
    // $2 is explicitly cast on both uses: PostgreSQL deduces one type per parameter, and using it
    // bare as a uuid column and again as text makes the deduction inconsistent.
    `update pursuit_runs set status = 'RUNNING', current_step_id = $2::uuid, last_transition_at = now(), updated_at = now(),
            continuation = jsonb_build_object('seq', $3::int, 'attempt', $4::int, 'stepId', $2::uuid::text)
      where id = $1 and org_id = $5`, [runId, step.id, step.seq, attempt, orgId]);

  // ── DISPATCH: the single consequential-action boundary, unchanged ──────────────────────────────
  const res = await dispatchSkill(db, step.skill_id, actor, {
    pursuitId: run.pursuit_id,
    args: step.args,
    idempotencyKey: step.idempotency_key,
    correlationId: run.correlation_id,
    dataEnvironment: run.data_environment,
    governedActorId: run.governed_actor_id,
    runStepId: step.id,
  });

  // ── AFTER DISPATCH: persist the outcome, then move the run ─────────────────────────────────────
  const ok = res.status === "EXECUTED";
  const rejected = res.status === "REJECTED";
  // A rejection is a governance decision, not a transport failure: retrying it would produce the
  // same answer and burn the budget, so it blocks for a human instead.
  const stepStatus = ok ? "COMPLETED" : rejected ? "BLOCKED" : attempt >= step.max_attempts ? "TERMINAL_FAILURE" : "RETRYABLE_FAILURE";
  const backoffMs = Math.min(60_000, 1000 * 2 ** (attempt - 1));

  await db.query(
    `update pursuit_run_steps
        set status = $3, invocation_id = $4, result = $5::jsonb, error = $6, failure_class = $7,
            next_attempt_at = case when $3 = 'RETRYABLE_FAILURE' then now() + make_interval(secs => $8) else null end,
            ended_at = case when $3 in ('COMPLETED','TERMINAL_FAILURE','BLOCKED') then now() else null end,
            updated_at = now()
      where id = $1 and org_id = $2`,
    [step.id, orgId, stepStatus, res.invocationId,
     res.result !== undefined ? JSON.stringify(res.result) : null,
     ok ? null : (res.reason ?? res.status), ok ? null : (rejected ? "GOVERNANCE" : "TRANSIENT"),
     backoffMs / 1000]);

  const runStatus: RunStatus = ok ? "COMPLETED" : rejected ? "BLOCKED"
    : stepStatus === "TERMINAL_FAILURE" ? "TERMINAL_FAILURE" : "RETRYABLE_FAILURE";
  await transitionRun(db, orgId, runId, run.pursuit_id, "RUNNING", runStatus,
    { reason: ok ? `${step.skill_id} executed` : (res.reason ?? res.status),
      changeType: ok ? "RUN_COMPLETED" : rejected ? "RUN_BLOCKED" : "RUN_FAILED",
      stepId: step.id, invocationId: res.invocationId, governedActorId: run.governed_actor_id,
      env: run.data_environment, continuation: { seq: step.seq, attempt, stepId: step.id, lastStatus: stepStatus } });

  return { runStatus, stepStatus, invocationId: res.invocationId, reason: ok ? null : (res.reason ?? res.status), dispatched: true };
}
