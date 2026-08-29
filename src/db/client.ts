import { readFileSync } from "node:fs";
import tls from "node:tls";
import pg from "pg";

let pool: pg.Pool | null = null;

/**
 * Supabase Root 2021 CA — the PRIVATE root that signs both the direct-DB cert
 * (db.<ref>.supabase.co) AND the pooler chain (*.pooler.supabase.com ←
 * Supabase Intermediate 2021 CA ← this root). It is NOT in the system trust
 * store, so verifying a Supabase connection REQUIRES trusting it explicitly.
 *
 * It is embedded here (not read from an env var) on purpose: passing a multi-
 * line PEM through a hosting provider's env store repeatedly mangled the
 * newlines, which silently disabled verification (SELF_SIGNED_CERT_IN_CHAIN) and
 * caused a prod outage. This is a public CA cert, stable until 2031-04-26 —
 * baking it in makes verify-full immune to env formatting. Verify at:
 *   node -e 'require("tls")' ... (chain printed in the RISK-3 notes)
 */
const SUPABASE_ROOT_2021_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

/**
 * TLS policy for the DB link (RISK-3). Supabase's template ships
 * `sslmode=no-verify` — encrypted but UNAUTHENTICATED, so a MITM can impersonate
 * the database. Setting DATABASE_CA_CERT (any non-empty value) or DATABASE_CA_PATH
 * flips on real verification: rejectUnauthorized against a trust set of the
 * system roots PLUS the embedded Supabase root PLUS any extra CA supplied. With
 * neither env var set, behavior is unchanged (the connection string decides), so
 * local dev against a plain Postgres is unaffected.
 *
 * The embedded Supabase root is what actually validates prod (the env var only
 * acts as the on-switch), so verification cannot be silently broken by a mangled
 * PEM in the hosting env store — the failure mode that caused a prod outage.
 */
function sslOption(): pg.PoolConfig["ssl"] {
  const inline = process.env.DATABASE_CA_CERT?.trim();
  const path = process.env.DATABASE_CA_PATH?.trim();
  if (!inline && !path) return undefined; // no CA configured → connection string decides (local dev)
  const cas: string[] = [...tls.rootCertificates, SUPABASE_ROOT_2021_CA];
  // Honor an explicitly supplied CA too, but only if it actually parses — a
  // mangled env value must never weaken the trust set, just be ignored.
  const extra = inline ? inline.replace(/\\n/g, "\n") : path ? readFileSync(path, "utf8") : null;
  if (extra && extra.includes("BEGIN CERTIFICATE")) cas.push(extra);
  return { ca: cas, rejectUnauthorized: true };
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
