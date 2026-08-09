-- Phase 2: Ecosystem Match (BLUEPRINT §Phase 2). The canonical opportunity
-- unit is Account × Product × Partner × Seller × Motion × Time — this
-- migration adds what a partner CAN do (capabilities, coverage) and where
-- computed partner fit lands. Fit scoring is deterministic and versioned,
-- exactly like propensity.

-- What a partner is able to sell/deliver, per taxonomy node.
create table partner_capabilities (
  partner_id        uuid not null references partners(id) on delete cascade,
  taxonomy_node_id  uuid not null references taxonomy_nodes(id) on delete cascade,
  strength          numeric not null check (strength between 0 and 1),
  certified         boolean not null default false,
  primary key (partner_id, taxonomy_node_id)
);

-- Coverage: where a partner plays. Empty array = unrestricted.
alter table partners
  add column if not exists industries text[] not null default '{}',
  add column if not exists countries text[] not null default '{}';

create table partner_fit_scores (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  taxonomy_node_id  uuid not null references taxonomy_nodes(id) on delete cascade,
  partner_id        uuid not null references partners(id) on delete cascade,
  score             numeric not null check (score between 0 and 100),
  band              text not null check (band in ('very_high','high','medium','low')),
  version           text not null,
  computed_at       timestamptz not null default now()
);
create index on partner_fit_scores (org_id, company_id, taxonomy_node_id, computed_at desc);

create table partner_fit_features (
  fit_id       uuid not null references partner_fit_scores(id) on delete cascade,
  feature      text not null,
  contribution numeric not null,
  detail       text,
  primary key (fit_id, feature)
);
