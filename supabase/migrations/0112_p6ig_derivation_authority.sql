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

-- ── 2. Bounded information-class vocabulary — FOR MACHINE-GOVERNED GRANTS ONLY ───────────────────
-- Every derivable canonical input maps to exactly one of these. There is deliberately no OTHER and
-- no wildcard: an unmapped input must DENY rather than fall through to a catch-all.
--
-- WHY THIS IS CONDITIONAL ON purpose_code. `information_classes` is used with TWO incompatible
-- meanings in the pre-existing code, which is precisely why nothing ever read it:
--
--   • demo-db.ts / demo-stories.ts (and both LIVE hosted rows) store a DATA CATEGORY —
--     'transaction_adjacency';
--   • disclosure-verify.ts and partnership-app-rw-verify.ts store an AUDIENCE value —
--     'PARTICIPANT_SHARED' — which is what grants.ts's own comment describes.
--
-- Constraining the column unconditionally would have invalidated certified suites, and rewriting
-- those fixtures to fit a new constraint would be adjusting the evidence to fit the claim. So the
-- vocabulary binds ONLY where it must carry weight: a grant that declares a machine-readable
-- purpose. Legacy grants keep whatever they already store, and keep their certified behaviour.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'context_grants_information_classes_check') then
    alter table context_grants add constraint context_grants_information_classes_check
      check (purpose_code is null or (information_classes is not null and information_classes <@ array[
        'transaction_adjacency','economic_value','stakeholder_coverage',
        'timing','route_candidate','evidence_document']::text[]));
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
--        ⇒ at least one information class
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
          and information_classes is not null
          and cardinality(information_classes) > 0
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
-- ONE GOVERNANCE CLOCK: `now()` is `transaction_timestamp()` and is fixed for the whole transaction.
-- `withTenant`/`withTenantOrg` wrap each request in one transaction, so a read model that takes its
-- `asOf` from `transaction_timestamp()` evaluates against the IDENTICAL instant this predicate uses.
-- The boundary is closed: `effective_to > now()` is strict, so exactly at `effective_to` is DENIED.
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
-- Drop the four constraints and the column, and restore the prior can_see_pursuit body (without the
-- effective-window conjuncts). Reverting only WIDENS eligibility back to the defective form, so it
-- is a correctness regression rather than a safe undo.
