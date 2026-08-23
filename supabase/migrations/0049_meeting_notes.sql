-- 0049: Meeting notes (task #86, meeting-signal slice 1).
--
-- Seller-captured meeting records: the engagement signal email can't see.
-- Each note also lands as first-party evidence (through the standard quality
-- gates), so meetings ground motions, feed the timeline and digests, and
-- stop the engagement-decay trigger from calling a meeting-heavy deal quiet.
-- This is the manual lane; calendar OAuth and recap-email capture layer on
-- top of the same table later.

create table if not exists meeting_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  met_at     date not null,
  title      text,
  attendees  text,
  body       text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists meeting_notes_company_idx on meeting_notes (company_id, met_at desc);
create index if not exists meeting_notes_org_idx on meeting_notes (org_id, met_at desc);

alter table meeting_notes enable row level security;
drop policy if exists meeting_notes_select on meeting_notes;
create policy meeting_notes_select on meeting_notes for select to authenticated
  using (is_org_member(org_id));
