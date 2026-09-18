-- 0113 — D-HIST-2: machine-readable provenance for pipeline_snapshots.
--
-- WHAT THIS IS. `pipeline_snapshots` used to gain a row because somebody rendered /pipeline, so the
-- series recorded who had been browsing rather than what the business did — while both consumers
-- (the week-ago comparison and the 30/60-day calibration card) reason about it as a daily sample.
-- The render-time write is gone. This migration makes the distinction between the old rows and the
-- new producer's rows MACHINE-READABLE, so a legacy row can never be mistaken for a valid sample.
--
-- WHY A COLUMN AND NOT A CUTOVER DATE. A date constant in application code is undocumented, invisible
-- to the database, and wrong the moment anyone backfills or restores. A column travels with the row.
--
-- THE LOAD-BEARING INVARIANT: **new analytical history cannot acquire provenance accidentally.**
-- The transitional default classifies the rows that already exist and is then REMOVED, so any future
-- insert that omits `source` fails loudly instead of quietly becoming legacy data.
--
-- Legacy rows are NOT rewritten or deleted. They remain diagnostic artifacts; they are simply not
-- valid inputs to the new product-history semantics.
--
-- Additive: no RLS change, no grant change, no policy change, no rewrite of any existing value.

-- 1. Add the column with a transitional default, so existing rows classify safely in one statement.
alter table pipeline_snapshots
  add column if not exists source text default 'legacy_observation';

-- 2. Establish every pre-existing row as legacy observation (defensive: the default already did it).
update pipeline_snapshots set source = 'legacy_observation' where source is null;

-- 3. Require provenance on every row.
alter table pipeline_snapshots
  alter column source set not null;

-- 4. Close the vocabulary. `scheduled_daily_v1` versions the SAMPLING CONTRACT itself: a later change
--    to what a daily sample means gets its own value rather than silently reinterpreting these rows.
alter table pipeline_snapshots
  drop constraint if exists pipeline_snapshots_source_check;
alter table pipeline_snapshots
  add constraint pipeline_snapshots_source_check
  check (source in ('legacy_observation', 'scheduled_daily_v1'));

-- 5. REMOVE the transitional default. From here a producer must state its provenance explicitly, and
--    an insert that forgets fails rather than inheriting a classification it did not earn.
alter table pipeline_snapshots
  alter column source drop default;

-- 6. `taken_on` carried `default now()::date`, which is the SESSION timezone — the local clone
--    (America/Chicago) and the Preview runtime (UTC) disagreed about what day it was for five to six
--    hours of every day, so the same instant wrote a different row depending on who connected. The
--    D-HIST-2 contract is an explicit UTC calendar date supplied by the producer, so the implicit
--    session-local default is removed too. Existing `taken_on` values are NOT reinterpreted: their
--    ambiguous basis is part of why they are `legacy_observation`.
alter table pipeline_snapshots
  alter column taken_on drop default;
