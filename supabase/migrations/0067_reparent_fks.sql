-- 0067: Additive reparenting (Workstream A, §5-6). Add a NULLABLE pursuit_id to the
-- legacy objects so they attach to the canonical Pursuit without breaking existing
-- account/motion paths. Pursuit becomes authoritative for Pursuit-level state behind
-- PURSUITS_ENABLED; legacy fields remain as compatibility projections (§6), not a
-- second independently-evolving authority.
--
-- Cardinality (§33-34): opportunities → pursuit and campaigns → pursuit are MANY-to-one
-- (many opps/campaigns may reference one pursuit). A Pursuit may have 0..N opportunities
-- and 0..N campaigns. Campaign↔Pursuit M:N (a campaign spanning pursuits) is a documented
-- future extension (a campaign_pursuits join table) — the single FK is the deliberate
-- pre-demo simplification for the hero loop.

alter table revenue_motions add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
alter table pursuit_teams   add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
alter table opportunities   add column if not exists pursuit_id uuid references pursuits(id) on delete set null;
alter table campaigns       add column if not exists pursuit_id uuid references pursuits(id) on delete set null;

create index if not exists revenue_motions_pursuit on revenue_motions (pursuit_id) where pursuit_id is not null;
create index if not exists pursuit_teams_pursuit   on pursuit_teams (pursuit_id)   where pursuit_id is not null;
create index if not exists opportunities_pursuit   on opportunities (pursuit_id)   where pursuit_id is not null;
create index if not exists campaigns_pursuit       on campaigns (pursuit_id)       where pursuit_id is not null;

-- No new RLS needed: these tables already have their org-scoped policies; the added
-- column is covered by the existing row policy.
