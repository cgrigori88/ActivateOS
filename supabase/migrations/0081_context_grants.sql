-- 0081: Workstream E3-B — purpose-limited consent grants.
--
-- The consent substrate for federation. A grant is not merely "Org A may share X
-- with Org B" — it binds a PURPOSE, a SCOPE (pursuit/account/list), permitted
-- information classes OR an action family, an expiry, and delegation/onward rules
-- (R8). Data consent and action authority are SEPARATE grant kinds (R24): a
-- sharing grant never implies the right to act on the grantor's behalf.
--
-- Revocation stops FUTURE access; historical audit is preserved elsewhere (R28).
-- Additive and inert until FEDERATION_ENABLED reads it.

set check_function_bodies = off;

create table if not exists context_grants (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid references pursuits(id) on delete cascade,   -- null = org-level (non-pursuit) grant
  from_org_id uuid not null references organizations(id) on delete cascade,   -- granting org
  to_org_id uuid not null references organizations(id) on delete cascade,     -- receiving org
  grant_kind text not null default 'DATA' check (grant_kind in ('DATA','ACTION')),  -- R24
  information_classes text[],        -- for DATA: audience classes the receiver may resolve
  action_family text,                -- for ACTION: e.g. 'route.request_acceptance'
  purpose text not null,             -- R8 purpose limitation
  scope jsonb not null default '{}', -- pursuit/account/list coverage
  status text not null default 'offered'
    check (status in ('offered','accepted','declined','revoked','expired')),
  delegation_allowed boolean not null default false,   -- R8
  onward_sharing_allowed boolean not null default false,-- R8
  retention_class text,              -- R29
  expires_at timestamptz,            -- R8/R28 TTL
  offered_at timestamptz not null default now(),
  decided_at timestamptz,
  revoked_at timestamptz,
  data_environment text not null default 'PRODUCTION',
  created_at timestamptz not null default now()
);
create index if not exists context_grants_to_org on context_grants (to_org_id, status);
create index if not exists context_grants_pursuit on context_grants (pursuit_id, status);

-- Participation may reference the grant that scoped it.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pursuit_participants_consent_grant_fk') then
    alter table pursuit_participants
      add constraint pursuit_participants_consent_grant_fk
      foreign key (consent_grant_id) references context_grants(id) on delete set null;
  end if;
end $$;

-- Grants + RLS: visible to either party; writes limited to the granting or
-- receiving org (offer by grantor; accept/decline by grantee; revoke by grantor).
grant select, insert, update, delete on context_grants to app_rw;
alter table context_grants enable row level security;
drop policy if exists context_grants_rw on context_grants;
create policy context_grants_rw on context_grants for all to app_rw
  using (public.is_org_member(from_org_id) or public.is_org_member(to_org_id))
  with check (public.is_org_member(from_org_id) or public.is_org_member(to_org_id));

-- A grant is LIVE iff accepted and not expired/revoked. Used by the disclosure
-- engine (read time) so revocation/expiry immediately blocks future access (R28).
create or replace function public.grant_is_live(g uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
    select exists (
      select 1 from context_grants c
      where c.id = g and c.status = 'accepted'
        and (c.expires_at is null or c.expires_at > now())
    );
  $$;
grant execute on function public.grant_is_live(uuid) to app_rw;
