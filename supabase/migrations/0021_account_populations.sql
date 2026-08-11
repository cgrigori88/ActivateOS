-- Phase 10: Account Mapping matrix (Crossbeam-style).
--
-- A "population" is a named, categorized list of accounts owned by one side —
-- the host org (partner_id null) or a specific partner. The matrix crosses the
-- org's populations (rows) with a partner's populations (columns); each cell is
-- the set of accounts in both. Extra ingested fields (territory, vertical,
-- segment, account owner, contact) ride along as per-member attributes so any
-- party can bring its own columns without a schema change.
--
-- Approval: a population proposed by one side sits 'pending' until approved,
-- so lists get vetted before they map.

create table account_populations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  partner_id     uuid references partners(id) on delete cascade,  -- null = the host org's own side
  name           text not null,
  category       text not null default 'custom'
                   check (category in ('customer','open_opportunity','prospect','target',
                                       'segment','territory','vertical','custom')),
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  source_batch_id uuid references import_batches(id) on delete set null,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index on account_populations (org_id, partner_id);
create index on account_populations (org_id, status);

create table population_members (
  population_id uuid not null references account_populations(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  attributes    jsonb not null default '{}',   -- territory, vertical, segment, account_owner_*, contact_*
  created_at    timestamptz not null default now(),
  primary key (population_id, company_id)
);
create index on population_members (company_id);
