-- 0048: Cross-tenant skill sharing (task #85, skills batch slice 2).
--
-- A partner can OFFER one of its skills across an active partnership; the
-- receiving org must ACCEPT before the skill grounds anything — the same
-- consent shape as list grants. The skill body stays owned (and editable)
-- by the sharing org; the recipient reads it live, never a copy. Revoking
-- or archiving on the owner's side stops the grounding immediately.

create table if not exists skill_shares (
  id             uuid primary key default gen_random_uuid(),
  skill_id       uuid not null references skills(id) on delete cascade,
  partnership_id uuid not null references partnerships(id) on delete cascade,
  status         text not null default 'offered' check (status in ('offered', 'accepted', 'declined')),
  offered_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (skill_id, partnership_id)
);

create index if not exists skill_shares_partnership_idx on skill_shares (partnership_id, status);

alter table skill_shares enable row level security;
drop policy if exists skill_shares_select on skill_shares;
create policy skill_shares_select on skill_shares for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
