-- 0094: Append-only enforcement for the canonical history/ledger tables touched by the
-- governed operating loop (canonical micro-loop, Phase 2). Until now append-only was a
-- SERVICE-LAYER convention; a governed loop whose audit trail the application role can still
-- UPDATE/DELETE is not defensible. This REVOKES the destructive privileges from the normal
-- application-write role (`app_rw`) at the DATABASE level.
--
-- Preferred mechanism (per the operating-loop plan): REVOKE UPDATE/DELETE from app_rw for true
-- history tables. Where the schema legitimately advances a row FORWARD, a full UPDATE revoke is
-- technically impossible, so UPDATE is revoked at the table level and GRANTED BACK only on the
-- specific forward-lifecycle columns the app writes — the request identity + evidence stay
-- immutable. No trigger-based mutation rewriting is used. A semantic correction is made by
-- APPENDING a superseding row, never by editing history.
--
-- Enforcement binds at the `app_rw` cutover (task #67); the table OWNER (superuser) is
-- unaffected — consistent with the currently-latent RLS model. Idempotent (REVOKE/GRANT).

-- change_ledger — a pure append-only ledger: the application only ever INSERTs (recordChange).
-- No forward mutation, no deletion. Full lockdown.
revoke update, delete on change_ledger from app_rw;

-- pursuit_overrides — the divergence RECORD (original_recommendation, human_decision, reason,
-- category, before/after, actor, created_at) is immutable evidence. The ONLY legitimate forward
-- write is the R17 convergence annotation (markOverrideConvergence). So: never delete, and UPDATE
-- only those three annotation columns.
revoke update, delete on pursuit_overrides from app_rw;
grant update (system_converged, converged_at, outcome_id) on pursuit_overrides to app_rw;

-- governed_action_invocations — the request identity + args are immutable audit. A full UPDATE
-- revoke is technically impossible here: the outbox executor legitimately advances an invocation's
-- status (EXECUTING -> EXECUTED/FAILED/COMPENSATED) with its executed_at. So: never delete, and
-- UPDATE only the forward-lifecycle columns the application actually writes (status, executed_at).
revoke update, delete on governed_action_invocations from app_rw;
grant update (status, executed_at) on governed_action_invocations to app_rw;
