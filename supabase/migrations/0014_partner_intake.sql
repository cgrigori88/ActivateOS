-- Partner intake & mapping foundation (Phase 8).
--
-- Two features hang off this: Intake (per-partner CSV upload + analytics +
-- runs log) and Mapping (cross-partner account overlap for co-sell). The
-- membership table also fixes a gap in the autonomous loop — imported accounts
-- with no prior evidence were orphaned from their org and never screened.

-- Vendors are a first-class partner type alongside resellers/distributors.
alter table partners drop constraint if exists partners_partner_type_check;
alter table partners add constraint partners_partner_type_check
  check (partner_type in
    ('reseller','distributor','msp','solution_provider','agent','alliance','vendor'));

-- Every CSV upload is a batch — powers the per-partner cards and the runs log.
create table import_batches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  partner_id     uuid references partners(id) on delete set null,
  filename       text,
  kind           text not null default 'accounts' check (kind in ('accounts','report')),
  row_count      integer not null default 0,
  matched_count  integer not null default 0,   -- resolved to an existing company
  created_count  integer not null default 0,   -- net-new companies
  evidence_count integer not null default 0,
  status         text not null default 'imported'
                   check (status in ('importing','imported','failed')),
  uploaded_by    text,
  error          text,
  created_at     timestamptz not null default now()
);
create index on import_batches (org_id, created_at desc);
create index on import_batches (partner_id, created_at desc);

-- Which companies are on which partner's list. A company on ≥2 partners' lists
-- is the OVERLAP that Mapping surfaces. Also serves as org-portfolio membership
-- for the screening sweep.
create table partner_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  partner_id     uuid not null references partners(id) on delete cascade,
  company_id     uuid not null references companies(id) on delete cascade,
  batch_id       uuid references import_batches(id) on delete set null,
  target_product text,                          -- the play into this account
  installed      boolean not null default false, -- known installed base → expand/cross-sell
  created_at     timestamptz not null default now(),
  unique (partner_id, company_id)
);
create index on partner_accounts (org_id);
create index on partner_accounts (company_id);
create index on partner_accounts (partner_id);
