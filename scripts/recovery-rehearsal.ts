/**
 * Pilot OR-2 rehearsal — encrypted backup → restore → recovery proof.
 * Runs ONLY against throwaway databases on the local cluster (never prod, never a
 * live credential). It exercises the REAL operator commands end to end:
 *
 *   1. Build a disposable SOURCE db from zero (bootstrap + real migrate.ts).
 *   2. Populate it with genuine cross-substrate tenant data by running the LOCKED
 *      closed-loop hero scenarios against it (participants, grants, contributions,
 *      governed actions, outbox + receipts, outcomes, attribution, recompute,
 *      federation entity resolution, immutable ledger).
 *   3. Take an ENCRYPTED backup with the real `scripts/backup-dump.ts` CLI
 *      (BACKUP_ENCRYPTION_KEY set) and prove the file on disk is AES-256-GCM
 *      encrypted at rest (magic header), not plaintext.
 *   4. Restore into a disposable RECOVERY db with the real `scripts/backup-restore.ts`
 *      CLI (operator-observed path), and separately restore in-process to time a
 *      clean RTO without CLI/runtime startup.
 *   5. Verify the recovered db: schema/tracker parity, RLS + FORCE RLS still on,
 *      runtime tenant isolation holds, and every substrate's row count matches the
 *      source (recovery-point coverage).
 *   6. Re-run the closed-loop hero scenarios AGAINST the recovered db to prove it is
 *      not just row-equal but fully OPERABLE after restore.
 *
 * RTO/RPO reported here are REHEARSAL-MEASURED on a small local volume. True
 * production RTO/RPO are only established by the real backup/restore exercise
 * against the actual deployment and data volume (docs/OPERATIONS.md).
 *
 *   npx tsx scripts/recovery-rehearsal.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { Pool, type PoolClient } from "pg";
import { decryptBackup, isEncrypted } from "../src/lib/backup/crypto";
import { restoreDatabase, type BackupFile } from "../src/lib/backup/dump";

const HOST = process.env.DEMO_PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.DEMO_PGPORT ?? 5433);
const ADMIN = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
const u = (db: string) => `postgresql://postgres:postgres@${HOST}:${PORT}/${db}`;
// Ephemeral rehearsal key — a random 64-hex key used ONLY for this run, never a
// production key. The point is to prove the encrypted round-trip, not to manage secrets.
const KEY = process.env.REHEARSAL_BACKUP_KEY ?? Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

const BOOTSTRAP = `
create extension if not exists pgcrypto; create extension if not exists vector;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
create schema if not exists auth; create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`;

// Substrate tables whose survival across a restore is the whole point of OR-2.
const SUBSTRATE = [
  "organizations", "pursuits", "pursuit_participants", "context_grants", "context_contributions",
  "governed_action_invocations", "action_outbox", "action_receipts",
  "pursuit_outcomes", "attribution", "outcome_events", "experiments", "experiment_arms",
  "recompute_requests", "change_ledger", "pursuit_route_snapshots",
  "company_aliases", "entity_resolution_reviews",
];

let passed = 0, failed = 0; const failures: string[] = [];
function check(n: string, c: boolean, d = "") { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; failures.push(n + (d ? ` — ${d}` : "")); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } }
async function withC<T>(url: string, fn: (c: PoolClient) => Promise<T>): Promise<T> { const p = new Pool({ connectionString: url, max: 1 }); const c = await p.connect(); try { return await fn(c); } finally { c.release(); await p.end(); } }
async function recreate(db: string) { await withC(ADMIN, async (c) => { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`); await c.query(`create database ${db}`); }); }
async function drop(db: string) { await withC(ADMIN, async (c) => { await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [db]).catch(() => {}); await c.query(`drop database if exists ${db}`).catch(() => {}); }); }
function migrate(db: string, args = "") { execSync(`DATABASE_URL='${u(db)}' npx tsx scripts/migrate.ts ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function closedLoop(db: string) { return execSync(`DATABASE_URL_VERIFY='${u(db)}' npx tsx scripts/closed-loop-verify.ts`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
const count = (db: string, t: string) => withC(u(db), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from ${t}`)).rows[0].n));
const trackerCount = (db: string) => withC(u(db), async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from schema_migrations`)).rows[0].n));
async function truncateAll(db: string) {
  await withC(u(db), async (c) => {
    await c.query(`set session_replication_role = replica`);
    const { rows } = await c.query<{ t: string }>(`select tablename t from pg_tables where schemaname='public' and tablename <> 'schema_migrations'`);
    for (const r of rows) await c.query(`truncate table public.${r.t} cascade`).catch(() => {});
    await c.query(`set session_replication_role = default`);
  });
}

async function main() {
  console.log(`[recovery-rehearsal] ${HOST}:${PORT}`);
  const fileCount = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).length;
  const SRC = "or2_source", REC = "or2_recovery", REC2 = "or2_recovery_lib";
  const workDir = mkdtempSync(join(tmpdir(), "or2-backup-"));
  const metrics: Record<string, string> = {};

  try {
    // ---- 1. Disposable source from zero + real substrate data ----
    console.log("OR-2.1  Build source db + populate with the closed-loop hero scenarios");
    await recreate(SRC);
    await withC(u(SRC), (c) => c.query(BOOTSTRAP).then(() => {}));
    migrate(SRC);
    check("source db builds to current schema from zero", (await trackerCount(SRC)) === fileCount, `${await trackerCount(SRC)}/${fileCount}`);
    const clSrc = closedLoop(SRC);
    const clSrcPass = /(\d+) passed, 0 failed/.exec(clSrc);
    check("closed-loop hero scenarios populate the source (0 failed)", !!clSrcPass, clSrc.split("\n").slice(-4).join(" | "));
    const srcCounts: Record<string, number> = {};
    for (const t of SUBSTRATE) srcCounts[t] = await count(SRC, t);
    check("source now holds real cross-substrate data (participants, actions, outcomes, ledger)",
      srcCounts["pursuit_participants"] > 0 && srcCounts["governed_action_invocations"] > 0 && srcCounts["pursuit_outcomes"] > 0 && srcCounts["change_ledger"] > 0,
      SUBSTRATE.map((t) => `${t}=${srcCounts[t]}`).join(" "));

    // ---- 2. Encrypted backup via the REAL operator CLI ----
    console.log("OR-2.2  Encrypted backup at rest (real backup-dump.ts CLI)");
    execSync(`DATABASE_URL='${u(SRC)}' BACKUP_ENCRYPTION_KEY='${KEY}' npx tsx scripts/backup-dump.ts '${workDir}'`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const encFile = readdirSync(workDir).find((f) => f.endsWith(".enc"));
    check("the dump CLI wrote an encrypted (.enc) backup file", !!encFile, readdirSync(workDir).join(","));
    const blob = readFileSync(join(workDir, encFile!));
    check("the backup file is AES-256-GCM encrypted at rest, not plaintext gzip", isEncrypted(blob) && blob[0] !== 0x1f);
    let plaintextLeak = false;
    try { gunzipSync(blob); plaintextLeak = true; } catch { plaintextLeak = false; }
    check("the encrypted file cannot be read as a plaintext gzip (confidentiality at rest)", !plaintextLeak);
    // decrypt only with the key; a wrong key fails the auth tag (tamper-evident)
    let wrongKeyRejected = false;
    try { decryptBackup(blob, "f".repeat(64)); } catch { wrongKeyRejected = true; }
    check("a wrong key is rejected by the GCM auth tag (tamper-evident)", wrongKeyRejected);

    // ---- 3. Restore via the REAL operator CLI (operator-observed RTO) ----
    console.log("OR-2.3  Restore via the real backup-restore.ts CLI");
    await recreate(REC);
    await withC(u(REC), (c) => c.query(BOOTSTRAP).then(() => {}));
    migrate(REC);
    await truncateAll(REC);
    const cliStart = Date.now();
    execSync(`TARGET_DATABASE_URL='${u(REC)}' BACKUP_ENCRYPTION_KEY='${KEY}' npx tsx scripts/backup-restore.ts '${join(workDir, encFile!)}' --force`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    metrics.rto_cli_ms = String(Date.now() - cliStart);
    check("the restore CLI decrypts + restores the encrypted backup (exit 0)", true);

    // ---- 4. Clean in-process restore to time RTO without CLI startup ----
    console.log("OR-2.4  In-process restore (clean rehearsal RTO measurement)");
    await recreate(REC2);
    await withC(u(REC2), (c) => c.query(BOOTSTRAP).then(() => {}));
    migrate(REC2);
    await truncateAll(REC2);
    const loadStart = Date.now();
    const dump = JSON.parse(gunzipSync(decryptBackup(readFileSync(join(workDir, encFile!)), KEY)).toString("utf8")) as BackupFile;
    metrics.load_decrypt_ms = String(Date.now() - loadStart);
    const restoreStart = Date.now();
    const rr = await withC(u(REC2), (c) => restoreDatabase(c, dump, { force: true }));
    metrics.rto_restore_ms = String(Date.now() - restoreStart);
    check("in-process restore reinstates rows (clean RTO measured)", rr.rows > 0, `${rr.rows} rows, ${rr.tables} tables, ${rr.mode} mode`);

    // ---- 5. Recovered-db integrity: schema, RLS, FORCE RLS, tenant isolation ----
    console.log("OR-2.5  Recovered-db integrity (schema + RLS + FORCE RLS + tenant isolation)");
    check("recovered tracker matches the codebase migration set", (await trackerCount(REC)) === fileCount, `${await trackerCount(REC)}/${fileCount}`);
    const rls = await withC(u(REC), async (c) => (await c.query<{ t: string; f: boolean }>(`select relname t, relforcerowsecurity f from pg_class where relname = any($1) and relrowsecurity`, [["pursuits", "change_ledger", "governed_action_invocations", "pursuit_participants", "context_contributions"]])).rows);
    check("core tenant tables still have RLS ENABLED after restore", rls.length >= 4, `rls-on: ${rls.map((r) => r.t).join(",")}`);
    check("core tenant tables still have FORCE RLS after restore (owner not exempt)", rls.every((r) => r.f), `force: ${rls.map((r) => `${r.t}=${r.f}`).join(",")}`);
    // Runtime tenant isolation on recovered data: the outsider org sees no vendor pursuit; the sponsor does.
    const iso = await withC(u(REC), async (c) => {
      const orgs = (await c.query<{ id: string; name: string }>(`select id, name from organizations where name like 'Hero %'`)).rows;
      const vendor = orgs.find((o) => o.name.startsWith("Hero Vendor"))!;
      const outsider = orgs.find((o) => o.name.startsWith("Hero Outsider"))!;
      const asOrg = async (orgId: string) => { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const n = Number((await c.query<{ n: string }>(`select count(*)::text n from pursuits`)).rows[0].n); await c.query("rollback"); return n; };
      return { vendorSees: await asOrg(vendor.id), outsiderSees: await asOrg(outsider.id) };
    });
    check("the recovered sponsor org sees its pursuits (RLS lets the owner in)", iso.vendorSees >= 1, `vendor sees ${iso.vendorSees}`);
    check("the recovered outsider org sees NO cross-tenant pursuit (isolation survives restore)", iso.outsiderSees === 0, `outsider sees ${iso.outsiderSees}`);

    // ---- 6. Recovery-point coverage: every substrate's rows survived ----
    console.log("OR-2.6  Recovery-point coverage (per-substrate row parity source → recovered)");
    let matched = 0; const mismatches: string[] = [];
    for (const t of SUBSTRATE) {
      const s = srcCounts[t]; const r = await count(REC, t);
      if (s === r) matched++; else mismatches.push(`${t} src=${s} rec=${r}`);
    }
    check("every substrate table's row count matches the source (zero data loss in the window)", mismatches.length === 0, mismatches.join("; "));
    metrics.recovery_point_coverage = `${matched}/${SUBSTRATE.length} substrate tables at parity`;

    // ---- 7. Operability: the recovered db runs the closed loop end to end ----
    console.log("OR-2.7  The recovered db is fully OPERABLE (re-run the closed loop against it)");
    const clRec = closedLoop(REC);
    const clRecPass = /(\d+) passed, 0 failed/.exec(clRec);
    check("closed-loop hero scenarios PASS against the recovered db (operable, not just row-equal)", !!clRecPass, clRec.split("\n").slice(-4).join(" | "));

    console.log("\n--- REHEARSAL-MEASURED metrics (small local volume; NOT true production RTO/RPO) ---");
    console.log(`  rehearsal RTO (in-process restore):     ${metrics.rto_restore_ms} ms  (+ ${metrics.load_decrypt_ms} ms decrypt/parse load)`);
    console.log(`  rehearsal RTO (operator CLI end-to-end): ${metrics.rto_cli_ms} ms  (includes tsx/runtime startup)`);
    console.log(`  rehearsal recovery-point coverage:       ${metrics.recovery_point_coverage}`);
    console.log(`  NOTE: production RTO/RPO are only established by the real backup/restore against the live deployment + data volume.`);
    if (process.env.RECOVERY_REHEARSAL_JSON === "1") console.log("JSON " + JSON.stringify({ passed, failed, ...metrics }));
  } finally {
    for (const db of [SRC, REC, REC2]) await drop(db);
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  console.log(`\n[recovery-rehearsal] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[recovery-rehearsal] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[recovery-rehearsal] fatal:", e); process.exit(2); });
