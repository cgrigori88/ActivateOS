-- 0080: Workstream E3-A — Federated Pursuit participation.
--
-- Establishes the N-organization participation edge around the ONE canonical
-- Pursuit (never a per-tenant copy, R1), an EXTENSIBLE role registry (roles are
-- seed data, not a frozen CHECK, R3), the can_see_pursuit() visibility predicate
-- (mirrors can_see_partnership in 0060), and the Room→Pursuit projection binding
-- (R1/§5 — a Joint Room projects one canonical Pursuit; it is never the object).
--
-- SAFETY: additive and inert until FEDERATION_ENABLED reads it. This migration
-- deliberately does NOT widen read access to Pursuit child data (facts, scores,
-- routes, etc.) — participant reads are mediated by the E3-B disclosure engine and
-- land there, so E3-A introduces the edge + predicate without new data exposure.
-- Participation is explicit and never derived from route or room membership (R2).

set check_function_bodies = off;

-- ---- Extensible role registry (R3) -----------------------------------------
-- The initial roles are seed data; the graph shape is not encoded around
-- vendor/distributor/reseller. New role types are additive rows, not a DDL change.
create table if not exists pursuit_role_types (
  role_key text primary key,
  label text not null,
  side text,                                  -- coarse grouping for UI/topology
  is_route_capable boolean not null default true,  -- may appear in a commercial route
  sort int not null default 100,
  created_at timestamptz not null default now()
);

insert into pursuit_role_types (role_key, label, side, is_route_capable, sort) values
  ('VENDOR',           'Vendor',                  'VENDOR',      true,  10),
  ('DISTRIBUTOR',      'Distributor',             'DISTRIBUTOR', true,  20),
  ('RESELLER',         'Reseller',                'RESELLER',    true,  30),
  ('SERVICES_PARTNER', 'Services partner',        'SERVICES',    true,  40),
  ('HYPERSCALER',      'Hyperscaler / marketplace','ALLIANCE',   true,  50),
  ('TECH_ALLIANCE',    'Technology alliance',     'ALLIANCE',    false, 60),
  ('CONSULTANT_SI',    'Consultant / SI',         'SERVICES',    true,  70),
  ('CUSTOMER_GUEST',   'Customer (guest)',        'CUSTOMER',    false, 80),
  ('OBSERVER',         'Observer',                'OBSERVER',    false, 90)
on conflict (role_key) do nothing;

-- ---- The N-org participation edge on the canonical Pursuit (R1/R2/R3) --------
create table if not exists pursuit_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,       -- participating org (RLS subject)
  pursuit_id uuid not null references pursuits(id) on delete cascade,          -- the ONE canonical Pursuit
  sponsor_org_id uuid not null references organizations(id) on delete cascade, -- = pursuits.org_id at join time
  role_key text not null references pursuit_role_types(role_key),
  participation_state text not null default 'INVITED'
    check (participation_state in ('INVITED','ACTIVE','DECLINED','LEFT','REVOKED')),
  consent_grant_id uuid,           -- FK to context_grants (added in E3-B); scope/purpose/expiry
  disclosure_default text,         -- audience-class ceiling for this participant (resolved by E3-B engine)
  inviter_org_id uuid references organizations(id) on delete set null,
  invited_by uuid,
  sponsor_actor uuid,
  source_of_participation text,    -- partnership | invite | join_code | broker | sponsor
  joined_at timestamptz,
  left_at timestamptz,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  data_environment text not null default 'PRODUCTION',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pursuit_id, org_id)
);
create index if not exists pursuit_participants_org_active
  on pursuit_participants (org_id) where participation_state = 'ACTIVE';
create index if not exists pursuit_participants_pursuit
  on pursuit_participants (pursuit_id, participation_state);

-- ---- Room → Pursuit projection binding (R1 / §5) ---------------------------
-- A Joint Room (0039) becomes a scoped collaboration PROJECTION of a Pursuit.
-- Nullable + additive: legacy rooms without a Pursuit keep working.
alter table joint_pursuits add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
create index if not exists joint_pursuits_pursuit on joint_pursuits (pursuit_id);

-- ---- can_see_pursuit(): sponsor org OR any ACTIVE participant org -----------
-- SECURITY DEFINER, mirrors can_see_partnership (0060). Visibility of the pursuit
-- EDGE is not visibility of its confidential FIELDS — the E3-B disclosure engine
-- governs field content per caller. Used by RLS on federation tables here and by
-- the widened Pursuit-family read policies in E3-B.
create or replace function public.can_see_pursuit(p uuid) returns boolean
  language sql stable security definer set search_path to 'public' as $$
    select exists (
      select 1 from pursuits pu where pu.id = p and public.is_org_member(pu.org_id)
    ) or exists (
      select 1 from pursuit_participants pp
      where pp.pursuit_id = p
        and pp.participation_state = 'ACTIVE'
        and public.is_org_member(pp.org_id)
    );
  $$;
grant execute on function public.can_see_pursuit(uuid) to app_rw;

-- ---- Grants + RLS on the new tables ----------------------------------------
grant select, insert, update, delete on pursuit_participants to app_rw;
grant select on pursuit_role_types to app_rw;

alter table pursuit_role_types enable row level security;
drop policy if exists pursuit_role_types_read on pursuit_role_types;
create policy pursuit_role_types_read on pursuit_role_types for select to app_rw using (true);

-- A participant row is visible to any org that can see the pursuit (sponsor or an
-- ACTIVE participant) OR to the participant's own org — so an INVITED org can see
-- and accept its own invitation before it is ACTIVE. Writes are limited to the
-- participant's own org or the sponsor (invite/accept/revoke) — participation is
-- never derived from route or room membership (R2).
alter table pursuit_participants enable row level security;
drop policy if exists pursuit_participants_rw on pursuit_participants;
create policy pursuit_participants_rw on pursuit_participants for all to app_rw
  using (public.can_see_pursuit(pursuit_id) or public.is_org_member(org_id))
  with check (public.is_org_member(org_id) or public.is_org_member(sponsor_org_id));
