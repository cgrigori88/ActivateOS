-- P3 Slice 2C-A — durable lineage between an immutable plan action and the queue row staged from it.
--
-- WHY THIS IS A MIGRATION AND NOT A JSON FIELD. A v1 plan carried its staging pointer inside its own
-- content (`nextAction.stagedMotionActionId`). That worked only because exactly one action was ever
-- staged, at the instant the decision was written. A v2 plan carries up to three actions and stages
-- them as commercial state progresses — so a pointer inside the plan would have to be written after
-- the fact, and `pursuit_plan_revisions` is append-only by grant precisely so that a decided
-- intention cannot be edited later. Lineage therefore belongs on the MUTABLE side.
--
-- WHAT DELETION MEANS HERE. `revenue_motions -> pursuits` is already ON DELETE SET NULL: this
-- repository's existing position is that motion work OUTLIVES the pursuit, while
-- `pursuit_plan_revisions -> pursuits` CASCADEs the plan history away. A plan revision must not
-- acquire the power to delete queue work those rules deliberately preserve, so the queue row
-- survives and loses only its lineage.
--
-- No new table, no trigger, no function, no SECURITY DEFINER, no policy change, no grant statement
-- (`app_rw` holds table-level privileges on motion_actions, which cover new columns), no backfill.
--
-- Written idempotently, like every migration here (R1-G7): re-applying it is a safe no-op, which is
-- what makes a drifted tracker harmless rather than dangerous.

-- 1. The parent gains the composite candidate key the tenant-FK pattern requires. This is the same
--    device 0110 added to pursuit_run_steps; `pursuit_plan_revisions.org_id` is already NOT NULL.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pursuit_plan_revisions_org_id_id_key'
                   and conrelid = 'pursuit_plan_revisions'::regclass) then
    alter table pursuit_plan_revisions add constraint pursuit_plan_revisions_org_id_id_key unique (org_id, id);
  end if;
end $$;

-- 2. The lineage columns. Both nullable, so every existing row stays valid untouched.
alter table motion_actions add column if not exists plan_revision_id uuid;
alter table motion_actions add column if not exists plan_action_key  text;

-- 3. TENANT-CONSISTENT FOREIGN KEY — an action in org A can never hold a live reference to a plan
--    revision in org B.
--
--    ON DELETE SET NULL names plan_revision_id ONLY, and that is the whole of what the FK may do:
--    org_id is this row's own tenant identity rather than something borrowed from the parent, and
--    nulling it would orphan the row from RLS; plan_action_key is not a referencing column of this
--    key at all, so the FK cannot touch it. What remains after a parent delete is a row with a
--    tenant, a queue position, and an action key that no longer resolves — provenance, not lineage.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'motion_actions_plan_revision_fk'
                   and conrelid = 'motion_actions'::regclass) then
    alter table motion_actions
      add constraint motion_actions_plan_revision_fk
      foreign key (org_id, plan_revision_id)
      references pursuit_plan_revisions (org_id, id)
      on delete set null (plan_revision_id);
  end if;
end $$;

-- 4. LIVE-LINEAGE COMPLETENESS, deliberately one-directional.
--
--    While a revision reference is live, the action key and the tenant must both be present. The
--    org_id clause is load-bearing rather than decorative: the composite FK above is MATCH SIMPLE
--    and is NOT enforced when any referencing column is null, so without it a row with a null
--    org_id could name a revision in another tenant and the database would not object.
--
--    The converse is NOT required. A null revision with a non-null key is legal detached
--    provenance, and readers are required to treat it as such: live lineage needs
--    plan_revision_id, and a bare key never resolves to a plan.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'motion_actions_plan_lineage_live'
                   and conrelid = 'motion_actions'::regclass) then
    alter table motion_actions
      add constraint motion_actions_plan_lineage_live
      check (
        plan_revision_id is null
        or (plan_action_key is not null and org_id is not null)
      );
  end if;
end $$;

-- 5. THE IDEMPOTENCY BACKSTOP — at most one LIVE staging row per plan action, per tenant. A plan
--    action is one commercial instruction from one immutable decision; staging it twice would put
--    the same instruction in the queue twice with no way to say which is authoritative. Re-deciding
--    produces a new revision id, so a legitimately repeated instruction is a different tuple.
--
--    Partial, so legacy rows and detached-provenance rows are unconstrained.
create unique index if not exists motion_actions_plan_action_unique
  on motion_actions (org_id, plan_revision_id, plan_action_key)
  where plan_revision_id is not null;
