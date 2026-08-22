-- 0046: Partner + joint playbooks (task #83, GTM-OS batch slice 3).
--
-- partner_playbooks: YOUR playbook for working one partner — grounds the AI
-- agents (motion designer, and through it the outreach chain) whenever that
-- partner is on the pursuit. Org-private.
--
-- joint_playbooks: ONE body per partnership, co-edited by both tenants in the
-- joint room — symmetric like the ledger, read identically by both sides,
-- every edit on both audit ledgers. The broker cites it.

create table if not exists partner_playbooks (
  org_id      uuid not null references organizations(id) on delete cascade,
  partner_id  uuid not null references partners(id) on delete cascade,
  positioning text,
  strengths   text,
  rules       text,
  updated_at  timestamptz not null default now(),
  primary key (org_id, partner_id)
);

create table if not exists joint_playbooks (
  partnership_id uuid primary key references partnerships(id) on delete cascade,
  body           text not null default '',
  updated_by_org uuid references organizations(id) on delete set null,
  updated_at     timestamptz not null default now()
);

alter table partner_playbooks enable row level security;
alter table joint_playbooks enable row level security;

drop policy if exists partner_playbooks_select on partner_playbooks;
create policy partner_playbooks_select on partner_playbooks for select to authenticated
  using (is_org_member(org_id));

drop policy if exists joint_playbooks_select on joint_playbooks;
create policy joint_playbooks_select on joint_playbooks for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
