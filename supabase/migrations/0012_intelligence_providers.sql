-- Intelligence expansion (NEXT ENGINEERING DIRECTIVE §1, §5, §22-24, §21, §12).
-- The normalized spine: Provider → RawObservation → Evidence → Signal.
-- No provider ever touches a propensity score; providers produce observations
-- and evidence, the central pipeline produces signals, the deterministic
-- scorer consumes signal families.

create table providers (
  id            text primary key,               -- e.g. 'greenhouse', 'dns', 'gdelt'
  provider_type text not null check (provider_type in
    ('FIRST_PARTY','CUSTOMER_UPLOAD','PARTNER_UPLOAD','PUBLIC_COMPANY',
     'PUBLIC_NEWS','HIRING','DEVELOPER','TECHNOGRAPHIC','NETWORK',
     'CORPORATE_EVENT','FIRMOGRAPHIC','PEOPLE','COMMUNICATION',
     'PRODUCT_USAGE','PREMIUM_INTENT','DISTRIBUTOR')),
  cost_class    text not null default 'FREE'
    check (cost_class in ('FREE','LOW_COST','CUSTOMER_OWNED','PREMIUM')),
  enabled       boolean not null default true,
  allowed_for_screening boolean not null default true,
  allowed_for_deep_research boolean not null default true,
  -- rate limits, budgets, category scoping, credential *references* (never keys)
  config        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table provider_runs (
  id               uuid primary key default gen_random_uuid(),
  provider_id      text not null references providers(id) on delete cascade,
  org_id           uuid references organizations(id) on delete cascade,
  company_id       uuid references companies(id) on delete cascade,
  stage            text not null default 'screen' check (stage in ('screen','deep','manual')),
  status           text not null default 'running'
    check (status in ('running','succeeded','failed','skipped')),
  records_received integer not null default 0,
  evidence_created integer not null default 0,
  signals_created  integer not null default 0,
  cost_usd         numeric(10,6) not null default 0,
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index on provider_runs (provider_id, started_at desc);
create index on provider_runs (company_id, started_at desc);

create table raw_observations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade,
  provider_id         text not null references providers(id) on delete cascade,
  company_id          uuid references companies(id) on delete cascade,
  target_domain       text,
  external_record_id  text,
  observed_at         timestamptz not null default now(),
  source_published_at timestamptz,
  source_url          text,
  raw_payload         jsonb not null,
  content_hash        text,
  processing_status   text not null default 'NEW'
    check (processing_status in ('NEW','NORMALIZED','IGNORED','FAILED')),
  cost_usd            numeric(10,6) not null default 0
);
-- Same provider + same content = one observation (change detection backbone).
create unique index raw_obs_dedupe_idx
  on raw_observations (provider_id, company_id, content_hash)
  where content_hash is not null;
create index on raw_observations (company_id, observed_at desc);
create index on raw_observations (processing_status) where processing_status = 'NEW';

-- Evidence gains full provenance (§6): which provider, which raw record,
-- whether the company said it about itself, and when the source published.
alter table evidence
  add column if not exists provider_id text references providers(id) on delete set null,
  add column if not exists raw_observation_id uuid references raw_observations(id) on delete set null,
  add column if not exists first_party boolean not null default false,
  add column if not exists published_at timestamptz;

-- Versioned signal-type configuration (§12): decay, weights, and family
-- live in DATA, not in business logic.
create table signal_configs (
  signal_type        text primary key,
  family             text not null,
  base_weight        numeric not null default 1 check (base_weight between 0 and 1),
  default_half_life_days integer,
  minimum_confidence numeric not null default 0 check (minimum_confidence between 0 and 1),
  enabled            boolean not null default true,
  version            integer not null default 1,
  updated_at         timestamptz not null default now()
);

-- Research queue (§21): where the next research dollar goes, and why.
create table research_jobs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  company_id  uuid not null references companies(id) on delete cascade,
  reason      text not null check (reason in
    ('high_propensity_low_confidence','high_value_low_completeness',
     'signal_contradiction','recent_major_change','score_near_threshold',
     'motion_missing_evidence','manual')),
  priority    numeric not null default 0,
  stage       text not null default 'deep' check (stage in ('screen','deep')),
  status      text not null default 'pending'
    check (status in ('pending','running','done','failed','cancelled')),
  detail      text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index on research_jobs (org_id, status, priority desc);
