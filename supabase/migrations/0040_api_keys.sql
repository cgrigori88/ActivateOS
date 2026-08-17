-- 0040: per-org API keys for the BYO-bot MCP surface (task #76).
--
-- A key lets a personal agent (Claude, Grok Bot, Copilot — whatever the
-- operator runs) query THIS tenant through /api/mcp. Enforcement lives under
-- the API: every tool is org-scoped by the key, reads mirror what the UI
-- shows, and the only write tool produces DRAFTS behind the existing
-- approval gates. Keys are stored as sha256 hashes — the plaintext is shown
-- once at mint time and never persisted.

create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_keys_org_idx on api_keys (org_id, created_at desc);

alter table api_keys enable row level security;

-- Owner-only: minting and revoking agent access is an admin concern.
drop policy if exists api_keys_select on api_keys;
create policy api_keys_select on api_keys for select to authenticated
  using (org_role(org_id) = 'owner');
drop policy if exists api_keys_write on api_keys;
create policy api_keys_write on api_keys for all to authenticated
  using (org_role(org_id) = 'owner')
  with check (org_role(org_id) = 'owner');
