-- 0055: Bring-your-own-model (no-partner-needed batch, slice C).
--
-- A tenant can supply its own Anthropic API key, so its data rides its own
-- AI contract (their tenancy, their zero-data-retention terms, their bill).
-- The key is encrypted app-side (AES-256-GCM under APP_ENCRYPTION_KEY) before
-- it touches this table, never displayed back, and clearing it reverts the
-- tenant to the platform key instantly.

create table if not exists org_ai_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  anthropic_key_enc text,
  updated_at timestamptz not null default now()
);
