-- 0097: Stakeholder Intelligence (Intelligence Wave P1C) — ADDITIVE extension of the existing
-- `stakeholders` substrate. The locked design: no second stakeholder/person primitive, no PK
-- relaxation (the (opportunity_id, contact_id) key stays — pre-opportunity coverage is honestly
-- UNKNOWN), nullable pursuit_id linkage, source/provenance, and a three-state assertion model:
--
--   verified    evidence-confirmed buying role (customer confirmation or equivalent)
--   inferred    derived from signals with a stated basis — a machine/AI proposal, never authority
--   unverified  asserted or seeded without confirmation (the default; all legacy rows land here)
--
-- Authoritative role assertions flow ONLY through the governed `assert_stakeholder_role` skill
-- (dispatchSkill). That is enforced at the DATABASE level by `stakeholder_assertion_guard`: any
-- INSERT above 'unverified', and any UPDATE that changes role or assertion_state, requires the
-- transaction-local GUC `app.governed_assertion = '1'`, which only the governed handler sets.
-- Existing creation paths (conversation seeding inserts default-role unverified rows) keep
-- working; the direct role-editing CRUD path is closed. History lives in the append-only
-- change_ledger (0094) — a superseding assertion never erases the prior one.

alter table stakeholders add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
alter table stakeholders add column if not exists source text;
alter table stakeholders add column if not exists assertion_state text not null default 'unverified';
alter table stakeholders add column if not exists asserted_at timestamptz;
alter table stakeholders add column if not exists asserted_by uuid;

do $$ begin
  alter table stakeholders add constraint stakeholders_assertion_state_check
    check (assertion_state in ('verified', 'inferred', 'unverified'));
exception when duplicate_object then null; end $$;

-- Backfill the canonical pursuit linkage from the opportunity that already carries it. Rows whose
-- opportunity has no pursuit stay NULL — honestly unlinked, never guessed.
update stakeholders s set pursuit_id = o.pursuit_id
  from opportunities o
 where o.id = s.opportunity_id and o.pursuit_id is not null and s.pursuit_id is null;

create index if not exists stakeholders_pursuit_idx on stakeholders (pursuit_id) where pursuit_id is not null;

-- Governed-path enforcement. Legacy rows all defaulted to 'unverified', so nothing existing trips.
create or replace function stakeholder_assertion_guard() returns trigger
language plpgsql as $$
begin
  if current_setting('app.governed_assertion', true) is distinct from '1' then
    if tg_op = 'INSERT' and new.assertion_state <> 'unverified' then
      raise exception 'stakeholder role assertions must go through the governed assert_stakeholder_role skill (P1C): INSERT with assertion_state=% requires the governed path', new.assertion_state;
    elsif tg_op = 'UPDATE' and (new.role is distinct from old.role or new.assertion_state is distinct from old.assertion_state) then
      raise exception 'stakeholder role assertions must go through the governed assert_stakeholder_role skill (P1C): direct role/assertion_state mutation is not an alternate path';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists stakeholder_assertion_guard_trg on stakeholders;
create trigger stakeholder_assertion_guard_trg
  before insert or update on stakeholders
  for each row execute function stakeholder_assertion_guard();

-- The governed assertion appends STAKEHOLDER_ROLE_ASSERTED history — admit it to the ledger's
-- change-type vocabulary (constraint rebuilt with the one additional value; all prior values kept).
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%STAKEHOLDER_ROLE_ASSERTED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, '''CONTRIBUTION_REVOKED''::text]', '''CONTRIBUTION_REVOKED''::text, ''STAKEHOLDER_ROLE_ASSERTED''::text]');
  end if;
end $$;
