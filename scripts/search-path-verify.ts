import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";

/**
 * Temporary-schema shadowing — exploit battery + durable catalogue guard (H1B-0.1, D-050).
 *
 * THE CLASS. PostgreSQL searches the session's temporary schema FIRST for relations and types unless
 * `pg_temp` is named in `search_path`. A caller who can create a temp table named like a real one could
 * therefore change what a SECURITY DEFINER function, an RLS helper or a guard trigger reads. PUBLIC holds
 * TEMPORARY, so app_rw can. Migration 0105 pins `pg_catalog, public, pg_temp` on every function in the
 * protected class.
 *
 * WHAT THIS PROVES, on a disposable seeded clone, as the REAL app_rw login:
 *   A  NEGATIVE CONTROL — 0105's own documented ROLLBACK lines are executed: the catalogue guard must
 *      flag the vulnerable posture, and EVERY exploit below must succeed. (If a test cannot detect the
 *      vulnerable posture it proves nothing, so an undetected exploit fails the suite.)
 *   B  FORWARD — 0105 is applied: the guard must find zero violations and EVERY exploit must fail.
 *   C  The guard catches a reintroduction (rolled-back self-test).
 *   D  Its assumptions hold: nobody runtime can CREATE in public; the SECURITY DEFINER EXECUTE posture.
 *
 *   npx tsx scripts/verify-run.ts --suite search-path
 *   DATABASE_URL_VERIFY=… npx tsx scripts/search-path-verify.ts --catalogue-only   (read-only; hosted-safe)
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo"; // local-only login, set by scripts/demo-db.ts
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 2 });
const rw = new Pool({ connectionString: rwUrl, max: 1 });

const MIGRATION = readFileSync(join(process.cwd(), "supabase", "migrations", "0105_h1b01_temp_schema_hardening.sql"), "utf8");
const FORWARD = MIGRATION;
const ROLLBACK = MIGRATION.split("\n").filter((l) => l.startsWith("-- ROLLBACK: ")).map((l) => l.slice("-- ROLLBACK: ".length)).join("\n");

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── the durable catalogue guard ───────────────────────────────────────────────────────────────────

export const TRUSTED_APP_SCHEMAS = ["public"];

/** The protected class, derived from the catalogue (so a future function is covered automatically). */
const PROTECTED_SQL = `
  with prot as (
    select p.oid from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace and l.lanname in ('plpgsql', 'sql') and p.prosecdef
    union
    select d.refobjid from pg_depend d
     where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
    union
    select t.tgfoid from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal)
  select p.oid::regprocedure::text sig, p.prosecdef definer, pg_get_userbyid(p.proowner) owner,
         (select substr(c, length('search_path=') + 1) from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') sp
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid in (select oid from prot) and p.pronamespace = 'public'::regnamespace and l.lanname in ('plpgsql', 'sql')
   order by 1`;

/** A search_path is safe iff pg_catalog is first, pg_temp is explicitly last, and only trusted schemas sit between. */
export function unsafeSearchPath(sp: string | null): string | null {
  if (!sp) return "no search_path pinned (the caller's path applies, pg_temp first)";
  const parts = sp.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  if (parts[0] !== "pg_catalog") return `pg_catalog is not first (${sp})`;
  if (parts.at(-1) !== "pg_temp") return `pg_temp is not explicitly last (${sp})`;
  const middle = parts.slice(1, -1).filter((s) => !TRUSTED_APP_SCHEMAS.includes(s));
  if (middle.length) return `untrusted schema in path: ${middle.join(", ")}`;
  return null;
}

async function guard(db: Pool | PoolClient): Promise<{ total: number; violations: string[]; owners: string[] }> {
  const rows = (await db.query<{ sig: string; definer: boolean; owner: string; sp: string | null }>(PROTECTED_SQL)).rows;
  const violations = rows.map((r) => { const why = unsafeSearchPath(r.sp); return why ? `${r.sig}: ${why}` : null; }).filter((x): x is string => !!x);
  return { total: rows.length, violations, owners: [...new Set(rows.map((r) => r.owner))] };
}

// ── the exploit battery (real app_rw login) ───────────────────────────────────────────────────────

interface Fixture { V: string; M: string; P1: string; JP: string; Vpursuit: string; grant: string; company: string }
type Outcome = { name: string; exploited: boolean; detail: string };

async function battery(fx: Fixture): Promise<Outcome[]> {
  const c = await rw.connect();
  const out: Outcome[] = [];
  let sp = 0;
  const run = async (name: string, org: string, fn: (q: (sql: string, p?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<{ exploited: boolean; detail: string }>) => {
    const s = `t${++sp}`;
    await c.query(`savepoint ${s}`);
    try {
      await c.query(`select set_config('app.org_id', $1, true)`, [org]);
      const r = await fn(async (sql, p = []) => (await c.query(sql, p)).rows);
      out.push({ name, ...r });
    } catch (e) {
      out.push({ name, exploited: false, detail: `threw: ${(e as Error).message.split("\n")[0].slice(0, 90)}` });
    } finally { await c.query(`rollback to savepoint ${s}`).catch(() => {}); }
  };
  // Attempts that must RAISE when hardened: exploited = the forged write/call went through.
  const goesThrough = async (q: (sql: string, p?: unknown[]) => Promise<unknown>, sql: string, p: unknown[] = []) => {
    await c.query("savepoint inner_try");
    try { await q(sql, p); await c.query("release savepoint inner_try"); return true; }
    catch { await c.query("rollback to savepoint inner_try"); return false; }
  };
  const SHADOW_PARTNERSHIPS = `create temp table partnerships (id uuid, initiator_org_id uuid, counterpart_org_id uuid, status text,
      initiator_partner_id uuid, counterpart_partner_id uuid, invite_code text, activated_at timestamptz, revoked_at timestamptz, created_at timestamptz)`;
  try {
    await c.query("begin");
    const who = (await c.query<{ u: string }>(`select current_user u`)).rows[0].u;
    if (who !== "app_rw") throw new Error(`battery must run as app_rw, got ${who}`);

    await run("settlement: a non-party's temp `partnerships` reads another org's settlement rows", fx.M, async (q) => {
      await q(SHADOW_PARTNERSHIPS);
      await q(`insert into partnerships (id, initiator_org_id, counterpart_org_id, status) values ($1, $2, $3, 'active')`, [fx.P1, fx.M, fx.V]);
      const n = Number((await q(`select count(*)::int n from partnership_settlement_rows($1)`, [fx.P1]))[0].n);
      return { exploited: n > 0, detail: `${n} settlement rows` };
    });
    await run("joint room: a non-party's temp `partnerships` writes a broker line into another partnership", fx.M, async (q) => {
      await q(SHADOW_PARTNERSHIPS);
      await q(`insert into partnerships (id, initiator_org_id, counterpart_org_id, status) values ($1, $2, $3, 'active')`, [fx.P1, fx.M, fx.V]);
      const through = await goesThrough(q, `select record_broker_event($1, 'h1b01 shadow test', '{}'::jsonb)`, [fx.JP]);
      return { exploited: through, detail: through ? "write allowed" : "refused" };
    });
    await run("consent RLS: a temp `partnerships` lets a non-party inject a list grant into another partnership", fx.M, async (q) => {
      const [{ id: pop }] = await q(`insert into account_populations (org_id, name, category, status, created_by) values ($1, 'h1b01 shadow list', 'target', 'approved', 'h1b01') returning id`, [fx.M]) as { id: string }[];
      await q(SHADOW_PARTNERSHIPS);
      await q(`insert into partnerships (id, initiator_org_id, counterpart_org_id, status) values ($1, $2, $3, 'active')`, [fx.P1, fx.M, fx.V]);
      const through = await goesThrough(q, `insert into list_grants (partnership_id, from_org_id, population_id) values ($1, $2, $3)`, [fx.P1, fx.M, pop]);
      return { exploited: through, detail: through ? "grant row written into the V↔T partnership" : "refused by RLS" };
    });
    const U = randomUUID();
    const SHADOW_MEMBERS = `create temp table org_members (org_id uuid, user_id uuid, role text, created_at timestamptz default now())`;
    await run("membership: a temp `org_members` + a chosen JWT subject makes is_org_member() admit another org (RLS)", fx.M, async (q) => {
      await q(`select set_config('request.jwt.claim.sub', $1, true)`, [U]);
      await q(SHADOW_MEMBERS);
      await q(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [fx.V, U]);
      const n = Number((await q(`select count(*)::int n from pursuits where org_id = $1`, [fx.V]))[0].n);
      return { exploited: n > 0, detail: `${n} of the other org's pursuits visible` };
    });
    await run("org_role(): a temp `org_members` grants 'owner' of another org", fx.M, async (q) => {
      await q(`select set_config('request.jwt.claim.sub', $1, true)`, [U]);
      await q(SHADOW_MEMBERS);
      await q(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [fx.V, U]);
      const role = (await q(`select org_role($1) r`, [fx.V]))[0].r;
      return { exploited: role === "owner", detail: `org_role = ${role}` };
    });
    await run("resolve_user_org(): a temp `org_members` resolves a user into another org", fx.M, async (q) => {
      await q(SHADOW_MEMBERS);
      await q(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [fx.V, U]);
      const org = (await q(`select resolve_user_org($1) o`, [U]))[0].o;
      return { exploited: org === fx.V, detail: `resolved to ${org === fx.V ? "the other org" : String(org)}` };
    });
    await run("can_see_pursuit(): a temp `pursuits` makes another org's pursuit visible", fx.M, async (q) => {
      await q(`create temp table pursuits (id uuid, org_id uuid)`);
      await q(`insert into pursuits (id, org_id) values ($1, $2)`, [fx.Vpursuit, fx.M]);
      const v = (await q(`select can_see_pursuit($1) v`, [fx.Vpursuit]))[0].v;
      return { exploited: v === true, detail: `can_see_pursuit = ${v}` };
    });
    await run("grant_is_live(): a temp `context_grants` flips a real grant's liveness", fx.M, async (q) => {
      const before = (await q(`select grant_is_live($1) v`, [fx.grant]))[0].v;
      await q(`create temp table context_grants (id uuid, status text, expires_at timestamptz)`);
      await q(`insert into context_grants (id, status, expires_at) values ($1, $2, null)`, [fx.grant, before ? "revoked" : "accepted"]);
      const after = (await q(`select grant_is_live($1) v`, [fx.grant]))[0].v;
      return { exploited: after !== before, detail: `live ${before} → ${after}` };
    });
    await run("resolve_api_key(): a temp `api_keys` resolves a forged key into another org", fx.M, async (q) => {
      // The shadow table must mirror EVERY column `resolve_api_key` selects, or the exploit cannot
      // be demonstrated: a missing column makes the call throw, and a throw is not an exploit — it
      // would silently retire this negative control. `governed_actor_id` arrived with 0116 (P45-4).
      await q(`create temp table api_keys (id uuid default gen_random_uuid(), org_id uuid, name text, key_hash text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, scope text, governed_actor_id uuid, data_environment text)`);
      await q(`insert into api_keys (org_id, name, key_hash, scope) values ($1, 'forged', 'h1b01-forged-hash', 'full')`, [fx.V]);
      const r = await q(`select org_id from resolve_api_key('h1b01-forged-hash')`);
      return { exploited: r.length > 0 && r[0].org_id === fx.V, detail: `${r.length} key(s) resolved` };
    });
    await run("type shadowing: a temp table named `uuid` breaks or bends RLS evaluation", fx.V, async (q) => {
      const n0 = Number((await q(`select count(*)::int n from pursuits`))[0].n);
      await q(`create temp table uuid (x int)`);
      let n1: number | string;
      try { n1 = Number((await q(`select count(*)::int n from pursuits`))[0].n); }
      catch (e) { n1 = `error: ${(e as Error).message.split("\n")[0].slice(0, 50)}`; }
      return { exploited: n1 !== n0, detail: `own pursuits ${n0} → ${n1}` };
    });
    await run("guard trigger: a temp `evidence` lets a signal cite unverified evidence (enforce_verified_evidence)", fx.V, async (q) => {
      const [{ id: ev }] = await q(`insert into evidence select (jsonb_populate_record(null::evidence, to_jsonb(e) || jsonb_build_object(
          'id', gen_random_uuid(), 'status', 'quarantined', 'claim_fingerprint', 'h1b01-' || gen_random_uuid()))).*
          from evidence e where e.org_id = $1 limit 1 returning id`, [fx.V]) as { id: string }[];
      await q(`create temp table evidence (id uuid, status text)`);
      await q(`insert into evidence (id, status) values ($1, 'verified')`, [ev]);
      const through = await goesThrough(q, `insert into signals (org_id, company_id, signal_type, confidence, observed_at, evidence_id) values ($1, $2, 'h1b01-shadow', 0.5, now(), $3)`, [fx.V, fx.company, ev]);
      return { exploited: through, detail: through ? "signal accepted on unverified evidence" : "refused by the guard" };
    });
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
  return out;
}

/** Section D: the CREATE-on-public assumption the hardened path relies on, and the SECURITY DEFINER posture. */
async function assumptions(db: Pool | PoolClient, owners: string[]): Promise<void> {
  const one = async <T,>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;
  const roles = (await db.query<{ r: string }>(`select rolname r from pg_roles where rolname in ('app_rw','anon','authenticated','service_role')`)).rows.map((x) => x.r);
  for (const r of roles) check(`${r} cannot CREATE in public`, !(await one<{ v: boolean }>(`select has_schema_privilege($1, 'public', 'CREATE') v`, [r])).v);
  check("PUBLIC cannot CREATE in public", !(await one<{ v: boolean }>(`select exists (select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE') v`)).v);
  const via = (await db.query<{ r: string }>(`with recursive up(oid) as (select m.roleid from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'app_rw')
      union select m.roleid from pg_auth_members m join up on m.member = up.oid)
      select r.rolname r from up join pg_roles r on r.oid = up.oid where has_schema_privilege(r.rolname, 'public', 'CREATE')`)).rows;
  check("app_rw has no membership path to CREATE on public", via.length === 0, via.map((x) => x.r).join(","));
  const tableOwner = (await one<{ o: string }>(`select pg_get_userbyid(relowner) o from pg_class where oid = 'public.partnerships'::regclass`)).o;
  check(`every protected function is owned by the schema's table owner (${tableOwner})`, owners.length === 1 && owners[0] === tableOwner, owners.join(","));
  const APP = ["audit_partnership_event", "redeem_partnership_invite", "list_grant_source_state", "sync_list_grant_members", "revoke_list_grant_copies",
    "decide_overlap_probe", "partnership_evidence_shares", "shared_in_evidence", "partnership_skill_shares", "shared_in_skills", "skill_share_subject",
    "record_broker_event", "partnership_settlement_rows", "h1b_skill_owner"];
  const INTERNAL = ["h1b_consent_party", "h1b_consent_allowed", "h1b_org_book", "h1b_overlap_results", "h1b_consent_guard"];
  const ex = (await db.query<{ name: string; pub: boolean; rw: boolean; other: boolean }>(`
      select p.proname name,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
             has_function_privilege('app_rw', p.oid, 'EXECUTE') rw,
             ${roles.filter((r) => r !== "app_rw").map((r) => `has_function_privilege('${r}', p.oid, 'EXECUTE')`).join(" or ") || "false"} other
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [[...APP, ...INTERNAL]])).rows;
  check("H1B-0 runtime functions: EXECUTE for app_rw only — not PUBLIC, anon, authenticated or service_role", APP.every((n) => ex.some((e) => e.name === n && e.rw && !e.pub && !e.other)));
  check("H1B-0 internal helpers: not executable by app_rw or any runtime role", INTERNAL.every((n) => ex.some((e) => e.name === n && !e.rw && !e.pub && !e.other)));
}

/**
 * `--catalogue-only`: the hosted-safe half. The catalogue guard (0 unsafe protected functions) and the
 * section D assumptions, inside ONE read-only transaction on the owner connection. It never connects as
 * app_rw, never creates a temp table, never alters a function — so it may be pointed at a real (hosted)
 * database, e.g. after Gate 1b.1 or at Gate 7. The exploit battery and its negative control run only on
 * disposable clones (the default mode).
 */
async function catalogueOnly(): Promise<void> {
  console.log(`[search-path-verify --catalogue-only] ${CONN.replace(/:[^:@/]*@/, ":***@")} · read-only`);
  const c = await owner.connect();
  try {
    await c.query("begin isolation level repeatable read read only");
    check("the transaction is READ ONLY", (await c.query<{ ro: string }>(`select current_setting('transaction_read_only') ro`)).rows[0].ro === "on");
    const g = await guard(c);
    check(`the catalogue guard finds 0 unsafe functions in the protected class (${g.total} protected)`, g.violations.length === 0, g.violations.slice(0, 5).join(" · "));
    await assumptions(c, g.owners);
    check("nothing was written (txid_current_if_assigned() is NULL)", (await c.query<{ x: string | null }>(`select txid_current_if_assigned() x`)).rows[0].x === null);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await owner.end();
  process.exit(failed ? 1 : 0);
}

async function main(): Promise<void> {
  if (process.argv.includes("--catalogue-only")) return catalogueOnly();
  await assertSeededClone(owner);
  console.log(`[search-path-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")} · exploits as app_rw`);
  const one = async <T,>(sql: string, p: unknown[] = []) => (await owner.query(sql, p)).rows[0] as T;
  const orgId = async (name: string) => (await one<{ id: string }>(`select id from organizations where name = $1`, [name])).id;
  const V = await orgId("Vertex Systems"), T = await orgId("TD SYNNEX (demo)"), M = await orgId("Meridian Technology Partners");
  const P1 = (await one<{ id: string }>(`select id from partnerships where status = 'active' and $1 in (initiator_org_id, counterpart_org_id) and $2 in (initiator_org_id, counterpart_org_id)`, [V, T])).id;
  const JP = (await one<{ id: string }>(`select id from joint_pursuits where partnership_id = $1 and status = 'active' limit 1`, [P1])).id;
  const Vpursuit = (await one<{ id: string }>(`select id from pursuits where org_id = $1 order by created_at limit 1`, [V])).id;
  const grant = (await one<{ id: string }>(`select id from context_grants order by created_at limit 1`)).id;
  const company = (await one<{ company_id: string }>(`select company_id from evidence where org_id = $1 limit 1`, [V])).company_id;
  const fx: Fixture = { V, M, P1, JP, Vpursuit, grant, company };

  // ================================================================================================
  console.log("\nA  NEGATIVE CONTROL — 0105's documented rollback restores the vulnerable posture");
  // ================================================================================================
  await owner.query(ROLLBACK);
  const gA = await guard(owner);
  check(`the catalogue guard FLAGS the vulnerable posture (${gA.violations.length} of ${gA.total} protected functions unsafe)`, gA.violations.length >= 31, `${gA.violations.length}`);
  const bA = await battery(fx);
  for (const o of bA) check(`vulnerable: exploit SUCCEEDS — ${o.name}`, o.exploited, o.detail);

  // ================================================================================================
  console.log("\nB  FORWARD — migration 0105 applied");
  // ================================================================================================
  await owner.query(FORWARD);
  const gB = await guard(owner);
  check(`the catalogue guard finds 0 unsafe functions in the protected class (${gB.total} protected)`, gB.violations.length === 0, gB.violations.slice(0, 3).join(" · "));
  const bB = await battery(fx);
  for (const o of bB) check(`hardened: exploit FAILS — ${o.name}`, !o.exploited, o.detail);

  // ================================================================================================
  console.log("\nC  The guard catches a reintroduction (rolled back)");
  // ================================================================================================
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query(`alter function public.is_org_member(uuid) set search_path = public`);
    await c.query(`create function public.h1b01_guard_probe() returns int language sql security definer as $$ select 1 $$`);
    const gC = await guard(c);
    check("a helper re-pinned to `search_path=public` is flagged", gC.violations.some((v) => v.startsWith("is_org_member(uuid)")));
    check("a new SECURITY DEFINER function with no search_path is flagged", gC.violations.some((v) => v.startsWith("h1b01_guard_probe()")));
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
  check("unsafeSearchPath: `public, pg_temp` (pg_catalog not first) is unsafe", unsafeSearchPath("public, pg_temp") !== null);
  check("unsafeSearchPath: `pg_catalog, public` (pg_temp not explicit) is unsafe", unsafeSearchPath("pg_catalog, public") !== null);
  check("unsafeSearchPath: `pg_catalog, scratch, public, pg_temp` (untrusted schema) is unsafe", unsafeSearchPath("pg_catalog, scratch, public, pg_temp") !== null);
  check("unsafeSearchPath: `pg_catalog, public, pg_temp` and `pg_catalog, pg_temp` are safe", unsafeSearchPath("pg_catalog, public, pg_temp") === null && unsafeSearchPath("pg_catalog, pg_temp") === null);

  // ================================================================================================
  console.log("\nD  Assumptions and SECURITY DEFINER posture");
  // ================================================================================================
  await assumptions(owner, gB.owners);

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await owner.end(); await rw.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[search-path-verify] fatal:", String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>")); await owner.end().catch(() => {}); await rw.end().catch(() => {}); process.exit(1); });
