import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { dispatchSkill, effectiveApprovalRequired, type Actor } from "@/lib/pursuits/federation/skills";
import { requestApproval } from "./approvals";
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
 *
 * P45-3 — SEQUENTIAL MULTI-STEP. A run now carries an ORDERED PROGRAM of steps, seq 1..N, executed
 * strictly in order, ONE consequential step per `resumeRun` call. Four rules make that safe:
 *
 *   1. A run and its whole program are born ATOMICALLY. The caller supplies an ordered list and
 *      never a `seq`; the server assigns position. If any step fails to validate or insert, no run
 *      and no partial program survive (a savepoint makes that a property of THIS function rather
 *      than of whoever called it).
 *   2. Run identity hashes the WHOLE canonical ordered program — position, skill, version, args and
 *      milestone key. The same program retried replays onto the same run; the same steps in a
 *      different order are a DIFFERENT program; and a different program offered while another is
 *      live is an explicit CONFLICT, never a silent replay of the run that already exists.
 *   3. EVERY STEP BOUNDARY IS A FRESH AUTHORITY BOUNDARY. The actor is pinned for the program, but a
 *      pinned identity is not a pinned entitlement: eligibility, permission, the capability grant,
 *      the pin and the approval policy are all re-evaluated per step. An approval on step N releases
 *      step N and nothing else.
 *   4. A failed or blocked step NEVER lets the runtime skip forward. Progress is defined by the
 *      lowest-seq step that is not COMPLETED, so a later PENDING step is structurally unreachable
 *      while an earlier one is unresolved.
 *
 * NOT P45-3: DAG / parallel branches / dependency joins · autonomous draining (one call still
 * advances at most one step) · compensation, rollback or undo of a completed step · deriving the
 * program from the decided plan (`PlanContent.nextAction` is untouched, and P45-3 proves only that a
 * run pinned to a P3 revision can durably execute a CALLER-SUPPLIED ordered program — not that the
 * program was synthesized from that plan) · EXTERNAL_ACTION steps.
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

/**
 * One step of a caller-supplied program. Deliberately HAS NO `seq`: position is the server's to
 * assign from the order of the array, so a caller cannot manufacture a gap, a duplicate position or
 * an execution order that disagrees with the program it presented for hashing.
 */
export interface ProgramStep {
  skillId: string;
  skillVersion?: number;
  args?: Record<string, unknown>;
  /** Advisory only. Milestone completion stays COMPUTED by the plan's rules; a step never writes one. */
  milestoneKey?: string | null;
  maxAttempts?: number;
}

interface NormalizedStep {
  seq: number; skillId: string; skillVersion: number;
  args: Record<string, unknown>; milestoneKey: string | null; maxAttempts: number;
}

/**
 * A run targets a decided revision and executes either a program (`steps`) or a single step given
 * inline. The inline form is the Slice-1 shape, kept because a one-step program is the common case
 * and because it lets P45-1/P45-2 evidence stand unchanged; it normalizes to a 1-element program and
 * takes exactly the same path, so there is one creation code path, not two.
 */
export interface StartRunArgs {
  pursuitId: string;
  planId: string;
  planRevisionId: string;
  governedActorId: string;
  initiatedByUserId?: string | null;
  /** The ordered program, executed seq 1..N. Mutually exclusive with the inline single-step fields. */
  steps?: ProgramStep[];
  skillId?: string;
  skillVersion?: number;
  args?: Record<string, unknown>;
  milestoneKey?: string | null;
  maxAttempts?: number;
  dataEnvironment?: DataEnvironment;
}

/**
 * A different program was offered for a revision that already has a live run.
 *
 * This is its own error class on purpose. `pursuit_runs_one_live` would refuse the insert anyway,
 * but a bare unique violation cannot tell "the caller retried the same request" from "the caller
 * asked for something else while work is in flight". The first must replay; the second must be
 * told plainly, because silently returning the existing run would hand back a program the caller
 * never asked for and let them believe their steps are executing.
 */
export class ProgramConflictError extends Error {
  constructor(readonly runId: string, readonly runStatus: string) {
    super(`a different program is already live for this plan revision (run ${runId}, ${runStatus}) — cancel it or present the same program`);
    this.name = "ProgramConflictError";
  }
}

/** Validate and position the program. Every rejection happens BEFORE anything is written. */
function normalizeProgram(a: StartRunArgs): NormalizedStep[] {
  if (a.steps && a.skillId) throw new Error("provide either an ordered program (`steps`) or a single `skillId`, not both");
  const raw: ProgramStep[] = a.steps ?? (a.skillId !== undefined
    ? [{ skillId: a.skillId, skillVersion: a.skillVersion, args: a.args, milestoneKey: a.milestoneKey, maxAttempts: a.maxAttempts }]
    : []);
  if (raw.length === 0) throw new Error("a run needs at least one step");
  return raw.map((st, i) => {
    const seq = i + 1;
    if (typeof st.skillId !== "string" || st.skillId.trim() === "") throw new Error(`program step ${seq}: skillId is required`);
    const skillVersion = st.skillVersion ?? 1;
    if (!Number.isInteger(skillVersion) || skillVersion < 1) throw new Error(`program step ${seq}: skillVersion must be a positive integer`);
    const maxAttempts = st.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`program step ${seq}: maxAttempts must be a positive integer`);
    if (st.args !== undefined && (typeof st.args !== "object" || st.args === null || Array.isArray(st.args)))
      throw new Error(`program step ${seq}: args must be an object`);
    return { seq, skillId: st.skillId, skillVersion, args: st.args ?? {}, milestoneKey: st.milestoneKey ?? null, maxAttempts };
  });
}

/**
 * Whole-program identity. POSITION IS PART OF THE HASH, so the same steps in a different order are
 * a different program — which is the point: order carries meaning, and two orderings of the same
 * skills are two different pieces of consequential work. `max_attempts` is deliberately excluded:
 * how many times we are willing to retry is an execution policy, not a change to what is being done.
 */
const programIdentity = (p: NormalizedStep[]): string =>
  sha(canonical(p.map((st) => ({ seq: st.seq, skillId: st.skillId, skillVersion: st.skillVersion, args: st.args, milestoneKey: st.milestoneKey }))));

export interface RunRow {
  id: string; status: RunStatus; reason: string | null; correlationId: string;
  planRevisionId: string; basisFingerprint: string; currentStepId: string | null;
  /** How many steps the program has. 1 for the Slice-1 shape. */
  stepCount: number;
  /** True when this call found an existing run for the identical program rather than creating one. */
  replayed: boolean;
}

/**
 * Create a run pinned to a decided plan revision, together with its ENTIRE ordered program.
 *
 * The revision must belong to this org and this plan, and must be a DECISION that was not REJECTED
 * — a recommendation nobody accepted is not authority to act. The `basis_fingerprint` is copied
 * here and never recomputed: it is the record of what the world looked like when the decision was
 * made, which is what later evaluation (P8) needs.
 *
 * ATOMIC BY CONSTRUCTION (P45-3 ruling 4). The run row, every step row, their server-assigned
 * sequence, their immutable skill/version/args/idempotency identity and the RUN_STARTED ledger entry
 * are one unit. A savepoint wraps the writes so a failure anywhere leaves NO run and NO partial
 * program behind even when the caller catches the error and carries on in the same transaction —
 * a half-written program would be indistinguishable from a program someone meant to shorten.
 */
export async function startRun(db: PoolClient, orgId: string, a: StartRunArgs): Promise<RunRow> {
  const program = normalizeProgram(a);
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

  // ── RUN IDENTITY — the WHOLE ordered program, not one skill (P45-3 ruling 5) ──────────────────
  // Hashing only the first skill+args would make two genuinely different programs that happen to
  // start the same way collide, so a caller asking for [draft, send] could be handed a live run
  // that only ever intended [draft]. The hash therefore covers every step's position, skill,
  // version, canonical args and milestone key.
  const runKey = `run:${a.pursuitId}:${a.planRevisionId}:prog:${programIdentity(program)}`;
  const { rows: existing } = await db.query<{ id: string; status: RunStatus; reason: string | null; correlation_id: string; plan_revision_id: string; basis_fingerprint: string; current_step_id: string | null; n: string }>(
    `select r.id, r.status, r.reason, r.correlation_id, r.plan_revision_id, r.basis_fingerprint, r.current_step_id,
            (select count(*) from pursuit_run_steps st where st.org_id = r.org_id and st.run_id = r.id) as n
       from pursuit_runs r where r.org_id = $1 and r.idempotency_key = $2`, [orgId, runKey]);
  if (existing[0]) {
    // Same program, presented again: this is a retry of one request, so it replays onto the run
    // that already exists rather than opening a second execution of one decision.
    return { id: existing[0].id, status: existing[0].status, reason: existing[0].reason,
             correlationId: existing[0].correlation_id, planRevisionId: existing[0].plan_revision_id,
             basisFingerprint: existing[0].basis_fingerprint, currentStepId: existing[0].current_step_id,
             stepCount: Number(existing[0].n), replayed: true };
  }

  // A DIFFERENT program while one is still live. `pursuit_runs_one_live` would refuse the insert,
  // but a raw unique violation cannot distinguish this from a retry — and the two deserve opposite
  // answers. Told explicitly, never blurred into a replay of the run that already exists.
  const { rows: live } = await db.query<{ id: string; status: RunStatus }>(
    `select id, status from pursuit_runs
      where org_id = $1 and pursuit_id = $2 and plan_revision_id = $3
        and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE') limit 1`,
    [orgId, a.pursuitId, a.planRevisionId]);
  if (live[0]) throw new ProgramConflictError(live[0].id, live[0].status);

  // ── ATOMIC CREATION ───────────────────────────────────────────────────────────────────────────
  // Run + every step + the ledger entry, or none of it. The savepoint means that even a caller who
  // catches the error and continues in the same transaction cannot observe a partial program.
  await db.query("savepoint p45_3_program");
  try {
    const { rows: run } = await db.query<{ id: string; correlation_id: string }>(
      `insert into pursuit_runs
         (org_id, pursuit_id, plan_id, plan_revision_id, governed_actor_id, initiated_by_user_id,
          status, idempotency_key, basis_fingerprint, data_environment)
       values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)
       returning id, correlation_id`,
      [orgId, a.pursuitId, a.planId, a.planRevisionId, a.governedActorId, a.initiatedByUserId ?? null,
       runKey, rev[0].basis_fingerprint, env]);
    const runId = run[0].id;

    // `seq` comes from the program's order — never from the caller — so the executed order is
    // provably the order that was hashed into the run's identity.
    const stepIds: string[] = [];
    for (const st of program) {
      const { rows: row } = await db.query<{ id: string }>(
        `insert into pursuit_run_steps
           (org_id, run_id, seq, skill_id, skill_version, args, status, max_attempts, milestone_key, idempotency_key)
         values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9) returning id`,
        [orgId, runId, st.seq, st.skillId, st.skillVersion, JSON.stringify(st.args), st.maxAttempts,
         st.milestoneKey, stepIdempotencyKey(runId, st.seq, st.skillId, st.skillVersion, st.args)]);
      stepIds.push(row[0].id);
    }

    await db.query(`update pursuit_runs set current_step_id = $2, status = 'READY', last_transition_at = now(), updated_at = now() where id = $1 and org_id = $3`,
      [runId, stepIds[0], orgId]);

    const shape = program.map((st) => `${st.seq}:${st.skillId}`).join(" → ");
    await ledger(db, orgId, a.pursuitId, runId, stepIds[0], null, "RUN_STARTED",
      { actorId: a.initiatedByUserId ?? null, governedActorId: a.governedActorId, env,
        reason: program.length === 1 ? `Run started for ${program[0].skillId}` : `Run started for a ${program.length}-step program: ${shape}`,
        before: null,
        after: { status: "READY", planRevisionId: a.planRevisionId, skillId: program[0].skillId, seq: 1,
                 stepCount: program.length, program: program.map((st) => ({ seq: st.seq, skillId: st.skillId, skillVersion: st.skillVersion })) } });

    await db.query("release savepoint p45_3_program");
    return { id: runId, status: "READY", reason: null, correlationId: run[0].correlation_id,
             planRevisionId: a.planRevisionId, basisFingerprint: rev[0].basis_fingerprint,
             currentStepId: stepIds[0], stepCount: program.length, replayed: false };
  } catch (e) {
    await db.query("rollback to savepoint p45_3_program");
    await db.query("release savepoint p45_3_program");
    throw e;
  }
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
  //
  // The runtime linkage goes IN the insert. An earlier implementation appended the row and then
  // UPDATEd it to attach run/step/invocation/actor; that succeeds as the owner and is refused as
  // `app_rw`, which holds INSERT and SELECT on change_ledger and nothing else — so no run could
  // complete under the real runtime identity (defect P45-D1, found by the hosted functional gate).
  // One statement is also atomic: there is no window in which a ledger row exists unlinked.
  await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit_run", entityId: runId,
    changeType: changeType as ChangeType, materiality: "MEDIUM", reason: o.reason,
    actorType: "USER", actorId: o.actorId ?? null, triggerType: "GOVERNED_ACTION",
    dataEnvironment: o.env, before: o.before ?? undefined, after: o.after ?? undefined,
    runId, runStepId: stepId, invocationId, governedActorId: o.governedActorId ?? null,
  });
}

/**
 * Load the run AND serialize on it.
 *
 * `for update` is the whole point (P45-3 ruling 11): every caller of this function goes on to
 * mutate the run, and with a multi-step program a run is touched repeatedly rather than once, so
 * two concurrent advances could otherwise both select the same lowest-seq step. The lock makes the
 * read-decide-write sequence a critical section per run; the compare-and-set in `transitionRun` is
 * the second line of defence, and the step's own idempotency key is the third — even a lost race
 * produces a duplicate ATTEMPT, never a duplicate EFFECT.
 *
 * This is a plain row lock held for the caller's transaction, NOT a lease: there is no `locked_at`
 * claim, no expiry and no crash-recovery protocol, because a request-triggered INTERNAL_WRITE
 * runtime needs none. FUTURE BOUNDARY: do not generalize a database transaction held across an
 * EXTERNAL/provider action — that needs its own worker/claim design, and EXTERNAL_ACTION steps are
 * out of scope here anyway.
 */
async function loadRun(db: PoolClient, orgId: string, runId: string) {
  await db.query(`select id from pursuit_runs where id = $1 and org_id = $2 for update`, [runId, orgId]);
  const { rows } = await db.query<{
    id: string; pursuit_id: string; plan_id: string; plan_revision_id: string; governed_actor_id: string;
    initiated_by_user_id: string | null; status: RunStatus; current_step_id: string | null;
    correlation_id: string; basis_fingerprint: string; data_environment: DataEnvironment; reason: string | null;
    continuation: Record<string, unknown> | null;
  }>(`select id, pursuit_id, plan_id, plan_revision_id, governed_actor_id, initiated_by_user_id, status,
             current_step_id, correlation_id, basis_fingerprint, data_environment, reason, continuation
        from pursuit_runs where id = $1 and org_id = $2`, [runId, orgId]);
  return rows[0] ?? null;
}

/**
 * Move the run, then record it. The UPDATE is a genuine COMPARE-AND-SET: `from` is no longer only
 * the `before` value in the ledger, it is a predicate. Before P45-3 the run advanced once and the
 * distinction was academic; a looping run makes it load-bearing, and a transition that silently
 * overwrote a status someone else had just moved would be exactly the kind of lost update the
 * ledger would then attest to as fact.
 */
async function transitionRun(
  db: PoolClient, orgId: string, runId: string, pursuitId: string, from: RunStatus, to: RunStatus,
  o: { reason: string; changeType: string; stepId?: string | null; invocationId?: string | null;
       actorId?: string | null; governedActorId?: string | null; env: DataEnvironment; continuation?: unknown;
       /** Advance the durable cursor to the next step. Omitted leaves `current_step_id` alone. */
       currentStepId?: string | null; after?: Record<string, unknown> },
): Promise<void> {
  const moveCursor = o.currentStepId !== undefined;
  const res = await db.query(
    `update pursuit_runs set status = $2, reason = $3, last_transition_at = now(), updated_at = now(),
            continuation = coalesce($4::jsonb, continuation), locked_at = null,
            current_step_id = case when $6::boolean then $7::uuid else current_step_id end
      where id = $1 and org_id = $5 and status = $8`,
    [runId, to, o.reason, o.continuation === undefined ? null : JSON.stringify(o.continuation), orgId,
     moveCursor, o.currentStepId ?? null, from]);
  if (res.rowCount !== 1)
    throw new Error(`run transition conflict: ${runId} was no longer ${from} when moving to ${to}`);
  await ledger(db, orgId, pursuitId, runId, o.stepId ?? null, o.invocationId ?? null, o.changeType,
    { actorId: o.actorId, governedActorId: o.governedActorId, env: o.env, reason: o.reason,
      before: { status: from }, after: { status: to, ...(o.after ?? {}) } });
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

/**
 * CANCELLED NEVER MEANS "NOTHING EXECUTED" (P45-3 ruling 9).
 *
 * Steps that already completed had real effects and they stay. P45-3 invents no compensation,
 * rollback, undo or reverse skill — the runtime has no authority to synthesize an inverse the skill
 * registry never declared. What it owes instead is an unambiguous record of WHERE the program
 * stopped, so nobody reading a CANCELLED run later assumes it was a no-op.
 */
async function haltPoint(db: PoolClient, orgId: string, runId: string) {
  const { rows } = await db.query<{ total: string; completed: string; last_completed_seq: number | null; halted_at_seq: number | null }>(
    `select count(*)::text as total,
            count(*) filter (where status = 'COMPLETED')::text as completed,
            max(seq) filter (where status = 'COMPLETED') as last_completed_seq,
            min(seq) filter (where status <> 'COMPLETED') as halted_at_seq
       from pursuit_run_steps where org_id = $1 and run_id = $2`, [orgId, runId]);
  const r = rows[0];
  return { stepsTotal: Number(r?.total ?? 0), stepsCompleted: Number(r?.completed ?? 0),
           lastCompletedSeq: r?.last_completed_seq ?? null, haltedAtSeq: r?.halted_at_seq ?? null,
           effectsRetained: Number(r?.completed ?? 0) > 0 };
}

export async function cancelRun(db: PoolClient, orgId: string, runId: string, reason: string, userId?: string | null): Promise<RunStatus> {
  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");
  if (TERMINAL.has(run.status)) return run.status;
  const halt = await haltPoint(db, orgId, runId);
  await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "CANCELLED",
    { reason, changeType: "RUN_CANCELLED", stepId: run.current_step_id, actorId: userId, governedActorId: run.governed_actor_id, env: run.data_environment, after: halt });
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
  const halt = await haltPoint(db, orgId, run.id);
  await transitionRun(db, orgId, run.id, run.pursuit_id, run.status, "CANCELLED",
    { reason: "PLAN_SUPERSEDED", changeType: "RUN_CANCELLED", stepId: run.current_step_id,
      governedActorId: run.governed_actor_id, env: run.data_environment, after: halt });
  await db.query(`update pursuit_run_steps set status = 'CANCELLED', updated_at = now() where org_id = $1 and run_id = $2 and status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE')`, [orgId, run.id]);
  return true;
}

export interface ExecuteResult {
  runStatus: RunStatus; stepStatus: string; invocationId: string | null; reason: string | null; dispatched: boolean;
  /** The seq this call acted on, or null when no step was selected. */
  stepSeq?: number | null;
  /** Steps still not COMPLETED after this call. 0 means the program finished; null means unknown. */
  remainingSteps?: number | null;
  /** True when the request was issued against a generation the run has since left (P45-3-D1). */
  stale?: boolean;
}

/**
 * THE RUN-STEP GENERATION (defect P45-3-D1).
 *
 * A resume request may advance only the generation it observed when the request BEGAN. Serializing
 * on the run row is not sufficient on its own: two requests issued against step 1 would otherwise
 * queue up and execute steps 1 AND 2, so a double-click, a network retry, a duplicate job delivery
 * or two callers acting at once would authorize TWO sequential consequential actions from what was
 * only ever one intent. Every step still executing exactly once does not repair that — the second
 * request is STALE with respect to the cursor it meant to advance.
 *
 * The token is built from state the runtime already owns — no lease, no new column, no migration:
 *
 *   • `current_step_id` — which step the program is on;
 *   • the run's `status`  — so parking for approval, completing or cancelling ends the generation;
 *   • that step's `attempt` — so a retry is its own generation and a stale request cannot silently
 *     spend another attempt from the retry budget.
 *
 * It is read WITHOUT a lock, before `loadRun` takes `for update`. Under READ COMMITTED the locking
 * statement re-reads the row it waited for, so the loser sees the winner's committed generation and
 * declines. Nothing here is client-supplied: the cursor is read from the database, never accepted
 * from a caller. If an entry point ever exposes one it may serve ONLY as an optimistic-concurrency
 * precondition — never as authorization and never as step selection.
 */
interface RunGeneration { stepId: string | null; status: string; attempt: number | null }

async function observeGeneration(db: PoolClient, orgId: string, runId: string): Promise<RunGeneration | null> {
  const { rows } = await db.query<RunGeneration>(
    `select r.current_step_id as "stepId", r.status, st.attempt
       from pursuit_runs r
       left join pursuit_run_steps st on st.id = r.current_step_id and st.org_id = r.org_id
      where r.id = $1 and r.org_id = $2`, [runId, orgId]);
  return rows[0] ?? null;
}

const sameGeneration = (a: RunGeneration, b: RunGeneration): boolean =>
  a.stepId === b.stepId && a.status === b.status && a.attempt === b.attempt;

/** Statuses a step may legitimately be executed from. Anything else halts the program where it is. */
const STEP_ELIGIBLE: ReadonlySet<string> = new Set(["PENDING", "READY", "RUNNING", "RETRYABLE_FAILURE"]);

/**
 * Request-triggered execution of the run's next eligible step.
 *
 * Everything it needs comes from the database. Call it after a crash, a deploy, a pause or a
 * three-day gap and it behaves identically, because there is no in-process state to lose.
 */
export async function resumeRun(db: PoolClient, orgId: string, runId: string, actor: Actor): Promise<ExecuteResult> {
  // Observed BEFORE the lock: this is the generation the request was issued against.
  const observed = await observeGeneration(db, orgId, runId);
  if (!observed) throw new Error("run not found in this org");

  const run = await loadRun(db, orgId, runId);
  if (!run) throw new Error("run not found in this org");

  // Re-read under the lock. If the run left that generation while this request waited, the request
  // is stale: it intended to advance a cursor that no longer exists, so it does nothing at all.
  // A request ISSUED AFTER the advance observes the new generation and proceeds normally — this
  // constrains duplicate and concurrent requests, not request-driven progression.
  const current = await observeGeneration(db, orgId, runId);
  if (!current || !sameGeneration(observed, current))
    return { runStatus: run.status, stepStatus: "—", invocationId: null, dispatched: false, stale: true,
             reason: "stale resume — the run left the generation this request was issued against",
             stepSeq: null, remainingSteps: null };
  if (TERMINAL.has(run.status)) return { runStatus: run.status, stepStatus: "—", invocationId: null, reason: run.reason, dispatched: false };
  if (run.status === "PAUSED") return { runStatus: "PAUSED", stepStatus: "PAUSED", invocationId: null, reason: "paused — resume first", dispatched: false };
  // A pending approval is released by a DECISION, never by calling resume again. Anything else would
  // make "waiting for a human" bypassable by retry.
  if (run.status === "WAITING_FOR_APPROVAL")
    return { runStatus: "WAITING_FOR_APPROVAL", stepStatus: "WAITING_FOR_APPROVAL", invocationId: null,
             reason: "awaiting a human decision", dispatched: false };
  if (!RESUMABLE.has(run.status)) return { runStatus: run.status, stepStatus: "—", invocationId: null, reason: `not resumable from ${run.status}`, dispatched: false };

  if (await cancelIfSuperseded(db, orgId, run))
    return { runStatus: "CANCELLED", stepStatus: "CANCELLED", invocationId: null, reason: "PLAN_SUPERSEDED", dispatched: false };

  // ── WHICH STEP IS NEXT — the rule that makes skipping structurally impossible ─────────────────
  // Progress is the LOWEST-SEQ STEP THAT IS NOT COMPLETED, whatever its status. Selecting on
  // "eligible statuses" instead would quietly step OVER a BLOCKED or TERMINAL_FAILURE step and run
  // step 3 on the assumption that step 2 happened. The run-level guards above already refuse those
  // states, but a program's ordering must not depend on a second guard remembering to be correct.
  const { rows: steps } = await db.query<{
    id: string; seq: number; skill_id: string; skill_version: number; args: Record<string, unknown>;
    status: string; attempt: number; max_attempts: number; next_attempt_at: Date | null;
    idempotency_key: string; milestone_key: string | null;
  }>(`select id, seq, skill_id, skill_version, args, status, attempt, max_attempts, next_attempt_at,
             idempotency_key, milestone_key
        from pursuit_run_steps
       where org_id = $1 and run_id = $2 and status <> 'COMPLETED'
       order by seq asc, id asc limit 1`, [orgId, runId]);

  if (!steps[0]) {
    // Every step in the program is COMPLETED. (A one-step run reaches COMPLETED through the
    // post-dispatch path below, not here; this is the terminator for a resume issued after the
    // program already finished, and for a program whose last step completed elsewhere.)
    await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "COMPLETED",
      { reason: "all steps complete", changeType: "RUN_COMPLETED", governedActorId: run.governed_actor_id, env: run.data_environment });
    return { runStatus: "COMPLETED", stepStatus: "COMPLETED", invocationId: null, reason: null, dispatched: false, stepSeq: null, remainingSteps: 0 };
  }
  const step = steps[0];

  // The earliest unfinished step is in a state this call cannot act on — halt here rather than
  // looking further down the program. A blocked or exhausted step is not a reason to run the NEXT
  // one; it is a reason to stop. (P45-3 introduces no BLOCKED recovery path: a BLOCKED run is not
  // resumable today, and redefining that is deliberately not part of this slice.)
  if (!STEP_ELIGIBLE.has(step.status))
    return { runStatus: run.status, stepStatus: step.status, invocationId: null,
             reason: `step ${step.seq} is ${step.status} — the program cannot advance past it`,
             dispatched: false, stepSeq: step.seq, remainingSteps: null };

  if (step.next_attempt_at && step.next_attempt_at.getTime() > Date.now())
    return { runStatus: run.status, stepStatus: step.status, invocationId: null, reason: "backoff not elapsed", dispatched: false };

  if (step.attempt >= step.max_attempts) {
    await db.query(`update pursuit_run_steps set status = 'TERMINAL_FAILURE', ended_at = now(), updated_at = now() where id = $1 and org_id = $2`, [step.id, orgId]);
    await transitionRun(db, orgId, runId, run.pursuit_id, run.status, "TERMINAL_FAILURE",
      { reason: "retry budget exhausted", changeType: "RUN_FAILED", stepId: step.id, governedActorId: run.governed_actor_id, env: run.data_environment });
    return { runStatus: "TERMINAL_FAILURE", stepStatus: "TERMINAL_FAILURE", invocationId: null, reason: "retry budget exhausted", dispatched: false };
  }

  // ── APPROVAL GATE (P45-2) ──────────────────────────────────────────────────────────────────────
  // Policy is resolved from the canonical skill plus this actor's grant override, immediately before
  // anything consequential happens. A required approval parks the run and step in
  // WAITING_FOR_APPROVAL and returns; execution resumes only through a decided request.
  const { rows: policy } = await db.query<{ approval_required: boolean; override: boolean | null }>(
    `select gs.approval_required,
            (select g.approval_required_override from actor_capability_grants g
              where g.org_id = $1 and g.actor_id = $2 and g.skill_id = $3 and g.status = 'ACTIVE'
              limit 1) as override
       from governed_skills gs where gs.skill_id = $3 and gs.version = $4`,
    [orgId, run.governed_actor_id, step.skill_id, step.skill_version]);
  const needsApproval = policy[0]
    ? effectiveApprovalRequired(step.skill_id, policy[0].approval_required === true, policy[0].override)
    : false;
  // ONE APPROVAL RELEASES EXACTLY ONE STEP (P45-3 ruling 8).
  //
  // Slice 2 answered "has this run been approved?" from `continuation.approvedRequestId`, which is
  // RUN-scoped. With one step that was the same question; with a program it is not — step 3 would
  // have sailed through the gate on the approval a human gave for step 2, which is precisely the
  // cascade the governance model forbids. The question is now asked of the STEP, and asked of
  // `pursuit_run_approvals`, which is append-only and which `app_rw` cannot rewrite — a strictly
  // stronger source than the run's mutable continuation. A later approval-required step parks
  // independently even when it names the very same skill.
  const { rows: approved } = await db.query<{ ok: boolean }>(
    `select true as ok from pursuit_run_approvals
      where org_id = $1 and run_id = $2 and run_step_id = $3 and decision = 'APPROVED' limit 1`,
    [orgId, runId, step.id]);
  const alreadyApproved = approved.length > 0;
  if (needsApproval && !alreadyApproved) {
    const requestId = await requestApproval(db, orgId, {
      pursuitId: run.pursuit_id, planRevisionId: run.plan_revision_id, runId, runStepId: step.id,
      skillId: step.skill_id, skillVersion: step.skill_version,
      requestedByActorId: run.governed_actor_id, env: run.data_environment,
      why: `${step.skill_id} requires a human decision before it may execute`,
    });
    await db.query(`update pursuit_run_steps set status = 'WAITING_FOR_APPROVAL', updated_at = now() where id = $1 and org_id = $2`, [step.id, orgId]);
    await db.query(
      `update pursuit_runs set status = 'WAITING_FOR_APPROVAL', current_step_id = $2, reason = $3,
              last_transition_at = now(), updated_at = now()
        where id = $1 and org_id = $4`, [runId, step.id, `awaiting approval (${requestId})`, orgId]);
    return { runStatus: "WAITING_FOR_APPROVAL", stepStatus: "WAITING_FOR_APPROVAL", invocationId: null,
             reason: `awaiting approval (${requestId})`, dispatched: false, stepSeq: step.seq, remainingSteps: null };
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

  // ── ADVANCE OR FINISH — the one expression that used to assume a single step ──────────────────
  // Slice 1 read `ok ? "COMPLETED"`, so the first success ended the run no matter what else the
  // program held. Progress is now decided by what is actually left: the step just written is
  // COMPLETED, so anything this query returns is genuinely outstanding work.
  const { rows: rest } = await db.query<{ id: string; seq: number }>(
    `select id, seq from pursuit_run_steps
      where org_id = $1 and run_id = $2 and status <> 'COMPLETED'
      order by seq asc, id asc`, [orgId, runId]);
  const remaining = rest.length;
  const next = ok ? rest[0] : undefined;

  const runStatus: RunStatus = ok ? (next ? "READY" : "COMPLETED")
    : rejected ? "BLOCKED"
    : stepStatus === "TERMINAL_FAILURE" ? "TERMINAL_FAILURE" : "RETRYABLE_FAILURE";

  // THE AUDIT CONTRACT (ruling 2). An intermediate success emits RUN_STEP_COMPLETED; the final
  // success emits RUN_COMPLETED and NOT both. A one-step run therefore still emits exactly
  // RUN_STARTED → RUN_COMPLETED, unchanged from Slice 1.
  const changeType = ok ? (next ? "RUN_STEP_COMPLETED" : "RUN_COMPLETED")
    : rejected ? "RUN_BLOCKED" : "RUN_FAILED";

  await transitionRun(db, orgId, runId, run.pursuit_id, "RUNNING", runStatus,
    { reason: ok
        ? (next ? `${step.skill_id} executed (step ${step.seq}); next is step ${next.seq}` : `${step.skill_id} executed`)
        : (res.reason ?? res.status),
      changeType,
      stepId: step.id, invocationId: res.invocationId, governedActorId: run.governed_actor_id,
      env: run.data_environment,
      // Advance the durable cursor with the transition, in the same compare-and-set, so a crash can
      // never leave the run pointing at a step it has already finished. Replacing the continuation
      // wholesale also drops Slice 2's `approvedRequestId`, which must never outlive its step.
      ...(next ? { currentStepId: next.id } : {}),
      continuation: next
        ? { seq: next.seq, attempt: 0, stepId: next.id, lastCompletedSeq: step.seq, lastStatus: stepStatus }
        : { seq: step.seq, attempt, stepId: step.id, lastStatus: stepStatus },
      after: { seq: step.seq, skillId: step.skill_id, stepStatus, remainingSteps: remaining,
               ...(next ? { nextSeq: next.seq } : {}) } });

  // ONE CALL ADVANCES AT MOST ONE CONSEQUENTIAL STEP (ruling 6). The remaining program is NOT
  // drained here. Every step boundary is a fresh authority boundary — eligibility, permission, the
  // capability grant, the pin and the approval policy are all re-derived on the next call — and a
  // loop would let one request carry authority the caller was never separately granted.
  return { runStatus, stepStatus, invocationId: res.invocationId,
           reason: ok ? null : (res.reason ?? res.status), dispatched: true,
           stepSeq: step.seq, remainingSteps: remaining };
}
