-- 0037: blind overlap (Phase A of the unicorn roadmap, task #72).
--
-- "How much do our books overlap?" answered BEFORE either side reveals an
-- account, on a disclosure ladder — counts → bands → named — where every rung
-- requires the counterpart's explicit approval and lands in both orgs' audit
-- ledgers. The platform computes the intersection as a neutral broker; only
-- rung-appropriate aggregates are ever stored or shown, and results are
-- SYMMETRIC — both sides see the identical payload (viewer-relative framing
-- like "% of your book" is computed at render from the viewer's own data).
--
-- Safety property worth stating: an intersection can only contain accounts
-- already in the viewer's own book, so blind overlap never reveals an account
-- you don't already know — the ladder discloses *which of yours they also
-- have* (and at the named rung, how each side categorizes them), nothing else.

create table if not exists overlap_probes (
  id               uuid primary key default gen_random_uuid(),
  partnership_id   uuid not null references partnerships(id) on delete cascade,
  requested_by_org uuid not null references organizations(id) on delete cascade,
  level            text not null check (level in ('counts', 'bands', 'named')),
  status           text not null default 'requested' check (status in ('requested', 'approved', 'declined')),
  decided_at       timestamptz,
  computed_at      timestamptz,
  results          jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists overlap_probes_partnership_idx on overlap_probes (partnership_id, created_at desc);

alter table overlap_probes enable row level security;

-- Both members of the partnership can read a probe (results are symmetric by
-- design). Writes go through the app's system context, like list_grants.
drop policy if exists overlap_select on overlap_probes;
create policy overlap_select on overlap_probes for select to authenticated
  using (exists (select 1 from partnerships p
                 where p.id = partnership_id
                   and (is_org_member(p.initiator_org_id)
                        or (p.counterpart_org_id is not null and is_org_member(p.counterpart_org_id)))));
