-- Workstream B verification harness addition: the intelligence substrate the Fact
-- migrations (0069-0072) reference. Faithful to the live column shapes (0001/0002/0012/
-- 0013) minus the pgvector embedding (not needed for Fact tests). Applied on top of
-- wsa_harness.sql, before migrations 0069-0072.

create table if not exists evidence (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  company_id    uuid references companies(id) on delete cascade,
  source_type   text not null,
  source_url    text,
  claim         text not null,
  confidence    numeric not null check (confidence between 0 and 1),
  observed_at   timestamptz not null,
  collected_at  timestamptz not null default now(),
  expires_at    timestamptz,
  raw_excerpt   text,
  status        text not null default 'pending' check (status in ('pending','verified','quarantined','rejected')),
  computed_confidence numeric check (computed_confidence between 0 and 1),
  verification  jsonb,
  claim_fingerprint text,
  stance        text not null default 'supports' check (stance in ('supports','refutes')),
  provider_id   text,
  first_party   boolean not null default false,
  published_at  timestamptz
);
create index if not exists evidence_company_idx on evidence (company_id);
create index if not exists evidence_fingerprint_idx on evidence (claim_fingerprint) where claim_fingerprint is not null;

create table if not exists signal_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, kind text not null, created_at timestamptz not null default now()
);

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  signal_type text not null,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  direction smallint not null default 1 check (direction in (-1,1)),
  magnitude numeric not null default 1 check (magnitude between 0 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  half_life_days integer not null default 180,
  evidence_id uuid not null references evidence(id) on delete cascade,
  source_id uuid references signal_sources(id) on delete set null,
  first_seen timestamptz, last_seen timestamptz, expires_at timestamptz, value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists signals_company_idx on signals (company_id);

create table if not exists contradictions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  basis text not null,
  signal_id_a uuid references signals(id) on delete cascade,
  signal_id_b uuid references signals(id) on delete cascade,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at timestamptz not null default now()
);

create table if not exists review_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  reason text not null check (reason in ('sample','high_impact','checker_disagreement','contradiction')),
  status text not null default 'pending' check (status in ('pending','accurate','inaccurate','unsure')),
  notes text, created_at timestamptz not null default now(), resolved_at timestamptz
);

-- RLS mirrors 0058/0061: org-scoped tables use is_org_member; signal_sources is reference.
grant select, insert, update, delete on evidence to app_rw;
grant select, insert, update, delete on signals to app_rw;
grant select, insert, update, delete on contradictions to app_rw;
grant select, insert, update, delete on review_queue to app_rw;
grant select, insert, update, delete on signal_sources to app_rw;
alter table evidence enable row level security;
alter table signals enable row level security;
alter table contradictions enable row level security;
alter table review_queue enable row level security;
alter table signal_sources enable row level security;
drop policy if exists evidence_rw on evidence;
create policy evidence_rw on evidence for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists signals_rw on signals;
create policy signals_rw on signals for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists contradictions_rw on contradictions;
create policy contradictions_rw on contradictions for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists review_queue_rw on review_queue;
create policy review_queue_rw on review_queue for all to app_rw using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists signal_sources_rw on signal_sources;
create policy signal_sources_rw on signal_sources for all to app_rw using (true) with check (true);
