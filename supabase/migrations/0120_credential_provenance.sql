-- 0120 — Credential-bound data provenance.
--
-- THE DEFECT THIS CLOSES. `/api/mcp` passed the string literal "PRODUCTION" as the data environment
-- of every governed invocation it dispatched. That is not an observation, it is an assumption, and
-- on the hosted Preview project it produced 18 invocations claiming PRODUCTION provenance in a
-- database whose every pursuit is DEMO — 17 of them from the P45-4/P8-0 certification gate. Since
-- PRODUCTION is the sole learning-eligible environment, certification traffic was being written
-- directly into the only class a future corpus would admit.
--
-- WHY THE CREDENTIAL IS THE RIGHT TRUST BOUNDARY. On the MCP path the credential is the ONLY thing
-- the caller cannot choose. It is server-resolved through a SECURITY DEFINER function that `app_rw`
-- cannot bypass (it has no grant on this table at all), it is org-scoped, and since 0116 it carries
-- a binding to a durable governed actor. Everything else in an MCP request — body, params, tool
-- arguments, headers — is caller-controlled and therefore worthless as provenance.
--
-- THIS IS METADATA, NOT AUTHORITY. A credential's environment says what KIND of data its executions
-- produce. It grants nothing. Authority continues to come only from the governed actor, its
-- capability grant and the skill registry (P45-4); nothing in this migration touches any of them.
--
-- NULL IS A LEGAL AND MEANINGFUL VALUE: "this credential's provenance has not been established".
-- There is deliberately NO DEFAULT. A default would recreate the exact defect above — a server
-- inventing provenance it does not have — and `PRODUCTION` as that default would recreate it in the
-- most damaging possible direction. The application FAILS CLOSED on NULL instead of guessing.
--
-- IMMUTABLE BY PRIVILEGE, WHICH ALREADY EXISTS HERE. 0116 narrowed `app_rw` to
-- `update (revoked_at)` so a credential's governed-actor binding could not drift; a column added to
-- this table therefore inherits that narrowing and is immutable to the application for free. The
-- REVOKE/GRANT pair is restated below rather than relied upon, because an invariant that holds only
-- by inheritance is one refactor away from not holding. Changing a credential's provenance means
-- REVOKE AND ISSUE A NEW ONE — the same lifecycle convention 0116 established for rebinding.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns it. Every statement is guarded.

alter table api_keys add column if not exists data_environment text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'api_keys_data_environment_check' and conrelid = 'api_keys'::regclass) then
    -- The vocabulary is `DataEnvironment` in src/lib/pursuits/lineage.ts, in full. CERTIFICATION and
    -- PILOT are the two this slice uses; the others are admitted because a credential issued for a
    -- demo or a backtest is a coherent thing to want, and refusing it here would be policy invented
    -- in a migration. PRODUCTION remains legal and must be a deliberate act, never a fallback.
    alter table api_keys add constraint api_keys_data_environment_check
      check (data_environment is null or data_environment in (
        'PRODUCTION', 'PILOT', 'CERTIFICATION', 'DEMO', 'TEST', 'SYNTHETIC', 'SIMULATION', 'BACKTEST'));
  end if;
end $$;

-- INSERT is column-level on this table, so a minting statement that names the column needs it
-- granted explicitly; UPDATE is deliberately NOT granted, which is what makes provenance immutable
-- after issue.
grant insert (data_environment) on api_keys to app_rw;
revoke update on api_keys from app_rw;
grant update (revoked_at) on api_keys to app_rw;

-- ── The resolver carries it out ─────────────────────────────────────────────────────────────────
-- A return-type change requires drop + recreate; 0088 and 0116 each did the same. THE RECREATE MUST
-- CARRY 0105'S HARDENED search_path — `set search_path = pg_catalog, public, pg_temp`, against
-- temporary-schema shadowing of authorization-sensitive functions. Reverting to `'public'` here
-- would silently undo that hardening and drop the protected-function class below its certified
-- count, which is exactly the trap 0116 documented when it recreated this same function.
drop function if exists public.resolve_api_key(text);
create or replace function public.resolve_api_key(p_hash text)
  returns table (org_id uuid, key_id uuid, scope text, governed_actor_id uuid, data_environment text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public, pg_temp
  as $$
  begin
    return query
      update api_keys
         set last_used_at = now()
       where key_hash = p_hash and revoked_at is null
       returning api_keys.org_id, api_keys.id, api_keys.scope, api_keys.governed_actor_id,
                 api_keys.data_environment;
  end;
  $$;
grant execute on function public.resolve_api_key(text) to app_rw;

-- ── Backfill: ONE credential, by exact id ───────────────────────────────────────────────────────
-- Every api_keys row in existence was inventoried before this was written: LOCAL HOLDS NONE, and
-- hosted Preview holds exactly one — `a3f6ad1e`, "P45-4 campaign drafting agent", bound to governed
-- actor `9e5f147e`, which is the actor on 17 of the 18 mislabelled invocations. Its certification
-- use is established by that evidence, so it is classified CERTIFICATION.
--
-- NOT "every old credential is CERTIFICATION". That rule would be unfalsifiable and would be wrong
-- the first time someone had issued a second key. One row, named by id, matching the discipline
-- `certification_exclusions` uses: no timestamp, proximity, deployment or count inference.
--
-- It is a no-op on any database that does not hold that row, which includes every local clone.
update api_keys set data_environment = 'CERTIFICATION'
 where id = 'a3f6ad1e-ddea-4f0b-9278-acf3bc93cab7' and data_environment is null;
