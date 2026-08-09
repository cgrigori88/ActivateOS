-- Phase 5: Communications (V1: Resend behind a provider abstraction).
-- Architecture decisions (founder-specified):
--  * Motion is the primary conversation context — thread aliases are
--    motion-scoped, never seller-scoped.
--  * Messages are persisted BEFORE any AI processing.
--  * Email is one channel inside a generalized interaction-event model.
--  * Suppression is checked before every outbound send, no exceptions.

create table contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references organizations(id) on delete cascade,
  company_id  uuid references companies(id) on delete set null,
  email       text not null,
  name        text,
  title       text,
  engagement_status text not null default 'unknown'
    check (engagement_status in ('unknown','engaged','opted_out','bounced','do_not_contact')),
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

create table sending_identities (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references organizations(id) on delete cascade,
  display_name text not null,          -- e.g. 'Dana Whitfield via PursuitOS'
  local_part   text not null,          -- e.g. 'dana.whitfield'
  kind         text not null default 'pursuitos'
    check (kind in ('pursuitos','gmail_oauth','m365_oauth')),
  seller_id    uuid references sellers(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (org_id, local_part)
);

create table communication_threads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  motion_id     uuid references revenue_motions(id) on delete set null,
  campaign_id   uuid references campaigns(id) on delete set null,
  company_id    uuid not null references companies(id) on delete cascade,
  opportunity_id uuid,
  thread_alias  text not null unique,  -- e.g. m_7f92k3
  status        text not null default 'open' check (status in ('open','closed')),
  created_at    timestamptz not null default now()
);
create index on communication_threads (org_id, company_id);
create index on communication_threads (motion_id);

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references communication_threads(id) on delete cascade,
  provider_message_id text,
  internet_message_id text,
  direction           text not null check (direction in ('inbound','outbound')),
  from_email          text not null,
  from_name           text,
  to_emails           text[] not null default '{}',
  cc_emails           text[] not null default '{}',
  subject             text,
  text_body           text,
  html_body           text,
  ai_draft            text,            -- the untouched AI draft (outbound only)
  status              text not null default 'stored'
    check (status in ('draft','queued','sent','failed','stored')),
  sent_at             timestamptz,
  received_at         timestamptz,
  raw_headers         jsonb,
  attachment_count    integer not null default 0,
  created_at          timestamptz not null default now()
);
create index on messages (thread_id, created_at);
create index on messages (internet_message_id) where internet_message_id is not null;

create table message_participants (
  message_id uuid not null references messages(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  email      text not null,
  role       text not null check (role in ('from','to','cc')),
  primary key (message_id, email, role)
);

-- Seller edits are training data for the messaging learning loop.
create table message_edits (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references messages(id) on delete cascade,
  ai_original    text not null,
  human_final    text not null,
  edit_distance  integer not null,
  changed_subject boolean not null default false,
  seller_id      uuid references sellers(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table email_events (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  thread_id  uuid references communication_threads(id) on delete cascade,
  event_type text not null check (event_type in
    ('SENT','DELIVERED','BOUNCED','OPENED','CLICKED','REPLIED',
     'UNSUBSCRIBED','SPAM_COMPLAINT')),
  payload    jsonb,
  occurred_at timestamptz not null default now()
);
create index on email_events (thread_id, occurred_at);

create table suppression_list (
  org_id     uuid references organizations(id) on delete cascade,
  email      text not null,
  reason     text not null check (reason in
    ('unsubscribe','hard_bounce','spam_complaint','manual','customer_policy')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);

-- Inbound conversations generate work, not just records.
create table communication_actions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade,
  thread_id  uuid references communication_threads(id) on delete cascade,
  motion_id  uuid references revenue_motions(id) on delete set null,
  title      text not null,
  detail     text,
  owner_seller_id uuid references sellers(id) on delete set null,
  due_at     timestamptz,
  confidence text check (confidence in ('low','medium','high')),
  status     text not null default 'pending'
    check (status in ('pending','done','dismissed')),
  created_at timestamptz not null default now()
);
create index on communication_actions (org_id, status, due_at);

-- Generalized interaction model: email is one channel, not the foundation.
create table interaction_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  company_id     uuid references companies(id) on delete cascade,
  motion_id      uuid references revenue_motions(id) on delete set null,
  opportunity_id uuid,
  contact_id     uuid references contacts(id) on delete set null,
  actor          text,       -- who acted: seller name, 'customer', 'system'
  type           text not null,  -- e.g. MESSAGE_SENT, REPLY_RECEIVED, MEETING_HELD
  channel        text not null check (channel in
    ('EMAIL','CALL','MEETING','LINKEDIN','EVENT','CRM_NOTE','PARTNER_NOTE')),
  payload        jsonb,
  occurred_at    timestamptz not null default now()
);
create index on interaction_events (org_id, company_id, occurred_at desc);

-- Ambiguous inbound goes to humans, never to an LLM guess: when the
-- deterministic matching hierarchy fails, the raw payload parks here.
create table inbound_triage (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade,
  reason     text not null,
  payload    jsonb not null,
  status     text not null default 'pending'
    check (status in ('pending','resolved','discarded')),
  created_at timestamptz not null default now()
);
