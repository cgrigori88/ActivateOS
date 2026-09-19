import type { Pool, PoolClient } from "pg";

/**
 * D-S14-EXECUTION-BOUND — THE TRUSTED EXECUTION POLICY.
 *
 * > **Every workload-bearing PostgreSQL statement reachable from the governed external
 * > `pipeline_summary` request is subject to a trusted per-statement PostgreSQL execution bound.**
 *
 * Note what that sentence does NOT say. A transaction must execute `begin` and the transaction-local
 * `set_config` BEFORE a PostgreSQL timeout exists to bound anything — those two are fixed control
 * statements, identical on every call, carrying no caller-shaped work. They are not covered by the
 * claim and claiming them would be false. Everything after them is.
 *
 * ── WHY AN EXPLICIT PARAMETER AND NOT AMBIENT STATE ─────────────────────────────────────────────
 *
 * `AsyncLocalStorage` would thread this invisibly and cost no signatures. It was rejected: an
 * ambient bound is one a reader cannot see, one a new call site inherits silently, and one whose
 * absence is indistinguishable from its presence. An explicit optional parameter makes the opposite
 * true — a DB-bearing path either takes the policy or it is visibly missing from the graph, which is
 * what the inventory test in tests/p7-slice14.test.ts actually checks.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * It is execution metadata: server-owned, non-semantic, non-authoritative. It never enters MCP
 * arguments, `PursuitExperienceRequest`, `SurfaceSpec`, a `ContextManifest`, model input or the
 * canonical result's provenance. Changing it cannot change what `pipeline_summary` means — only how
 * long one statement may hold a connection before PostgreSQL cancels it.
 *
 * It is also NOT a request deadline. There is no wall-clock timer over the whole request, no
 * `Promise.race`, and no client-side cancellation: this is PostgreSQL's own `statement_timeout`,
 * which the server enforces and which actually stops the work.
 */
export interface ExecutionPolicy {
  /** Per-statement PostgreSQL bound, in milliseconds. Absent → the server default, unchanged. */
  readonly statementTimeoutMs?: number;
}

/**
 * The bound is CLAMPED, not trusted as given.
 *
 * Today every value is a server-owned constant, so the clamp can never fire. It exists because the
 * failure it prevents is silent: `statement_timeout = 0` means *no timeout at all* in PostgreSQL, so
 * a future caller passing 0 — or a NaN from a parsed env var — would disable the bound while every
 * signature still said it was bounded. Clamping makes "policy present" and "bounded" the same fact.
 */
export const MIN_STATEMENT_TIMEOUT_MS = 50;
export const MAX_STATEMENT_TIMEOUT_MS = 30_000;

/** The effective bound, or null when no policy was supplied (existing callers — behavior unchanged). */
export function statementTimeoutOf(policy?: ExecutionPolicy): number | null {
  const ms = policy?.statementTimeoutMs;
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return Math.min(MAX_STATEMENT_TIMEOUT_MS, Math.max(MIN_STATEMENT_TIMEOUT_MS, Math.floor(ms)));
}

/**
 * Run `fn` on ONE pooled client inside a transaction whose statements are bounded.
 *
 * This exists for the two pre-tenant statements — API-key resolution and substrate posture — which
 * run on the POOL rather than inside a tenant transaction, and so have nowhere to carry a
 * transaction-local setting. Both need exactly this and nothing more, which is why it is a shared
 * primitive rather than either duplicated twice or generalized into a transaction framework.
 *
 * WHY A TRANSACTION AT ALL, for what is one statement. `set_config(..., is_local => true)` is
 * `SET LOCAL`, and `SET LOCAL` outside a transaction block does nothing (PostgreSQL warns and moves
 * on) — so the bound would silently not exist. Wrapping in `begin`/`commit` is what makes it real,
 * and is also what guarantees the setting dies with the transaction instead of riding the pooled
 * connection into the next unrelated checkout.
 *
 * WHY ONE CLIENT, EXPLICITLY CHECKED OUT. `pool.query("begin")` followed by `pool.query(...)` is not
 * guaranteed to reach the same connection: the pool may hand the second statement to a different
 * client, leaving an open transaction stranded on the first and the real work unbounded on the
 * second. Checking the client out once and issuing everything on it is the only correct form.
 *
 * The timeout value is bound as a PARAMETER. `set_config` takes it as a value, so there is no SQL
 * interpolation here — and `SET LOCAL statement_timeout = ...` could not be parameterized at all,
 * which is the second reason this is written with `set_config`.
 */
export async function withStatementBound<T>(
  pool: Pick<Pool, "connect">,
  timeoutMs: number,
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const ms = Math.min(MAX_STATEMENT_TIMEOUT_MS, Math.max(MIN_STATEMENT_TIMEOUT_MS, Math.floor(timeoutMs)));
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(`select set_config('statement_timeout', $1, true)`, [String(ms)]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (err) {
    try {
      await db.query("rollback");
    } catch {
      /* connection already broken; release below */
    }
    throw err;
  } finally {
    // ALWAYS released, including after a 57014 cancellation. A statement timeout rolls the
    // transaction back and leaves the connection healthy and reusable — destroying it is neither
    // required for correctness nor free, since the pool would have to reconnect.
    db.release();
  }
}

/** PostgreSQL's `query_canceled`. Raised when a statement exceeds `statement_timeout`. */
export const PG_QUERY_CANCELED = "57014";

/**
 * Was this failure a statement timeout?
 *
 * For INTERNAL observability only. The distinction is real and worth logging — "the database
 * cancelled a statement" is a different operational fact from "something threw" — but it never
 * reaches a recipient, who sees the canonical `FAILED` with no message, no SQL, no role and no
 * timeout value.
 */
export function isStatementTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === PG_QUERY_CANCELED;
}
