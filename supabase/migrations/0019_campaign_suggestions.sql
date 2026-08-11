-- Phase 9B.2: AI-suggested campaigns. The intelligence pipeline can draft a
-- campaign and surface it for review, but the human still makes every final
-- decision — approve touches, edit, choose the schedule, launch, or dismiss.
-- A suggestion is just a draft campaign tagged with its origin.

alter table campaigns add column if not exists source text not null default 'user'
  check (source in ('user', 'ai_suggested'));
alter table campaigns add column if not exists dismissed_at timestamptz;

create index if not exists campaigns_suggested_idx
  on campaigns (source) where source = 'ai_suggested' and dismissed_at is null;
