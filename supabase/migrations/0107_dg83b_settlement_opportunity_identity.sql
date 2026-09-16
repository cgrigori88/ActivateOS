-- 0107 — D-G8-3B: stable opportunity identity and a total order in the settlement ledger.
--
-- WHY. public.partnership_settlement_rows() (0104) returned company_id but never the opportunity's own
-- id, so two distinct opportunities on the same company in the same org were indistinguishable to every
-- caller — there was no stable identity to key a row on. It also ended `order by o.updated_at desc`,
-- which is not a total order: opportunities sharing an updated_at fell back to heap order, so the
-- settlement statement could list the same facts in a different sequence run to run. D-G8-3 invariant:
-- what the product shows must be a deterministic function of canonical inputs, not of physical row order.
--
-- WHAT. Append `opportunity_id uuid` as the LAST returned column and make the order total with
-- `order by o.updated_at desc, o.id`. The existing business order (most recently updated first) is
-- preserved exactly and o.id is only the final deterministic key — never business meaning. Consent
-- gating, joins, filters, visibility and every original column are unchanged.
--
-- WHY DROP + CREATE. `create or replace function` cannot change a RETURNS TABLE column list — PostgreSQL
-- rejects it ("cannot change return type of existing function"). DROP is therefore required. Nothing in
-- the database depends on this function (no policy and no other function references it; only application
-- code calls it), so no CASCADE is used or needed.
--
-- DROP DISCARDS THE SECURITY POSTURE, so this migration restores ALL of it atomically in one
-- transaction: SECURITY DEFINER, STABLE, the 0105-hardened search_path `pg_catalog, public, pg_temp`
-- (NOT 0104's original `public`, which would make the function unsafe and take the protected class to
-- 30/1), the PUBLIC revoke, the anon / authenticated / service_role revokes, and the EXECUTE grant to
-- app_rw — exactly the 0104 least-privilege block. Protected-function posture must remain 31 protected
-- / 0 unsafe.
--
-- COMPATIBILITY. The new shape is a strict superset of the old one and no caller uses `select *`
-- (src/lib/partnerships/settlement.ts and src/lib/partners/hub.ts select named columns), so the CURRENT
-- application works unchanged against it. This migration is therefore deployable before the app change.

drop function public.partnership_settlement_rows(uuid);

create function public.partnership_settlement_rows(p_partnership uuid)
returns table (org_id uuid, company_id uuid, legal_name text, stage text, amount_usd numeric,
               created_at timestamptz, updated_at timestamptz, closed_at timestamptz, registered boolean,
               opportunity_id uuid)
  language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp
as $$
#variable_conflict use_column
declare ini uuid; cp uuid;
begin
  if not public.h1b_consent_allowed(p_partnership) then return; end if;
  select p.initiator_org_id, p.counterpart_org_id into ini, cp from partnerships p where p.id = p_partnership;
  return query
    select o.org_id, o.company_id, c.legal_name, o.stage, o.amount_usd, o.created_at, o.updated_at, o.closed_at,
           exists (select 1 from deal_registrations dr where dr.opportunity_id = o.id),
           o.id
      from joint_pursuits jp
      join opportunities o on o.company_id = jp.company_id and o.org_id in (ini, cp)
      join companies c on c.id = o.company_id
     where jp.partnership_id = p_partnership and jp.status in ('active', 'closed')
     order by o.updated_at desc, o.id;
end $$;

-- Restore the certified least-privilege posture the DROP removed (the 0104 block, for this function).
do $$
declare r text;
begin
  revoke all on function public.partnership_settlement_rows(uuid) from public;
  foreach r in array array['anon', 'authenticated', 'service_role', 'app_rw'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.partnership_settlement_rows(uuid) from %I', r);
    end if;
  end loop;
  grant execute on function public.partnership_settlement_rows(uuid) to app_rw;
end $$;

-- ROLLBACK: re-create the 0104 nine-column form, KEEPING the 0105 search_path, then re-apply the same
-- revoke/grant block. Roll the application back FIRST if it selects opportunity_id.
--   drop function public.partnership_settlement_rows(uuid);
--   create function public.partnership_settlement_rows(p_partnership uuid)
--   returns table (org_id uuid, company_id uuid, legal_name text, stage text, amount_usd numeric,
--                  created_at timestamptz, updated_at timestamptz, closed_at timestamptz, registered boolean)
--     language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp
--   as $f$
--   #variable_conflict use_column
--   declare ini uuid; cp uuid;
--   begin
--     if not public.h1b_consent_allowed(p_partnership) then return; end if;
--     select p.initiator_org_id, p.counterpart_org_id into ini, cp from partnerships p where p.id = p_partnership;
--     return query
--       select o.org_id, o.company_id, c.legal_name, o.stage, o.amount_usd, o.created_at, o.updated_at, o.closed_at,
--              exists (select 1 from deal_registrations dr where dr.opportunity_id = o.id)
--         from joint_pursuits jp
--         join opportunities o on o.company_id = jp.company_id and o.org_id in (ini, cp)
--         join companies c on c.id = o.company_id
--        where jp.partnership_id = p_partnership and jp.status in ('active', 'closed')
--        order by o.updated_at desc;
--   end $f$;
--   (then the revoke/grant block above)
