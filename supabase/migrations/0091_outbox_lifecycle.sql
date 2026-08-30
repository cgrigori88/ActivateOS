-- 0091: Release Gate R1-G4 — governed external-action outbox lifecycle.
--
-- The outbox becomes the ONLY execution transport for external actions (outreach
-- sends, warm intros, future provider calls): decision → dispatchSkill → invocation →
-- transactional outbox → executor → receipt → event. This widens the outbox to the
-- explicit lifecycle the executor needs (retryable vs final failure), makes external
-- actions idempotent at the transport, and carries a correlation id + attempt bounds
-- so G6's ops surface reads execution history without retrofitting. Additive.

set check_function_bodies = off;

-- Explicit lifecycle: QUEUED(=PENDING) → EXECUTING → SUCCEEDED | FAILED_RETRYABLE
-- (retry after next_attempt_at) | FAILED_FINAL (poison/dead-letter, surfaced) |
-- COMPENSATED (authority revoked before execution / recovery recorded). Old
-- DISPATCHED/SUCCEEDED/FAILED kept so pre-existing rows/tests stay valid.
alter table action_outbox drop constraint if exists action_outbox_status_check;
alter table action_outbox add constraint action_outbox_status_check check (status in (
  'PENDING','EXECUTING','SUCCEEDED','FAILED_RETRYABLE','FAILED_FINAL','COMPENSATED',
  'DISPATCHED','FAILED'));

alter table action_outbox add column if not exists idempotency_key text;
alter table action_outbox add column if not exists correlation_id uuid;
alter table action_outbox add column if not exists max_attempts int not null default 5;
alter table action_outbox add column if not exists last_error text;
alter table action_outbox add column if not exists last_failure_class text;
alter table action_outbox add column if not exists data_environment text not null default 'PRODUCTION';
alter table action_outbox add column if not exists locked_at timestamptz;

-- Idempotency at the transport: one external action per (org, idempotency_key). A
-- retried enqueue of the same authorized action collapses to the existing outbox row.
create unique index if not exists action_outbox_idem
  on action_outbox (org_id, idempotency_key) where idempotency_key is not null;
create index if not exists action_outbox_due
  on action_outbox (status, next_attempt_at) where status in ('PENDING','FAILED_RETRYABLE');

-- Receipts carry attempt + correlation + sanitized failure class (provider ack is not
-- automatically a business outcome; the receipt records what the executor observed).
alter table action_receipts add column if not exists attempt int;
alter table action_receipts add column if not exists correlation_id uuid;
alter table action_receipts add column if not exists failure_class text;
