-- 0082: Workstream E3-C — Context Contribution provenance object.
--
-- The durable object beneath RAW/DERIVED/FEDERATED/ASSERTED/AGGREGATED (R4): it
-- answers "Organization X contributed information Y, under policy Z, for purpose P,
-- to Pursuit Q." A Fact / route feature / score feature may reference it as its
-- provenance boundary — the contribution stays inspectable independent of the
-- derived artifact. Provenance (source_org_id) is ALWAYS retained; disclosure
-- controls inspection separately (R3). The schema must not require central custody
-- of the source rows (R5): raw_stored / derived_only make "ask my system a
-- permitted question, I keep the rows" representable today.
--
-- Additive and inert until FEDERATION_ENABLED reads it.

set check_function_bodies = off;

create table if not exists context_contributions (
  contribution_id uuid primary key default gen_random_uuid(),
  pursuit_id uuid references pursuits(id) on delete cascade,
  source_org_id uuid not null references organizations(id) on delete cascade,   -- provenance boundary (R3)
  source_system text,
  provider_id uuid,                          -- transaction_providers / providers (soft ref)
  contribution_mode text not null default 'DERIVED'
    check (contribution_mode in ('RAW','DERIVED','FEDERATED','ASSERTED','AGGREGATED')),  -- R4
  data_category text,
  subject_entity_id uuid,
  subject_kind text,                         -- COMPANY|ACCOUNT|PRODUCT|RELATIONSHIP|...
  semantic_meaning text,                     -- human-readable "what it means"
  provenance jsonb not null default '{}',
  observed_at timestamptz,                   -- event time (R12)
  contributed_at timestamptz not null default now(),   -- knowledge time (R12)
  valid_until timestamptz,
  disclosure_class text,                     -- audience (E3-B vocabulary)
  sensitivity_class text,                    -- sensitivity (E3-B vocabulary)
  purpose text,
  scope jsonb not null default '{}',
  consent_grant_id uuid references context_grants(id) on delete set null,
  raw_stored boolean not null default false,      -- R5: is the raw material centrally stored?
  derived_only boolean not null default true,     -- R5: only a derived feature exists?
  retention_class text,                            -- R29
  expires_at timestamptz,
  onward_sharing_allowed boolean not null default false,  -- R8
  delegation_allowed boolean not null default false,      -- R8
  revocation_state text not null default 'ACTIVE'
    check (revocation_state in ('ACTIVE','REVOKED','EXPIRED')),                  -- R28
  data_environment text not null default 'PRODUCTION',
  is_simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists context_contributions_pursuit on context_contributions (pursuit_id);
create index if not exists context_contributions_source on context_contributions (source_org_id, contribution_mode);

-- A Fact may originate from a Context Contribution — the provenance boundary (R4).
-- Additive nullable columns; existing facts keep working.
alter table facts add column if not exists source_org_id uuid references organizations(id) on delete set null;
alter table facts add column if not exists contribution_id uuid references context_contributions(contribution_id) on delete set null;
create index if not exists facts_contribution on facts (contribution_id);

-- Extend the transaction contribution mode vocabulary to the full E set (R4).
-- Additive CHECK-widen, the established pattern.
alter table transaction_providers drop constraint if exists transaction_providers_mode_check;
alter table transaction_providers add constraint transaction_providers_mode_check
  check (mode in ('RAW','DERIVED','FEDERATED','ASSERTED','AGGREGATED'));
alter table transaction_features drop constraint if exists transaction_features_mode_check;
alter table transaction_features add constraint transaction_features_mode_check
  check (mode in ('RAW','DERIVED','FEDERATED','ASSERTED','AGGREGATED'));

-- Grants + RLS. A contribution is visible to any org that can see the pursuit OR
-- to the source org itself; only the source org may write it (provenance is the
-- authoring boundary). revocation_state gates future USE (checked at read/recompute).
grant select, insert, update, delete on context_contributions to app_rw;
alter table context_contributions enable row level security;
drop policy if exists context_contributions_rw on context_contributions;
create policy context_contributions_rw on context_contributions for all to app_rw
  using (public.can_see_pursuit(pursuit_id) or public.is_org_member(source_org_id))
  with check (public.is_org_member(source_org_id));
