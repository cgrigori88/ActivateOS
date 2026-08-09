-- Phase 3: Motion Engine (BLUEPRINT Phase 3). Motions gain an explicit
-- lifecycle with timestamps and a closing outcome, plus deterministic
-- economics (estimated value from the play template × account size, effort
-- from the play) so the portfolio can be ranked by expected value.

alter table revenue_motions
  add column if not exists activated_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists outcome text
    check (outcome is null or outcome in ('won','lost','no_decision')),
  add column if not exists estimated_value_usd numeric,
  add column if not exists effort integer check (effort is null or effort between 1 and 5);

-- Lifecycle events join the outcome-event vocabulary.
alter table outcome_events drop constraint outcome_events_event_type_check;
alter table outcome_events add constraint outcome_events_event_type_check
  check (event_type in
    ('MOTION_CREATED','MOTION_APPROVED','MOTION_REJECTED','MOTION_ACTIVATED',
     'MOTION_COMPLETED','MOTION_ABANDONED','CAMPAIGN_CREATED',
     'SELLER_ASSIGNED','SELLER_ACCEPTED','MESSAGE_SENT','MESSAGE_OPENED',
     'CUSTOMER_REPLIED','POSITIVE_RESPONSE','NEGATIVE_RESPONSE','MEETING_BOOKED',
     'OPPORTUNITY_CREATED','QUOTE_CREATED','CLOSED_WON','CLOSED_LOST'));
