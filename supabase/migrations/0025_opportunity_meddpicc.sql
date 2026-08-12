-- 0025 MEDDPICC qualification on opportunities
--
-- MEDDPICC is the qualification metrology for pipeline: Metrics, Economic buyer,
-- Decision criteria, Decision process, Paper process, Identified pain, Champion,
-- Competition. We store it as one labeled row per element (not 16 columns) so
-- each assessment is a first-class training example: element → status, banked
-- against the opportunity's eventual outcome. Status is a coarse strength
-- ladder the AI and humans share (unknown → gap → weak → strong).

create table if not exists opportunity_meddpicc (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  element        text not null check (element in
                   ('metrics','economic_buyer','decision_criteria','decision_process',
                    'paper_process','identified_pain','champion','competition')),
  status         text not null default 'unknown'
                   check (status in ('unknown','gap','weak','strong')),
  notes          text,
  source         text not null default 'human'   -- 'human' | 'ai_assist'
                   check (source in ('human','ai_assist')),
  updated_by     text,
  updated_at     timestamptz not null default now(),
  unique (opportunity_id, element)
);
create index if not exists opportunity_meddpicc_opp_idx on opportunity_meddpicc (opportunity_id);
