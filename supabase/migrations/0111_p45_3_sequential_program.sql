-- 0111 — P45-3: the sequential multi-step runtime needs ONE new ledger word.
--
-- WHAT THIS IS, AND WHY IT IS THE WHOLE MIGRATION. Every structural thing a sequential program
-- needs already exists. 0109 gave `pursuit_run_steps` a `seq` with `unique (run_id, seq)`, a
-- per-step idempotency key that already includes the position, per-step retry state, and `app_rw`
-- INSERT on the table. `resumeRun` already selects the lowest-seq eligible step and already has a
-- "no steps left → COMPLETED" branch. Slice 1 simply never created a second step, and treated the
-- first success as the end of the run.
--
-- The one thing that does NOT exist is a word for "a step succeeded and the run continues".
-- `change_ledger.change_type` is CHECK-constrained, so without this the runtime would have to
-- either emit RUN_COMPLETED for a run that has not completed — making the audit lie — or emit
-- nothing, losing a real transition from the single event model. Neither is acceptable, so the
-- vocabulary gains exactly one value.
--
-- THE AUDIT CONTRACT THIS ENCODES (owner ruling 2) — read this before consuming the events:
--
--     RUN_STARTED → RUN_STEP_COMPLETED → RUN_STEP_COMPLETED → RUN_COMPLETED
--
-- for a three-step successful program. The FINAL successful step emits RUN_COMPLETED and does NOT
-- also emit RUN_STEP_COMPLETED. So a consumer must NOT infer that every completed step has its own
-- RUN_STEP_COMPLETED event: the count of RUN_STEP_COMPLETED is (successful steps − 1) for a program
-- that ran to completion. This deliberately preserves the Slice-1 single-step contract byte for
-- byte — a one-step run still emits exactly RUN_STARTED → RUN_COMPLETED, with no new event — so
-- P45-1 and P45-2 evidence remains valid without reinterpretation.
--
-- NOT IN THIS MIGRATION, by owner ruling: no new table, no new column, no new privilege, no new
-- policy, no new role, no RLS change, no SECURITY DEFINER, no grant. `change_ledger` remains
-- INSERT/SELECT only for `app_rw` — this migration does not touch its privileges at all.
-- Dependency edges (a DAG), parallel branches and plan-derived program synthesis are separate
-- future work and are NOT prepared for here.

-- ── 1. Ledger vocabulary — one value, every prior value kept (the 0103 §5 pattern) ───────────────
-- Read the current definition, append, never rewrite. Re-running is a no-op.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%RUN_STEP_COMPLETED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, ']))', ', ''RUN_STEP_COMPLETED''::text]))');
  end if;
end $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Additive vocabulary only. Reverting would refuse any already-recorded RUN_STEP_COMPLETED row,
-- so it is only safe while no multi-step program has ever run. The value is inert otherwise.
