-- ActivateOS core schema (V1)
-- Principles encoded here (see docs/PROJECT_BRIEF.md §4):
--   * canonical company identity before intelligence
--   * every scored signal traces to an evidence row
--   * signals decay (half_life_days) and can be negative
--   * scores preserve feature contributions and are versioned
--   * every commercial interaction is an immutable outcome event

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Company identity graph
-- ---------------------------------------------------------------------------

create table companies (
  id               uuid primary key default gen_random_uuid(), -- activate_company_id
  legal_name       text,
  normalized_name  text not null,
  primary_domain   text,
  country          text,
  state            text,
  industry         text,
  naics            text,
  sic              text,
  duns             text,
  employee_count   integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index companies_domain_uq on companies (primary_domain)
  where primary_domain is not null;
create index companies_normalized_name_idx on companies (normalized_name);

create table company_aliases (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  alias       text not null,
  alias_type  text not null check (alias_type in
                ('name','domain','vendor_account_id','partner_account_id',
                 'distributor_account_id','crm_account_id')),
  source      text,
  created_at  timestamptz not null default now(),
  unique (company_id, alias, alias_type)
);
create index company_aliases_alias_idx on company_aliases (alias);

create table company_hierarchies (
  parent_company_id uuid not null references companies(id) on delete cascade,
  child_company_id  uuid not null references companies(id) on delete cascade,
  relationship      text not null default 'subsidiary'
                      check (relationship in ('subsidiary','division','brand')),
  primary key (parent_company_id, child_company_id)
);

-- ---------------------------------------------------------------------------
-- Ecosystem: vendors, partners, sellers, products
-- ---------------------------------------------------------------------------

create table vendors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  name        text not null,
  domain      text,
  created_at  timestamptz not null default now()
);

create table partners (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  name          text not null,
  partner_type  text check (partner_type in
                  ('reseller','distributor','msp','solution_provider','agent','alliance')),
  created_at    timestamptz not null default now()
);

create table partner_relationships (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  strength    numeric check (strength between 0 and 100),
  tenure_months integer,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (partner_id, company_id)
);

create table sellers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  partner_id  uuid references partners(id) on delete set null,
  vendor_id   uuid references vendors(id) on delete set null,
  name        text not null,
  email       text,
  territory   text,
  created_at  timestamptz not null default now()
);

create table seller_account_relationships (
  seller_id   uuid not null references sellers(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  strength    numeric check (strength between 0 and 100),
  primary key (seller_id, company_id)
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid references vendors(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activate Technology Ontology
-- ---------------------------------------------------------------------------

create table taxonomy_nodes (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  parent_id   uuid references taxonomy_nodes(id) on delete set null,
  description text,
  created_at  timestamptz not null default now()
);

create table taxonomy_edges (
  from_node_id uuid not null references taxonomy_nodes(id) on delete cascade,
  to_node_id   uuid not null references taxonomy_nodes(id) on delete cascade,
  edge_type    text not null check (edge_type in ('adjacent','complementary','replacement')),
  weight       numeric not null default 0.5 check (weight between 0 and 1),
  primary key (from_node_id, to_node_id, edge_type)
);

create table product_taxonomy_mappings (
  product_id uuid not null references products(id) on delete cascade,
  node_id    uuid not null references taxonomy_nodes(id) on delete cascade,
  primary key (product_id, node_id)
);

-- ---------------------------------------------------------------------------
-- Evidence and signals
-- ---------------------------------------------------------------------------

-- Evidence: an externally observed assertion. Nothing is scored without one.
create table evidence (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  company_id    uuid references companies(id) on delete cascade,
  source_type   text not null,           -- e.g. 'website','sec_filing','job_posting','press','customer_csv'
  source_url    text,
  claim         text not null,           -- extracted assertion, plain language
  confidence    numeric not null check (confidence between 0 and 1),
  observed_at   timestamptz not null,
  collected_at  timestamptz not null default now(),
  expires_at    timestamptz,
  raw_excerpt   text,
  embedding     vector(1536)
);
create index evidence_company_idx on evidence (company_id);

create table signal_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,     -- 'tavily','sec_edgar','careers_page','customer_csv',...
  kind        text not null,
  created_at  timestamptz not null default now()
);

create table signals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  company_id     uuid not null references companies(id) on delete cascade,
  signal_type    text not null,          -- e.g. 'HIRING_ACCELERATION','CONTRACT_EXPIRING','TECH_INSTALLED'
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  direction      smallint not null default 1 check (direction in (-1, 1)), -- negative signals matter
  magnitude      numeric not null default 1 check (magnitude between 0 and 1),
  confidence     numeric not null check (confidence between 0 and 1),
  observed_at    timestamptz not null,
  half_life_days integer not null default 180,
  evidence_id    uuid not null references evidence(id) on delete cascade,
  source_id      uuid references signal_sources(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index signals_company_idx on signals (company_id);
create index signals_type_idx on signals (signal_type);

create table technology_installations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  node_id     uuid not null references taxonomy_nodes(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  status      text not null default 'installed' check (status in ('installed','removed','suspected')),
  evidence_id uuid references evidence(id) on delete set null,
  observed_at timestamptz not null default now(),
  unique nulls not distinct (company_id, node_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Knowledge base: play templates (see docs/AGENT_LAYER.md)
-- ---------------------------------------------------------------------------

create table play_templates (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null,
  version          integer not null default 1,
  name             text not null,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  definition       jsonb not null,       -- full play JSON from knowledge/plays/
  status           text not null default 'active' check (status in ('draft','active','retired')),
  created_at       timestamptz not null default now(),
  unique (slug, version)
);

-- ---------------------------------------------------------------------------
-- Scoring (deterministic, versioned, explainable)
-- ---------------------------------------------------------------------------

create table score_versions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,      -- e.g. 'v1-rules-2026-08'
  description text,
  weights     jsonb not null,
  created_at  timestamptz not null default now()
);

create table propensity_scores (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid not null references taxonomy_nodes(id) on delete cascade,
  partner_id       uuid references partners(id) on delete set null,
  score            numeric not null check (score between 0 and 100),
  band             text not null check (band in ('very_high','high','medium','low')),
  score_version_id uuid not null references score_versions(id),
  computed_at      timestamptz not null default now()
);
create index propensity_scores_lookup_idx
  on propensity_scores (org_id, taxonomy_node_id, score desc);

create table score_features (
  score_id     uuid not null references propensity_scores(id) on delete cascade,
  feature      text not null,            -- e.g. 'technology_fit','hiring_momentum'
  contribution numeric not null,         -- signed contribution to final score
  evidence_ids uuid[] not null default '{}',
  primary key (score_id, feature)
);

-- ---------------------------------------------------------------------------
-- Motions, campaigns, execution, outcomes
-- ---------------------------------------------------------------------------

create table revenue_motions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  taxonomy_node_id  uuid references taxonomy_nodes(id) on delete set null,
  product_id        uuid references products(id) on delete set null,
  partner_id        uuid references partners(id) on delete set null,
  play_template_id  uuid references play_templates(id) on delete set null,
  propensity_score_id uuid references propensity_scores(id) on delete set null,
  status            text not null default 'draft'
                      check (status in ('draft','approved','active','completed','abandoned')),
  thesis            text,
  trigger_summary   text,
  primary_persona   text,
  secondary_persona text,
  cta               text,
  vendor_seller_id  uuid references sellers(id) on delete set null,
  partner_seller_id uuid references sellers(id) on delete set null,
  confidence        text check (confidence in ('low','medium','high')),
  created_at        timestamptz not null default now(),
  approved_at       timestamptz
);

create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  motion_id   uuid references revenue_motions(id) on delete cascade,
  name        text not null,
  status      text not null default 'draft'
                check (status in ('draft','launched','paused','completed')),
  created_at  timestamptz not null default now()
);

-- Immutable outcome event log: the training dataset of the future.
create table outcome_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  motion_id   uuid references revenue_motions(id) on delete cascade,
  company_id  uuid references companies(id) on delete cascade,
  event_type  text not null check (event_type in
                ('MOTION_CREATED','MOTION_APPROVED','SELLER_ASSIGNED','SELLER_ACCEPTED',
                 'MESSAGE_SENT','MESSAGE_OPENED','CUSTOMER_REPLIED','POSITIVE_RESPONSE',
                 'NEGATIVE_RESPONSE','MEETING_BOOKED','OPPORTUNITY_CREATED','QUOTE_CREATED',
                 'CLOSED_WON','CLOSED_LOST')),
  payload     jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index outcome_events_motion_idx on outcome_events (motion_id, occurred_at);

-- Agent decision log (see docs/AGENT_LAYER.md §2.7)
create table agent_runs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  workflow         text not null,        -- 'extractor','motion_designer',...
  workflow_version text not null,
  model            text not null,
  input_evidence_ids uuid[] not null default '{}',
  input_summary    jsonb,
  raw_output       jsonb,
  validated        boolean not null default false,
  human_decision   text check (human_decision in ('approved','edited','rejected')),
  human_diff       jsonb,
  created_at       timestamptz not null default now()
);
