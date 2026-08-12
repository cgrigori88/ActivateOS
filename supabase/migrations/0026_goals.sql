-- 0026 S.M.A.R.T. goals
--
-- A goal makes revenue work Specific, Measurable, Achievable, Relevant and
-- Time-bound. It names a target on a measurable metric with a due date; motions
-- and campaigns link to it, and progress is COMPUTED from those linked entities
-- (not hand-typed) so the number is always honest. Pace = progress vs time
-- elapsed, so "behind" is a real signal, not a vibe.

create table if not exists goals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  name           text not null,                         -- Specific
  description    text,
  metric         text not null default 'pipeline_usd'   -- Measurable
                   check (metric in ('pipeline_usd','won_usd','opps_won','motions_won',
                                     'touches_sent','custom')),
  target_value   numeric not null,                      -- Achievable target
  baseline_value numeric not null default 0,
  manual_value   numeric,                               -- current for 'custom' metric
  unit           text,                                  -- display unit for 'custom'
  start_date     date not null default current_date,
  due_date       date,                                  -- Time-bound
  status         text not null default 'active'
                   check (status in ('active','achieved','missed','archived')),
  owner          text,
  created_at     timestamptz not null default now()
);
create index if not exists goals_org_idx on goals (org_id);

alter table revenue_motions add column if not exists goal_id uuid references goals(id) on delete set null;
alter table campaigns      add column if not exists goal_id uuid references goals(id) on delete set null;
create index if not exists revenue_motions_goal_idx on revenue_motions (goal_id);
create index if not exists campaigns_goal_idx on campaigns (goal_id);
