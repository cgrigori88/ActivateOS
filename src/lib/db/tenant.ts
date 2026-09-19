import type { PoolClient } from "pg";
import { getPool } from "@/db/client";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { statementTimeoutOf, type ExecutionPolicy } from "./execution-policy";

/**
 * D-S14-EXECUTION-BOUND. Both helpers below already own a transaction, so neither needs the shared
 * `withStatementBound` primitive — they need one extra transaction-local setting. Applied right
 * after `app.org_id` and before the callback, so EVERY workload-bearing statement the callback
 * issues is bounded; `begin` and the two `set_config` calls are fixed control statements that
 * necessarily precede the bound existing.
 *
 * Omitting the policy leaves both helpers exactly as they were — no statement is added, and the
 * server default applies. That is what keeps every existing web call site unchanged.
 */
async function applyStatementBound(db: PoolClient, policy?: ExecutionPolicy): Promise<void> {
  const ms = statementTimeoutOf(policy);
  if (ms === null) return;
  await db.query(`select set_config('statement_timeout', $1, true)`, [String(ms)]);
}

/**
 * Per-request tenant scoping for the RISK-1 cutover (task #67).
 *
 * Today the app connects as the table owner, which bypasses RLS, so the
 * database provides no defense-in-depth: a query that forgets `where org_id`
 * is an immediate cross-tenant read. The fix is to run the app as the
 * non-owner role `app_rw` (created in 0058) and propagate the caller's org to
 * the DB session via the `app.org_id` GUC, which every RLS policy already
 * honors (0058's is_org_member).
 *
 * `withTenant` is that propagation. It is INERT while DATABASE_URL still points
 * at the owner (the GUC is set but the owner ignores RLS), so query sites can
 * adopt it incrementally with zero behavior change; the isolation switches on
 * only at the gated cutover when DATABASE_URL points at app_rw. See the runbook
 * in supabase/migrations/0058_rls_enforcement_foundation.sql.
 */

/**
 * Resolve the caller's org WITHOUT a tenant-scoped DB read — the piece that
 * makes app_rw viable. The uid comes from the verified Supabase session (web
 * layer), never the client; resolve_user_org() (0059) is SECURITY DEFINER so
 * it reads membership as the owner, breaking the "need the org to read the org"
 * cycle. Falls back to the sole org in Basic-Auth/demo mode, exactly like
 * currentOrgId().
 */
export async function sessionOrgId(db: PoolClient): Promise<string | null> {
  let uid: string | null = null;
  if (authConfigured()) {
    try {
      const supabase = await supabaseServer();
      uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    } catch {
      /* outside a request scope (worker/scripts) — fall through to sole org */
    }
  }
  const { rows } = await db.query<{ org: string | null }>(
    `select public.resolve_user_org($1) as org`,
    [uid],
  );
  return rows[0]?.org ?? null;
}

/**
 * Run `fn` inside a transaction pinned to an EXPLICIT org — for paths where the
 * org is already known and not derived from the web session: the MCP surface
 * (org comes from the API key) and the inbound-email webhook (org from the
 * thread). The GUC is set is_local so it cannot leak to the next checkout.
 */
export async function withTenantOrg<T>(
  orgId: string,
  fn: (db: PoolClient) => Promise<T>,
  policy?: ExecutionPolicy,
): Promise<T> {
  if (!orgId) throw new Error("withTenantOrg requires an org id.");
  const db = await getPool().connect();
  try {
    await db.query("begin");
    await db.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    await applyStatementBound(db, policy);
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
    db.release();
  }
}

/**
 * Run `fn` inside a transaction whose session is pinned to the caller's org
 * (resolved from the authenticated web session). The GUC is set with
 * set_config(..., is_local => true) so it lives only for this transaction and
 * cannot leak to the next checkout of the pooled client. Fails closed: no
 * resolvable org → no query runs.
 */
export async function withTenant<T>(
  fn: (db: PoolClient, orgId: string) => Promise<T>,
  policy?: ExecutionPolicy,
): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query("begin");
    // The bound goes FIRST here, unlike withTenantOrg. This helper resolves the org with a real
    // query of its own (`resolve_user_org`), which is workload-bearing and would otherwise run
    // before any bound existed — so the setting is established before the first such statement
    // rather than after `app.org_id`.
    await applyStatementBound(db, policy);
    const orgId = await sessionOrgId(db);
    if (!orgId) {
      throw new Error("No organization in scope — refusing to run a tenant query unscoped.");
    }
    // set_config with a bind param (SET LOCAL cannot be parameterized); is_local
    // = true scopes it to this transaction.
    await db.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    const result = await fn(db, orgId);
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
    db.release();
  }
}
