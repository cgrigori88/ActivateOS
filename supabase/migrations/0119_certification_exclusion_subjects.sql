-- 0119 — Certification exclusion: the subject kinds the hosted reconciliation actually needs.
--
-- WHY THIS IS A SEPARATE MIGRATION AND NOT AN EDIT TO 0118. 0118 is already applied locally, and a
-- `create table if not exists` does not revisit a CHECK on a table that already exists. Editing it
-- in place would therefore be a migration that silently does nothing on every database that has
-- already run it — which is the worst of both worlds. Forward-only, as everywhere else.
--
-- WHY THE VOCABULARY GREW. 0118 guessed three subject kinds from the local clone. Enumerating the
-- hosted Preview project instead of guessing found 31 rows carrying data_environment = 'PRODUCTION'
-- across SEVEN structures, not three:
--
--     governed_action_invocations  18      pursuit_participants   4
--     change_ledger                 2      context_contributions  2
--     context_grants                2      recompute_requests     2
--     pursuit_overrides             1
--
-- and all 14 hosted pursuits are DEMO — so every one of those 31 rows is mislabelled, and none of
-- them records genuine production activity.
--
-- THE PART THAT MATTERS FOR DESIGN. Only the effect refs are reachable from their parent: they
-- carry `invocation_id`, so excluding an invocation deterministically excludes its declared
-- effects. The OTHER 13 rows are NOT reachable that way — the two ledger rows have
-- `invocation_id IS NULL`, and participants, contributions, grants, recompute requests and the
-- override carry no invocation linkage at all. Parent exclusion is therefore NOT sufficient, and
-- each of those subjects has to be named in its own right. That is the whole reason this vocabulary
-- is wider than 0118 assumed.
--
-- `pursuit` is retained from 0118 although no hosted pursuit needs it today: the day a certification
-- gate creates a pursuit under a real-world label, naming it must not require a migration.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'certification_exclusions_subject_kind_check'
     and conrelid = 'certification_exclusions'::regclass;
  if def is null or def not like '%pursuit_participant%' then
    execute 'alter table certification_exclusions drop constraint if exists certification_exclusions_subject_kind_check';
    execute $c$alter table certification_exclusions add constraint certification_exclusions_subject_kind_check
      check (subject_kind in (
        'governed_action_invocation', 'change_ledger', 'pursuit', 'pursuit_participant',
        'context_contribution', 'context_grant', 'recompute_request', 'pursuit_override'))$c$;
  end if;
end $$;

-- The manifest must say WHICH certification activity a subject belongs to, so a later reader can
-- tell the P45-4 boundary runs from the P8-0 observation runs without consulting a timestamp — the
-- identification method this whole mechanism exists to replace.
alter table certification_exclusions add column if not exists gate_label text;

-- Still append-only. `alter default privileges` grants app_rw `arwd` on new tables, and a new COLUMN
-- on an existing table inherits that table's existing grants — but the REVOKE is restated because
-- an assertion that is only true by inheritance is one refactor away from being false.
revoke update, delete on certification_exclusions from app_rw;
