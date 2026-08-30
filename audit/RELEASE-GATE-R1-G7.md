# Release Gate R1-G7 — Migration reconciliation + backup/restore/rollback rehearsal (verification)

The remaining **release blocker** for the pilot (per the milestone correction): migration reconciliation → clean-rebuild proof → backup/restore rehearsal → recovery/rollback rehearsal. Not solved by declaring environments equivalent — proven by rehearsal against throwaway databases.

## Delivered
- `scripts/migrate.ts` — hardened: idempotent tracked apply, `--dry-run`, and `--baseline` (reconcile: stamp files as applied WITHOUT running DDL, for a DB verified to be at current schema). Clearer reporting (`N applied, M already tracked`).
- `scripts/release-rehearsal.ts` — the rehearsal, against throwaway `r1_rebuild` / `r1_restore` DBs (never prod).
- `docs/OPERATIONS.md` — forward-migration, the stale-tracker safe reconciliation procedure, backup, restore, and the rollback/recovery strategy + pre-pilot checklist.

## Rehearsal — 8 / 8
- **Clean rebuild from zero:** every migration applies from an empty database via the real `db:migrate` runner; the full set is tracked.
- **Idempotent re-run:** re-running applies nothing.
- **Stale tracker replays safely:** dropping 10 tracker rows (simulated drift) and re-running **re-applies those migrations with no error** — the idempotent DDL is why a drifted prod tracker is harmless, and why we never hand-declare equivalence.
- **Baseline reconcile:** `--baseline` stamps every file as applied without running DDL.
- **Backup → restore round-trip:** a dumped row reappears after restore into a fresh migrated DB, and row counts match the source.

## The prod migration-state resolution
Prod's `schema_migrations` is stale (0012; later migrations applied by hand). Because every migration is idempotent, the safe reconciliation is: **verify** current schema (clean-rebuild parity / object spot-check), then either `npm run db:migrate` (untracked-but-applied files re-run as safe no-ops, catching the tracker up) or `--baseline` after that verification. Documented in `docs/OPERATIONS.md`; `README`'s "run `db:migrate`" is now safe because replay is idempotent.

## Rollback / recovery strategy (documented + rehearsed)
Forward-only migrations; recovery is restore-based: app rollback = redeploy prior build; RLS regression = repoint `DATABASE_URL` at owner (RLS inert); bad schema/data = fresh DB + `db:migrate` + `backup-restore` the last good dump + cut over (the exact path `release-rehearsal` exercises).

## Gate
tsc **clean** · rehearsal **8/8** (clean rebuild · idempotent · stale-tracker-safe · baseline · backup/restore round-trip) · migration runner hardened + reconcile mode · operations documented · regression suite green.

## Still required before the pilot (release-blocking, tracked)
- Reconcile the **actual** prod tracker per `docs/OPERATIONS.md` (an ops action against prod, not a code change).
- Set `BACKUP_DIR` + rehearse a restore from a real prod backup; offsite + encrypted backup volume.
- External error tracking / alerting (the R1-G6/D3 pre-pilot gate).

**R1-G7 complete. Proceeding to R1-G8 (the three-organization authenticated pilot proof — happy + adverse paths through the running app).**
