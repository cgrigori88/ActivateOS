-- 0056: RLS consistency (security-audit finding). Tables added in 0051-0055
-- shipped without row level security while every earlier tenant-scoped table
-- carries it. The app pool is the table owner (bypasses RLS — task #67 keeps
-- that hardening pending), but the policies must exist NOW so flipping the
-- pool to a non-owner role later doesn't silently open these tables.

alter table initiatives enable row level security;
drop policy if exists initiatives_select on initiatives;
create policy initiatives_select on initiatives for select to authenticated
  using (is_org_member(org_id));

alter table ask_exchanges enable row level security;
drop policy if exists ask_exchanges_select on ask_exchanges;
create policy ask_exchanges_select on ask_exchanges for select to authenticated
  using (is_org_member(org_id));

alter table crm_writebacks enable row level security;
drop policy if exists crm_writebacks_select on crm_writebacks;
create policy crm_writebacks_select on crm_writebacks for select to authenticated
  using (is_org_member(org_id));

alter table org_ai_settings enable row level security;
drop policy if exists org_ai_settings_select on org_ai_settings;
create policy org_ai_settings_select on org_ai_settings for select to authenticated
  using (is_org_member(org_id));
