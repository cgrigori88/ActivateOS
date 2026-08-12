-- 0024 Campaign ↔ target lists + per-recipient personalization layer
--
-- A campaign was tied to a single account (company_id / motion→company). #54
-- lets a campaign span whole target lists (account_populations): the accounts
-- that "roll into" it are the union of every linked list's members (plus the
-- legacy seed account). And every touch gains an account_angle — the second
-- personalization layer: a short, token-templated paragraph the renderer
-- resolves per recipient ({{account}} {{industry}} {{solution}} {{trigger}}),
-- so one approved sequence scales across the list while each send still speaks
-- to that account's own data.

create table if not exists campaign_populations (
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  population_id uuid not null references account_populations(id) on delete cascade,
  added_by      text,
  created_at    timestamptz not null default now(),
  primary key (campaign_id, population_id)
);
create index if not exists campaign_populations_pop_idx on campaign_populations (population_id);

alter table campaign_touches
  add column if not exists account_angle text;  -- per-recipient layer (token-templated)
