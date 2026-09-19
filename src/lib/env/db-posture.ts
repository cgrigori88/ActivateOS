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

/**
 * P7 Slice 13 — THE CANONICAL EXECUTION SUBSTRATE.
 *
 * > **The trusted execution boundary establishes both the `ExecutionPrincipal` and the governed
 * > application database substrate. A caller may choose neither.**
 *
 * WHY AN ASSERT AND NOT ANOTHER PROBE. `probeDatabasePosture` above is OBSERVABILITY: it never
 * throws, because the surface it serves exists to diagnose a deployment whose database may be the
 * broken thing. That is right for `/api/build` and wrong for execution. D-S13-EXEC-CONTEXT showed
 * why: the same certified request and the same branded `ExecutionPrincipal`, against the same world,
 * returned **12 governed rows under the owner and 11 under `app_rw`** — the app_rw membership a
 * strict subset. An identity object alone does not determine governed semantics; the substrate is
 * part of the answer, and nothing was stopping a differently-configured process from supplying a
 * different one.
 *
 * WHY THE ROLE NAME AND NOT JUST THE BYPASS BIT. `rolbypassrls = false` is necessary and not
 * sufficient. A non-BYPASSRLS role that is not the application role may still hold different grants,
 * and a table's OWNER is exempt from its own policies unless FORCE is set — so "does not bypass RLS"
 * is a weaker claim than "is the certified application role". The canonical role is already part of
 * the deployed architecture; changing it is a governance decision, not an adapter's.
 */
export const CANONICAL_APP_ROLE = "app_rw";

/** An internal configuration failure. Never a governed outcome, and never recipient-facing. */
export class IllegalExecutionSubstrate extends Error {
  constructor(detail: string) { super(`illegal P7 execution substrate — ${detail}`); this.name = "IllegalExecutionSubstrate"; }
}

/**
 * Certified pools, keyed by POOL IDENTITY rather than by a process-global flag.
 *
 * A bare `substrateChecked = true` would let one legal pool bless every later one — including a pool
 * a test or a reconfiguration replaced afterwards. A WeakSet answers "has THIS pool been certified",
 * so a new pool is a new question and the entry disappears with the pool it describes.
 */
const certifiedPools = new WeakSet<object>();

/**
 * Refuse execution unless this exact pool is the certified application substrate.
 *
 * Throws `IllegalExecutionSubstrate`. The message names the observed posture because it is INTERNAL
 * diagnostic material — the canonical boundary converts it into a recipient-safe failure, and no
 * role name, connection string or membership detail reaches a recipient.
 */
export async function assertCanonicalSubstrate(pool: Pick<pg.Pool, "query">): Promise<void> {
  if (certifiedPools.has(pool as object)) return;
  let row: PostureRow | undefined;
  try { row = (await pool.query<PostureRow>(POSTURE_SQL)).rows[0]; }
  catch (e) { throw new IllegalExecutionSubstrate(`posture could not be established: ${(e as Error).message}`); }
  if (!row) throw new IllegalExecutionSubstrate("posture could not be established: no catalogue row");
  const p = derivePosture(row);
  if (p.role !== CANONICAL_APP_ROLE || p.bypassRls || p.superuser || !p.tenantEnforcement) {
    throw new IllegalExecutionSubstrate(
      `expected ${CANONICAL_APP_ROLE} with row-level security binding, got role=${p.role} superuser=${p.superuser} bypassRls=${p.bypassRls} tenantEnforcement=${p.tenantEnforcement}`);
  }
  certifiedPools.add(pool as object);
}
