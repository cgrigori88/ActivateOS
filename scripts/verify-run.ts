import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES, suitesFor, specFor, type VerifyClass } from "./verify-classes";
import { markSeededClone } from "./seeded-clone";

/**
 * The verifier runner (Wave 6B §8).
 *
 *   npx tsx scripts/verify-run.ts --class FRESH     # disposable DB per suite
 *   npx tsx scripts/verify-run.ts --class SEEDED    # canonical demo world
 *   npx tsx scripts/verify-run.ts --class EITHER    # run-scoped; disposable DB per suite
 *   npx tsx scripts/verify-run.ts --class EITHER --either-on-seeded
 *                                                  # ... against the demo world instead
 *   npx tsx scripts/verify-run.ts --class ALL       # everything runnable here
 *   npx tsx scripts/verify-run.ts --suite disclosure
 *   npx tsx scripts/verify-run.ts --explain         # print the contract, run nothing
 *
 * Environment:
 *   ADMIN_URL   superuser URL on the target server, used to CREATE/DROP the
 *               disposable databases. Default postgres://postgres@127.0.0.1:5432/postgres
 *   SEEDED_URL  the canonical demo world.
 *               Default postgres://postgres@127.0.0.1:5432/pursuit_demo
 *
 * FRESH suites each get their own database, migrated from supabase/migrations,
 * and it is dropped afterwards — which is both the correct contract and the
 * only way those suites can be idempotent, since their fixtures commit.
 */

// Port 5433 — the local demo cluster every other script defaults to (H1A: this runner alone said 5432).
const ADMIN_URL = process.env.ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/postgres";
const SEEDED_URL = process.env.SEEDED_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const KEEP = process.argv.includes("--keep");

/**
 * Where EITHER suites run (Wave 6C §4).
 *
 * They were being run against the canonical demo world, and that is how it
 * accreted state nobody authored: an EITHER suite needs nothing from the demo
 * content, but it still COMMITS its run-scoped fixtures, so every battery run
 * left another `Hero Vendor u6wvlx` org, another `Globex cgvous` company, and
 * another taxonomy node behind. Nineteen suites doing that is why the world had
 * to be rebuilt to be trusted, and why a rebuilt world stopped matching the
 * assertions written against the accreted one.
 *
 * Default is therefore a disposable database, which the class contract already
 * says these suites tolerate. `--either-on-seeded` runs them the old way — that
 * is the other half of the "either" claim, and it is worth being able to prove
 * on demand rather than assuming.
 */
//
// H1A: that flag is now REFUSED. Every EITHER suite commits run-scoped fixtures, so running them on
// the canonical world was the accretion itself; and each suite now calls assertDisposableDatabase,
// which would refuse the canonical world anyway. Proving "either" means a clone, not the world.
if (process.argv.includes("--either-on-seeded")) {
  console.error("--either-on-seeded is refused (H1A): EITHER suites commit fixtures and must not run on the canonical world.");
  process.exit(2);
}
const EITHER_ON_SEEDED = false;

/** Supabase-shaped preamble the migrations assume. Mirrors scripts/demo-db.ts. */
const BOOTSTRAP = `
create extension if not exists pgcrypto;
create extension if not exists vector;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='app_rw') then create role app_rw nologin noinherit; end if; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
`;

async function withAdmin<T>(fn: (p: Pool) => Promise<T>): Promise<T> {
  const p = new Pool({ connectionString: ADMIN_URL });
  try { return await fn(p); } finally { await p.end(); }
}

async function createFreshDatabase(name: string): Promise<string> {
  await withAdmin(async (p) => {
    await p.query(`drop database if exists "${name}"`);
    await p.query(`create database "${name}"`);
  });
  const url = ADMIN_URL.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
  const p = new Pool({ connectionString: url });
  try { await p.query(BOOTSTRAP); } finally { await p.end(); }
  // The real migrations, in order — the same applier the demo world uses.
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const mp = new Pool({ connectionString: url });
  try {
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8");
      try { await mp.query(sql); } catch (e) {
        // Migrations are written to be re-appliable; a duplicate-object error
        // on a fresh database means the file is self-guarding, not broken.
        const msg = (e as Error).message;
        if (!/already exists|duplicate/i.test(msg)) throw new Error(`${f}: ${msg}`);
      }
    }
  } finally { await mp.end(); }
  return url;
}

/**
 * A disposable CLONE of the canonical world for SEEDED suites that write (H1A). `CREATE DATABASE …
 * TEMPLATE` copies the world byte for byte; the clone is marked (scripts/seeded-clone.ts) so the
 * suite's own guard accepts it, and it is dropped afterwards. The canonical world is only ever the
 * template — nothing is written to it. Postgres refuses the copy while any other session is
 * connected to the template; that is reported, never worked around by terminating those sessions.
 */
async function createSeededClone(name: string): Promise<string> {
  const source = new URL(SEEDED_URL).pathname.replace(/^\//, "");
  await withAdmin(async (p) => {
    await p.query(`drop database if exists "${name}"`);
    await p.query(`create database "${name}" template "${source}"`);
  });
  const url = SEEDED_URL.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
  await markSeededClone(url, source);
  return url;
}

async function dropDatabase(name: string): Promise<void> {
  await withAdmin(async (p) => {
    await p.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [name]).catch(() => {});
    await p.query(`drop database if exists "${name}"`);
  });
}

/**
 * Deployment master switches the suites require (Wave 6B §8).
 *
 * Feature flags in this product are TWO-layer: an environment master switch AND
 * a per-org `org_features` row, both of which must be on. A suite can set its
 * own org row — that is its fixture — but it cannot reasonably set the
 * deployment switch for itself, and `outcome-bridge`/`lifecycle-acceptance`
 * assumed one was already on. Run without it, the bridge correctly skips and
 * eleven positive assertions fail while the suite's own "gate: bridge skips
 * when disabled" assertion passes — which reads like a broken bridge rather
 * than one that was never armed.
 *
 * Only switches a suite genuinely needs belong here. Notably ROUTING_ENABLED
 * does NOT: `routes-verify` asserts that it is off by default, and setting it
 * globally would make that assertion fail for the wrong reason.
 */
const VERIFY_ENV: Record<string, string> = {
  OUTCOME_LEARNING_ENABLED: "true",
};

interface Result { name: string; cls: VerifyClass; passed: number; failed: number; fatal: string | null; failures: string[] }

function runSuite(name: string, url: string): Result {
  const spec = specFor(name)!;
  const cls = spec.cls;
  let out = "";
  try {
    out = execFileSync("npx", ["tsx", `scripts/${name}-verify.ts`], {
      encoding: "utf8",
      timeout: 300_000,
      env: { ...process.env, ...(spec.env ?? {}), DATABASE_URL: url, DATABASE_URL_VERIFY: url, DEMO_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
  const m = out.match(/(\d+) passed, (\d+) failed/g);
  const failures = [...out.matchAll(/^\s*✗ (.+)$/gm)].map((x) => x[1].trim())
    .filter((f) => !/^FAILURES —/.test(f));
  if (m && m.length) {
    const last = m[m.length - 1].match(/(\d+) passed, (\d+) failed/)!;
    return { name, cls, passed: Number(last[1]), failed: Number(last[2]), fatal: null, failures };
  }
  const fatal = (out.match(/fatal:.*|error:.*|TypeError:.*/i) ?? ["unknown failure — no summary line"])[0]
    .replace(/\s+/g, " ").slice(0, 160);
  return { name, cls, passed: 0, failed: 0, fatal, failures };
}

async function main() {
  if (process.argv.includes("--explain")) {
    for (const c of ["FRESH", "SEEDED", "EITHER", "DEPLOYMENT_ONLY"] as VerifyClass[]) {
      console.log(`\n${c}`);
      for (const s of suitesFor(c)) console.log(`  ${s.name.padEnd(22)} ${s.why}`);
    }
    return;
  }

  const suiteArg = process.argv[process.argv.indexOf("--suite") + 1];
  const classArg = (process.argv[process.argv.indexOf("--class") + 1] ?? "ALL").toUpperCase();
  const chosen = suiteArg && process.argv.includes("--suite")
    ? SUITES.filter((s) => s.name === suiteArg)
    : classArg === "ALL"
      ? SUITES.filter((s) => s.cls !== "DEPLOYMENT_ONLY")
      : suitesFor(classArg as VerifyClass);

  if (chosen.length === 0) { console.error(`no suites matched`); process.exit(2); }

  const results: Result[] = [];
  for (const s of chosen) {
    if (s.cls === "DEPLOYMENT_ONLY") {
      results.push({ name: s.name, cls: s.cls, passed: 0, failed: 0, fatal: "DEPLOYMENT-ENVIRONMENT ONLY — not runnable here", failures: [] });
      console.log(`${s.name.padEnd(22)} DEPLOYMENT-ENVIRONMENT ONLY`);
      continue;
    }
    if (s.cls === "FRESH" || (s.cls === "EITHER" && !EITHER_ON_SEEDED)) {
      const db = `v_${s.name.replace(/-/g, "_")}_${Date.now().toString(36)}`;
      const url = await createFreshDatabase(db);
      try {
        const r = runSuite(s.name, url);
        results.push(r);
        console.log(`${s.name.padEnd(22)} ${s.cls.padEnd(7)} ${r.fatal ? `FATAL ${r.fatal}` : `${r.passed} passed, ${r.failed} failed`} (disposable db)`);
      } finally { if (!KEEP) await dropDatabase(db); }
    } else if (s.isolation === "SEEDED_CLONE") {
      const db = `v_${s.name.replace(/-/g, "_")}_clone_${Date.now().toString(36)}`;
      const url = await createSeededClone(db);
      try {
        const r = runSuite(s.name, url);
        results.push(r);
        console.log(`${s.name.padEnd(22)} ${s.cls.padEnd(7)} ${r.fatal ? `FATAL ${r.fatal}` : `${r.passed} passed, ${r.failed} failed`} (seeded clone)`);
      } finally { if (!KEEP) await dropDatabase(db); }
    } else {
      const r = runSuite(s.name, SEEDED_URL);
      results.push(r);
      console.log(`${s.name.padEnd(22)} ${s.cls.padEnd(7)} ${r.fatal ? `FATAL ${r.fatal}` : `${r.passed} passed, ${r.failed} failed`}`);
    }
  }

  console.log("\n=== MATRIX ===");
  console.log("suite | class | executed | passed | failed | fatal | reason");
  for (const r of results) {
    const executed = r.passed + r.failed;
    console.log(
      `${r.name} | ${r.cls} | ${executed} | ${r.passed} | ${r.failed} | ${r.fatal ? "YES" : "no"} | ${r.fatal ?? (r.failures.length ? r.failures.join(" ; ") : "—")}`,
    );
  }
  const totals = results.reduce((a, r) => ({ p: a.p + r.passed, f: a.f + r.failed, fatal: a.fatal + (r.fatal && r.cls !== "DEPLOYMENT_ONLY" ? 1 : 0) }), { p: 0, f: 0, fatal: 0 });
  console.log(`\nTOTAL: ${totals.p} passed, ${totals.f} failed, ${totals.fatal} fatal`);
  process.exit(totals.f > 0 || totals.fatal > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
