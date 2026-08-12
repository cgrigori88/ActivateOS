-- 0029 Tenant-isolation policies (multi-tenant slice 2)
--
-- Every table carrying an org_id gets the tenant policy: an authenticated user
-- reads/writes only rows of organizations they are a member of, and NULL-org
-- rows are invisible to them (shared/global data gets deliberate policies
-- later, not accidental exposure). This changes nothing for the app today —
-- it connects as the table owner — but it means the moment any user-scoped
-- path exists (PostgREST, scoped connections), tenancy is already enforced in
-- the database rather than in application code.
--
-- Tables WITHOUT org_id (children like population_members, campaign_touches;
-- globals like companies, taxonomy_nodes) stay default-deny for API roles
-- until each gets a deliberate join-through or read-only policy.
--
-- NOTE: writes are gated only by membership here; role-based write gating
-- (owner vs operator vs viewer) is a later slice.

do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
    where c.table_schema = 'public' and c.column_name = 'org_id'
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', r.table_name);
    execute format(
      'create policy tenant_isolation on public.%I for all to authenticated
         using (org_id is not null and is_org_member(org_id))
         with check (org_id is not null and is_org_member(org_id))',
      r.table_name);
  end loop;
end $$;
