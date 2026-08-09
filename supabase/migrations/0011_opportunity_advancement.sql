-- Phase 6: Opportunity Advancement. A motion that lands a meeting becomes a
-- real opportunity with staged progression, an explicit stakeholder map
-- (coverage gaps are pipeline risk), and an auditable stage history.

create table opportunities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete cascade,
  company_id        uuid not null references companies(id) on delete cascade,
  motion_id         uuid references revenue_motions(id) on delete set null,
  taxonomy_node_id  uuid references taxonomy_nodes(id) on delete set null,
  name              text not null,
  stage             text not null default 'discovery'
    check (stage in ('discovery','qualification','business_validation',
                     'proposal','negotiation','closed_won','closed_lost')),
  amount_usd        numeric,
  next_step         text,
  expected_close_date date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index on opportunities (org_id, stage);
create index on opportunities (company_id);

create table opportunity_stage_transitions (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_stage     text,
  to_stage       text not null,
  note           text,
  occurred_at    timestamptz not null default now()
);
create index on opportunity_stage_transitions (opportunity_id, occurred_at);

create table stakeholders (
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  contact_id     uuid not null references contacts(id) on delete cascade,
  role           text not null default 'influencer'
    check (role in ('economic_buyer','technical_buyer','champion',
                    'influencer','blocker','end_user')),
  sentiment      text not null default 'unknown'
    check (sentiment in ('positive','neutral','negative','unknown')),
  primary key (opportunity_id, contact_id)
);

-- The columns existed since 0010; now they have something to reference.
alter table communication_threads
  add constraint communication_threads_opportunity_fk
  foreign key (opportunity_id) references opportunities(id) on delete set null;
alter table interaction_events
  add constraint interaction_events_opportunity_fk
  foreign key (opportunity_id) references opportunities(id) on delete set null;

alter table outcome_events drop constraint outcome_events_event_type_check;
alter table outcome_events add constraint outcome_events_event_type_check
  check (event_type in
    ('MOTION_CREATED','MOTION_APPROVED','MOTION_REJECTED','MOTION_ACTIVATED',
     'MOTION_COMPLETED','MOTION_ABANDONED','CAMPAIGN_CREATED',
     'ACTION_DONE','ACTION_SKIPPED','TEAM_ACCEPTED','TEAM_DECLINED',
     'SELLER_ASSIGNED','SELLER_ACCEPTED','MESSAGE_SENT','MESSAGE_OPENED',
     'CUSTOMER_REPLIED','POSITIVE_RESPONSE','NEGATIVE_RESPONSE','MEETING_BOOKED',
     'OPPORTUNITY_CREATED','OPPORTUNITY_ADVANCED','QUOTE_CREATED',
     'CLOSED_WON','CLOSED_LOST'));
