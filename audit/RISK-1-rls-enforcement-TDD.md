# RISK-1 — RLS Enforcement: Technical Design Document

**Status:** FOUNDATION BUILT + BLIND-VERIFIED (migration 0058); CUTOVER GATED.
This is task #67, the security tier's second focused change. The DB-layer belt
is now complete and proven in the local DB; it is **inert** (owner still
connects, nothing FORCE'd) and safe to ship. The cutover — running the app as
the non-owner role — is deliberately deferred as its own change because it
needs app-layer plumbing (see "Remaining for cutover"). Do NOT attempt the
cutover as a bare role flip; it will break the app.

## What shipped in this pass (0058), and the evidence

Built and verified, not narrated (raw log: `audit/RISK-1-blind-retest.log`):

- `is_org_member(org)` is now **GUC-aware**: `... where user_id = auth.uid()`
  OR `org = app_current_org()`, where `app_current_org()` reads the
  transaction-local `app.org_id`. This lets trusted server code propagate the
  caller's org without a Data API JWT, and keeps the existing `auth.uid()`
  path working for the Data API.
- A non-owner role `app_rw` (**NOLOGIN**, NOINHERIT, no BYPASSRLS) with
  table/sequence/function grants.
- A uniform `for all to app_rw using (is_org_member(org_id)) with check (...)`
  tenant-isolation policy on **all 53 org-scoped tables** (data-driven, so no
  table is silently left default-denying — the earlier 14-table draft left 38
  tables uncovered, which the first blind re-test caught).

Blind per-policy re-test (as `app_rw` via `SET ROLE`, so NOLOGIN is preserved),
across tables from both the original and newly-covered sets — all pass:

| Check | Result |
| --- | --- |
| Read own org (DEMO): evidence/campaigns/opps/partners/initiatives | 35 / 4 / 4 / 5 / 1 — exact |
| Read as counterpart org: only its rows visible | partners 1, rest 0 |
| No `app.org_id` set → default-deny | 0 rows everywhere |
| Own-org INSERT (initiatives) | succeeds |
| Cross-org INSERT | **blocked — WITH CHECK violation** |
| Cross-org UPDATE (`where org_id = other`) | 0 rows affected |
| **Blanket UPDATE, no WHERE** (a forgotten app-layer filter) | touches only own org's 5 rows; counterpart's row invisible |

The last row is the point of the belt: even an app query that forgets its
`org_id` filter cannot cross tenants once the cutover is done.

Design note — why per-table `app_rw` policies instead of repointing the
existing `auth.uid()` policies (as the original draft below proposed): the
existing policies target the `authenticated` role for the Supabase Data API.
Adding parallel `to app_rw` policies leaves that contract untouched and makes
the app_rw path explicit, rather than broadening 40 existing policies to
`public` and re-verifying the Data API. Tenant isolation is the belt's only
job; role gating (viewer/writer/owner) stays in the app layer
(`requireWrite`/`requireOwner`), so app_rw policies gate on membership alone.

## Remaining for cutover (separate, gated change)

1. ~~**Resolve the caller's org from the authenticated web session**~~ — DONE
   (0059 + `sessionOrgId`). The chicken-and-egg (app_rw can't read org_members
   via auth.uid() before the GUC is set) is solved by `resolve_user_org(uid)`,
   a SECURITY DEFINER function that resolves the org as the owner. Verified
   under app_rw (audit/RISK-1-blind-retest.log, resolver section): a direct
   `organizations` read returns 0 rows, but `resolve_user_org(null)` returns
   the org and, with the GUC set from it, `evidence` becomes visible.
2. ~~**`withTenant` wrapper**~~ — DONE (`src/lib/db/tenant.ts`). `BEGIN` →
   `set_config('app.org_id', …, is_local => true)` → run `fn` → `COMMIT`;
   fails closed if no org resolves. Inert while DATABASE_URL points at the
   owner, so query sites can adopt it with zero behavior change.
3. **Adopt `withTenant` at the query sites** — SWEEP DONE for the tenant data
   path (proven reference: Goals renders full data as app_rw while an
   unmigrated room renders zeros — audit/RISK-1-blind-retest.log). Migrated:
   all data-room pages (25) and server actions (18), the session API routes
   (palette, writebacks, privacy/export, accounts/export), and the app shell
   (layout badges + role). Supporting pieces added:
   - `withTenantOrg(orgId, fn)` — explicit-org variant for the MCP surface
     (org from the API key, not the session).
   - `getOwnerPool()` — the OWNER-POOL SET: paths that can't run as app_rw
     (provisioning/bootstrap login + guest join; member management + any
     `auth.users` read; the research worker; inbound webhooks; the research
     trigger). Inert until DATABASE_URL_OWNER is set at cutover.
   - `runTx(db, fn)` — lets lib functions that managed their own transaction
     accept either a Pool (own txn) or a withTenant client (caller's txn).
   - **0060** — app_rw RLS policies for the CROSS-TENANT consent-ladder tables
     (partnerships/overlap/joint/grants/intros/shares/population_members),
     which 0058's org_id-only loop didn't cover.
   The sweep is NOT blind — it fixed real bugs: the resolver semantics
   (membership-less user), a latent unscoped `partners` dropdown and an
   unscoped `accounts/export`, and it surfaced (flagged, RLS-covered) many
   pre-existing unscoped list reads (Today/analytics/etc.) — see the flagged
   list in the sweep commit.
   REMAINING before cutover: (a) migrate `admin/page.tsx` (owner-only; mixes
   auth.users + cross-tenant + platform-observability reads); (b) a SECURITY
   DEFINER `resolve_api_key(hash)` so the MCP key lookup works off the owner
   role; (c) optionally add app-layer `org_id` filters to the flagged list
   reads (RLS already closes them at cutover — defense in depth).
4. Point `DATABASE_URL` at `app_rw` and `DATABASE_URL_OWNER` at the owner role;
   optionally `FORCE` per table.
5. Re-run the blind per-policy re-test on a real-auth session, then cut over.

Steps 1–2 (the hard architecture) are built + verified; 3 is under way with a
proven reference room; 4–5 are the gated prod flip. Do NOT flip until step 3
covers every room — an unmigrated room shows empty (fails closed, never leaks).

Rollback is trivial: point `DATABASE_URL` back at the owner role — RLS goes
inert again (owner bypass) and the app-layer `org_id` scoping remains the
control. 0058 is safe to leave in place regardless.

---

_Original design (pre-execution) retained below for the record._

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
