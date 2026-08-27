-- 0054: CRM writeback proposals (no-partner-needed batch, slice A).
--
-- The tie-out card names where the CRM and the live record disagree; this
-- table holds the corrections the platform PROPOSES back. Nothing touches the
-- CRM by itself: a human approves, then the approved set exports (CSV today,
-- the live push adapter plugs into the same queue tomorrow). The record
-- doesn't just detect drift — it repairs it, behind a gate.

create table if not exists crm_writebacks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  opportunity_name text not null,
  field text not null default 'amount' check (field in ('amount', 'stage', 'presence')),
  crm_value text,
  live_value text,
  rationale text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed', 'exported')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists crm_writebacks_org_idx on crm_writebacks (org_id, status, created_at desc);

-- One open proposal per opportunity+field keeps the queue deduplicated.
create unique index if not exists crm_writebacks_open_key
  on crm_writebacks (org_id, lower(opportunity_name), field)
  where status in ('proposed', 'approved');
