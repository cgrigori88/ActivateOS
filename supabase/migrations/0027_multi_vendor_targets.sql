-- 0027 Multi-vendor campaign plays + per-period revenue targets
--
-- (a) campaign_partners: a campaign can carry SEVERAL partners, each in a role —
--     the multi-vendor solution play (reseller leads, distributor fulfills,
--     alliance brings the technology). Campaigns keep their legacy single
--     motion→partner link; this table is the n-ary upgrade.
-- (b) revenue_targets: per-period (calendar-year) pipeline / revenue targets,
--     overall (partner_id null) or per partner. Actuals are COMPUTED from
--     opportunities — targets are the only thing a human types.

create table if not exists campaign_partners (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  role        text not null default 'co_sell'
                check (role in ('lead','co_sell','fulfillment','distribution','technology')),
  created_at  timestamptz not null default now(),
  primary key (campaign_id, partner_id)
);
create index if not exists campaign_partners_partner_idx on campaign_partners (partner_id);

create table if not exists revenue_targets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  partner_id  uuid references partners(id) on delete cascade,  -- null = overall
  period_year integer not null,
  metric      text not null check (metric in ('pipeline','revenue')),
  target_usd  numeric not null,
  created_at  timestamptz not null default now()
);
-- One target per (org, partner, year, metric); partial indexes because
-- partner_id null (overall) needs its own uniqueness.
create unique index if not exists revenue_targets_partner_uk
  on revenue_targets (org_id, partner_id, period_year, metric) where partner_id is not null;
create unique index if not exists revenue_targets_overall_uk
  on revenue_targets (org_id, period_year, metric) where partner_id is null;
