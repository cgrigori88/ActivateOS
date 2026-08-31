-- 0098: Renewal / Lifecycle Intelligence (P2A) — ROWS, NOT TABLES.
--
-- The design audit established that the canonical fact graph already models everything lifecycle
-- intelligence needs: date_value for a precise date, valid_from/valid_until for a bounded WINDOW,
-- status for CURRENT/DISPUTED/STALE, provenance_class for how strongly it is known, half-life decay
-- for staleness, fact_contradictions for competing dates, fact_evidence for citations, and
-- supersession for history. `renewal_date` and `contract_expires` already exist as registered
-- predicates with supports_timing = true.
--
-- So this migration adds NO table, NO status column, and NO second timing score. It registers the
-- missing lifecycle predicates and makes the FALSE-PRECISION RULE structural:
--
--   allowed_provenance_classes on an inferred-window predicate EXCLUDES the trusted classes, so a
--   third-party guess is physically incapable of being stored as a precise verified date. Promotion
--   to a precise date requires a different predicate whose registry row permits a trusted class —
--   which only the governed confirm path writes.
--
-- freshness_policy 'VALID_UNTIL' (used by the existing renewal_date/contract_expires rows) means the
-- fact is authoritative until its date passes, rather than decaying on a half-life; 'DECAYING' rows
-- carry default_half_life_days and go STALE with age.

insert into fact_predicates
  (key, display_name, description, subject_type, object_type, default_half_life_days, freshness_policy,
   supports_timing, supports_propensity, supports_solution_fit, supports_partner_activation, supports_seller_activation,
   contradiction_strategy, family, signal_type, allowed_provenance_classes)
values
  -- Installed-base lifecycle. Vendor EOL/EOS dates are published facts: third-party VERIFIED is
  -- legitimate here, unverified third-party is not (a scraped rumour must not read as a date).
  ('end_of_life_date','End of life','A product/version reaches vendor end-of-life on a specific date.',
     'TECHNOLOGY','DATE',null,'VALID_UNTIL', true,true,true,false,false,'COMPETING_VALUE','trigger','EOL_APPROACHING',
     array['FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','CUSTOMER_DECLARED','HUMAN_ASSERTED']),
  ('end_of_support_date','End of support','A product/version reaches vendor end-of-support on a specific date.',
     'TECHNOLOGY','DATE',null,'VALID_UNTIL', true,true,true,false,false,'COMPETING_VALUE','trigger','EOS_APPROACHING',
     array['FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','CUSTOMER_DECLARED','HUMAN_ASSERTED']),
  ('support_lifecycle_phase','Support lifecycle phase','Where an installed product sits in its vendor support lifecycle.',
     'TECHNOLOGY','ENUM',365,'DECAYING', true,true,true,false,false,'COMPETING_VALUE','trigger',null,
     array['FIRST_PARTY','SECOND_PARTY','THIRD_PARTY_VERIFIED','THIRD_PARTY_UNVERIFIED','INFERRED','CUSTOMER_DECLARED','HUMAN_ASSERTED']),

  -- Commercial lifecycle. A subscription term end is a contract fact: only the customer, the
  -- vendor's own record, or a human assertion may state it precisely.
  ('subscription_term_end','Subscription term end','A subscription term ends on a specific date.',
     'CONTRACT','DATE',null,'VALID_UNTIL', true,true,false,false,false,'COMPETING_VALUE','trigger','CONTRACT_EXPIRING',
     array['FIRST_PARTY','SECOND_PARTY','CUSTOMER_DECLARED','HUMAN_ASSERTED']),
  ('migration_deadline','Migration deadline','A migration must complete by a specific date.',
     'CONTRACT','DATE',null,'VALID_UNTIL', true,true,true,false,false,'COMPETING_VALUE','trigger',null,
     array['FIRST_PARTY','SECOND_PARTY','CUSTOMER_DECLARED','HUMAN_ASSERTED']),

  -- THE INFERRED-WINDOW PREDICATE. Third-party and inferred evidence lands here and ONLY here.
  -- Its object_type is RANGE and the trusted classes are excluded, so approximate evidence can
  -- never present itself as a precise, verified date anywhere in the product.
  ('renewal_window','Renewal window (inferred)','A bounded period in which a renewal is believed to fall — never a precise date.',
     'CONTRACT','RANGE',270,'DECAYING', true,true,false,false,false,'COMPETING_VALUE','trigger','CONTRACT_EXPIRING',
     array['THIRD_PARTY_UNVERIFIED','THIRD_PARTY_VERIFIED','INFERRED'])
on conflict (key) do nothing;

-- Governed lifecycle decisions append to the canonical ledger (0094 keeps it append-only). Two new
-- change types: a confirmation (an inferred window or third-party date became a verified date) and
-- a dispute (a competing value was raised rather than overwriting the incumbent).
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conname = 'change_ledger_change_type_check' and conrelid = 'change_ledger'::regclass;
  if def is not null and def not like '%LIFECYCLE_DATE_CONFIRMED%' then
    execute 'alter table change_ledger drop constraint change_ledger_change_type_check';
    execute 'alter table change_ledger add constraint change_ledger_change_type_check ' ||
      replace(def, '''STAKEHOLDER_ROLE_ASSERTED''::text]',
                   '''STAKEHOLDER_ROLE_ASSERTED''::text, ''LIFECYCLE_DATE_CONFIRMED''::text, ''LIFECYCLE_DATE_DISPUTED''::text]');
  end if;
end $$;

-- Horizon queries scan lifecycle facts by date within an org. The existing facts_expiry index only
-- covers valid_until; this covers the precise-date path the horizon read model uses.
create index if not exists facts_lifecycle_date
  on facts (org_id, date_value)
  where date_value is not null and status in ('CURRENT', 'DISPUTED', 'STALE');
