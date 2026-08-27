# RISK-1 — RLS Enforcement: Technical Design Document

**Status:** design for sign-off — NOT executed. This is task #67, the security
tier's second focused change. Do not attempt as a role flip; it will break the
app. Requires the plumbing below first, then a blind per-policy re-test.

## Why "flip to a non-owner role" fails

- Every RLS policy calls `is_org_member(org)` (0028/0030), whose body is
  `... where m.user_id = auth.uid()`. `auth.uid()` reads the **Supabase Data
  API / PostgREST JWT context.**
- The app does **not** use the Data API. It connects via a raw `pg.Pool` on
  `DATABASE_URL` as the `postgres` role and **never propagates per-request
  identity** to the DB session (no `SET LOCAL`, no `set_config`).
- Consequence: on the app's connection, `auth.uid()` is NULL, so
  `is_org_member()` returns false for every row. If we merely move the app to
  a non-owner role and `FORCE` RLS, **every query returns 0 rows — total
  outage.** 0028's own comment says as much: the policies default-deny the
  Data API, not the app path.

The app's real tenant isolation today is the application-layer `org_id`
filters (now hardened by the FLOW-1/FLOW-2 fixes). RLS is defense-in-depth
that is currently inert on the app path.

## Target design

Make the DB session carry the caller's identity so the existing policies
evaluate correctly, then run the app as a non-owner role with FORCE RLS.

1. **Identity GUC.** Per request, set a transaction-local setting:
   `SET LOCAL app.user_id = '<uuid>'` (and optionally `app.org_id`).
2. **Rewrite the identity function** to read it:
   ```sql
   create or replace function app_user_id() returns uuid language sql stable as
     $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
   ```
   Repoint `is_org_member()` (and the `user_id = auth.uid()` self-policies) at
   `app_user_id()` instead of `auth.uid()`, keeping `auth.uid()` as a
   fallback so the Supabase Data API path still works:
   `coalesce(auth.uid(), app_user_id())`.
3. **Per-request connection checkout.** The shared autocommit pool cannot hold
   a `SET LOCAL`. Introduce a `withTenant(userId, fn)` helper that checks out
   a client, `BEGIN`, `SET LOCAL app.user_id`, runs the callback, `COMMIT`
   (or ROLLBACK). Route tenant reads/writes through it. Keep the owner pool
   only for migrations and the research worker (which is intentionally global).
4. **Non-owner role.** Create `app_rw` (LOGIN, NOINHERIT), `grant select,
   insert, update, delete` on the app tables, `grant usage` on sequences.
   Point `DATABASE_URL` at `app_rw`. It is **not** the table owner, so RLS
   applies.
5. **FORCE where needed.** `alter table <t> force row level security` so even
   a future owner connection is subject to policies.
6. **Policy completeness.** Several tables have SELECT-only policies (the
   0056 additions are `for select`). Add INSERT/UPDATE/DELETE `with check`
   policies for the app_rw role on every table it writes, or the writes fail
   closed. This is the bulk of the work and the reason a blind per-policy
   re-test is mandatory.

## Acceptance — the blind per-policy re-test (foreman rule 1)

Automated, not narrated. For every app table:
- **Positive:** as `app_rw` with `app.user_id` = a member of org A, a
  SELECT/INSERT/UPDATE/DELETE on org A's rows **succeeds**.
- **Negative:** the same operations against org B's rows return/affect
  **0 rows** (or raise on INSERT `with check`).
- **Cross-tenant partnership tables:** rows visible only at the approved
  consent rung; a non-member session sees nothing.
- **Regression:** run the existing verify suites (motions, campaigns,
  initiatives, evidence-shares, ask) end-to-end under `app_rw`; all green.
- **Outage guard:** confirm no core screen returns empty due to a missing
  write/`with check` policy — the failure mode this design most risks.

Cut over only when every table passes both directions.

## Effort & risk

Real project: a migration (function rewrite + role + grants + FORCE +
write policies), a DB-access-layer change (`withTenant`), and a full blind
re-test. High blast radius (a missed grant/policy = outage), which is exactly
why it is isolated from the FLOW fixes shipped now and gated on the re-test.
