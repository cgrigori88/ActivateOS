-- 0075: Seller fit + operational Pursuit Team (Workstream C, §6/§18-24). Seller fit is
-- Seller×Account×Product×Pursuit and decoupled from the partner route (§8/§20). The team
-- is the OPERATIONAL layer with a full acceptance lifecycle (§23) and a controlled role
-- registry (§22); minimum-viable-team requirements feed activation readiness (§24). Flat SQL.

create table if not exists route_seller_candidates (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  route_snapshot_id  uuid references pursuit_route_snapshots(id) on delete cascade,
  seller_id          uuid not null references sellers(id) on delete cascade,
  seller_kind        text not null check (seller_kind in ('vendor','partner')),
  rank               integer not null,
  is_recommended     boolean not null default false,
  is_assigned        boolean not null default false,     -- assignment ≠ recommendation (§19)
  total_score        numeric,
  candidate_confidence numeric,
  disqualified       boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists route_seller_candidates_pursuit on route_seller_candidates (org_id, pursuit_id, rank);

create table if not exists route_seller_dimensions (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references route_seller_candidates(id) on delete cascade,
  dimension          text not null,        -- account_ownership, relationship, expertise, activity, territory, workload, ...
  raw_value          numeric, normalized_value numeric, weight numeric, contribution numeric,
  source             text, feature_observed_at timestamptz
);
create index if not exists route_seller_dimensions_candidate on route_seller_dimensions (candidate_id);

-- Operational team member (§21/§22/§23). Controlled role + acceptance lifecycle.
create table if not exists pursuit_team_members (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  side               text not null check (side in ('VENDOR','PARTNER','DISTRIBUTOR')),
  role               text not null check (role in (
                       'VENDOR_ACCOUNT_EXECUTIVE','VENDOR_PARTNER_MANAGER','VENDOR_SPECIALIST',
                       'VENDOR_SOLUTION_ARCHITECT','VENDOR_EXECUTIVE_SPONSOR',
                       'PARTNER_ACCOUNT_MANAGER','PARTNER_BDM','PARTNER_SPECIALIST','PARTNER_ARCHITECT',
                       'DISTRIBUTOR_VENDOR_MANAGER','DISTRIBUTOR_BDM','DISTRIBUTOR_SPECIALIST','DISTRIBUTOR_TECHNICAL_RESOURCE')),
  organization_id    uuid,
  partner_id         uuid references partners(id) on delete set null,
  distributor_id     uuid references partners(id) on delete set null,
  seller_id          uuid references sellers(id) on delete set null,
  person_ref         text,
  fit_score          numeric,
  selection_reason   text,
  relationship_strength numeric,
  capability_fit     numeric,
  responsibility     text,
  is_recommended     boolean not null default true,
  is_accepted        boolean not null default false,
  status             text not null default 'RECOMMENDED' check (status in
                       ('RECOMMENDED','INVITED','ACCEPTED','DECLINED','ACTIVE','ACTION_REQUIRED','INACTIVE','SUPERSEDED')),
  invited_at timestamptz, accepted_at timestamptz, declined_at timestamptz, last_action_at timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists pursuit_team_members_pursuit on pursuit_team_members (org_id, pursuit_id, status);

-- Minimum viable team policy by pursuit_type (§24). Seeded defaults; org may override later.
create table if not exists pursuit_team_requirements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references organizations(id) on delete cascade,   -- null = global default
  pursuit_type       text,                 -- null = all types
  role               text not null,
  required           boolean not null default true,
  created_at         timestamptz not null default now()
);

insert into pursuit_team_requirements (org_id, pursuit_type, role, required) values
  (null, null, 'VENDOR_ACCOUNT_EXECUTIVE', true),
  (null, null, 'PARTNER_ACCOUNT_MANAGER', true),
  (null, null, 'VENDOR_SPECIALIST', false),
  (null, null, 'VENDOR_SOLUTION_ARCHITECT', false),
  (null, null, 'DISTRIBUTOR_BDM', false)
on conflict do nothing;

grant select, insert, update, delete on route_seller_candidates, route_seller_dimensions, pursuit_team_members to app_rw;
grant select on pursuit_team_requirements to app_rw;
alter table route_seller_candidates enable row level security;
alter table route_seller_dimensions enable row level security;
alter table pursuit_team_members enable row level security;
alter table pursuit_team_requirements enable row level security;
drop policy if exists route_seller_candidates_rw on route_seller_candidates;
create policy route_seller_candidates_rw on route_seller_candidates for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists route_seller_dimensions_rw on route_seller_dimensions;
create policy route_seller_dimensions_rw on route_seller_dimensions for all to app_rw
  using (exists (select 1 from route_seller_candidates c where c.id = candidate_id and is_org_member(c.org_id)))
  with check (exists (select 1 from route_seller_candidates c where c.id = candidate_id and is_org_member(c.org_id)));
drop policy if exists pursuit_team_members_rw on pursuit_team_members;
create policy pursuit_team_members_rw on pursuit_team_members for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists pursuit_team_requirements_ro on pursuit_team_requirements;
create policy pursuit_team_requirements_ro on pursuit_team_requirements for select to app_rw using (org_id is null or is_org_member(org_id));
