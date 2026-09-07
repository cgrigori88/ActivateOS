# PursuitOS — Infrastructure Recovery Runbook

**Written:** 2026-09-07
**Base commit:** `97e975f0d9895c54bfc49cdcc24924d6ac58e796` (Wave 6D)
**Status:** documentation only — no infrastructure was modified to produce this.

This document exists so that a new engineer, or the same engineer with a new
laptop, can rebuild the ability to operate PursuitOS from nothing but this file
plus the secrets held in the team password manager.

> **This file contains no secret values.** It names variables, roles, projects and
> procedures. Every credential is referenced by *name* and by *where it lives*,
> never by value. Nothing in this file should ever be edited to contain a token,
> password, connection string, JWT, or API key. If one ends up here, treat it as
> a disclosed secret and rotate it — do not simply delete the line.

---

## 1. What PursuitOS runs on

| Layer | Provider | Notes |
|---|---|---|
| Web application | Vercel | Next.js, Node 24.x |
| Database | Supabase (managed Postgres 17.6) | primary system of record |
| Background worker | Railway | research pipeline, routines, nightly backup |
| Transactional email | Resend | outbound + inbound webhook |
| Model access | Anthropic API | agents, composer, Ask |
| Source of truth for code | GitHub `cgrigori88/ActivateOS` | |

There is no infrastructure-as-code. Recovery is manual and this document is the
only description of it. Treat that as a known risk, recorded in §11.

---

## 2. Vercel

### 2.1 Projects

| Project | ID | Role |
|---|---|---|
| `PursuitOS-demo` | `prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc` | the synthetic demo deployment |
| `activate-os` | `prj_IBeZWGusMnITGOBxvpGPmSkRGHzU` | earlier project, not the demo |

Other projects exist in the same Vercel account (`pursuitos-web`, `PursuitOS`,
and unrelated projects). **Only `PursuitOS-demo` is in scope for demo work.**
Anything targeting a different project is out of scope by default and needs an
explicit decision.

### 2.2 Domains

| Domain | Points at | Notes |
|---|---|---|
| `demo.pursuitos.io` | `PursuitOS-demo` | the synthetic demo — safe to redeploy |
| `app.pursuitos.io` | **not the demo project** | treat as production; do not touch during demo work |

### 2.3 Git binding

- Repository: `cgrigori88/ActivateOS`
- Production branch for `PursuitOS-demo`: `claude/activateos-platform-review-xzkgmd`
- Configured under **Settings → Git → Branch Tracking** (not under a field
  literally called "production branch"; that naming has caused confusion before).

A push to that branch triggers a production build for `PursuitOS-demo`. Pushes to
any other branch produce Preview deployments.

### 2.4 Environment variables (names and scopes only)

These are the variable *names* the application reads. Values live in the Vercel
env store and in the team password manager — never in Git.

**Database**

| Name | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Production, Preview | the connection the app pool uses. Today: the `postgres` owner role. |
| `DATABASE_URL_OWNER` | *(not currently set)* | reserved for the Task #67 cutover. When set, `getOwnerPool()` uses it for provisioning/system paths while `DATABASE_URL` carries the tenant role. |
| `DATABASE_CA_CERT` | Production, Preview | **on-switch for TLS verification.** Any non-empty value turns on `rejectUnauthorized` against the CA set. The Supabase Root 2021 CA is *embedded in `src/db/client.ts`*, deliberately, because passing a multi-line PEM through an env store mangled newlines and silently disabled verification, causing an outage. Do not try to move it back into the env. |
| `DATABASE_CA_PATH` | optional | alternative CA source for local/self-hosted use |
| `PG_POOL_MAX` | optional | per-instance pool width. Serverless multiplies this by warm-instance count against the DB client ceiling; Supabase session pooler allows 15, so 3 instances × 5 hits it exactly (`EMAXCONNSESSION`). |

**Auth / identity**

| Name | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview (public, ships in the client bundle) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production — **secret**, full RLS bypass |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | Production, Preview — the demo gate |

**Demo control**

| Name | Purpose |
|---|---|
| `DEMO_TARGET_URL` | when set, the demo seeder performs an **in-place guarded reseed** of the named hosted database — no drop/create. Its presence is what makes `scripts/demo-db.ts` target a hosted DB instead of a local one. |
| `PURSUIT_EMV` | demo/live posture flag |

**Email**

| Name | Notes |
|---|---|
| `RESEND_API_KEY` | currently **removed** from `PursuitOS-demo` — outbound sending is disarmed for the demo |
| `RESEND_WEBHOOK_SECRET` | inbound signature verification |
| `EMAIL_OUTBOUND_DOMAIN` | sending domain |

**Model / worker / ops**

| Name | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | model access |
| `WORKER_URL` | HTTP trigger for the Railway worker |
| `WORKER_CRON` | worker internal schedule |
| `OPS_FINGERPRINT_TOKEN` | authorizes `GET /api/build` without a session — see §6 |

> **Env vars are baked at BUILD time on Vercel.** Adding, changing or removing a
> variable has *no effect on the running deployment*. It takes effect only on the
> next build. Every env change in this document therefore implies a redeploy.

---

## 3. Supabase

| Field | Value |
|---|---|
| Project name | `pursuitos-demo` |
| Project ref | `qifatlqxfuhwrwvpbwsc` |
| Organization ID | `lvnwjnvkoekicyfrebol` |
| Region | `ca-central-1` |
| Postgres | 17.6.1.166 (PG 17, GA) |
| Direct DB host | `db.qifatlqxfuhwrwvpbwsc.supabase.co` |
| Pooler host | `aws-0-ca-central-1.pooler.supabase.com` |
| Created | 2026-09-01 |

### 3.1 Connection modes

| Mode | Port | Username form | Use for |
|---|---|---|---|
| Direct | 5432 | `<role>` | migrations, admin, one-off psql |
| Session pooler | 5432 | `<role>.qifatlqxfuhwrwvpbwsc` | long-lived hosts (Railway worker) |
| Transaction pooler | 6543 | `<role>.qifatlqxfuhwrwvpbwsc` | **serverless (Vercel)** — multiplexes many cheap clients over few backends |

The transaction pooler is what the Vercel app should use; the session pooler's
15-client ceiling is what caused `EMAXCONNSESSION` in production.

> **Do not confuse this project with the earlier one.** `audit/RISK-1-CUTOVER-STATE.md`,
> `audit/PRODUCTION-RLS-STATUS.md` and `audit/PRODUCTION-COMMISSIONING-REPORT.md`
> describe Supabase project ref **`sxtwrrckvlohottrdsbr`**, a different project,
> and are marked "UNKNOWN / REQUIRES OPERATOR VERIFICATION". Nothing they assert
> applies to `qifatlqxfuhwrwvpbwsc`. This section was verified read-only on
> 2026-09-07 against the demo project itself.

### 3.2 Database roles

| Role | Login | Superuser | BYPASSRLS | Purpose |
|---|---|---|---|---|
| `postgres` | yes | **no** | **yes** | owns all 152 `public` tables; runs migrations; **currently also the application runtime role** |
| `app_rw` | **no** | no | no | the intended least-privilege application runtime role. Fully granted, not yet enabled. See `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md`. |
| `anon`, `authenticated`, `service_role` | no | no | `service_role` yes | Supabase PostgREST roles. **PursuitOS does not use the Data API**; these exist but are not on the app path. |
| `supabase_admin`, `supabase_*` | — | — | — | platform-managed, do not modify |

Note that `postgres` on Supabase is **not** a superuser. It carries `BYPASSRLS`,
which has the same practical effect on RLS and additionally overrides
`FORCE ROW LEVEL SECURITY`. This is the single fact behind Task #67.

### 3.3 RLS posture (as of this writing)

- 152 ordinary tables in `public`; **all 152** have RLS enabled *and* forced.
- 151 carry at least one policy. The exception is `schema_migrations` —
  RLS on, zero policies, i.e. deny-all to any non-bypass role. Intentional.
- 85 tables carry `org_id`. **All 85** have an `app_rw` policy of
  `is_org_member(org_id)`. None are unscoped.
- The GUC bridge is `public.app_current_org()`:
  `select nullif(current_setting('app.org_id', true), '')::uuid`.
  `is_org_member(org)` returns true when the caller is a member via `auth.uid()`
  **or** when `org = app_current_org()`. The application uses the second arm.

### 3.4 Migrations

- Mechanism: the repository's own runner over `supabase/migrations/*.sql`,
  recorded in `public.schema_migrations` (`filename`, `applied_at`).
  Supabase's native `supabase_migrations.schema_migrations` is **empty and unused** —
  do not "fix" this by adopting the Supabase CLI's table.
- State at time of writing: **102 applied, 102 on disk, filename sets identical.
  Zero drift.** Latest: `0102_environment_identity.sql`.
- The RLS foundation is `0058_rls_enforcement_foundation.sql`, which contains the
  cutover runbook in its footer. `0059` adds `resolve_user_org()`; `0062` adds
  `resolve_api_key()`. Both are `SECURITY DEFINER` and both exist specifically to
  break the "need the org to read the org" cycle under `app_rw`.

### 3.5 Environment identity

`public.environment_identity` is a **singleton row** that names which world a
database is:

```
singleton | environment | is_synthetic | label                                   | established_at
true      | demo        | true         | pursuitos-demo — TD SYNNEX walkthrough  | 2026-09-01
```

`src/lib/env/environment-identity.ts` reads `DATABASE_URL` and asserts against
this row. `assertSyntheticDatabase()` raises `CrossEnvironmentWriteError` if a
synthetic-only script is pointed at a database whose identity says otherwise.
**This is the guardrail that prevents a demo seeder from reaching a real tenant.**
Any new database must get this row before any seeding script is run against it.

### 3.6 Backups

Supabase's plan for this project provides **no automatic backups**. Backup is the
application's own responsibility (task #70): a dump/restore library plus a nightly
run on the Railway worker, and a CLI for on-demand dumps. Verify the nightly job
is actually running before relying on it.

---

## 4. Canonical demo world — reset and rebuild

The demo data is generated, not hand-maintained. It is built by a 10-step recipe
and is reproducible.

**Layer order matters.** Running these out of order produces duplicates that the
verifier will catch but which are tedious to unwind:

1. `scripts/demo-db.ts` — the hero world (Globex virtualization) plus vendor org,
   taxonomy, and the base structures. Honours `DEMO_TARGET_URL` for an in-place
   guarded reseed of a hosted DB (no drop/create).
2. `scripts/demo-enrich.ts` — **breadth**. Adds a synthetic book of business.
   Reuses companies rather than forking them. Deliberately leaves `opps: []` for
   Stark and Acme because the narrative layer owns those deals.
3. `scripts/demo-stories.ts` — **narrative**. *Adopts* rather than appends: it
   UPDATEs the existing opportunity/evidence/propensity rows instead of inserting
   new ones. This is the layer whose "reuse without adoption" regression once
   unlinked flagship deals from their pursuits and zeroed a 34-day silence.
4. `scripts/seed-demo-world.ts` — the orchestrator. Ends in `verify()`, which
   asserts hero singularity, absence of verifier pollution, and no duplicated
   opportunities / same-amount open deals / motions / pursuits / evidence claims /
   propensity scores.

**All layer scripts read `DEMO_URL`.** Note the three different variables and do
not conflate them:

| Variable | Read by |
|---|---|
| `DATABASE_URL` | the application, and `environment-identity.ts` |
| `DEMO_TARGET_URL` | `scripts/demo-db.ts` — triggers hosted in-place reseed |
| `DEMO_URL` | every layer script (`demo-enrich`, `demo-stories`, …) |

Setting them on one shell line (`export A=x B=$A`) does **not** work — `$A`
evaluates before the assignment. Export them on separate lines.

### 4.1 Canonical commercial facts

These are the numbers the demo is certified against. If a reseed produces
different ones, the reseed is wrong — not the numbers.

| Fact | Value |
|---|---|
| Organizations | 3 |
| Companies | 14 |
| Opportunities (total) | 19 |
| **Open opportunities** | **11** |
| **Open pipeline** | **$8,040,000** |
| Weighted open | $3,361,500 |
| Motion value (all motions) | $1,850,000 |
| Pursuits | 14 (all `data_environment = 'DEMO'`) |

### 4.2 Manifest / digest

`scripts/demo-manifest.ts` produces the canonical manifest and its digest. Its
ordering is deterministic as of Wave 6D:

```sql
order by c.legal_name, o.amount_usd desc nulls last, p.use_case, o.name
```

Before Wave 6D the digest was ordering-unstable and returned different values on
repeated runs. If you are comparing digests across machines, note that
JavaScript's `JSON.stringify` and Python's `json.dumps` differ in separators —
Python must use `separators=(',',':')` to reproduce a JS digest.

---

## 5. Verifier suites

33 suites, classified in `scripts/verify-classes.ts` and run by
`scripts/verify-run.ts`.

| Class | Meaning | Count |
|---|---|---|
| `FRESH` | commits its own two-tenant fixtures; destructive; not idempotent | 5 — `experience`, `facts`, `governance`, `pursuit`, `routes` |
| `SEEDED` | reads the canonical demo world; fails on a bare database | 13 — `append-only`, `canonical-microloop`, `interpret`, `lifecycle-acceptance`, `lifecycle-query`, `motion-intel`, `outcome-bridge`, `partner-intel`, `route-persistence`, `scope`, `stakeholder-intel`, `team-motion`, `value-case` |
| `EITHER` | run-scoped fixtures, no reliance on demo content | 14 — `closed-loop`, `contributions`, `disclosure`, `entity-resolution`, `federation`, `governed-mutation`, `isolation`, `observability`, `ops`, `outbox`, `outcomes`, `recompute`, `recompute-recovery`, `tenant-flags` |
| `DEPLOYMENT_ONLY` | needs an environment a container cannot provide | 1 — `migrations-only` |

`EITHER` defaults to a disposable database; `EITHER_ON_SEEDED=1` runs it against
the seeded world instead.

**Never run a `FRESH` suite against the hosted demo database.** They commit
fixtures and assert on exact ids; they will pollute the canonical world and the
`seed-demo-world` verifier will then fail on verifier pollution.

---

## 6. Deployment fingerprint

`GET /api/build` answers "which commit is actually serving this domain" without
fingerprinting CSS. It returns `commit`, `commitShort`, `branch`, `builtAt`,
`deploymentId`, `vercelEnv`, and `database.projectRef` / `database.host`, plus
posture flags. It returns **no secret, no connection string, no tenant data, no
row counts**.

Access requires either an authenticated session or the `x-ops-token` header
matching `OPS_FINGERPRINT_TOKEN`. An unauthorized caller gets **404**, not 403,
so the existence of the ops surface is not disclosed.

Use it — not memory, not the dashboard — to establish what is live before any
change and after any deploy.

> **Known gap, recorded here deliberately:** `/api/build` does not currently
> report the database *role* the pool connects as. That is precisely the fact
> Task #67's cutover has to prove. Adding `database.role` is part of that plan.

---

## 7. Feature flags

Flags compose in two layers (`src/lib/env/tenant-flags.ts`). Enabling a leaf flag
alone does nothing if its parent is off:

```
experience       = pursuits && facts && routing && pursuit_experience
outcomeLearning  = experience && outcome_learning
```

When a screen is unexpectedly empty, check the composition before checking data.

---

## 8. Git

- Default branch: `main`
- Demo production branch: `claude/activateos-platform-review-xzkgmd`
- Certification artifacts live on `archive/tds-certification-2026-09-04`:
  - `audit/TD-SYNNEX-FRIDAY-CERTIFICATION-NOTE.md`
  - `audit/REPOSITORY-RECOVERY-MANIFEST-2026-09-04.md`
  - `audit/restore-backup-tags-2026-09-04.sh` — idempotent tag restore
- Backup tags have been restored to origin and a full bundle was produced.
  A bundle over ~30 MiB must be split for transfer; verify a lossless rejoin
  before trusting a split bundle.

**Known state divergence at time of writing:** the production branch head is
`97e975f0` (Wave 6D) while the last independently observed serving SHA on
`demo.pursuitos.io` was `66f72f61` (Wave 3). Re-establish the serving SHA from
`/api/build` before treating any deployment as certified.

---

## 9. Credentials that must be recreated from secure storage

None of these can be recovered from Git or from this document. Each must come
from the team password manager or be re-minted at the provider.

| Credential | Where it lives | Re-mint at |
|---|---|---|
| Supabase database password (`postgres`) | password manager | Supabase → Settings → Database |
| Supabase `SUPABASE_SERVICE_ROLE_KEY` | password manager | Supabase → API keys (rotating invalidates existing use) |
| Supabase `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env (public anyway) | Supabase → API keys |
| Vercel access token | password manager | Vercel → Account → Tokens. **Scope it to `PursuitOS-demo` only** — the scope dropdown does list individual projects. |
| Supabase management API token | password manager | Supabase → Account → Access Tokens |
| `ANTHROPIC_API_KEY` | password manager | console.anthropic.com |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | password manager | Resend dashboard |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | password manager | chosen by the team |
| `OPS_FINGERPRINT_TOKEN` | password manager | generated locally |
| Railway worker credentials | password manager | Railway |
| GitHub access | personal | GitHub |
| *(future)* `app_rw` password | password manager | generated locally at cutover — see the Task #67 plan |

---

## 10. Recovery order for a new engineer or a new environment

Do these in order. Each step's output is the next step's input.

1. **Repository.** Clone `cgrigori88/ActivateOS`. On macOS expect a case-collision
   warning on checkout; `git checkout -f` resolves it.
2. **Read this file and `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md` before touching
   anything.**
3. **Local database.** Bring up Postgres 17, apply `supabase/migrations/*.sql` in
   filename order via the repo's runner. Confirm `schema_migrations` count equals
   the on-disk file count.
4. **Environment identity.** Insert the `environment_identity` singleton for the
   new database *before* seeding. Without it the synthetic-write guard cannot
   protect you.
5. **Seed.** Run `scripts/seed-demo-world.ts` with `DEMO_URL` pointed at the local
   DB. Confirm its `verify()` passes and the §4.1 canonical facts reproduce.
6. **Verifiers.** `typecheck` → `test` → `EITHER` suites on a disposable DB →
   `SEEDED` suites on the seeded DB → `FRESH` suites on a disposable DB.
   Never `FRESH` against a seeded or hosted database.
7. **Build.** `next build` must pass before any deploy is considered.
8. **Provider access.** Restore credentials from §9 into the local `.env.local`
   (never committed) — Supabase, Anthropic, and only then the optional providers.
9. **Vercel.** Confirm project ID, branch tracking, domain, and the env-var *names*
   in §2.4. Compare against the live project; do not assume.
10. **Verify what is live.** `GET /api/build` with `x-ops-token`. Compare `commit`
    against `git rev-parse origin/claude/activateos-platform-review-xzkgmd`.
    If they differ, resolve that before doing anything else.
11. **Worker.** Confirm the Railway worker is reachable at `WORKER_URL` and that
    the nightly backup ran. Supabase provides none.

---

## 11. Recorded risks

1. **No infrastructure-as-code.** This document is the only description of the
   deployment. It will drift. Re-verify §2.4 and §3 against the providers before
   relying on them.
2. **No managed database backups.** Backup depends entirely on the application's
   own nightly job (§3.6). Confirm it ran.
3. **The application runs as a `BYPASSRLS` role.** RLS is fully built and fully
   inert on the app path. Tenant isolation currently rests on application-layer
   `where org_id` scoping alone. This is Task #67 and it is the highest-value
   remaining hardening item.
4. **Live SHA divergence** between the production branch head and the observed
   serving deployment (§8). Always confirm via `/api/build`.
5. **`DATABASE_URL_OWNER` is not set.** `getOwnerPool()` is therefore inert and
   silently returns the tenant pool. That is correct *today* and would become a
   correctness bug the moment `DATABASE_URL` changes without it. See the Task #67
   plan — this is the single biggest execution hazard of that cutover.

---

*No credential value appears in this document. If you are about to add one, don't.*
