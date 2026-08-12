-- 0030 Role-gated writes + child-table tenancy (multi-tenant slice 3)
--
-- Three moves:
--  (a) Roles start to mean something in the DATABASE: members read, but only
--      owners/operators write; viewers are read-only. org_members management
--      is owner-only.
--  (b) Child tables (no org_id of their own) get join-through policies keyed
--      on their parent's org — population members follow their list, touches
--      follow their campaign, stakeholders follow their opportunity, etc.
--  (c) Shared catalog tables (the global company graph, taxonomy, plays,
--      providers) become read-only to any signed-in user — deliberately
--      global, never writable through API roles.
--
-- The app's owner connection remains unaffected; these bind the moment any
-- user-scoped path executes SQL.

create or replace function public.org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from org_members m
  where m.org_id = org and m.user_id = auth.uid()
  limit 1;
$$;

-- (a) org_id tables: split the FOR ALL policy into select (any member) and
-- role-gated writes (owner/operator).
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
    execute format('drop policy if exists tenant_select on public.%I', r.table_name);
    execute format('drop policy if exists tenant_insert on public.%I', r.table_name);
    execute format('drop policy if exists tenant_update on public.%I', r.table_name);
    execute format('drop policy if exists tenant_delete on public.%I', r.table_name);
    execute format(
      'create policy tenant_select on public.%I for select to authenticated
         using (org_id is not null and is_org_member(org_id))', r.table_name);
    execute format(
      'create policy tenant_insert on public.%I for insert to authenticated
         with check (org_id is not null and org_role(org_id) in (''owner'',''operator''))', r.table_name);
    execute format(
      'create policy tenant_update on public.%I for update to authenticated
         using (org_id is not null and org_role(org_id) in (''owner'',''operator''))
         with check (org_id is not null and org_role(org_id) in (''owner'',''operator''))', r.table_name);
    execute format(
      'create policy tenant_delete on public.%I for delete to authenticated
         using (org_id is not null and org_role(org_id) in (''owner'',''operator''))', r.table_name);
  end loop;
end $$;

-- org_members: managing membership is OWNER-only (operators run the org's
-- data, owners run the org's people).
drop policy if exists tenant_insert on org_members;
drop policy if exists tenant_update on org_members;
drop policy if exists tenant_delete on org_members;
create policy members_owner_insert on org_members for insert to authenticated
  with check (org_role(org_id) = 'owner');
create policy members_owner_update on org_members for update to authenticated
  using (org_role(org_id) = 'owner') with check (org_role(org_id) = 'owner');
create policy members_owner_delete on org_members for delete to authenticated
  using (org_role(org_id) = 'owner');

-- (b) Child tables: tenancy flows through the parent. One-hop cases.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('campaign_assets',               'campaigns',             'campaign_id'),
      ('campaign_partners',             'campaigns',             'campaign_id'),
      ('campaign_populations',          'campaigns',             'campaign_id'),
      ('campaign_touches',              'campaigns',             'campaign_id'),
      ('population_members',            'account_populations',   'population_id'),
      ('propensity_dimensions',         'propensity_scores',     'score_id'),
      ('score_features',                'propensity_scores',     'score_id'),
      ('opportunity_meddpicc',          'opportunities',         'opportunity_id'),
      ('opportunity_stage_transitions', 'opportunities',         'opportunity_id'),
      ('stakeholders',                  'opportunities',         'opportunity_id'),
      ('messages',                      'communication_threads', 'thread_id'),
      ('email_events',                  'communication_threads', 'thread_id'),
      ('partner_capabilities',          'partners',              'partner_id'),
      ('partner_relationships',         'partners',              'partner_id'),
      ('seller_account_relationships',  'sellers',               'seller_id')
    ) as v(tbl, parent, fk)
  loop
    execute format('drop policy if exists tenant_select on public.%I', r.tbl);
    execute format('drop policy if exists tenant_write on public.%I', r.tbl);
    execute format(
      'create policy tenant_select on public.%I for select to authenticated
         using (exists (select 1 from public.%I p
                        where p.id = %I and p.org_id is not null and is_org_member(p.org_id)))',
      r.tbl, r.parent, r.fk);
    execute format(
      'create policy tenant_write on public.%I for all to authenticated
         using (exists (select 1 from public.%I p
                        where p.id = %I and p.org_id is not null
                          and org_role(p.org_id) in (''owner'',''operator'')))
         with check (exists (select 1 from public.%I p
                             where p.id = %I and p.org_id is not null
                               and org_role(p.org_id) in (''owner'',''operator'')))',
      r.tbl, r.parent, r.fk, r.parent, r.fk);
  end loop;
end $$;

-- Two-hop children of messages (participants, edits) → thread → org.
drop policy if exists tenant_select on message_participants;
create policy tenant_select on message_participants for select to authenticated
  using (exists (select 1 from messages m join communication_threads t on t.id = m.thread_id
                 where m.id = message_id and t.org_id is not null and is_org_member(t.org_id)));
drop policy if exists tenant_select on message_edits;
create policy tenant_select on message_edits for select to authenticated
  using (exists (select 1 from messages m join communication_threads t on t.id = m.thread_id
                 where m.id = message_id and t.org_id is not null and is_org_member(t.org_id)));

-- (c) Shared catalog: readable by any signed-in user, writable by none.
do $$
declare t text;
begin
  foreach t in array array[
    'companies','company_aliases','company_hierarchies','technology_installations',
    'play_templates','taxonomy_nodes','taxonomy_edges','products',
    'product_taxonomy_mappings','providers','signal_sources','signal_configs','score_versions'
  ] loop
    execute format('drop policy if exists catalog_read on public.%I', t);
    execute format('create policy catalog_read on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- organizations: members see their orgs; only owners rename/update them.
drop policy if exists org_select on organizations;
create policy org_select on organizations for select to authenticated
  using (is_org_member(id));
drop policy if exists org_owner_update on organizations;
create policy org_owner_update on organizations for update to authenticated
  using (org_role(id) = 'owner') with check (org_role(id) = 'owner');

-- Still default-deny on purpose: schema_migrations, eval_runs, golden_examples,
-- change_proposals, partner_fit_features, raw intel internals — each gets a
-- deliberate policy if/when a user-scoped path needs it.
