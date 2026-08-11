-- Phase 9B: sequence cadence — launching a campaign turns approved touches
-- into a dated send plan, and an Upcoming surface shows what fires when.
--
-- Safety posture: launching computes the plan (scheduled_at per touch). Whether
-- the worker actually auto-sends is gated by the OUTREACH_AUTOSEND env flag on
-- the worker; with it off (default), due touches wait for a human "send now".
-- Real customer email is never sent by a schedule the operator didn't arm.

alter table campaigns add column if not exists launched_at timestamptz;
alter table campaigns add column if not exists recipient_email text;
alter table campaigns add column if not exists recipient_contact_id uuid references contacts(id) on delete set null;

-- When a scheduled touch is due (launched_at + send_offset_days).
alter table campaign_touches add column if not exists scheduled_at timestamptz;
create index if not exists campaign_touches_due_idx
  on campaign_touches (scheduled_at) where status = 'scheduled';
