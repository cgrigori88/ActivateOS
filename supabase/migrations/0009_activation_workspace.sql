-- Phase 4: Activation Workspace. When a motion goes ACTIVE its play cadence
-- becomes concrete, dated actions in a queue — activation means scheduled
-- work, not a status change. Action completions land in the outcome-event
-- log like everything else.

create table motion_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  motion_id   uuid not null references revenue_motions(id) on delete cascade,
  step        integer not null,
  action      text not null,
  due_at      timestamptz not null,
  status      text not null default 'pending'
                check (status in ('pending','done','skipped')),
  completed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (motion_id, step)
);
create index on motion_actions (org_id, status, due_at);

alter table outcome_events drop constraint outcome_events_event_type_check;
alter table outcome_events add constraint outcome_events_event_type_check
  check (event_type in
    ('MOTION_CREATED','MOTION_APPROVED','MOTION_REJECTED','MOTION_ACTIVATED',
     'MOTION_COMPLETED','MOTION_ABANDONED','CAMPAIGN_CREATED',
     'ACTION_DONE','ACTION_SKIPPED','TEAM_ACCEPTED','TEAM_DECLINED',
     'SELLER_ASSIGNED','SELLER_ACCEPTED','MESSAGE_SENT','MESSAGE_OPENED',
     'CUSTOMER_REPLIED','POSITIVE_RESPONSE','NEGATIVE_RESPONSE','MEETING_BOOKED',
     'OPPORTUNITY_CREATED','QUOTE_CREATED','CLOSED_WON','CLOSED_LOST'));
