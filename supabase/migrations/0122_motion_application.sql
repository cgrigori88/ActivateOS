-- 0122 — Applying a reusable commercial motion (thin P9).
--
-- WHAT THIS DOES *NOT* ADD, AND WHY THAT IS THE POINT.
--
-- Discovery found the motion model already present and correct:
--
--   play_templates      the reusable pattern, identified by (slug, version) with a unique key, a
--                       taxonomy node and a jsonb definition — versioning already solved
--   revenue_motions     the INSTANCE, already carrying play_template_id, company, partner,
--                       pursuit_id and goal_id
--   motion_actions      the instantiated cadence, already created idempotently by
--                       `createMotionActions` from the template's own seller_cadence
--   pursuit_goals /
--   pursuit_plans /
--   pursuit_plan_revisions   P3 coordination, whose recommender ALREADY takes the motion as an
--                       input (`PlanState.motion`) and whose DECISION revision already separates
--                       "a template proposed this" from "a person accepted it"
--   campaigns           already linked to motion_id, pursuit_id and goal_id
--   pursuit_team_members already distinguishes `is_recommended` from `is_accepted` — role expected
--                       versus person assigned
--
-- So thin P9 adds NO new goal, plan, action, campaign or role primitive, and no second
-- recommendation system. It adds exactly one thing the model could not answer.
--
-- ── THE ONE GAP: WHO APPLIED WHAT, TO WHAT, ON WHAT BASIS ───────────────────────────────────────
--
-- `revenue_motions` records that a motion exists. It cannot say that a PERSON deliberately applied
-- template X at version N to this subject at this moment, what the eligibility evaluation said at
-- the time, or which recommendation resulted. That is the evidence P8 will eventually need, and it
-- is exactly the evidence that is unrecoverable afterwards: eligibility is computed from facts that
-- move, so "why did this look applicable then" cannot be reconstructed later.
--
-- ── IT RECORDS ASSOCIATION, NEVER CAUSATION ────────────────────────────────────────────────────
--
-- A row here means: this motion was applied to this subject at this time, and this pursuit
-- structure resulted. If the opportunity later progresses, that is TEMPORAL ASSOCIATION. Nothing in
-- this table may be read as "the motion caused it", and no column invites that reading — there is
-- no outcome, no result, no score and no effectiveness field, deliberately.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

create table if not exists motion_applications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,

  -- THE TEMPLATE AS APPLIED, BY VALUE. The slug and version are copied rather than only pointed at:
  -- `play_templates` rows can be edited, and a historical application must stay interpretable even
  -- if the template it came from is later revised or removed. The FK is kept as a convenience and
  -- is deliberately ON DELETE SET NULL — losing the pointer must not lose the meaning.
  template_slug      text not null,
  template_version   integer not null,
  play_template_id   uuid references play_templates(id) on delete set null,

  -- WHAT IT WAS APPLIED TO. A company is the ordinary case; a pursuit is the case where the user
  -- applies a second motion to work already under way.
  subject_kind       text not null check (subject_kind in ('company', 'opportunity', 'pursuit')),
  subject_id         uuid not null,

  -- WHAT RESULTED. All nullable: an application that produced no plan revision (because nothing
  -- changed) is a fact, not a gap.
  pursuit_id         uuid references pursuits(id) on delete set null,
  motion_id          uuid references revenue_motions(id) on delete set null,
  plan_revision_id   uuid,

  -- THE EVALUATION AT THE MOMENT OF APPLICATION. Three states, never two: absence of a fact is
  -- INSUFFICIENT_CONTEXT, which is emphatically not NOT_ELIGIBLE. The basis holds which clauses
  -- were tested and which fact ids answered them — references and verdicts, never evidence text,
  -- so nothing disclosure-controlled is copied out of the evidence system into this table.
  eligibility        text not null check (eligibility in ('ELIGIBLE', 'NOT_ELIGIBLE', 'INSUFFICIENT_CONTEXT')),
  eligibility_basis  jsonb not null default '[]'::jsonb,

  applied_by_user_id uuid references auth.users(id) on delete set null,
  applied_at         timestamptz not null default now(),
  data_environment   text not null,

  -- IDEMPOTENCE, AND THE VERSIONING RULE IN ONE CONSTRAINT. Applying the same template VERSION to
  -- the same subject twice is the same act and yields the same row. A NEWER version is a different
  -- act and is allowed to produce a new one — which is what makes "rerun" explicit rather than
  -- accidental.
  constraint motion_applications_once unique (org_id, template_slug, template_version, subject_kind, subject_id)
);
create index if not exists motion_applications_subject on motion_applications (org_id, subject_kind, subject_id);
create index if not exists motion_applications_pursuit on motion_applications (org_id, pursuit_id) where pursuit_id is not null;

-- ── APPEND-ONLY, BY PRIVILEGE ──────────────────────────────────────────────────────────────────
-- `alter default privileges` grants app_rw `arwd` on every new table, so the GRANT alone adds
-- nothing — UPDATE and DELETE arrive by default and must be taken away. Same device as 0094,
-- 0117, 0118 and 0121. An application record that can be edited afterwards is not evidence of what
-- was believed at the time.
grant select, insert on motion_applications to app_rw;
revoke update, delete on motion_applications from app_rw;

alter table motion_applications enable row level security;
alter table motion_applications force row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='motion_applications' and policyname='motion_applications_rw') then
    create policy motion_applications_rw on motion_applications for all to app_rw
      using (org_id = current_setting('app.org_id', true)::uuid)
      with check (org_id = current_setting('app.org_id', true)::uuid);
  end if;
end $$;
