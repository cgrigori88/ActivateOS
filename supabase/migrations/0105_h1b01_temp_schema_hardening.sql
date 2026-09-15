-- 0105 — H1B-0.1: no authorization-sensitive function may resolve names through the caller's pg_temp.
--
-- WHY (H1B Gate 2 precheck, 2026-09-15). PostgreSQL searches the session's temporary schema FIRST for
-- relations and types whenever `pg_temp` is not named in `search_path`. Every security-sensitive function
-- here pinned `search_path = public` (or pinned nothing), and PUBLIC holds TEMPORARY on the database — so a
-- caller could create a temp table named like a real one (`partnerships`, `org_members`, `api_keys`, …)
-- and change what a SECURITY DEFINER function, an RLS helper or a guard trigger reads. Proven as the real
-- app_rw login: a non-party's temp `partnerships` exposed another org's settlement rows and allowed a
-- write into another partnership's joint room. Temporary-schema shadowing is NOT accepted as residual
-- risk for the app_rw runtime security boundary (D-050).
--
-- THE FIX. Pin `search_path = pg_catalog, public, pg_temp` on every function in the protected class:
--   * every SECURITY DEFINER function in public                                       (26)
--   * every function an RLS policy calls                                               (app_current_org —
--     the definer helpers above are the others)
--   * every trigger function that enforces a tenant / consent / provenance rule        (4)
-- pg_catalog first (built-ins cannot be shadowed), the trusted application schema next, pg_temp LAST (a
-- temp relation or type can no longer shadow a real one). `app_current_org()` reads nothing from public,
-- so it gets the narrower `pg_catalog, pg_temp`.
--
-- ASSUMPTION THIS RELIES ON (verified on the hosted target at the Gate 2 precheck, and asserted by
-- scripts/search-path-verify.ts on every certification run): no runtime role can CREATE in `public` —
-- not PUBLIC, app_rw, anon, authenticated or service_role, directly or through membership. `public` is
-- therefore a trusted schema to place ahead of pg_temp.
--
-- Scope: ALTER FUNCTION … SET only. No function body, owner, EXECUTE grant, policy, table or row changes.
-- Idempotent. Function bodies are deliberately NOT rewritten to schema-qualify relations: with pg_temp
-- last and `public` non-writable, qualification adds no protection and re-creating 31 bodies would risk
-- drift in certified behaviour.

-- ── SECURITY DEFINER: older RLS / tenant / grant / API-key helpers ─────────────────────────────────
alter function public.is_org_member(uuid)                                  set search_path = pg_catalog, public, pg_temp;
alter function public.org_role(uuid)                                       set search_path = pg_catalog, public, pg_temp;
alter function public.can_see_partnership(uuid)                            set search_path = pg_catalog, public, pg_temp;
alter function public.can_see_pursuit(uuid)                                set search_path = pg_catalog, public, pg_temp;
alter function public.grant_is_live(uuid)                                  set search_path = pg_catalog, public, pg_temp;
alter function public.grant_population_delete_guard()                      set search_path = pg_catalog, public, pg_temp;
alter function public.resolve_api_key(text)                                set search_path = pg_catalog, public, pg_temp;
alter function public.resolve_user_org(uuid)                               set search_path = pg_catalog, public, pg_temp;

-- ── SECURITY DEFINER: H1B-0 consent-scoped access (0104) ────────────────────────────────────────────
alter function public.h1b_consent_party(uuid)                              set search_path = pg_catalog, public, pg_temp;
alter function public.h1b_consent_allowed(uuid)                            set search_path = pg_catalog, public, pg_temp;
alter function public.audit_partnership_event(uuid, uuid, text, text, jsonb) set search_path = pg_catalog, public, pg_temp;
alter function public.redeem_partnership_invite(text)                      set search_path = pg_catalog, public, pg_temp;
alter function public.list_grant_source_state(uuid)                        set search_path = pg_catalog, public, pg_temp;
alter function public.sync_list_grant_members(uuid)                        set search_path = pg_catalog, public, pg_temp;
alter function public.revoke_list_grant_copies(uuid, uuid)                 set search_path = pg_catalog, public, pg_temp;
alter function public.h1b_org_book(uuid)                                   set search_path = pg_catalog, public, pg_temp;
alter function public.h1b_overlap_results(uuid, uuid, text)                set search_path = pg_catalog, public, pg_temp;
alter function public.decide_overlap_probe(uuid, boolean)                  set search_path = pg_catalog, public, pg_temp;
alter function public.partnership_evidence_shares(uuid)                    set search_path = pg_catalog, public, pg_temp;
alter function public.shared_in_evidence(uuid)                             set search_path = pg_catalog, public, pg_temp;
alter function public.h1b_skill_owner(uuid)                                set search_path = pg_catalog, public, pg_temp;
alter function public.partnership_skill_shares(uuid)                       set search_path = pg_catalog, public, pg_temp;
alter function public.shared_in_skills()                                   set search_path = pg_catalog, public, pg_temp;
alter function public.skill_share_subject(uuid)                            set search_path = pg_catalog, public, pg_temp;
alter function public.record_broker_event(uuid, text, jsonb)               set search_path = pg_catalog, public, pg_temp;
alter function public.partnership_settlement_rows(uuid)                    set search_path = pg_catalog, public, pg_temp;

-- ── SECURITY INVOKER, but on the security boundary ──────────────────────────────────────────────────
-- Called directly by RLS policies; reads nothing from public (its ::uuid cast must resolve to pg_catalog).
alter function public.app_current_org()                                    set search_path = pg_catalog, pg_temp;
-- Guard triggers run as the caller: an unpinned (or public-only) path lets the caller's own temp tables
-- shadow the relations they check, bypassing the rule they enforce.
alter function public.h1b_consent_guard()                                  set search_path = pg_catalog, public, pg_temp;
alter function public.enforce_verified_evidence()                          set search_path = pg_catalog, public, pg_temp;
alter function public.economic_fact_assertion_guard()                      set search_path = pg_catalog, public, pg_temp;
alter function public.stakeholder_assertion_guard()                        set search_path = pg_catalog, public, pg_temp;

-- ── ROLLBACK (H1B) ─────────────────────────────────────────────────────────────────────────────────
-- Restores the exact pre-0105 settings (27 functions pinned `public`; 4 with no setting). Machine-read by
-- scripts/search-path-verify.ts, whose negative control executes precisely these lines on a disposable
-- clone and proves the exploit returns — so the documented rollback is itself certified.
-- ROLLBACK: alter function public.is_org_member(uuid) set search_path = public;
-- ROLLBACK: alter function public.org_role(uuid) set search_path = public;
-- ROLLBACK: alter function public.can_see_partnership(uuid) set search_path = public;
-- ROLLBACK: alter function public.can_see_pursuit(uuid) set search_path = public;
-- ROLLBACK: alter function public.grant_is_live(uuid) set search_path = public;
-- ROLLBACK: alter function public.grant_population_delete_guard() set search_path = public;
-- ROLLBACK: alter function public.resolve_api_key(text) set search_path = public;
-- ROLLBACK: alter function public.resolve_user_org(uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_consent_party(uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_consent_allowed(uuid) set search_path = public;
-- ROLLBACK: alter function public.audit_partnership_event(uuid, uuid, text, text, jsonb) set search_path = public;
-- ROLLBACK: alter function public.redeem_partnership_invite(text) set search_path = public;
-- ROLLBACK: alter function public.list_grant_source_state(uuid) set search_path = public;
-- ROLLBACK: alter function public.sync_list_grant_members(uuid) set search_path = public;
-- ROLLBACK: alter function public.revoke_list_grant_copies(uuid, uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_org_book(uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_overlap_results(uuid, uuid, text) set search_path = public;
-- ROLLBACK: alter function public.decide_overlap_probe(uuid, boolean) set search_path = public;
-- ROLLBACK: alter function public.partnership_evidence_shares(uuid) set search_path = public;
-- ROLLBACK: alter function public.shared_in_evidence(uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_skill_owner(uuid) set search_path = public;
-- ROLLBACK: alter function public.partnership_skill_shares(uuid) set search_path = public;
-- ROLLBACK: alter function public.shared_in_skills() set search_path = public;
-- ROLLBACK: alter function public.skill_share_subject(uuid) set search_path = public;
-- ROLLBACK: alter function public.record_broker_event(uuid, text, jsonb) set search_path = public;
-- ROLLBACK: alter function public.partnership_settlement_rows(uuid) set search_path = public;
-- ROLLBACK: alter function public.h1b_consent_guard() set search_path = public;
-- ROLLBACK: alter function public.app_current_org() reset search_path;
-- ROLLBACK: alter function public.enforce_verified_evidence() reset search_path;
-- ROLLBACK: alter function public.economic_fact_assertion_guard() reset search_path;
-- ROLLBACK: alter function public.stakeholder_assertion_guard() reset search_path;
