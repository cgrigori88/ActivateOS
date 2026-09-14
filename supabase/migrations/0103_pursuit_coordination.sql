-- 0103: Pursuit Coordination (vNext Slice 2A) — Pursuit Goal → Pursuit Plan → Motion → Action.
--
-- ADDITIVE ONLY. Three new tables and two widened CHECK vocabularies (the same rebuild pattern as
-- 0073 / 0079 / 0084 / 0097 / 0099). No column is dropped, narrowed or backfilled; nothing existing
-- is rewritten. Inert until VNEXT_PURSUIT_COORDINATION_ENABLED reads it.
--
-- WHAT IS NEW, AND WHAT IS DELIBERATELY NOT.
--   pursuit_goals           — the DURABLE COMMERCIAL OUTCOME a pursuit is trying to achieve — never
--                             the route, partner, motion, action or owner chosen to get there; those
--                             are plan state (D-033). Not the org-level
--                             S.M.A.R.T. `goals` table (0026): that is a portfolio target whose progress
--                             is computed from linked motions, and it is counted by the certified demo
--                             manifest. A pursuit goal is a different object with a different owner.
--   pursuit_plans           — stable identity of the plan (what a future runtime resumes against).
--   pursuit_plan_revisions  — the plan's APPEND-ONLY history. Every system recommendation and every
--                             human decision is its own row; a decision references the recommendation
--                             it answers and never overwrites it (D-004). Milestones, dependencies,
--                             focus, the motion reference, the next action, its owner and the
--                             evidence basis travel inside each revision, so a revision is
--                             self-contained and a later reader can reconstruct exactly what was
--                             recommended, on what evidence, and what a person did with it.
--
--   NOT new: motions (revenue_motions), actions (motion_actions), approvals (dispatchSkill →
--   governed_action_invocations), overrides (pursuit_overrides), history (change_ledger), owners
--   (pursuit_team_members). The plan REFERENCES those; it does not re-model them.
--
-- APPEND-ONLY, ENFORCED BY GRANT (the 0094 pattern). app_rw may SELECT/INSERT revisions and nothing
-- else. Goals and plans advance FORWARD through a small set of lifecycle columns only; their
-- identity, objective and evidence basis are immutable. A correction is a superseding row.

set check_function_bodies = off;

-- ── 1. Pursuit goal ─────────────────────────────────────────────────────────────────────────────
create table if not exists pursuit_goals (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id) on delete cascade,
  pursuit_id              uuid not null references pursuits(id) on delete cascade,
  objective               text not null,                    -- human-readable commercial outcome
  target_date             date,                             -- null = UNKNOWN, never a guess
  status                  text not null default 'PROPOSED'
                            check (status in ('PROPOSED','ACTIVE','ACHIEVED','ABANDONED','SUPERSEDED')),
  -- Provenance: proposed by the system vs written by a person. Confirmation is a separate, human act.
  origin                  text not null check (origin in ('SYSTEM_RECOMMENDED','HUMAN_AUTHORED')),
  basis                   jsonb not null default '{}',      -- the canonical records the objective was composed from
  proposed_by_actor_type  text not null check (proposed_by_actor_type in ('USER','AGENT','WORKER','SYSTEM')),
  proposed_by_actor_id    uuid,
  decided_by_actor_id     uuid,
  decided_at              timestamptz,
  -- Replacement, append-only (D-033). A genuinely different commercial objective is a NEW row
  -- that names the goal it replaces and says why; the replaced row keeps its meaning and only
  -- moves to SUPERSEDED. The pointer lives on the NEW row, is set once at insert, and is never
  -- updatable — so history is read backwards from the present, and nothing is rewritten.
  supersedes_goal_id      uuid references pursuit_goals(id),
  supersession_reason     text,
  data_environment        text not null default 'PRODUCTION',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Only a person replaces a goal, always with a reason, never with itself.
  constraint pursuit_goals_supersession_shape check (
    supersedes_goal_id is null
    or (supersedes_goal_id <> id and supersession_reason is not null and origin = 'HUMAN_AUTHORED')
  )
);
-- One live goal per pursuit. Terminal and superseded goals stay as history.
create unique index if not exists pursuit_goals_one_live on pursuit_goals (pursuit_id) where status in ('PROPOSED','ACTIVE');
-- A goal is replaced at most once: the replacement history is a single line, never a fork.
create unique index if not exists pursuit_goals_supersedes_once on pursuit_goals (supersedes_goal_id) where supersedes_goal_id is not null;
create index if not exists pursuit_goals_org_pursuit on pursuit_goals (org_id, pursuit_id, created_at desc);

-- ── 2. Pursuit plan (identity) ──────────────────────────────────────────────────────────────────
create table if not exists pursuit_plans (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  pursuit_id        uuid not null references pursuits(id) on delete cascade,
  goal_id           uuid not null references pursuit_goals(id) on delete cascade,
  -- PROPOSED until a person first approves a recommendation; ACTIVE thereafter.
  status            text not null default 'PROPOSED' check (status in ('PROPOSED','ACTIVE','CLOSED','SUPERSEDED')),
  data_environment  text not null default 'PRODUCTION',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists pursuit_plans_one_live on pursuit_plans (pursuit_id) where status in ('PROPOSED','ACTIVE');
create index if not exists pursuit_plans_org_pursuit on pursuit_plans (org_id, pursuit_id, created_at desc);

-- ── 3. Plan revisions (append-only) ─────────────────────────────────────────────────────────────
create table if not exists pursuit_plan_revisions (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  pursuit_id               uuid not null references pursuits(id) on delete cascade,
  plan_id                  uuid not null references pursuit_plans(id) on delete cascade,
  revision_no              integer not null check (revision_no >= 1),
  -- What PursuitOS recommended vs what a person decided. Never the same row.
  kind                     text not null check (kind in ('RECOMMENDATION','DECISION')),
  decision                 text check (decision in ('APPROVED','ADJUSTED','REJECTED')),
  responds_to_revision_id  uuid references pursuit_plan_revisions(id),
  content                  jsonb not null,   -- focus · motion ref · next action · owner · milestones · why (versioned)
  basis                    jsonb not null,   -- evidence lineage + the normalized inputs the recommendation was computed from
  basis_fingerprint        text not null,    -- deterministic digest of those inputs; drift ⇒ the plan needs review
  adjustments              jsonb,            -- ADJUSTED only: [{ field, from, to }] — the human change, preserved
  review_trigger           jsonb,            -- a recommendation raised because an approved plan went stale: why
  reason                   text,             -- the person's reason (required for ADJUSTED / REJECTED by the app)
  actor_type               text not null check (actor_type in ('USER','AGENT','WORKER','SYSTEM')),
  actor_id                 uuid,
  correlation_id           uuid,             -- ties the revision to its governed_action_invocations row
  recommender_version      text,             -- which deterministic recommender produced a RECOMMENDATION
  data_environment         text not null default 'PRODUCTION',
  created_at               timestamptz not null default now(),
  unique (plan_id, revision_no),
  constraint pursuit_plan_revisions_shape check (
    (kind = 'RECOMMENDATION' and decision is null and responds_to_revision_id is null and adjustments is null)
    or (kind = 'DECISION' and decision is not null and responds_to_revision_id is not null and review_trigger is null)
  )
);
create index if not exists pursuit_plan_revisions_plan on pursuit_plan_revisions (plan_id, revision_no desc);
create index if not exists pursuit_plan_revisions_pursuit on pursuit_plan_revisions (org_id, pursuit_id, created_at desc);

-- ── 4. Grants + RLS (explicit, post-0090: FORCE applied here, since 0090's loop has already run) ──
grant select, insert on pursuit_goals, pursuit_plans, pursuit_plan_revisions to app_rw;
-- 0058's `alter default privileges` hands app_rw full DML on every NEW table, so a grant of
-- select/insert alone is not enough — the table-level UPDATE/DELETE it inherited must be revoked
-- explicitly, exactly as 0094 does for the other history tables. (Caught by the Slice 2A harness:
-- without this, "append-only" would have been a comment, not a constraint.)
revoke update, delete on pursuit_goals, pursuit_plans, pursuit_plan_revisions from app_rw;
-- Forward-only lifecycle columns. Identity, objective, content and basis are never updatable.
grant update (status, decided_by_actor_id, decided_at, updated_at) on pursuit_goals to app_rw;
grant update (status, updated_at) on pursuit_plans to app_rw;
-- pursuit_plan_revisions: no UPDATE, no DELETE — history is corrected by appending.

alter table pursuit_goals enable row level security;
alter table pursuit_goals force row level security;
drop policy if exists pursuit_goals_rw on pursuit_goals;
create policy pursuit_goals_rw on pursuit_goals for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table pursuit_plans enable row level security;
alter table pursuit_plans force row level security;
drop policy if exists pursuit_plans_rw on pursuit_plans;
create policy pursuit_plans_rw on pursuit_plans for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table pursuit_plan_revisions enable row level security;
alter table pursuit_plan_revisions force row level security;
drop policy if exists pursuit_plan_revisions_rw on pursuit_plan_revisions;
create policy pursuit_plan_revisions_rw on pursuit_plan_revisions for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ── 5. Ledger vocabulary — three values, every prior value kept ──────────────────────────────────
-- Only HUMAN decisions (a plan decided, a goal replaced) and SYSTEM-detected review triggers reach
-- the universal ledger. A system recommendation is a proposal, not a change to the pursuit, and its
-- history lives in pursuit_plan_revisions (see D-027).
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%PLAN_DECIDED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, ']))', ', ''PLAN_DECIDED''::text, ''PLAN_REVIEW_REQUIRED''::text, ''GOAL_REPLACED''::text]))');
  end if;
end $$;

-- ── 6. Override vocabulary — a human divergence from a recommended plan is supervision data ─────
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'pursuit_overrides_field_check' and conrelid = 'pursuit_overrides'::regclass;
  if def is not null and def not like '%''plan''%' then
    execute 'alter table pursuit_overrides drop constraint pursuit_overrides_field_check';
    execute 'alter table pursuit_overrides add constraint pursuit_overrides_field_check ' ||
      replace(def, ']))', ', ''plan''::text]))');
  end if;
end $$;
