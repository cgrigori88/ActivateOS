-- 0088: Release Gate R1-G1 — API-key scope (a role for MCP keys).
--
-- MCP keys had no role, so any live key could invoke the write tools. R1 requires
-- that agent/MCP writes carry a permission the governed boundary can enforce
-- (dispatchSkill's requiredPermission). A key is minted 'read' or 'write'; the MCP
-- route maps that to a governed Actor role (read→viewer, write→operator). Additive:
-- existing keys default to 'write' (their current effective capability), so behavior
-- is unchanged until an org mints a read-only key.

set check_function_bodies = off;

alter table api_keys add column if not exists scope text not null default 'write';
alter table api_keys drop constraint if exists api_keys_scope_check;
alter table api_keys add constraint api_keys_scope_check check (scope in ('read','write'));

-- resolve_api_key now also returns the scope. Return-type change requires a drop.
drop function if exists public.resolve_api_key(text);
create or replace function public.resolve_api_key(p_hash text)
  returns table (org_id uuid, key_id uuid, scope text)
  language plpgsql volatile security definer set search_path to 'public'
  as $$
  begin
    return query
      update api_keys
         set last_used_at = now()
       where key_hash = p_hash and revoked_at is null
       returning api_keys.org_id, api_keys.id, api_keys.scope;
  end;
  $$;
grant execute on function public.resolve_api_key(text) to app_rw;
