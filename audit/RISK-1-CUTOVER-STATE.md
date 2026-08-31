> **⚠️ STATUS OF RECORD (2026-08-31): this file is a SESSION LOG of an attempted guided
> cutover, NOT a verified statement of production state.** The repository cannot prove
> which DB role production runs as, whether FORCE RLS is applied on prod, or whether the
> prod migration tracker was reconciled — those are environment facts only an operator can
> confirm against the live deployment. Where this log says the cutover is "done & verified,"
> treat it as **aspirational / unconfirmed**. The authoritative status is
> **UNKNOWN / REQUIRES OPERATOR VERIFICATION** — see `audit/PRODUCTION-RLS-STATUS.md`.
> The `PILOT-OPERATIONAL-READINESS.md` and `PRODUCTION-COMMISSIONING-REPORT.md` "halted /
> blocked" reports remain the operative go/no-go until an operator re-verifies. Do not infer
> production state from `.env`, migration files, or this log.

# RISK-1 / RISK-3 cutover — live state & remaining steps

_Last updated during the guided prod cutover session. Project: PursuitOS
(repo: ActivateOS). Supabase project ref: `sxtwrrckvlohottrdsbr`._

## Status

- **RISK-3 (TLS + password) — DONE.**
  - DB password rotated in Supabase; new value live on Vercel + Railway.
  - verify-full is real: `src/db/client.ts` embeds the **Supabase Root 2021 CA**
    (fingerprint `80:70:25:…:CA:FA`, valid to 2031) and trusts
    `[system roots + embedded root + any valid supplied CA]` with
    `rejectUnauthorized: true`. `DATABASE_CA_CERT` being set is the on-switch;
    the embedded root does the validation (immune to env-var PEM mangling — the
    cause of the two outages this session).
  - Note: Vercel's `DATABASE_URL` string still says `sslmode=no-verify`, but the
    ssl object overrides it, so verification IS happening. Optional cleanup: set
    the string to `verify-full` for honesty (not required).

- **RISK-1 (RLS enforcement) — CUT OVER & VERIFIED ON PROD.**
  - Migrations **0058–0062 applied to prod** (via SQL editor; prod's
    `public.schema_migrations` tracker is stale at 0012, so `npm run db:migrate`
    must NOT be used against prod — it would replay everything). Verified:
    `app_rw` role exists, 53 org-scoped `_rw` policies, 9 cross-tenant,
    36 reference/child, and `app_current_org` / `is_org_member` /
    `resolve_user_org` / `can_see_partnership` / `resolve_api_key` all present.
  - `withTenant` app code merged to `main` (PRs #11, #12) and deployed to prod.
  - **The flip is done:** `app_rw` given a distinct login password;
    `DATABASE_URL_OWNER` (Vercel) = the owner string; **`DATABASE_URL` (Vercel) =
    the `app_rw` string** (`app_rw.sxtwrrckvlohottrdsbr` @ the transaction pooler,
    port 6543). Railway worker unchanged (stays on the owner connection).
    Supabase's transaction pooler **accepts the custom `app_rw` login role** — the
    one unknown, now confirmed.
  - **Prod RLS verification (SQL editor, `grant app_rw to postgres` → `set role
    app_rw` → tested → revoked):** with NO tenant context `select count(*) from
    campaigns` = **0** (RLS denies); with `set app.org_id` to the org = **5**
    (scoped to that org). RLS is enforcing correctly on production.
  - Passwords are role-separated: `DATABASE_URL_OWNER` carries the postgres
    password, `DATABASE_URL` carries a *different* app_rw password (neither
    reveals the other).

## Remaining (optional / when convenient)

- **Two-tenant blind isolation test** — the gold-standard sign-off: two
  Supabase-auth users in two different orgs, each sees only their own data; plus
  an MCP key hitting `/api/mcp`. Needs a second org — run whenever one exists.
- **App-side role readout** (optional): a temporary owner-gated route printing
  `current_user` to show `app_rw` in black and white. Not required — the RLS
  proof above + clean `app_rw` auth already establish it.
- **`FORCE ROW LEVEL SECURITY`** per table — belt-and-suspenders, only after the
  two-tenant test is green.
- **Railway worker** — confirm it's on the post-#12 code (embedded CA) and
  healthy on the owner connection.
- Optional honesty cleanup: set Vercel `DATABASE_URL` sslmode to `verify-full`
  (the embedded-CA ssl object already governs, so cosmetic).

## Historical (pre-flip) — retained for the record

## Remaining: the app_rw flip (do this fresh)

1. **Give `app_rw` a login password** (Supabase SQL editor):
   ```sql
   alter role app_rw with login password '<STRONG_PASSWORD>';   -- save it
   select rolname, rolcanlogin from pg_roles where rolname='app_rw';  -- rolcanlogin = t
   ```

2. **Set `DATABASE_URL_OWNER` = the current owner string** on Vercel + Railway
   (transaction-pooler URI, user `postgres.sxtwrrckvlohottrdsbr`, rotated
   password). Deploy. Verify app still green (this only wires the owner path
   explicitly; `getOwnerPool()` stops falling back).

3. **Flip `DATABASE_URL` → the app_rw string** on Vercel:
   `postgresql://app_rw.sxtwrrckvlohottrdsbr:<APP_RW_PW>@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`
   (same host/port; username `app_rw.<ref>`; sslmode doesn't matter — the
   embedded-CA ssl object governs). Deploy.
   - ⚠️ **Unknown to watch:** whether the Supabase transaction pooler accepts a
     custom login role. If `app_rw` can't authenticate through the pooler, try
     the **session pooler** (port 5432 on the pooler host) or a direct
     connection; if none work through the pooler, the flip may need a different
     approach. Have rollback ready.
   - ⚠️ Future migrations must run with the OWNER string, not app_rw.

4. **Verify green** — every room should render identical data (proven locally:
   full owner-vs-app_rw crawl matched). Any empty room = a reads-not-scoped bug;
   it fails closed (empty), never leaks.

5. **Two-tenant blind test** (with Claude): two Supabase-auth users in two orgs,
   each sees only their own data; test an MCP key hitting `/api/mcp`. Log it as
   the production sign-off.

6. **Optional hardening** (after 5 is green): `alter table … force row level
   security` per table.

## Rollback (any step)
Point `DATABASE_URL` back at the owner string; redeploy. RLS goes inert (owner
bypass), app-layer `where org_id` remains the control. Migrations 0058–0062 are
safe to leave in place.

## The Railway worker
Also runs this code path and connects as the owner for system work. Confirm which
branch Railway deploys and that it has the RISK-3 code before/at the flip; the
worker should keep the OWNER string (or `DATABASE_URL_OWNER`), not app_rw.
