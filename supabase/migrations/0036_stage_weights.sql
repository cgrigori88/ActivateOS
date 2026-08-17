-- 0036: editable stage-probability weights (walkthrough item: the Insights
-- calibration card becomes the editor, and the weights drive pipeline
-- weighting everywhere STAGE_PROBABILITY was previously hardcoded).
--
-- Scope model: a row with partner_id NULL is the org's default curve; a row
-- with a partner_id overrides that stage for deals attributed to that partner
-- (partners genuinely convert differently — a distributor's "proposal" is not
-- a reseller's "proposal"). Missing rows fall back to the declared v1 curve
-- in code, so the platform behaves identically until someone edits.

create table if not exists stage_weights (
  org_id      uuid not null references organizations(id) on delete cascade,
  partner_id  uuid references partners(id) on delete cascade,
  stage       text not null check (stage in ('discovery','qualification','business_validation','proposal','negotiation')),
  probability numeric not null check (probability >= 0 and probability <= 1),
  updated_at  timestamptz not null default now()
);

-- one weight per (org, partner-or-default, stage); NULLS NOT DISTINCT so the
-- org-default scope (partner_id null) also upserts cleanly.
create unique index if not exists stage_weights_scope_uk
  on stage_weights (org_id, partner_id, stage) nulls not distinct;

alter table stage_weights enable row level security;

drop policy if exists stage_weights_select on stage_weights;
create policy stage_weights_select on stage_weights for select to authenticated
  using (org_id is not null and is_org_member(org_id));

drop policy if exists stage_weights_write on stage_weights;
create policy stage_weights_write on stage_weights for all to authenticated
  using (org_id is not null and org_role(org_id) in ('owner', 'operator'))
  with check (org_id is not null and org_role(org_id) in ('owner', 'operator'));
