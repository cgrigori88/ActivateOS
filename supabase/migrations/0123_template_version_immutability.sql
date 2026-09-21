-- 0123 — A published motion template version cannot change meaning in place (thin P9 correction).
--
-- ── WHY A UNIQUE KEY WAS NOT ENOUGH ────────────────────────────────────────────────────────────
--
-- `play_templates` is unique on `(slug, version)`, and that was read as "versioning is solved". It
-- is not: uniqueness constrains WHICH ROW exists, not WHAT IT SAYS. `app_rw` held `arwd` on this
-- table, and the knowledge seed used `on conflict (slug, version) do update set definition = ...`
-- — so re-seeding an edited file silently rewrote the meaning of a version that may already have
-- been applied to real pursuits.
--
-- That matters here more than it would elsewhere. `motion_applications` and `revenue_motions` both
-- point at a template version to say "this is the pattern that was applied". If v1 can be rewritten,
-- those pointers stop meaning anything: the history would claim a contract the template no longer
-- contains, and no evidence would survive of the one it did.
--
-- ── THE RULE ───────────────────────────────────────────────────────────────────────────────────
--
-- A published version is IMMUTABLE. A semantic change is a new version row. Nothing may UPDATE a
-- published version into a different meaning, and nothing may DELETE a version that history points
-- at. `app_rw` keeps INSERT and SELECT and loses the rest — the same device 0094, 0117, 0118, 0121
-- and 0122 use, and the reason is the same: an invariant enforced by privilege survives a caller
-- who forgets it.
--
-- FULL-ROW IMMUTABILITY IS DELIBERATE. Splitting "semantic" fields from "display" fields so copy
-- could stay editable would be a second contract to get right, and thin P9 has no evidence yet about
-- which fields are which. A typo is fixed by publishing v2, which is cheap and honest.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

-- No product path writes this table: the only writers are the knowledge seed and its generated-SQL
-- twin. Both are corrected to refuse a content mismatch rather than overwrite it.
revoke update, delete on play_templates from app_rw;
grant select, insert on play_templates to app_rw;

-- ── AND A GUARD THE APPLICATION CANNOT FORGET ──────────────────────────────────────────────────
-- The owner role still holds UPDATE (migrations run as owner and may legitimately need to correct
-- a genuine defect with a documented migration). This trigger makes the ordinary case impossible by
-- accident while leaving the deliberate case possible with a deliberate statement.
create or replace function public.play_templates_immutable() returns trigger
  language plpgsql
  set search_path = pg_catalog, public, pg_temp
  as $$
  begin
    if current_setting('pursuitos.allow_template_rewrite', true) = 'on' then
      return new;
    end if;
    raise exception
      'play_templates version % of % is published and immutable — publish a new version instead',
      old.version, old.slug
      using hint = 'a semantic change is a new version row; motion history points at this one';
  end;
  $$;

drop trigger if exists play_templates_no_update on play_templates;
create trigger play_templates_no_update
  before update on play_templates
  for each row execute function public.play_templates_immutable();
