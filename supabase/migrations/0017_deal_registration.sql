-- Phase 9E: Deal Registration — the co-sell commercial artifact. A partner
-- registers a deal on an end-customer account with a vendor to claim deal
-- protection and margin. Vendor-agnostic: the vendor, product, and terms are
-- fields, not hard-coded to any one program.

create table deal_registrations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade,
  opportunity_id      uuid references opportunities(id) on delete set null,
  company_id          uuid not null references companies(id) on delete cascade,
  motion_id           uuid references revenue_motions(id) on delete set null,
  partner_id          uuid references partners(id) on delete set null, -- who registers (reseller/distributor)
  vendor              text,                       -- with whom (vendor program), free-text = vendor-agnostic
  product             text,                       -- what is being sold
  amount_usd          numeric,
  status              text not null default 'draft'
                        check (status in ('draft','submitted','approved','rejected','expired')),
  registration_number text,                       -- external program reference
  submitted_at        timestamptz,
  decided_at          timestamptz,
  protected_until     date,                        -- deal-protection window
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on deal_registrations (org_id, status);
create index on deal_registrations (company_id);
create index on deal_registrations (opportunity_id);
