-- 0023 Contacts taxonomy
--
-- Turn `contacts` from a flat reachable-address list into a role-typed taxonomy
-- that spans the whole co-sell motion: end users at the account AND the partner
-- reps (reseller / distributor / MSP owners) who cover those accounts. The
-- partner reps are captured from population_members.attributes.account_owner_*
-- (see src/lib/contacts/capture.ts), so the buying + selling committee for every
-- mapped account lives in one place, deep-filterable by type / partner / level.

alter table contacts
  add column if not exists contact_type text not null default 'end_user'
    check (contact_type in
      ('end_user','vendor','reseller','distributor','msp','solution_provider','agent','alliance','other')),
  add column if not exists partner_id uuid references partners(id) on delete set null,
  add column if not exists phone      text,
  add column if not exists location   text,
  add column if not exists source     text not null default 'manual',
  add column if not exists attributes jsonb not null default '{}';

-- The old blanket unique(org_id,email) blocked a partner rep who covers several
-- accounts (one row per rep×account). Keep the guarantee for human-managed
-- contacts only; captured rows (source='population') are free to repeat and are
-- made idempotent by delete-then-reinsert in the capture helper.
alter table contacts drop constraint if exists contacts_org_id_email_key;
create unique index if not exists contacts_manual_email_uk
  on contacts (org_id, email) where source <> 'population';

create index if not exists contacts_partner_idx on contacts (partner_id);
create index if not exists contacts_type_idx    on contacts (contact_type);
create index if not exists contacts_company_idx on contacts (company_id);
