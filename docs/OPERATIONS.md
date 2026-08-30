# PursuitOS — Operations: migrations, backup, restore, rollback

Forward-migration, reconciliation, and recovery procedures. Rehearsed by
`scripts/release-rehearsal.ts` (R1-G7): clean rebuild · idempotent re-run · stale-tracker-safe replay · baseline reconcile · backup→restore round-trip.

## Migrations

- **Runner:** `npm run db:migrate` (`scripts/migrate.ts`) applies `supabase/migrations/*.sql` in filename order, tracking applied files in `schema_migrations`.
- **Idempotent by construction:** every migration uses `create ... if not exists`, `add column if not exists`, and `drop policy/constraint if exists` then create. Re-applying an already-applied file is a safe no-op. This is what makes a drifted tracker harmless rather than dangerous.
- **Modes:**
  - default — apply every untracked file.
  - `--dry-run` — print what would apply; change nothing.
  - `--baseline` — **reconcile**: stamp every file as applied WITHOUT running DDL. Use ONLY on a database already verified to be at the current schema.

### The stale-tracker situation (and the safe fix)

Production's `schema_migrations` drifted (migrations were applied by hand via the SQL editor), so the tracker does not reflect reality. **Do not** "declare environments equivalent" by editing the tracker blindly. The safe procedure:

1. **Verify** the DB is actually at the current schema — the cleanest proof is that a full clean rebuild (`release-rehearsal`) produces the same object set, and/or spot-check that the objects each recent migration creates already exist.
2. Because migrations are idempotent, the lowest-risk reconciliation is simply **`npm run db:migrate`**: untracked-but-already-applied files re-run as safe no-ops and the tracker catches up to reality. (Rehearsed: dropping tracker rows and re-running replays with no error.)
3. If re-running DDL against prod is undesirable, use **`npx tsx scripts/migrate.ts --baseline`** to stamp the ledger to current *after* step 1's verification — never before.

Forward migrations from here: add a new `NNNN_*.sql` (idempotent), run `db:migrate`. The tracker stays correct once reconciled.

## Backup

- **Library:** `src/lib/backup/dump.ts` — a logical `to_jsonb`-per-table dump in FK-topological order with a manifest (schema version, row counts).
- **On demand:** `npx tsx scripts/backup-dump.ts [outDir]` → `pursuitos-backup-<ts>.json.gz` (private; `backups/` is gitignored).
- **Scheduled:** the worker writes a nightly gzip to `BACKUP_DIR` (default off — **set `BACKUP_DIR` for the pilot**), pruned to `BACKUP_KEEP` (14). Pilot prerequisites: an offsite copy and encryption at rest for the backup volume.

## Restore

- `TARGET_DATABASE_URL=postgres://… npx tsx scripts/backup-restore.ts <file.json.gz> [--force]`.
- `TARGET_DATABASE_URL` is deliberately a **different** variable from `DATABASE_URL` so a restore can never hit prod by accident. Restore into a database that **already has the schema** (bootstrap + `db:migrate` on a fresh project), then restore data. Rehearsed: a dumped row reappears after restore and row counts match the source.

## Rollback / recovery strategy

Migrations are **forward-only** (no down-path). Recovery is therefore restore-based, matched to the failure:

- **Bad app deploy** — redeploy the previous build (no schema change needed).
- **RLS/cutover regression** — the documented RLS-level rollback: repoint `DATABASE_URL` at the owner string and redeploy (RLS goes inert); investigate; re-point at `app_rw`.
- **Bad schema change / data corruption** — provision a fresh database, bootstrap + `db:migrate` to the target schema, then `backup-restore` the last good logical backup into it and cut over. Rehearsed end-to-end by `release-rehearsal`.

## Pre-pilot checklist (release-blocking)

- [ ] Reconcile the prod migration tracker per the safe procedure above (verify, then `db:migrate` or `--baseline`).
- [ ] `BACKUP_DIR` set; a backup produced and its restore rehearsed into a throwaway target.
- [ ] External error tracking / alerting wired (the pre-pilot gate named in R1-G6/D3).
