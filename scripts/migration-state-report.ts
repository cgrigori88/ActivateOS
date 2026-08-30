/**
 * Pilot OR-1 — migration-state report (READ-ONLY; safe to point at production).
 *
 *   DATABASE_URL='postgres://…read-only…' npx tsx scripts/migration-state-report.ts
 *
 * Produces an EXACT before/after picture WITHOUT mutating anything: which migration
 * files the tracker records, which files the codebase carries, and — by probing for
 * the objects each untracked file creates — which untracked files appear ALREADY
 * APPLIED (evidence) vs GENUINELY MISSING. It then prints the safe reconciliation plan
 * (baseline-stamp the applied-with-evidence set, apply only the genuinely-missing set),
 * never a blind replay. Run this first; reconcile only after reviewing the output.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const CONN = process.env.DATABASE_URL ?? process.env.MIGRATION_REPORT_URL;
if (!CONN) { console.error("set DATABASE_URL (read-only) to the database to inspect"); process.exit(1); }
const CONN_SAFE: string = CONN;

/** Object names a migration file creates — enough to evidence whether it ran. */
function createdObjects(sql: string): { tables: string[]; functions: string[] } {
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1].toLowerCase());
  const functions = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1].toLowerCase());
  return { tables: [...new Set(tables)], functions: [...new Set(functions)] };
}

export interface FileState { file: string; tracked: boolean; createsTables: string[]; createsFns: string[]; objectsPresent: number; objectsExpected: number; verdict: "TRACKED" | "APPLIED_EVIDENCE" | "MISSING" | "NO_DDL_SIGNAL" }

async function main() {
  const pool = new Pool({ connectionString: CONN, max: 1 });
  const db = await pool.connect();
  try {
    const hasTracker = (await db.query(`select to_regclass('public.schema_migrations') t`)).rows[0].t !== null;
    const tracked = new Set<string>(hasTracker ? (await db.query<{ filename: string }>(`select filename from schema_migrations`)).rows.map((r) => r.filename) : []);
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    const states: FileState[] = [];
    for (const file of files) {
      const { tables, functions } = createdObjects(readFileSync(join(dir, file), "utf8"));
      const expected = tables.length + functions.length;
      let present = 0;
      for (const t of tables) if ((await db.query(`select to_regclass($1) r`, [`public.${t}`])).rows[0].r !== null) present++;
      for (const f of functions) if (Number((await db.query<{ n: string }>(`select count(*)::text n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [f])).rows[0].n) > 0) present++;
      let verdict: FileState["verdict"];
      if (tracked.has(file)) verdict = "TRACKED";
      else if (expected === 0) verdict = "NO_DDL_SIGNAL";
      else if (present >= Math.ceil(expected * 0.6)) verdict = "APPLIED_EVIDENCE";
      else verdict = "MISSING";
      states.push({ file, tracked: tracked.has(file), createsTables: tables, createsFns: functions, objectsPresent: present, objectsExpected: expected, verdict });
    }

    const by = (v: FileState["verdict"]) => states.filter((s) => s.verdict === v);
    console.log(`\n=== MIGRATION STATE REPORT — ${CONN_SAFE.replace(/:[^:@/]*@/, ":***@")} ===`);
    console.log(`tracker table present: ${hasTracker}`);
    console.log(`files in codebase: ${files.length} · tracked: ${tracked.size}`);
    console.log(`\nBEFORE:`);
    console.log(`  TRACKED            ${by("TRACKED").length}`);
    console.log(`  APPLIED_EVIDENCE   ${by("APPLIED_EVIDENCE").length}  (untracked, but their objects EXIST → baseline-stamp)`);
    console.log(`  MISSING            ${by("MISSING").length}  (untracked, objects absent → APPLY)`);
    console.log(`  NO_DDL_SIGNAL      ${by("NO_DDL_SIGNAL").length}  (alter-only/data-only; can't evidence — treat by position)`);
    if (by("MISSING").length) { console.log(`\n  files to APPLY:`); for (const s of by("MISSING")) console.log(`    - ${s.file} (${s.objectsPresent}/${s.objectsExpected} objects)`); }
    if (by("APPLIED_EVIDENCE").length) { console.log(`\n  files to BASELINE-STAMP (already applied by evidence):`); for (const s of by("APPLIED_EVIDENCE")) console.log(`    - ${s.file}`); }
    console.log(`\nRECONCILE PLAN (review before running):`);
    console.log(`  1. Verify the APPLIED_EVIDENCE + NO_DDL_SIGNAL set really ran (spot-check objects).`);
    console.log(`  2. \`npx tsx scripts/migrate.ts --baseline\`  → stamp all already-applied files (no DDL).`);
    console.log(`  3. \`npm run db:migrate\`                    → apply only the genuinely-missing files.`);
    console.log(`  (Because every migration is idempotent, step 3 replaying an applied file is a safe no-op.)`);
    console.log(`\nAFTER (expected): tracker = ${files.length} files, matching the codebase.\n`);

    // Machine-readable summary for the rehearsal harness.
    if (process.env.MIGRATION_REPORT_JSON === "1") console.log("JSON " + JSON.stringify({ files: files.length, tracked: tracked.size, applied_evidence: by("APPLIED_EVIDENCE").length, missing: by("MISSING").length, no_ddl: by("NO_DDL_SIGNAL").length }));
  } finally {
    db.release(); await pool.end();
  }
}
main().catch((e) => { console.error("[migration-state-report] fatal:", e); process.exit(2); });
