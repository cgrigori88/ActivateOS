-- 0069: Fact predicate registry + promotion policies (Workstream B, §2/§3/§11/§12).
--
-- fact_predicates is a DISTINCT, richly-typed ontology for durable Facts — seeded
-- from (but never a thin alias of) the signal registry. Each predicate declares what
-- KIND of proposition it is: subject/object typing, value schema, freshness behavior,
-- allowed provenance, which score dimensions it may influence, and its contradiction
-- strategy. fact_promotion_policies makes the evidence→Fact gate predicate-aware and
-- tunable as governed data, not hardcoded thresholds.
--
-- Written flat (no DO/FOREACH) so it is paste-safe in the Supabase SQL editor.

create table if not exists fact_predicates (
  id                        uuid primary key default gen_random_uuid(),
  key                       text not null unique,          -- 'renewal_date','technology_in_use',...
  display_name              text not null,
  description               text not null,
  subject_type              text not null,                 -- default subject scope (see facts.subject_scope)
  object_type               text not null check (object_type in
                              ('STRING','NUMBER','BOOLEAN','DATE','DATETIME','ENUM','ENTITY_REF','MONEY','PERCENTAGE','RANGE','JSON')),
  value_schema              jsonb not null default '{}',   -- optional JSON-schema-ish descriptor / enum members
  default_half_life_days    integer,                       -- null for STATIC/PERMANENT/VALID_UNTIL
  freshness_policy          text not null default 'DECAYING' check (freshness_policy in
                              ('STATIC','EVENT','DECAYING','VALID_UNTIL','PERMANENT_HISTORY')),
  allowed_provenance_classes text[] not null default
                              array['FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','THIRD_PARTY_UNVERIFIED','CUSTOMER_DECLARED','HUMAN_ASSERTED'],
  supports_timing           boolean not null default false,
  supports_propensity       boolean not null default false,
  supports_solution_fit     boolean not null default false,
  supports_partner_activation boolean not null default false,
  supports_seller_activation  boolean not null default false,
  contradiction_strategy    text not null default 'COMPETING_VALUE' check (contradiction_strategy in
                              ('NEGATION','COMPETING_VALUE','TEMPORAL_CONFLICT','SCOPE_CONFLICT','SOURCE_DISAGREEMENT')),
  signal_type               text,                          -- optional 1:1 map to a SIGNAL_DEFS type (deterministic promotion)
  version                   integer not null default 1,
  status                    text not null default 'active' check (status in ('draft','active','deprecated')),
  created_at                timestamptz not null default now()
);

create table if not exists fact_promotion_policies (
  id                     uuid primary key default gen_random_uuid(),
  predicate_key          text not null references fact_predicates(key) on delete cascade,
  minimum_support_count  integer not null default 1,
  minimum_trust          numeric not null default 0.55 check (minimum_trust between 0 and 1),
  first_party_required   boolean not null default false,
  corroboration_required boolean not null default false,     -- ≥2 independent source types+families
  allowed_provenance     text[],                             -- null = inherit predicate.allowed_provenance_classes
  maximum_age_days       integer,                            -- reject support older than this at promotion
  auto_promote_allowed   boolean not null default true,
  human_review_required  boolean not null default false,
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  unique (predicate_key, version)
);

-- Reference tables: readable by app_rw, writable by owner only (like play_templates).
grant select on fact_predicates to app_rw;
grant select on fact_promotion_policies to app_rw;
alter table fact_predicates enable row level security;
alter table fact_promotion_policies enable row level security;
drop policy if exists fact_predicates_ro on fact_predicates;
create policy fact_predicates_ro on fact_predicates for select to app_rw using (true);
drop policy if exists fact_promotion_policies_ro on fact_promotion_policies;
create policy fact_promotion_policies_ro on fact_promotion_policies for select to app_rw using (true);

-- ---------------------------------------------------------------------------
-- Seed: a curated durable-Fact ontology (distinct from signals; §2 examples included).
-- ---------------------------------------------------------------------------
insert into fact_predicates
  (key, display_name, description, subject_type, object_type, default_half_life_days, freshness_policy,
   supports_timing, supports_propensity, supports_solution_fit, supports_partner_activation, supports_seller_activation,
   contradiction_strategy, signal_type)
values
  ('technology_in_use','Technology in use','The account operates a specific technology/product in production.',
     'TECHNOLOGY','ENTITY_REF',540,'DECAYING', false,true,true,false,false,'NEGATION','TECH_INSTALLED'),
  ('renewal_date','Renewal date','A contract/subscription renews on a specific date.',
     'CONTRACT','DATE',null,'VALID_UNTIL', true,true,false,false,false,'COMPETING_VALUE','CONTRACT_EXPIRING'),
  ('contract_expires','Contract expiry','A vendor contract expires on a specific date.',
     'CONTRACT','DATE',null,'VALID_UNTIL', true,true,false,false,false,'COMPETING_VALUE','CONTRACT_EXPIRING'),
  ('migrating_from','Migrating away from technology','The account is migrating off a named technology.',
     'TECHNOLOGY','ENTITY_REF',270,'DECAYING', true,true,true,false,false,'NEGATION','MIGRATION_SIGNAL'),
  ('platform_evaluation_active','Platform evaluation active','The account is actively evaluating a platform/category.',
     'TECHNOLOGY','ENUM',120,'DECAYING', true,true,true,false,false,'NEGATION','EVALUATION_SIGNAL'),
  ('strategic_initiative','Strategic initiative','The account has a stated strategic initiative.',
     'COMPANY','STRING',365,'DECAYING', false,true,true,false,false,'NEGATION','STRATEGIC_INITIATIVE'),
  ('is_hiring_for_role_category','Hiring for role category','The account is hiring for a role category.',
     'COMPANY','ENUM',90,'DECAYING', false,true,true,false,false,'COMPETING_VALUE','HIRING_ACCELERATION'),
  ('headcount_growth_direction','Headcount growth direction','Direction of headcount change in a function.',
     'COMPANY','ENUM',120,'DECAYING', false,true,false,false,false,'COMPETING_VALUE','HIRING_ACCELERATION'),
  ('budget_reduction_target','Budget reduction target','The account has a cost/budget reduction target.',
     'COMPANY','PERCENTAGE',180,'DECAYING', true,true,false,false,false,'COMPETING_VALUE','COST_PRESSURE'),
  ('acquisition_completed','Acquisition completed','The account completed an acquisition (historical fact).',
     'COMPANY','ENTITY_REF',null,'PERMANENT_HISTORY', true,true,false,false,false,'SOURCE_DISAGREEMENT','MA_EVENT'),
  ('funding_event','Funding event','The account raised or announced funding.',
     'COMPANY','MONEY',null,'EVENT', true,true,false,false,false,'SOURCE_DISAGREEMENT','FUNDING_EVENT'),
  ('leadership_change','Leadership change','A leadership/exec change occurred at the account.',
     'CONTACT','STRING',null,'EVENT', true,true,false,false,false,'COMPETING_VALUE','LEADERSHIP_CHANGE'),
  ('compliance_deadline','Compliance deadline','The account faces a dated compliance/regulatory deadline.',
     'COMPANY','DATE',null,'VALID_UNTIL', true,true,false,false,false,'COMPETING_VALUE','COMPLIANCE_DEADLINE'),
  ('partner_relationship_exists','Partner relationship exists','A relationship exists between the account and a partner.',
     'RELATIONSHIP','ENTITY_REF',540,'STATIC', false,false,false,true,true,'NEGATION','PARTNER_RELATIONSHIP')
on conflict (key) do nothing;

-- First-party / human predicates carry stricter allowed provenance.
update fact_predicates set allowed_provenance_classes = array['FIRST_PARTY','CUSTOMER_DECLARED','HUMAN_ASSERTED','SECOND_PARTY']
  where key in ('renewal_date','contract_expires','budget_reduction_target');

-- Promotion policies (predicate-aware). Material/first-party predicates are stricter.
insert into fact_promotion_policies
  (predicate_key, minimum_support_count, minimum_trust, first_party_required, corroboration_required,
   maximum_age_days, auto_promote_allowed, human_review_required)
values
  ('technology_in_use',            1, 0.55, false, false, 720, true,  false),
  ('renewal_date',                 1, 0.70, true,  false, 400, false, true),
  ('contract_expires',             1, 0.70, true,  false, 400, false, true),
  ('migrating_from',               2, 0.60, false, true,  300, true,  false),
  ('platform_evaluation_active',   2, 0.60, false, true,  180, false, true),
  ('strategic_initiative',         1, 0.60, false, false, 400, true,  false),
  ('is_hiring_for_role_category',  1, 0.55, false, false, 120, true,  false),
  ('headcount_growth_direction',   1, 0.55, false, false, 150, true,  false),
  ('budget_reduction_target',      1, 0.70, false, true,  200, false, true),
  ('acquisition_completed',        1, 0.65, false, false, null, true, false),
  ('funding_event',                1, 0.60, false, false, null, true, false),
  ('leadership_change',            1, 0.60, false, false, 180, true,  false),
  ('compliance_deadline',          1, 0.65, false, false, null, true, false),
  ('partner_relationship_exists',  1, 0.55, false, false, null, true, false)
on conflict (predicate_key, version) do nothing;
