-- 0066: Many-to-many shared context (Workstream A, §16-17). Evidence/Signals/Facts/
-- Interactions/Relationships are account/context objects that MULTIPLE pursuits may
-- consume; never duplicate the source. Association carries relevance metadata so the
-- same Fact can be a PRIMARY_TRIGGER for one pursuit and SUPPORTING_CONTEXT for another.
-- Facts/Interactions/Relationships tables land in Workstreams B/G; the link tables are
-- created now (correct shape) so those workstreams need no schema change to link.
-- Written flat (no DO/FOREACH) so it is paste-safe in the Supabase SQL editor too.

create table if not exists pursuit_evidence (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  ref_id uuid not null,
  relevance_type text check (relevance_type in ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','CONTRADICTING','BACKGROUND')),
  relevance_score numeric, reason text, linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, ref_id)
);
create index if not exists pursuit_evidence_ref on pursuit_evidence (ref_id);
grant select, insert, update, delete on pursuit_evidence to app_rw;
alter table pursuit_evidence enable row level security;
drop policy if exists pursuit_evidence_rw on pursuit_evidence;
create policy pursuit_evidence_rw on pursuit_evidence for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));

create table if not exists pursuit_signals (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  ref_id uuid not null,
  relevance_type text check (relevance_type in ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','CONTRADICTING','BACKGROUND')),
  relevance_score numeric, reason text, linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, ref_id)
);
create index if not exists pursuit_signals_ref on pursuit_signals (ref_id);
grant select, insert, update, delete on pursuit_signals to app_rw;
alter table pursuit_signals enable row level security;
drop policy if exists pursuit_signals_rw on pursuit_signals;
create policy pursuit_signals_rw on pursuit_signals for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));

create table if not exists pursuit_facts (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  ref_id uuid not null,
  relevance_type text check (relevance_type in ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','CONTRADICTING','BACKGROUND')),
  relevance_score numeric, reason text, linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, ref_id)
);
create index if not exists pursuit_facts_ref on pursuit_facts (ref_id);
grant select, insert, update, delete on pursuit_facts to app_rw;
alter table pursuit_facts enable row level security;
drop policy if exists pursuit_facts_rw on pursuit_facts;
create policy pursuit_facts_rw on pursuit_facts for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));

create table if not exists pursuit_interactions (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  ref_id uuid not null,
  relevance_type text check (relevance_type in ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','CONTRADICTING','BACKGROUND')),
  relevance_score numeric, reason text, linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, ref_id)
);
create index if not exists pursuit_interactions_ref on pursuit_interactions (ref_id);
grant select, insert, update, delete on pursuit_interactions to app_rw;
alter table pursuit_interactions enable row level security;
drop policy if exists pursuit_interactions_rw on pursuit_interactions;
create policy pursuit_interactions_rw on pursuit_interactions for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));

create table if not exists pursuit_relationships (
  pursuit_id uuid not null references pursuits(id) on delete cascade,
  ref_id uuid not null,
  relevance_type text check (relevance_type in ('PRIMARY_TRIGGER','SUPPORTING_CONTEXT','CONTRADICTING','BACKGROUND')),
  relevance_score numeric, reason text, linked_by text, linked_at timestamptz not null default now(),
  primary key (pursuit_id, ref_id)
);
create index if not exists pursuit_relationships_ref on pursuit_relationships (ref_id);
grant select, insert, update, delete on pursuit_relationships to app_rw;
alter table pursuit_relationships enable row level security;
drop policy if exists pursuit_relationships_rw on pursuit_relationships;
create policy pursuit_relationships_rw on pursuit_relationships for all to app_rw
  using (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)))
  with check (exists (select 1 from pursuits p where p.id = pursuit_id and is_org_member(p.org_id)));
