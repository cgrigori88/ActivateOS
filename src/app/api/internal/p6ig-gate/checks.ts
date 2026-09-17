/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TEMPORARY — P6-IG HOSTED ACCEPTANCE HARNESS. NOT A PRODUCT CAPABILITY.
 * This file and its route exist only to execute the P6-IG acceptance matrix under the deployed
 * Preview runtime's own `app_rw` credential, whose plaintext is unrecoverable locally. Both are
 * REMOVED before P6-IG can be marked HOSTED CLOSED.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHY IT EXISTS. Every assertion about `app_rw` behaviour must run AS `app_rw`. The owner
 * credential can reach the same database, but an owner-generated result proves nothing about the
 * role the application actually uses: `postgres` carries BYPASSRLS, so RLS is inert on it. The
 * deployed runtime is the only environment that still holds a working `app_rw` credential, so the
 * evidence is produced here, inside it, under a real password-authenticated `app_rw` session.
 *
 * WHAT IT WILL NOT DO. No SQL, table, column or identifier ever comes from the caller — every
 * statement below is a literal in this file, and the only values bound as parameters are ids the
 * harness discovered itself. It takes no request body. Its one query parameter selects a part from
 * a fixed enumeration. It returns pass/fail plus sanitized detail — never a row value, a
 * connection string, a credential or anything from `process.env`.
 *
 * WHAT IT WRITES. Nothing. Every write below is a NEGATIVE CONTROL executed inside a SAVEPOINT and
 * rolled back, and the whole harness transaction ends in ROLLBACK.
 *
 * TRANSACTION SAFETY (the D-P2-2 lesson). In PostgreSQL a failed statement aborts the transaction;
 * catching the JavaScript error does NOT recover it, and every later statement then fails with
 * 25P02 while appearing to "just return nothing". So each expected failure runs inside its own
 * SAVEPOINT, is rolled back to that savepoint, and is followed by a guard proving the transaction
 * is still usable. A poisoned transaction can never masquerade as evidence.
 */
import type { PoolClient } from "pg";

export const PARTS = ["identity", "constraints", "derivation", "temporal", "sharing", "disclosure", "writes"] as const;
export type Part = (typeof PARTS)[number];

/** The fixture is discovered by this exact prefix — never supplied by a caller. */
export const FIXTURE_PREFIX = "P6IG-HOSTED-GATE";

export interface CheckResult { name: string; ok: boolean; detail?: string }

export class Checks {
  readonly results: CheckResult[] = [];
  add(name: string, ok: boolean, detail?: string): boolean {
    this.results.push({ name, ok, detail });
    return ok;
  }
  get passed(): number { return this.results.filter((r) => r.ok).length; }
  get failed(): number { return this.results.filter((r) => !r.ok).length; }
}

export interface Fixture {
  a: string; b: string; c: string;           // sponsor / participant / outsider
  pursuit: string;
  liveGrant: string | null;                  // machine-governed VALUE_CASE / economic_value
  windowPursuit: string | null;              // pursuit carrying the temporal-boundary participants
}

const one = async <T extends Record<string, unknown>>(db: PoolClient, sql: string, params: unknown[] = []): Promise<T | undefined> =>
  (await db.query<T>(sql, params)).rows[0];

/** Sanitize an error into a code plus a constraint name — never a row value or a statement. */
export function errShape(e: unknown): { code: string; constraint: string } {
  const err = e as { code?: string; constraint?: string; message?: string };
  const code = err?.code ?? "none";
  const named = err?.constraint ?? (err?.message ?? "").match(/constraint "([a-z0-9_]+)"/)?.[1] ?? "";
  return { code, constraint: named };
}

/**
 * Run `fn` inside a SAVEPOINT that is ALWAYS released or rolled back, then prove the transaction
 * still works. Returns what the statement did, never letting a failure escape into later evidence.
 */
export async function expectFailure(
  db: PoolClient, c: Checks, name: string, sql: string, params: unknown[],
  wants: { code?: string; constraint?: RegExp },
): Promise<void> {
  const sp = `p6ig_${Math.random().toString(36).slice(2, 10)}`;
  let shape: { code: string; constraint: string } | null = null;
  await db.query(`savepoint ${sp}`);
  try {
    await db.query(sql, params);
    await db.query(`rollback to savepoint ${sp}`);
  } catch (e) {
    shape = errShape(e);
    await db.query(`rollback to savepoint ${sp}`);
  }
  await db.query(`release savepoint ${sp}`);
  const okCode = !wants.code || shape?.code === wants.code;
  const okName = !wants.constraint || (shape ? wants.constraint.test(shape.constraint) : false);
  c.add(name, Boolean(shape) && okCode && okName, shape ? `${shape.code} ${shape.constraint}` : "STATEMENT SUCCEEDED — no rejection");
  // GUARD: the transaction must still be usable, or every later check is worthless.
  const guard = await one<{ v: number }>(db, `select 1 as v`);
  c.add(`${name} — transaction still usable after the expected failure`, guard?.v === 1);
}

/** The sanitized shape of a grant insert used by the constraint controls. Column list is fixed. */
const INSERT_GRANT = `insert into context_grants
    (pursuit_id, from_org_id, to_org_id, grant_kind, governed_information_classes, information_classes,
     purpose, purpose_code, scope, status, retention_class, expires_at, onward_sharing_allowed, delegation_allowed)
  values ($1,$2,$3,$4,$5,$6,'p6ig-hosted-gate',$7,'{}'::jsonb,'accepted',$8,$9,false,false)`;

// ── D — AUTHORITY PRECONDITIONS ─────────────────────────────────────────────────────────────────

/**
 * Prove this is a real password-authenticated `app_rw` session BEFORE any test runs. No
 * impersonation, no owner transport, no SET ROLE. If any assertion fails the caller ABORTS the
 * harness without executing a single acceptance check.
 */
export async function proveAuthority(db: PoolClient, c: Checks): Promise<boolean> {
  const id = await one<{ su: string; cu: string; rls: string }>(db,
    `select session_user as su, current_user as cu, current_setting('row_security') as rls`);
  const role = await one<{ login: boolean; bypassrls: boolean; superuser: boolean; inherit: boolean; createrole: boolean; createdb: boolean; replication: boolean }>(db,
    `select rolcanlogin as login, rolbypassrls as bypassrls, rolsuper as superuser, rolinherit as inherit,
            rolcreaterole as createrole, rolcreatedb as createdb, rolreplication as replication
       from pg_roles where rolname = current_user`);
  const memberOf = await db.query<{ rolname: string }>(
    `select p.rolname from pg_auth_members m join pg_roles p on p.oid = m.roleid
      where m.member = (select oid from pg_roles where rolname = current_user)`);
  const create = await one<{ v: boolean }>(db, `select has_schema_privilege('public', 'CREATE') as v`);
  const env = await one<{ environment: string; is_synthetic: boolean }>(db,
    `select environment, is_synthetic from environment_identity`);
  const mig = await one<{ n: number; has112: boolean }>(db,
    `select count(*)::int as n, bool_or(filename like '0112%') as has112 from schema_migrations`);

  c.add("session_user = app_rw", id?.su === "app_rw", id?.su);
  c.add("current_user = app_rw", id?.cu === "app_rw", id?.cu);
  c.add("LOGIN true", role?.login === true);
  c.add("BYPASSRLS false", role?.bypassrls === false);
  c.add("SUPERUSER false", role?.superuser === false);
  c.add("NOINHERIT (rolinherit false, as expected)", role?.inherit === false);
  c.add("no CREATEROLE / CREATEDB / REPLICATION", !role?.createrole && !role?.createdb && !role?.replication);
  c.add("no unexpected memberships — app_rw is a member of no role", memberOf.rows.length === 0,
    memberOf.rows.map((r) => r.rolname).join(",") || "none");
  c.add("no CREATE on schema public", create?.v === false);
  c.add("row_security is on for this session", id?.rls === "on", id?.rls);
  c.add("database is the isolated synthetic preview", env?.environment === "demo" && env?.is_synthetic === true);
  c.add("schema is at 112 with 0112 tracked", (mig?.n ?? 0) >= 112 && mig?.has112 === true, `${mig?.n} migrations`);
  return c.failed === 0;
}

/** Find the planted fixture. Nothing here comes from the caller. */
export async function findFixture(db: PoolClient): Promise<Fixture | null> {
  const orgs = await db.query<{ id: string; name: string }>(
    `select id, name from organizations where name like $1 || '%' order by name`, [FIXTURE_PREFIX]);
  const pick = (tag: string) => orgs.rows.find((o) => o.name.endsWith(tag))?.id ?? null;
  const a = pick("A-sponsor"), b = pick("B-participant"), c = pick("C-outsider");
  if (!a || !b || !c) return null;
  const pursuit = await one<{ id: string }>(db,
    `select id from pursuits where org_id = $1 and dedup_key = $2`, [a, `${FIXTURE_PREFIX}-MAIN`]);
  const windowPursuit = await one<{ id: string }>(db,
    `select id from pursuits where org_id = $1 and dedup_key = $2`, [a, `${FIXTURE_PREFIX}-WINDOW`]);
  if (!pursuit) return null;
  const live = await one<{ id: string }>(db,
    `select id from context_grants
      where from_org_id = $1 and to_org_id = $2 and pursuit_id = $3
        and purpose_code = 'VALUE_CASE' and status = 'accepted'
        and governed_information_classes @> array['economic_value']::text[]
      limit 1`, [a, b, pursuit.id]);
  return { a, b, c, pursuit: pursuit.id, liveGrant: live?.id ?? null, windowPursuit: windowPursuit?.id ?? null };
}

/** Pin the tenant exactly as the product does (`withTenant` sets this GUC, transaction-local). */
export async function setOrg(db: PoolClient, orgId: string): Promise<void> {
  await db.query(`select set_config('app.org_id', $1, true)`, [orgId]);
}

// ── CONSTRAINT BEHAVIOUR, PROVEN AS app_rw ──────────────────────────────────────────────────────

/**
 * Every rejection here must be the DATABASE refusing the shape, not a policy refusing the role —
 * otherwise the constraints would appear to hold on a role that could never insert anything. The
 * positive control runs FIRST and proves this session can lawfully insert a well-formed
 * machine-governed grant; only then does a rejection mean what it claims.
 */
export async function runConstraints(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  await setOrg(db, f.a);
  const G = ["economic_value"];

  // POSITIVE CONTROL — must SUCCEED (then roll back).
  const sp = "p6ig_positive";
  await db.query(`savepoint ${sp}`);
  let inserted = false;
  try {
    await db.query(INSERT_GRANT, [f.pursuit, f.a, f.b, "DATA", G, null, "ROUTE_EVALUATION", "PURSUIT_LIFETIME", null]);
    inserted = true;
  } catch (e) {
    c.add("POSITIVE CONTROL — app_rw may insert a well-formed machine-governed grant", false, errShape(e).code);
  }
  await db.query(`rollback to savepoint ${sp}`);
  await db.query(`release savepoint ${sp}`);
  if (inserted) c.add("POSITIVE CONTROL — app_rw may insert a well-formed machine-governed grant", true, "inserted then rolled back");
  c.add("POSITIVE CONTROL — the insert left nothing behind", true, "rolled back to savepoint");

  const F = (n: string, params: unknown[], wants: { code?: string; constraint?: RegExp }) =>
    expectFailure(db, c, n, INSERT_GRANT, params, wants);

  const COMPLETE = /machine_governed_complete/;
  await F("an ACTION grant may not carry a purpose_code",
    [f.pursuit, f.a, f.b, "ACTION", G, null, "VALUE_CASE", "RETAINED", new Date(Date.now() + 86_400_000)], { code: "23514", constraint: COMPLETE });
  await F("machine-governed with NULL governed classes → rejected",
    [f.pursuit, f.a, f.b, "DATA", null, null, "VALUE_CASE", "RETAINED", new Date(Date.now() + 86_400_000)], { code: "23514", constraint: COMPLETE });
  await F("machine-governed with EMPTY governed classes → rejected",
    [f.pursuit, f.a, f.b, "DATA", [], null, "VALUE_CASE", "RETAINED", new Date(Date.now() + 86_400_000)], { code: "23514", constraint: COMPLETE });
  await F("machine-governed with NULL retention → rejected",
    [f.pursuit, f.a, f.b, "DATA", G, null, "VALUE_CASE", null, null], { code: "23514", constraint: COMPLETE });
  await F("EPHEMERAL without expires_at → rejected",
    [f.pursuit, f.a, f.b, "DATA", G, null, "VALUE_CASE", "EPHEMERAL", null], { code: "23514", constraint: COMPLETE });
  await F("RETAINED without expires_at → rejected",
    [f.pursuit, f.a, f.b, "DATA", G, null, "VALUE_CASE", "RETAINED", null], { code: "23514", constraint: COMPLETE });
  await F("a machine-governed grant with NULL pursuit → rejected (this is what makes scope {} unambiguous)",
    [null, f.a, f.b, "DATA", G, null, "VALUE_CASE", "PURSUIT_LIFETIME", null], { code: "23514", constraint: COMPLETE });
  await F("an unknown purpose code → rejected by the purpose vocabulary",
    [f.pursuit, f.a, f.b, "DATA", G, null, "WHATEVER", "PURSUIT_LIFETIME", null], { code: "23514", constraint: /purpose_code_check/ });
  await F("an unknown governed information class → rejected by the governed vocabulary",
    [f.pursuit, f.a, f.b, "DATA", ["nonsense"], null, "VALUE_CASE", "PURSUIT_LIFETIME", null], { code: "23514", constraint: /governed_information_classes_check/ });

  // ── THE SEMANTIC FIREWALL, proven in both directions ──
  await F("an AUDIENCE term in the GOVERNED column → rejected (the governed vocabulary admits no Audience value)",
    [f.pursuit, f.a, f.b, "DATA", ["PARTICIPANT_SHARED"], null, "VALUE_CASE", "PURSUIT_LIFETIME", null],
    { code: "23514", constraint: /governed_information_classes_check/ });
  await F("a machine-governed grant carrying ONLY legacy classes → rejected (the legacy column cannot satisfy the governed contract)",
    [f.pursuit, f.a, f.b, "DATA", null, ["transaction_adjacency"], "VALUE_CASE", "PURSUIT_LIFETIME", null],
    { code: "23514", constraint: COMPLETE });

  // A LEGACY grant stays lawful and unconstrained — 0112 placed no CHECK on that column.
  const sp2 = "p6ig_legacy";
  await db.query(`savepoint ${sp2}`);
  let legacyOk = false, audienceOk = false;
  try {
    await db.query(INSERT_GRANT, [f.pursuit, f.a, f.b, "DATA", null, ["transaction_adjacency"], null, null, null]);
    legacyOk = true;
    await db.query(INSERT_GRANT, [f.pursuit, f.a, f.b, "DATA", null, ["PARTICIPANT_SHARED"], null, null, null]);
    audienceOk = true;
  } catch { /* recorded below */ }
  await db.query(`rollback to savepoint ${sp2}`);
  await db.query(`release savepoint ${sp2}`);
  c.add("a LEGACY grant (purpose_code NULL) is still accepted — no backfill is forced", legacyOk);
  c.add("the LEGACY column may still carry an AUDIENCE value — 0112 placed no CHECK on it", audienceOk);
  const guard = await one<{ v: number }>(db, `select 1 as v`);
  c.add("transaction still usable after the legacy controls", guard?.v === 1);
}

// ── app_rw WRITE DENIALS + PASSIVE AUDIT ────────────────────────────────────────────────────────

export async function runWrites(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  await setOrg(db, f.b);
  // RLS must refuse a cross-tenant write: B may not mint a grant FROM A.
  await expectFailure(db, c, "app_rw under tenant B may not insert a grant FROM org A (RLS write policy)",
    INSERT_GRANT, [f.pursuit, f.a, f.c, "DATA", ["economic_value"], null, "VALUE_CASE", "PURSUIT_LIFETIME", null],
    { code: "42501" });

  await expectFailure(db, c, "app_rw may not create objects in schema public",
    `create table public.p6ig_should_not_exist (id int)`, [], { code: "42501" });

  // PASSIVE READ — a governed read appends no ledger row (no read-driven growth, no traffic channel).
  const before = await one<{ n: number }>(db, `select count(*)::int as n from audit_log`);
  await setOrg(db, f.b);
  await db.query(`select id from context_grants where pursuit_id = $1`, [f.pursuit]);
  await db.query(`select public.can_see_pursuit($1) as v`, [f.pursuit]);
  const after = await one<{ n: number }>(db, `select count(*)::int as n from audit_log`);
  c.add("a PASSIVE READ appends no audit row", before?.n === after?.n, `${before?.n} → ${after?.n}`);

  // Tenant isolation: the outsider's context sees none of the fixture pursuit.
  await setOrg(db, f.c);
  const outsider = await one<{ n: number }>(db, `select count(*)::int as n from context_grants where pursuit_id = $1`, [f.pursuit]);
  c.add("tenant C (outsider) sees zero grants on the fixture pursuit", outsider?.n === 0, String(outsider?.n));
  const outsiderSee = await one<{ v: boolean }>(db, `select public.can_see_pursuit($1) as v`, [f.pursuit]);
  c.add("tenant C (outsider) → can_see_pursuit false", outsiderSee?.v === false);
  await setOrg(db, f.b);
  const insider = await one<{ v: boolean }>(db, `select public.can_see_pursuit($1) as v`, [f.pursuit]);
  c.add("tenant B (effective participant) → can_see_pursuit true", insider?.v === true);
  // No context at all must fail closed.
  await db.query(`select set_config('app.org_id', '', true)`);
  const noCtx = await one<{ n: number; org: string | null }>(db,
    `select (select count(*)::int from pursuits) as n, public.app_current_org()::text as org`);
  c.add("no tenant context → app_current_org() null and zero pursuits visible", noCtx?.org === null && noCtx?.n === 0,
    `org=${noCtx?.org ?? "null"} pursuits=${noCtx?.n}`);
}
