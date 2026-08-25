-- 0050: Daily pipeline snapshots (task #87, tie-out).
--
-- One row per org per day: what the pipeline summed to. Written idempotently
-- on Pipeline views (cheap upsert), so "the number moved $400k since last
-- week — here's which deals" is answerable from history instead of memory.

create table if not exists pipeline_snapshots (
  org_id       uuid not null references organizations(id) on delete cascade,
  taken_on     date not null default now()::date,
  open_count   int not null,
  open_usd     numeric(14, 2) not null,
  weighted_usd numeric(14, 2) not null,
  crm_usd      numeric(14, 2),
  primary key (org_id, taken_on)
);

alter table pipeline_snapshots enable row level security;
drop policy if exists pipeline_snapshots_select on pipeline_snapshots;
create policy pipeline_snapshots_select on pipeline_snapshots for select to authenticated
  using (is_org_member(org_id));
