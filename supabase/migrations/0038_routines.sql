-- 0038: Routines v1 (Phase A of the unicorn roadmap, task #73).
--
-- A CATALOG of scheduled agent jobs — not free-text automations. Every
-- routine's blast radius is known: v1 routines are read-only digests
-- (morning brief, account digests) that draft and summarize but never send
-- outreach or change state on anyone's behalf. One row per (org, kind);
-- config carries the operator's choices, state carries the routine's memory
-- (e.g. "covered through" watermarks) so runs report what's NEW, never
-- repeat themselves.

create table if not exists routines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  kind        text not null check (kind in ('morning_brief', 'account_digest')),
  enabled     boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  state       jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, kind)
);

create table if not exists routine_runs (
  id         uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines(id) on delete cascade,
  ran_at     timestamptz not null default now(),
  status     text not null check (status in ('ok', 'failed')),
  summary    jsonb not null default '{}'::jsonb,
  output     text
);

create index if not exists routine_runs_routine_idx on routine_runs (routine_id, ran_at desc);

-- One digest row per strategic account per run: the account room's
-- "what's new this week" card reads the latest.
create table if not exists account_digests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  items        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists account_digests_company_idx on account_digests (org_id, company_id, created_at desc);

alter table routines enable row level security;
alter table routine_runs enable row level security;
alter table account_digests enable row level security;

drop policy if exists routines_select on routines;
create policy routines_select on routines for select to authenticated
  using (is_org_member(org_id));
drop policy if exists routines_write on routines;
create policy routines_write on routines for all to authenticated
  using (org_role(org_id) in ('owner', 'operator'))
  with check (org_role(org_id) in ('owner', 'operator'));

drop policy if exists routine_runs_select on routine_runs;
create policy routine_runs_select on routine_runs for select to authenticated
  using (exists (select 1 from routines r where r.id = routine_id and is_org_member(r.org_id)));

drop policy if exists account_digests_select on account_digests;
create policy account_digests_select on account_digests for select to authenticated
  using (is_org_member(org_id));
