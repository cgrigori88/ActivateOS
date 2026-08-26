-- Initiatives (task #83, the PSP answer): a named target that real activity
-- rolls up into. The anti-pattern this replaces is the partner-plan document
-- where initiatives carry a hand-typed target and $0 tracked forever because
-- nothing links deals to them. Here motions, campaigns, and opportunities
-- attach to an initiative, so target vs registered vs won/lost is computed,
-- never reported.

create table if not exists initiatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  partner_id uuid references partners(id) on delete cascade,  -- null = org-wide initiative
  name text not null,
  description text,
  target_usd numeric,
  period_label text,                                          -- e.g. "FY26", "Q3 2026" — display, not logic
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_by text not null default 'operator',
  created_at timestamptz not null default now()
);

create index if not exists initiatives_org_idx on initiatives (org_id, status);
create index if not exists initiatives_partner_idx on initiatives (partner_id) where partner_id is not null;

-- One initiative name per org scope (case-insensitive) keeps the library clean.
create unique index if not exists initiatives_org_name_key
  on initiatives (org_id, lower(name));

alter table revenue_motions add column if not exists initiative_id uuid references initiatives(id) on delete set null;
alter table campaigns       add column if not exists initiative_id uuid references initiatives(id) on delete set null;
alter table opportunities   add column if not exists initiative_id uuid references initiatives(id) on delete set null;

create index if not exists revenue_motions_initiative_idx on revenue_motions (initiative_id) where initiative_id is not null;
create index if not exists campaigns_initiative_idx       on campaigns (initiative_id)       where initiative_id is not null;
create index if not exists opportunities_initiative_idx   on opportunities (initiative_id)   where initiative_id is not null;
