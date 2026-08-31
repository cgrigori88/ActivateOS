-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2B — Value Case. Economic drivers on the CANONICAL FACT GRAPH.
--
-- NO new value-case table, NO new ROI primitive, NO parallel evidence store. `facts` already
-- carries everything a Value Case needs: money_amount/money_currency for a point value,
-- object_type RANGE + object_value {low,high} for a bounded one, provenance_class, status,
-- fact_evidence, fact_contradictions, supersedes/superseded_by, and validity windows. This
-- migration therefore adds:
--
--   1. fact_predicates rows for the economic drivers (registry only);
--   2. facts.disclosure_class — the ONE additive column, using the EXISTING 6-value disclosure
--      vocabulary (not a second classification system), so a sponsor-confidential economic fact
--      can be excluded from a partner payload at the ROW rather than at each surface;
--   3. a governed-assertion guard on economic facts, mirroring 0097's stakeholder guard;
--   4. the ledger change-type vocabulary for economic assertions.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Disclosure at the row (§16) ─────────────────────────────────────────────────────────────
-- Nullable. NULL means "unclassified", which every reader treats as INTERNAL — the safe default:
-- an unclassified economic fact is never partner-visible. The vocabulary is the existing
-- disclosure_class used by route_candidate_reasons and transaction_features, so
-- LEGACY_TO_AUDIENCE / LEGACY_TO_SENSITIVITY in the federation disclosure engine already map it.
alter table facts add column if not exists disclosure_class text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facts_disclosure_class_check') then
    alter table facts add constraint facts_disclosure_class_check
      check (disclosure_class is null or disclosure_class in
        ('PUBLIC','INTERNAL','PARTNER_SHARED','TRANSACTION_CONFIDENTIAL','PII','RESTRICTED'));
  end if;
end $$;

create index if not exists facts_economic_idx
  on facts (org_id, predicate_key)
  where family = 'economic' and status in ('CURRENT','DISPUTED','STALE');

-- ── 2. Economic driver predicates (§1, §4) ─────────────────────────────────────────────────────
-- Every driver's semantics are explicit in `description`, including its ROLE in the arithmetic.
-- A driver whose role is not stated here is not supported by the Value Case model — the model
-- refuses to guess what a number means.
--
-- Roles (read by src/lib/value/drivers.ts):
--   BASELINE  — recurring cost of the CURRENT state. Context for what is at stake. NEVER summed
--               into modeled impact (spending $2M today is not a $2M benefit).
--   BENEFIT   — modeled recurring gain from the change. Summed into modeled impact.
--   CHANGE    — one-off cost of making the change. Subtracted from modeled impact.
--   TIMING    — not money; shapes when impact begins. Never summed.
--
-- allowed_provenance_classes is left at the registry default for economic drivers: an economic
-- driver may legitimately come from any source, because the PROVENANCE LADDER (§3) — not an
-- admission rule — is what tells a reader how much to trust it.
insert into fact_predicates (key, display_name, description, subject_type, object_type,
                             freshness_policy, default_half_life_days, family, signal_type,
                             contradiction_strategy)
values
  ('current_operating_cost', 'Current operating cost',
   'BASELINE. Recurring annual cost of running the current-state solution. Context for what is at stake; never counted as a benefit.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('license_subscription_cost', 'License / subscription cost',
   'BASELINE. Recurring annual license or subscription spend on the incumbent solution.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('labor_cost', 'Labor cost',
   'BASELINE. Recurring annual fully-loaded labor cost attributable to operating the current state.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('infrastructure_cost', 'Infrastructure cost',
   'BASELINE. Recurring annual infrastructure/hosting cost of the current state.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('contract_cost', 'Contract cost',
   'BASELINE. Annualized cost of the in-force contract under discussion.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('incumbent_renewal_exposure', 'Incumbent renewal exposure',
   'BASELINE. Spend that comes up for renewal with the incumbent — the amount genuinely in play.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_baseline', 'COMPETING_VALUE'),

  ('downtime_risk_cost', 'Downtime / risk cost',
   'BENEFIT. Expected annual cost of downtime or risk in the current state, avoided by the change. Requires a stated basis (frequency x impact); never a bare guess.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_benefit', 'COMPETING_VALUE'),

  ('avoided_cost', 'Avoided cost',
   'BENEFIT. Recurring annual cost the customer stops incurring as a result of the change.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_benefit', 'COMPETING_VALUE'),

  ('productivity_impact', 'Productivity impact',
   'BENEFIT. Recurring annual value of time or capacity released. Monetized; hours alone are not a Value Case input.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_benefit', 'COMPETING_VALUE'),

  ('revenue_impact', 'Revenue impact',
   'BENEFIT. Recurring annual incremental revenue or margin attributable to the change.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_benefit', 'COMPETING_VALUE'),

  ('migration_cost', 'Migration cost',
   'CHANGE. One-off cost of making the change (migration, services, retraining). Subtracted from modeled impact.',
   'COMPANY', 'MONEY', 'DECAYING', 365, 'economic', 'economic_change_cost', 'COMPETING_VALUE'),

  ('time_to_value_months', 'Time to value (months)',
   'TIMING. Months until modeled impact begins to accrue. Shapes when value lands; never summed into it.',
   'COMPANY', 'NUMBER', 'DECAYING', 365, 'economic', 'economic_timing', 'COMPETING_VALUE')
on conflict (key) do update
  set description = excluded.description,
      family = excluded.family,
      signal_type = excluded.signal_type;

-- ── 3. Governed economic assertion, no CRUD bypass (§7) ────────────────────────────────────────
-- Mirrors 0097's stakeholder guard. Scoped NARROWLY to the economic family so the many existing
-- fact producers (signal promotion, import, providers) are untouched: only an authoritative
-- economic assertion — one claiming a trusted provenance — must come through the governed skill.
-- INFERRED / THIRD_PARTY_UNVERIFIED economic facts may still be written by pipelines, because a
-- model proposing a number is not the same act as a human asserting one.
create or replace function economic_fact_assertion_guard() returns trigger
language plpgsql as $$
declare fam text;
begin
  if current_setting('app.governed_economic_assertion', true) is distinct from '1' then
    select family into fam from fact_predicates where key = new.predicate_key;
    if fam = 'economic'
       and new.provenance_class in ('FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','CUSTOMER_DECLARED','HUMAN_ASSERTED') then
      raise exception 'authoritative economic facts must go through the governed assert_economic_fact skill (P2B): predicate=% provenance=% requires the governed path',
        new.predicate_key, new.provenance_class;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists economic_fact_assertion_guard_trg on facts;
create trigger economic_fact_assertion_guard_trg
  before insert or update on facts
  for each row execute function economic_fact_assertion_guard();

-- ── 4. Ledger vocabulary ───────────────────────────────────────────────────────────────────────
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%ECONOMIC_FACT_ASSERTED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, ']))', ', ''ECONOMIC_FACT_ASSERTED''::text, ''ECONOMIC_FACT_DISPUTED''::text]))');
  end if;
end $$;
