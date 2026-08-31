# PursuitOS Three-Environment Topology

Public site · production app · private demo. One codebase, three operational worlds.

**Domain correction, settled first.** The brief named `pursuit.io`. That domain is not yours — it
serves a third-party parked-domain lander (`/` → `/lander`, not on Vercel). The domain you control is
**`pursuitos.io`**: it is on Vercel serving the application today, and `app.pursuitos.io` /
`demo.pursuitos.io` already resolve to Vercel anycast with no project bound. You confirmed
`pursuitos.io` as the target, so the whole topology below is written against it and no DNS migration
is needed before Wednesday.

---

## 1. Final topology

### pursuit**os**.io — PUBLIC

| | |
|---|---|
| Role | Unauthenticated marketing site |
| SHA | `4dbe485` application code + this phase (see §2) |
| Vercel project | **`pursuit-web`** — *to be created* |
| Database | **none** — proven, not asserted (§5) |
| Auth | none; app routes 404 at the edge |
| Worker | none |

### app.pursuitos.io — PRODUCTION APP

| | |
|---|---|
| Role | Real authenticated multi-tenant application |
| SHA | same commit as demo |
| Vercel project | **`pursuit-app`** — *to be created* |
| Supabase project | **NOT YET IDENTIFIED — halted (§6)** |
| Migration state | n/a until the project exists |
| Auth | Supabase identity, existing `src/proxy.ts` gate, RLS + FORCE RLS unchanged |
| Worker | Railway, production database only — *not commissioned* |

### demo.pursuitos.io — PRIVATE DEMO

| | |
|---|---|
| Role | Persistent synthetic demo, resettable |
| SHA | same commit as app |
| Vercel project | **`pursuit-demo`** — *to be created* |
| Supabase project | **BLOCKED on the Pro upgrade (§6)** — provisioning is proven and scripted |
| Migration state | 102 files = 102 tracker rows = 152 tables, verified on a clean database (§4) |
| Auth / protection | Supabase identity with demo-only users **plus** Vercel deployment protection |
| Worker | Demo database only, external sending hard-off — *not commissioned* |
| Seed | Canonical synthetic world; guarded reseed (§5) |

---

## 2. Source of truth (§1)

```
current branch                 claude/activateos-platform-review-xzkgmd
container HEAD  = remote HEAD  64b59bd   (0 divergence, 0 uncommitted)
origin/main                    b237e3b   (NOT an ancestor — 114 behind, 1 ahead)
```

Commits after the visual-system normalization `4dbe485`: **exactly one**, `64b59bd`, and it touches
`audit/` only.

> **Latest approved application-changing SHA: `4dbe485`.**
> **Deployable source of truth: this phase's commit** — identical application behaviour to `4dbe485`
> plus the topology work below.

No local-only tag was used as authority; every SHA was re-fetched from `origin` this session.

---

## 3. Deployment model, and why (§9)

**Three Vercel projects from one Git repository, separated by one environment variable.**

Vercel *environments* inside one project were rejected: preview/production share a project's domain
model and rollback history, and "production" would then mean two different things. Three projects
give genuinely separate environment variables, database targets, auth configuration, deployment
protection, and — the one that matters at 8am Wednesday — **independent rollback**. Rolling the demo
back cannot disturb the app.

Separation is enforced in code, at the edge, by `PURSUITOS_ENV`:

| Value | Behaviour |
|---|---|
| `public` | `/` serves the landing page; **every application route 404s before touching a database** |
| `app` | Full application. Never marked synthetic — the database CHECK constraint forbids it |
| `demo` | Full application against synthetic data; reseed permitted |
| `local` | Developer default when unset |

An unrecognised value does not fall back — `siteMode()` throws and `src/proxy.ts` returns 500 on
every request. A typo must never silently resolve to "serve the app".

---

## 4. Migration parity, proven (§7)

The brief requires `migrations on disk = migration tracker = physical schema` before seeding. Proven
on a clean database this session:

```
migration files on disk : 102
schema_migrations rows  : 102   (last: 0102_environment_identity.sql)
public tables           : 152
RLS enabled             : 152 / 152
FORCE RLS enabled       : 152 / 152
declared but missing    : none
physical but undeclared : none
```

**One finding worth carrying into provisioning.** The chain does not apply to a bare Postgres: `0028`
requires Supabase's `auth` schema and fails with `schema "auth" does not exist`. On a real Supabase
project `auth` exists natively, so this is not a defect — but it does mean *the demo project must be
a Supabase project*, not any Postgres. `scripts/demo-db.ts` carries the compatibility bootstrap that
makes local mirrors work.

The legacy project `sxtwrrckvlohottrdsbr` was **not touched** (§18): still physically ~0062 with its
tracker at 0012.

---

## 5. Isolation guarantees, tested not asserted

### The public site cannot reach the database

Served with `DATABASE_URL` pointed at `127.0.0.1:9999/nope`:

```
/            -> 200   (renders fully)
/pipeline    -> 404      /admin      -> 404
/api/build   -> 404      /ask        -> 404
```

Scanned for tenant and demo identifiers (`Globex`, `Umbrella`, `Cyberdyne`, `Stark`, `Vertex`, `CDW`,
`WWT`, `TD SYNNEX`): **none present**.

### Cross-environment reseeding is refused by the database, not the operator

The realistic accident is an operator who still has a production `DATABASE_URL` exported. An
environment variable cannot guard against that — it *is* the mistake. So migration `0102` puts a
single-row `environment_identity` marker **inside** each database, and every destructive script asks
the target what it is before writing.

Three cases, all executed:

| Target | Result |
|---|---|
| Unmarked database | **REFUSED** — "cannot be proven synthetic" |
| Marked `app` / `is_synthetic=false` | **REFUSED** — "It holds real data. Nothing was written." |
| Marked `demo` / `is_synthetic=true` | Proceeds normally |

Fail-closed at every branch: missing table, missing row, unreadable, or error all mean refuse. No
default row is inserted, so forgetting the marker step fails safe rather than open.

Two further locks:
- `check (not (environment = 'app' and is_synthetic))` — the database itself refuses to hold the one
  combination that would authorise wiping production.
- `demo-db.ts` issues `DROP DATABASE` only against a loopback host; a non-local `DEMO_PGHOST` is
  refused outright, and hosted demo seeding goes through a separate in-place path that asserts the
  marker first.

One defect found and fixed during this work: the refusal message named the database from
`DATABASE_URL` while the scripts connect via `DEMO_URL` — it could name a database the call never
touched. It now interrogates the live connection (`current_database()`, `current_user`,
`inet_server_addr()`), which on Supabase also surfaces the project ref through the pooled username.

Guarded: `demo-db`, `demo-stories`, `demo-intel-story`, `demo-stakeholder-story`,
`demo-lifecycle-story`, `demo-value-story`, `demo-ask-story`, `demo-meddpicc`,
`backfill-motion-pursuits`.

---

## 6. HALT — actions only you can perform (§19)

### HALT 1 · Upgrade Supabase to Pro *(you chose this path)*

Your org is on **free**, which caps active projects at 2, and you have 2 active plus 1 paused. Demo
and production both need their own project.

1. Open **https://supabase.com/dashboard/org/lvnwjnvkoekicyfrebol/billing**
2. Select **Pro**, confirm.
3. Nothing to send back.

### HALT 2 · Create the demo Supabase project

1. **https://supabase.com/dashboard/new/lvnwjnvkoekicyfrebol**
2. Name: **`pursuitos-demo`** · Region: **Canada (Central)** (matches the existing project) ·
   generate a strong database password and keep it in the password manager.
3. Send back, from Settings → General and Settings → Database:
   - the **project ref** (20 characters — not a secret)
   - confirmation the project is **ACTIVE_HEALTHY**
4. Put the connection string and keys straight into the Vercel project's environment variables
   (HALT 4). **Do not paste secrets into chat.**

### HALT 3 · Decide the production database

`app.pursuitos.io` needs a database and I must not infer one. Three options — **A is recommended**:

| | Option | Consequence |
|---|---|---|
| **A** | New `pursuitos-app` project, migrate `0001–0102` clean | Production starts at full parity with no legacy drift. The legacy project stays untouched as an archive. |
| **B** | Adopt legacy `sxtwrrckvlohottrdsbr` | Needs `migrate.ts --baseline` through 0062, then 0063–0102 applied to a live database whose backup posture is unverified. |
| **C** | Defer | Demo and public site ship; `app.pursuitos.io` waits. **Wednesday does not need it.** |

### HALT 4 · Create the three Vercel projects

For each, at **https://vercel.com/new** → import `cgrigori88/ActivateOS` → set **Production Branch**
to `claude/activateos-platform-review-xzkgmd`:

| Project | Domain | `PURSUITOS_ENV` | Also set |
|---|---|---|---|
| `pursuit-web` | `pursuitos.io` (+ `www`) | `public` | `NEXT_PUBLIC_APP_URL=https://app.pursuitos.io`, `NEXT_PUBLIC_ACCESS_EMAIL=<your address>` |
| `pursuit-demo` | `demo.pursuitos.io` | `demo` | demo `DATABASE_URL` + Supabase keys, feature flags (§7), `OPS_FINGERPRINT_TOKEN` |
| `pursuit-app` | `app.pursuitos.io` | `app` | production credentials — only after HALT 3 |

`pursuitos.io` is already a Vercel domain and the subdomains already resolve to Vercel, so binding is
a Settings → Domains entry per project with no DNS propagation wait. The apex currently points at the
existing deployment — **moving it to `pursuit-web` is what replaces the stale site**, so do it after
`pursuit-web` builds green.

### HALT 5 · Protect the demo

`demo-pursuit` Settings → **Deployment Protection** → enable **Password Protection** (or Vercel
Authentication). This is *in addition to* application auth; `noindex` is not access control.

Then create demo users in the demo Supabase project → Authentication → Users. Send back the email
addresses used, not the passwords.

---

## 7. Feature flags (§14)

Verified at code level; each environment's stored variables are yours to set and I cannot read them.

| Flag | app | demo |
|---|---|---|
| `OUTREACH_AUTOSEND` | **unset → OFF** | **unset → OFF** |
| `PURSUITS_ENABLED` / `FACTS_ENABLED` / `ROUTING_ENABLED` / `PURSUIT_EXPERIENCE_ENABLED` | per rollout | `1` (demo journey needs them) |
| `outcome_learning` | per tenant | sponsor tenant only, as already approved |

Every consumer tests `=== "on"`, so absence is off. `externalSendingArmed()` additionally returns
`false` unconditionally on the public site — there is no tenant on whose behalf it could act. No
global flag bridges environments: tenant flags live in `org_features`, which is per-database.

---

## 8. Build fingerprint (§15)

`GET /api/build` — *"we should never again need to fingerprint CSS to identify what version is
deployed."*

Returns commit SHA (full + short), branch, build timestamp, Vercel deployment id, environment,
database project ref and host, and posture (`externalSendingArmed`, `modelCredentialPresent`).

Tested: no token → **404**; wrong token → **404** (constant-time compare); correct token → JSON.
Scanned for `sk-ant`, `service_role`, `password`, `secret`, JWTs and connection strings: **none**.
404 rather than 403, so an anonymous caller cannot even learn the endpoint exists.

Two access layers: the existing `src/proxy.ts` gate, and an independent check of either an
authenticated session or `OPS_FINGERPRINT_TOKEN` — the token exists so this stays usable when the
database or auth is the thing that is broken.

---

## 9. Model / Ask state (§12)

| Environment | Credential | Ask |
|---|---|---|
| local / legacy | **INVALID** — `401 authentication_error`, well-formed but rejected | **P2C-1 DEGRADED — deterministic resolver operational** |
| app | not yet configured | pending |
| demo | not yet configured | pending |

Not a deployment blocker, as instructed. P2C-1 is deterministic-first: the model is consulted only
where parsers decline, and every interpreter failure returns `REJECTED` into the deterministic
resolver. `interpret-live-validate.ts` runs when a valid credential is set. No key value printed.

---

## 10. Not done, and why

- **`app.pursuitos.io` not commissioned** — HALT 3; the brief says Wednesday does not require it, and
  isolation must not be compromised to light up three domains at once.
- **Workers not commissioned** (§13) — no `RAILWAY_TOKEN` in this environment. The certified demo
  journey is seeded state read through the app and does not depend on background processing; the
  affected surfaces are recompute freshness, outbox drain (irrelevant with sending off) and scheduled
  routines. No new infrastructure was built for the demo.
- **Demo journey not certified on `demo.pursuitos.io`** (§17) — the environment does not exist yet.
  The 15-step journey is certified on the identical build locally and re-runs against the demo host
  once HALT 2 and HALT 4 complete.
- **Nothing legacy touched** (§18) — no Vercel deployment deleted, no legacy Supabase migrated, no
  history rewritten, no force-push, no `main` consolidation.

**Branch strategy (§10):** the feature branch remains the deployable source of truth and each Vercel
project pins it as its production branch, so every deployment is traceable to a SHA and rollback is a
Vercel action. `main` consolidation is a post-demo pull request — recorded here so the drift does not
become permanent.

---

## 11. Matrix

| Item | Status |
|---|---|
| GitHub source | **PASS** — `64b59bd`, clean, pushed |
| Public landing | **PASS** — built, verified, no database |
| pursuitos.io | **NOT YET BOUND** — HALT 4 |
| Production app deployment | **NOT YET COMMISSIONED** |
| app.pursuitos.io | **NOT YET COMMISSIONED** |
| Production Supabase | **NOT YET IDENTIFIED** — HALT 3 |
| Production auth | **NOT YET COMMISSIONED** |
| Demo deployment | **BLOCKED** — HALT 1, 2, 4 |
| demo.pursuitos.io | **NOT YET BOUND** — HALT 4 |
| Demo Supabase | **BLOCKED** — HALT 1, 2 |
| Migration parity | **PASS** — 102 = 102 = 152 tables, verified clean |
| Demo seed | **PASS locally** — canonical world intact, guarded |
| Demo protection | **NOT YET APPLIED** — HALT 5 |
| Demo isolation | **PASS** — enforced and tested at DB + edge |
| Feature flags | **PASS** — fail-closed, verified in code |
| External send OFF | **PASS** |
| Ask deterministic | **PASS** |
| Ask interpreter | **DEGRADED** — credential invalid, fallback intact |
| Build fingerprint | **PASS** — `/api/build`, gated, no secrets |
| Certified demo journey | **PENDING ENVIRONMENT** |
| Rollback | **PASS by design** — per-project pinned branch + Vercel rollback |

---

## HALT FOR REVIEW

The topology is normalized as far as it can be without your infrastructure actions. Everything that
is code — the public site, environment identity, the reseed guard, migration `0102`, the build
fingerprint, edge-level public/app separation — is built, tested and committed. Everything that
remains is HALT 1 through HALT 5: a billing upgrade, two project creations, one production-database
decision, three Vercel projects, and demo protection.

The critical path to Wednesday is **HALT 1 → HALT 2 → HALT 4 (`pursuit-demo`) → HALT 5**. The public
site can go live in parallel and depends on nothing. `app.pursuitos.io` should wait for a deliberate
decision on HALT 3.
