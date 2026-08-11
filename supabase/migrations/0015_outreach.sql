-- Phase 9A: Outreach — branded campaigns, multi-touch email sequences, and
-- the engagement rollup that feeds the intelligence layer.
--
-- Design decisions:
--  * Brand is vendor-agnostic: colors, wordmark, and footer are configurable
--    per org/partner, never hard-coded. One default brand per org.
--  * A campaign is a motion-scoped, multi-touch sequence. Each TOUCH is one
--    email with its own approval state — the human-approval invariant applies
--    per touch, not per campaign, so a seller can approve touch 1 and hold 2.
--  * Rendered HTML is stored ON the touch (reproducible preview + audit); the
--    send layer reads html_body/text_body straight through to Resend.
--  * Engagement (opens/clicks/replies) is not just campaign-copy training data.
--    engagement_scores is a rollup other subsystems consume: propensity
--    (CUSTOMER_ENGAGEMENT family), compelling-event detection (an engagement
--    burst is a buying signal), forecasting (engagement velocity), and
--    buyer-behavior/influence (which persona/level engages, how deeply).

-- ── Brand profiles (vendor-agnostic theming) ────────────────────────────────
create table brand_profiles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  name           text not null,
  wordmark       text not null,                 -- text logo, e.g. "PursuitOS"
  primary_color  text not null default '#1d4ed8',
  accent_color   text not null default '#0f172a',
  from_label     text,                          -- e.g. "Dana at Acme"
  footer_html    text,                          -- signature / legal block
  address_line   text,                          -- physical address (CAN-SPAM)
  unsubscribe_url text,
  is_default     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index on brand_profiles (org_id);
-- At most one default brand per org.
create unique index brand_profiles_one_default
  on brand_profiles (org_id) where is_default;

-- Campaigns gain a brand + an objective + an audience note. (campaigns itself
-- is defined in 0001; status vocab there is draft/launched/paused/completed.)
alter table campaigns add column if not exists brand_id uuid references brand_profiles(id) on delete set null;
alter table campaigns add column if not exists objective text;
alter table campaigns add column if not exists audience text;

-- ── Multi-touch email sequence ──────────────────────────────────────────────
create table campaign_touches (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  touch_no      integer not null,              -- 1..N ordering in the sequence
  name          text not null,                 -- internal label, e.g. "Trigger intro"
  channel       text not null default 'EMAIL' check (channel in ('EMAIL')),
  -- Structured content the renderer consumes (grounded generator output).
  subject       text not null,
  preheader     text,
  headline      text,
  body          text not null,                 -- paragraphs, \n\n separated
  highlights    text[] not null default '{}',  -- scannable proof points
  cta_label     text,
  cta_url       text,
  -- Rendered artifacts (reproducible preview + what actually sends).
  html_body     text,
  text_body     text,
  send_offset_days integer not null default 0, -- cadence offset from touch 1
  status        text not null default 'draft'
                  check (status in ('draft','approved','rejected','scheduled','sent')),
  approved_by   text,
  approved_at   timestamptz,
  rejected_reason text,
  message_id    uuid references messages(id) on delete set null,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (campaign_id, touch_no)
);
create index on campaign_touches (campaign_id, touch_no);
create index on campaign_touches (status);

-- ── Engagement rollup (feeds the intelligence layer) ────────────────────────
-- Recomputed from email_events + messages. Consumed by propensity, compelling-
-- event detection, forecasting, and buyer-behavior/influence modeling.
create table engagement_scores (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  touches_sent    integer not null default 0,
  opens           integer not null default 0,
  clicks          integer not null default 0,
  replies         integer not null default 0,
  positive_replies integer not null default 0,
  engagement_score numeric not null default 0,   -- 0..100 composite
  velocity        numeric not null default 0,     -- engagement events / active week
  last_engaged_at timestamptz,
  computed_at     timestamptz not null default now(),
  unique (company_id, contact_id)
);
create index on engagement_scores (org_id, engagement_score desc);
create index on engagement_scores (company_id);
