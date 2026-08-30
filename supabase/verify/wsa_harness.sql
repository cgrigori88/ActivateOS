-- Faithful minimal harness reproducing the real tables Workstream A touches + the
-- 0058 RLS mechanism (app_current_org / is_org_member / app_rw). Column shapes match
-- the live schema extracts. Applied to a fresh DB, then migrations 0063-0068 on top.

set check_function_bodies = off;
drop schema if exists auth cascade;
create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create or replace function public.app_current_org() returns uuid
  language sql stable as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;
create or replace function public.is_org_member(org uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from org_members m where m.org_id = org and m.user_id = auth.uid())
        or org = public.app_current_org();
  $$;

create table organizations (id uuid primary key default gen_random_uuid(), name text, kind text default 'full', created_at timestamptz not null default now());
create table org_members (org_id uuid, user_id uuid, role text, created_at timestamptz default now());
create table companies (id uuid primary key default gen_random_uuid(), legal_name text, normalized_name text not null default '', industry text, employee_count int, country text, created_at timestamptz default now(), updated_at timestamptz default now());
create table vendors (id uuid primary key default gen_random_uuid(), name text);
create table products (id uuid primary key default gen_random_uuid(), vendor_id uuid references vendors(id), name text not null, created_at timestamptz default now());
create table taxonomy_nodes (id uuid primary key default gen_random_uuid(), name text);
create table partners (id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade, name text, capacity int);
create table sellers (id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade, name text);
create table play_templates (id uuid primary key default gen_random_uuid(), name text);
create table partner_fit_scores (id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade);
create table agent_runs (id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade, workflow text, created_at timestamptz default now());
create table score_versions (id uuid primary key default gen_random_uuid(), label text not null unique, description text, weights jsonb not null default '{}', created_at timestamptz default now());
create table propensity_scores (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid not null references taxonomy_nodes(id) on delete cascade,
  partner_id uuid references partners(id) on delete set null,
  score numeric not null check (score between 0 and 100),
  band text not null check (band in ('very_high','high','medium','low')),
  score_version_id uuid not null references score_versions(id),
  computed_at timestamptz not null default now());
create table revenue_motions (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  partner_id uuid references partners(id) on delete set null,
  play_template_id uuid references play_templates(id) on delete set null,
  propensity_score_id uuid references propensity_scores(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','approved','active','completed','abandoned')),
  thesis text, trigger_summary text, primary_persona text, secondary_persona text, cta text,
  vendor_seller_id uuid references sellers(id) on delete set null,
  partner_seller_id uuid references sellers(id) on delete set null,
  confidence text check (confidence in ('low','medium','high')),
  created_at timestamptz not null default now(), approved_at timestamptz);
create table opportunities (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  motion_id uuid references revenue_motions(id) on delete set null,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  name text not null, stage text not null default 'discovery',
  amount_usd numeric, next_step text, expected_close_date date,
  created_at timestamptz default now(), updated_at timestamptz default now(), closed_at timestamptz);
create table campaigns (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade,
  motion_id uuid references revenue_motions(id) on delete cascade,
  name text not null, status text not null default 'draft', created_at timestamptz default now());
create table pursuit_teams (
  id uuid primary key default gen_random_uuid(), org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid not null references taxonomy_nodes(id) on delete cascade,
  partner_id uuid not null references partners(id) on delete cascade,
  seller_id uuid references sellers(id) on delete set null,
  partner_fit_id uuid references partner_fit_scores(id) on delete set null,
  status text not null default 'recommended', reason text, created_at timestamptz default now());

-- app_rw role + grants (mirrors 0058). New-table grants come from the migrations.
drop role if exists app_rw;
create role app_rw nologin noinherit;
grant usage on schema public to app_rw;
grant select, insert, update, delete on all tables in schema public to app_rw;
grant usage, select on all sequences in schema public to app_rw;
alter default privileges in schema public grant select, insert, update, delete on tables to app_rw;

-- Reference tables: readable/writable by app_rw (using true), like 0061.
do $$ declare t text; begin
  foreach t in array array['organizations','companies','vendors','products','taxonomy_nodes',
                           'play_templates','score_versions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to app_rw using (true) with check (true)', t, t);
  end loop;
end $$;
-- Org-scoped tables: is_org_member(org_id), like 0058.
do $$ declare t text; begin
  foreach t in array array['partners','sellers','partner_fit_scores','agent_runs','propensity_scores',
                           'revenue_motions','opportunities','campaigns','pursuit_teams'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format('create policy %I_rw on %I for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id))', t, t);
  end loop;
end $$;
