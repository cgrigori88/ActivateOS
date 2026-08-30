-- 0086: Workstream E3-G — federation-aware entity resolution + provider hardening.
--
-- The mapping found identity resolution NOT federation-aware: an external account id
-- ("TDS-000123") means different companies in different orgs' id spaces, but the
-- alias lookup was global — one org's mapping could resolve another org's signal onto
-- the wrong company. This scopes aliases and reviews to the SOURCE ORG's id space
-- (null = global / first-party), so the same external id from two orgs never collides
-- (§14/§30). Also opens the transaction-feature vocabulary to inventory / renewal /
-- marketplace signals. Additive; new columns default to the pre-E global behavior.

set check_function_bodies = off;

-- Source-org scoping on aliases: which participating org's id space this alias
-- belongs to. NULL keeps the historical global / first-party meaning.
alter table company_aliases add column if not exists source_org_id uuid references organizations(id) on delete cascade;
create index if not exists company_aliases_scoped_lookup on company_aliases (alias, alias_type, source_org_id);

-- Same scoping on the review queue, so an ambiguous match is triaged inside the id
-- space it came from and never leaks a candidate across orgs.
alter table entity_resolution_reviews add column if not exists source_org_id uuid references organizations(id) on delete set null;
create index if not exists entity_resolution_reviews_src on entity_resolution_reviews (org_id, source_org_id) where status = 'REVIEW_REQUIRED';

-- Extend the transaction-adjacency feature vocabulary (distributor provider hardening,
-- §21/§37): inventory / renewal / marketplace signal families become first-class. Purely
-- documentary here (feature_key is free text); the scorer weights land in code.
comment on column transaction_features.feature_key is
  'adjacency vocabulary incl. category_adjacency, purchase_recency, category_spend_growth, purchase_frequency, partner_tenure, inventory_availability, renewal_window, marketplace_presence, marketplace_velocity';
