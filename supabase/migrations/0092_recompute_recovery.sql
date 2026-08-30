-- 0092: Release Gate R1-G5 — recompute queue recovery.
--
-- The recompute drain runs each request inside a transaction, so a crash mid-drain
-- rolls back to PENDING (no partial snapshot, no lost work). What was missing: (1) a
-- lease so a RUNNING row that somehow outlives its worker (a committed RUNNING, a stuck
-- lock) is re-picked instead of stranded, and (2) a bounded-attempt cap so a poison
-- request fails visibly instead of retrying forever. Additive.

set check_function_bodies = off;

alter table recompute_requests add column if not exists locked_at timestamptz;
alter table recompute_requests add column if not exists max_attempts int not null default 5;
create index if not exists recompute_requests_recover
  on recompute_requests (status, locked_at) where status = 'RUNNING';
