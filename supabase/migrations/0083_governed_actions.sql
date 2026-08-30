-- 0083: Workstream E3-D — governed action execution boundary.
--
-- dispatchSkill is one of the most security-sensitive boundaries in the platform
-- (R9): UI asks, the Skill boundary decides legality, the domain service mutates,
-- the record captures what happened. This migration provides the versioned Skill
-- registry, the invocation record (idempotency + status + causation/correlation
-- loop-guard ids, R23), the external-action OUTBOX (R25 — external side effects
-- are never tied to a DB transaction), and receipts (R26). Effect classes include
-- EXTERNAL_ACTION; CROSS_TENANT_ACTION is gated by an ACTION grant, never a DATA
-- grant (R24). Additive and inert until GOVERNED_ACTION_ENABLED reads it.

set check_function_bodies = off;

-- Versioned registry. Handlers live in code; this is the governance metadata.
create table if not exists governed_skills (
  skill_id text not null,
  version int not null,
  description text,
  effect_class text not null
    check (effect_class in ('READ','INTERNAL_WRITE','EXTERNAL_ACTION','CROSS_TENANT_ACTION')),
  eligible_actors text[] not null default array['USER'],   -- USER|AGENT|WORKER|SYSTEM
  required_permission text not null default 'operator',    -- owner|operator|viewer|any
  input_schema jsonb not null default '{}',
  preconditions jsonb not null default '{}',
  mutation_boundary text,
  approval_required boolean not null default false,
  idempotent boolean not null default true,
  retry_policy jsonb not null default '{}',
  compensation_skill_id text,
  action_family text,                        -- CROSS_TENANT_ACTION / EXTERNAL_ACTION authority family
  emitted_change_types text[] not null default array[]::text[],
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (skill_id, version)
);

create table if not exists governed_action_invocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  skill_id text not null,
  skill_version int not null,
  effect_class text not null,
  actor_type text not null,                  -- USER|AGENT|WORKER|SYSTEM
  actor_id uuid,
  actor_role text,                           -- resolved role at request time
  pursuit_id uuid references pursuits(id) on delete set null,
  target_kind text, target_id uuid,
  args jsonb not null default '{}',
  idempotency_key text,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','EXECUTING','EXECUTED','FAILED','COMPENSATED','REJECTED')),
  reason text,                               -- rejection / failure reason
  consent_grant_id uuid references context_grants(id) on delete set null,
  causation_id uuid,                         -- the invocation/event that caused this (R23)
  correlation_id uuid,                       -- the chain this belongs to (R23 loop guard)
  emitted_event_id uuid,                     -- change_ledger id (wired in E3-E)
  requested_at timestamptz not null default now(),
  approved_at timestamptz, executed_at timestamptz,
  result jsonb, error text,
  data_environment text not null default 'PRODUCTION',
  unique (org_id, skill_id, idempotency_key)
);
create index if not exists gai_pursuit on governed_action_invocations (pursuit_id, requested_at desc);
create index if not exists gai_correlation on governed_action_invocations (correlation_id);

-- External-action outbox (R25): the durable boundary between a domain transaction
-- and an external side effect. An executor drains it (E3-E worker); nothing here
-- performs a live external call.
create table if not exists action_outbox (
  id uuid primary key default gen_random_uuid(),
  invocation_id uuid not null references governed_action_invocations(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  action_family text,
  payload jsonb not null default '{}',
  status text not null default 'PENDING'
    check (status in ('PENDING','DISPATCHED','SUCCEEDED','FAILED')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists action_outbox_pending on action_outbox (status, next_attempt_at);

-- External-action receipts (R26): operational proof PursuitOS DID something.
create table if not exists action_receipts (
  id uuid primary key default gen_random_uuid(),
  invocation_id uuid references governed_action_invocations(id) on delete set null,
  outbox_id uuid references action_outbox(id) on delete set null,
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null,
  provider_action_id text,
  status text not null,
  submitted_at timestamptz, completed_at timestamptz,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Grants + RLS. The registry is world-readable to app_rw; invocations/outbox/
-- receipts are org-scoped.
grant select on governed_skills to app_rw;
grant select, insert, update, delete on governed_action_invocations, action_outbox, action_receipts to app_rw;

alter table governed_skills enable row level security;
drop policy if exists governed_skills_read on governed_skills;
create policy governed_skills_read on governed_skills for select to app_rw using (true);

alter table governed_action_invocations enable row level security;
drop policy if exists gai_rw on governed_action_invocations;
create policy gai_rw on governed_action_invocations for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

alter table action_outbox enable row level security;
drop policy if exists action_outbox_rw on action_outbox;
create policy action_outbox_rw on action_outbox for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

alter table action_receipts enable row level security;
drop policy if exists action_receipts_rw on action_receipts;
create policy action_receipts_rw on action_receipts for all to app_rw
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
