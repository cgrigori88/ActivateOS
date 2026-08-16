import type pg from "pg";

/**
 * Logical database backup (task #70). Supabase's free tier keeps NO restorable
 * backups (verified via the Management API: pitr_enabled=false, empty backup
 * list), so the platform carries its own: a full logical dump of every public
 * table as jsonb, restorable into any Postgres with the migrations applied.
 *
 * Design constraints:
 *  - No pg_dump dependency — the worker container and serverless runtimes only
 *    have the `pg` driver, so the dump is plain SQL: `to_jsonb(row)` per table.
 *  - Restore order matters — tables are topologically sorted by FK dependency
 *    at dump time and the order is stored in the manifest. Restore also tries
 *    `session_replication_role = replica` first (works where permitted, e.g.
 *    self-hosted/local), falling back to the stored order.
 *  - A backup is a complete copy of tenant data. Treat the produced file with
 *    the same care as the database itself: private storage only, encrypted at
 *    rest where possible, and rotated (the worker prunes old files).
 */

export interface BackupManifest {
  version: 1;
  createdAt: string;
  /** newest migration filename at dump time — restore target must match */
  schemaVersion: string | null;
  /** FK-topological insert order */
  tableOrder: string[];
  rowCounts: Record<string, number>;
}

export interface BackupFile {
  manifest: BackupManifest;
  /** table name → array of row objects (to_jsonb output) */
  tables: Record<string, unknown[]>;
}

/** Public base tables, excluding transient staging (a backup of raw staged
 * uploads would outlive the delete-on-decision contract they were made under). */
const EXCLUDED = new Set(["import_rows", "schema_migrations"]);

async function listTables(db: pg.PoolClient): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDED.has(t));
}

/** Foreign-key edges among public tables: table → set of tables it references. */
async function fkEdges(db: pg.PoolClient): Promise<Map<string, Set<string>>> {
  const { rows } = await db.query<{ src: string; dst: string }>(
    `select distinct tc.table_name as src, ccu.table_name as dst
     from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const edges = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.src === r.dst) continue; // self-references can't order themselves
    if (!edges.has(r.src)) edges.set(r.src, new Set());
    edges.get(r.src)!.add(r.dst);
  }
  return edges;
}

/** Kahn topo sort: referenced tables first. Cycles (rare) go last, flagged. */
export function topoOrder(tables: string[], edges: Map<string, Set<string>>): string[] {
  const remaining = new Set(tables);
  const out: string[] = [];
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const t of [...remaining]) {
      const deps = edges.get(t);
      const blocked = deps && [...deps].some((d) => remaining.has(d));
      if (!blocked) {
        out.push(t);
        remaining.delete(t);
        progressed = true;
      }
    }
  }
  // anything left participates in a cycle — append; restore relies on replica
  // mode or a second pass for these.
  out.push(...remaining);
  return out;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/** Quote-guard: table names come from the catalog, but belt-and-braces. */
function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`unexpected table identifier: ${name}`);
  return `"${name}"`;
}

export async function dumpDatabase(
  db: pg.PoolClient,
  opts: { schemaVersion?: string | null } = {},
): Promise<BackupFile> {
  const tables = await listTables(db);
  const edges = await fkEdges(db);
  const order = topoOrder(tables, edges);

  const out: BackupFile = {
    manifest: {
      version: 1,
      createdAt: new Date().toISOString(),
      schemaVersion: opts.schemaVersion ?? null,
      tableOrder: order,
      rowCounts: {},
    },
    tables: {},
  };

  // Sequential on one client — parallel query() on a single client only queues
  // (and is removed in pg@9). Current data volumes fit one jsonb_agg per table;
  // if a table ever outgrows that, chunk by primary key here.
  for (const t of order) {
    const { rows } = await db.query<{ data: unknown[] }>(
      `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as data from ${ident(t)} x`,
    );
    const data = rows[0]?.data ?? [];
    out.tables[t] = data;
    out.manifest.rowCounts[t] = data.length;
  }
  return out;
}

export interface RestoreResult {
  tables: number;
  rows: number;
  mode: "replica" | "fk-order";
  skippedNonEmpty: string[];
}

/**
 * Restore a dump into a database that already has the schema (run migrations
 * first). Refuses tables that already contain rows unless `force` — a restore
 * must never silently double data into a live system.
 */
export async function restoreDatabase(
  db: pg.PoolClient,
  dump: BackupFile,
  opts: { force?: boolean } = {},
): Promise<RestoreResult> {
  // Probe replica mode at SESSION level, before the transaction — a failed SET
  // inside a transaction would poison it and kill the fallback path.
  let mode: RestoreResult["mode"] = "fk-order";
  try {
    await db.query(`set session_replication_role = replica`);
    mode = "replica";
  } catch {
    /* not permitted (managed PG) — rely on manifest order */
  }
  await db.query("begin");
  try {
    const skippedNonEmpty: string[] = [];
    let rowsInserted = 0;
    let tablesRestored = 0;

    for (const t of dump.manifest.tableOrder) {
      const data = dump.tables[t];
      if (!data || data.length === 0) continue;
      if (!IDENT_RE.test(t)) throw new Error(`unexpected table identifier in manifest: ${t}`);

      const { rows: existing } = await db.query<{ n: string }>(`select count(*)::text as n from ${ident(t)}`);
      if (Number(existing[0].n) > 0 && !opts.force) {
        skippedNonEmpty.push(t);
        continue;
      }

      for (let i = 0; i < data.length; i += 1000) {
        const chunk = data.slice(i, i + 1000);
        const res = await db.query(
          `insert into ${ident(t)} select * from jsonb_populate_recordset(null::${ident(t)}, $1::jsonb)
           on conflict do nothing`,
          [JSON.stringify(chunk)],
        );
        rowsInserted += res.rowCount ?? 0;
      }
      tablesRestored++;
    }

    await db.query("commit");
    return { tables: tablesRestored, rows: rowsInserted, mode, skippedNonEmpty };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  } finally {
    if (mode === "replica") await db.query(`set session_replication_role = origin`).catch(() => {});
  }
}
