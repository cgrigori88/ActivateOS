# Production RLS / FORCE-RLS / cutover status — authoritative record

**Status: UNKNOWN / REQUIRES OPERATOR VERIFICATION.**

This is the single authoritative note on the production database's tenant-isolation
posture. It exists because prior artifacts disagreed and the repository cannot settle the
question.

## What the repository PROVES (code, not environment)

- The DB role is selected **purely from environment variables**: the tenant pool from
  `DATABASE_URL`, the owner pool from `DATABASE_URL_OWNER` — and `getOwnerPool()` **falls
  back to `getPool()` when `DATABASE_URL_OWNER` is unset** (`src/db/client.ts`).
- `withTenant`/`withTenantOrg` set the `app.org_id` GUC per transaction and **fail closed**,
  but are **inert while the app connects as the table owner** (`src/lib/db/tenant.ts` — the
  in-code comment states the app "connects as the table owner, which bypasses RLS").
- Migrations `0058–0062` (RLS foundation) and `0090_force_rls` (FORCE RLS DDL) **exist as
  files**; the app-layer isolation today rests on explicit `where org_id = $` predicates.
- Task **#67** (per-request scoped DB connections / owner-pool cutover) is **still open** and
  is listed as backlog / non-blocking in both readiness reports.

## What the repository CANNOT prove (operator must verify against the live deployment)

1. Which role production's `DATABASE_URL` actually connects as (owner vs `app_rw`).
2. Whether `FORCE ROW LEVEL SECURITY` has been applied on the production database.
3. Whether production's `schema_migrations` tracker has been reconciled (which of
   `0058–0093` are actually applied to prod).

These are **environment facts**, asserted only in `RISK-1-CUTOVER-STATE.md` (a session log).
Do **not** infer them from `.env`, migration files, historical reports, or stale
documentation.

## Reconciliation of conflicting artifacts

| Artifact | Claim | Treatment |
|---|---|---|
| `RISK-1-CUTOVER-STATE.md` | "Cut over & verified on prod; FORCE RLS optional/pending" | **Session log — unconfirmed.** Banner added pointing here. |
| `RISK-1-rls-enforcement-TDD.md` | "Foundation built + blind-verified; cutover gated; app still owner" | Consistent with code. |
| `enterprise-risk-ledger.md` | "RLS present but NOT enforced; app connects as owner; prod flip remains" | Consistent with code. |
| `PILOT-OPERATIONAL-READINESS.md` | "HALTED FOR GO / NO-GO; prod not verified" | **Operative** until operator verifies. |
| `PRODUCTION-COMMISSIONING-REPORT.md` | "app_rw + FORCE RLS VERIFIED LOCALLY; prod BLOCKED — live execution required" | **Operative** — local pass ≠ prod. |

**Bottom line:** local/demo verification of `app_rw` + FORCE RLS is real; **production
commissioning remains BLOCKED and the commissioning halt is preserved.** No production
change is made or claimed by this phase. An authorized operator must run the live
verification and update this file with a dated, evidenced result before any statement other
than UNKNOWN is used.

_Last updated: 2026-08-31 (canonical micro-loop phase — documentation reconciliation only)._
