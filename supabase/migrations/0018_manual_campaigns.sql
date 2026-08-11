-- Phase 9B.1: decouple campaigns from motions. A campaign can be composed
-- directly on an account (manual authoring) without waiting for the AI pipeline
-- to produce an approved motion. The motion link stays optional — when present
-- it grounds AI generation; when absent the seller authors touches by hand.

alter table campaigns alter column motion_id drop not null;
alter table campaigns add column if not exists company_id uuid references companies(id) on delete cascade;
alter table campaigns add column if not exists start_date date;      -- launch anchor for the cadence
alter table campaigns add column if not exists sender_name text;     -- from-name when there is no motion seller

-- Backfill company_id from the motion for existing campaigns.
update campaigns c set company_id = m.company_id
from revenue_motions m where m.id = c.motion_id and c.company_id is null;
