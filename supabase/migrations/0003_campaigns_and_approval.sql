-- Campaign assets, approval bookkeeping, and agent-run ↔ motion linkage.

create table campaign_assets (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  asset_type  text not null check (asset_type in
                ('seller_playbook','outreach_email','discovery_guide','objection_cards')),
  title       text,
  content     text not null,          -- markdown
  created_at  timestamptz not null default now()
);
create index campaign_assets_campaign_idx on campaign_assets (campaign_id);

-- Link agent runs to the motion they produced (decision-log traceability).
alter table agent_runs add column motion_id uuid references revenue_motions(id) on delete set null;

-- Extend the outcome-event vocabulary with campaign creation.
alter table outcome_events drop constraint outcome_events_event_type_check;
alter table outcome_events add constraint outcome_events_event_type_check
  check (event_type in
    ('MOTION_CREATED','MOTION_APPROVED','MOTION_REJECTED','CAMPAIGN_CREATED',
     'SELLER_ASSIGNED','SELLER_ACCEPTED','MESSAGE_SENT','MESSAGE_OPENED',
     'CUSTOMER_REPLIED','POSITIVE_RESPONSE','NEGATIVE_RESPONSE','MEETING_BOOKED',
     'OPPORTUNITY_CREATED','QUOTE_CREATED','CLOSED_WON','CLOSED_LOST'));
