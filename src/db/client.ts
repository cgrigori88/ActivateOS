import { readFileSync } from "node:fs";
import pg from "pg";

let pool: pg.Pool | null = null;

/**
 * TLS policy for the DB link (RISK-3). By default node-postgres takes SSL from
 * the connection string, and Supabase's template ships `sslmode=no-verify` —
 * encrypted but UNAUTHENTICATED, so a MITM can impersonate the database.
 *
 * This makes verify-full turnkey WITHOUT risking an outage: only when a CA is
 * supplied out-of-band do we pin it and demand a verified certificate. Set
 * exactly one of:
 *   - DATABASE_CA_CERT  = the PEM contents of the server CA (inline)
 *   - DATABASE_CA_PATH  = a filesystem path to that PEM
 * With neither set, behavior is unchanged (the connection string decides), so
 * this is safe to deploy before the CA is in place. Once the CA is set, also
 * drop `sslmode=no-verify` from DATABASE_URL — the explicit ssl object below
 * overrides it regardless, but keeping the string honest avoids confusion.
 */
function sslOption(): pg.PoolConfig["ssl"] {
  const inline = process.env.DATABASE_CA_CERT?.trim();
  const path = process.env.DATABASE_CA_PATH?.trim();
  const ca = inline ? inline : path ? readFileSync(path, "utf8") : null;
  if (!ca) return undefined; // no CA configured → leave SSL to the connection string
  return { ca, rejectUnauthorized: true };
}

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
    const ssl = sslOption();
    pool = new pg.Pool({
      connectionString,
      ...(ssl ? { ssl } : {}),
      max: Number(process.env.PG_POOL_MAX) > 0 ? Number(process.env.PG_POOL_MAX) : 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      keepAlive: true,
    });
  }
  return pool;
}
