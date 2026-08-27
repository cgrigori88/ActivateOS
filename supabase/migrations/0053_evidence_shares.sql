-- 0053: Consented evidence exchange (no-partner-needed batch, slice G).
--
-- A tenant can OFFER one of its verified claims about a named-overlap account
-- across an active partnership; the counterpart must ACCEPT before the claim
-- appears in their account room. Same consent shape as skill shares: the
-- claim stays owned by the sharing org, the recipient reads it live (never a
-- copy), and revoking removes it from their view immediately.

create table if not exists evidence_shares (
  id             uuid primary key default gen_random_uuid(),
  evidence_id    uuid not null references evidence(id) on delete cascade,
  partnership_id uuid not null references partnerships(id) on delete cascade,
  offered_by_org uuid not null references organizations(id) on delete cascade,
  status         text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'revoked')),
  offered_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (evidence_id, partnership_id)
);

create index if not exists evidence_shares_partnership_idx on evidence_shares (partnership_id, status);

alter table evidence_shares enable row level security;
drop policy if exists evidence_shares_select on evidence_shares;
create policy evidence_shares_select on evidence_shares for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
