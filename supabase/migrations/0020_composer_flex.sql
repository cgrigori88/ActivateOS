-- Phase 9B.3: composer flexibility.
--  * Sequencer gains a send time + timezone (touches fire at a real local
--    time, DST-correct), not just a date.
--  * A touch can carry seller-provided custom HTML, embedded inside the brand
--    shell instead of the structured fields.

alter table campaigns add column if not exists send_time text;  -- 'HH:MM' local wall time
alter table campaigns add column if not exists send_tz text;    -- IANA zone, e.g. America/New_York

alter table campaign_touches add column if not exists custom_html text; -- raw body HTML (branded on render)
