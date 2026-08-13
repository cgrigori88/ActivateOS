import type pg from "pg";

/**
 * One global advisory lock for all heavy pipeline work — screening sweeps AND
 * research drains. Both spend real budget and both call scoreOrg, so they must
 * never run concurrently (a race there would double-score / double-spend).
 *
 * The lock is TRANSACTION-scoped (pg_try_advisory_xact_lock) inside an
 * explicit transaction, not session-scoped. That is the only shape that
 * survives every connection mode we deploy on: under Supabase's transaction
 * pooler a session lock would be taken on one pooled backend and leak there
 * forever (poisoning it for every future caller), while a transaction pins a
 * single backend for its duration and the lock self-releases at COMMIT /
 * ROLLBACK / disconnect. On session mode and direct connections the behavior
 * is identical to before.
 *
 * The work therefore runs inside one transaction: a crashed sweep rolls back
 * atomically instead of leaving half-written scores.
 */
const PIPELINE_LOCK_KEY = 0x50524553; // "PRES"

export type LockResult<T> = { locked: true } | { locked: false; result: T };

export async function withPipelineLock<T>(
  db: pg.PoolClient,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  await db.query("begin");
  try {
    const { rows } = await db.query<{ locked: boolean }>(
      `select pg_try_advisory_xact_lock($1) as locked`,
      [PIPELINE_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      await db.query("rollback");
      return { locked: true };
    }
    const result = await fn();
    await db.query("commit");
    return { locked: false, result };
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
