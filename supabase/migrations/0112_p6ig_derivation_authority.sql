-- 0112 — P6-IG: make derivation authority machine-evaluable, and close the effective-window defect.
--
-- WHAT THIS IS. The intercompany substrate (context_grants, partnerships, pursuit_participants,
-- the disclosure ladder, contribution provenance, the H1B consent guards) is pre-existing and
-- DEMO CERTIFIED. This migration does NOT rebuild any of it. It closes two proven gaps:
--
--   1. DERIVATION AUTHORITY WAS UNENFORCEABLE. `purpose` is free text with no vocabulary and no
--      reader; `information_classes[]` and `retention_class` were stored and NEVER read (every
--      apparent "read site" was an INSERT column list). A grant therefore carried no machine-
--      evaluable statement of what it permits, so `mayDerive` could not exist honestly.
--
--   2. THE EFFECTIVE MEMBERSHIP WINDOW WAS NOT ENFORCED. `pursuit_participants.effective_from`
--      and `effective_to` had ZERO references anywhere in src/. A participant whose window had
--      closed but whose state was still ACTIVE remained a participant — inside the RLS predicate
--      itself.
--
-- FAIL-CLOSED, NOT WILDCARD. The additions are nullable so existing rows stay valid, but the
-- RUNTIME reads missing governance metadata as DENY. Legacy grants keep every certified ordinary
-- disclosure they have today and acquire NO derivation authority. There is no backfill: mapping
-- free text like 'co-sell context sharing' onto a machine vocabulary would be a guess, and a guess
-- that silently grants authority is worse than no metadata at all.
--
-- NOT IN THIS MIGRATION: no table, no role, no privilege class, no policy, no NEW SECURITY
-- DEFINER, no RLS broadening, no cross-org super-reader, no delegation lineage (delegation is
-- unsupported and fail-closed precisely because no lineage exists to prove attenuation from).

-- ── 1. Machine-readable GOVERNED-USE purpose ─────────────────────────────────────────────────────
-- `purpose` (free text) is RETAINED as the human rationale; `purpose_code` is what the engine reads.
-- NOTE THE DISTINCTION THIS ENCODES: a governed-use purpose is not automatically a DERIVATION
-- purpose. CO_SELL_CONTEXT_DISPLAY authorizes rendering through the disclosure ladder and nothing
-- more — it never becomes derivation-capable however completely the other fields are populated.
alter table context_grants add column if not exists purpose_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'context_grants_purpose_code_check') then
    alter table context_grants add constraint context_grants_purpose_code_check
      check (purpose_code is null or purpose_code in (
        'CO_SELL_CONTEXT_DISPLAY',   -- governed USE: render through the ladder. NOT derivation.
        'ROUTE_EVALUATION',          -- derivation: route candidate scoring
        'VALUE_CASE',                -- derivation: modelled impact assembly
        'CONFLICT_DETECTION'));      -- derivation: contradiction detection
  end if;
end $$;

-- ── 2. A SEPARATE COLUMN FOR MACHINE-GOVERNED DATA CLASSES — A SEMANTIC FIREWALL ─────────────────
-- `information_classes` ALREADY CARRIES TWO INCOMPATIBLE MEANINGS in pre-existing, certified code,
-- which is precisely why nothing ever read it:
--
--   • demo-db.ts / demo-stories.ts (and both LIVE hosted rows) store a DATA CATEGORY —
--     'transaction_adjacency';
--   • disclosure-verify.ts and partnership-app-rw-verify.ts store an AUDIENCE value —
--     'PARTICIPANT_SHARED' — which is what grants.ts's own comment describes.
--
-- A column cannot mean two things. Reinterpreting the same column as machine-governed data classes
-- "when purpose_code is populated" would make its meaning depend on a sibling field — exactly the
-- ambiguity this workstream exists to remove — and would leave one write path able to satisfy the
-- other's contract by accident. So the two vocabularies get two columns:
--
--   information_classes            LEGACY DISCLOSURE. Untouched, unconstrained by this migration,
--                                  read only by the pre-existing disclosure paths that read it today.
--   governed_information_classes   MACHINE-EVALUABLE P6-IG DATA CLASSES ONLY. The only field
--                                  `mayDerive` and the completeness constraint ever read.
--
-- NEITHER COLUMN MAY SATISFY THE OTHER'S CONTRACT. There is no fallback, no coalesce, no wildcard
-- and no OTHER: an unmapped input must DENY rather than fall through to a catch-all, and an Audience
-- value can never become a derivation authority.
alter table context_grants add column if not exists governed_information_classes text[];

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'context_grants_governed_information_classes_check') then
    alter table context_grants add constraint context_grants_governed_information_classes_check
      check (governed_information_classes is null or governed_information_classes <@ array[
        'transaction_adjacency','economic_value','stakeholder_coverage',
        'timing','route_candidate','evidence_document']::text[]);
  end if;
end $$;

-- ── 3. Bounded retention vocabulary ──────────────────────────────────────────────────────────────
-- Retention governs RECIPIENT-SIDE STORAGE only. It is never derivation permission, and its expiry
-- never deletes or mutates the SOURCE organization's canonical contribution or evidence.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'context_grants_retention_class_check') then
    alter table context_grants add constraint context_grants_retention_class_check
      check (retention_class is null or retention_class in ('EPHEMERAL','PURSUIT_LIFETIME','RETAINED'));
  end if;
end $$;

-- ── 4. Completeness of a MACHINE-GOVERNED grant — enforced in the DATABASE ────────────────────────
-- Application validation alone cannot hold a governance invariant: a direct app_rw insert would
-- bypass it. This is the one constraint that makes "machine-governed" mean something.
--
--   MACHINE_GOVERNED  ⇔  purpose_code IS NOT NULL
--        ⇒ grant_kind = 'DATA'          every approved purpose governs DATA use/display/derivation;
--                                       an ACTION grant may not carry one
--        ⇒ pursuit-anchored             which is ALSO what makes `scope = {}` unambiguous: it means
--                                       "the whole of THIS pursuit", never organization-wide
--        ⇒ at least one GOVERNED information class (the legacy column cannot satisfy this)
--        ⇒ a retention class
--        ⇒ a valid end: the pursuit itself (PURSUIT_LIFETIME) or an explicit expires_at
--
-- Legacy rows (purpose_code IS NULL) satisfy the first disjunct and remain valid, unchanged, with
-- no backfill.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'context_grants_machine_governed_complete') then
    alter table context_grants add constraint context_grants_machine_governed_complete
      check (
        purpose_code is null
        or (
              grant_kind = 'DATA'
          and pursuit_id is not null
          and governed_information_classes is not null
          and cardinality(governed_information_classes) > 0
          and retention_class is not null
          and (retention_class = 'PURSUIT_LIFETIME' or expires_at is not null)
        )
      );
  end if;
end $$;

-- ── 5. Effective membership window, enforced where eligibility is ESTABLISHED ─────────────────────
-- REPLACES an existing SECURITY DEFINER predicate. It adds none, and it can only NARROW: every
-- clause is an additional conjunct, so no row admitted by the new definition was refused by the old.
-- Enforcing this in a later UI filter would leave RLS itself wrong, which is why it belongs here.
--
-- ONE GOVERNANCE CLOCK, AND IT NEVER LEAVES SQL (D-P6-1). `now()` is `transaction_timestamp()`,
-- fixed for the whole transaction, at MICROSECOND precision. `withTenant`/`withTenantOrg` wrap each
-- request in one transaction, so a read model whose predicate also reads `transaction_timestamp()`
-- evaluates against the IDENTICAL instant this one does. A read model that instead carried the
-- instant through a JavaScript `Date` — MILLISECONDS — evaluated up to 999µs in the PAST and could
-- ALLOW a participant this predicate had already DENIED; that defect was found and corrected here.
-- The boundary is closed: `effective_to > now()` is strict, so exactly at `effective_to` is DENIED,
-- while `effective_from <= now()` is inclusive, so exactly at `effective_from` is ALLOWED.
create or replace function public.can_see_pursuit(p uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
    select exists (
      select 1 from pursuits pu where pu.id = p and public.is_org_member(pu.org_id)
    ) or exists (
      select 1 from pursuit_participants pp
      where pp.pursuit_id = p
        and pp.participation_state = 'ACTIVE'
        and (pp.effective_from is null or pp.effective_from <= now())
        and (pp.effective_to   is null or pp.effective_to   >  now())
        and public.is_org_member(pp.org_id)
    );
  $$;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────────────────
-- Drop the four constraints and the TWO added columns, and restore the prior can_see_pursuit body
-- (0080's text, with 0105's pinned search_path, and without the effective-window conjuncts).
-- Reverting only WIDENS eligibility back to the defective form, so it is a correctness regression
-- rather than a safe undo.
-- ROLLBACK: alter table context_grants drop constraint if exists context_grants_machine_governed_complete;
-- ROLLBACK: alter table context_grants drop constraint if exists context_grants_retention_class_check;
-- ROLLBACK: alter table context_grants drop constraint if exists context_grants_governed_information_classes_check;
-- ROLLBACK: alter table context_grants drop constraint if exists context_grants_purpose_code_check;
-- ROLLBACK: alter table context_grants drop column if exists governed_information_classes;
-- ROLLBACK: alter table context_grants drop column if exists purpose_code;
-- ROLLBACK: (then re-run 0080's can_see_pursuit body verbatim, followed by
-- ROLLBACK:  alter function public.can_see_pursuit(uuid) set search_path = pg_catalog, public, pg_temp;)
