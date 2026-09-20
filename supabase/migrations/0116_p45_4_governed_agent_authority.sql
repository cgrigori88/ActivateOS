-- 0116 — P45-4: a governed AGENT actor executes a granted capability.
--
-- WHAT THIS IS. An AGENT actor ALREADY executes governed writes in production: /api/mcp builds
-- Actor{type:"AGENT", id: key.keyId} from an API key and dispatches draft_campaign_touch through
-- dispatchSkill. It passes NO governedActorId, so the 0109 grant gate — `if (ctx.governedActorId)`
-- — never engages. Agent authority today comes from an API-KEY SCOPE, not from a grant to a
-- durable governed actor. This migration adds exactly the facts needed to close that gap:
--
--   • a credential can name the durable governed actor it represents      (api_keys)
--   • a grant can stop conferring authority without being rewritten       (expires_at)
--   • an executed invocation can name the authority instrument it used    (grant_id)
--   • an AGENT cannot be mistaken for a person                            (CHECK)
--
-- WHAT IS DELIBERATELY ABSENT, AND WHY. No model, provider, token, cost or latency column. On the
-- MCP path PursuitOS is the server BEING CALLED: src/lib/agents/mcp-writes.ts and the /api/mcp
-- write branch perform no provider call, so there is no observed provider, model version, token
-- usage or cost. Nullable fields are not added so that every value in the first certified
-- execution can be null — that is how false attribution starts. Trusted model/usage/cost
-- attribution belongs to the following "Runtime observability + P8 hooks" item, which inherits the
-- obligation to design HONEST attribution, not to populate these fields. Also absent: any new
-- table, prompt/persona/tool catalogue, and any P3/P45 run or compiler column. See §22.12.
--
-- TRANSACTION OWNERSHIP. No begin/commit — the applier owns the transaction, as every migration
-- here does. Every statement is guarded so re-running the file is a no-op.

-- ── 1. An AGENT is not a person ─────────────────────────────────────────────────────────────────
-- 0109 already requires an ACTIVE USER actor to carry a principal. The mirror is not symmetric and
-- is stated separately: an AGENT must carry NO principal, in any lifecycle. A governed agent that
-- could hold a user principal would let the USER branch of dispatchSkill's principal check — which
-- is `actor_type = 'USER'`-guarded — be reasoned about as though it protected agents too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'governed_actors_agent_not_a_person'
                   and conrelid = 'governed_actors'::regclass) then
    alter table governed_actors add constraint governed_actors_agent_not_a_person
      check (actor_type <> 'AGENT' or principal_user_id is null);
  end if;
end $$;

-- ── 2. Grant expiry ─────────────────────────────────────────────────────────────────────────────
-- A grant may stop conferring authority WITHOUT being rewritten. The column is INSERT-ONLY BY
-- OMISSION: app_rw's UPDATE on this table stays (status, revoked_at), so nothing can extend a
-- grant's life in place — an extension is a new instrument, exactly as a revocation is.
--
-- LIVENESS IS EVALUATED IN SQL AGAINST transaction_timestamp(), NEVER AGAINST AN APPLICATION
-- CLOCK (§14 / CFR-1.2, and the D-P6-1 correction). A timestamptz carries MICROSECONDS and a
-- JavaScript Date carries MILLISECONDS, so an instant that round-trips through the application is
-- up to 999us stale and can ALLOW what the database has already DENIED.
alter table actor_capability_grants add column if not exists expires_at timestamptz;

-- The candidate key an invocation's composite FK needs. 0109 established this pattern within the
-- new subsystem (governed_actors, pursuit_runs); the grants table did not need it until now.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'actor_capability_grants_org_id_id_key'
                   and conrelid = 'actor_capability_grants'::regclass) then
    alter table actor_capability_grants add constraint actor_capability_grants_org_id_id_key
      unique (org_id, id);
  end if;
end $$;

-- NOTE ON THE EXISTING PARTIAL UNIQUE INDEX, which this migration deliberately does NOT change:
--   unique (org_id, actor_id, skill_id) where status = 'ACTIVE'
-- now() cannot appear in a partial-index predicate, so an EXPIRED BUT STATUS-ACTIVE grant confers
-- zero authority and STILL OCCUPIES THE SLOT. Live-for-uniqueness and dead-for-authority are
-- different questions and are kept apart on purpose. Renewal is therefore revoke-then-insert,
-- which is already this table's only shape. skill_version is NOT in that index, so the slot is one
-- ACTIVE grant per (org, actor, skill) regardless of version — also unchanged.

-- ── 3. WHICH AUTHORITY INSTRUMENT PERMITTED THIS ACTION ─────────────────────────────────────────
-- The audit already answers who acted (actor_id, the credential) and which durable governed actor
-- it represented (governed_actor_id, added by 0109). It cannot answer which GRANT permitted it.
--
-- NO ACTION, NEVER SET NULL. Within a tenant's life nothing can delete a grant: app_rw holds no
-- DELETE on actor_capability_grants, governed_actors or governed_action_invocations. Physical
-- deletion happens only through organization cascade, where the referencing audit rows are removed
-- in the SAME statement — which NO ACTION tolerates at end-of-statement and RESTRICT would not.
-- SET NULL would destroy the answer permanently in exchange for protecting against a deletion that
-- cannot occur. The cascade claim is PROVED on a disposable clone, not asserted (§22.7).
alter table governed_action_invocations add column if not exists grant_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'governed_action_invocations_grant_fk'
                   and conrelid = 'governed_action_invocations'::regclass) then
    alter table governed_action_invocations add constraint governed_action_invocations_grant_fk
      foreign key (org_id, grant_id) references actor_capability_grants (org_id, id);
  end if;
end $$;
create index if not exists governed_action_invocations_grant
  on governed_action_invocations (org_id, grant_id) where grant_id is not null;

-- grant_id is IMMUTABLE BY OMISSION: app_rw's UPDATE on this table is (status, executed_at) and is
-- NOT widened here. An authority instrument cannot be reattributed after the fact.

-- ── 4. The credential's durable governed identity ───────────────────────────────────────────────
-- A live credential may never resolve to a nonexistent governed actor. The composite FK also means
-- a Vertex key cannot bind a Meridian actor merely because someone knows the uuid — refused
-- RELATIONALLY, before RLS is consulted.
--
-- CASCADE, NOT RESTRICT. An actor is only ever physically deleted WITH its tenant (app_rw has no
-- DELETE on governed_actors); retirement is a lifecycle value and key revocation is revoked_at, so
-- neither deletes a row. RESTRICT would check immediately and could abort a legitimate
-- organization cascade depending on the order of two cascade paths. CASCADE satisfies the same
-- invariant and does not block tenant cleanup.
alter table api_keys add column if not exists governed_actor_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'api_keys_governed_actor_fk'
                   and conrelid = 'api_keys'::regclass) then
    alter table api_keys add constraint api_keys_governed_actor_fk
      foreign key (org_id, governed_actor_id) references governed_actors (org_id, id) on delete cascade;
  end if;
end $$;
create index if not exists api_keys_governed_actor
  on api_keys (org_id, governed_actor_id) where governed_actor_id is not null;

-- ── 5. THE BINDING IS IMMUTABLE AFTER ISSUE ─────────────────────────────────────────────────────
-- Identity change means REVOKE THE CREDENTIAL AND ISSUE A NEW ONE. Making that structural rather
-- than conventional is the point: a generic API-key update must not be able to move the trusted
-- actor boundary silently.
--
-- DEPENDENCY INVENTORY, PROVED MECHANICALLY BEFORE NARROWING (§22.9). Every api_keys write in the
-- repository:
--   src/app/admin/actions.ts:246  insert (org_id, name, key_hash)   — and on the OWNER pool
--   src/app/admin/actions.ts:259  update set revoked_at = now()     — and on the OWNER pool
--   0062/0088 resolve_api_key     update set last_used_at = now()   — SECURITY DEFINER, runs as owner
-- No production statement requires app_rw UPDATE on any other column; the resolver stamps
-- last_used_at as the owner and needs no app_rw privilege at all.
revoke update on api_keys from app_rw;
grant update (revoked_at) on api_keys to app_rw;

-- ── 6. Trusted credential resolution returns the binding ────────────────────────────────────────
-- The application must learn the governed actor from the CREDENTIAL, never from a request payload.
-- app_rw cannot read api_keys at all (RLS + no grant), so the binding can only travel out through
-- this SECURITY DEFINER resolver — which is precisely why it is the trust boundary.
--
-- A return-type change requires drop + recreate; 0088 did the same for `scope`. THE RECREATE MUST
-- CARRY 0105'S HARDENED search_path. 0105 hardened this function with
-- `set search_path = pg_catalog, public, pg_temp` against temporary-schema shadowing of
-- authorization-sensitive functions; a recreate that reverted to 0088's `set search_path to
-- 'public'` would silently undo that hardening and drop the protected-function class below 31/0.
drop function if exists public.resolve_api_key(text);
create or replace function public.resolve_api_key(p_hash text)
  returns table (org_id uuid, key_id uuid, scope text, governed_actor_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, public, pg_temp
  as $$
  begin
    return query
      update api_keys
         set last_used_at = now()
       where key_hash = p_hash and revoked_at is null
       returning api_keys.org_id, api_keys.id, api_keys.scope, api_keys.governed_actor_id;
  end;
  $$;

-- app_rw may execute it (it runs as the owner regardless); PUBLIC keeps the Data API /
-- authenticated path working too, mirroring 0062/0088.
grant execute on function public.resolve_api_key(text) to app_rw;
