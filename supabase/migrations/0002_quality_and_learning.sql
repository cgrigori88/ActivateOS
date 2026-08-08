-- Quality gates and bounded self-learning (docs/QUALITY_AND_LEARNING.md)

-- ---------------------------------------------------------------------------
-- Evidence verification
-- ---------------------------------------------------------------------------

alter table evidence
  add column status text not null default 'pending'
    check (status in ('pending','verified','quarantined','rejected')),
  add column computed_confidence numeric
    check (computed_confidence between 0 and 1),
  add column verification jsonb,             -- check results, checker verdict
  add column claim_fingerprint text;         -- normalized claim key for corroboration

create index evidence_status_idx on evidence (status);
create index evidence_fingerprint_idx on evidence (claim_fingerprint)
  where claim_fingerprint is not null;

-- Source trust: learned, bounded, drives confidence AND audit sample rate.
alter table signal_sources
  add column trust_score numeric not null default 0.5
    check (trust_score between 0.05 and 0.99),
  add column audit_sample_rate numeric not null default 0.2
    check (audit_sample_rate between 0.02 and 0.5),
  add column audited_count integer not null default 0,
  add column accurate_count integer not null default 0;

-- HARD INVARIANT: no signal from unverified evidence.
create or replace function enforce_verified_evidence()
returns trigger language plpgsql as $$
begin
  if (select status from evidence where id = new.evidence_id) is distinct from 'verified' then
    raise exception 'signal % references evidence % that is not verified',
      new.id, new.evidence_id;
  end if;
  return new;
end $$;

create trigger signals_require_verified_evidence
  before insert or update of evidence_id on signals
  for each row execute function enforce_verified_evidence();

-- ---------------------------------------------------------------------------
-- Human review queue (trust-weighted sampling)
-- ---------------------------------------------------------------------------

create table review_queue (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organizations(id) on delete cascade,
  evidence_id  uuid not null references evidence(id) on delete cascade,
  reason       text not null check (reason in
                 ('sample','high_impact','checker_disagreement','contradiction')),
  status       text not null default 'pending'
                 check (status in ('pending','accurate','inaccurate','unsure')),
  notes        text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index review_queue_pending_idx on review_queue (status) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Golden sets and eval runs (regression tests of judgment)
-- ---------------------------------------------------------------------------

create table golden_examples (
  id          uuid primary key default gen_random_uuid(),
  workflow    text not null,                -- 'extractor','taxonomy_mapper','scorer',...
  input       jsonb not null,
  expected    jsonb not null,
  origin      text not null default 'seed'
                check (origin in ('seed','review_verdict','human')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index golden_examples_workflow_idx on golden_examples (workflow) where active;

create table eval_runs (
  id               uuid primary key default gen_random_uuid(),
  workflow         text not null,
  artifact_version text not null,           -- prompt/weight version under test
  total            integer not null,
  passed           integer not null,
  pass_rate        numeric not null,
  results          jsonb not null default '[]',
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Change proposals (bounded structural learning)
-- ---------------------------------------------------------------------------

create table change_proposals (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in
                    ('prompt','score_weights','ontology','play','threshold')),
  title           text not null,
  rationale       text not null,
  diff            jsonb not null,
  proposed_by     text not null check (proposed_by in ('system','human')),
  requires_human  boolean not null,         -- high-impact kinds always true
  eval_run_id     uuid references eval_runs(id) on delete set null,
  shadow_metrics  jsonb,
  status          text not null default 'proposed'
                    check (status in
                      ('proposed','evaluated','in_shadow','promoted','rejected')),
  decided_by      text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index change_proposals_open_idx on change_proposals (status)
  where status in ('proposed','evaluated','in_shadow');
