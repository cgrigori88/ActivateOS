-- 0045: Attention-trigger settings (task #83, GTM-OS batch slice 2).
-- The trigger CATALOG lives in code (named, documented, versioned); this
-- table stores only each org's toggles. Absent row = enabled (default on).
create table if not exists trigger_settings (
  org_id      uuid not null references organizations(id) on delete cascade,
  trigger_key text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (org_id, trigger_key)
);

alter table trigger_settings enable row level security;
drop policy if exists trigger_settings_select on trigger_settings;
create policy trigger_settings_select on trigger_settings for select to authenticated
  using (is_org_member(org_id));
