-- P2C-1 §11: answer provenance.
--
-- Every answer must be attributable to the intent that was chosen, the resolver that produced it,
-- the scope it ran under, and the records it stands on. `ask_exchanges` already stored the question
-- and the answer; these columns add the resolution path so an answer can be audited without
-- re-running it, and so a drifting interpreter is detectable from the log alone.
--
-- What is deliberately NOT stored (§11, "do not log confidential payload content unnecessarily"):
-- no hit payloads, no explanation bodies, no amounts, no names beyond what the operator typed and
-- the one-line composed answer they were shown. `record_hrefs` holds deep links only — enough to
-- re-derive the answer under the reader's own authorisation, and nothing that discloses on its own.
--
-- All columns are nullable and additive: rows written before P2C-1 stay valid and readable.

alter table ask_exchanges add column if not exists intent_key      text;
alter table ask_exchanges add column if not exists intent_class    text;
alter table ask_exchanges add column if not exists resolution_path text;
alter table ask_exchanges add column if not exists outcome         text;
alter table ask_exchanges add column if not exists slots           jsonb;
alter table ask_exchanges add column if not exists record_hrefs    jsonb;
alter table ask_exchanges add column if not exists scope_size      integer;
alter table ask_exchanges add column if not exists interpret_ms    integer;
alter table ask_exchanges add column if not exists resolve_ms      integer;
alter table ask_exchanges add column if not exists total_ms        integer;
-- Why a model interpretation was discarded (timeout, invented intent, schema violation). Kept so
-- interpreter failure is measurable rather than invisible; never rendered as an answer.
alter table ask_exchanges add column if not exists rejection       text;
-- Fingerprint of the intent catalog the interpretation was made against, so an answer logged
-- before an intent changed is not mistaken for one made against today's registry.
alter table ask_exchanges add column if not exists catalog_version text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ask_exchanges_path_check') then
    alter table ask_exchanges add constraint ask_exchanges_path_check
      check (resolution_path is null or resolution_path in ('GOTO','DETERMINISTIC','INTERPRETED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ask_exchanges_outcome_check') then
    alter table ask_exchanges add constraint ask_exchanges_outcome_check
      check (outcome is null or outcome in ('MATCHED','AMBIGUOUS','UNSUPPORTED','UNKNOWN'));
  end if;
end $$;

-- The debugging cut: "which questions did the interpreter answer, and how did they end?"
create index if not exists ask_exchanges_path_idx
  on ask_exchanges (org_id, resolution_path, created_at desc);
