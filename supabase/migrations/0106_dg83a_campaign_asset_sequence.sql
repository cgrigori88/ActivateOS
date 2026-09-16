-- 0106 — D-G8-3A: persist the campaign composer's authored asset sequence.
--
-- WHY. `campaign_assets.created_at` defaults to now(), which is transaction_timestamp(). The composer
-- (src/lib/agents/campaign-composer.ts) writes its four assets inside ONE transaction, so every row
-- carries an IDENTICAL created_at. Both readers — app/briefs/[motionId]/page.tsx and
-- app/accounts/[id]/page.tsx — ordered by created_at alone, which is therefore a complete tie across
-- the whole set: heap / encounter order decided what the brief rendered. The composer's array order is
-- the real, existing business sequence (seller playbook -> outreach email -> discovery guide ->
-- objection cards) and it was being discarded at persist time. This is the D-G8-3 invariant: a value
-- the product shows must be a deterministic function of canonical inputs, not of physical row order.
--
-- WHAT. One additive, nullable column plus a partial unique index. No default: a default would let a
-- future writer silently persist a meaningless position, and 0 would collide across the set. Nullable
-- so the CURRENT composer (which does not yet supply it) keeps inserting during the rollout — this
-- migration is deployable before the application change. NOT NULL is deliberately NOT set here; it is
-- deferred to a later migration once the new composer is deployed everywhere (owner decision).
--
-- Readers order by `position asc nulls last, id` — business sequence first, id ONLY as the final
-- uniqueness tie-breaker, never as business meaning.
--
-- Scope: one column, one index, one backfill of a table that holds 0 rows on the hosted target. No
-- policy, grant, role, RLS or function change. The existing campaign_assets_campaign_idx is kept.

alter table campaign_assets add column position integer;

comment on column campaign_assets.position is
  'D-G8-3A: the composer''s authored sequence (0-based). Internal ordering only — not product/API facing. '
  'Readers: order by position asc nulls last, id.';

-- Backfill by the composer's OWN canonical asset_type sequence, then created_at, then id. This is the
-- order the composer already writes; it is not a new rule. Idempotent (only fills NULLs).
update campaign_assets a
   set position = s.rn - 1
  from (select id,
               row_number() over (
                 partition by campaign_id
                 order by array_position(
                            array['seller_playbook','outreach_email','discovery_guide','objection_cards']::text[],
                            asset_type),
                          created_at,
                          id) as rn
          from campaign_assets) s
 where s.id = a.id
   and a.position is null;

-- Two assets of one campaign may never claim the same slot. Partial, so legacy NULL rows cannot block it.
create unique index campaign_assets_campaign_position_uidx
  on campaign_assets (campaign_id, position)
  where position is not null;

-- ROLLBACK: drop index if exists campaign_assets_campaign_position_uidx;
-- ROLLBACK: alter table campaign_assets drop column position;
-- ROLLBACK: revert the readers to `order by a.created_at` and the composer to a 4-column insert.
