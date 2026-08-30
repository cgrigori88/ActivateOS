-- 0072: Pursuit↔Fact wiring + versioned Why-Now & convergence snapshots
-- (Workstream B, §18/§20/§22). Extends the 0066 link tables with FK integrity and a
-- richer relevance vocabulary, and adds durable, reconstructable snapshots so "Why Now
-- on Aug 1" stays queryable even after the graph moves on.
--
-- Flat SQL — paste-safe.

-- Richer relevance vocabulary on pursuit_facts (§18). Keep the old values for back-compat.
alter table pursuit_facts drop constraint if exists pursuit_facts_relevance_type_check;
alter table pursuit_facts add constraint pursuit_facts_relevance_type_check
  check (relevance_type in
    ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','TIMING_ANCHOR','SOLUTION_FIT','PARTNER_ROUTE',
     'RISK','CONTRADICTION','CONTRADICTING','BACKGROUND'));
-- Provenance of the link itself (§18).
alter table pursuit_facts add column if not exists linked_by_type text;
alter table pursuit_facts add column if not exists linked_by_id uuid;

-- FK integrity now that the target tables exist (tables are empty → free to enforce).
alter table pursuit_facts add constraint pursuit_facts_ref_fk
  foreign key (ref_id) references facts(id) on delete cascade;
alter table pursuit_signals add constraint pursuit_signals_ref_fk
  foreign key (ref_id) references signals(id) on delete cascade;
alter table pursuit_evidence add constraint pursuit_evidence_ref_fk
  foreign key (ref_id) references evidence(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- pursuit_why_now_snapshots (§22): durable, versioned, reconstructable Why Now.
-- pursuits.why_now stays a convenience pointer to the current snapshot's payload.
-- ---------------------------------------------------------------------------
create table if not exists pursuit_why_now_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  seq                integer not null,
  is_current         boolean not null default true,
  as_of              timestamptz not null,
  why_now            jsonb not null,           -- structured graph output (every element id-referenced)
  rendered_summary   text,                     -- optional LLM gloss, non-authoritative (§23)
  rendered_by_model  text,
  rendered_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (pursuit_id, seq)
);
create unique index if not exists pursuit_why_now_one_current
  on pursuit_why_now_snapshots (pursuit_id) where is_current;

-- ---------------------------------------------------------------------------
-- pursuit_convergence_snapshots (§20): independence-aware convergence, versioned.
-- ---------------------------------------------------------------------------
create table if not exists pursuit_convergence_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  pursuit_id         uuid not null references pursuits(id) on delete cascade,
  seq                integer not null,
  is_current         boolean not null default true,
  families           jsonb not null default '[]',   -- signal/provenance families present
  supporting_fact_ids uuid[] not null default '{}',
  source_diversity   numeric,                        -- distinct independent sources / total
  independent_family_count integer not null default 0,
  contradictions     integer not null default 0,
  convergence_score  numeric,
  window_days        integer not null default 90,
  explanation        jsonb,                          -- why this count (independence reasoning, §19)
  version            text not null default 'v1-facts-convergence',
  calculated_at      timestamptz not null default now(),
  unique (pursuit_id, seq)
);
create unique index if not exists pursuit_convergence_one_current
  on pursuit_convergence_snapshots (pursuit_id) where is_current;

-- RLS.
grant select, insert, update, delete on pursuit_why_now_snapshots to app_rw;
grant select, insert, update, delete on pursuit_convergence_snapshots to app_rw;
alter table pursuit_why_now_snapshots enable row level security;
alter table pursuit_convergence_snapshots enable row level security;
drop policy if exists pursuit_why_now_snapshots_rw on pursuit_why_now_snapshots;
create policy pursuit_why_now_snapshots_rw on pursuit_why_now_snapshots for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists pursuit_convergence_snapshots_rw on pursuit_convergence_snapshots;
create policy pursuit_convergence_snapshots_rw on pursuit_convergence_snapshots for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
