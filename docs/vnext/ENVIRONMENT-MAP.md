# PursuitOS vNext — Environment Map

**Last updated:** 2026-09-14T16:49Z
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
| vNext isolated target | Supabase project ref `mejokqxriwyawfhawuxu`. Initialized via `aws-0-ca-central-1.pooler.supabase.com:5432` (session pooler); **as of 2026-09-14T16:49Z the supplied `DEMO_TARGET_URL` parses to the same host on `:6543` (transaction pooler)** — parsed only, never printed. Supplied to vNext sessions as `DEMO_TARGET_URL`. | **SYNTHETIC.** `environment_identity` singleton: `environment='demo'`, `is_synthetic=true`, label "pursuitos-vnext — isolated synthetic preview". Migrated **103/103** (0103 applied 2026-09-14T16:49Z); canonical world seeded and reconciled exactly (manifest digest `be0da833990ce436`); Slice 2A Globex plan layer installed (1 goal · 1 plan · 1 recommendation · 0 decisions). ~~Known defect: no pursuit team~~ **Fixed and reseeded 2026-09-14 (`6ab3599`): 5 canonical team requirements, 45 team members, Globex ledger 10 — the world now matches a fresh local build table for table (§10, "team layer repaired").** **Not yet connected to any Vercel scope.** | `migrate.ts`, `environment-identity.ts --set demo` + read-back, `seed-demo-world.ts` `verify()`, `demo-manifest.ts`, read-only reconciliation — from a laptop, 2026-09-14T02:59Z; 0103 + plan layer, 2026-09-14T16:49Z. See §10 |
| vNext preview (Vercel scope) | **UNKNOWN — see §6. Assume it is the hosted demo database until proven otherwise.** No Preview-scoped `DATABASE_URL` has been created. | — | — |

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
| The deployed app | `pursuitos-demo` Supabase | **Full read/write as `postgres`.** `postgres` is *not* a superuser on Supabase but carries **`BYPASSRLS`**, which also overrides `FORCE ROW LEVEL SECURITY`. All 375 RLS policies are therefore **inert on the application path**; tenant isolation currently rests on application-layer `where org_id` scoping alone. This is open task #67. H1A (2026-09-14) made that application-layer scoping explicit on every audited path; the cutover itself is H1B — design in `H1-PRE-PILOT-HARDENING.md` § H1B (runbook history: migration 0058 footer, `audit/RISK-1-CUTOVER-STATE.md`, `audit/PRODUCTION-RLS-STATUS.md`; the previously cited `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md` does not exist). |
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
`VNEXT_NEXT_BEST_ACTION_ENABLED` (reserved, unimplemented) · `VNEXT_DYNAMIC_SURFACES_ENABLED` ·
`VNEXT_CONTROL_PLANE_ENABLED` · `VNEXT_PURSUIT_COORDINATION_ENABLED` (Slice 2A) ·
`VNEXT_PURSUIT_ATTENTION_ENABLED` (Slice 2B; requires coordination — **not set on any
hosted scope**)

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

### Classification: **ISOLATED_SYNTHETIC_LEAST_PRIVILEGE** — RESOLVED 2026-09-16 (Gate 9)

> **FACTUAL CORRECTION, 2026-09-16.** This section read **UNKNOWN** and warned that the Preview might
> share `DATABASE_URL` with the Monday demo and therefore be `UNSAFE_SHARED_WRITE`. **That is no longer
> the state of the world, and the warning below is retained only as the historical record of how it was
> reasoned about before credentials were available.** H1B Gates 1–8, D-G5-1, D-G8-1 → D-G8-5 and D-P1
> resolved it with direct, credentialed, read-only evidence:
>
> - The branch `roadmap/pursuitos-vnext` has its **own branch-scoped** `DATABASE_URL` (one of 18
>   branch-scoped Preview entries), pointing at Supabase **`mejokqxriwyawfhawuxu`** — **not**
>   `qifatlqxfuhwrwvpbwsc`, the demo project. The two are different databases.
> - That database's `environment_identity` singleton reads `environment='demo'`,
>   `is_synthetic=true`, label **"pursuitos-vnext — isolated synthetic preview"**.
> - The Preview runtime connects as **`app_rw`**, a least-privilege LOGIN role with **BYPASSRLS false**,
>   so RLS binds on all 155 tables (FORCE RLS on, 380 policies). `DATABASE_URL_OWNER` holds the owner
>   string separately for owner-only paths. `/api/build` reports role `app_rw`, `bypassRls false`,
>   `tenantEnforcement true`, `probe live`.
> - Tenant isolation is certified (`tenant-isolation` 205/0, `partnership-app-rw` 117/0, app_rw
>   rehearsal 38/38 + 6/6) and repeatedly re-proven by hosted 37-room crawls.
>
> **Consequence for `B-a`–`B-c` below:** they remain literally true as statements about the
> *application layer*, but the risk they bounded no longer exists, because isolation is enforced at the
> **database and credential layer** instead — a separate project, a separate credential, and RLS that
> binds. `B-d` (a build performs no database access) and `B-e` are unchanged.

<details><summary>Historical reasoning, superseded 2026-09-16 — kept for the record</summary>

### Classification (superseded): **UNKNOWN** — re-confirmed 2026-09-12, not resolvable from there

Per the Session 0 instruction not to infer environment mappings, this cannot be
upgraded from the repository alone. The 2026-09-12 preview-isolation session
re-attempted it and **found no credential of any kind** in the execution
environment (checked by variable *name* only; no value was read):
`VERCEL_TOKEN`, `VERCEL_API_TOKEN`, `VERCEL_OIDC_TOKEN`, `VERCEL_TEAM_ID`,
`OPS_FINGERPRINT_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`, `BASIC_AUTH_*` — **all unset.** No Vercel CLI, no Supabase CLI,
no `~/.vercel` auth state. Only a GitHub token is present.

### What the repository CAN prove — and it is not reassuring

These are new findings from the 2026-09-12 session. They do not change the
classification; they establish that **if** Preview turns out to share
`DATABASE_URL`, there is no application-layer mitigation.

| # | Verified fact | How |
|---|---|---|
| B-a | **`VERCEL_ENV` has no behavioural gate.** It is read in exactly one place in `src/` — `buildInfo()` in `src/lib/env/environment.ts:117` — and only for reporting. The application therefore **cannot distinguish a Preview deployment from Production at runtime.** | `grep -rn VERCEL_ENV src/` → one hit |
| B-b | **`assertSyntheticDatabase` does not protect the demo database.** It refuses only when a database is *not* marked synthetic. The hosted demo DB is marked `environment='demo'`, `is_synthetic=true`, so the guard **passes** for it. Its threat model is "operator reseeds production by accident", not "preview writes to the demo". | `src/lib/env/db-identity.ts:110-151` |
| B-c | **Real write paths exist.** 22 files declare `"use server"`. There is no read-only mode and no env switch that would impose one. | `grep -rln '"use server"' src/` |
| B-d | **A Vercel build performs no database access.** Every application route compiles as `ƒ` (dynamic, server-rendered on demand); the only prerendered route is `/icon.svg`. Database access therefore requires a **served request**, not a build. | `npm run build` route table, 47 × `ƒ`, 1 × `○` |
| B-e | **Zero deployment configuration in the repository.** No `vercel.json`, no `.vercelignore`, no `.github/` directory at all. Branch tracking, env scoping and domains remain dashboard-only. | `ls` / `find` |

**Consequence.** `B-d` bounds the risk usefully: a preview that nobody opens has
touched nothing. `B-a`–`B-c` mean that a preview somebody *does* open, if it
shares `DATABASE_URL`, is an unrestricted second write-capable client of the
database that serves Monday's demo. Hence the operating rule below is unchanged
and the preference is still the local synthetic path.

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

</details>

### Operating rule — SUPERSEDED 2026-09-16

The rule below governed the period when the classification was UNKNOWN. It is **superseded** by the
certified posture above: the Preview writes only to the isolated synthetic project
`mejokqxriwyawfhawuxu`, as `app_rw` under binding RLS. The *forbidden* target is
`qifatlqxfuhwrwvpbwsc`, which every hosted tool guards against by identity check before connecting.

<details><summary>Superseded operating rule — kept for the record</summary>

- **No writes from any preview deployment.** Read-only exploration only.
- **Do not create or point at a new database**, and do not change any credential.
- **Prefer the local synthetic path** for all Slice 1 development: local Postgres
  `pursuit_demo` seeded by `scripts/seed-demo-world.ts`, which is already
  established, already isolated, and already guarded by `assertSyntheticDatabase`.
- Preview is for **visual review of read-only surfaces**, not for exercising writes.

</details>

### How it was resolved — read-only, from a context holding credentials

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
   **2026-09-14:** Today, Queue and the account drawer are now tenant-scoped explicitly in every
   query (D-041), so they no longer depend on RLS. A leak on exactly this path was found and
   fixed: a guest org's Today listed another org's items and pipeline. Every other room is still
   unaudited and still relies on RLS that does not run.
3. **Vercel configuration is not in the repository.** Branch tracking, env scoping
   and domains are dashboard-only and cannot be reviewed in a diff or restored from
   Git. (§1)
4. **Live serving SHA is not established.** The production branch head is `97e975f0`
   (Wave 6D); the last independently observed serving SHA was `66f72f61` (Wave 3).
   Two reconciliation attempts have now ended **UNRESOLVED** (2026-09-12 morning,
   and again in the afternoon preview-isolation session). **Re-establish this
   before certifying any promotion.** §9 records why every available avenue is
   exhausted without a credential.
5. **No managed database backups** on this Supabase plan. Backup depends entirely on
   the application's own nightly job (task #70). Confirm it ran.
6. **Env changes require a redeploy.** Vercel applies environment-variable changes
   only to new deployments. A flag flip on a hosted environment is not live until a
   build completes.
7. **Claude Code Web cannot reach any Postgres.** Outbound TCP to 5432/6543 times
   out and HTTPS to `api.supabase.com` is refused by the egress policy, so *no*
   hosted database can be marked, migrated, seeded, or even read from that
   environment. The canonical seed path has no HTTPS fallback. (§10)
   **Scope correction, 2026-09-14T02:44Z:** this is a property of Claude Code Web
   **only**. From a laptop the same host, both pooler ports, and the direct host
   all connect. Egress is no longer the blocker for the vNext target — risk 8 is.
8. **The supplied `DEMO_TARGET_URL` credential is rejected by `mejokqxriwyawfhawuxu`.**
   `28P01 password authentication failed`, identically from the session pooler, the
   transaction pooler, and the direct host — three independent endpoints, one of
   which bypasses Supavisor entirely. The project resolves and answers; only the
   password is wrong. **Nothing can be migrated, marked, or seeded until it is
   replaced.** (§10)
   **RESOLVED 2026-09-14T02:59Z:** replaced by the owner; the target is now
   migrated, marked `demo` / `is_synthetic=true`, seeded, and reconciled. (§10)
9. **The isolated database is not yet what Preview reads.** It exists and is
   correct, but no Vercel scope points at it, and the Preview scope's current
   `DATABASE_URL` is still UNKNOWN (§6). Until the branch-scoped Preview
   variable exists and `/api/build` reports `mejokqxriwyawfhawuxu`, a preview of
   `roadmap/pursuitos-vnext` must be assumed to read the demo database.
10. **The in-place reseed path silently drops the pursuit-team layer** (found
    2026-09-14T16:49Z). `demo-db.ts` truncates `pursuit_team_requirements`, whose
    only rows come from migration 0075, and never replays migrations. Any hosted
    database seeded in place therefore has no pursuit team, and nothing in
    `verify()` or the manifest notices. This includes `mejokqxriwyawfhawuxu`, and
    would include the Monday demo database if it was ever reseeded in place
    (**UNVERIFIED** for that database — not queried). (§10)
    **FIXED in code 2026-09-14 (`6ab3599`)** — the canonical seed now
    re-establishes the five global requirements on both paths — and
    `mejokqxriwyawfhawuxu` has been reseeded with the fix (§10, 21:08Z). **Still
    open:** any *other* database seeded in place before the fix keeps the
    defect until it is reseeded. Whether that includes the Monday demo database
    remains **UNVERIFIED**; it was not queried, per standing instruction.

---

## 9. Live serving SHA — avenues attempted and exhausted (2026-09-12)

Recorded so no future session repeats the search. **Every unauthenticated avenue
is closed by design**, which is the fingerprint endpoint working correctly rather
than a gap.

| Avenue | Result | Evidence |
|---|---|---|
| `GET /api/build` unauthenticated | **404**, 3 of 3 attempts, 2026-09-12T14:06Z | Matches the deliberate "unauthorized sees 404, not 403" behaviour in `src/app/api/build/route.ts`, so the ops surface is not even disclosed. `/login` returned 200 on all three, so the site is up and the 404 is the route's own gated answer. |
| Response headers | **No deployment identifier.** Only `x-vercel-id` (a request trace: region, instance, timestamp), `x-matched-path`, `x-vercel-cache`, `server: Vercel`. | `curl -D -` on `/login` |
| Build timestamp via the public bundle | **Not exposed.** `PURSUITOS_BUILT_AT` is declared in `next.config.mjs` `env` but referenced only by `buildInfo()`, which only `/api/build` reads. It appears in no client asset. | `grep` of `.next/static`; `grep -rn builtAt src/` → 3 hits, all server-side |
| Next.js build ID from the served HTML | **Useless as an identifier.** The `"b":"…"` field in the Flight payload is regenerated per build: two builds of *identical* source produced `wyCPcIZJxOVIwnltMzZ_F` and `2RyJvXvWhQyOe7oANYuPP`. It cannot be mapped to a commit. | Observed 2026-09-12 during the GATE C flag-OFF comparison |
| CSS / asset fingerprinting | **Already invalidated.** The unauthenticated surface is byte-identical across every candidate wave; `globals.css` and `components/shell.tsx` are unchanged from Wave 1/2 onward. This is the method `/api/build` exists to retire. | 2026-09-12 morning reconciliation |
| GitHub deployment records | **Unavailable.** The GitHub MCP server exposes no deployments or commit-statuses endpoint, and `get_commit` on `97e975f0` returns commit data only — no deployment metadata. `get_check_run` needs a numeric id that nothing here supplies. There is no `.github/` directory, so no Actions run records either. | `mcp__github__get_commit`, tool inventory |
| Vercel REST API | **No credential.** See §6. | env presence check |

### The only two paths that can resolve it

Both require a credential this environment does not hold. Neither involves a
deploy.

```sh
# A · fastest — one read-only request, needs OPS_FINGERPRINT_TOKEN
curl -s -H "x-ops-token: $OPS_FINGERPRINT_TOKEN" \
  https://demo.pursuitos.io/api/build \
  | jq '{commit, commitShort, branch, builtAt, deploymentId, vercelEnv, db: .database}'
```

```sh
# B · also answers the Preview question in the same pass, needs VERCEL_TOKEN
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc&target=production&limit=3&teamId=$TEAM" \
  | jq '.deployments[] | {uid, url, state, target, sha: .meta.githubCommitSha, ref: .meta.githubCommitRef, created}'

curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v10/projects/prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc/env?teamId=$TEAM" \
  | jq '.envs[] | select(.key|startswith("DATABASE_URL")) | {key, target, gitBranch, type}'
```

A third option, entirely in the owner's hands and needing no token: **open
`demo.pursuitos.io`, sign in, and visit `/api/build`** — an authenticated session
is accepted, and the response contains no secret.

**Do not decrypt or print any environment-variable value.** The `target` and
`gitBranch` metadata is what answers §6; the value is not needed and must not be
read.

---

## 10. The vNext isolated target (2026-09-14)

A `DEMO_TARGET_URL` was supplied to the vNext session environment for the first
time. **Its value was never read, printed, or recorded**; only the non-secret
identity it declares is below, obtained through the repository's own
`databaseIdentity()` parse (`src/lib/env/environment.ts`), surfaced by the
read-only form of `scripts/environment-identity.ts`.

| Fact | Value | How |
|---|---|---|
| Project ref | **`mejokqxriwyawfhawuxu`** | `scripts/environment-identity.ts` printed `target : project mejokqxriwyawfhawuxu` |
| Host | `aws-0-ca-central-1.pooler.supabase.com` | same parse |
| Port | `5432` — the **session** pooler, not the transaction pooler (6543) | same parse |
| Is it the Monday demo? | **NO.** `mejokqxriwyawfhawuxu` ≠ `qifatlqxfuhwrwvpbwsc` | direct comparison |
| Branch of the demo project, or an independent project? | **UNVERIFIED.** Distinguishing the two needs a dashboard or Management-API read. Either way the ref differs, and a Supabase branch is a physically separate database. | — |
| Credential validity | **VALID as of 2026-09-14T02:59Z** (the owner's fresh credential; the 02:44Z one was rejected `28P01`). *At 02:16Z it was unverified — the connection never completed.* | Authenticated through a raw `pg` client and the app's own `getPool()`; every sequence step succeeded |

### Its environment identity is UNREADABLE, not UNMARKED

`scripts/environment-identity.ts` reported `CANNOT READ` with
`Connection terminated due to connection timeout`. Per that script's own
doctrine, reporting this as UNMARKED would be a confident lie — it describes the
connection, not the database. **The marker state on that database remains
genuinely unknown.**

### Why: this execution environment has no Postgres egress

Proven, not inferred, 2026-09-14:

| Probe | Result |
|---|---|
| DNS for `aws-0-ca-central-1.pooler.supabase.com` | resolves — `15.156.180.136`, `15.156.188.226` |
| TCP connect to that host **:5432** | **TIMEOUT** |
| TCP connect to that host **:6543** | **TIMEOUT** |
| HTTPS to `api.supabase.com` | **refused by the egress proxy** — `connect_rejected (organization policy)` |

DNS resolving while both Postgres ports black-hole is the signature of a port
policy, not of a bad credential: an authentication failure returns a distinct
error, and none was ever reached. The network policy is the environment's, and
it was **not** worked around.

### Consequence — the canonical seed path has no HTTPS fallback

This is the durable finding, and it is the one that decides *where* the vNext
database can be initialized:

- `scripts/db-remote.ts` runs SQL over the Supabase Management API, so it works
  "anywhere HTTPS works" — but it executes **plain SQL files only**, and it needs
  `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`, **both unset here**.
- `scripts/generate-seed-sql.ts` emits SQL for the **knowledge base** (ontology +
  play templates) only. It does not, and is not meant to, emit the demo world.
- The canonical world is built by the ten TypeScript layer scripts in
  `scripts/seed-demo-world.ts`, which call application code
  (`promoteFromSignal`, `recomputeRoute`, `assembleTeam`, the governed
  stakeholder path …) over a live `pg` pool.

**So seeding requires direct Postgres egress from wherever it runs.** Migrations
alone could travel over the Management API; the world cannot.

### The exact invocation, derived from the code (not guessed)

Recorded so the next session with egress does not re-derive it. `--set` takes its
value as the **next** argv entry, and the three database variables are distinct —
`demo-db.ts` reads `DEMO_TARGET_URL`, the nine layer scripts read `DEMO_URL`, and
`environment-identity.ts` / `migrate.ts` / `verify()` read `DATABASE_URL`.

```sh
# 0 · read-only identity gate — confirm the ref is NOT qifatlqxfuhwrwvpbwsc
DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/environment-identity.ts

# 1 · schema. demo-db.ts REFUSES a partially-migrated target by design
DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/migrate.ts

# 2 · mark synthetic BEFORE seeding (assertSyntheticDatabase refuses an unmarked target)
DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/environment-identity.ts \
  --set demo --label "pursuitos-vnext — isolated synthetic preview"

# 3 · read back: expect environment=demo, is_synthetic=true
DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/environment-identity.ts

# 4 · seed. ALL THREE variables, same target — see the trap below
DEMO_TARGET_URL="$DEMO_TARGET_URL" DEMO_URL="$DEMO_TARGET_URL" \
DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/seed-demo-world.ts

# 5 · canonical reconciliation
DEMO_URL="$DEMO_TARGET_URL" npx tsx scripts/demo-manifest.ts
```

> **The trap worth the sentence.** Setting only `DEMO_TARGET_URL` would seed the
> hosted target at step 1 of the recipe and then let the nine layer scripts fall
> back to their default `127.0.0.1:5433` — writing the rest of the world into a
> *different* database while `seed-demo-world.ts` printed `ok` for every step.
> `verify()` would then pass or fail against whichever database `DEMO_URL`
> resolved to. This is the conflation §5 already warns about, in its most
> expensive form.

**Step 2 is the only write in the sequence, and it was never run.** Had it been,
it would have refused on its own terms: `environment-identity.ts` exits non-zero
when the existing identity is `unreadable`, precisely so a typo'd or unreachable
connection cannot stamp an identity onto whatever it actually reached.

### What this does and does not change

- `PREVIEW-ISOLATION-PLAN.md` **Option 1** ("an existing isolated demo-safe
  Supabase project · CANNOT CONFIRM") is now **partially answered**: a second
  project ref exists and has been designated the vNext target. Whether it is
  empty, migrated, or marked is still unknown.
- §6's classification of the **Vercel Preview scope** is **unchanged and still
  UNKNOWN**. Nothing was added to any Vercel scope, and possessing an isolated
  database does not by itself isolate Preview — that is still the one additive
  env var in Option 2 step 5.
- The Monday demo project `qifatlqxfuhwrwvpbwsc` was **not contacted** in any
  way during this session.

### 2026-09-14T02:44Z — re-run from a laptop: egress resolved, credential rejected

The sequence above was re-attempted from a local machine specifically because
Claude Code Web has no Postgres egress. **That blocker is gone. A different one
replaced it, and it is not one this session can clear.**

| Probe (all against `mejokqxriwyawfhawuxu`, never the demo) | Result |
|---|---|
| `scripts/environment-identity.ts` read-only gate | `target : project mejokqxriwyawfhawuxu` — **ref confirmed, and confirmed ≠ `qifatlqxfuhwrwvpbwsc`** |
| …its identity read | `CANNOT READ` — `password authentication failed for user "postgres"` |
| Session pooler `…pooler.supabase.com:5432`, user `postgres.<ref>` | **`28P01`** |
| Transaction pooler `…pooler.supabase.com:6543`, user `postgres.<ref>` | **`28P01`** |
| Direct `db.<ref>.supabase.co:5432`, user `postgres` | **`28P01`** |

**Why this is a credential fact, not a connection fact.** All three endpoints
completed TCP and TLS and returned a *Postgres* error code. The direct host does
not go through Supavisor at all, so the pooled-username convention is not
implicated. Supavisor returns `Tenant or user not found` for an unknown project
ref; it did not — the tenant resolved. The only remaining variable is the
password.

**The connection string itself was also cleared of blame, without reading it.**
Its structure was parsed twice — by WHATWG `URL` and by `pg-connection-string`,
the parser `pg` actually uses — and both agree on host, port, user and database.
The password round-trips byte-identically through both (no percent-encoding, no
characters that either parser treats specially) and its component lengths account
for the whole string exactly, so nothing was truncated at a `#` or `?`. **The
value was never printed, logged, written to disk, or recorded anywhere.**

### What this changes

- `STATUS.md`'s **vNext isolated database** row stays **BLOCKED**, but the reason
  changes from *"needs an execution context with Postgres egress"* to
  **"needs a working credential"**. The execution context is now correct.
- The five-command sequence above is **unchanged and still the recipe.** It was
  not run past step 0. **Nothing was written to any database.**
- The three-variable trap is still the trap, and was still respected: every
  command in the 2026-09-14 local session bound `DATABASE_URL`,
  `DEMO_TARGET_URL` and `DEMO_URL` to the same value, so no layer could have
  fallen back to `127.0.0.1:5433`.

### The unblock, in the owner's hands

Supabase dashboard → project `mejokqxriwyawfhawuxu` → **Settings → Database →
Reset database password**, then re-export `DEMO_TARGET_URL` with the new password
and re-run the sequence from step 0. The gate at step 0 is the proof that it
worked: it must print `environment`/`is_synthetic` instead of `CANNOT READ`.

Two things worth checking on that same dashboard visit, because they cost nothing
extra and both are still open: whether `mejokqxriwyawfhawuxu` is a **branch** of
the demo project or a standalone project (§10 opening table), and whether the
Preview scope of `PursuitOS-demo` carries its own `DATABASE_URL` (§6).

### 2026-09-14T02:59Z — attempt 3: INITIALIZED, MARKED, SEEDED, RECONCILED

The owner replaced `DEMO_TARGET_URL` with a fresh credential and the sequence
above was run, **unchanged**, from the same laptop. **Its value was never
printed, logged, written to disk, or recorded anywhere**; every command's output
was piped through a filter that strips the URL and its password, and that filter
never had to redact anything.

**Pre-conditions, checked by variable name only.** `DEMO_TARGET_URL` set.
`DATABASE_URL`, `DEMO_URL`, `DATABASE_URL_OWNER`, `DEMO_ADMIN_URL`,
`DEMO_PGHOST`, `DEMO_PGPORT`, `DEMO_DB_NAME`, `OUTREACH_AUTOSEND`,
`RESEND_API_KEY` all **unset**. No `.env*` file other than `.env.example`, and
no local listener on 5432/5433/6543 — so no fallback target existed for any
script to drift to.

| Step | Result |
|---|---|
| Gate · ref | parsed user `postgres.mejokqxriwyawfhawuxu` @ `aws-0-ca-central-1.pooler.supabase.com:5432`, db `postgres`. The string does not contain `qifatlqxfuhwrwvpbwsc` anywhere |
| Gate · not the demo | `mejokqxriwyawfhawuxu` ≠ `qifatlqxfuhwrwvpbwsc` — **passed** |
| Gate · authentication | **passed** — see the note on one transient `28P01` below |
| State before any write | **empty**: 0 tables in `public`, no `schema_migrations`, no `environment_identity`. PG 17.6; Supabase `auth` / `storage` / `extensions` schemas present |
| 1 · `migrate.ts` | **102 applied, 0 already tracked**, exit 0 — `0001` … `0102_environment_identity.sql` |
| 2 · `environment-identity.ts --set demo` | `marked project mejokqxriwyawfhawuxu as environment="demo" is_synthetic=true label="pursuitos-vnext — isolated synthetic preview"` |
| 3 · read back | `environment demo` · `is_synthetic true` · established `2026-09-14T02:56:52Z` |
| 4 · `seed-demo-world.ts` (all three vars → same target) | **10/10 layers ok**, `verify()` **17/17 ok** (10 hero accounts exactly once, no fixture pollution, no duplicated opportunities / same-amount open deals / motions / pursuits / evidence / propensity scores), exit 0. In-place mode — `demo-db.ts` issued no `DROP`/`CREATE DATABASE` |
| 5 · reconciliation | below — **exact** |
| Final identity re-read | project `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true` |

**Canonical reconciliation**, read-only against the target:

| Fact | Expected | Observed |
|---|---|---|
| Organizations | 3 | **3** |
| Companies | 14 | **14** |
| Opportunities | 19 | **19** |
| Open opportunities | 11 | **11** |
| Open pipeline | $8,040,000 | **$8,040,000** |
| Pursuits | 14 | **14** (14/14 `data_environment='DEMO'`) |
| `schema_migrations` rows | 102 | **102** |

`scripts/demo-manifest.ts` produced digest **`be0da833990ce436`**, identical to
the certified `audit/canonical-demo-world.json`. Tenants, the four headline
figures (goal $5,000,000 · motion $1,250,000 · goal-linked open $4,920,000 ·
whole-book open $8,040,000), all fifteen row counts and the 22 hero rows match.

**Send safety.** `messages` 0 rows (0 outbound, 0 queued, 0 sent, 0 with a
provider id), `email_events` 0, `sending_identities` 0. `OUTREACH_AUTOSEND` and
`RESEND_API_KEY` unset in the shell that ran every step, so
`externalSendingArmed()` is false and `apiKey()` in `src/lib/comms/resend.ts`
would throw before any request.

**The one transient `28P01` — observed, and not over-explained.** The very first
raw probe returned `28P01`; the repository's own identity read, seconds later
and with the same string, reached the database. Nothing was written until the
disagreement was resolved: four consecutive raw probes and one through the app's
TLS-verifying `getPool()` then all authenticated, as did every later command.
*Plausible, **unverified**:* the new password had not yet reached every
Supavisor node (the regional hostname resolves to two addresses). Practical
consequence for the Vercel step: a freshly reset password can fail briefly —
retry before concluding it is wrong.

**Still open, unchanged by this:** whether `mejokqxriwyawfhawuxu` is a branch or
a standalone project (opening table), and the Vercel Preview scope's
`DATABASE_URL` (§6). The Monday demo `qifatlqxfuhwrwvpbwsc` was **not
contacted** — not even to prove it was unchanged.

### 2026-09-14T16:49Z — Slice 2A schema + Globex plan installed; a pre-existing world defect found

Run from the same laptop against `mejokqxriwyawfhawuxu` only. Full record:
`SESSION-HANDOFF.md` § "Slice 2A hosted promotion".

**Database-variable binding, re-derived from the code for this run.**
`migrate.ts` and `environment-identity.ts` → `getPool()`/`getOwnerPool()` →
`DATABASE_URL`; `demo-plan-story.ts` and `demo-manifest.ts` → `DEMO_URL`; both
verifiers → `DATABASE_URL_VERIFY ?? DEMO_URL`; every script falls back to
`127.0.0.1:5433` otherwise, and `src/lib/db/tenant.ts` reaches `getPool()`. So
every command bound **`DATABASE_URL`, `DEMO_URL`, `DATABASE_URL_VERIFY` and
`DEMO_TARGET_URL`** to the same value, with every other database and `PG*`
variable unset and no local listener — nothing could drift.

**Connection.** The supplied string now parses to
`aws-0-ca-central-1.pooler.supabase.com:6543` — the **transaction** pooler — as
user `postgres.mejokqxriwyawfhawuxu`. Every script here keeps each transaction
on one client, so all ran unchanged.

| Fact | Value |
|---|---|
| Gate | `project mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true` — before any write and again at the end |
| `schema_migrations` | 102 → **103** (`0103_pursuit_coordination.sql`, additive) |
| Plan layer | 1 `pursuit_goals` (PROPOSED, route-free objective) · 1 `pursuit_plans` (PROPOSED, linked) · 1 `pursuit_plan_revisions` (RECOMMENDATION, SYSTEM) · 0 decisions |
| Canonical | 3 · 14 · 19 · 11 open · $8,040,000 · 14 (14/14 `DEMO`); digest `be0da833990ce436` before and after |
| Send | `messages` / `action_outbox` / `email_events` / `sending_identities` = 0 throughout |

**The defect: the hosted world has no pursuit team.** `pursuit_team_requirements`
0 rows, `pursuit_team_members` 0 rows, `TEAM_CHANGED` ledger rows 0; Globex's
ledger is 9 rows where a local rebuild has 10. `scripts/demo-db.ts` in-place
mode truncates tables that carry `org_id`, and names `pursuit_team_requirements`
as one of them (`demo-db.ts:300`). But the only rows that table ever holds are
the five global (`org_id` null) roles inserted by migration **0075**, and
in-place mode never replays migrations. So `assembleTeam` found no requirements
for any pursuit. **This has been true since the 02:59Z initialization.** The
manifest does not count team tables, so reconciliation could not see it.
**Not fixed** — out of scope for a plan-story install.

**A hosted-only permission shape.** `postgres` reports membership of `app_rw`
(`pg_has_role … 'MEMBER'` = true) but `set local role app_rw` is refused
(`permission denied to set role`). Consistent with PG16+ membership granted
without the SET option — **UNVERIFIED**. Any harness that impersonates `app_rw`
cannot run those checks as `postgres` on this host. The grant-level
equivalents (`has_table_privilege`, `relforcerowsecurity`, `pg_policies`) can
run, and pass.

### 2026-09-14T21:08Z — team layer repaired: fixed in code, target reseeded

Fix `6ab3599`: the canonical seed re-establishes the five global team
requirements from `src/lib/routing/team-requirements.ts` on both provisioning
paths (0075 untouched; no new migration). Then `seed-demo-world.ts` ran
**in place** on `mejokqxriwyawfhawuxu`, through the same guard and four-variable
binding as above: 11/11 layers ok, `verify()` all ok. Full record:
`SESSION-HANDOFF.md` § "Hosted team-layer repair".

| Fact | Before repair | After repair |
|---|---|---|
| `pursuit_team_requirements` | 0 | **5** (canonical, once each) |
| `pursuit_team_members` | 0 | **45** |
| Globex ledger | 9 | **10** (one "Team assembled (5 roles)") |
| Globex plan owner | `UNASSIGNED` | **`ROLE_UNFILLED`** — "Account executive role proposed — no one confirmed yet" |
| Manifest digest | `be0da833990ce436` | `be0da833990ce436` |

**The world now matches a fresh local build table for table.** The only
differences are `org_members` (the operator membership, carried by design) and
the migration tracker. Team digest `b63845ca021fe143` is identical on hosted and
local.

**The `app_rw` shape, now fully read (read-only):** PG 17.6. `app_rw` is
`NOLOGIN`. `postgres` holds it with `admin_option` true, `set_option` false and
`inherit_option` false, granted by `supabase_admin`. So `SET ROLE app_rw` is
refused by design (the earlier "consistent with PG16+" inference is now
confirmed). No `app_rw` credential exists for this project. Acting as `app_rw`
here would need a role or grant change — a login password, or a SET grant to
`postgres` — which is out of scope. The four as-`app_rw` verifier checks are
therefore **environmentally not run** on this host, and their grant/RLS
equivalents pass.
