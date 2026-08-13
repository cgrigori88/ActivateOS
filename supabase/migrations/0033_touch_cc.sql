-- 0033 Multiple recipients per touch: CC list.
--
-- A touch still has ONE primary recipient (the sequence's target — engagement
-- attribution stays clean), but a touch can copy additional contacts:
-- the champion's boss, the partner seller, procurement. CC rides on the touch,
-- so both the pre-launch "send now" and the scheduled drain honor it, and
-- suppression is enforced per-address at send time (suppressed CCs drop off;
-- a suppressed primary still refuses the send).
alter table campaign_touches add column if not exists cc_emails text[] not null default '{}';
