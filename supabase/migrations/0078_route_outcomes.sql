-- 0078: Route outcome labels (Workstream C, §40-42). The first route-learning substrate:
-- what route we recommended, what was selected, what happened, how fast (§41), and enough
-- structure that future incrementality analysis is possible (§42) — without building causal
-- models now. Directional only; never a win-probability claim (§48). Flat SQL.

create table if not exists route_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  route_snapshot_id  uuid references pursuit_route_snapshots(id) on delete set null,
  outcome_label      text not null check (outcome_label in
                       ('ROUTE_RECOMMENDED','ROUTE_SELECTED','PARTNER_ACCEPTED','PARTNER_DECLINED',
                        'SELLER_ACCEPTED','SELLER_DECLINED','FIRST_ACTION_COMPLETED','CUSTOMER_ENGAGED',
                        'MEETING_CREATED','OPPORTUNITY_CREATED','PIPELINE_CREATED','DEAL_REGISTERED','WON','LOST')),
  recommended_route  jsonb,                 -- snapshot of the recommendation at the time
  selected_route     jsonb,
  intervention       jsonb,                 -- activation actions/timing (§42 — for future incrementality)
  occurred_at        timestamptz not null default now(),
  recorded_at        timestamptz not null default now(),
  seconds_since_recommended numeric,        -- time-to-event metric (§41)
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false
);
create index if not exists route_outcomes_pursuit on route_outcomes (org_id, pursuit_id, occurred_at);

grant select, insert, update, delete on route_outcomes to app_rw;
alter table route_outcomes enable row level security;
drop policy if exists route_outcomes_rw on route_outcomes;
create policy route_outcomes_rw on route_outcomes for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
