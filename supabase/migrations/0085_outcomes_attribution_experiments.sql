-- 0085: Workstream E3-F — outcomes, attribution, experiments, override convergence.
--
-- The learning record the mapping found split across two spines (route_outcomes +
-- opportunity advancement) and missing its intermediate signal. Three net-new,
-- Pursuit-spined objects, kept deliberately SEPARATE (R10/R15):
--   * pursuit_outcomes  — event-rich outcomes incl. the missing NO_DECISION /
--     DORMANT / DISQUALIFIED and economically-meaningful intermediates (R14),
--     each linked to its decision-time context (score/route/why-now snapshots).
--   * attribution       — explicit, versioned, NOT ROI (R15): SOURCE/INFLUENCED/
--     ASSISTED/OBSERVED/UNKNOWN, with policy version, evidence, and human override.
--   * experiments/arms/cohort_assignments — intervention history with the
--     intelligence state BEFORE the intervention (R16); org-scoped, never crossing
--     tenant or disclosure boundaries (fairness invariant).
-- Plus additive columns making a human override a first-class supervision record
-- that knows whether the system later converged (R17).
-- Additive + inert until read; the outcome loop stays dark behind its flag.

set check_function_bodies = off;

-- ── pursuit_outcomes (R14) ────────────────────────────────────────────────────
create table if not exists pursuit_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  company_id         uuid references companies(id) on delete set null,
  outcome_label      text not null check (outcome_label in (
    -- intermediate, economically-meaningful signal (R14)
    'INTRO_REQUESTED','INTRO_ACCEPTED','SELLER_ACCEPTED','PARTNER_ACCEPTED',
    'MEETING_BOOKED','MEETING_COMPLETED','FIRST_ACTION_COMPLETED','CUSTOMER_ENGAGED',
    'CUSTOMER_RESPONDED','TECHNICAL_RESOURCE_ENGAGED','OPPORTUNITY_CREATED',
    'OPPORTUNITY_QUALIFIED','OPPORTUNITY_PROGRESSED','DEAL_REGISTERED','QUOTE_CREATED',
    'PIPELINE_CREATED','RENEWAL_RETAINED','EXPANSION_CREATED',
    -- terminal
    'CLOSED_WON','CLOSED_LOST','NO_DECISION','DORMANT','DISQUALIFIED')),
  is_terminal        boolean not null default false,
  score_snapshot_id  uuid,          -- decision-time context (no hard FK: snapshots may prune)
  route_snapshot_id  uuid references pursuit_route_snapshots(id) on delete set null,
  why_now_snapshot_id uuid,
  override_id        uuid references pursuit_overrides(id) on delete set null,
  attribution_id     uuid,          -- set once attribution is computed (R15, separate object)
  experiment_id      uuid,
  cohort             text,
  value_amount       numeric,       -- economic magnitude when known (never fabricated)
  seconds_since_recommended numeric,
  detail             jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null default now(),   -- business time
  recorded_at        timestamptz not null default now(),   -- knowledge time
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false
);
create index if not exists pursuit_outcomes_pursuit on pursuit_outcomes (org_id, pursuit_id, occurred_at desc);
create index if not exists pursuit_outcomes_label   on pursuit_outcomes (org_id, outcome_label, occurred_at desc);
grant select, insert, update, delete on pursuit_outcomes to app_rw;
alter table pursuit_outcomes enable row level security;
drop policy if exists pursuit_outcomes_rw on pursuit_outcomes;
create policy pursuit_outcomes_rw on pursuit_outcomes for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── attribution (R15 — explicit, versioned, NOT ROI) ──────────────────────────
create table if not exists attribution (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  outcome_id         uuid references pursuit_outcomes(id) on delete cascade,
  subject_kind       text not null check (subject_kind in ('PARTNER','SELLER','DISTRIBUTOR','SOURCE','CONTRIBUTION','ORG')),
  subject_id         uuid,          -- partner/seller/org id (nullable for a source tally)
  subject_label      text,
  attribution_class  text not null check (attribution_class in ('SOURCE','INFLUENCED','ASSISTED','OBSERVED','UNKNOWN')),
  fraction           numeric,       -- optional fractional policy output (null = unweighted)
  model_version      text not null,
  evidence           jsonb not null default '{}'::jsonb,
  reason             text,
  human_override_class text check (human_override_class in ('SOURCE','INFLUENCED','ASSISTED','OBSERVED','UNKNOWN')),
  human_override_reason text,
  computed_at        timestamptz not null default now(),
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false
);
create index if not exists attribution_pursuit on attribution (org_id, pursuit_id, computed_at desc);
create index if not exists attribution_subject on attribution (org_id, subject_kind, subject_id);
grant select, insert, update, delete on attribution to app_rw;
alter table attribution enable row level security;
drop policy if exists attribution_rw on attribution;
create policy attribution_rw on attribution for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- pursuit_outcomes.attribution_id → attribution (added after both tables exist)
do $$ begin
  alter table pursuit_outcomes
    add constraint pursuit_outcomes_attribution_fk
    foreign key (attribution_id) references attribution(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ── experiments / arms / cohort_assignments (R16) ─────────────────────────────
create table if not exists experiments (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  experiment_key     text not null,
  name               text not null,
  hypothesis         text,
  status             text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','CONCLUDED','ABANDONED')),
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,
  created_at         timestamptz not null default now(),
  concluded_at       timestamptz,
  unique (org_id, experiment_key)
);
grant select, insert, update, delete on experiments to app_rw;
alter table experiments enable row level security;
drop policy if exists experiments_rw on experiments;
create policy experiments_rw on experiments for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists experiment_arms (
  id                 uuid primary key default gen_random_uuid(),
  experiment_id      uuid not null references experiments(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  arm_key            text not null,
  description        text,
  is_control         boolean not null default false,
  unique (experiment_id, arm_key)
);
grant select, insert, update, delete on experiment_arms to app_rw;
alter table experiment_arms enable row level security;
drop policy if exists experiment_arms_rw on experiment_arms;
create policy experiment_arms_rw on experiment_arms for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists cohort_assignments (
  id                 uuid primary key default gen_random_uuid(),
  experiment_id      uuid not null references experiments(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  arm_key            text not null,
  -- intervention history (R16): the intelligence state BEFORE the intervention,
  -- what was recommended, what the human decided, and what was done.
  intelligence_state_before jsonb not null default '{}'::jsonb,
  recommendation     jsonb,
  human_decision     jsonb,
  actions_taken      jsonb,
  outcome_id         uuid references pursuit_outcomes(id) on delete set null,
  assigned_at        timestamptz not null default now(),
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,
  unique (experiment_id, pursuit_id)
);
create index if not exists cohort_assignments_exp on cohort_assignments (experiment_id, arm_key);
grant select, insert, update, delete on cohort_assignments to app_rw;
alter table cohort_assignments enable row level security;
drop policy if exists cohort_assignments_rw on cohort_assignments;
create policy cohort_assignments_rw on cohort_assignments for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── R17: human override convergence (supervision record, not mere audit) ───────
alter table pursuit_overrides add column if not exists outcome_id uuid references pursuit_outcomes(id) on delete set null;
alter table pursuit_overrides add column if not exists system_converged boolean;
alter table pursuit_overrides add column if not exists converged_at timestamptz;
alter table pursuit_overrides add column if not exists recommendation_confidence numeric;
alter table pursuit_overrides add column if not exists alternatives jsonb;
alter table pursuit_overrides add column if not exists override_category text;
alter table pursuit_overrides add column if not exists actor_role text;
