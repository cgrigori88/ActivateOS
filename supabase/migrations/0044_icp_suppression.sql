-- 0044: ICP profile + suppression list (task #83, GTM-OS batch slice 1).
--
-- "Who to target and who to IGNORE" as first-class objects. The ICP profile
-- is advisory (fit chips, ranking); the suppression list is a HARD guardrail:
-- suppressed accounts are excluded from motion drafting and the composer's
-- candidate surfaces. Name entries are stored normalized (same normalizer as
-- identity resolution) so "Acme Corp." and "acme corp" suppress alike.

create table if not exists org_icp (
  org_id        uuid primary key references organizations(id) on delete cascade,
  industries    text[] not null default '{}',
  employee_min  int,
  employee_max  int,
  geos          text[] not null default '{}',
  notes         text,
  updated_at    timestamptz not null default now()
);

create table if not exists account_suppressions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  kind       text not null check (kind in ('domain', 'name')),
  value      text not null,   -- domain verbatim; names stored normalized
  label      text not null,   -- what the operator typed, for display
  reason     text,
  created_at timestamptz not null default now(),
  unique (org_id, kind, value)
);

create index if not exists account_suppressions_org_idx on account_suppressions (org_id);

alter table org_icp enable row level security;
alter table account_suppressions enable row level security;

drop policy if exists org_icp_select on org_icp;
create policy org_icp_select on org_icp for select to authenticated
  using (is_org_member(org_id));
drop policy if exists account_suppressions_select on account_suppressions;
create policy account_suppressions_select on account_suppressions for select to authenticated
  using (is_org_member(org_id));
