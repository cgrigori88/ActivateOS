import type pg from "pg";

/**
 * One global advisory lock for all heavy pipeline work — screening sweeps AND
 * research drains. Both spend real budget and both call scoreOrg, so they must
 * never run concurrently (a race there would double-score / double-spend). The
 * lock is Postgres session-scoped, so it auto-releases if the connection drops.
 *
 * Acquire/release must happen on the SAME connection; pass the PoolClient the
 * work runs on.
 */
const PIPELINE_LOCK_KEY = 0x50524553; // "PRES"

export type LockResult<T> = { locked: true } | { locked: false; result: T };

export async function withPipelineLock<T>(
  db: pg.PoolClient,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  const { rows } = await db.query<{ locked: boolean }>(
    `select pg_try_advisory_lock($1) as locked`,
    [PIPELINE_LOCK_KEY],
  );
  if (!rows[0]?.locked) return { locked: true };
  try {
    return { locked: false, result: await fn() };
  } finally {
    await db.query(`select pg_advisory_unlock($1)`, [PIPELINE_LOCK_KEY]);
  }
}
