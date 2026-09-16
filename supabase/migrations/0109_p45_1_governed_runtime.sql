-- 0109 — P45-1: the governed Pursuit Runtime (P4 identity + P5 run/step), Slice 1.
--
-- WHAT THIS IS. The first amended-roadmap P4/P5 vertical slice: "execute one approved plan action
-- through the governed Pursuit Runtime". It is PURELY ADDITIVE — four new tables and four nullable
-- columns on two existing tables. Nothing existing is dropped, altered in meaning, or backfilled.
--
-- WHY THESE FOUR TABLES AND NOT MORE. The P4/P5 design gate established that most of the control
-- plane already exists and is certified:
--   • governed_skills            — the capability registry (WHAT may be invoked)     EXISTS
--   • dispatchSkill              — the single consequential-action boundary          EXISTS
--   • governed_action_invocations + action_outbox + executor
--                                — idempotency, retry, dead-letter, compensation     EXISTS
-- What is missing is (a) a durable answer to WHO/WHAT may act, and (b) a durable, resumable RUN.
-- This migration adds exactly those and nothing else. No policy language, no delegation, no DAG,
-- no model routing, no cost budgets — those belong to later AGENT/control-plane slices.
--
-- NO SECURITY DEFINER FUNCTION IS ADDED. The protected-function class stays at 31 / 0 unsafe.
-- No CASCADE beyond the repository's standard `on delete cascade` from organizations/pursuits,
-- which matches every existing tenant-owned table. No destructive change. No backfill.
--
-- ── IDENTITY: why principal_user_id carries NO foreign key ───────────────────────────────────────
-- The certified world has NO populated user identity. auth.users is EMPTY (0 rows) and org_members
-- is EMPTY (0 rows); public.resolve_user_org(null) falls back to the oldest organization, which is
-- how the demo/Basic-Auth posture works. Every existing actor column follows from that fact and
-- carries no FK: change_ledger.actor_id, governed_action_invocations.actor_id,
-- pursuit_plan_revisions.actor_id and pursuit_goals.proposed_by_actor_id are all bare nullable
-- uuids. A REFERENCES auth.users(id) here would make it IMPOSSIBLE to create a USER governed actor
-- in the certified pilot world, so this follows the established convention instead: a nullable uuid
-- holding the auth.users id when auth is configured, and null in demo mode. Adding the FK later is
-- a one-line additive migration once auth.users is populated. This divergence from the gate's
-- "nullable FK" wording is deliberate, reported, and reversible.
--
-- ── CROSS-ORG REFERENCES: what this repository actually does ─────────────────────────────────────
-- The gate asked to prefer composite (org_id, id) foreign keys "where compatible with repo
-- conventions". They are NOT compatible: this schema contains ZERO composite foreign keys across
-- all 155 tables. The certified pattern is single-column FK + RLS(FORCE) + an explicit org-scoped
-- guard in the write path (the `*InOrg` prechecks in the skill registry; `where id = $1 and
-- org_id = $2` in plan-store and multi-vendor).
--
-- This migration follows that certified pattern for references to EXISTING tables, and additionally
-- applies composite org-scoped keys WITHIN the new subsystem only, where no convention is being
-- retrofitted onto a certified table. Each new tenant-owned parent therefore carries unique
-- (org_id, id), and the new children reference it compositely. The practical effect is exactly the
-- goal the gate stated: a Vertex row cannot reference a Meridian actor or run merely because
-- someone knows the UUID — it is refused RELATIONALLY, before RLS is even consulted.

-- TRANSACTION OWNERSHIP. This file carries NO begin/commit, matching every other migration in the
-- repository: the APPLIER owns the transaction (scripts/migrate.ts and the gate's single-migration
-- applier both wrap the file and the schema_migrations insert in one `begin`/`commit`). A `commit;`
-- inside the file would end that transaction early and leave the ledger insert un-atomic with the DDL.

-- ── 1. P4 — governed_actors: WHO or WHAT may act ─────────────────────────────────────────────────
-- An actor is not "an agent". USER, WORKER and SYSTEM must live in the same identity space or
-- policy fragments across four vocabularies. Slice 1 uses USER actors only; the other three types
-- are accepted by the check constraint so later slices need no schema change.
create table if not exists governed_actors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  actor_type        text not null check (actor_type in ('USER','AGENT','WORKER','SYSTEM')),
  -- Stable, human-meaningful slug. Unique per org so a grant or run can be reasoned about without
  -- resolving a uuid, and so re-seeding an environment is idempotent.
  key               text not null,
  display_name      text not null,
  purpose           text,
  -- IDENTITY: for a USER actor this is the acting user. See the header on why there is no FK.
  principal_user_id uuid,
  -- GOVERNANCE OWNERSHIP: who is answerable for this actor existing. Deliberately NOT identity,
  -- and never a substitute for it — an owner may not act as the principal.
  owner_user_id     uuid,
  lifecycle         text not null default 'DRAFT' check (lifecycle in ('DRAFT','ACTIVE','SUSPENDED','RETIRED')),
  data_environment  text not null default 'PRODUCTION',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A USER actor without a principal cannot identify anyone, so it may not be ACTIVE. Enforced in
  -- the database rather than in the runtime module, because this is the whole point of the table.
  constraint governed_actors_user_principal check (
    actor_type <> 'USER' or lifecycle <> 'ACTIVE' or principal_user_id is not null
  ),
  constraint governed_actors_org_key unique (org_id, key)
);
-- The composite target the new subsystem references (see the header). Added only when absent:
-- a drop/add pair is NOT idempotent here, because the composite foreign keys on
-- actor_capability_grants and pursuit_runs depend on this constraint and block the drop on a
-- re-run. Migrations in this repository are authored to be safely re-applied.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'governed_actors_org_id_id_key'
                   and conrelid = 'governed_actors'::regclass) then
    alter table governed_actors add constraint governed_actors_org_id_id_key unique (org_id, id);
  end if;
end $$;
create index if not exists governed_actors_org_lifecycle on governed_actors (org_id, lifecycle, key);
create index if not exists governed_actors_principal on governed_actors (org_id, principal_user_id)
  where principal_user_id is not null;

-- ── 2. P4 — actor_capability_grants: MAY this actor invoke this skill? ───────────────────────────
-- This table answers exactly one question and deliberately duplicates nothing from governed_skills.
-- required_permission, eligible_actors, effect_class, preconditions, approval_required, idempotent
-- and retry_policy all remain the registry's property. A grant permits CONSIDERATION; it never
-- overrides policy.
create table if not exists actor_capability_grants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  actor_id           uuid not null,
  skill_id           text not null,
  -- Null = any registered version. governed_skills is versioned (skill_id, version), so pinning is
  -- available without being mandatory.
  skill_version      integer,
  status             text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  granted_by_user_id uuid,
  -- Slice 2 owns the approval workflow. The column exists now only so Slice 2 needs no migration
  -- against a table that will already hold live grants. It is NULLABLE and UNUSED in Slice 1:
  -- the runtime reads approval_required from governed_skills and ignores this column entirely.
  approval_required_override boolean,
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  constraint actor_capability_grants_actor_fk
    foreign key (org_id, actor_id) references governed_actors (org_id, id) on delete cascade,
  -- A revoked grant keeps its row (history), so uniqueness is scoped to the live one.
  constraint actor_capability_grants_revoked_shape check (
    (status = 'ACTIVE' and revoked_at is null) or (status = 'REVOKED' and revoked_at is not null)
  )
);
create unique index if not exists actor_capability_grants_live
  on actor_capability_grants (org_id, actor_id, skill_id) where status = 'ACTIVE';
create index if not exists actor_capability_grants_lookup
  on actor_capability_grants (org_id, actor_id, skill_id, status);

-- ── 3. P5 — pursuit_runs: what is happening now, and how do we resume ────────────────────────────
-- A run is PERMANENTLY PINNED to the plan revision that justified it (owner ruling 5). It records
-- basis_fingerprint at start so a later evaluation knows what the world looked like when the
-- decision was made — the one non-obvious requirement for keeping P8 possible.
create table if not exists pursuit_runs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  pursuit_id          uuid not null references pursuits(id) on delete cascade,
  plan_id             uuid not null references pursuit_plans(id) on delete cascade,
  -- The pin. A run NEVER retargets: if this revision is superseded, the run is CANCELLED.
  plan_revision_id    uuid not null references pursuit_plan_revisions(id) on delete cascade,
  governed_actor_id   uuid not null,
  initiated_by_user_id uuid,
  status              text not null default 'PENDING' check (status in (
                        'PENDING','READY','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','PAUSED',
                        'RETRYABLE_FAILURE','TERMINAL_FAILURE','COMPLETED','CANCELLED')),
  current_step_id     uuid,
  correlation_id      uuid not null default gen_random_uuid(),
  idempotency_key     text not null,
  -- Durable continuation. No in-memory value is ever authoritative; recovery is a query.
  continuation        jsonb not null default '{}'::jsonb,
  -- Captured AT RUN START from the pinned revision, never recomputed.
  basis_fingerprint   text not null,
  reason              text,
  last_transition_at  timestamptz not null default now(),
  data_environment    text not null default 'PRODUCTION',
  locked_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint pursuit_runs_actor_fk
    foreign key (org_id, governed_actor_id) references governed_actors (org_id, id),
  constraint pursuit_runs_org_idem unique (org_id, idempotency_key)
);
-- Same reasoning: pursuit_run_steps' composite foreign key depends on this one.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pursuit_runs_org_id_id_key'
                   and conrelid = 'pursuit_runs'::regclass) then
    alter table pursuit_runs add constraint pursuit_runs_org_id_id_key unique (org_id, id);
  end if;
end $$;
-- At most ONE live execution of a decided revision. Two runs of the same decision would be two
-- attempts at the same consequential work.
create unique index if not exists pursuit_runs_one_live
  on pursuit_runs (org_id, pursuit_id, plan_revision_id)
  where status not in ('COMPLETED','CANCELLED','TERMINAL_FAILURE');
create index if not exists pursuit_runs_claimable
  on pursuit_runs (org_id, status, last_transition_at);
create index if not exists pursuit_runs_pursuit
  on pursuit_runs (org_id, pursuit_id, created_at desc, id desc);

-- ── 4. P5 — pursuit_run_steps: the unit that actually dispatches ─────────────────────────────────
-- A step never executes anything itself. It calls dispatchSkill, which produces the invocation and
-- (for EXTERNAL_ACTION, which Slice 1 does not use) the outbox row. The certified idempotency,
-- retry, compensation and consent machinery is therefore inherited, not re-implemented.
create table if not exists pursuit_run_steps (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  run_id           uuid not null,
  seq              integer not null check (seq >= 1),
  skill_id         text not null,
  skill_version    integer not null default 1,
  args             jsonb not null default '{}'::jsonb,
  -- Set once dispatchSkill has produced it. Nullable because it does not exist before dispatch —
  -- which is precisely the window a crash can land in, and why recovery keys off the step's own
  -- idempotency_key rather than this column.
  invocation_id    uuid references governed_action_invocations(id) on delete set null,
  status           text not null default 'PENDING' check (status in (
                     'PENDING','READY','RUNNING','WAITING_FOR_APPROVAL','BLOCKED','PAUSED',
                     'RETRYABLE_FAILURE','TERMINAL_FAILURE','COMPLETED','CANCELLED')),
  attempt          integer not null default 0 check (attempt >= 0),
  max_attempts     integer not null default 3 check (max_attempts >= 1),
  next_attempt_at  timestamptz,
  -- Which plan milestone this step advances, when it advances one. Advisory only: milestone
  -- completion stays COMPUTED from canonical state by the plan's declarative rules. The runtime
  -- never writes a milestone.
  milestone_key    text,
  idempotency_key  text not null,
  result           jsonb,
  error            text,
  failure_class    text,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pursuit_run_steps_run_fk
    foreign key (org_id, run_id) references pursuit_runs (org_id, id) on delete cascade,
  constraint pursuit_run_steps_run_seq unique (run_id, seq),
  constraint pursuit_run_steps_org_idem unique (org_id, idempotency_key)
);
create index if not exists pursuit_run_steps_run
  on pursuit_run_steps (org_id, run_id, seq);
create index if not exists pursuit_run_steps_claimable
  on pursuit_run_steps (org_id, status, next_attempt_at);

-- ── 5. Runtime linkage on the EXISTING ledger and invocation tables ──────────────────────────────
-- change_ledger already carries actor_type + actor_id, and that contract is NOT touched: actor_id
-- remains the free uuid it has always been (no FK, populated by existing callers). governed_actor_id
-- is a DISTINCT additive column resolving to the new registry, exactly as the gate directed.
alter table change_ledger add column if not exists run_id            uuid;
alter table change_ledger add column if not exists run_step_id       uuid;
alter table change_ledger add column if not exists invocation_id     uuid;
alter table change_ledger add column if not exists governed_actor_id uuid;
create index if not exists change_ledger_run on change_ledger (org_id, run_id, occurred_at desc, id desc)
  where run_id is not null;

-- governed_action_invocations carries actor_type/actor_id/actor_role describing the DISPATCH
-- caller. That contract is likewise untouched; the new column records which registered governed
-- actor authorised the invocation, so an invocation traces back to actor → grant → run → step
-- without a parallel invocation model.
alter table governed_action_invocations add column if not exists governed_actor_id uuid;
alter table governed_action_invocations add column if not exists run_step_id       uuid;
create index if not exists governed_action_invocations_actor
  on governed_action_invocations (org_id, governed_actor_id) where governed_actor_id is not null;

-- ── 5b. Ledger vocabulary — six runtime values, every prior value kept ──────────────────────────
-- change_ledger.change_type is CHECK-constrained, so a runtime transition is REJECTED BY THE
-- DATABASE unless its vocabulary is declared here. This follows 0103 §5 exactly: read the current
-- definition, append, never rewrite — so every value any earlier migration added survives, and
-- re-running this file is a no-op.
--
-- trigger_type is deliberately NOT extended: a runtime transition is triggered by GOVERNED_ACTION,
-- which already exists and is precisely what the runtime does. Inventing a RUNTIME trigger would
-- add a second word for one concept.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%RUN_STARTED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, ']))', ', ''RUN_STARTED''::text, ''RUN_PAUSED''::text, ''RUN_RESUMED''::text,'
                       || ' ''RUN_COMPLETED''::text, ''RUN_FAILED''::text, ''RUN_BLOCKED''::text,'
                       || ' ''RUN_CANCELLED''::text]))');
  end if;
end $$;

-- ── 6. Grants — least privilege, post-0058 ───────────────────────────────────────────────────────
-- 0058's `alter default privileges` hands app_rw FULL DML on every NEW table, so granting
-- select/insert is not enough: the inherited table-level UPDATE/DELETE must be revoked explicitly,
-- then re-granted column by column. Without this, "forward-only lifecycle" would be a comment
-- rather than a constraint — the same trap 0103 documents.
grant select, insert on governed_actors, actor_capability_grants, pursuit_runs, pursuit_run_steps to app_rw;
revoke update, delete on governed_actors, actor_capability_grants, pursuit_runs, pursuit_run_steps from app_rw;

-- An actor's identity (org, type, key, principal) is never updatable — lifecycle is the only thing
-- that moves. Re-pointing a live actor at a different principal would silently re-attribute history.
grant update (lifecycle, display_name, purpose, updated_at) on governed_actors to app_rw;
-- A grant is created and revoked. It is never edited into a different capability.
grant update (status, revoked_at) on actor_capability_grants to app_rw;
-- Run: forward lifecycle + durable continuation only. The pin (pursuit, plan, revision,
-- basis_fingerprint, actor, idempotency_key) is immutable by construction.
grant update (status, current_step_id, continuation, reason, last_transition_at, locked_at, updated_at)
  on pursuit_runs to app_rw;
-- Step: execution mechanics only. skill_id, args and idempotency_key are fixed at creation, which
-- is what makes a replay provably the same step rather than a new one.
grant update (status, attempt, next_attempt_at, invocation_id, result, error, failure_class,
              started_at, ended_at, updated_at)
  on pursuit_run_steps to app_rw;

-- ── 7. RLS — ENABLE + FORCE, the certified org-membership pattern ────────────────────────────────
alter table governed_actors enable row level security;
alter table governed_actors force row level security;
drop policy if exists governed_actors_rw on governed_actors;
create policy governed_actors_rw on governed_actors for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table actor_capability_grants enable row level security;
alter table actor_capability_grants force row level security;
drop policy if exists actor_capability_grants_rw on actor_capability_grants;
create policy actor_capability_grants_rw on actor_capability_grants for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table pursuit_runs enable row level security;
alter table pursuit_runs force row level security;
drop policy if exists pursuit_runs_rw on pursuit_runs;
create policy pursuit_runs_rw on pursuit_runs for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table pursuit_run_steps enable row level security;
alter table pursuit_run_steps force row level security;
drop policy if exists pursuit_run_steps_rw on pursuit_run_steps;
create policy pursuit_run_steps_rw on pursuit_run_steps for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Additive only, so the reversal is a clean drop of what this file created. Reverting removes the
-- governed runtime entirely; any run history is lost with it, which is why this is an emergency
-- measure and not a routine one. The four columns on change_ledger and the two on
-- governed_action_invocations are nullable and inert when the runtime is absent, so they may be
-- left in place; dropping them would rewrite two large certified tables for no benefit.
--
--   begin;
--   drop table if exists pursuit_run_steps;
--   drop table if exists pursuit_runs;
--   drop table if exists actor_capability_grants;
--   drop table if exists governed_actors;
--   -- optional, and NOT recommended (rewrites certified tables):
--   -- alter table change_ledger drop column if exists run_id, drop column if exists run_step_id,
--   --   drop column if exists invocation_id, drop column if exists governed_actor_id;
--   -- alter table governed_action_invocations drop column if exists governed_actor_id,
--   --   drop column if exists run_step_id;
--   commit;
