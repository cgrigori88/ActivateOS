-- 0039: Joint Pursuit Rooms (unicorn roadmap Act II, task #74).
--
-- A shared workspace per co-sell pursuit spanning two tenants. The consent
-- chain is strict and builds on blind overlap (0037):
--
--   partnership active → named-overlap rung approved → a pursuit can be
--   PROPOSED only on an account in those named results → the counterpart
--   accepts → the room opens.
--
-- Inside the room everything is SYMMETRIC by construction: events (notes,
-- decisions, broker proposals) are stored once and rendered identically to
-- both sides — org names, never "you/them", in stored text. The broker
-- (org_id null) may only compose from data both sides have already consented
-- to (the named-overlap categories); that invariant lives in code and is the
-- room's whole point: a neutral seat neither side's personal tooling can hold.

create table if not exists joint_pursuits (
  id              uuid primary key default gen_random_uuid(),
  partnership_id  uuid not null references partnerships(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  status          text not null default 'proposed' check (status in ('proposed', 'active', 'declined', 'closed')),
  proposed_by_org uuid not null references organizations(id) on delete cascade,
  decided_at      timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (partnership_id, company_id)
);

create table if not exists joint_pursuit_events (
  id         uuid primary key default gen_random_uuid(),
  pursuit_id uuid not null references joint_pursuits(id) on delete cascade,
  org_id     uuid references organizations(id) on delete cascade, -- null = broker/system
  actor      text not null,
  kind       text not null check (kind in ('status', 'note', 'proposal', 'decision')),
  body       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists joint_pursuit_events_pursuit_idx on joint_pursuit_events (pursuit_id, created_at);
create index if not exists joint_pursuits_partnership_idx on joint_pursuits (partnership_id, created_at desc);

alter table joint_pursuits enable row level security;
alter table joint_pursuit_events enable row level security;

drop policy if exists joint_pursuits_select on joint_pursuits;
create policy joint_pursuits_select on joint_pursuits for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));

drop policy if exists joint_pursuit_events_select on joint_pursuit_events;
create policy joint_pursuit_events_select on joint_pursuit_events for select to authenticated
  using (exists (select 1 from joint_pursuits jp join partnerships p on p.id = jp.partnership_id
                 where jp.id = pursuit_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
