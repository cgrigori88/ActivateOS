-- 0108 — D-G8-5: a total order for the capped shared-evidence read.
--
-- WHY. public.shared_in_evidence() (0104) ends `order by e.observed_at desc limit 20`. That is not a
-- total order: when more than 20 eligible rows exist and several share an exact observed_at across the
-- 20/21 boundary, PostgreSQL's encounter / heap / planner order decides which tied rows survive the cap.
--
-- The damage is MEMBERSHIP, not presentation. The one consumer — src/lib/context/timeline.ts, through
-- src/lib/partnerships/evidence-shares.ts — re-sorts every timeline event with compareTimelineEvents and
-- re-slices, so this function's output ORDER is irrelevant downstream. What matters is that a row the cap
-- drops never reaches the timeline at all, so a shared claim could appear or vanish between runs on
-- identical data with no user-visible cause.
--
-- THE FINAL KEY IS s.id, NOT e.id. evidence_shares (0053) is `unique (evidence_id, partnership_id)`, so
-- one evidence object may be shared on several partnerships. A caller who is a party to more than one of
-- them receives the SAME e.id twice, which means e.id cannot total-order the result. s.id is the primary
-- key of the evidence_shares row this function actually returns — exactly one result row per share — so
-- it is unique by construction. It is consulted ONLY after observed_at has tied, and carries no ranking
-- meaning; `desc` follows the repository's convention for a descending primary key (`recorded_at desc,
-- id desc`; `confidence desc, id desc`).
--
-- DELIBERATELY UNCHANGED (owner ruling): the same evidence shared through two eligible partnerships still
-- returns TWO rows and still consumes two of the 20 slots. That is current product behaviour. De-duplicating
-- would alter membership semantics and is out of scope for D-G8-5.
--
-- SHAPE. CREATE OR REPLACE, never DROP. The returned columns and the argument signature are unchanged —
-- s.id appears only in ORDER BY, which is legal for a column of a FROM relation that is not projected — so
-- PostgreSQL's "cannot change return type" restriction does not apply. Nothing is dropped, so the owner,
-- the ACL and the 0105-hardened search_path survive; the header restates them so the certified posture is
-- asserted in this file rather than merely inherited. No CASCADE. No revoke/grant churn.
--
-- Every consent, filter and join clause below is carried over verbatim from 0104. Only the ORDER BY differs.

create or replace function public.shared_in_evidence(p_company uuid)
returns table (claim text, source_type text, observed_at timestamptz, org_name text)
  language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare caller uuid := public.app_current_org();
begin
  if caller is null then return; end if;
  return query
    select e.claim, e.source_type, e.observed_at, o.name
      from evidence_shares s
      join partnerships p on p.id = s.partnership_id and p.status = 'active'
       and (p.initiator_org_id = caller or p.counterpart_org_id = caller)
      join evidence e on e.id = s.evidence_id and e.company_id = p_company
       and (e.org_id = s.offered_by_org or e.org_id is null)
      join organizations o on o.id = s.offered_by_org
     where s.status = 'accepted' and s.offered_by_org <> caller
     order by e.observed_at desc, s.id desc limit 20;
end $$;

-- ROLLBACK: restores deploy compatibility ONLY. It reintroduces the D-G8-5 nondeterminism — the capped
-- membership becomes decided by heap/planner order again — and is therefore NOT an acceptable steady
-- state. No data rollback is needed; this migration touches no rows.
--
--   create or replace function public.shared_in_evidence(p_company uuid)
--   returns table (claim text, source_type text, observed_at timestamptz, org_name text)
--     language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp
--   as $f$
--   #variable_conflict use_column
--   declare caller uuid := public.app_current_org();
--   begin
--     if caller is null then return; end if;
--     return query
--       select e.claim, e.source_type, e.observed_at, o.name
--         from evidence_shares s
--         join partnerships p on p.id = s.partnership_id and p.status = 'active'
--          and (p.initiator_org_id = caller or p.counterpart_org_id = caller)
--         join evidence e on e.id = s.evidence_id and e.company_id = p_company
--          and (e.org_id = s.offered_by_org or e.org_id is null)
--         join organizations o on o.id = s.offered_by_org
--        where s.status = 'accepted' and s.offered_by_org <> caller
--        order by e.observed_at desc limit 20;
--   end $f$;
