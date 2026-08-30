import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getPool } from "../src/db/client";
import { dumpDatabase } from "../src/lib/backup/dump";
import { encryptBackup } from "../src/lib/backup/crypto";

/**
 * On-demand logical backup of the database DATABASE_URL points at.
 *
 *   npx tsx --env-file=.env.local scripts/backup-dump.ts [outDir]
 *
 * Writes pursuitos-backup-<timestamp>.json.gz. The file is a full copy of
 * tenant data — store it privately, never commit it (backups/ is gitignored).
 */
async function main() {
  const outDir = process.argv[2] ?? "backups";
  mkdirSync(outDir, { recursive: true });

  const schemaVersion = existsSync("supabase/migrations")
    ? readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().pop() ?? null
    : null;

  const pool = getPool();
  const db = await pool.connect();
  try {
    const dump = await dumpDatabase(db, { schemaVersion });
    const stamp = dump.manifest.createdAt.replace(/[:.]/g, "-").slice(0, 19);
    const gz = gzipSync(Buffer.from(JSON.stringify(dump), "utf8"));
    // OR-2: encrypt at rest when a key is configured (recommended/required for a pilot).
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    const enc = key ? encryptBackup(gz, key) : gz;
    const path = join(outDir, `pursuitos-backup-${stamp}.json.gz${key ? ".enc" : ""}`);
    writeFileSync(path, enc);
    if (key) console.log("encrypted at rest (AES-256-GCM)");

    const totalRows = Object.values(dump.manifest.rowCounts).reduce((a, b) => a + b, 0);
    console.log(`wrote ${path} (${(gz.length / 1024).toFixed(0)} KB gz)`);
    console.log(`schema ${schemaVersion ?? "?"} · ${dump.manifest.tableOrder.length} tables · ${totalRows.toLocaleString()} rows`);
    for (const t of dump.manifest.tableOrder) {
      const n = dump.manifest.rowCounts[t];
      if (n > 0) console.log(`  ${t}: ${n.toLocaleString()}`);
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
