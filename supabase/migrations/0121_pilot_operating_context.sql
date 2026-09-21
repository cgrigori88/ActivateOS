-- 0121 — Pilot operating context, reversible intake lineage, and attention selection (Slice 2).
--
-- Three things, all of which exist because discovery found the current shape cannot support a real
-- pilot without an engineer holding a SQL prompt.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

-- ── 1. THE OPERATING CONTEXT CARRIES ITS OWN PROVENANCE ─────────────────────────────────────────
-- The organization is the only real tenant boundary in this product: `kind` is full/guest, which is
-- a partnership concept, and there is no scope below it. So "which world am I operating in" is a
-- property of the organization, and the pilot needs an organization of its own rather than sharing
-- the seeded demo world.
--
-- NULLABLE, NO DEFAULT — the same discipline as `api_keys.data_environment` in 0120. A default would
-- let an organization acquire a provenance nobody chose, and PRODUCTION as that default would do it
-- in the direction that reaches a learning corpus. The three seeded organizations stay NULL until
-- someone says what they are; nothing depends on them having a value.
alter table organizations add column if not exists data_environment text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_data_environment_check') then
    alter table organizations add constraint organizations_data_environment_check
      check (data_environment is null or data_environment in (
        'PRODUCTION', 'PILOT', 'CERTIFICATION', 'DEMO', 'TEST', 'SYNTHETIC', 'SIMULATION', 'BACKTEST'));
  end if;
end $$;

-- ── 2. INTAKE: PROVENANCE, REAL ATTRIBUTION, AND HONEST COUNTS ──────────────────────────────────
-- `uploaded_by` has always held the literal string 'web', so no committed import could say who ran
-- it. The real identity is server-derived; a file cannot supply it.
alter table import_batches add column if not exists data_environment text;
alter table import_batches add column if not exists uploaded_by_user_id uuid references auth.users(id) on delete set null;
alter table import_batches add column if not exists updated_count integer not null default 0;
alter table import_batches add column if not exists no_change_count integer not null default 0;
alter table import_batches add column if not exists rejected_count integer not null default 0;
alter table import_batches add column if not exists reversed_at timestamptz;
alter table import_batches add column if not exists reversed_by_user_id uuid references auth.users(id) on delete set null;
alter table import_batches add column if not exists reversal_summary jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_batches_data_environment_check') then
    alter table import_batches add constraint import_batches_data_environment_check
      check (data_environment is null or data_environment in (
        'PRODUCTION', 'PILOT', 'CERTIFICATION', 'DEMO', 'TEST', 'SYNTHETIC', 'SIMULATION', 'BACKTEST'));
  end if;
end $$;

-- ── 3. BATCH EFFECTS — THE LINEAGE THAT COMMIT USED TO DESTROY ──────────────────────────────────
-- `commitImportBatch` ended in `delete from import_rows where batch_id = $1`, so the moment an
-- import succeeded, the only record of what it had done was three integer counts. Nothing could
-- explain it, audit it, or undo it.
--
-- This is NOT the raw upload kept forever. It is the bounded set of facts reversal and provenance
-- actually need: which canonical subject, what happened to it, and — only where a conflict could
-- later arise — the exact value this batch wrote.
--
-- `fields_written` IS OMITTED FOR FILL-ONLY UPDATES' BEFORE-STATE, DELIBERATELY. Every update this
-- intake performs is `coalesce(existing, new)`, so the before-state is STRUCTURALLY NULL and
-- serializing it would be storing a constant. What is stored is the value written, which is the
-- thing a conflict check has to compare against.
create table if not exists import_batch_effects (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  batch_id       uuid not null references import_batches(id) on delete cascade,
  source_row_no  integer,
  subject_kind   text not null check (subject_kind in (
                   'company', 'company_alias', 'contact', 'opportunity', 'crm_snapshot',
                   'evidence', 'partner_account', 'account_population', 'population_member')),
  subject_id     uuid not null,
  -- THE FIVE DISPOSITIONS. Anything that is not one of these is not a reversible fact.
  effect         text not null check (effect in (
                   'GLOBAL_IDENTITY_RETAINED',   -- shared identity graph; reversal never touches it
                   'CREATED_REVERSIBLE',         -- org-scoped, created solely by this batch
                   'MATCHED_PREEXISTING',        -- existed before; reversal never removes it
                   'UPDATED_REVERSIBLE',         -- fill-only write; reversible while unchanged
                   'NO_CHANGE')),                -- the row already said this
  fields_written jsonb,
  data_environment text,
  recorded_at    timestamptz not null default now()
);
create index if not exists import_batch_effects_batch on import_batch_effects (org_id, batch_id);
create index if not exists import_batch_effects_subject on import_batch_effects (org_id, subject_kind, subject_id);

-- ── 4. REVERSALS — WHAT COULD AND COULD NOT BE UNDONE ───────────────────────────────────────────
-- Reversal COMPENSATES; it does not erase. A reversed batch keeps its row, its effects and this
-- record of what each effect's reversal actually did — including the ones that refused.
create table if not exists import_batch_reversals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  batch_id     uuid not null references import_batches(id) on delete cascade,
  effect_id    uuid references import_batch_effects(id) on delete cascade,
  disposition  text not null check (disposition in (
                 'REVERSED',              -- the org-scoped row was removed or restored
                 'RETAINED_GLOBAL',       -- shared identity, retained by rule
                 'RETAINED_MATCHED',      -- pre-existed the batch
                 'ROLLBACK_CONFLICT',     -- later state diverged; the later state was kept
                 'RETAINED_REFERENCED')), -- downstream business activity depends on it
  reason       text,
  detail       jsonb,
  reversed_at  timestamptz not null default now()
);
create index if not exists import_batch_reversals_batch on import_batch_reversals (org_id, batch_id);

-- ── 5. ATTENTION OBSERVATIONS — TWO POSITIONS, NEVER ONE ────────────────────────────────────────
-- 0118 prepared a single `rank`. Discovery then established that on both ranked surfaces the
-- canonical P2 rank and the card's visual position are DIFFERENT NUMBERS: Today orders by the
-- materiality policy with pertinence only as a third key and cuts to a top-K, and /pipeline offers
-- two sort modes. Storing one number called `rank` would have made the observation a claim we
-- cannot support.
--
-- The table is empty everywhere (0 rows local and hosted; attention capture shipped PREPARED and was
-- never activated), so this restructures it rather than migrating data.
alter table attention_observations drop constraint if exists attention_observations_unique;
-- Guarded: a rename is the one statement in this file with no `if exists` form of its own, and a
-- migration that fails on its second run is not a migration.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name = 'attention_observations' and column_name = 'rank') then
    alter table attention_observations rename column rank to p2_rank;
  end if;
end $$;
alter table attention_observations add column if not exists surface_ordinal integer;
alter table attention_observations add column if not exists surface_id text;
alter table attention_observations add column if not exists surface_version text;
alter table attention_observations add column if not exists sort_mode text;
alter table attention_observations add column if not exists filters jsonb;
alter table attention_observations add column if not exists display_limit integer;
alter table attention_observations add column if not exists selected_by_user_id uuid references auth.users(id) on delete set null;
alter table attention_observations add column if not exists rendered_at timestamptz;
alter table attention_observations add column if not exists selected_at timestamptz;
alter table attention_observations add column if not exists token_nonce text;
-- The decision link came from a design that attached the snapshot to a plan recommendation. That is
-- now ruled out — `recommend_pursuit_plan@1` never consumed P2 — so the columns go rather than
-- linger as an invitation.
alter table attention_observations drop column if exists decision_ref_kind;
alter table attention_observations drop column if exists decision_ref_id;
drop index if exists attention_observations_decision;

-- IDEMPOTENCE IS THE TOKEN'S, NOT THE RANKING'S. One deliberate selection is one observation, and
-- replaying the identical token writes nothing. A freshly rendered surface mints a new nonce, so a
-- later deliberate selection is legitimately a new observation even if the ranking has not moved.
create unique index if not exists attention_observations_token
  on attention_observations (org_id, token_nonce) where token_nonce is not null;

-- ── 6. PRIVILEGES — APPEND-ONLY, PROVED RATHER THAN ASSERTED ────────────────────────────────────
-- `alter default privileges` grants app_rw `arwd` on every new table, so a GRANT alone adds nothing.
-- The REVOKE is what makes these append-only, exactly as 0094, 0117 and 0118 did.
--
-- `import_batch_effects` is append-only because it is the evidence a reversal reasons from: a
-- lineage that can be edited cannot justify deleting a row.
grant select, insert on import_batch_effects to app_rw;
revoke update, delete on import_batch_effects from app_rw;
grant select, insert on import_batch_reversals to app_rw;
revoke update, delete on import_batch_reversals from app_rw;

alter table import_batch_effects enable row level security;
alter table import_batch_effects force row level security;
alter table import_batch_reversals enable row level security;
alter table import_batch_reversals force row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='import_batch_effects' and policyname='import_batch_effects_rw') then
    create policy import_batch_effects_rw on import_batch_effects for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='import_batch_reversals' and policyname='import_batch_reversals_rw') then
    create policy import_batch_reversals_rw on import_batch_reversals for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
end $$;
