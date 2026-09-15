import type pg from "pg";

/**
 * Live runtime database posture (H1B Gate 6 proof).
 *
 * THE QUESTION IT ANSWERS. "Is this running process bound by row-level security?" — asked of the
 * process itself, not of anyone's memory. The H1B cutover moves the web runtime from the table owner
 * (which bypasses RLS, so every policy is inert) to `app_rw` (which RLS binds). Gate 6 passes only when
 * the deployed process reports `role = app_rw`, `bypassRls = false`, `tenantEnforcement = true`.
 *
 * WHAT IT READS. One catalogue row about the CURRENT role — its name and its superuser / bypass-RLS
 * attributes — plus the `row_security` setting. No tenant data, no grant or policy detail, no
 * credential. It runs on the RUNTIME pool (`getPool()`), because that is the connection whose posture
 * matters; the owner pool is deliberately not probed.
 *
 * FAILURE. It never throws and never hangs the caller: a probe that cannot complete within the
 * timeout reports `status: "unavailable"`, because the surface it serves exists to diagnose a
 * deployment whose database may be the broken thing.
 */

export interface PostureRow { role: string; rolsuper: boolean; rolbypassrls: boolean; row_security: string }

export type DatabasePosture =
  | { status: "live"; role: string; superuser: boolean; bypassRls: boolean; tenantEnforcement: boolean }
  | { status: "unavailable" };

/**
 * RLS binds a role only if it is neither a superuser nor BYPASSRLS and the session has not turned
 * `row_security` off (with it off, a query that would be filtered errors instead — still no leak, but
 * not the enforcing posture Gate 6 certifies).
 */
export function derivePosture(row: PostureRow): Extract<DatabasePosture, { status: "live" }> {
  const tenantEnforcement = !row.rolsuper && !row.rolbypassrls && row.row_security === "on";
  return { status: "live", role: row.role, superuser: row.rolsuper, bypassRls: row.rolbypassrls, tenantEnforcement };
}

export const POSTURE_SQL = `select current_user as role, r.rolsuper, r.rolbypassrls, current_setting('row_security') as row_security
                              from pg_roles r where r.rolname = current_user`;

export async function probeDatabasePosture(db: Pick<pg.Pool, "query">, timeoutMs = 2000): Promise<DatabasePosture> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DatabasePosture>((resolve) => { timer = setTimeout(() => resolve({ status: "unavailable" }), timeoutMs); });
  const probe = db.query<PostureRow>(POSTURE_SQL)
    .then((r): DatabasePosture => (r.rows[0] ? derivePosture(r.rows[0]) : { status: "unavailable" }))
    .catch((): DatabasePosture => ({ status: "unavailable" }));
  try { return await Promise.race([probe, timeout]); } finally { if (timer) clearTimeout(timer); }
}
