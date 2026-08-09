-- Phase 1: Intelligence Foundation (docs/BLUEPRINT.md)
-- Multidimensional scoring, contradiction detection, what-changed tracking,
-- signal lifecycle, expanded ontology edges, agent observability, refresh tiers.

-- Ontology: full edge vocabulary.
alter table taxonomy_edges drop constraint taxonomy_edges_edge_type_check;
alter table taxonomy_edges add constraint taxonomy_edges_edge_type_check
  check (edge_type in ('adjacent','complementary','competitive','replacement',
                       'prerequisite','expansion'));

-- Signals: lifecycle fields per the registry spec.
alter table signals
  add column first_seen timestamptz,
  add column last_seen  timestamptz,
  add column expires_at timestamptz,
  add column value      jsonb;          -- typed payload (e.g. expiry date, counts)
update signals set first_seen = observed_at, last_seen = observed_at;

-- Multidimensional scores: one row per dimension per score run.
create table propensity_dimensions (
  score_id  uuid not null references propensity_scores(id) on delete cascade,
  dimension text not null check (dimension in
              ('purchase_need','purchase_propensity','timing','solution_fit',
               'evidence_confidence','corroboration','convergence',
               'activation_probability','seller_fit','incrementality')),
  value     numeric not null check (value between 0 and 100),
  primary key (score_id, dimension)
);

-- What changed + positive/negative evidence split, on every score run.
alter table propensity_scores
  add column prev_score numeric,
  add column positive_points numeric,
  add column negative_points numeric,
  add column changes jsonb;             -- {delta, new_evidence_ids, notes[]}

-- Contradictions: opposing evidence recorded, never silently netted away.
create table contradictions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  taxonomy_node_id uuid references taxonomy_nodes(id) on delete set null,
  basis         text not null,          -- e.g. 'opposing_direction_signals'
  signal_id_a   uuid references signals(id) on delete cascade,
  signal_id_b   uuid references signals(id) on delete cascade,
  status        text not null default 'open'
                  check (status in ('open','resolved','dismissed')),
  detected_at   timestamptz not null default now()
);
create index contradictions_company_idx on contradictions (company_id) where status = 'open';

-- Agent observability: job-system fields on the decision log.
alter table agent_runs
  add column prompt_version text,
  add column input_tokens  integer,
  add column output_tokens integer,
  add column cost_usd      numeric(10,6),
  add column latency_ms    integer;

-- Refresh engine: tiered research cadence per company.
alter table companies
  add column refresh_tier text check (refresh_tier in ('very_high','high','medium','low')),
  add column next_refresh_at timestamptz;
