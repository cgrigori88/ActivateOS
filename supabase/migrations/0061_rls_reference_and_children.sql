-- 0061: app_rw policies for GLOBAL reference tables + parent-scoped CHILD
-- tables (RISK-1). 0058 covered only tables with an org_id column; 0060 covered
-- the cross-tenant consent-ladder tables. This closes the last gap the app_rw
-- crawl surfaced: pages INNER JOIN reference tables like `companies` and read
-- child tables like `stakeholders`/`campaign_touches`/`messages`, all of which
-- had RLS enabled but no app_rw policy — so app_rw read 0 rows and the joins
-- dropped everything (pipeline rendered empty under app_rw).
--
-- Two kinds:
--   1. REFERENCE / shared data (no tenant column): readable by app_rw. These
--      hold no per-tenant rows (companies, taxonomy, products, providers, …),
--      so `using (true)` is correct. `organizations` is included: it exposes
--      only org identity (names), always reached via a constrained join, and
--      partner rooms need the counterpart's name.
--   2. CHILD tables that ARE tenant data but scope through a parent's org_id
--      (a campaign, thread, opportunity, seller, batch, routine). These get a
--      policy that checks membership on the PARENT — real isolation, not
--      using(true).
-- Additive + inert on the owner connection.

-- 1. Reference / shared tables → app_rw may read (and write; these are managed
--    by the pipeline/worker on the owner path anyway).
do $$
declare t text;
begin
  foreach t in array array[
    'companies','company_aliases','company_hierarchies','taxonomy_nodes',
    'taxonomy_edges','products','product_taxonomy_mappings','play_templates',
    'propensity_dimensions','providers','signal_sources','signal_configs',
    'score_features','score_versions','partner_capabilities','partner_fit_features',
    'partner_relationships','technology_installations','golden_examples',
    'eval_runs','change_proposals','organizations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format('create policy %I_rw on public.%I for all to app_rw using (true) with check (true)', t, t);
  end loop;
end $$;

-- 2. Child tables scoped through their tenant parent.
do $$
declare
  r record;
begin
  for r in select * from (values
    ('campaign_touches',   'exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id))'),
    ('campaign_partners',  'exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id))'),
    ('campaign_populations','exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id))'),
    ('campaign_assets',    'exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id))'),
    ('messages',           'exists (select 1 from communication_threads t where t.id = thread_id and is_org_member(t.org_id))'),
    ('message_participants','exists (select 1 from messages m join communication_threads t on t.id = m.thread_id where m.id = message_id and is_org_member(t.org_id))'),
    ('message_edits',      'exists (select 1 from messages m join communication_threads t on t.id = m.thread_id where m.id = message_id and is_org_member(t.org_id))'),
    ('email_events',       'exists (select 1 from messages m join communication_threads t on t.id = m.thread_id where m.id = message_id and is_org_member(t.org_id))'),
    ('stakeholders',       'exists (select 1 from opportunities o where o.id = opportunity_id and is_org_member(o.org_id))'),
    ('opportunity_meddpicc','exists (select 1 from opportunities o where o.id = opportunity_id and is_org_member(o.org_id))'),
    ('opportunity_stage_transitions','exists (select 1 from opportunities o where o.id = opportunity_id and is_org_member(o.org_id))'),
    ('seller_account_relationships','exists (select 1 from sellers s where s.id = seller_id and is_org_member(s.org_id))'),
    ('import_rows',        'exists (select 1 from import_batches b where b.id = batch_id and is_org_member(b.org_id))'),
    ('routine_runs',       'exists (select 1 from routines rt where rt.id = routine_id and is_org_member(rt.org_id))')
  ) as x(tbl, pred)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %I_rw on public.%I', r.tbl, r.tbl);
    execute format('create policy %I_rw on public.%I for all to app_rw using (%s) with check (%s)', r.tbl, r.tbl, r.pred, r.pred);
  end loop;
end $$;
