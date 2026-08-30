import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";

/**
 * Apply supabase/migrations/*.sql in order, tracking applied files in
 * schema_migrations. Migrations are authored idempotently (create-if-not-exists,
 * add-column-if-not-exists, drop-policy/constraint-then-create), so re-applying an
 * already-applied file is a safe no-op — which is what makes a stale tracker harmless
 * rather than dangerous (R1-G7).
 *
 * Modes:
 *   (default)     apply every file not yet tracked.
 *   --baseline    RECONCILE: stamp every migration file as applied WITHOUT running it.
 *                 Use ONLY on a database already verified to be at the current schema
 *                 (e.g. a prod whose tracker drifted, after confirming the objects
 *                 exist). This adopts the ledger to reality without re-running DDL —
 *                 it never asserts equivalence on its own; you must verify first.
 *   --dry-run     print what would be applied; change nothing.
 */
async function main() {
  const mode = process.argv.includes("--baseline") ? "baseline" : process.argv.includes("--dry-run") ? "dry" : "apply";
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let applied = 0, stamped = 0, skipped = 0;
    for (const file of files) {
      const { rowCount } = await client.query("select 1 from schema_migrations where filename = $1", [file]);
      if (rowCount) { skipped++; continue; }
      if (mode === "baseline") {
        await client.query("insert into schema_migrations (filename) values ($1) on conflict do nothing", [file]);
        stamped++; continue;
      }
      if (mode === "dry") { console.log(`would apply ${file}`); applied++; continue; }
      console.log(`applying ${file}`);
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        applied++;
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    if (mode === "baseline") console.log(`baseline: stamped ${stamped} file(s) as applied (${skipped} already tracked) — no DDL run`);
    else if (mode === "dry") console.log(`dry-run: ${applied} file(s) would apply, ${skipped} already tracked`);
    else console.log(`migrations up to date (${applied} applied, ${skipped} already tracked)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
