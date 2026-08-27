-- Ask-the-record (task: meets/beats/leaps batch, slice A). Every question and
-- answer is persisted — the ask surface is auditable like everything else, and
-- the recent exchanges double as the page's memory.

create table if not exists ask_exchanges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  question text not null,
  answer text not null,
  tool_calls jsonb not null default '[]',
  model text,
  created_at timestamptz not null default now()
);

create index if not exists ask_exchanges_org_idx on ask_exchanges (org_id, created_at desc);
