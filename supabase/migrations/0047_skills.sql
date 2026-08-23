-- 0047: Skills library (task #84).
--
-- Reusable, TYPED grounding the org curates for its AI agents — the
-- "collective playbook" as first-class rows instead of prompts scattered in
-- heads. Typed (kind) and scoped (org/partner/list) on purpose: collisions
-- are visible at creation time, and every skill declares where it grounds.
-- agent_runs.skill_ids records exactly which skills grounded each run, so
-- usage — and later, outcomes — attribute to the skill, not to vibes.

create table if not exists skills (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('positioning', 'process', 'style', 'rules')),
  scope_type text not null default 'org' check (scope_type in ('org', 'partner', 'list')),
  scope_id   uuid,          -- partner id or account_population id; null for org scope
  body       text not null,
  status     text not null default 'active' check (status in ('active', 'archived')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists skills_org_idx on skills (org_id, status);

alter table agent_runs add column if not exists skill_ids uuid[] not null default '{}';

alter table skills enable row level security;
drop policy if exists skills_select on skills;
create policy skills_select on skills for select to authenticated
  using (is_org_member(org_id));
