-- 0042: Warm-intro requests — the ecosystem-qualified lead (B+3, task #82).
--
-- The consent chain mirrors joint pursuits (0039): partnership active →
-- named-overlap rung approved → an intro can be REQUESTED only on an account
-- in those named results (both sides already know both have it). The
-- counterpart's decision is the disclosure: accepting REVEALS exactly one of
-- their contacts on that account — snapshotted into the row (name/title/
-- email) so both sides read the identical record even if the contact later
-- changes. Declining reveals nothing. Both ledgers record every step.

create table if not exists warm_intro_requests (
  id               uuid primary key default gen_random_uuid(),
  partnership_id   uuid not null references partnerships(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  requested_by_org uuid not null references organizations(id) on delete cascade,
  -- who the requester hopes to reach and why — shown verbatim to the partner
  ask              text not null,
  status           text not null default 'requested' check (status in ('requested', 'accepted', 'declined')),
  -- accept-time snapshot of the revealed contact, symmetric by construction
  revealed_contact jsonb,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists warm_intro_requests_partnership_idx
  on warm_intro_requests (partnership_id, created_at desc);

alter table warm_intro_requests enable row level security;

drop policy if exists warm_intro_requests_select on warm_intro_requests;
create policy warm_intro_requests_select on warm_intro_requests for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
