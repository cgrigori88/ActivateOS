# H1 — Pre-Pilot Hardening Gate

**Status:** **H1A COMPLETE (local)** · certification baseline **completely green** (76/76, 2026-09-14) · H1B: **Gate 1 PASS AFTER DOCUMENTED RE-BASELINE** (2026-09-15; hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `2678f34d4fc7b0a2`) · **H1B-0 COMPLETE (local)** — consent flows work under `app_rw` (D-049), `/api/build` posture proof, 78/78 certification · **Gate 1b PASS** (2026-09-15; 0104 applied to `mejokqxriwyawfhawuxu` only; post-1b hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `0288ae73bb385a1c`) · **Gate 2 not begun** (`app_rw` still NOLOGIN). **H1 is not complete until H1B passes hosted certification.**
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

### Local rehearsal (H1A — no hosted change)

The same cutover can be rehearsed locally today (app_rw has a local login): run the built app with `DATABASE_URL=app_rw` and `DATABASE_URL_OWNER=postgres`, crawl every room, and compare it with the owner-role crawl. See § "H1A results".
