-- 0032 Live grant sync + source-deletion safety (multi-tenant slice 5b)
--
-- Accept was copy-at-accept; now a grant can be re-synced. `synced_at` marks
-- the last materialization so staleness ("the source changed since your copy")
-- is detectable. And a trigger closes a revocation hole: deleting a shared
-- source list used to cascade the grant row away SILENTLY, leaving the
-- receiver's copy live — now the copy is withdrawn and both ledgers say why.

alter table list_grants add column if not exists synced_at timestamptz;
update list_grants set synced_at = decided_at where status = 'accepted' and synced_at is null;

create or replace function grant_population_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Sharer deletes a granted source list → withdraw every materialized copy
  -- and ledger it on both sides, BEFORE the FK cascades the grants away.
  update account_populations set status = 'rejected'
   where id in (select materialized_population_id from list_grants
                where population_id = old.id and materialized_population_id is not null);
  insert into audit_log (org_id, actor, event, detail, partnership_id)
  select x.org_id, 'system', 'grant.source_deleted',
         jsonb_build_object('list', old.name, 'grant_id', g.id), g.partnership_id
  from list_grants g
  join partnerships p on p.id = g.partnership_id
  cross join lateral (values (p.initiator_org_id), (p.counterpart_org_id)) as x(org_id)
  where g.population_id = old.id and g.status in ('offered','accepted') and x.org_id is not null;

  -- Receiver deletes their materialized copy → the share is over; record it
  -- as declined so the sharer's view doesn't claim a live share that isn't.
  update list_grants set status = 'declined', decided_at = now()
   where materialized_population_id = old.id and status = 'accepted';
  return old;
end $$;

drop trigger if exists trg_grant_population_delete on account_populations;
create trigger trg_grant_population_delete
  before delete on account_populations
  for each row execute function grant_population_delete_guard();
