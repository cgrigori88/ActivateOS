# H1 — Pre-Pilot Hardening Gate

**Status:** **H1A COMPLETE (local)** · H1B NOT STARTED (design only). **H1 is not complete until H1B passes hosted certification.**
**Lane:** `roadmap/pursuitos-vnext`. No hosted database, Vercel, Supabase role/grant or Production change is part of H1A.

H1 exists because Slice 2B's security review found a systemic risk: the application connects as a role that bypasses Row Level Security, and code had relied on RLS without explicit org scoping. Before any real pilot:

| Phase | Name | What it proves |
|---|---|---|
| **H1A** | Tenant Isolation + Certification Integrity | Every application data path is explicitly tenant-scoped (independent of RLS), and certifying the canonical world never changes it |
| **H1B** | Least-Privilege Runtime / RLS Cutover | The web runtime runs as a role RLS actually binds, so the database refuses cross-tenant access even if a query forgets its predicate |

Explicit scoping (H1A) and RLS (H1B) are **defence in depth**, not alternatives. Neither replaces the other.

---

## H1A — results (2026-09-14, local; no hosted change of any kind)

### A. Tenant data-path inventory

Four audit lanes covered every route handler, server component, server action, API route, MCP tool, search/Ask resolver, routine and worker entry point. A fifth lane audited the verifier harness.

| Lane | Surfaces | Paths | SAFE_EXPLICIT | SAFE_PARENT_SCOPED | SAFE_WITH_TENANT | RLS_ONLY | UNSCOPED | NOT_TENANT_DATA | SYSTEM (by design) |
|---|---|---|---|---|---|---|---|---|---|
| A | Pipeline, Accounts (list, room, export), Contacts, Mapping, Intake, opportunity libraries | 110 | 39 | 4 | 0 | 38 | 26 | 3 | — |
| B | Pursuits (list, detail, route, team, timeline, outcomes), governed skills, federation, Motions, Briefs, Goals | 59 | 22 | 4 | 0 | 13 | 19 | 1 | — |
| C | Partners, Joint, Campaigns and the send chain, Upcoming, Analytics, Insights, Review, Sources, Provider health, Trust | 76 | 28 | 3 | 0 | 3 | 39 | 3 | — |
| D | MCP, palette / Ask, Skills, Routines, Admin, Ops, layout, API routes, login / join, worker | 48 | 21 | 2 | 0 | 12 | 3 | 3 | 7 |
| **Total** | | **293** | **110** | **13** | **0** | **66** | **87** | **10** | **7** |

Totals:
- **153 paths were RLS_ONLY or UNSCOPED** and reachable.
- **152 are fixed** with explicit predicates.
- **1 is reclassified SYSTEM**: the campaign-suggestion worker job. It iterates orgs by design and now carries each motion's org explicitly; it is no longer an unscoped tenant path.
- **0 reachable RLS_ONLY / UNSCOPED paths remain.**

The per-path matrix (file · function · tables · R/W · org source · class · fix · risk) is recorded in the four audit lane reports, summarised by severity in § B.

"SYSTEM" paths are intentionally cross-tenant and run on the owner pool. They are listed in § H1B:
- login bootstrap;
- join / guest provisioning;
- admin member management (auth schema);
- the Resend webhook;
- `/api/research`;
- the worker jobs;
- the routine scheduler.

### B. Security defects found (all fixed unless noted)

**CRITICAL: cross-tenant writes, sends, or PII**
- **Campaign send chain.** A tenant could approve, edit or delete another tenant's email touches. It could set an attacker recipient on another tenant's campaign and send that tenant's approved content under that tenant's sender identity (`launchCampaign`, `sendTouchNow`, schedule and unschedule). The MCP `draft_touch` tool wrote into another tenant's campaign found by name.
- **Engagement rollup** (`deriveEngagement` / `emitEngagementSignals`). It deleted and recomputed every tenant's engagement scores and engagement evidence for a shared account, on every send.
- **Pipeline writes by foreign id:**
  - advance or close a deal;
  - promote a motion to an opportunity;
  - register a deal or set a registration's status;
  - MEDDPICC and stakeholder sentiment;
  - account-team status, which also lacked `requireWrite`.
- **Pursuit route selection and override by foreign pursuit id** (`select_partner_route` / `override_partner_route`, with no precheck).
- **Motion approve / reject / transition / edit by id.** Also: a motion's goal, revenue targets on a foreign partner, target lists from foreign population cells, and a foreign list linked to a campaign (a read escalation of the foreign list's members).
- **Evidence-share injection and hijack** into a partnership the caller is not party to. **Broker-entry injection** into a foreign joint pursuit's shared ledger.
- **Other tenants' contact details and lists:** the Contacts list and detail, campaign recipient pickers, and the Upcoming recipients.
- **Whole other-tenant books:**
  - the Pipeline book (which also persisted polluted `pipeline_snapshots`);
  - the pursuit portfolio and pursuit detail by URL id;
  - the account room;
  - Briefs;
  - the Motions list;
  - the Campaigns list and detail;
  - AI sequence generation from a foreign motion (foreign thesis and evidence sent to the LLM, rows written into the foreign tenant);
  - blank campaigns created under another tenant's org.

**HIGH: cross-tenant aggregates and derived surfaces**
- Every aggregate on Analytics.
- Insights (funnel, win rate, calibration, edit intensity, attribution).
- The Review queue (other tenants' pending claims and excerpts).
- Sources evidence counts.
- Provider health (other tenants' spend and error text).
- The admin AI-ops panel.
- Accounts list scores, evidence counts and teams; the account export.
- Mapping: matrix, coverage, insights, multi-vendor plays and win rates, pending counts.
- Opportunity autopsy, quotes, momentum and writeback sums.
- Evidence corroboration counts.
- Palette "SHOW ME" deals with dollar totals.
- Ask EXPLAIN, which returned another tenant's route, partner names and reasons.
- MCP `pipeline_summary` (the whole platform's pipeline) and `account_brief`.
- The morning-brief routine emailed the platform's top deals.
- The account-digest routine stored other tenants' claims and email subjects as this tenant's data.

**MEDIUM / LOW**
- The partner room's motion win rate and partner-hub counts.
- Goals rollups and chains; revenue-target actuals.
- The motion designer's score and team stamping.
- Scope-chip counts, ops governance health, Skills edit intensity.
- Lifecycle and EXPLAIN ranking existence oracles.
- The Ask link filter (existence-only).
- `listEvidenceShares` had no party check. Not exploitable, because every caller passes an org-scoped id.
- The trust page claimed "No query path can opt out", which is untrue while the runtime bypasses RLS. It was reworded to the true claim.

### C. Fixes (conventions: D-043)

The org comes only from authenticated server context and is put in SQL before any limit, aggregate, ranking or count. Child tables are scoped through their org-owned parent. Every write refuses a foreign id: the lookup and the write both carry the predicate, and inserts use the caller's org.

About 70 source files changed. Every changed signature's callers are updated, including the scripts.

An independent review of the combined diff found:
- no placeholder or params mismatch;
- no outer join turned into an inner join;
- no org taken from a target row;
- no change to a frozen file.

Its findings, applied:
- strict `propensity_scores` in three places (Motions page and actions, the motion designer);
- strict contacts on Pursuit Detail (the canonical world has no org-less contacts, so certified output is unchanged);
- Ask keeps links to pursuits the org actively participates in (restoring authorized behaviour the first pass had dropped);
- a party check on `listEvidenceShares`;
- a 404 rather than a 500 for a foreign list id in the Mapping drill-down.

**Behaviour changes for the authorized org.** Each is correct under D-043 and inert on the canonical world, which has no org-less rows:
- legacy org-less campaigns, motions and contacts are no longer shown to every tenant;
- tenants no longer see provider runs with no org;
- engagement is not derived for org-less threads;
- `scripts/motion.ts approve|reject` needs `--org`.

**Not fixed. Reported: ambiguous ownership or product semantics (stop conditions)**

| Item | Why it is not fixed here |
|---|---|
| `review.ts` verdicts mutate global `signal_sources` trust and copy tenant claim text into global `golden_examples` | These tables have no org. Which tenant a platform learning signal belongs to is a product/ownership decision |
| Org-less `evidence` is treated as shared catalog evidence | That is the recorded convention, not a new one. Whether any org-less evidence should exist is an ownership question |
| Inbound email thread matching falls back to participants + subject across tenants (`comms/threading.ts`) | Changing matching is a product-semantics change. Recommend triage when the key matches threads in more than one org |
| Stored `account_digests` may hold other tenants' content from earlier runs | The code is fixed. Purging and regenerating the data is a data operation for the owner |
| `drainRecomputeQueue` drains every org's queue | Worker/system by design: each request carries its own org |
| Intake enrichment updates the shared `companies` catalog | Catalog integrity, not tenant isolation |
| Cross-tenant consent flows under `app_rw`: redeem invite, grant materialisation, overlap probe, settlement, shared skills/evidence | Correct today on the owner pool. Whether each needs a narrow policy or a SECURITY DEFINER function under app_rw is **H1B** work (§ H1B, "Certify RLS actually enforces") |

### D. Cross-tenant adversarial verifier (Part C): `scripts/tenant-isolation-verify.ts`

SEEDED, with SEEDED_CLONE isolation. It runs on a disposable clone of the canonical world, against the real production build (`next start`), with every room switched on.

| Section | What it proves | Result |
|---|---|---|
| 1 Baseline | Crawls 38 rooms and API responses twice. Clock-driven lines are masked; none were found | 38 / 38 render |
| 2 Foreign tenant | A new tenant is planted with 33 record kinds cloned from the sponsor's own rows on the sponsor's own hero account, every readable field marked `ZZLEAK` and every amount 987,654,321:<br>• partner, seller, pursuit, route snapshot, ledger, team wait;<br>• three motions and a step;<br>• open and won opportunities;<br>• contact, campaign and scheduled touch;<br>• verified and pending evidence, review item;<br>• propensity and engagement scores;<br>• deal registration, goal, list and member, pursuit team;<br>• skill, initiative, outcome, interaction;<br>• agent run, thread, message, email event.<br>Every room must be identical to the baseline on every stable line (records, counts, totals, pipeline, rankings, recommendations, Today, Queue, badges, drawers, hidden counts, analytics). No response may contain a marker. The foreign tenant's records must not open by id | pass |
| 3 Direct surfaces and writes | 7 MCP tools, palette SHOW ME (hits and the dollar total), Ask EXPLAIN, the Ask link filter, both routines (and the digests they store), and five library read models (partner hub, multi-vendor plays, coverage win rates, source attribution, pursuit read models).<br>**27 write paths** called with foreign ids: every one refused or a no-op, with the foreign row unchanged (each in a rolled-back transaction) | pass |
| 4 Negative control | The same book planted into the sponsor itself (`ZZOWN`). The marker appears in the 13 rooms that list those records, and **every one of the 38 crawled responses changes**. The crawl can see what § 2 says is absent | pass |
| **Total** | | **205 passed, 0 failed** |

Not plantable in this world: a provider run, because the local `providers` registry is empty. Provider health's tenant filter is still covered by § 4's "every room moves" and by the Sources and Admin rooms.

### E. Certification harness integrity (Part D)

**Measured, not assumed.** A whole-world fingerprint (`scripts/world-fingerprint.ts`: every table's row count and an order-independent content hash) was taken after every suite. It found eight SEEDED suites that changed the canonical world on every run, through their own commits or autocommit: lifecycle-query, lifecycle-acceptance, partner-intel, outcome-bridge, motion-intel, canonical-microloop, route-persistence and team-motion. Downstream, vnext-coordination and vnext-attention went FATAL and demo-team failed, against a world that was no longer the certified one.

**Fixes:**
1. **SEEDED_CLONE isolation.** The eight suites (and `tenant-isolation`) run on a marked, disposable `CREATE DATABASE … TEMPLATE` clone and refuse any unmarked database.
2. **The guard is live.** `assertDisposableDatabase`, which no suite called, now runs first in all 19 FRESH/EITHER suites.
3. **Safe defaults.** None of those suites defaults to `pursuit_demo` any more.
4. **`--either-on-seeded` is refused.**
5. **Port aligned.** `verify-run` defaulted to port 5432; it now uses 5433, like every other script.
6. **Denial probes never commit.** stakeholder-intel `asOrg`, canonical-microloop `rls` and the lifecycle-acceptance probes now always roll back.
7. **`ops` is described correctly.** It commits fixtures; it is not read-only.
8. **The gate.** `scripts/certify-world.ts` fingerprints around every suite and fails on any drift, attributing it to the suite that caused it.

| Classification | Suites |
|---|---|
| READ_ONLY | interpret, value-case, scope, demo-team, vnext-context, append-only (its denial probes are rolled back) |
| ROLLBACK_SAFE | stakeholder-intel, vnext-coordination, vnext-attention, today-tenant |
| DISPOSABLE_DB_ONLY: fresh migrated database, guarded | pursuit, routes, experience, facts, governance, and the 14 EITHER suites |
| DISPOSABLE_DB_ONLY: seeded clone, guarded | lifecycle-query, lifecycle-acceptance, partner-intel, outcome-bridge, motion-intel, canonical-microloop, route-persistence, team-motion, tenant-isolation |
| DISPOSABLE_DB_ONLY: drives a running app | the 12 `scripts/*.mjs` browser scripts. They open no DB connection, but any GET of `/pipeline` upserts that day's `pipeline_snapshots` row, so point the app at a clone. None is in the certification battery. `today-verify.mjs` is read-only |
| DEPLOYMENT_ONLY | migrations-only |
| **UNSAFE** | **none** |

### F. Canonical immutability

`certify-world --runs 2` ran against `pursuit_cert`, a fresh template copy of the canonical world: 38 suites, run twice, 76 suite runs in all.

**CERTIFICATION INTEGRITY: PASS.** The whole-world digest was `e98b43254f98d5ec` at the start, after run 1 and after run 2. **No suite moved the world in either run**; before H1A, eight did.

Suite verdicts: 74 clean, and 2 with one failure each. Both are `motion-intel`, which gave 18 passed / 1 failed in both runs, on "Brief motion-context check (no linked motion)".
- **The failure is pre-existing, not an H1A regression.** The same suite, run at `54ab990` (before any H1A change) on a clone of the same world, fails the same assertion identically.
- **Cause.** The suite picks "whatever org is first" and expects that org to own a motion linked to a pursuit. The canonical world has none, so the assertion has nothing to check. It is a fixture gap, recorded here and not papered over.

Every other suite passed with 0 failures in both runs.

The canonical world `pursuit_demo` itself was never a target. Its fingerprint is `e98b43254f98d5ec` (154 tables, 1,051 rows) and its manifest digest `be0da833990ce436`, both unchanged.

### G. Local app_rw cutover rehearsal (H1B evidence): `scripts/app-rw-rehearsal.ts`

The canonical world was cloned, and the production build started twice against the clone:
- once with `DATABASE_URL` set to the owner;
- once with `DATABASE_URL` set to `app_rw` and `DATABASE_URL_OWNER` set to the owner (the exact H1B split).

`app_rw` logged in with `current_user = app_rw`, `rolbypassrls = false`, and saw **0 pursuits with no `app.org_id`**.

**36 of 36 rooms rendered identically** under RLS binding and under the owner bypass. No room depends on the bypass to render the sponsor's world.

The rehearsal covers page reads for one org. Writes under app_rw and the cross-tenant consent flows are H1B's to certify. No role, grant or policy was changed; `app_rw`'s local LOGIN pre-exists (`scripts/demo-db.ts`).

---

## H1B — least-privilege runtime / RLS cutover (DESIGN — not executed)

### What is true today (verified in the repository and read-only on the databases)

| Fact | Evidence |
|---|---|
| The web runtime and every script use `DATABASE_URL`; `getOwnerPool()` uses `DATABASE_URL_OWNER` and **falls back to `getPool()` when it is unset** | `src/db/client.ts` |
| On every hosted database seen, `DATABASE_URL` connects as `postgres` — BYPASSRLS on Supabase, so all policies are inert on the app path | `ENVIRONMENT-MAP.md` §4; `PRODUCTION-RLS-STATUS.md` |
| `withTenant` / `withTenantOrg` already set `app.org_id` per transaction (is_local) from a server-resolved org, fail closed if none | `src/lib/db/tenant.ts` |
| `app_rw` exists (0058): NOLOGIN, NOINHERIT; SELECT/INSERT/UPDATE/DELETE on all public tables (append-only history tables have UPDATE/DELETE revoked — 0094, 0103); default privileges grant it every new table | 0058, 0094, 0103 |
| A `<table>_rw` policy for app_rw on every org_id table: `using/with check is_org_member(org_id)`, where `is_org_member` honours `app.org_id` (SECURITY DEFINER) | 0058; later migrations add child/reference and cross-tenant policies (146 tables carry `_rw` locally) |
| FORCE RLS on every RLS-enabled table (154/154 locally) — binds a non-bypass owner; no-op for BYPASSRLS `postgres` | 0090 |
| Org resolution before the GUC exists: `resolve_user_org(uid)` (0059) and `resolve_api_key(hash)` (0062), both SECURITY DEFINER | 0059, 0062 |
| **Local:** app_rw has LOGIN (password `demo`, set by `scripts/demo-db.ts` for local boot only); as app_rw with no `app.org_id`, `select count(*) from pursuits` = **0** — RLS enforces | read-only probe, 2026-09-14 |
| **Hosted isolated DB `mejokqxriwyawfhawuxu`:** app_rw is **NOLOGIN**; `postgres` holds app_rw with `admin_option = true`, `set_option = false`, `inherit_option = false` (granted by `supabase_admin`) — so `SET ROLE app_rw` is refused (PG16+) | `ENVIRONMENT-MAP.md` §10, read-only |
| A prior session log claims a production-project cutover (a different project) with `app_rw.<ref>` logging in through the Supabase **transaction pooler** | `audit/RISK-1-CUTOVER-STATE.md` — **explicitly UNVERIFIED** (`PRODUCTION-RLS-STATUS.md`) |
| `/api/build` reports `database.projectRef` by parsing a `postgres.<ref>` username only — under an `app_rw.<ref>` login it would report `unknown`, and it reports no role | `src/lib/env/environment.ts` `databaseIdentity()` |

### Target architecture

```
WEB RUNTIME (Vercel)                       DATABASE_URL        → app_rw (LOGIN, NOINHERIT, not BYPASSRLS)
  every tenant request: withTenant → set app.org_id → RLS binds every query  ← H1A explicit predicates still run
OWNER / CONTROL PATHS inside the web app   DATABASE_URL_OWNER  → postgres (BYPASSRLS)
  getOwnerPool(): login provisioning · join links · admin member mgmt (auth schema) · ops role check ·
  research trigger · Resend webhook
BACKGROUND WORKER (Railway)                DATABASE_URL (owner) — system, intentionally cross-tenant jobs
MIGRATIONS / SEEDS / BACKFILLS / OPS       owner string, run by an operator — NEVER the app_rw string
```

### The questions H1B must answer

| Question | Answer (derived from the repo and the Supabase shape above) |
|---|---|
| Web runtime role | `app_rw` |
| How it authenticates | A LOGIN on `app_rw` itself (not a second login role that assumes it): `postgres` cannot `SET ROLE app_rw` on Supabase (no SET option), and the app never switches roles per request — it connects as the role. Through Supavisor the username is `app_rw.<project-ref>` on the **transaction pooler :6543** (serverless; the pool comment in `client.ts` requires the transaction pooler on Vercel) |
| Does app_rw need LOGIN | **Yes** — `alter role app_rw with login password '<new secret>'` run once as `postgres` (holds ADMIN OPTION on app_rw; Supabase `postgres` has CREATEROLE). This is a **hosted role change → H1B, owner-approved**. Nothing else about app_rw changes |
| Supabase restrictions | `postgres` is not a superuser; it can manage app_rw only through its ADMIN OPTION. Whether Supavisor accepts a custom login role is asserted only by an unverified session log → **verify first on the isolated DB** (below). Migrations must never run as app_rw (DDL, ownership) |
| Grants needed | None new: 0058 grants + default privileges already cover every table/sequence/function; 0094/0103 keep history append-only. **Pre-flight check** (read-only): every table the app writes has INSERT/UPDATE for app_rw and a `_rw` (or cross-tenant) policy; any table without one default-denies |
| Separate credentials | `DATABASE_URL` = app_rw string (new secret). `DATABASE_URL_OWNER` = the current owner string. The two passwords differ; neither reveals the other |
| Vercel variables that change | Preview scope for `roadmap/pursuitos-vnext` only, in order: (1) **add** `DATABASE_URL_OWNER` = current owner string, redeploy, verify green (owner paths stop falling back); (2) **change** `DATABASE_URL` → app_rw string, redeploy. `PG_OWNER_POOL_MAX` optional. Nothing on Production |
| Rollback | Set `DATABASE_URL` back to the owner string and redeploy (env binds at build). RLS goes inert again; H1A's explicit predicates remain the control. No role, grant or policy needs dropping; app_rw's LOGIN can stay or be revoked (`alter role app_rw nologin`) |
| `/api/build` proof of posture | Extend `databaseIdentity()` to parse `<role>.<ref>` (not only `postgres.<ref>`) and return `database.role` from the URL (non-secret). Add an opt-in live probe (`?probe=1`, same auth gate, 2 s timeout) returning `current_user` and `rolbypassrls` for the runtime pool — so an operator sees `app_rw` / `false` from the running process, not from memory. No secret, no tenant data |
| Scripts / migrations | Keep the owner string, supplied explicitly per run (`DATABASE_URL`/`DEMO_TARGET_URL` bound to the owner string by the operator's guarded wrapper). They are never deployed with the app_rw string |
| Background jobs | The worker keeps the owner connection (`getOwnerPool()` everywhere in `src/worker/index.ts`); its jobs are system / cross-tenant by design. H1A must confirm each per-org job keeps orgs apart by explicit predicate (it gets no RLS protection) |
| Certify RLS actually enforces | (a) Read-only catalogue checks: `rolcanlogin`, `rolbypassrls = false`, policies on every org_id table, FORCE state. (b) As app_rw with **no** `app.org_id`: every tenant table returns 0 rows. (c) As app_rw with org A: only org A's rows; a write carrying org B is refused (42501 / WITH CHECK). (d) Run the tenant verifiers (`today-tenant`, the H1A broad verifier) with `DATABASE_URL_VERIFY` = the app_rw string. (e) A two-org blind test through the deployed app: two sessions, each sees only its own org. (f) `/api/build?probe=1` → `app_rw`, `rolbypassrls false` |

### H1B sequence (for the owner to approve — none of it has been run)

1. **Isolated DB only (`mejokqxriwyawfhawuxu`), never `qifatlqxfuhwrwvpbwsc`.** Read-only pre-flight (grants/policies/FORCE).
2. `alter role app_rw with login password '<secret>'` as `postgres`. Test a direct `app_rw.<ref>` login through the transaction pooler: `select current_user` → `app_rw`; with no GUC, `select count(*) from pursuits` → 0.
3. Vercel Preview (this branch only): add `DATABASE_URL_OWNER` (owner string) → redeploy → verify green.
4. Change `DATABASE_URL` → app_rw string → redeploy → `/api/build?probe=1` shows `app_rw` / `rolbypassrls false`.
5. Run the certification battery against the isolated DB (owner string for SEEDED fixtures, app_rw string for the tenant verifiers), then a crawl of every room: any empty room is a path that still depends on the owner bypass — it fails closed (empty), it does not leak.
6. Two-org blind test; hosted human review.
7. Rollback rehearsal: point `DATABASE_URL` back at the owner string, redeploy, confirm.

### Local rehearsal (H1A — no hosted change)

The same cutover can be rehearsed locally today (app_rw has a local login): run the built app with `DATABASE_URL=app_rw` and `DATABASE_URL_OWNER=postgres`, crawl every room, and compare it with the owner-role crawl. See § "H1A results".
