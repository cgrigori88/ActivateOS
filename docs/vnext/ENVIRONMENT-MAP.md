# PursuitOS vNext — Environment Map

**Last updated:** 2026-09-12T02:47Z
**Rule for this file: VERIFIED FACTS ONLY.** Anything unverified is marked
`UNVERIFIED` or `UNKNOWN` with the reason. Never record an inference as a fact.

**No credentials, tokens, passwords, connection strings, or secret values appear in
this file — only variable *names*.** If you are about to add one, don't.

---

## 1. Branch → deployment

| Branch | Role | Verified how |
|---|---|---|
| `claude/activateos-platform-review-xzkgmd` | **Production branch for the `PursuitOS-demo` Vercel project.** A push here triggers a production build. | Vercel dashboard → Settings → Git → Branch Tracking (read during the 2026-09-07 read-only Vercel verification). Note: the setting is *not* labelled "production branch". |
| `main` | Default repo branch. Not the demo's deployment branch. | `git ls-remote` + branch-tracking setting above. |
| `roadmap/pursuitos-vnext` | **vNext lane, created Session 0.** Non-production. Expected to produce Vercel Preview deployments. | Created 2026-09-12 from `97e975f0`. Preview production **UNVERIFIED** — see §6. |
| `docs/infrastructure-recovery-2026-09` | Documentation-only branch. | Pushed 2026-09-07. |
| `ui-wave-2` … `ui-wave-6d`, `design/*`, `demo-commissioning`, `archive/tds-certification-2026-09-04` | Historical. Not deployment targets. | `git ls-remote --heads origin` (19 heads). |

**There is no `vercel.json` in this repository.** All Vercel configuration —
branch tracking, environment-variable scoping, build settings, domains — lives in
the Vercel dashboard and **cannot be verified from the repository.** This is the
single largest source of unverifiable environment facts.

## 2. Deployment → application URL

| URL | Project | Status |
|---|---|---|
| `demo.pursuitos.io` | `PursuitOS-demo` (`prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc`) | **The synthetic demo. This is Monday's demo.** Live: `/` → `307 /login`, `/login` → `200`. Verified 2026-09-07. |
| `app.pursuitos.io` | **Not** the demo project | Treat as production. **DO NOT TOUCH.** |
| Preview URLs | `PursuitOS-demo` previews | Auto-generated per deployment. **UNVERIFIED** for this branch. |

Vercel project IDs are non-secret identifiers (the Supabase project ref likewise
ships in every public API URL) and are recorded deliberately so a new engineer can
target the right project.

**Observed edge behaviour (2026-09-07):** roughly half of requests from a cloud
container returned `403` with `x-vercel-mitigated: deny`, alternating with normal
responses across the two anycast addresses (`64.29.17.65`, `64.29.17.1`). This is a
Vercel edge bot/firewall mitigation against datacenter egress IPs, not application
behaviour. Retries succeed. Expect it when probing from Claude Code Web.

## 3. Environment → database / data source

| Environment | Database | Data | Verified how |
|---|---|---|---|
| `demo.pursuitos.io` (production scope of `PursuitOS-demo`) | Supabase `pursuitos-demo`, ref `qifatlqxfuhwrwvpbwsc`, `ca-central-1`, PG 17.6.1.166 | **SYNTHETIC.** `environment_identity` singleton: `environment='demo'`, `is_synthetic=true`, label "pursuitos-demo — TD SYNNEX walkthrough" | Read-only Supabase audit, 2026-09-07 |
| Local development | Local Postgres `pursuit_demo` (default port 5433) | **SYNTHETIC.** Built by `scripts/demo-db.ts` → `demo-enrich.ts` → `demo-stories.ts`, orchestrated by `seed-demo-world.ts` | `scripts/demo-db.ts` header |
| Verifier runs | Disposable databases per run | Synthetic run-scoped fixtures | `scripts/verify-classes.ts`, `verify-run.ts` |
| vNext preview | **UNKNOWN — see §6. Assume it is the hosted demo database until proven otherwise.** | — | — |

### Canonical synthetic demo facts (certified)

If a reseed produces different numbers, the reseed is wrong — not the numbers.

| Fact | Value |
|---|---|
| Organizations | 3 |
| Companies | 14 |
| Opportunities (total) | 19 |
| **Open opportunities** | **11** |
| **Open pipeline** | **$8,040,000** |
| Weighted open | $3,361,500 |
| Motion value (all motions) | $1,850,000 |
| Pursuits | 14 (all `data_environment='DEMO'`) |

## 4. Write / read permissions

| Actor | Against | Permission |
|---|---|---|
| The deployed app | `pursuitos-demo` Supabase | **Full read/write as `postgres`.** `postgres` is *not* a superuser on Supabase but carries **`BYPASSRLS`**, which also overrides `FORCE ROW LEVEL SECURITY`. All 375 RLS policies are therefore **inert on the application path**; tenant isolation currently rests on application-layer `where org_id` scoping alone. This is open task #67 — see `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md`. |
| `app_rw` (the intended least-privilege runtime role) | `pursuitos-demo` Supabase | Exists, fully granted (152/152 SELECT+INSERT, 149/152 UPDATE/DELETE — the 3 exclusions are the append-only ledgers), **but `NOLOGIN`.** Not in use. |
| Local demo boot | Local `pursuit_demo` | `app_rw` **is** given a login locally by `scripts/demo-db.ts`, for the local boot only. |

> **Documentation clarification.** `audit/DEMO-ITINERARY.md` describes the demo
> environment as "real app under `app_rw` + FORCE RLS". That is accurate for the
> **local** demo environment and **not** for the hosted `demo.pursuitos.io`, which
> runs as `postgres`/`BYPASSRLS`. Two different environments, not a contradiction —
> but the itinerary does not say which one it means, so it reads as a stronger
> claim about the hosted demo than the evidence supports.

## 5. Environment variable names (names only, no values)

Grouped by what they govern. `.env.example` is the tracked template.

**Database**
`DATABASE_URL` · `DATABASE_URL_OWNER` (reserved for task #67; currently unset, which
makes `getOwnerPool()` inert) · `DATABASE_CA_CERT` (the *on-switch* for TLS
verification; the Supabase Root 2021 CA is **embedded in `src/db/client.ts`**, not
read from the env, because a mangled PEM in an env store previously disabled
verification and caused an outage) · `DATABASE_CA_PATH` · `PG_POOL_MAX` ·
`PG_OWNER_POOL_MAX` · `DATABASE_URL_VERIFY`

**Environment identity / posture**
`PURSUITOS_ENV` (declared identity: `public`|`app`|`demo`|`local`; unset ⇒ `local`,
which is never treated as production *or* demo) · `PURSUITOS_BUILT_AT` (baked at
build by `next.config.mjs`) · `OPS_FINGERPRINT_TOKEN` (authorizes `GET /api/build`
without a session)

**Auth / gate**
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both public by design,
inlined into the client bundle) · `SUPABASE_SERVICE_ROLE_KEY` (**secret**, full RLS
bypass) · `BASIC_AUTH_USER` · `BASIC_AUTH_PASS`

**Shipped feature flags** (env master ∧ per-org `org_features`)
`PURSUITS_ENABLED` · `FACTS_ENABLED` · `ROUTING_ENABLED` ·
`PURSUIT_EXPERIENCE_ENABLED` · `FEDERATION_ENABLED` · `GOVERNED_ACTION_ENABLED` ·
`OUTCOME_LEARNING_ENABLED`

**vNext staging flags** (new in Session 0; default OFF everywhere)
`VNEXT_CONTEXT_HEALTH_ENABLED` · `VNEXT_PURSUIT_STATE_ENABLED` ·
`VNEXT_PURSUIT_MEMORY_ENABLED` · `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` ·
`VNEXT_NEXT_BEST_ACTION_ENABLED` · `VNEXT_DYNAMIC_SURFACES_ENABLED` ·
`VNEXT_CONTROL_PLANE_ENABLED`

**Demo tooling**
`DEMO_TARGET_URL` (presence triggers an in-place *guarded* reseed of a hosted DB —
no drop/create) · `DEMO_URL` (read by every layer script) · `DEMO_PGHOST` ·
`DEMO_PGPORT` · `DEMO_DB_NAME` · `DEMO_ADMIN_URL` · `PURSUIT_EMV`

> Three distinct database variables. Do not conflate them: the app and
> `environment-identity.ts` read `DATABASE_URL`; `scripts/demo-db.ts` reads
> `DEMO_TARGET_URL`; every layer script reads `DEMO_URL`. Also: `export A=x B=$A`
> on one line does **not** work — `$A` evaluates before the assignment.

**Sending / comms**
`OUTREACH_AUTOSEND` (**invariant: unset or anything other than the exact string
`on` ⇒ sending disarmed**, per `externalSendingArmed()` in
`src/lib/env/environment.ts`) · `RESEND_API_KEY` (currently **removed** from
`PursuitOS-demo`) · `RESEND_WEBHOOK_SECRET` · `EMAIL_OUTBOUND_DOMAIN` ·
`EMAIL_THREADS_DOMAIN`

**Worker / research / providers**
`WORKER_URL` · `WORKER_CRON` · `RESEARCH_TRIGGER_SECRET` (unset ⇒ endpoint closed,
401) · `ANTHROPIC_API_KEY` · `TAVILY_API_KEY` · `PDL_API_KEY` ·
`BUILTWITH_API_KEY` · `IPINFO_TOKEN` · `CENSYS_PAT` · `CENSYS_ORG_ID` ·
`BACKUP_ENCRYPTION_KEY` · `BACKUP_DIR` · `TELEMETRY_SINK`

**Known documentation gap:** `.env.example` does not list `PURSUITOS_ENV`,
`OPS_FINGERPRINT_TOKEN`, `DATABASE_URL_OWNER`, `BASIC_AUTH_*`, or the shipped
feature-flag variables. The vNext block *was* added in Session 0. Completing the
rest is tracked in `STATUS.md` as documentation debt — deliberately not done in
Session 0 to keep the diff reviewable.

## 6. Preview data-access classification

### Classification: **UNKNOWN**

Per the Session 0 instruction not to infer environment mappings, this cannot be
upgraded from the repository alone.

**What is known.** The 2026-09-07 read-only Vercel verification recorded
`DATABASE_URL` as scoped to **both Production and Preview** on `PursuitOS-demo`.
If that is still true, a Preview deployment connects to the **same hosted demo
Supabase database** that serves Monday's demo — which would be
**`UNSAFE_SHARED_WRITE`**.

**Why it is not simply recorded as UNSAFE_SHARED_WRITE.** That reading came from a
prior session's notes and has not been re-verified; there is no Vercel credential in
the current environment, and `vercel.json` does not exist, so the repository cannot
answer it. Recording an unverified inference as a fact is exactly what this file
forbids.

### Operating rule until this is resolved

- **No writes from any preview deployment.** Read-only exploration only.
- **Do not create or point at a new database**, and do not change any credential.
- **Prefer the local synthetic path** for all Slice 1 development: local Postgres
  `pursuit_demo` seeded by `scripts/seed-demo-world.ts`, which is already
  established, already isolated, and already guarded by `assertSyntheticDatabase`.
- Preview is for **visual review of read-only surfaces**, not for exercising writes.

### To resolve it — read-only, from a context holding credentials

```sh
# 1. What DATABASE_URL does the Preview scope actually have?
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc/env?teamId=$TEAM" \
  | jq '.envs[] | select(.key|startswith("DATABASE_URL")) | {key, target, gitBranch, type}'
```

Note this returns metadata including `target` and `gitBranch`. **Do not decrypt or
print any value.**

```sh
# 2. What is the preview deployment actually reaching? (needs the ops token)
curl -s -H "x-ops-token: $OPS_FINGERPRINT_TOKEN" \
  https://<preview-url>/api/build | jq '{commit, branch, vercelEnv, db: .database}'
```

`/api/build` already reports `database.projectRef` and `host`, so it answers "which
database did this deployment reach" directly.

**Upgrade path to SAFE_ISOLATED:** create a Preview-scoped `DATABASE_URL` pointing
at a separate Supabase project (or a branch database) seeded with the canonical
synthetic world and its own `environment_identity` row. That is a deliberate,
approved infrastructure change — **not** a Session 0 action, and not something to do
before Monday's demo.

## 7. Deployment fingerprint

`GET /api/build` is the authoritative answer to "what is actually deployed". It
returns `environment`, `environmentLabel`, `commit`, `commitShort`, `branch`,
`builtAt`, `deploymentId`, `vercelEnv`, `database.projectRef`, `database.host`, and
posture flags (`externalSendingArmed`, `modelCredentialPresent`). It returns no
secret, no connection string, no tenant data, and no row counts.

Access: an authenticated session **or** the `x-ops-token` header matching
`OPS_FINGERPRINT_TOKEN`. An unauthorized caller receives **404, not 403**, so the
existence of the ops surface is not disclosed.

**Known gap:** it does not report the database *role* the pool connects as — the one
fact task #67's cutover must prove. Adding `database.role` is part of that plan.

## 8. Known risks

1. **Preview write-safety is UNKNOWN** and the prior evidence points at a shared
   demo database. Highest-priority unblock for any slice needing writes. (§6)
2. **The app runs as a `BYPASSRLS` role.** RLS is fully built and fully inert on the
   app path. Task #67. (§4)
3. **Vercel configuration is not in the repository.** Branch tracking, env scoping
   and domains are dashboard-only and cannot be reviewed in a diff or restored from
   Git. (§1)
4. **Live serving SHA is not established.** The production branch head is `97e975f0`
   (Wave 6D); the last independently observed serving SHA was `66f72f61` (Wave 3).
   The 2026-09-12 reconciliation ended **UNRESOLVED** — `/api/build` needs the ops
   token and no Vercel credential was available, while the unauthenticated surface
   is byte-identical across every candidate wave (`globals.css` and
   `components/shell.tsx` are unchanged from Wave 1/2 onward), so it cannot
   discriminate. **Re-establish this before certifying any promotion.**
5. **No managed database backups** on this Supabase plan. Backup depends entirely on
   the application's own nightly job (task #70). Confirm it ran.
6. **Env changes require a redeploy.** Vercel applies environment-variable changes
   only to new deployments. A flag flip on a hosted environment is not live until a
   build completes.
