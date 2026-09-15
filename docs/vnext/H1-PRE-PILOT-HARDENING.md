# H1 — Pre-Pilot Hardening Gate

**Status:** **H1A COMPLETE (local)** · certification baseline **completely green** (76/76, 2026-09-14) · H1B: **Gate 1 PASS AFTER DOCUMENTED RE-BASELINE** (2026-09-15; hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `2678f34d4fc7b0a2`) · **H1B-0 COMPLETE (local)** — consent flows work under `app_rw` (D-049), `/api/build` posture proof, 78/78 certification · **Gate 1b PASS** (2026-09-15; 0104 applied to `mejokqxriwyawfhawuxu` only; post-1b hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `0288ae73bb385a1c`) · **Gate 2 BLOCKED / NOT EXECUTED** · **H1B-0.1 COMPLETE (local)** — migration 0105 closes `pg_temp` shadowing on 31 authorization-sensitive functions (D-050) · **Gate 1b.1 PASS** (2026-09-15; 0105 applied to `mejokqxriwyawfhawuxu` only; 31/31 hardened, 0 unsafe; post-1b.1 hosted baseline: migrations 105, manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1`) · **Gate 2 PASS** (re-run, 2026-09-15; `app_rw` given LOGIN and its operator credential on `mejokqxriwyawfhawuxu` only — `rolcanlogin` false → true, nothing else changed) · **Gate 3 PASS** (2026-09-15; `app_rw.<ref>` pooler login proven; RLS / tenant context exact on all 155 tables for no-context and three orgs; no cross-transaction context leak; foreign writes refused; zero residue) · Gates 4–9 not begun. **H1 is not complete until H1B passes hosted certification.**
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

The first H1A pass gave 74 clean suite runs: `motion-intel` failed one assertion in both runs. That failure was pre-existing, and it is now repaired in the verifier (see "Final H1B baseline" below, and D-047).

#### Final H1B baseline — completely green (2026-09-14)

**The failing assertion.** `motion-intel` asserted "Brief motion-context check (no linked motion)". It needs a motion that names a pursuit (`revenue_motions.pursuit_id`), because a pursuit's Brief carries motion context ("Serving hypothesis", confidential to the sponsor) only through that deterministic P1A linkage.

**Root cause: a verifier fixture gap.** It was not a canonical-seed gap and not a wrong expectation.
- **The canonical world has no such link, and should not.**
  - The seed (`demo-stories.ts`) inserts motions without a `pursuit_id`.
  - The only application path that sets one is the legacy reparent/backfill service.
  - The certified Pursuit Detail for the canonical pursuits renders no motion context.
  - Adding the link to the seed would change a frozen, certified surface.
- **Why it once passed.** `outcome-bridge-verify`, run immediately before it on the same shared world, committed a linked "Verify motion" into that world. That was a hidden cross-suite dependency. H1A's clone isolation gives every writing suite its own clone, which exposed it; the suite fails identically at `54ab990`, before H1A.

**The fix is in the verifier.** `motion-intel` now establishes the linkage itself, the way the reparent service does: a same-org, same-account motion is linked to a pursuit.
- It does this inside a transaction that is **always rolled back**.
- It reads the motion context with **the exact query Pursuit Detail uses**, where the old check fabricated it.

The one placeholder failure became the two real assertions (sponsor sees the motion context, and it is marked confidential), and both pass: `motion-intel` gives 20/0. The suite stays clone-isolated. No product code, seed or canonical row changed.

**Result: `certify-world --runs 2` against a fresh template copy of the canonical world, 38 suites.**

| | |
|---|---|
| Suite runs | **76 / 76 clean** — 1,621 assertions per run, 3,242 in total, **0 failures** |
| Canonical digest | `e98b43254f98d5ec` before run 1, after run 1 and after run 2. **CERTIFICATION INTEGRITY: PASS** |
| `pursuit_demo` after the session | fingerprint `e98b43254f98d5ec` (154 tables, 1,051 rows); manifest `be0da833990ce436`, unchanged |
| Also green | `tsc` 0 · `npm test` 362/0 · production build 0 |
| Named suites | Slice 1 `vnext-context` 62/0 · 2A `vnext-coordination` 116/0 · 2B `vnext-attention` 64/0 · `today-tenant` 51/0 · `tenant-isolation` 205/0 · `demo-team` 11/0 · `value-case` 126/0 |
| Safety | No hosted write. No send activity: the send provider was unset and no send path was exercised |

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

### H1B readiness review (2026-09-14 — review only; nothing executed)

Each recorded concern was tested against the real policies and, where possible, **empirically, as the real `app_rw` login** on a scratch clone of the canonical world (every statement rolled back, clone dropped).

| # | Concern | Evidence | Classification | Why |
|---|---|---|---|---|
| 1 | Global `signal_sources` / `golden_examples` | No `org_id`. `app_rw` policies are `USING(true) WITH CHECK(true)`. `review.ts` updates source trust and copies claim + excerpt into `golden_examples` | **POST_CUTOVER / NON-BLOCKING** | The cutover does not change this behaviour: identical under the owner and `app_rw`, no failure and no new exposure (the review queue itself is tenant-scoped). It is a data-ownership decision: a tenant's excerpt retained in a platform-wide eval table. **Decide before real (non-synthetic) tenant data enters review**, not before cutover |
| 2 | Inbound email subject matching across tenants | The Resend webhook and inbound matching run on `getOwnerPool()`, which the cutover does not touch. The fallback key is participants + normalised subject, over all orgs | **POST_CUTOVER / NON-BLOCKING** | Unaffected by the cutover. External sending is off, so no replies arrive to misroute. **Must be resolved before external sending is ever enabled**: triage when the key matches threads in more than one org |
| 3 | Stored `account_digests` needing regeneration | Code fixed in H1A. The canonical world holds 0 digests, 0 routines and 0 routine runs; the seed creates none. Hosted count unknown | **SAFE_TO_VALIDATE_DURING_H1B** | Gate 1 counts digests, routines and runs, read-only. If 0: nothing to do. If >0: purge or regeneration is a **separate, approved hosted write**. It does not gate the cutover, because under `app_rw` a digest row is readable only by its own org |
| 4 | Custom `app_rw` login through the Supabase pooler | Asserted only by an unverified session log. Local proof: `app_rw` login, `rolbypassrls=false`, 0 rows with no GUC, 36/36 rooms identical | **SAFE_TO_VALIDATE_DURING_H1B** | This is Gate 3 itself, a hard stop before any Vercel change. If the pooler refuses the login, no environment changes and H1B returns to design. The fallback options are recorded under Gate 3 |
| 5 | Cross-tenant consent flows under `app_rw` | **Proven empirically; details below** | **MUST_RESOLVE_BEFORE_CUTOVER** | Under `app_rw` every partnership collaboration action fails, and consented shared reads silently lose the counterpart's data. Nothing leaks: it fails closed. But it breaks the certified partnership and joint features |

**Concern 5 in detail.** Probe run as the `app_rw` login with `app.org_id` = Vertex, on a clone:
- **Counterpart audit rows are refused.** `insert into audit_log (org_id = TD SYNNEX)` fails with `new row violates row-level security policy for table "audit_log"`.
- **The refusal kills the action.** Without a savepoint it aborts the transaction ("current transaction is aborted"). `audit()` claims it "never throws … must not roll back the action it records", but in Postgres a swallowed statement error still dooms the transaction.
- **Every handshake audits both parties**, so every one of them would roll back:
  - joint propose / accept / close;
  - overlap request / decide;
  - skill offer / accept / revoke;
  - warm intros;
  - evidence offer / decide / revoke (`auditBoth`);
  - partnership revoke;
  - list-grant offer / accept / sync / decline / revoke.
- **The counterpart's rows are invisible** (0 of each): opportunities, skills, evidence, lists. So these silently lose data:
  - `settlementStatement` (both books);
  - `sharedInSkills` / `skillsForContext`;
  - `sharedInEvidence`;
  - counterpart `joint_pursuit_events`;
  - list-grant materialisation;
  - overlap computation.
- **Admin invite redemption breaks.** An invited partnership is invisible to the org redeeming it (0 rows), so `redeemPartnershipInvite` reports "invite not found". It runs through `ownerTenant()`, which is `withTenant` plus an org-OWNER *role* check, not the owner pool. The `/join` path uses `getOwnerPool()` and is unaffected.
- **Why nothing caught it.** The rehearsal (36/36 identical) could not see this. The canonical world has no grants, shares or events, and the crawl is read-only.

**Required before Gate 5 (H1B-0, local, no hosted change).** Design options for the owner — none implemented:
- (a) `audit()` wraps its insert in a savepoint, so an audit failure truly cannot roll back the action.
- (b) Counterpart audit rows are written through a narrow SECURITY DEFINER function, `audit_partnership_event(partnership_id, org_id, …)`. It verifies that the caller is a party and that `org_id` is the counterpart.
- (c) Consent-scoped read policies, or definer functions, for the shared reads:
  - skills via accepted `skill_shares`;
  - evidence via accepted `evidence_shares`;
  - joint events of a joint pursuit the caller can see;
  - settlement rows of a partnership the caller can see;
  - list-grant materialisation from a granted list.
- (d) Invite redemption through a definer `redeem_partnership_invite(code)`, or through the owner pool with the explicit checks `/join` already uses.
- (e) A new `app_rw` consent-flow verifier: every handshake and shared read above, run as the real `app_rw` login, rollback-safe, added to certification.

(b)–(d) are a migration. Applying it to the hosted isolated database is its own approval step: Gate 1b.

**Also required before Gate 6 (code, local).** The `/api/build` posture probe: parse the role from `<role>.<ref>`, plus an opt-in live `current_user` / `rolbypassrls` probe. It is designed in § H1B and not yet implemented.

### H1B execution plan — nine gates, each hosted mutation its own approval, with explicit stop points

Scope: **the isolated vNext database `mejokqxriwyawfhawuxu` and the Vercel Preview scope of `roadmap/pursuitos-vnext` only.** Never `qifatlqxfuhwrwvpbwsc`, never Production.

Secrets are generated by the operator, stored in the Vercel / Supabase secret stores, and never printed, logged or committed. Any stop condition means: stop, report and wait. There is no improvising.

| Gate | Action | Mutation? | Pass criteria | STOP if |
|---|---|---|---|---|
| **H1B-0** (local) | Consent-flow remediation (a)–(e) and the `/api/build` posture probe. Commit. Full local certification, including the new `app_rw` consent verifier, `certify-world --runs 2` (76+ / 76+ clean) and the app_rw rehearsal | none hosted | all green; the canonical fingerprint is unchanged | anything is red |
| **1** | **Read-only hosted preflight** of `mejokqxriwyawfhawuxu`. Checks:<br>• environment identity (`demo`, `is_synthetic`);<br>• migration count;<br>• `app_rw` exists, NOLOGIN, `rolbypassrls=false`;<br>• `postgres` holds ADMIN on `app_rw`;<br>• `app_rw` grants on every table;<br>• a `_rw` policy on every `org_id` table; FORCE state;<br>• counts of `account_digests`, `routines`, `routine_runs` and org-less rows;<br>• canonical manifest digest | **no** (`BEGIN READ ONLY`) | identity is the synthetic isolated DB; grants and policies are complete; digest `be0da833990ce436` | wrong identity; a table without a grant or policy; unexpected org-less rows; digest mismatch |
| **1b** | Apply the H1B-0 migration (additive policies and definer functions; inert under the owner connection) | **YES — separate approval** | migration count +1; Gate 1 checks still pass; app unchanged (still on the owner) | apply error; any Gate 1 regression |
| **1c** | Only if Gate 1 found digests: purge or regenerate them | **YES — separate approval** | 0 stale digests | — |
| **2** | `alter role app_rw with login password '<generated secret>'`, as `postgres`, on the isolated DB only | **YES — separate approval** | `rolcanlogin=true`; nothing else about `app_rw` changed (`rolbypassrls=false`, grants identical to Gate 1) | any other attribute changed. Rollback: `alter role app_rw nologin` |
| **3** | **Prove the pooler login** from the operator machine: `app_rw.<ref>` on the transaction pooler :6543 | no (a rolled-back probe transaction) | `current_user=app_rw`, `rolbypassrls=false`. With no `app.org_id`: every tenant table returns 0. With `app.org_id`=Vertex: counts equal the owner's. A write carrying another org is refused | the login is refused. **Then no Vercel change**; H1B returns to design. Options: session pooler :5432 (not serverless-suitable), or Supavisor custom-role configuration. The Gate 2 rollback is available |
| **4** | Vercel Preview (this branch only): **add** `DATABASE_URL_OWNER` = the current owner string; redeploy | **YES — separate approval** | the build is healthy; `/api/build` still reports `postgres`; the owner paths (login, join, admin members, webhook) work; a full room crawl matches the pre-change crawl | anything differs. Rollback: remove the variable and redeploy |
| **5** | Vercel Preview: **change** `DATABASE_URL` to the `app_rw` pooler string; redeploy | **YES — separate approval** | the app boots; every room renders | a room errors or empties. Rollback: Gate 8 procedure |
| **6** | `/api/build` role and RLS posture proof | no | `database.role=app_rw`; the live probe shows `current_user=app_rw`, `rolbypassrls=false`; the project ref is parsed; the build SHA is the approved commit | any other value |
| **7** | **Hosted tenant/RLS certification.**<br>(i) Catalogue checks.<br>(ii) Room crawl, identical to the Gate 4 crawl.<br>(iii) READ_ONLY / ROLLBACK_SAFE suites (`today-tenant`, `vnext-attention`, `vnext-coordination`, `vnext-context`, `demo-team`, the `app_rw` consent verifier) with `DATABASE_URL_VERIFY` = the `app_rw` string. Each run is approved. **Planting / SEEDED_CLONE suites never run against a hosted DB.**<br>(iv) A two-org blind test through the deployed Preview (two sessions, each sees only its own org).<br>(v) The partnership and joint handshakes exercised end to end.<br>(vi) Hosted human review | only rolled-back verifier transactions | all green; zero foreign data; handshakes succeed; manifest unchanged | any leak, any broken room or handshake, any digest drift |
| **8** | **Rollback rehearsal**: set Preview `DATABASE_URL` back to the owner string, redeploy, confirm (`/api/build` → `postgres`, crawl identical). Then re-apply `app_rw` | **YES — two separate approvals** | rollback and re-apply both clean | rollback does not restore service |
| **9** | **Pilot-readiness decision** (owner) | none | Gates 1–8 evidence reviewed. Concerns 1 and 2 have an owner decision, or a plan that lands before real data or sending. H1 is marked COMPLETE only here | any open MUST item |

Production is outside H1B. Promoting the same posture to a production project is a separate plan, with its own approvals.

### Gate 1 — read-only hosted preflight: RESULT (2026-09-15T02:40:43Z–02:41:31Z)

**Verdict: PASS AFTER DOCUMENTED RE-BASELINE.**

As run, Gate 1 failed one criterion: the hosted manifest digest differed from the pristine canonical `be0da833990ce436`. The difference was fully explained as Slice 2A human-acceptance residue. The owner then chose **re-baseline, not reseed** (2026-09-15): the hosted vNext world deliberately carries its Slice 2A / 2B acceptance history, and it must not be erased.

**Hosted baseline of record, for Gates 1b–8:**
- manifest **`db1f78f7a11bbacb`**;
- whole-world fingerprint **`2678f34d4fc7b0a2`** (155 tables, 1,165 rows).

Every other Gate 1 criterion passed as run. Gate 1b and every later gate were **not** begun.

**How it ran.** A read-only preflight script, kept in the session scratchpad and never committed:
- The target string was read in-process only, never printed, logged or persisted. Only the non-secret project ref, host, port and role were reported.
- Identity was proven from the parsed user **before any connection**.
- Every hosted query ran in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, using savepoints, and was rolled back.
- The same script ran against the local canonical world, and the two reports were diffed.
- `qifatlqxfuhwrwvpbwsc` was never contacted.

| Check | Result |
|---|---|
| **A. Identity** | Parsed user `postgres.mejokqxriwyawfhawuxu`, not `qifatlqxfuhwrwvpbwsc`. Transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`; PG 17.6. `environment_identity`: `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview". **PASS** |
| **B. Migrations** | `schema_migrations` holds 103 rows, exactly the 103 files in the repo: no extras, no gaps. Latest `0103_pursuit_coordination.sql`. H1B-0 is **not** applied: no migration beyond 0103, and neither `audit_partnership_event` nor `redeem_partnership_invite` exists. **PASS** |
| **C. `app_rw`** | Exists. NOLOGIN, not superuser, `rolbypassrls=false`, NOINHERIT; no CREATEROLE, CREATEDB or replication; no connection limit, no expiry; member of no role. `postgres` holds it with `admin_option=true`, `inherit_option=false`, `set_option=false`, granted by `supabase_admin`. The connecting role `postgres` is not superuser, has `rolbypassrls=true`, and has CREATEROLE. All exactly as documented (§ H1B facts). **PASS** |
| **D. RLS / grants** | 155 public tables: **RLS enabled on 155, FORCE on 155**. All 88 `org_id` tables carry an `app_rw` policy; 153 of 155 tables do. The two without one are `environment_identity`, read only by operator scripts on the owner string, and `schema_migrations`, the migration tracker. `app_rw` has SELECT and INSERT on every table and USAGE on every sequence (there are none), and EXECUTE on the six RLS helpers and resolvers. Table-level UPDATE and DELETE are withheld on the six append-only history tables by design. Column-level UPDATE covers exactly the columns the application changes: goal / plan `status`, `updated_at` and `decided_*`; invocation `status` / `executed_at`; override convergence. The catalogue is **identical, table for table, to the certified local world**, apart from the hosted-only migration tracker. **PASS — no gap** |
| **E. Stored derived data** | `account_digests` **0** · `routines` **0** · `routine_runs` **0** · `pipeline_snapshots` 0, so no polluted pre-H1A snapshot exists · `engagement_scores` 0 · campaign-engagement evidence 0 · `golden_examples` 0 · `signal_sources` 0 · `review_queue` 0 · `crm_writebacks` 0 · `ask_exchanges` 12, the same as the canonical seed. **Gate 1c is not needed.** **PASS** |
| **F. Null / legacy / orphan data** | Null `org_id` across the 88 org tables: only `pursuit_team_requirements` = 5, the five canonical *global* team roles, by design and identical locally. Rows pointing at a missing org: 0. Parent/child org mismatches across 131 FKs: only `pursuit_participants → pursuits` = 2, participants from another org by design, identical locally. Child rows without an org-owned parent: 0 across all eight checks (touches, campaign lists and partners, messages, email events, population members, MEDDPICC, stage transitions). **PASS** |
| **G. Canonical world** | 3 organizations · 14 companies · 19 opportunities · 11 open · **$8,040,000** open pipeline · 14 pursuits, all 14 `DEMO` · 5 team requirements · 45 team members · 1 `org_members` row (the operator membership, by design). **Manifest `db1f78f7a11bbacb` ≠ documented `be0da833990ce436` → FAIL**, explained below. Hosted whole-world fingerprint: `2678f34d4fc7b0a2` (155 tables, 1,165 rows). It is not comparable with the local fingerprint, because ids and timestamps differ between environments; it is recorded as the hosted baseline for later gates |
| **H. Partnership / consent baseline** | 1 active partnership · 1 joint pursuit · 4 ACTIVE pursuit participants · 2 context grants. **0** list grants, overlap probes, evidence shares, skill shares, joint-pursuit events, warm intros, joint or partner playbooks, initiatives, or `audit_log` rows (partnership-linked or otherwise). H1B-0 policy and definer-function work would therefore touch almost no live Preview data: no consent artifact exists that a policy change could strand |
| **I. Send safety** | `messages`, `action_outbox`, `email_events`, `sending_identities`, `communication_threads`, sent touches and scheduled touches: all 0. In the operator shell, `OUTREACH_AUTOSEND` and `RESEND_API_KEY` are unset; this was checked by name only and both were also unset for every command. No send path was invoked. The Vercel scope was not read or changed. **PASS** |
| **J. Zero-write proof** | Both hosted transactions reported `transaction_read_only=on` and `txid_current_if_assigned()=NULL`, so no transaction id was ever assigned. Manifest `db1f78f7a11bbacb` before and after. Fingerprint `2678f34d4fc7b0a2` before and after. Catalogue hash `9cafa147676fa8c3` before and after, covering roles, members, grants and policies. Migrations 103 before and after. **PASS — Gate 1 changed nothing** |

**The manifest difference, fully explained.** The digests differ in exactly one manifest field: `stakeholders`, 5 hosted vs 4 canonical. The fifth row is the Globex hero's economic buyer, source `human:pursuit-detail`, verified, asserted 2026-09-14T21:50:44Z. The same window holds:
- a plan DECISION revision and an ACTION_CREATED entry (21:45:50Z);
- PLAN_REVIEW_REQUIRED (21:53:28Z);
- a third plan revision;
- a sixth motion action.

These are the owner's **documented Slice 2A human-acceptance steps 3, 4, 6, 8 and 10** (`ACCEPTANCE.md` § Slice 2A human product acceptance) — certification residue on the hosted world, not drift or corruption. Nothing about it bears on the tenant or RLS posture.

**Owner decision (taken 2026-09-15): (a) RE-BASELINE.** The hosted baseline of record is manifest `db1f78f7a11bbacb` and fingerprint `2678f34d4fc7b0a2`. This is intentional acceptance-state residue, not unexplained drift, and it is not to be erased. The options as they were put:
- **(a) Re-baseline.** Record `db1f78f7a11bbacb` and fingerprint `2678f34d4fc7b0a2` as the hosted post-acceptance baseline, and use them as the comparison point for Gates 1b–8. This is documentation only, with no hosted write.
- **(b) Restore the canonical world.** Reseed the hosted world to canonical `be0da833990ce436`. This is a hosted write, a separate approval, and it would erase the acceptance history.

(a) is recommended: the accepted state is the certified Slice 2A/2B world as a person actually left it.

---

## H1B-0 — partnership / consent flows under `app_rw` + the Gate 6 posture proof (2026-09-15, LOCAL)

**Status: COMPLETE (local).** Migration `0104_h1b0_consent_scoped_access.sql` is **NOT applied to any hosted database**; applying it is Gate 1b, a separate approval. Decision D-049.

### Root causes (inventory of every cross-party statement, confirmed as the real `app_rw` login)

1. **Audit abort.** Every handshake writes a row into the counterpart's `audit_log`. RLS refuses it. `audit()` swallowed the error *without a savepoint*, so the transaction stayed aborted and the request's `COMMIT` became a `ROLLBACK`: **the UI reported success for an action that never happened.** This hit invites, list grants, overlap probes, skill and evidence shares (evidence shares threw instead, through a raw insert), warm intros, joint pursuits, joint playbooks and partnership revoke.
2. **Consented data invisible.** Under `app_rw` the counterpart's rows are invisible, even when a live consent object authorises the read. The affected reads were:
   - the shared list and its members (accept / sync / grant views);
   - the counterpart's book for overlap computation, which came back *silently wrong*;
   - shared evidence and shared skills;
   - the counterpart's and the broker's joint-room lines;
   - the counterpart's settlement deals;
   - the invite being redeemed.

   Also: broker lines, which carry no org, were refused, and revocation silently left the receiver's materialised copy live.
3. **Forgeable consent (found by the inventory).** Under `app_rw` the consent tables' policies checked only that the caller could see the partnership. They never checked who the actor column named, and never checked transitions. A party could therefore:
   - forge a pre-activated partnership or re-point its counterpart;
   - forge a list grant, evidence share or skill share of the *other* org's object and accept it;
   - approve its own overlap probe with fabricated results;
   - forge a context grant "from" the other org.

   Any function trusting those rows would have turned forgery into exfiltration.

### Design (D-049)

| Need | Mechanism (0104) | Scope it enforces |
|---|---|---|
| Counterpart audit rows | `audit_partnership_event(pid, org, actor, event, detail)` + SAVEPOINT in `audit()` | writes only for a party of that partnership, only when the caller is a party; event name validated; a failed audit rolls back to its savepoint and is logged |
| Invite redemption (pre-membership) | `redeem_partnership_invite(code)` | the one invited partnership with that code, as the caller's org; cannot list or discover; `/join` keeps the owner pool |
| List grants | `list_grant_source_state(grant)` · `sync_list_grant_members(grant)` · `revoke_list_grant_copies(pid, grant?)` | name, category and counts only, to a party · copy only an ACCEPTED grant on an ACTIVE partnership into its own receiver copy, granted fields only · reject only copies of REVOKED grants |
| Overlap ladder | `decide_overlap_probe(probe, approve)` (+ internal `h1b_overlap_results`) | the counterpart of the requester decides; only the rung's aggregate is stored; raw books never leave the database; ACTIVE partnership only |
| Evidence shares | `partnership_evidence_shares(pid)` · `shared_in_evidence(company)` | claim, source type, observed date and account only (never excerpt, URL or verification); accepted shares on ACTIVE partnerships |
| Skill shares | `partnership_skill_shares(pid)` · `shared_in_skills()` · `skill_share_subject(share)` · `h1b_skill_owner(skill)` | a party to the share's partnership; accepted and active for shared-in reads |
| Broker line | `record_broker_event(pursuit, body, detail)` | an ACTIVE room of the caller's own partnership |
| Settlement | `partnership_settlement_rows(pid)` | both books, ONLY opportunities on this partnership's jointly pursued accounts, ONLY to a party — which also closes the old "no party check" gap |
| Joint-room ledger (symmetric by design) | SELECT policy via the visible joint pursuit; INSERT with `org_id = app_current_org()`; no UPDATE / DELETE | whole lines of a room the caller can see |
| Organisations | SELECT `true`; UPDATE own row only; no INSERT / DELETE for `app_rw` | provisioning stays owner-path |
| Forgery | `h1b_consent_guard` trigger on 8 consent tables, `app_rw` only | actor columns = the caller's org; only product transitions; disclosing approvals only through functions; no deletes except the product's own |

Every function is SECURITY DEFINER with a pinned `search_path`. EXECUTE is revoked from PUBLIC and the Supabase API roles; 14 are granted to `app_rw`, and 5 internal helpers to no one.

**Invite redemption, specifically.** `ownerTenant()` was audited: it is `withTenant` plus an org-**owner role** check, and it runs on the tenant connection, not the owner pool. That is why admin redemption broke under `app_rw`. The operation is legitimately pre-membership, so it moved to the narrow function rather than the owner pool. The `/join` path keeps `getOwnerPool()` and therefore still needs `DATABASE_URL_OWNER` at cutover, per the Gate 4 order.

### Proof

- **`partnership-app-rw` (new; SEEDED, seeded clone, one rolled-back transaction, the REAL `app_rw` login): 117 / 0.**
  - Per section: posture 2, partnership 9, context grant 8, list grant 13, overlap 14, evidence 12, skill 15, warm intro 8, joint pursuit 12, settlement 4, audit 5, revoke 10, organisations and context 3, residue 2.
  - Every forged-row refusal is refused by the intended mechanism, each with its own message.
- **Negative control: the same verifier with the guard trigger dropped.** It FAILS:
  - forged partnership rows, a re-pointed counterpart, a forged context grant and fabricated probe results are all **accepted**;
  - the re-pointed counterpart then **cascades**, letting the third party decide a probe.

  The guard is load-bearing.
- **Room rehearsal (`app-rw-rehearsal`, with the consent fixture):** **38 / 38 rooms are identical** under `app_rw` (RLS binding) and the owner. That includes:
  - Today, Queue and Pursuit Detail (Slice 1 / 2A / 2B);
  - every partnership room, the joint room and the jointly pursued account.

  A committed TD SYNNEX → sponsor consent fixture on the rehearsal clone **renders under both roles, 6 / 6**: the counterpart's joint-room line, the broker line, the settlement deal from the counterpart's book, the shared skill, the shared evidence claim and the incoming list grant. Without 0104, all six are invisible under `app_rw`.

  **`/api/build` posture, read from the running process:**
  - owner: `role: postgres`, `bypassRls: true`, `tenantEnforcement: false`;
  - `app_rw`: `role: app_rw`, `bypassRls: false`, `tenantEnforcement: true`.

  That is the Gate 6 success condition, rehearsed.
- **Certification:** `certify-world --runs 2` **78 / 78 suite runs clean** (39 suites incl. `partnership-app-rw`; 3,476 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.

### Not changed (recorded)

- Org-less `evidence` (none in either world) is invisible under `app_rw` wherever it appears. That follows from the existing policy, and is not specific to partnerships.
- `companies_rw` stays `FOR ALL USING(true)`, a writable shared catalogue. That concerns catalogue integrity (the H1A note on intake enrichment), not consent.
- `can_see_partnership` still shows history on revoked partnerships. Every consent-scoped *content* read above requires an ACTIVE partnership for counterpart data.

---

## Gate 1b — apply 0104 to the isolated hosted database: RESULT (2026-09-15)

**Verdict: PASS.** Exactly one approved mutation was made: migration `0104_h1b0_consent_scoped_access.sql`, committed at `22e9666` (sha256 prefix `db306e40779f9826`, not hand-edited), applied to **`mejokqxriwyawfhawuxu` only**. It went through the repo's own runner (`scripts/migrate.ts`), in one transaction together with its tracker row.

What was **not** done: no `app_rw` login or password, no Vercel change, no deploy, no `DATABASE_URL` or `DATABASE_URL_OWNER` change, no Gate 2 or 3, no hosted plant-row verifier, no sending, no reseed. Production and `qifatlqxfuhwrwvpbwsc` were not contacted.

**How it ran.**
- A guarded wrapper, as for Gate 1: the target was proven from the parsed user before any connection, every other database, `PG*` and send variable was unset, and output was redacted.
- The target string was never printed, logged or persisted.
- Pre- and post-snapshots each ran in one `REPEATABLE READ READ ONLY` transaction; both reported `txid_current_if_assigned() = NULL`.
- The migration command re-checked the pre-snapshot and re-proved identity immediately before running.

| Check | Pre (read-only) | Post (read-only) |
|---|---|---|
| Identity | `postgres.mejokqxriwyawfhawuxu`; not `qifatlqxfuhwrwvpbwsc`; `demo` / `is_synthetic=true` | same |
| Migrations | 103, latest `0103_pursuit_coordination.sql`; pending exactly `{0104}`; none applied beyond the repo | **104**, latest **`0104_h1b0_consent_scoped_access.sql`**; pending none; +1 migration exactly |
| Manifest | `db1f78f7a11bbacb` | **`db1f78f7a11bbacb`**, unchanged |
| Whole-world fingerprint | `2678f34d4fc7b0a2` (155 tables) | `0288ae73bb385a1c`. The **only** table whose hash changed is `schema_migrations` (103 → 104 rows, the intended tracker entry). Business data, meaning all 154 other tables, is identical: the business-data fingerprint (every table except `schema_migrations`) is **`79321d9130d1dc94` both pre and post** |
| Snapshot times | 2026-09-15T03:52:29Z | 2026-09-15T03:53:20Z; security-catalogue hash `bac4f4a1af3ef7c9` → `b36da6987ceabfdf` (0104's objects only) |
| Business counts | 3 · 14 · 19 · 11 open · $8,040,000 · 14 · 5 stakeholders | identical |
| Partnership state | 1 active partnership · 1 joint pursuit · 4 ACTIVE participants · 2 context grants · 0 list grants / probes / evidence shares / skill shares / joint events / warm intros / audit rows | identical |
| Send | 0 messages / outbox / email events / sending identities / sent touches; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` unset | identical; no send operation run |
| `app_rw` | exists; **LOGIN false**; not superuser; not BYPASSRLS; NOINHERIT; no expiry; `postgres` holds it ADMIN-only (inherit false, set false), granted by `supabase_admin` | **identical — Gate 2 NOT performed** |

**Security-object delta, pre → post (hosted catalogue).** These are exactly 0104's objects and nothing else:

| Object | Delta |
|---|---|
| Functions | **+19**: the 14 app-callable ones (`audit_partnership_event`, `redeem_partnership_invite`, `list_grant_source_state`, `sync_list_grant_members`, `revoke_list_grant_copies`, `decide_overlap_probe`, `partnership_evidence_shares`, `shared_in_evidence`, `partnership_skill_shares`, `shared_in_skills`, `skill_share_subject`, `record_broker_event`, `partnership_settlement_rows`, `h1b_skill_owner`) and the 5 internal ones (`h1b_consent_party`, `h1b_consent_allowed`, `h1b_org_book`, `h1b_overlap_results`, `h1b_consent_guard`). None removed or changed |
| Triggers | **+8** `h1b_consent_guard` (BEFORE INSERT OR UPDATE OR DELETE, enabled) on `context_grants`, `evidence_shares`, `joint_pursuits`, `list_grants`, `overlap_probes`, `partnerships`, `skill_shares`, `warm_intro_requests` |
| Policies | **+2** (`joint_pursuit_events_rw_insert`, `organizations_rw_update`) and **2 narrowed**: `joint_pursuit_events_rw` FOR ALL → FOR SELECT (object-scoped via the visible joint pursuit); `organizations_rw` FOR ALL → FOR SELECT. No other policy changed, and no new broad policy |
| RLS / FORCE flags · table grants · column grants · roles · memberships | **no change** |

**SECURITY DEFINER safety, read from the hosted catalogue.**
- All 18 definer functions are **owned by `postgres`**, **SECURITY DEFINER**, with **`search_path=public` pinned**.
- `h1b_consent_guard` is **SECURITY INVOKER** by design, so that inside the trigger `current_user` is the acting role. It is owned by `postgres` with `search_path` pinned too.
- EXECUTE on all 19: **PUBLIC false · anon false · authenticated false · service_role false**.
- `app_rw` has EXECUTE on **exactly the 14 runtime functions**, and **false on all 5 internal helpers**.

**Hosted versus the local certified post-0104 catalogue.**
- The 19 functions, the 8 triggers and **every public policy are identical**.
- The remaining differences are pre-existing environment facts that 0104 did not touch (the pre → post delta shows none of them changing):
  - Supabase installs pgcrypto in `extensions`, not `public`, and pgvector's function metadata differs;
  - Supabase's default table grants to anon, authenticated and service_role;
  - the hosted-only `schema_migrations`;
  - local `app_rw` has its local demo LOGIN, while hosted is NOLOGIN with the ADMIN-only membership;
  - the acceptance-residue stakeholder.

**Rollback readiness** (not executed). The migration's rollback section expects:
- drop `h1b_consent_guard` on the 8 tables — the hosted catalogue has exactly those 8;
- drop the 14 app-callable plus 5 internal functions — exactly those 19 exist;
- restore `joint_pursuit_events_rw` and `organizations_rw` as FOR ALL, and drop the two added policies — those 4 policies exist exactly as described.

That is a match. The rollback is documented prose, not a script. If it is ever needed, it is a separate approved hosted change. The application works on the owner connection with or without 0104.

**Hosted baseline of record after Gate 1b:**
- manifest `db1f78f7a11bbacb`;
- whole-world fingerprint `0288ae73bb385a1c`, including the tracker at 104;
- business data identical to Gate 1.

**Gate 2 was NOT begun.** `app_rw` remains NOLOGIN.

---

## Gate 2 — give `app_rw` LOGIN: PRECHECK BLOCKED, NOT EXECUTED (2026-09-15)

*(Superseded: both blockers were resolved and the Gate 2 re-run passed — see § "Gate 2 (re-run)" at the end.)*

**Verdict: BLOCKED before the mutation. No hosted change was made.** `app_rw` is still NOLOGIN. Every hosted read ran in a READ ONLY transaction with `txid_current_if_assigned() = NULL`.

### Pre-mutation identity checks: all 8 passed

| # | Check | Result |
|---|---|---|
| 1 | Target identity | `postgres.mejokqxriwyawfhawuxu`, host `aws-0-ca-central-1.pooler.supabase.com:6543` |
| 2 | Not the forbidden project | does not contain `qifatlqxfuhwrwvpbwsc` |
| 3 | Environment identity | `demo` / `is_synthetic=true` |
| 4 | Migration count | 104 |
| 5 | Latest migration | `0104_h1b0_consent_scoped_access.sql` |
| 6 | Manifest | `db1f78f7a11bbacb` |
| 7 | Business-data fingerprint (excluding `schema_migrations`) | `79321d9130d1dc94` |
| 8 | `app_rw` LOGIN | false |

Whole-world fingerprint: `0288ae73bb385a1c`.

**Pre-change role baseline, recorded for the Gate 2 comparison.**
- `app_rw`: LOGIN false, SUPERUSER false, BYPASSRLS false, INHERIT false, CREATEROLE false, CREATEDB false, REPLICATION false, connection limit −1, no expiry.
- Member of no role.
- `postgres` holds it with ADMIN true, INHERIT false and SET false, granted by `supabase_admin`.
- Its table, column and function grants are the Gate 1b set; security-catalogue hash `b36da6987ceabfdf`.

### Blocker 1: the operator secret is not loaded

`APP_RW_PASSWORD` is not present in this session's environment; presence was checked by name only. No password was generated. A generated secret would either have to be displayed or be lost before Gate 3 and Gate 5, and in either case it would not be under operator control.

### Blocker 2: SECURITY DEFINER name resolution can be influenced through `pg_temp`

**Schema CREATE on `public` passes.** The only role that can create there is the owner (`pg_database_owner`, which `postgres` holds).

| Role | CREATE on `public` |
|---|---|
| PUBLIC | no (USAGE only) |
| `app_rw` | no |
| `anon` | no |
| `authenticated` | no |
| `service_role` | no |

`app_rw` is a member of no role, so there is no indirect path, and it can CREATE in no other schema.

**But `pg_temp` shadowing is possible.** PUBLIC holds `TEMPORARY` on the database, so `app_rw`, `anon`, `authenticated` and `service_role` can all create temporary tables. PostgreSQL searches the session's temporary schema **first** for tables whenever `pg_temp` is not listed in `search_path`. A pinned `search_path=public` therefore does not prevent shadowing. The PostgreSQL documentation's guidance for SECURITY DEFINER functions is to list `pg_temp` last.

**Proven locally, as the real `app_rw` login, on a throwaway clone.** Meridian, which is not a party to the Vertex ↔ TD SYNNEX partnership, created a temp `partnerships` table naming itself a party:
- `partnership_settlement_rows(P1)` went from **0 rows** to **2 rows** of Vertex's settlement data;
- `record_broker_event` into the Vertex ↔ TD SYNNEX room went from **refused** to **allowed**.

**The fix, also proven locally on the same clone.** With `search_path = pg_catalog, public, pg_temp` on the functions involved, the same shadow is ineffective: the read returns **0 rows**, and the write is **refused**.

**Scope, read from the hosted catalogue.** 27 functions in `public` pin `search_path=public`:
- the **18 SECURITY DEFINER functions from 0104**;
- **8 pre-existing SECURITY DEFINER functions**: `can_see_partnership`, `can_see_pursuit`, `grant_is_live`, `grant_population_delete_guard`, `is_org_member`, `org_role`, `resolve_api_key`, `resolve_user_org`;
- the **SECURITY INVOKER** guard `h1b_consent_guard()`.

The pre-existing 8 include the RLS helpers every `_rw` policy uses. The gap therefore predates 0104; 0104 inherited the pattern. Today it has no exposure, because `app_rw` cannot log in and the app runs as the owner.

**Severity assessment.**
- Exploiting it needs arbitrary SQL as a database role: a temp table must be created. The application issues no such statement, and PostgREST (anon / authenticated) cannot issue DDL.
- Under the H1B threat model, RLS guards against application query bugs. An arbitrary-SQL `app_rw` session can already set `app.org_id` to any org, so shadowing adds little *practical* power beyond that impersonation.
- It does, however, break the Gate 2 precondition as stated ("no … way that would let an app_rw caller influence SECURITY DEFINER name resolution"). It also defeats the consent guard's and the definer functions' own validation, which is the layer H1B-0 relies on.
- **It is not clearly proven safe, so Gate 2 stops.**

### Recommendation (not implemented; owner decision)

1. **Follow-up hardening migration `0105`** (additive; zero data change):
   - `ALTER FUNCTION … SET search_path = pg_catalog, public, pg_temp` for all 27 functions above;
   - optionally, also schema-qualify table references in the 0104 function bodies.
2. **Certify 0105 locally in full:**
   - a new shadowing negative test in `partnership-app-rw`, which must fail before 0105 and pass after;
   - `certify-world --runs 2`;
   - the `app_rw` rehearsal.
3. **Apply 0105 to `mejokqxriwyawfhawuxu`** as its own approved hosted step, before Gate 2.
4. **Not recommended:** revoking `TEMPORARY` from PUBLIC at database level. It is a broader grant change, and Supabase platform roles may rely on it. The function-level fix is the standard control and is sufficient.

### Loading the operator secret (for the Gate 2 re-run)

- **Never paste it into chat.** Generate the `app_rw` password in the operator's password manager / secret store, where it must stay available for Gates 3 and 5.
- **Expose it to the Claude Code process** through the same mechanism that supplies `DEMO_TARGET_URL`: in the terminal that launches the session, `read -rs APP_RW_PASSWORD && export APP_RW_PASSWORD` (hidden input), then relaunch or resume the session so it is inherited.
- **Each tool command starts a fresh shell**, so a variable exported inside the session does not persist.
- **The Gate 2 command will read it from the process environment** and send it only as a bound query parameter over the database connection. It never appears on a command line, in output, or in a file.

**Next:** the owner decides on 0105. The Gate 2 re-run requires 0105 applied, or an explicit, documented owner acceptance of the residual risk, *and* the secret loaded.

**Owner decision (2026-09-15):** the risk is **not accepted** (D-050). 0105 is built and certified locally as H1B-0.1, below. Gate 2 stays **BLOCKED / NOT EXECUTED** until 0105 is applied to the hosted target (Gate 1b.1) and the secret is loaded.

---

## H1B-0.1 — temporary-schema hardening, migration 0105 (2026-09-15, LOCAL)

**Status: COMPLETE (local).** Decision D-050. `0105_h1b01_temp_schema_hardening.sql` was later applied to `mejokqxriwyawfhawuxu` only, at Gate 1b.1 (PASS; see § "Gate 1b.1").

### Root cause

PostgreSQL resolves unqualified relation and type names in a function body at run time, using the effective `search_path`. When `pg_temp` is not named in that path, the session's temporary schema is searched **first**, and PUBLIC holds TEMPORARY. So any caller, `app_rw` included, could create a temp table named like a real one and rewrite what an authorization function reads.

Policy expressions, views and triggers' `WHEN` clauses are **not** affected: their relation references are bound to object IDs at creation. Function bodies are.

### Complete inventory (derived from the catalogue, not the earlier list)

Every plpgsql / SQL function in `public` was classified:

| Class | Functions | Before 0105 | Reads relations or types? | Hardened |
|---|---|---|---|---|
| SECURITY DEFINER — older RLS / tenant / grant / API-key helpers (8) | `is_org_member`, `org_role`, `can_see_partnership`, `can_see_pursuit`, `grant_is_live`, `grant_population_delete_guard` (trigger), `resolve_api_key`, `resolve_user_org` | `search_path=public` | yes; the first four are called by RLS policies | yes |
| SECURITY DEFINER — H1B-0 (0104) (18) | the 14 runtime functions + `h1b_consent_party`, `h1b_consent_allowed`, `h1b_org_book`, `h1b_overlap_results` | `search_path=public` | yes (except `h1b_consent_allowed`, which only calls `h1b_consent_party`; hardened for a uniform rule) | yes |
| INVOKER, called directly by RLS policies (1) | `app_current_org()` | none | its `::uuid` cast is type-resolved (a temp table named `uuid` shadows it) | yes → `pg_catalog, pg_temp` |
| INVOKER guard triggers (4) | `h1b_consent_guard` (8 consent tables) | `search_path=public` | yes | yes |
| | `enforce_verified_evidence` (signals) | **none** | yes (`evidence`) | yes |
| | `economic_fact_assertion_guard` (facts) | **none** | yes (`fact_predicates`) | yes |
| | `stakeholder_assertion_guard` (stakeholders) | **none** | no; it reads only a setting, so it is not exploitable. Hardened for a uniform rule | yes |
| **Total** | **31** — 27 previously known + `app_current_org` and 3 guard triggers not on the list | | | **31** |

- **Owners.** Every function is owned by `postgres`, the owner of the `public` tables.
- **No other plpgsql / SQL function exists in `public`.** The rest are C functions from extensions.
- **Callers.** All the H1B-0 functions derive the caller's org from `app_current_org()` (trusted server context). The older helpers take the org or user being *tested* as an argument, not as authority.

### Migration 0105

- **30 functions** get `ALTER FUNCTION … SET search_path = pg_catalog, public, pg_temp`. **`app_current_org()`** gets `pg_catalog, pg_temp`. That is **31** in total.
- **Nothing else changes:** no function body, owner, EXECUTE grant, policy, table or row. It is idempotent.
- **Documented rollback:** 31 machine-readable `-- ROLLBACK:` lines, restoring `search_path=public` on 27 and `RESET` on 4.
- **Why not schema-qualify:** qualifying the function bodies was considered and not done. With `pg_temp` last and `public` non-writable it adds no protection, and re-creating 31 certified bodies would risk drift.
- **The assumption it relies on:** no runtime role can CREATE in `public`. Verified on the hosted target at the Gate 2 precheck; asserted on every certification run.

### Exploit battery — `search-path` (new; SEEDED, seeded clone, as the REAL `app_rw` login)

| # | Exploit | Before 0105 (negative control) | After 0105 |
|---|---|---|---|
| 1 | Temp `partnerships`: a non-party reads another org's settlement rows | **succeeds** (0 → 2 rows) | 0 rows |
| 2 | Temp `partnerships`: a non-party writes a broker line into another partnership | **succeeds** | refused |
| 3 | Temp `partnerships`: a non-party injects a list grant through `can_see_partnership` (RLS) | **succeeds** | refused by RLS |
| 4 | Temp `org_members` + a chosen JWT subject: `is_org_member` admits another org (the other org's pursuits become visible) | **succeeds** | 0 visible |
| 5 | Temp `org_members`: `org_role` → `owner` of another org | **succeeds** | none |
| 6 | Temp `org_members`: `resolve_user_org` resolves into another org | **succeeds** | no |
| 7 | Temp `pursuits`: `can_see_pursuit` on another org's pursuit | **succeeds** | false |
| 8 | Temp `context_grants`: `grant_is_live` flips a real grant | **succeeds** | unchanged |
| 9 | Temp `api_keys`: `resolve_api_key` resolves a forged key to another org | **succeeds** | 0 keys |
| 10 | Temp table named `uuid`: bends or breaks RLS evaluation | **succeeds** | own pursuits unchanged |
| 11 | Temp `evidence`: a signal cites unverified evidence (`enforce_verified_evidence`) | **succeeds** | refused by the guard |

Further checks:
- **The negative control** executes 0105's documented rollback lines on the clone. The guard then flags **31 / 31**, and every exploit succeeds, so the suite demonstrably fails without 0105. That also certifies the rollback text itself.
- **After 0105** the guard finds **0 / 31** unsafe.
- **Guard self-test:** a helper re-pinned to `public`, and a new SECURITY DEFINER function with no path, are both flagged.
- **Assumptions:**
  - no CREATE on `public` for PUBLIC, `app_rw`, anon, authenticated or service_role, and no membership path;
  - every protected function owned by `postgres`;
  - H1B-0 runtime functions EXECUTE-able by `app_rw` only;
  - internal helpers by no runtime role.
- **Result: 39 / 0.**

The static twin, `tests/migration-search-path.test.ts` (in `npm test`), replays the whole migration chain. It finds the 31 protected functions and fails if any ends the chain unsafe.

**EXECUTE review of the older helpers (pre-existing, not changed, not broadened).** On hosted (from the Gate 1b snapshot), the 8 older helpers and `app_current_org` are EXECUTE-able by PUBLIC, and so by anon, authenticated and service_role. That is the PostgreSQL default, never revoked.
- **authenticated needs it:** 206 `authenticated`-role policies call `is_org_member`, `org_role` or `can_see_*`.
- **anon has no policies.** Its EXECUTE is unnecessary, but it grants nothing without a JWT, an `app.org_id` or an API-key secret.

A least-privilege narrowing of anon / PUBLIC EXECUTE is **recommended as a separate item**, outside H1B-0.1.

### Proof after 0105

- `partnership-app-rw`: **117 / 0** on the 0105-hardened world. Every authorised flow works, and every forgery is refused.
- Rehearsal: `app-rw-rehearsal` after 0105: **38 / 38 rooms identical** under `app_rw` and the owner (Today, Queue, Pursuit Detail — Slice 1 / 2A / 2B — every partnership room); consent fixture **6 / 6** rendered under both; `/api/build` posture truthful — owner `postgres` / `bypassRls: true` / `tenantEnforcement: false`, app_rw `app_rw` / `false` / `true`.
- Certification: `certify-world --runs 2` **80 / 80 suite runs clean** (40 suites incl. `search-path` 39/0 and `partnership-app-rw` 117/0; 3,554 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.
- The canonical world with 0105 applied locally has fingerprint `e98b43254f98d5ec` and manifest `be0da833990ce436`, unchanged. 0105 changes function settings only.

### If hosted Gate 1b.1 must be rolled back

Execute the 31 `-- ROLLBACK:` lines at the end of `0105_h1b01_temp_schema_hardening.sql`:
- `alter function … set search_path = public` on the 26 definers and `h1b_consent_guard`;
- `alter function … reset search_path` on `app_current_org`, `enforce_verified_evidence`, `economic_fact_assertion_guard` and `stakeholder_assertion_guard`;
- then delete the `schema_migrations` row for 0105.

This restores the exact pre-0105 catalogue. The negative control above proves these lines do exactly that. It also re-opens the vulnerability, so it is an emergency measure only.

### Local rehearsal (H1A — no hosted change)

The same cutover can be rehearsed locally today (app_rw has a local login): run the built app with `DATABASE_URL=app_rw` and `DATABASE_URL_OWNER=postgres`, crawl every room, and compare it with the owner-role crawl. See § "H1A results".

---

## Gate 1b.1 — apply 0105 to the isolated hosted database: RESULT (2026-09-15)

**Gate 1b.1 — PASS.** `0105_h1b01_temp_schema_hardening.sql` (sha256 prefix `139d7ea0cfae043f`, committed `77d9bd0`) was applied to `mejokqxriwyawfhawuxu` **only**, as the one approved mutation. It ran through the standard runner `scripts/migrate.ts`, one transaction, with no hand-edited SQL. The runner reported `applying 0105_h1b01_temp_schema_hardening.sql` · `1 applied, 104 already tracked` · exit 0.

What was **not** done: no `APP_RW_PASSWORD`, no `app_rw` LOGIN, no role password, no Vercel change, no deploy, no `DATABASE_URL` or `DATABASE_URL_OWNER` change, no Gate 2 or 3, no other migration, no manual grant or policy change, no reseed, no hosted write-path verifier, no sending. Production and `qifatlqxfuhwrwvpbwsc` were not contacted.

**How the run was guarded.**
- The target identity was parsed in-process from the connection user (`postgres.mejokqxriwyawfhawuxu`), and the connection string was checked not to contain `qifatlqxfuhwrwvpbwsc`. It was never printed.
- Every other DB, `PG*`, send and `APP_RW_PASSWORD` variable was unset for the child process.
- Output was redacted.
- Every read ran `REPEATABLE READ READ ONLY` and was rolled back, with `txid_current_if_assigned()` NULL.

### Pre-mutation checks: all 12 passed

| # | Check | Hosted value |
|---|---|---|
| 1–2 | target | `mejokqxriwyawfhawuxu`, not `qifatlqxfuhwrwvpbwsc` |
| 3 | environment | `demo`, `is_synthetic=true` |
| 4–6 | migrations | 104, latest `0104_h1b0_consent_scoped_access.sql`; pending vs repo exactly `{0105}` |
| 7 | manifest | `db1f78f7a11bbacb` |
| 8 | business-data fingerprint (excl. `schema_migrations`) | `79321d9130d1dc94` |
| 9 | whole-world fingerprint | `0288ae73bb385a1c` |
| 10–11 | `app_rw` | LOGIN false, no expiry; no credential created in this gate |
| 12 | sending | `sending_identities` 0, `touches_sent` 0; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` unset |

Pre-state of the protected class: 31 functions, **31 unsafe** (27 `search_path=public`, 4 unset). The hosted catalogue-only guard **failed as expected** before 0105, which also shows it can detect the problem on hosted.

### Post-migration verification (read-only)

| Check | Result |
|---|---|
| A. Migration state | **105**, latest `0105_h1b01_temp_schema_hardening.sql`; nothing pending; nothing applied that is not in the repo |
| B. Data immutability | manifest `db1f78f7a11bbacb` **unchanged**; business-data fingerprint `79321d9130d1dc94` **unchanged**; every business row count unchanged. The only per-table hash that changed is `schema_migrations`. **New whole-world fingerprint of record: `de05e204801988d1`** |
| C. Search path | 31 protected (catalogue-derived; the same set as before): **30** `pg_catalog, public, pg_temp`; `app_current_org()` `pg_catalog, pg_temp`; **0 unsafe** |
| D. Only `search_path` changed | 31 functions changed, and the only field that changed is `config`. Bodies (md5), owners (`postgres`), SECURITY DEFINER / INVOKER and EXECUTE flags (PUBLIC, anon, authenticated, service_role, `app_rw`) are identical. The 14 H1B runtime functions are `app_rw`-only; the 5 internal helpers are executable by no runtime role; the 8 older helpers and `app_current_org` keep their pre-existing grants. Nothing was broadened |
| E. CREATE on `public` | none for PUBLIC, `app_rw`, anon, authenticated or service_role; no membership path for `app_rw` |
| F. Catalogue guard | `search-path-verify --catalogue-only` on hosted: **12 / 0**, READ ONLY, no txid, no temp tables |
| G. Unchanged | RLS / FORCE flags, policies, table grants, column grants, triggers (the 8 consent guards included), roles, memberships, CREATE facts |
| H. `app_rw` posture | LOGIN **false**, not superuser, no BYPASSRLS, NOINHERIT, no expiry; `postgres` still holds it ADMIN-only (inherit false, set false), granted by `supabase_admin`. **Gate 2 not performed** |
| I. Partnership data | 1 active partnership, 1 joint pursuit, 4 active participants, 2 context grants; 0 list grants, overlap probes, evidence shares, skill shares, joint-room notes, warm intros, partnership audit rows |
| J. Send safety | 0 sending identities, 0 touches sent; nothing armed |
| K. Security-object delta | exactly **one tracker row** (0105) plus **`proconfig` on the 31 protected functions**. The security-catalogue hash moves `dd5412662349688c` → `4682f232e8392034`, and that change is entirely accounted for by those `proconfig` values. Nothing else |

Classification of the 31 (the classes overlap):
- 26 SECURITY DEFINER (the 8 older helpers and the 18 from 0104);
- 5 called by RLS policies (`is_org_member`, `org_role`, `can_see_partnership`, `can_see_pursuit`, `app_current_org`);
- 5 trigger functions (`grant_population_delete_guard`, `h1b_consent_guard`, `enforce_verified_evidence`, `economic_fact_assertion_guard`, `stakeholder_assertion_guard`).

**New tooling.** `scripts/search-path-verify.ts --catalogue-only` is the hosted-safe subset of the certified suite:
- it runs the catalogue guard and the CREATE / owner / EXECUTE assumptions in one READ ONLY transaction;
- it creates no temp tables and needs no `app_rw` login;
- locally, against `pursuit_demo`, it gives 12 / 0.

### Rollback readiness (not executed)

- The 31 `-- ROLLBACK:` lines in 0105 name exactly the hosted protected set.
- Each line restores the recorded hosted pre-0105 value: `set search_path = public` on 27, and `reset search_path` on the 4 that were unset (`app_current_org`, `enforce_verified_evidence`, `economic_fact_assertion_guard`, `stakeholder_assertion_guard`). The `schema_migrations` row for 0105 would then be deleted.
- It was **not** run, because it would re-open the vulnerability.

**Hosted baseline of record after Gate 1b.1:**
- migrations 105;
- manifest `db1f78f7a11bbacb`;
- business-data fingerprint `79321d9130d1dc94`;
- whole-world fingerprint `de05e204801988d1`;
- `app_rw` LOGIN false.

**Gate 2 was NOT begun.** Its blocker 2 (`pg_temp` shadowing) is closed on hosted. Blocker 1 remains until the operator loads `APP_RW_PASSWORD` via hidden input (`read -rs APP_RW_PASSWORD && export APP_RW_PASSWORD`) in the launching shell and relaunches. H1B, and so H1, are not complete.

---

## Gate 2 (re-run) — give `app_rw` LOGIN: RESULT (2026-09-15)

**Gate 2 — PASS.** Exactly one approved mutation, on `mejokqxriwyawfhawuxu` **only**: semantically `ALTER ROLE app_rw WITH LOGIN PASSWORD <APP_RW_PASSWORD>`, run as `postgres`, which holds ADMIN on `app_rw`. It committed between the pre-snapshot (05:00:05Z) and the post-snapshot (05:01:21Z). The role delta is exactly **`rolcanlogin` false → true**, plus the credential, whose value was never read back or reported.

What was **not** done:
- no connection as `app_rw` (0 `app_rw` sessions, pre and post);
- no Gate 3;
- no Vercel change, no deploy, no `DATABASE_URL` or `DATABASE_URL_OWNER` change;
- no migration, RLS, policy, grant, membership or SECURITY DEFINER change;
- no reseed, no write-path verifier, no sending.

Production and `qifatlqxfuhwrwvpbwsc` were not contacted.

**How the secret was handled.**
- `APP_RW_PASSWORD` was inherited from the launching shell and checked by presence only. It was never printed, logged, put on a command line or written to a file. After the gate, a scan of 323 scratchpad and repo files found **0 occurrences**.
- It was hashed **in-process** into a SCRAM-SHA-256 verifier (4096 iterations, random 16-byte salt). This is the form `psql \password` sends, so the plaintext never reached the server, its logs or `pg_stat_statements`.
- The verifier was bound as a query parameter into a transaction-local setting. It was applied by `EXECUTE format('alter role %I with login password %L', …)` inside a `DO` block, and the setting was cleared before commit. No top-level statement text carries it.
- The hosted settings, read-only: `log_statement=ddl` (a `DO` block is not DDL), `pg_stat_statements.track=top` (the nested statement is not recorded), `pgaudit.log=none`, `password_encryption=scram-sha-256`.
- **Proven before any hosted contact:**
  - In-process, 19 / 0: node-postgres's independent SCRAM client accepts the real password against its verifier and rejects a wrong one. Random passwords behave the same. The secret passed the SASLprep-compatibility check.
  - On a disposable local PostgreSQL 17 with `scram-sha-256` host auth, 9 / 0: the exact mechanism was run on a throwaway role. The server stored the verifier verbatim; only `rolcanlogin` changed; a real login succeeded; a wrong password was refused (`28P01`); `NOLOGIN` kept the credential. The cluster was then deleted.

**How the run was guarded.**
- Identity was proven from the parsed user (`postgres.mejokqxriwyawfhawuxu`; pooler `aws-0-ca-central-1.pooler.supabase.com:6543`) before any connection. The connection string was checked not to contain `qifatlqxfuhwrwvpbwsc`, and was never printed.
- Every read ran `REPEATABLE READ READ ONLY`, was rolled back, and had `txid_current_if_assigned()` NULL. Snapshots ran with the secret unset.
- The mutation transaction re-proved these against the pre-snapshot **before** the ALTER: environment, migrations, `current_user`, the `app_rw` row, all role memberships, and all 32 role rows.
- **After** the ALTER, still uncommitted, it required three things, or it would ROLLBACK:
  - the `app_rw` row equals the pre row with only `rolcanlogin` flipped;
  - memberships and every other role are identical;
  - the carrier setting is cleared.

  All matched, and the transaction committed.
- The tooling (`gate2.ts`, `gate2-alter.ts`, the SCRAM self-test) is a superset of the Gate 1b wrapper, kept in the session scratchpad and never committed.

### Pre-mutation checks: all 13 passed (32 / 0, with zero delta against the Gate 1b.1 post record)

| # | Check | Hosted value |
|---|---|---|
| 1–2 | target | `mejokqxriwyawfhawuxu`, not `qifatlqxfuhwrwvpbwsc` |
| 3 | environment | `demo`, `is_synthetic=true` |
| 4–5 | migrations | 105, latest `0105_h1b01_temp_schema_hardening.sql`; nothing pending, nothing extra |
| 6 | manifest | `db1f78f7a11bbacb` |
| 7 | business-data fingerprint | `79321d9130d1dc94` |
| 8 | whole-world fingerprint | `de05e204801988d1` |
| 9–10 | `app_rw` | LOGIN false; BYPASSRLS false; not superuser |
| 11 | catalogue guard | 31 protected, **0 unsafe**. `search-path-verify --catalogue-only` gives 12 / 0 |
| 12 | CREATE on `public` | none for PUBLIC, `app_rw`, anon, authenticated or service_role; no indirect path |
| 13 | sending | 0 sending identities, messages, outbox rows, email events and sent touches; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` unset |
| + | catalogue | security hash `4682f232e8392034`, equal to the Gate 1b.1 record; functions, triggers, policies, RLS, grants, memberships and every per-table fingerprint identical to the Gate 1b.1 post snapshot |

### `app_rw` posture, pre → post

| Attribute | Pre | Post |
|---|---|---|
| `rolcanlogin` | false | **true** |
| `rolsuper` · `rolbypassrls` | false · false | false · false |
| `rolinherit` (NOINHERIT) | false | false |
| `rolcreaterole` · `rolcreatedb` · `rolreplication` | false · false · false | false · false · false |
| `rolconnlimit` · `rolvaliduntil` · role config | −1 · null · none | −1 · null · none |
| member of | none | none |
| held by | `postgres`: ADMIN true, INHERIT false, SET false, granted by `supabase_admin` | same |
| database / schema | CONNECT and TEMPORARY (both pre-existing, via PUBLIC; TEMPORARY is closed as a definer-path risk by 0105), no CREATE; USAGE on `public`, no CREATE anywhere | same |
| table, column and function grants | Gate 1b.1 set | identical |

### Post-change verification (read-only): 45 / 0

| Check | Result |
|---|---|
| Exact role delta | only `app_rw.rolcanlogin`. All 32 roles compared: no other role changed, and no other `app_rw` attribute changed. Memberships (`pg_auth_members` in full), role settings, and database and schema privileges are identical |
| Catalogue | migrations 105 (latest 0105, nothing pending). Functions (bodies, owners, `proconfig`, EXECUTE), triggers (the 8 consent guards included), policies, RLS / FORCE, table and column grants, CREATE-on-`public` facts: **identical** |
| Search path | 31 protected (30 `pg_catalog, public, pg_temp`; `app_current_org` `pg_catalog, pg_temp`), **0 unsafe**. `search-path-verify --catalogue-only` gives **12 / 0** |
| Security hash | `4682f232e8392034` → `30772757ebd4688c`. The hash includes the `app_rw` attribute row, so the LOGIN flip moves it. With `rolcanlogin` masked it is **`a4ea548143702029` pre and post** |
| Data | manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94` and whole-world fingerprint `de05e204801988d1` **all unchanged**. All 155 per-table fingerprints and every business count are identical (3 · 14 · 19 · 11 open · $8,040,000 · 14 · 5 stakeholders) |
| Partnership data | 1 active partnership · 1 joint pursuit · 4 ACTIVE participants · 2 context grants. 0 list grants, overlap probes, evidence shares, skill shares, joint-pursuit events, warm intros and audit rows. No partnership write was exercised |
| Send safety | no send operation. 0 send rows of every kind; nothing armed |

### Rollback readiness (not executed)

The emergency rollback is `ALTER ROLE app_rw NOLOGIN;`, run as `postgres`.
- It refuses new `app_rw` logins immediately. There are no `app_rw` sessions to terminate today.
- It does **not** destroy the credential. This was proven on the disposable server: the verifier was unchanged after `NOLOGIN`. Re-enabling access is `ALTER ROLE app_rw LOGIN;`, and Gate 3 and Gate 5 keep using the same operator-held secret.
- A successful Gate 2 is not rolled back.

**Operator note.** `APP_RW_PASSWORD` must stay in the operator's secret store. Gate 3, the pooler login proof, and Gate 5, the Preview `DATABASE_URL`, need this same value.

**Hosted baseline of record after Gate 2:**
- migrations 105;
- manifest `db1f78f7a11bbacb`;
- business-data fingerprint `79321d9130d1dc94`;
- whole-world fingerprint `de05e204801988d1`;
- `app_rw` **LOGIN true** (credential set, not yet used);
- security hash `30772757ebd4688c`.

**Gate 3 was NOT begun.** `app_rw` has never connected. H1B, and so H1, are not complete.

---

## Gate 3 — prove the `app_rw` pooler login and the hosted RLS / tenant-context model: RESULT (2026-09-15)

**Gate 3 — PASS.** This was a probe gate, with **no hosted mutation**:
- every `app_rw` transaction ended in ROLLBACK, except one read-only COMMIT for the leak test, with txid NULL;
- the owner connection was used read-only only;
- the whole world is byte-identical before and after.

What was **not** done:
- no Vercel change, no deploy, no `DATABASE_URL` or `DATABASE_URL_OWNER` change;
- no role, password, migration, policy, grant or membership change;
- no reseed, no committed write, no sending;
- no Gate 4 or 5.

Production and `qifatlqxfuhwrwvpbwsc` were not contacted.

**Connection.**
- The user was **`app_rw.mejokqxriwyawfhawuxu`**, the documented `<role>.<ref>` form, on the **transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`**, database `postgres`.
- The host, port, database and SSL parameters are the owner connection's own; it carries no URL or SSL parameters.
- The config was built in process memory. The password was supplied through node-postgres's lazy password callback, which was set to refuse a cleartext request. The pooler asked for **SCRAM-SHA-256**, so the password never crossed the wire.
- `APP_RW_PASSWORD` was checked by presence only. A 332-file scan afterwards found 0 occurrences.

**Pre-gate baseline (owner, read-only): 39 / 0.** It was re-taken immediately before the final run and passed 39 / 0 again.
- Identity checks; demo / synthetic.
- Migrations 105, latest 0105.
- Manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1`.
- `app_rw` LOGIN true and BYPASSRLS false; 31 protected functions, 0 unsafe.
- Sending unarmed.
- Security hash `30772757ebd4688c`; zero delta against the Gate 2 record.

**Method: the tenant inventory is the hosted catalogue, not a hand list.**
- For each of the 155 RLS tables, the probe takes the permissive policies that apply to `app_rw` for SELECT: roles `app_rw` or PUBLIC, cmd ALL or SELECT. No RESTRICTIVE policy applies.
- That classifies **125 tenant tables** (81 purely `is_org_member(org_id)`), **29 global tables** (qual `true`: `companies`, `organizations`, taxonomy, products, providers, `environment_identity`, and the rest), and **1 default-deny** table (`schema_migrations`).
- None of the 29 global tables has an `org_id` column. A tenant table exposed by `true` would have failed this check.
- For each context:
  - **owner side:** evaluated each table's own policy predicates under the same transaction-local `app.org_id`;
  - **`app_rw` side:** read every table through the pooler;
  - **compared:** the row count and an order-independent content hash of every row must be equal. That proves `app_rw` sees exactly the authorized set.

| Check | Result |
|---|---|
| **3A. Pooler login** | Succeeds, with SCRAM. Asserted from the `app_rw` connection itself: `current_user = app_rw`, `session_user = app_rw`; `rolcanlogin` true, `rolsuper` false, `rolbypassrls` false, NOINHERIT; member of no role; `row_security = on`; `is_superuser = off`; PG 17.6 |
| **3B. No tenant context** | `current_setting('app.org_id', true)` is NULL and `app_current_org()` is NULL. **0 tenant-owned rows** across all 126 tenant and default-deny tables. The only non-global rows visible are the 5 org-less global `pursuit_team_requirements` rows, by design. Exact set equality on all 155 tables |
| **3C. Vertex context** | Set by `select set_config('app.org_id', $1, true)`, the `withTenant` mechanism, in one transaction that was rolled back. `app_current_org()` = Vertex; exact set equality on all 155 tables (851 tenant rows visible). **Explicitly scoped owner counts match:** opportunities 19/19, contacts 5/5, pursuits (own) 13/13, `revenue_motions` 7/7, `motion_actions` 6/6, partnerships 1/1, campaigns 0/0. **Parent-scoped children** match the owner's join on Vertex parents: stakeholders via opportunities 5/5, `opportunity_meddpicc` 152/152, `campaign_touches` 0/0. `organizations` (3/3) and `companies` (14/14) are global by design (0104 / 0061). Other-org rows are invisible on all 81 `org_id` tables; the only other-org rows visible come through participation (`pursuit_participants` 2), exactly the owner-evaluated predicate. The Meridian pursuit stays hidden |
| **3D. Context leak (transaction pooler)** | The sequence, on one client: no context → Vertex (ROLLBACK) → no context → Vertex (read-only **COMMIT**, the application's commit path) → no context → Meridian → no context → TD SYNNEX → no context. Then a **second, fresh pooler client** with no context. **Every transaction began with `app.org_id` absent** (NULL at first, `''` once the placeholder existed) and `app_current_org()` NULL, and every no-context transaction showed 0 tenant rows. The pooler served **all 10 transactions, from both clients, on the same backend (one pid)**. That is the strongest form of the test: the context did not survive ROLLBACK or COMMIT on a reused backend. **No leak** |
| **Second- and third-org isolation** | **Meridian:** 14 tenant rows, exact set equality; 397 other-org rows in 33 tables stay hidden. **TD SYNNEX:** 33 rows, exact; 398 other-org rows hidden. TD SYNNEX's other-org visibility is participation only (its joint pursuit and the related participant, outcome, route-snapshot and route-candidate rows), each exactly the owner-evaluated predicate |
| **3E. Foreign-write refusal** | One transaction, **always rolled back**, as `app_rw` with Vertex context. Target `pursuits`: write policy `is_org_member(org_id)`, 0 triggers, no consent primitive; foreign row = the Meridian pursuit. Results: foreign same-value UPDATE → **0 rows**; foreign DELETE → **0 rows**; INSERT carrying Meridian's `org_id` → **42501** (row-level security); re-homing an own pursuit into Meridian → **42501** (WITH CHECK); own-org same-value UPDATE → **1 row**, so `app_rw` is not globally read-only. Owner, read-only afterwards: the foreign row, the own row and the whole `pursuits` table are unchanged |
| **3F. Privilege escalation** | `SET ROLE` to `postgres`, `supabase_admin`, `service_role`, `authenticator`, `authenticated`, `anon`, `pg_read_all_data` and `pg_write_all_data`, and `SET SESSION AUTHORIZATION postgres`: **all refused (42501)**. `app_rw` is a member of none of them, and afterwards `current_user = session_user = app_rw` |
| **3G. Security boundary** | `search-path-verify --catalogue-only` gives **12 / 0**, both pre and post: 31 protected, 0 unsafe, no CREATE on `public` for PUBLIC or any runtime role, EXECUTE posture intact. BYPASSRLS false. Memberships, policies and grants are unchanged. The destructive temp-table suite was **not** run on hosted |
| **3H. Zero residue** | Owner, read-only; the post-snapshot is identical to both Gate 3 pre-snapshots (41 / 0 each): manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1` and all 155 per-table fingerprints **unchanged**. Migrations 105; security hash `30772757ebd4688c` unchanged. Partnership data unchanged (1 · 1 · 4 · 2, the rest 0). 0 send rows. **No relation, function, schema or type owned by `app_rw`; no prepared transaction; no `app_rw` backend mid-transaction.** One idle pooled backend is held by the pooler |

**A note on the run.**
- The first probe run stopped by design at 3E, before any write transaction opened. Every hosted `contacts` row, and every opportunity, belongs to Vertex, so there was no foreign row to aim at. Its no-context and three-org checks had already passed.
- Its one ✗ was a vacuous negative control: `opportunities` has no foreign rows on hosted.
- The probe was fixed to prove non-vacuity per context and to target `pursuits`. The baseline was re-taken (39 / 0; the aborted run had changed nothing), and the rerun passed **80 / 0**.

The tooling (`gate3-probe.ts`, `gate3-targets.ts`, and the snapshot and assertion modes) is kept in the session scratchpad and never committed, as for the earlier gates.

**Hosted baseline of record after Gate 3:** unchanged from Gate 2.
- migrations 105;
- manifest `db1f78f7a11bbacb`;
- business-data fingerprint `79321d9130d1dc94`;
- whole-world fingerprint `de05e204801988d1`;
- `app_rw` LOGIN true;
- security hash `30772757ebd4688c`.

**Gate 4 was NOT begun.** Nothing in Vercel changed. H1B, and so H1, are not complete.
