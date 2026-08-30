import type { PoolClient } from "pg";
import { recordChange } from "../ledger";
import { grantIsLiveById } from "./grants";
import { obsLog } from "../../obs/log";

/**
 * Governed external-action executor (Release Gate R1-G4). The single execution
 * transport for every EXTERNAL_ACTION: the outbox holds authorized work, and THIS
 * drain — never the UI, agent, or request handler — performs the side effect. The
 * invariant is decision → dispatchSkill → invocation → outbox → executor → receipt →
 * event. Properties enforced here: idempotency (a SUCCEEDED/executed action is never
 * re-run), explicit lifecycle, bounded exponential retry with retryable-vs-final
 * classification, dead-letter (FAILED_FINAL) surfaced, per-skill compensation, a
 * revocation re-check before execution, and feature gating so a synthetic/demo action
 * never reaches a live provider. Provider acknowledgement is recorded as a receipt; it
 * is not automatically a business outcome.
 */

export type ExecOutcome = "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_FINAL";
export interface ProviderResult { outcome: ExecOutcome; providerActionId?: string; detail?: Record<string, unknown>; failureClass?: string }

export interface OutboxJob {
  id: string; invocationId: string; orgId: string; provider: string; actionFamily: string | null;
  payload: Record<string, unknown>; attempts: number; maxAttempts: number; correlationId: string | null;
  dataEnvironment: string; consentGrantId: string | null;
}

export type ProviderExecutor = (db: PoolClient, job: OutboxJob) => Promise<ProviderResult>;

/** Classify a thrown error as transient (retry) or permanent (dead-letter). */
export function classifyError(err: unknown): { retryable: boolean; failureClass: string } {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/(timeout|timed out|econnreset|econnrefused|etimedout|rate limit|429|throttl|temporarily|503|502|500|network)/.test(m))
    return { retryable: true, failureClass: "TRANSIENT" };
  return { retryable: false, failureClass: "PERMANENT" };
}

/** Simulated provider — used for any non-PRODUCTION action or when real execution is dark.
 *  It NEVER contacts a live provider; it just proves the transport end to end. */
const simulatedExecutor: ProviderExecutor = async (_db, job) => ({
  outcome: "SUCCEEDED", providerActionId: `sim-${job.provider}-${job.id.slice(0, 8)}`, detail: { simulated: true },
});

/**
 * A deterministic executor for the blind suite (never a live provider). Driven by
 * payload flags: failUntilAttempt (retryable until that attempt), failFinal (permanent),
 * failRetryableForever (poison). Registered under the 'test.echo' action family.
 */
const testExecutor: ProviderExecutor = async (_db, job) => {
  const p = job.payload as { failUntilAttempt?: number; failFinal?: boolean; failRetryableForever?: boolean };
  if (p.failFinal) return { outcome: "FAILED_FINAL", failureClass: "PERMANENT", detail: { reason: "permanent test failure" } };
  if (p.failRetryableForever) return { outcome: "FAILED_RETRYABLE", failureClass: "TRANSIENT", detail: { reason: "poison" } };
  if (typeof p.failUntilAttempt === "number" && job.attempts < p.failUntilAttempt)
    return { outcome: "FAILED_RETRYABLE", failureClass: "TRANSIENT", detail: { attempt: job.attempts } };
  return { outcome: "SUCCEEDED", providerActionId: `test-${job.id.slice(0, 8)}`, detail: { attempt: job.attempts } };
};

/** Provider registry keyed by action family. Real providers are wired lazily so this
 *  module stays free of comms/provider imports at load (and testable in isolation). */
const REGISTRY: Record<string, ProviderExecutor> = { "test.echo": testExecutor };
export function registerExecutor(actionFamily: string, exec: ProviderExecutor): void { REGISTRY[actionFamily] = exec; }

const BASE_BACKOFF_MS = 30_000; // 30s * 2^attempt, capped
const MAX_BACKOFF_MS = 3_600_000;
function backoffMs(attempt: number): number { return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt); }

export interface DrainOpts {
  limit?: number;
  /** Gate real external execution. Default false ⇒ everything simulates (dark by default). */
  allowRealProvider?: boolean;
  /** Wall clock for tests (retry due-time). */
  now?: Date;
}
export interface DrainResult { processed: number; succeeded: number; retryable: number; final: number; compensated: number; skipped: number }

export async function drainOutbox(db: PoolClient, opts: DrainOpts = {}): Promise<DrainResult> {
  const now = opts.now ?? new Date();
  const res: DrainResult = { processed: 0, succeeded: 0, retryable: 0, final: 0, compensated: 0, skipped: 0 };
  const { rows } = await db.query<{
    id: string; invocation_id: string; org_id: string; provider: string; action_family: string | null;
    payload: Record<string, unknown>; attempts: number; max_attempts: number; correlation_id: string | null;
    data_environment: string; consent_grant_id: string | null;
  }>(
    `select o.id, o.invocation_id, o.org_id, o.provider, o.action_family, o.payload, o.attempts, o.max_attempts,
            o.correlation_id, o.data_environment, i.consent_grant_id
       from action_outbox o join governed_action_invocations i on i.id = o.invocation_id
      where o.status in ('PENDING','FAILED_RETRYABLE')
        and (o.next_attempt_at is null or o.next_attempt_at <= $1)
      order by o.created_at limit $2 for update skip locked`,
    [now, opts.limit ?? 50]);

  for (const r of rows) {
    res.processed++;
    const job: OutboxJob = {
      id: r.id, invocationId: r.invocation_id, orgId: r.org_id, provider: r.provider, actionFamily: r.action_family,
      payload: r.payload ?? {}, attempts: r.attempts, maxAttempts: r.max_attempts, correlationId: r.correlation_id,
      dataEnvironment: r.data_environment, consentGrantId: r.consent_grant_id,
    };
    await db.query(`update action_outbox set status='EXECUTING', locked_at=now(), updated_at=now() where id=$1`, [job.id]);

    // Revocation re-check BEFORE execution: an action whose consent grant is no longer
    // live must not execute — it is COMPENSATED (recovery state recorded), not sent.
    if (job.consentGrantId && !(await grantIsLiveById(db, job.consentGrantId))) {
      await compensate(db, job, "authority revoked before execution");
      res.compensated++; continue;
    }

    // Feature gating: only a PRODUCTION action with real execution explicitly allowed
    // reaches a live provider. Everything else simulates — a demo action never sends.
    const real = job.dataEnvironment === "PRODUCTION" && opts.allowRealProvider === true;
    const exec: ProviderExecutor = real ? (REGISTRY[job.actionFamily ?? ""] ?? simulatedExecutor) : simulatedExecutor;

    let result: ProviderResult;
    try { result = await exec(db, job); }
    catch (e) { const c = classifyError(e); result = { outcome: c.retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL", failureClass: c.failureClass, detail: { error: (e as Error).message.slice(0, 240) } }; }
    obsLog("outbox.executed", { correlationId: job.correlationId, orgId: job.orgId, outboxId: job.id, invocationId: job.invocationId, actionFamily: job.actionFamily, attempt: job.attempts + 1, outcome: result.outcome, simulated: !real });

    if (result.outcome === "SUCCEEDED") {
      await writeReceipt(db, job, "accepted", result);
      await db.query(`update action_outbox set status='SUCCEEDED', attempts=attempts+1, updated_at=now() where id=$1`, [job.id]);
      await db.query(`update governed_action_invocations set status='EXECUTED', executed_at=now() where id=$1`, [job.invocationId]);
      await recordChange(db, { orgId: job.orgId, entityType: "action", entityId: job.invocationId, changeType: "ACTION_EXECUTED",
        materiality: "MEDIUM", reason: `external action ${job.actionFamily ?? job.provider} executed`, actorType: "WORKER",
        triggerType: "GOVERNED_ACTION", dataEnvironment: job.dataEnvironment as never });
      res.succeeded++;
    } else {
      const willRetry = result.outcome === "FAILED_RETRYABLE" && job.attempts + 1 < job.maxAttempts;
      if (willRetry) {
        await db.query(
          `update action_outbox set status='FAILED_RETRYABLE', attempts=attempts+1, next_attempt_at=$2,
             last_error=$3, last_failure_class=$4, updated_at=now() where id=$1`,
          [job.id, new Date(now.getTime() + backoffMs(job.attempts + 1)), (result.detail?.error as string) ?? result.failureClass ?? "retryable", result.failureClass ?? "TRANSIENT"]);
        res.retryable++;
      } else {
        // Dead-letter: poison / permanent / retries exhausted — surfaced, not retried forever.
        await writeReceipt(db, job, "failed", result);
        await db.query(
          `update action_outbox set status='FAILED_FINAL', attempts=attempts+1, last_error=$2, last_failure_class=$3, updated_at=now() where id=$1`,
          [job.id, (result.detail?.error as string) ?? result.failureClass ?? "final", result.failureClass ?? "PERMANENT"]);
        await db.query(`update governed_action_invocations set status='FAILED' where id=$1`, [job.invocationId]);
        res.final++;
      }
    }
  }
  return res;
}

async function writeReceipt(db: PoolClient, job: OutboxJob, status: string, result: ProviderResult): Promise<void> {
  await db.query(
    `insert into action_receipts (invocation_id, outbox_id, org_id, provider, provider_action_id, status,
       submitted_at, completed_at, detail, attempt, correlation_id, failure_class)
     values ($1,$2,$3,$4,$5,$6, now(), now(), $7, $8, $9, $10)`,
    [job.invocationId, job.id, job.orgId, job.provider, result.providerActionId ?? null, status,
     JSON.stringify(result.detail ?? {}), job.attempts + 1, job.correlationId, result.failureClass ?? null]);
}

/** Compensation: irreversible sends can't literally roll back — record failure/recovery
 *  state (COMPENSATED) and leave the append-only history intact for follow-up. */
async function compensate(db: PoolClient, job: OutboxJob, reason: string): Promise<void> {
  await writeReceipt(db, job, "compensated", { outcome: "FAILED_FINAL", failureClass: "COMPENSATED", detail: { reason } });
  await db.query(`update action_outbox set status='COMPENSATED', last_error=$2, last_failure_class='COMPENSATED', updated_at=now() where id=$1`, [job.id, reason]);
  await db.query(`update governed_action_invocations set status='COMPENSATED' where id=$1`, [job.invocationId]);
  await recordChange(db, { orgId: job.orgId, entityType: "action", entityId: job.invocationId, changeType: "ACTION_INVOKED",
    materiality: "MEDIUM", reason: `external action compensated: ${reason}`, actorType: "WORKER", triggerType: "GOVERNED_ACTION",
    dataEnvironment: job.dataEnvironment as never });
}
