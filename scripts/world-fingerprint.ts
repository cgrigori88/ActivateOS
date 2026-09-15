import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";

/**
 * Whole-world fingerprint (H1A — certification integrity).
 *
 * WHY. The canonical demo manifest counts fifteen tables and a handful of hero rows. A verifier
 * that mutates anything else — a route selection, a team acceptance, a ledger row — leaves the
 * manifest digest untouched and the world silently different. That happened: team-motion-verify
 * committed a route selection and team invites/accepts onto the Globex hero, staling the certified
 * Slice 2A recommendation, and only a downstream verifier noticed.
 *
 * WHAT. For EVERY base table in `public`: its row count and an order-independent content hash
 * (md5 of the sorted per-row md5s of the full row text). The world digest hashes all of them. Two
 * fingerprints are equal iff every table holds exactly the same rows — any insert, update or delete
 * anywhere shows up, and `--compare` names the table.
 *
 * Read-only: one READ ONLY transaction, no writes, no DDL.
 *
 *   npx tsx scripts/world-fingerprint.ts                       # print digest + per-table summary
 *   npx tsx scripts/world-fingerprint.ts --out before.json     # save
 *   npx tsx scripts/world-fingerprint.ts --compare before.json # exit 1 on any drift, naming tables
 */

export interface WorldFingerprint {
  digest: string;
  tables: Record<string, { rows: number; hash: string }>;
  takenAt: string;
}

export async function fingerprintWorld(connectionString: string): Promise<WorldFingerprint> {
  const pool = new Pool({ connectionString, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("begin read only");
    const tables = (await db.query<{ t: string }>(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t);
    const out: WorldFingerprint["tables"] = {};
    for (const t of tables) {
      const r = (await db.query<{ n: string; h: string | null }>(
        `select count(*)::text n, md5(coalesce(string_agg(x.h, '' order by x.h), '')) h
           from (select md5(t::text) h from public.${quoteIdent(t)} t) x`)).rows[0];
      out[t] = { rows: Number(r.n), hash: r.h ?? "" };
    }
    await db.query("rollback");
    const digest = createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16);
    return { digest, tables: out, takenAt: new Date().toISOString() };
  } finally {
    db.release();
    await pool.end();
  }
}

export function diffFingerprints(a: WorldFingerprint, b: WorldFingerprint): { table: string; before: number | null; after: number | null }[] {
  const names = [...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])].sort();
  return names
    .filter((t) => a.tables[t]?.hash !== b.tables[t]?.hash || a.tables[t]?.rows !== b.tables[t]?.rows)
    .map((t) => ({ table: t, before: a.tables[t]?.rows ?? null, after: b.tables[t]?.rows ?? null }));
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const conn = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
  const args = process.argv.slice(2);
  const fp = await fingerprintWorld(conn);
  const outIdx = args.indexOf("--out");
  const cmpIdx = args.indexOf("--compare");
  const total = Object.values(fp.tables).reduce((n, t) => n + t.rows, 0);
  console.log(`[world-fingerprint] ${conn.replace(/:[^:@/]*@/, ":***@")}`);
  console.log(`  digest ${fp.digest} · ${Object.keys(fp.tables).length} tables · ${total} rows`);
  if (outIdx >= 0) writeFileSync(args[outIdx + 1], JSON.stringify(fp, null, 2));
  if (cmpIdx >= 0) {
    const before = JSON.parse(readFileSync(args[cmpIdx + 1], "utf8")) as WorldFingerprint;
    const drift = diffFingerprints(before, fp);
    if (drift.length) {
      console.log(`  DRIFT — ${drift.length} table(s) changed since ${before.takenAt} (digest ${before.digest} → ${fp.digest}):`);
      for (const d of drift) console.log(`    ${d.table}: ${d.before} → ${d.after} rows`);
      process.exit(1);
    }
    console.log(`  IDENTICAL to ${before.takenAt} (digest ${before.digest})`);
  }
}

if (process.argv[1]?.endsWith("world-fingerprint.ts")) {
  main().catch((e) => { console.error("[world-fingerprint] fatal:", e); process.exit(1); });
}
