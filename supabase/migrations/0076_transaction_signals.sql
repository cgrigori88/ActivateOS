-- 0076: Distributor transaction signals (Workstream C, §34-39). A generic
-- TransactionSignalProvider abstraction with RAW/DERIVED/FEDERATED modes — NO TD SYNNEX-
-- specific logic embedded. Transaction features are a distinct source family, carry full
-- provenance/validity/lineage (§35), and a data-classification for derived disclosure (§38).
-- Synthetic fixtures only pre-demo; nothing here connects to a live distributor. Flat SQL.

create table if not exists transaction_providers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  mode               text not null check (mode in ('RAW','DERIVED','FEDERATED')),
  status             text not null default 'active' check (status in ('active','disabled')),
  config             jsonb not null default '{}',
  created_at         timestamptz not null default now()
);

create table if not exists transaction_features (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  provider_id        uuid references transaction_providers(id) on delete set null,
  mode               text not null check (mode in ('RAW','DERIVED','FEDERATED')),
  canonical_company_id uuid references companies(id) on delete cascade,   -- null until entity resolved (§31)
  taxonomy_node_id   uuid references taxonomy_nodes(id) on delete set null,
  partner_id         uuid references partners(id) on delete set null,     -- route context (which reseller)
  feature_key        text not null,        -- category_spend_12m, category_spend_growth, purchase_recency, ...
  feature_value      numeric,
  feature_text       text,
  observed_period_start timestamptz,
  observed_period_end   timestamptz,
  generated_at       timestamptz not null default now(),
  confidence         numeric,
  data_classification text not null default 'TRANSACTION_CONFIDENTIAL' check (data_classification in
                       ('PUBLIC','INTERNAL','PARTNER_SHARED','TRANSACTION_CONFIDENTIAL','PII','RESTRICTED')),
  source_lineage     jsonb,
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists transaction_features_lookup on transaction_features (org_id, canonical_company_id, taxonomy_node_id, feature_key);
create index if not exists transaction_features_resolved on transaction_features (org_id) where canonical_company_id is not null;

grant select on transaction_providers to app_rw;
grant select, insert, update, delete on transaction_features to app_rw;
alter table transaction_providers enable row level security;
alter table transaction_features enable row level security;
drop policy if exists transaction_providers_ro on transaction_providers;
create policy transaction_providers_ro on transaction_providers for select to app_rw using (true);
drop policy if exists transaction_features_rw on transaction_features;
create policy transaction_features_rw on transaction_features for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
