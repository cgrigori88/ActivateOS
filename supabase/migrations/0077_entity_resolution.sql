-- 0077: Entity resolution for distributor/external identity (Workstream C, §28-33).
-- External IDs (DUNS/LEI/CRM/distributor/partner) are first-class aliases; deterministic
-- signals resolve before fuzzy name matching (§29); confidence has thresholds and ambiguous
-- matches go to review (§30); unresolved identity must not score a Pursuit (§31, enforced in
-- the service). Parent/child hierarchy + a per-family roll-up policy (§32/§33). Flat SQL.

-- Extend the existing company_aliases with resolution provenance (§25/§30).
alter table company_aliases add column if not exists resolution_method text;   -- EXTERNAL_ID|DOMAIN|VERIFIED_ALIAS|DUNS|LEGAL_IDENTITY|HIERARCHY|FUZZY_NAME
alter table company_aliases add column if not exists resolution_confidence numeric;
alter table company_aliases add column if not exists resolution_status text default 'AUTO_RESOLVED';
alter table company_aliases add column if not exists verified_by uuid;
alter table company_aliases add column if not exists verified_at timestamptz;

create index if not exists companies_duns_idx on companies (duns) where duns is not null;

-- Ambiguous / low-confidence match review (§30).
create table if not exists entity_resolution_reviews (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  source_system      text not null,        -- 'distributor'|'crm'|'partner'|'import'
  external_id        text,
  external_name      text,
  candidate_company_id uuid references companies(id) on delete set null,
  method             text not null,        -- EXTERNAL_ID|DOMAIN|DUNS|FUZZY_NAME|...
  confidence         numeric not null,
  status             text not null default 'REVIEW_REQUIRED' check (status in ('AUTO_RESOLVED','REVIEW_REQUIRED','UNRESOLVED','RESOLVED','REJECTED')),
  decided_by         uuid, decided_at timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists entity_resolution_reviews_open on entity_resolution_reviews (org_id) where status = 'REVIEW_REQUIRED';

-- Hierarchy roll-up policy per external signal family (§33). Seeded conservative defaults.
create table if not exists hierarchy_rollup_policies (
  id                 uuid primary key default gen_random_uuid(),
  signal_family      text not null,        -- 'transaction'|'relationship'|'evidence'|...
  direction          text not null check (direction in ('CHILD_TO_PARENT','PARENT_TO_CHILD','SIBLING_TO_SIBLING')),
  allowed            boolean not null default false,
  attenuation        numeric not null default 0.5,   -- confidence multiplier when rolled
  min_confidence     numeric not null default 0.7,
  unique (signal_family, direction)
);
insert into hierarchy_rollup_policies (signal_family, direction, allowed, attenuation, min_confidence) values
  ('transaction','CHILD_TO_PARENT', true,  0.5, 0.8),
  ('transaction','PARENT_TO_CHILD', false, 0.3, 0.9),
  ('transaction','SIBLING_TO_SIBLING', false, 0.2, 0.9),
  ('relationship','CHILD_TO_PARENT', true, 0.6, 0.7)
on conflict (signal_family, direction) do nothing;

grant select, insert, update, delete on entity_resolution_reviews to app_rw;
grant select on hierarchy_rollup_policies to app_rw;
alter table entity_resolution_reviews enable row level security;
alter table hierarchy_rollup_policies enable row level security;
drop policy if exists entity_resolution_reviews_rw on entity_resolution_reviews;
create policy entity_resolution_reviews_rw on entity_resolution_reviews for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists hierarchy_rollup_policies_ro on hierarchy_rollup_policies;
create policy hierarchy_rollup_policies_ro on hierarchy_rollup_policies for select to app_rw using (true);
