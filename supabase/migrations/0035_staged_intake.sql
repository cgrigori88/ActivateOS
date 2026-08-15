-- 0035: staged CSV intake (task #48).
--
-- Partner books arrive as CSVs of wildly varying shape — column names, order,
-- and content depend on whichever CRM/PRM exported them. Instead of forcing a
-- fixed header contract, imports become a two-step handshake:
--
--   1. analyze  — the file is parsed and profiled server-side; the proposed
--                 column→field mapping is stored on the batch and the raw rows
--                 are STAGED in import_rows (tenant-scoped, RLS'd), so the
--                 operator can review the mapping without re-uploading.
--   2. commit   — the operator confirms the mapping, picks which fields are
--                 surfaced (population.selected_fields), and the staged rows
--                 are resolved into companies / population members / contacts.
--                 Staged rows are DELETED on commit or discard — the raw file
--                 content never outlives the decision it exists to support.
--
-- Security posture: staged rows are the most sensitive thing the platform
-- holds (a partner's raw book, pre-redaction). They live behind the same
-- org-membership RLS as everything else, are never exposed cross-tenant, and
-- are minimized aggressively (deleted on commit/discard, swept after 7 days).

-- The batch carries the analysis result between the two steps.
alter table import_batches add column if not exists mapping jsonb;

-- Widen the status lifecycle: analyzed (awaiting mapping review) and
-- discarded (operator abandoned the upload; rows already deleted).
alter table import_batches drop constraint if exists import_batches_status_check;
alter table import_batches add constraint import_batches_status_check
  check (status in ('analyzed', 'importing', 'imported', 'failed', 'discarded'));

-- Staged raw rows: one jsonb array of cell strings per CSV line.
create table if not exists import_rows (
  batch_id   uuid not null references import_batches(id) on delete cascade,
  row_no     integer not null,
  data       jsonb not null,
  primary key (batch_id, row_no)
);

alter table import_rows enable row level security;

-- Tenant scoping rides the parent batch's org (same pattern as
-- population_members → account_populations).
drop policy if exists import_rows_select on import_rows;
create policy import_rows_select on import_rows for select to authenticated
  using (exists (
    select 1 from import_batches b
    where b.id = import_rows.batch_id and b.org_id is not null and is_org_member(b.org_id)
  ));

drop policy if exists import_rows_write on import_rows;
create policy import_rows_write on import_rows for all to authenticated
  using (exists (
    select 1 from import_batches b
    where b.id = import_rows.batch_id and b.org_id is not null
      and org_role(b.org_id) in ('owner', 'operator')
  ))
  with check (exists (
    select 1 from import_batches b
    where b.id = import_rows.batch_id and b.org_id is not null
      and org_role(b.org_id) in ('owner', 'operator')
  ));
