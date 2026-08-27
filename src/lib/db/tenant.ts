import type { PoolClient } from "pg";
import { getPool } from "@/db/client";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";

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
 * Run `fn` inside a transaction whose session is pinned to the caller's org.
 * The GUC is set with set_config(..., is_local => true) so it lives only for
 * this transaction and cannot leak to the next checkout of the pooled client.
 * Fails closed: no resolvable org → no query runs.
 */
export async function withTenant<T>(
  fn: (db: PoolClient, orgId: string) => Promise<T>,
): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query("begin");
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
