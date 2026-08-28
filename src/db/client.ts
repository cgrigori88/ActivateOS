import { readFileSync } from "node:fs";
import tls from "node:tls";
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
  // Normalize \n-escaped PEMs (some env stores flatten newlines) so the cert parses.
  const pinned = inline ? inline.replace(/\\n/g, "\n") : path ? readFileSync(path, "utf8") : null;
  if (!pinned) return undefined; // no CA configured → leave SSL to the connection string
  // Trust the pinned CA IN ADDITION to Node's built-in roots — not instead of.
  // Serverless connects through the Supabase POOLER, which presents a
  // publicly-trusted cert that chains to a SYSTEM root; a DIRECT connection
  // presents a cert signed by Supabase's PRIVATE root (the downloaded
  // prod-ca-2021). Trusting only the pinned CA breaks the pooler path
  // (SELF_SIGNED_CERT_IN_CHAIN); trusting only system roots breaks the direct
  // path. rejectUnauthorized stays true, so this is real verification against a
  // known trust set — no MITM opening, just a superset of accepted issuers.
  return { ca: [...tls.rootCertificates, pinned], rejectUnauthorized: true };
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

/**
 * Run `fn` in a transaction, accepting EITHER a Pool or an already-checked-out
 * PoolClient (RISK-1). Given a PoolClient (from withTenant), it reuses the
 * caller's open transaction — so tenant scoping (the app.org_id GUC) is
 * inherited. Given a Pool, it checks out its own connection and owns the
 * BEGIN/COMMIT. This lets a lib function that used to manage its own
 * transaction be called from inside withTenant without a nested-transaction
 * error, while its other (Pool) callers keep working unchanged.
 */
export async function runTx<T>(db: pg.Pool | pg.PoolClient, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  if ("release" in db) return fn(db as pg.PoolClient); // already a client in a caller txn
  const c = await (db as pg.Pool).connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    try {
      await c.query("rollback");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    c.release();
  }
}

let ownerPool: pg.Pool | null = null;

/**
 * The OWNER-role pool (RISK-1). A handful of paths legitimately cannot run as
 * the tenant-scoped app_rw role and must connect as the owner:
 *   - provisioning/bootstrap (first-owner creation, guest-org minting) — no
 *     caller-org exists yet;
 *   - member management + anything reading the `auth` schema (auth.users);
 *   - the research worker + inbound webhooks — intentionally cross-tenant/system.
 *
 * Until the cutover, DATABASE_URL_OWNER is unset and this returns the same pool
 * as getPool() — so it is INERT and safe to adopt now. At cutover, DATABASE_URL
 * points at app_rw for the tenant path while DATABASE_URL_OWNER carries the
 * owner role for exactly these operations.
 */
export function getOwnerPool(): pg.Pool {
  const ownerUrl = process.env.DATABASE_URL_OWNER;
  if (!ownerUrl) return getPool(); // inert: no separate owner URL yet
  if (!ownerPool) {
    const ssl = sslOption();
    ownerPool = new pg.Pool({
      connectionString: ownerUrl,
      ...(ssl ? { ssl } : {}),
      max: Number(process.env.PG_OWNER_POOL_MAX) > 0 ? Number(process.env.PG_OWNER_POOL_MAX) : 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      keepAlive: true,
    });
  }
  return ownerPool;
}
