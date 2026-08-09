-- Phase 2 cont.: pursuit routing. A pursuit team is the standing decision
-- "this partner (and seller) should pursue this account × solution" —
-- assembled from partner fits under capacity constraints, superseded (never
-- deleted) when a re-match changes the answer, auditable like everything else.

alter table partners
  add column if not exists capacity integer check (capacity is null or capacity > 0);
comment on column partners.capacity is
  'Max concurrent pursuits this partner can execute well. NULL = unconstrained.';

create table pursuit_teams (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  taxonomy_node_id  uuid not null references taxonomy_nodes(id) on delete cascade,
  partner_id        uuid not null references partners(id) on delete cascade,
  seller_id         uuid references sellers(id) on delete set null,
  partner_fit_id    uuid references partner_fit_scores(id) on delete set null,
  status            text not null default 'recommended'
                      check (status in ('recommended','accepted','declined','superseded')),
  reason            text,
  created_at        timestamptz not null default now()
);
create index on pursuit_teams (org_id, company_id, taxonomy_node_id, created_at desc);
create index on pursuit_teams (partner_id) where status in ('recommended','accepted');
