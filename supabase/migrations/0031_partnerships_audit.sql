-- 0031 Partnership handshake + cross-tenant audit log (multi-tenant slice 5)
--
-- The cross-tenant model, as an upgrade of what exists:
--
--  * `partners` rows remain each org's LENS on a counterpart — every screen,
--    matrix, campaign and motion keyed on partners.id keeps working untouched.
--  * A `partnership` connects two tenants' lenses: the initiator creates an
--    invite (code), the counterpart's owner redeems it, and each side ends up
--    with its own partners row bound to the same partnership. States:
--    invited → active → revoked.
--  * Nothing crosses the tenant boundary except an explicit `list_grant`:
--    org A offers one of its lists (field-scoped), org B ACCEPTS before
--    anything materializes on B's side — the two-sided version of the review
--    flow. Revocation flips the materialized copy to rejected.
--  * `audit_log` is each tenant's ledger of every cross-tenant and access
--    event — "what did they see and when" gets a real answer.

create table if not exists partnerships (
  id                     uuid primary key default gen_random_uuid(),
  initiator_org_id       uuid not null references organizations(id) on delete cascade,
  counterpart_org_id     uuid references organizations(id) on delete cascade,
  initiator_partner_id   uuid references partners(id) on delete set null,
  counterpart_partner_id uuid references partners(id) on delete set null,
  invite_code            text not null unique,
  status                 text not null default 'invited'
                           check (status in ('invited','active','revoked')),
  created_at             timestamptz not null default now(),
  activated_at           timestamptz,
  revoked_at             timestamptz
);
create index if not exists partnerships_initiator_idx on partnerships (initiator_org_id);
create index if not exists partnerships_counterpart_idx on partnerships (counterpart_org_id);

create table if not exists list_grants (
  id                        uuid primary key default gen_random_uuid(),
  partnership_id            uuid not null references partnerships(id) on delete cascade,
  from_org_id               uuid not null references organizations(id) on delete cascade,
  population_id             uuid not null references account_populations(id) on delete cascade,
  selected_fields           text[],
  status                    text not null default 'offered'
                              check (status in ('offered','accepted','declined','revoked')),
  materialized_population_id uuid references account_populations(id) on delete set null,
  created_at                timestamptz not null default now(),
  decided_at                timestamptz
);
create index if not exists list_grants_partnership_idx on list_grants (partnership_id);

create table if not exists audit_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  actor          text not null,             -- user email, or 'operator'/'system'
  event          text not null,             -- e.g. partnership.accepted, grant.offered
  detail         jsonb not null default '{}',
  partnership_id uuid references partnerships(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_org_idx on audit_log (org_id, created_at desc);

-- RLS (rule from 0028: every new table enables it).
alter table partnerships enable row level security;
alter table list_grants  enable row level security;
alter table audit_log    enable row level security;

-- Either side of a partnership may read it; grants are visible to the granting
-- org and the partnership's other side; the ledger is each org's own. Writes
-- stay app-only (owner connection) — no API-role write policies on purpose.
create policy partnership_select on partnerships for select to authenticated
  using (is_org_member(initiator_org_id)
         or (counterpart_org_id is not null and is_org_member(counterpart_org_id)));
create policy grant_select on list_grants for select to authenticated
  using (is_org_member(from_org_id)
         or exists (select 1 from partnerships p
                    where p.id = partnership_id
                      and (is_org_member(p.initiator_org_id)
                           or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
create policy audit_select on audit_log for select to authenticated
  using (is_org_member(org_id));
