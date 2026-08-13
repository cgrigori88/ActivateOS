import pg from "pg";

let pool: pg.Pool | null = null;

/**
 * Shared connection pool. DATABASE_URL points at Supabase (or local Postgres
 * in dev).
 *
 * Serverless reality (learned in production, EMAXCONNSESSION): every warm
 * lambda instance builds its own pool, so per-instance `max` multiplies by
 * instance count against the database's client ceiling — Supabase's session
 * pooler allows 15, and 3 instances × 5 hit it exactly. Point DATABASE_URL at
 * the TRANSACTION pooler (port 6543) on serverless hosts; it multiplexes
 * many cheap client connections over few backends. Long-lived hosts (the
 * Railway worker) are fine on session mode or a direct connection.
 *
 * PG_POOL_MAX tunes per-instance width without a deploy; idle connections
 * release after 10s so quiet instances give their slots back, and a saturated
 * pool fails fast (5s) instead of hanging a page.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) > 0 ? Number(process.env.PG_POOL_MAX) : 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      keepAlive: true,
    });
  }
  return pool;
}
