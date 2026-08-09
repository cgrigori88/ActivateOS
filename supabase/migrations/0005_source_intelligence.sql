-- Source Intelligence (BLUEPRINT: sources are scored on predictive value,
-- not just accuracy). Accuracy = does the source's evidence survive
-- verification (trust_score, 0002). Predictive value = does the source's
-- evidence end up powering high-propensity accounts.

alter table signal_sources
  add column if not exists predictive_value numeric,
  add column if not exists scored_evidence integer not null default 0,
  add column if not exists high_band_evidence integer not null default 0,
  add column if not exists intel_evaluated_at timestamptz;
