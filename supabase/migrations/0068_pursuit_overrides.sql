-- 0068: Human override capture (Workstream A, §18-19). A human override is not just a
-- destructive edit — it is model-supervision data. Every time a human overrides an AI
-- recommendation (partner/seller/motion/timing/status/priority), persist the original
-- recommendation, the human decision, and why. Recommendation and decision stay
-- separate on `pursuits`; this table is the immutable trail of the divergences.

create table if not exists pursuit_overrides (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  pursuit_id      uuid not null references pursuits(id) on delete cascade,
  field           text not null check (field in
                  ('partner','vendor_seller','partner_seller','motion','timing','status','priority','expected_value','other')),
  original_recommendation jsonb,     -- what the system recommended
  human_decision  jsonb,             -- what the human chose
  before_value    jsonb,
  after_value     jsonb,
  reason          text,
  actor_type      text not null default 'human' check (actor_type in ('human','agent')),
  actor_id        uuid,
  model_version   text,
  agent_run_id    uuid references agent_runs(id) on delete set null,
  data_environment text not null default 'PRODUCTION',
  created_at      timestamptz not null default now()
);
create index if not exists pursuit_overrides_pursuit on pursuit_overrides (pursuit_id, created_at desc);
create index if not exists pursuit_overrides_field   on pursuit_overrides (org_id, field, created_at desc);

grant select, insert, update, delete on pursuit_overrides to app_rw;
alter table pursuit_overrides enable row level security;
drop policy if exists pursuit_overrides_rw on pursuit_overrides;
create policy pursuit_overrides_rw on pursuit_overrides for all to app_rw
  using (is_org_member(org_id)) with check (is_org_member(org_id));
