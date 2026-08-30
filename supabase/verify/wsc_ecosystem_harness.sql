-- Workstream C verification harness: the pre-existing ecosystem substrate (migrations
-- 0006/0001) that the route migrations reference. Faithful to live column shapes. Applied
-- on top of wsa_harness.sql (partners, sellers, companies, taxonomy_nodes) + wsb_intel,
-- before migrations 0074-0079.

-- Partner coverage/type columns (0006/0014) added to the base partners table.
alter table partners add column if not exists partner_type text default 'reseller';
alter table partners add column if not exists industries text[] default '{}';
alter table partners add column if not exists countries text[] default '{}';

-- Seller vendor/partner split + territory (0001) added to the base sellers table.
alter table sellers add column if not exists partner_id uuid references partners(id) on delete set null;
alter table sellers add column if not exists vendor_id uuid;
alter table sellers add column if not exists territory text;
alter table sellers add column if not exists email text;

create table if not exists partner_capabilities (
  partner_id uuid not null references partners(id) on delete cascade,
  taxonomy_node_id uuid not null references taxonomy_nodes(id) on delete cascade,
  strength numeric not null default 0 check (strength between 0 and 1),
  certified boolean not null default false,
  primary key (partner_id, taxonomy_node_id)
);

create table if not exists partner_relationships (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  strength numeric not null default 0 check (strength between 0 and 100),
  tenure_months integer not null default 0,
  notes text,
  unique (partner_id, company_id)
);

create table if not exists seller_account_relationships (
  seller_id uuid not null references sellers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  strength numeric not null default 0 check (strength between 0 and 100),
  last_interaction_at timestamptz,
  primary key (seller_id, company_id)
);

create table if not exists company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  alias_type text not null,      -- vendor_account_id|partner_account_id|distributor_account_id|crm_account_id|duns|domain
  alias_value text not null,
  created_at timestamptz not null default now()
);
create index if not exists company_aliases_lookup on company_aliases (alias_type, alias_value);

create table if not exists company_hierarchies (
  id uuid primary key default gen_random_uuid(),
  parent_company_id uuid not null references companies(id) on delete cascade,
  child_company_id uuid not null references companies(id) on delete cascade,
  relation text not null default 'subsidiary',
  unique (parent_company_id, child_company_id)
);
-- companies.duns for entity resolution (0001 has it; add if the harness base lacks it).
alter table companies add column if not exists duns text;

-- Grants + RLS. Parent-scoped where a clear org parent exists; reference tables use(true).
grant select, insert, update, delete on partner_capabilities, partner_relationships, seller_account_relationships, company_aliases, company_hierarchies to app_rw;
alter table partner_capabilities enable row level security;
alter table partner_relationships enable row level security;
alter table seller_account_relationships enable row level security;
alter table company_aliases enable row level security;
alter table company_hierarchies enable row level security;
drop policy if exists partner_capabilities_rw on partner_capabilities;
create policy partner_capabilities_rw on partner_capabilities for all to app_rw
  using (exists (select 1 from partners p where p.id = partner_id and is_org_member(p.org_id)))
  with check (exists (select 1 from partners p where p.id = partner_id and is_org_member(p.org_id)));
drop policy if exists partner_relationships_rw on partner_relationships;
create policy partner_relationships_rw on partner_relationships for all to app_rw
  using (exists (select 1 from partners p where p.id = partner_id and is_org_member(p.org_id)))
  with check (exists (select 1 from partners p where p.id = partner_id and is_org_member(p.org_id)));
drop policy if exists seller_account_relationships_rw on seller_account_relationships;
create policy seller_account_relationships_rw on seller_account_relationships for all to app_rw
  using (exists (select 1 from sellers s where s.id = seller_id and is_org_member(s.org_id)))
  with check (exists (select 1 from sellers s where s.id = seller_id and is_org_member(s.org_id)));
drop policy if exists company_aliases_rw on company_aliases;
create policy company_aliases_rw on company_aliases for all to app_rw using (true) with check (true);
drop policy if exists company_hierarchies_rw on company_hierarchies;
create policy company_hierarchies_rw on company_hierarchies for all to app_rw using (true) with check (true);
