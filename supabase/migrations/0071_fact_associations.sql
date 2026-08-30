-- 0071: Fact support/contradiction associations + review lineage (Workstream B, §13-15/§34-35).
--
-- Support and contradiction are stored INDEPENDENTLY and never netted away — a Fact can
-- show "3 supporting, 1 contradicting" and name each. Contradiction carries a typed class
-- (§14) so resolution can differ for a negation vs. a competing value vs. a temporal
-- conflict. fact_reviews captures the human-adjudication lineage (system recommendation →
-- human decision + edits + reason) as supervision data (§35).
--
-- Flat SQL — paste-safe.

create table if not exists fact_evidence (
  fact_id     uuid not null references facts(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  stance      text not null check (stance in ('SUPPORTS','CONTRADICTS')),
  weight      numeric,
  observed_at timestamptz not null,          -- snapshot of evidence.observed_at (as-of)
  linked_by   text,
  linked_at   timestamptz not null default now(),
  primary key (fact_id, evidence_id)
);
create index if not exists fact_evidence_evidence on fact_evidence (evidence_id);
create index if not exists fact_evidence_stance on fact_evidence (fact_id, stance);

create table if not exists fact_signals (
  fact_id   uuid not null references facts(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  stance    text not null check (stance in ('SUPPORTS','CONTRADICTS')),
  weight    numeric,
  observed_at timestamptz not null,
  linked_by text,
  linked_at timestamptz not null default now(),
  primary key (fact_id, signal_id)
);
create index if not exists fact_signals_signal on fact_signals (signal_id);

create table if not exists fact_contradictions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  fact_id_a         uuid not null references facts(id) on delete cascade,
  fact_id_b         uuid not null references facts(id) on delete cascade,
  contradiction_type text not null check (contradiction_type in
                      ('NEGATION','COMPETING_VALUE','TEMPORAL_CONFLICT','SCOPE_CONFLICT','SOURCE_DISAGREEMENT')),
  basis             text,
  status            text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution        text,                    -- how it resolved (which fact won, or dismissed)
  detected_at       timestamptz not null default now(),
  resolved_at       timestamptz
);
create index if not exists fact_contradictions_a on fact_contradictions (fact_id_a);
create index if not exists fact_contradictions_b on fact_contradictions (fact_id_b);
create index if not exists fact_contradictions_open on fact_contradictions (org_id) where status = 'open';

create table if not exists fact_reviews (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  candidate_id         uuid references fact_candidates(id) on delete set null,
  fact_id              uuid references facts(id) on delete set null,
  system_recommendation text not null,       -- 'AUTO_PROMOTE'|'REVIEW'|'REJECT'
  proposed_confidence  numeric,
  reason               text not null,        -- why review was required
  human_decision       text check (human_decision in ('ACCEPT','REJECT','EDIT','DEFER')),
  human_edits          jsonb,                -- structured edits (predicate/object/subject overrides)
  decision_reason      text,
  reviewer_id          uuid,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz
);
create index if not exists fact_reviews_open on fact_reviews (org_id) where human_decision is null;
create index if not exists fact_reviews_candidate on fact_reviews (candidate_id);

-- Now that facts exists, wire the candidate→fact promotion FK.
alter table fact_candidates
  add constraint fact_candidates_promoted_fk
  foreign key (promoted_fact_id) references facts(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS. Association tables are org-scoped directly (they carry org_id or are parent-scoped).
-- fact_evidence / fact_signals have no org_id column → scope via the parent fact's org.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on fact_evidence to app_rw;
grant select, insert, update, delete on fact_signals to app_rw;
grant select, insert, update, delete on fact_contradictions to app_rw;
grant select, insert, update, delete on fact_reviews to app_rw;
alter table fact_evidence enable row level security;
alter table fact_signals enable row level security;
alter table fact_contradictions enable row level security;
alter table fact_reviews enable row level security;

drop policy if exists fact_evidence_rw on fact_evidence;
create policy fact_evidence_rw on fact_evidence for all to app_rw
  using (exists (select 1 from facts f where f.id = fact_id and is_org_member(f.org_id)))
  with check (exists (select 1 from facts f where f.id = fact_id and is_org_member(f.org_id)));
drop policy if exists fact_signals_rw on fact_signals;
create policy fact_signals_rw on fact_signals for all to app_rw
  using (exists (select 1 from facts f where f.id = fact_id and is_org_member(f.org_id)))
  with check (exists (select 1 from facts f where f.id = fact_id and is_org_member(f.org_id)));
drop policy if exists fact_contradictions_rw on fact_contradictions;
create policy fact_contradictions_rw on fact_contradictions for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
drop policy if exists fact_reviews_rw on fact_reviews;
create policy fact_reviews_rw on fact_reviews for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
