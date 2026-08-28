-- 0062: API-key resolver for the RISK-1 cutover — the MCP surface's equivalent
-- of resolve_user_org() (0059).
--
-- The MCP endpoint (/api/mcp) authenticates a personal agent by a bearer API
-- key and must find that key's org BEFORE any org is in scope — the same
-- chicken-and-egg that resolve_user_org() solves for web sessions. Under the
-- non-owner role app_rw, a plain `select ... from api_keys where key_hash = $1`
-- is RLS-gated on app.org_id, which isn't set yet (we're trying to learn it),
-- so it returns nothing and every MCP call fails closed.
--
-- This SECURITY DEFINER function runs as the owner, bypassing RLS, to resolve
-- the org from the key hash. It also stamps last_used_at in the same owner
-- context (that write is itself RLS-gated under app_rw), so the resolver is a
-- single trusted round-trip: no api_keys access is needed from app_rw at all.
-- The hash is a SHA-256 of the plaintext key the client presents — never the
-- key itself — computed at the web layer (see resolveKey in mcp-tools.ts).
--
-- Narrowly scoped: it returns only (org_id, key_id) for one exact, non-revoked
-- hash. It does not let app_rw enumerate keys; a caller must already hold the
-- plaintext key to produce a matching hash.
--
-- Additive and inert until DATABASE_URL points at app_rw: on the owner
-- connection today, SECURITY DEFINER runs as the same owner, so behavior is
-- unchanged. Safe to ship now.

create or replace function public.resolve_api_key(p_hash text)
  returns table (org_id uuid, key_id uuid)
  language plpgsql volatile security definer set search_path to 'public'
  as $$
  begin
    return query
      update api_keys
         set last_used_at = now()
       where key_hash = p_hash and revoked_at is null
       returning api_keys.org_id, api_keys.id;
  end;
  $$;

-- app_rw may execute it (it runs as the owner regardless); PUBLIC keeps the
-- Data API / authenticated path working too, mirroring resolve_user_org().
grant execute on function public.resolve_api_key(text) to app_rw;
