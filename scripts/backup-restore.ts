import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";
import { restoreDatabase, type BackupFile } from "../src/lib/backup/dump";
import { decryptBackup, isEncrypted } from "../src/lib/backup/crypto";

/**
 * Restore a logical backup into a database that already has the schema
 * (run the migrations first on a fresh project, then restore).
 *
 *   TARGET_DATABASE_URL=postgres://... npx tsx scripts/backup-restore.ts <file.json.gz> [--force]
 *
 * TARGET_DATABASE_URL is deliberately a different variable from DATABASE_URL —
 * a restore should never point at production by accident. Tables that already
 * contain rows are skipped unless --force.
 */
async function main() {
  const [file, forceFlag] = process.argv.slice(2);
  const target = process.env.TARGET_DATABASE_URL;
  if (!file || !target) {
    console.error("usage: TARGET_DATABASE_URL=postgres://... npx tsx scripts/backup-restore.ts <file.json.gz> [--force]");
    process.exit(1);
  }

  let raw: Buffer = readFileSync(file);
  if (isEncrypted(raw)) {
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    if (!key) { console.error("encrypted backup — set BACKUP_ENCRYPTION_KEY to restore"); process.exit(1); }
    raw = decryptBackup(raw, key);
  }
  const dump = JSON.parse(gunzipSync(raw).toString("utf8")) as BackupFile;
  console.log(`restoring ${file}`);
  console.log(`  created ${dump.manifest.createdAt} · schema ${dump.manifest.schemaVersion ?? "?"} · ${dump.manifest.tableOrder.length} tables`);

  const pool = new Pool({ connectionString: target, max: 1 });
  const db = await pool.connect();
  try {
    const result = await restoreDatabase(db, dump, { force: forceFlag === "--force" });
    console.log(`restored ${result.rows.toLocaleString()} rows into ${result.tables} tables (${result.mode} mode)`);
    if (result.skippedNonEmpty.length) {
      console.warn(`skipped non-empty tables (use --force to override): ${result.skippedNonEmpty.join(", ")}`);
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
