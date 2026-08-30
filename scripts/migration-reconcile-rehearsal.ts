/**
 * Pilot OR-1 rehearsal — migration reconciliation, against a throwaway DB (never prod).
 * Simulates the production situation (tracker drifted to 0012 while the schema is
 * actually current), runs the read-only evidence report, reconciles WITHOUT a blind
 * replay, and proves the tracker ends up matching the codebase with clean-rebuild
 * parity. Produces the before/after numbers the readiness report cites.
 *
 *   npx tsx scripts/migration-reconcile-rehearsal.ts
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";

const HOST = process.env.DEMO_PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.DEMO_PGPORT ?? 5433);
const ADMIN = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
const u = (db: string) => `postgresql://postgres:postgres@${HOST}:${PORT}/${db}`;
const BOOTSTRAP = `
create extension if not exists pgcrypto; create extension if not exists vector;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
create schema if not exists auth; create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`;
let passed = 0, failed = 0; const failures: string[] = [];
function check(n: string, c: boolean, d = "") { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; failures.push(n + (d ? ` — ${d}` : "")); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } }
async function withC<T>(url: string, fn: (c: PoolClient) => Promise<T>): Promise<T> { const p = new Pool({ connectionString: url, max: 1 }); const c = await p.connect(); try { return await fn(c); } finally { c.release(); await p.end(); } }
async function recreate(db: string) { await withC(ADMIN, async (c) => { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`); await c.query(`create database ${db}`); }); }
function migrate(db: string, args = ""): string { return execSync(`DATABASE_URL='${u(db)}' npx tsx scripts/migrate.ts ${args}`, { encoding: "utf8" }); }
function report(db: string): { files: number; tracked: number; applied_evidence: number; missing: number; no_ddl: number } {
  const out = execSync(`DATABASE_URL='${u(db)}' MIGRATION_REPORT_JSON=1 npx tsx scripts/migration-state-report.ts`, { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("JSON "))!;
  return JSON.parse(line.slice(5));
}
const trackerCount = (db: string) => withC(u(db), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from schema_migrations`)).rows[0].n));

async function main() {
  console.log(`[migration-reconcile-rehearsal] ${HOST}:${PORT}`);
  const fileCount = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).length;
  const DB = "or1_reh";
  try {
    console.log("OR-1.1  Clean rebuild → current");
    await recreate(DB); await withC(u(DB), (c) => c.query(BOOTSTRAP).then(() => {})); migrate(DB);
    check("clean rebuild tracks the full migration set", (await trackerCount(DB)) === fileCount, `${await trackerCount(DB)}/${fileCount}`);

    console.log("OR-1.2  Simulate production drift (tracker stale at 0012)");
    await withC(u(DB), (c) => c.query(`delete from schema_migrations where filename > '0012zzzz'`).then(() => {}));
    const before = report(DB);
    check("BEFORE: tracker shows the drift", before.tracked <= 13 && before.tracked < before.files);
    check("BEFORE: the untracked-but-present files are detected as APPLIED_EVIDENCE (not MISSING)", before.applied_evidence > 0 && before.missing === 0, `applied_evidence=${before.applied_evidence} missing=${before.missing} no_ddl=${before.no_ddl}`);

    console.log("OR-1.3  Reconcile WITHOUT blind replay (baseline-stamp evidence)");
    migrate(DB, "--baseline");   // stamp already-applied files, no DDL
    check("AFTER baseline: tracker matches the codebase", (await trackerCount(DB)) === fileCount);
    const after = report(DB);
    check("AFTER: nothing untracked, nothing missing", after.tracked === after.files && after.missing === 0);

    console.log("OR-1.4  A follow-up db:migrate is a safe no-op");
    const out = migrate(DB);
    check("re-running applies nothing after reconciliation", /0 applied/.test(out));

    console.log("OR-1.5  Clean-rebuild parity");
    const DB2 = "or1_reh2";
    await recreate(DB2); await withC(u(DB2), (c) => c.query(BOOTSTRAP).then(() => {})); migrate(DB2);
    check("a from-zero rebuild yields the same tracker count as the reconciled DB", (await trackerCount(DB2)) === (await trackerCount(DB)));
    await withC(ADMIN, (c) => c.query(`drop database if exists ${DB2}`).then(() => {}));
  } finally {
    await withC(ADMIN, async (c) => { for (const db of [DB, "or1_reh2"]) { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`).catch(() => {}); } });
  }
  console.log(`\n[migration-reconcile-rehearsal] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("FAILURES:"); for (const f of failures) console.log("  - " + f); }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[migration-reconcile-rehearsal] fatal:", e); process.exit(2); });
