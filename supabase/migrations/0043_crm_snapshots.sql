-- 0043: CRM snapshots (task #83, CRM-export ingestion).
--
-- The CRM's version of a deal is a SIGNAL, not the truth: each export row
-- becomes a snapshot carrying exactly what the CRM said (stage as stated,
-- normalized stage, amount, close date) with full provenance. Live
-- opportunities are only created when we hold nothing for the account —
-- an existing record is never silently overwritten. Divergence detection
-- compares the latest snapshot against the live record: "your CRM says X,
-- PursuitOS holds Y", with the receipts.

create table if not exists crm_snapshots (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  opportunity_name text not null,
  stage            text not null,  -- normalized to platform stages where recognizable
  stage_raw        text,           -- verbatim what the CRM said
  amount_usd       numeric,
  close_date       date,
  batch_id         uuid references import_batches(id) on delete set null,
  reported_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists crm_snapshots_org_company_idx
  on crm_snapshots (org_id, company_id, reported_at desc);

alter table crm_snapshots enable row level security;

drop policy if exists crm_snapshots_select on crm_snapshots;
create policy crm_snapshots_select on crm_snapshots for select to authenticated
  using (is_org_member(org_id));
