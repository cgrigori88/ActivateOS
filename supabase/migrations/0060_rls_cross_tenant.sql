-- 0060: app_rw RLS policies for the CROSS-TENANT consent-ladder tables (RISK-1).
--
-- 0058's data-driven loop only covered tables with a plain `org_id` column. The
-- consent-ladder tables scope by partnership instead (initiator/counterpart, or
-- a partnership_id, or a population_id), so they were left with no app_rw
-- policy — which would default-deny them under app_rw and break partnerships,
-- overlap, joint pursuits, grants, intros, and the rail badges that read them.
--
-- Visibility rule: a row is reachable if the caller's org is on EITHER side of
-- the partnership. is_org_member() already honors the app.org_id GUC (0058), so
-- these policies work for both the Data API (auth.uid) and the app (GUC) paths.
-- Additive + inert on the owner connection.

-- Two sides of a partnership.
create or replace function public.can_see_partnership(pid uuid) returns boolean
  language sql stable security definer set search_path to 'public'
  as $$
    select exists (
      select 1 from partnerships p
      where p.id = pid
        and (public.is_org_member(p.initiator_org_id) or public.is_org_member(p.counterpart_org_id))
    );
  $$;
grant execute on function public.can_see_partnership(uuid) to app_rw;

-- partnerships itself: member of either side.
drop policy if exists partnerships_rw on public.partnerships;
create policy partnerships_rw on public.partnerships for all to app_rw
  using (is_org_member(initiator_org_id) or is_org_member(counterpart_org_id))
  with check (is_org_member(initiator_org_id) or is_org_member(counterpart_org_id));

-- Children keyed by partnership_id.
do $$
declare t text;
begin
  foreach t in array array[
    'overlap_probes','joint_pursuits','list_grants','warm_intro_requests',
    'evidence_shares','skill_shares','joint_playbooks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format(
      'create policy %I_rw on public.%I for all to app_rw using (can_see_partnership(partnership_id)) with check (can_see_partnership(partnership_id))',
      t, t);
  end loop;
end $$;

-- population_members: scoped through its population's org.
alter table public.population_members enable row level security;
drop policy if exists population_members_rw on public.population_members;
create policy population_members_rw on public.population_members for all to app_rw
  using (exists (select 1 from account_populations ap where ap.id = population_id and is_org_member(ap.org_id)))
  with check (exists (select 1 from account_populations ap where ap.id = population_id and is_org_member(ap.org_id)));
