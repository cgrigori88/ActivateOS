/**
 * Release Gate R1-G7 rehearsal — migration reconciliation, clean-rebuild proof,
 * backup/restore round-trip. Proves (against throwaway databases, never prod):
 *   1. a clean rebuild from ZERO to current schema via the real migrate.ts runner;
 *   2. re-running the runner is a no-op (nothing re-applied);
 *   3. a STALE tracker is safe — dropping tracker rows and re-running replays those
 *      idempotent migrations with no error (this is why a drifted prod tracker is not
 *      dangerous, and why we never "declare environments equivalent" by hand);
 *   4. backup → restore round-trips real data (a dumped row reappears after restore).
 *
 *   npx tsx scripts/release-rehearsal.ts
 */
import { execSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { Pool, type PoolClient } from "pg";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { dumpDatabase, restoreDatabase, type BackupFile } from "../src/lib/backup/dump";

const HOST = process.env.DEMO_PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.DEMO_PGPORT ?? 5433);
const ADMIN = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
const url = (db: string) => `postgresql://postgres:postgres@${HOST}:${PORT}/${db}`;
const BOOTSTRAP = `
create extension if not exists pgcrypto;
create extension if not exists vector;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`;

let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function withClient<T>(u: string, fn: (c: PoolClient) => Promise<T>): Promise<T> { const p = new Pool({ connectionString: u, max: 1 }); const c = await p.connect(); try { return await fn(c); } finally { c.release(); await p.end(); } }
async function recreate(db: string) { await withClient(ADMIN, async (c) => { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`); await c.query(`create database ${db}`); }); }
function migrate(db: string, args = ""): string { return execSync(`DATABASE_URL='${url(db)}' npx tsx scripts/migrate.ts ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
const trackerCount = (db: string) => withClient(url(db), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from schema_migrations`)).rows[0].n));

async function main() {
  console.log(`[release-rehearsal] ${HOST}:${PORT}`);
  const fileCount = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).length;
  const REB = "r1_rebuild", RES = "r1_restore";

  try {
    // ---- 1. Clean rebuild 0 → current ----
    console.log("R1-G7.1  Clean rebuild from zero");
    await recreate(REB);
    await withClient(url(REB), (c) => c.query(BOOTSTRAP).then(() => {}));
    const out1 = migrate(REB);
    check("every migration applies from an empty database", (await trackerCount(REB)) === fileCount, `${await trackerCount(REB)}/${fileCount}`);
    check("the runner reports applying the full set", /migrations up to date/.test(out1));

    // ---- 2. Re-run is a no-op ----
    console.log("R1-G7.2  Idempotent re-run");
    const out2 = migrate(REB);
    check("re-running applies nothing (all tracked)", /0 applied/.test(out2));

    // ---- 3. Stale tracker is safe (drift) ----
    console.log("R1-G7.3  Stale tracker replays safely (no manual equivalence)");
    await withClient(url(REB), (c) => c.query(`delete from schema_migrations where filename in (select filename from schema_migrations order by filename desc limit 10)`).then(() => {}));
    check("simulated drift removed 10 tracker rows", (await trackerCount(REB)) === fileCount - 10);
    const out3 = migrate(REB); // must NOT error — idempotent replay
    check("re-applying the drifted migrations succeeds (idempotent DDL)", /10 applied/.test(out3) && (await trackerCount(REB)) === fileCount);

    // ---- baseline/reconcile mode ----
    console.log("R1-G7.4  Baseline reconcile mode (stamp without running)");
    await withClient(url(REB), (c) => c.query(`delete from schema_migrations`).then(() => {}));
    const outB = migrate(REB, "--baseline");
    check("baseline stamps every file as applied without running DDL", /stamped/.test(outB) && (await trackerCount(REB)) === fileCount);

    // ---- 4. Backup → restore round-trip ----
    console.log("R1-G7.5  Backup → restore round-trip");
    const marker = `RehearsalOrg-${Math.random().toString(36).slice(2, 8)}`;
    await withClient(url(REB), (c) => c.query(`insert into organizations (name, kind) values ($1,'full')`, [marker]).then(() => {}));
    const dump = await withClient(url(REB), (c) => dumpDatabase(c, { schemaVersion: "r1" }));
    // round-trip the gzip envelope, exactly as the CLI writes/reads it
    const roundTripped = JSON.parse(gunzipSync(gzipSync(Buffer.from(JSON.stringify(dump), "utf8"))).toString("utf8")) as BackupFile;
    await recreate(RES);
    await withClient(url(RES), (c) => c.query(BOOTSTRAP).then(() => {}));
    migrate(RES);
    await withClient(url(RES), async (c) => {
      // empty the freshly-migrated seed rows so the restore is a clean reinstatement
      await c.query(`set session_replication_role = replica`);
      const { rows } = await c.query<{ t: string }>(`select tablename t from pg_tables where schemaname='public' and tablename <> 'schema_migrations'`);
      for (const r of rows) await c.query(`truncate table public.${r.t} cascade`).catch(() => {});
      await c.query(`set session_replication_role = default`);
    });
    await withClient(url(RES), (c) => restoreDatabase(c, roundTripped, { force: true }));
    const found = await withClient(url(RES), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from organizations where name=$1`, [marker])).rows[0].n));
    check("a dumped row reappears after restore (backup→restore round-trips)", found === 1);
    const orgsReb = await withClient(url(REB), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from organizations`)).rows[0].n));
    const orgsRes = await withClient(url(RES), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from organizations`)).rows[0].n));
    check("restored table row count matches the source", orgsReb === orgsRes, `${orgsReb} vs ${orgsRes}`);
  } finally {
    await withClient(ADMIN, async (c) => { for (const db of [REB, RES]) { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`).catch(() => {}); } });
  }

  console.log(`\n[release-rehearsal] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[release-rehearsal] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[release-rehearsal] fatal:", e); process.exit(2); });
