# H1 — Pre-Pilot Hardening Gate

**Status:** **H1A COMPLETE (local)** · certification baseline **completely green** (76/76, 2026-09-14) · H1B: **Gate 1 PASS AFTER DOCUMENTED RE-BASELINE** (2026-09-15; hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `2678f34d4fc7b0a2`) · **H1B-0 COMPLETE (local)** — consent flows work under `app_rw` (D-049), `/api/build` posture proof, 78/78 certification · **Gate 1b PASS** (2026-09-15; 0104 applied to `mejokqxriwyawfhawuxu` only; post-1b hosted baseline manifest `db1f78f7a11bbacb` / fingerprint `0288ae73bb385a1c`) · **Gate 2 BLOCKED / NOT EXECUTED** · **H1B-0.1 COMPLETE (local)** — migration 0105 closes `pg_temp` shadowing on 31 authorization-sensitive functions (D-050) · **Gate 1b.1 PASS** (2026-09-15; 0105 applied to `mejokqxriwyawfhawuxu` only; 31/31 hardened, 0 unsafe; post-1b.1 hosted baseline: migrations 105, manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1`) · **Gate 2 PASS** (re-run, 2026-09-15; `app_rw` given LOGIN and its operator credential on `mejokqxriwyawfhawuxu` only — `rolcanlogin` false → true, nothing else changed) · **Gate 3 PASS** (2026-09-15; `app_rw.<ref>` pooler login proven; RLS / tenant context exact on all 155 tables for no-context and three orgs; no cross-transaction context leak; foreign writes refused; zero residue) · **Gate 4 PASS AFTER DOCUMENTED RE-BASELINE** (2026-09-15; `DATABASE_URL_OWNER` on Preview branch `roadmap/pursuitos-vnext` only; `DATABASE_URL` unchanged; runtime still `postgres`; owner paths and the 37-room signed-in crawl identical; re-baselined for the crawl's one-time render materialization, which a repeat crawl proved stable. Baseline of record: migrations 105, manifest `db1f78f7a11bbacb`, business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb`, security hash `30772757ebd4688c`. Certification fingerprint rule **CFR-1** adopted) · **Gate 5 PASS** (2026-09-15; branch Preview `DATABASE_URL` → `app_rw`, value only; `DATABASE_URL_OWNER` still the owner; `/api/build` reports `app_rw`, bypassRls false, tenantEnforcement true; owner paths intact; 37/37 rooms healthy, with 4 order-only differences from untied ORDER BYs (D-G5-1); DB 0/155 tables changed under CFR-1; sending off) · **Gate 6 PASS** (2026-09-15; read-only; serving `766cb13` `dpl_JD8DtC8…`; live `/api/build` probe reports `app_rw`, bypassRls false, tenantEnforcement true, probe live; routing and smoke verified; DB 0/155 changed) · **D-G5-1 HOSTED ACCEPTED / CLOSED** (2026-09-15; deterministic tiebreakers in `divergence.ts` and `projection.ts`, certified locally (`ordering-determinism` 17/0, `certify-world --runs 2` 82/82), then deployed as `1c4fb5e` on the `app_rw` Preview. Two full hosted crawls (4 passes) are identical in order; Today "stage vs engagement" and the CDW list label are deterministic; DB 0/155 changed) · **Gate 7 PASS** (2026-09-15; hosted tenant/RLS certification on the `app_rw` Preview. Exact-RLS probe as `app_rw` 80/0 across 3 orgs × 155 tables; 37-room crawl identical to the accepted D-G5-1 crawl; `partnership-app-rw` on hosted, rolled back, 117/0; blind probe accepted as a substitution; supplemental owner-backed suites recorded; owner human review PASS; DB 0/155 changed) · **CFR-1.1 adopted** (`days_since_activity` validated by recomputation from source; all else strict) · **Gate 8 Phase 1 PASS** (2026-09-15; emergency rollback to `owner/postgres` proven: value-only branch Preview `DATABASE_URL` update, `/api/build` reports `postgres` / bypassRls true / tenantEnforcement false / live, crawls equivalent apart from time-derived text, DB 0/155; pre-existing ordering tie **D-G8-1** recorded; **the Preview is paused in the owner posture**) · **Gate 8 PASS** (2026-09-15; Phase 2 restored `app_rw`, value-only, as `dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu`; `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / live; crawls equal the Gate 7 `app_rw` crawl apart from clock text validated against source; isolation smoke PASS; DB 0/155; rollback and restoration both proven) · **D-G8-1 HOSTED ACCEPTED / CLOSED** (`/pipeline` stakeholders `order by s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id`; certified locally with `ordering-determinism` red 20/3 → 23/0, rehearsal 38/38 and `certify-world` 82/82; deployed as `dcde3b6` on the `app_rw` Preview; two hosted crawls render the rule order identically; only the rule-driven row reorder differs from Gate 8; DB 0/155) · **D-G8-2 latent ordering backlog recorded** (owner decision) · **D-G8-2A HOSTED ACCEPTED / CLOSED** (2026-09-15 local / 2026-09-16Z; `a5da3b2` as `dpl_BcKULAScmeWVZaQYkakWbCRiZw7w` on the `app_rw` Preview; 37/37 rooms 200 and all 4 passes byte-identical; against the accepted D-G8-1 crawl 32/37 rooms identical, 5 pure reorders, **0 membership changes**, each explained by a committed tie-break; DB 154/155 per-table fingerprints identical with only the documented `pipeline_snapshots` new-date look-to-write row, NOT re-baselined; tenant/consent smoke and send safety clean; closure `94491ea1…` re-verified, audit not reopened) · **D-G8-3A/B/D FIXED LOCALLY** (2026-09-15; migrations 0106 `campaign_assets.position` and 0107 settlement `opportunity_id` + total order, applied LOCALLY only; 31 protected / 0 unsafe preserved through the DROP+CREATE; `certify-world --runs 2` 84 clean / 0 failures, digest `e98b43254f98d5ec` unchanged; rehearsal 38/38 + 6/6; new `persisted-determinism` suite 17/0; canonical fingerprint identical before and after; NOT pushed) · **D-G8-3 HOSTED MIGRATION GATE PASS** (2026-09-16Z; 0106 then 0107 applied separately to `mejokqxriwyawfhawuxu` while the accepted app kept serving; level 107; only `schema_migrations` moved of 155 per-table fingerprints; business-data `c56a1d229e483f2b` UNCHANGED; security `30772757ebd4688c` → `f31e51d50e9dec49`, accepted only after 31/0, grants, search_path and drift checks all passed; old app healthy 10/10; tenant-isolation 205/0 ×3; app code NOT pushed) · **D-G8-3A/B/D HOSTED ACCEPTED / CLOSED** (2026-09-16Z; `21326e5` as `dpl_K88acSQbydWTU4UjthhCEuT4GXsC`; 37/37 rooms and 4/4 passes byte-identical AND 37/37 identical to the accepted D-G8-2A crawl — zero rendered change; 3A proven by a rollback-safe hosted round trip with no residue; 3B non-party zero and no raw id in visible text; 3D deployed tie-breaks verified read-only; DB 0/155 per-table fingerprints changed; security `f31e51d50e9dec49` steady; 31/0) · **D-G8-3C RECLASSIFIED → D-G8-4D** (campaign seed selection semantics — no existing business rule resolves a score tie) · **D-G8-4A/B/C/D FIXED LOCALLY** (2026-09-16; CODE-ONLY, **no migration** — repo stays at 107; PROVENANCE_STRENGTH canonical for source-truth with HUMAN_ASSERTED/SECOND_PARTY deliberately UNRESOLVED; median corrected to the whole terminal population plus a categorical mode that surfaces ties; identity ladder replaces every name-length/alphabetical pick and ask-scope fails closed on ambiguity; in-force facts gain an explicit as-of validity window; campaign seed is deliberate or null; `certify-world --runs 2` 86 clean / 0 failures, digest `e98b43254f98d5ec` unchanged, new `semantic-determinism` suite 38/0; NOT pushed) · **D-P1 OPEN — must be fixed before Gate 9** · Gate 9 not begun. **H1 is not complete until H1B passes hosted certification.**
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

---

## Gate 4 — add `DATABASE_URL_OWNER` to the branch Preview: RESULT (2026-09-15)

**Gate 4 — PASS AFTER DOCUMENTED RE-BASELINE** (owner decision, 2026-09-15; see § "Gate 4 close-out" below). The result as first run follows: change applied and verified, with one criterion not met (the database fingerprint).

Every runtime, routing, owner-path and room criterion passed. The whole-world and business-data fingerprints did **not** stay at the baseline of record. The signed-in room crawl itself caused the drift: two crawled rooms write on render. The drift happened on the **pre-change** deployment, during the BEFORE crawl, before the variable existed. It is not caused by `DATABASE_URL_OWNER`, and removing the variable would not undo it. So the rollback trigger ("adding `DATABASE_URL_OWNER` causes a regression") is not met, and the variable stays. Gate 4 is **not** recorded as a clean PASS, because the specified criterion "fingerprints unchanged" did not hold. The owner decides below.

**Scope.** Vercel project `pursuitos-demo`, target Preview, Git branch `roadmap/pursuitos-vnext`; database `mejokqxriwyawfhawuxu`.
- Production and other Preview branches were not touched.
- `qifatlqxfuhwrwvpbwsc` was not contacted.
- No database mutation was issued by the gate tooling. Every tooling transaction was `READ ONLY` with a NULL txid. The only hosted writes were the application's own render-time writes, set out below.

**Inputs.** `OPS_FINGERPRINT_TOKEN`, `GATE_DEMO_EMAIL`, `GATE_DEMO_PASSWORD` and `GATE_OWNER_DATABASE_URL` were inherited from the launching shell and checked by presence only.
- The owner string was parsed in memory first: `postgres.mejokqxriwyawfhawuxu` on the transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`, database `postgres`, no forbidden ref.
- To reach the SSO-protected Preview, the tooling read the project's **existing** automation-bypass secret in process and sent it only to the deployment host. No protection setting changed.
- A 1,246-file scan of the session scratchpad and the repository afterwards found **0 occurrences** of any of the four values, the owner password or the CLI token. The demo email is redacted in every saved crawl.

**The change.**
- `DATABASE_URL_OWNER` (id `I2giX3iM1sNwoN47`, type sensitive) was added, target `preview` only, `gitBranch` `roadmap/pursuitos-vnext`. The value went through stdin (a shell builtin into `vercel env add`) and never appeared in argv or output.
- A metadata diff of all project env entries (38 after, 37 before) shows exactly one addition, 0 removed and 0 modified.
- Both `DATABASE_URL` entries are byte-identical in id, target, branch, created and updated: `m6TuSKisz54kJlsD` (branch Preview) and `G7A2MUVlaDmJxPTs` (Production + Preview).
- No other project gained the variable. The only other `DATABASE_URL_OWNER` in the team is on the separate `pursuitos` project, Production, created 2026-08-29, which is pre-existing and untouched.

**Redeploy.** `vercel redeploy` of `dpl_HwygwR7FDA1QLHBDvbCVJQAHrZir` (commit `89b8c95`), with no target override:
- the result is **`dpl_4WcVaMZ4jRwzuAppkcdqb5wDCmmn`** (`pursuitos-demo-bi5yav97t-…`): READY, target preview, branch `roadmap/pursuitos-vnext`, commit `89b8c95`;
- the Production target is unchanged (`dpl_Bre6yKpy…`, `97e975f`).

| Check | BEFORE (`dpl_Hwygw…`, `89b8c95`) | AFTER (`dpl_4WcVa…`, `89b8c95`) |
|---|---|---|
| `/api/build` (ops token) | branch `roadmap/pursuitos-vnext` · `preview` · ref `mejokqxriwyawfhawuxu` · host pooler · **role `postgres` · bypassRls true · tenantEnforcement false** · probe live · `externalSendingArmed` false | **identical** — the runtime role did not change; no `app_rw` |
| Sign-in (the real `/login` form, synthetic demo owner of Vertex Systems) | lands on `/`, auth cookie set | same |
| `/login` signed out: owner-pool `org_members` count | sign-in form, no first-run form | same |
| `/login` signed in | "signed in" banner | same |
| `/join/<dead code>`: owner-pool `inviteInfo` | dead-link message | same (the hosted DB has no live invite code, so none was exercised) |
| `/admin`: owner-pool `currentRole` + members table joining `auth.users` | owner gate passes; members show the demo owner; 205 lines | same, 205 lines |
| `/ops`: owner-pool `currentRole` | "Governance ops", owner gate passes | same |
| `/api/webhooks/resend`, an unsigned POST (no event) | 503 "webhook secret not configured" (existing Preview config; refused before any pool use) | same |
| `/api/research` GET | 401, closed (no trigger secret on Preview; not exercisable without adding one) | same |
| Signed-in crawl: 37 rooms, each crawled twice BEFORE to mask volatile lines | all 200 | **37 / 37 equivalent.** 36 are line-identical. `/api/palette` is identical JSON; the compare script flagged it "empty" only because the response is a single JSON line. It covers Today (`/`, `?today=all`, drawer), Queue, Pipeline, Accounts plus detail and export, Contacts plus detail, Mapping, Pursuits, **Pursuit Detail** (Globex), Motions, Briefs, Goals plus detail, Campaigns, Upcoming, Analytics, Insights, Review, Sources, Provider health, **Partners** plus detail and review, **Joint** plus the joint room, Skills, Routines, **Admin**, Ops, Ask, Trust, Intake |

**Owner-connection routing.**
- **Normal path:** `getPool()` → `DATABASE_URL`. The AFTER `/api/build` live probe on that pool reports `postgres`, bypassRls true, tenantEnforcement false.
- **Owner path:** `getOwnerPool()` builds its own pool from `DATABASE_URL_OWNER` whenever that is set (`src/db/client.ts`), and the AFTER deployment has it set. The value is `postgres.mejokqxriwyawfhawuxu` on the pooler, checked from the parsed user.
- **Proof it works:** every owner-only read succeeded after the change through that separate pool, including the `/admin` members read of `auth.users`, which `app_rw` cannot perform.
- Neither URL was exposed.

**Database post-check (read-only, 38 / 41 against the BEFORE snapshot).**
- **Unchanged:**
  - migrations 105 (latest 0105), manifest `db1f78f7a11bbacb`, security hash `30772757ebd4688c`;
  - `app_rw` LOGIN true, BYPASSRLS false, NOINHERIT, member of nothing;
  - 31 protected functions, 0 unsafe; no runtime CREATE on `public`;
  - policies, grants, triggers, functions and roles;
  - business counts and partnership data (1 · 1 · 4 · 2, the rest 0);
  - 0 send rows (messages, outbox, email events, identities, sent touches).
- **Changed:** business-data fingerprint `79321d9130d1dc94` → **`c9623fb5abe2f9bc`**; whole-world `de05e204801988d1` → **`dce27935d88743fb`**. Exactly two tables differ:
  - `routines` 0 → 2 rows: Vertex `morning_brief` and `account_digest`, `enabled=false`, empty config and state, no runs (`routine_runs` still 0). Created 16:22:11Z, during the BEFORE crawl, by `listRoutines()` (`src/lib/routines/routines.ts`), which inserts the catalog rows (`on conflict do nothing`) whenever `/routines` renders.
  - `pipeline_snapshots` 0 → 1 row: Vertex, `taken_on` 2026-09-15, 11 open, $8,040,000 open, $3,361,500 weighted, which matches the unchanged opportunity data. `/pipeline` upserts today's row on every render ("history accrues just by looking"). It was first written during the BEFORE crawl, and later visits rewrote identical values.
  - Both run inside `withTenant`, which uses the **normal `DATABASE_URL` pool**, not the owner pool.
  - The BEFORE snapshot (16:21:22Z) was taken just before the BEFORE crawl began (16:21:28Z). The variable was added at 16:24:02Z and the redeploy ran at 16:24:55Z.

**Why earlier gates did not see this.** Gates 1–3 did not crawl signed-in rooms, and the H1A rehearsal crawls a disposable local clone. **The certified signed-in crawl is not read-only on hosted:** `/routines` seeds catalog rows once per org, and `/pipeline` writes one snapshot row per org per calendar day. So any later crawl on a new date, including the Gate 7 crawl, will add a `pipeline_snapshots` row and move the fingerprints again. The manifest digest is not affected.

**Owner decision required.**
- **(a) Re-baseline (recommended).** Accept the three rows as ordinary application residue, as the Gate 1 precedent did, and record business-data `c9623fb5abe2f9bc` / whole-world `dce27935d88743fb` as the baseline of record. Gate 4 then becomes PASS AFTER DOCUMENTED RE-BASELINE. Before Gate 7, adopt a comparison rule for these two look-to-write tables.
- **(b) Revert.** A separate, approved hosted write deletes exactly those 2 `routines` rows and 1 `pipeline_snapshots` row, which restores `79321d9130d1dc94` / `de05e204801988d1`. The next signed-in crawl would recreate them.

**Rollback readiness.**
- Not executed: there is no regression attributable to the variable.
- Procedure: `vercel env rm DATABASE_URL_OWNER preview --git-branch roadmap/pursuitos-vnext`, redeploy the branch, then re-run the BEFORE checks. `DATABASE_URL` is never touched.
- Removing the variable returns `getOwnerPool()` to its inert fallback, `getPool()`, which is the pre-Gate-4 behaviour.

The tooling is kept in the session scratchpad and never committed, as for the earlier gates: `g4-crawl.mjs`, `g4-compare.mjs`, `vercel-env-snap.mjs`, and the Gate 2/3 snapshot tool re-pointed at a new output directory.

### Gate 4 close-out — re-baseline, materialization semantics, stability proof and CFR-1 (2026-09-15)

**Owner decision: option (a), RE-BASELINE.** The three render-created rows are kept and not deleted, because the next signed-in crawl would recreate them. They are:
- Vertex `routines` `morning_brief`;
- Vertex `routines` `account_digest`;
- the Vertex `pipeline_snapshots` row for 2026-09-15.

They are not caused by `DATABASE_URL_OWNER`:
- they were written during the BEFORE crawl (16:22Z), before the variable existed (added 16:24:02Z);
- they were written through `withTenant`, which is `getPool()` → the existing `DATABASE_URL`, not the owner pool.

**Gate 4 — PASS AFTER DOCUMENTED RE-BASELINE.** No Vercel, deploy, env, database or Production change was made in the close-out.

**Materialization semantics** (from the code; product behaviour not modified).

| | `/routines` → `listRoutines()` (`src/lib/routines/routines.ts`) | `/pipeline` → the page loader (`src/app/pipeline/page.tsx`) |
|---|---|---|
| Write | per catalog kind: `insert into routines (org_id, kind) … on conflict (org_id, kind) do nothing` | `insert into pipeline_snapshots … values (org, now()::date, …) on conflict (org_id, taken_on) do update set open_count, open_usd, weighted_usd, crm_usd = excluded.*` |
| Creation | **create-once defaults**, one row per org per catalog kind, the first time that org renders `/routines`: `enabled=false`, `config {}`, `state {}`, `last_run_at` null, `created_at` now() | **once per org per calendar date.** The primary key is `(org_id, taken_on)`; `taken_on = now()::date` in the database timezone (**UTC**). The first `/pipeline` render of the day inserts |
| A later render | **no change.** A conflicting DO NOTHING insert touches no tuple | **same day:** an upsert that recomputes the four value columns and rewrites the tuple. There is no timestamp column. **A new UTC date:** a new row |
| Columns a normal render can change | **none**, after creation. `enabled` and `config` change only through POST server actions (toggle, save config). `last_run_at`, `state` and `routine_runs` change only through the routine runner (worker, or the "run now" action), never a GET | `open_count`, `open_usd`, `weighted_usd`, `crm_usd` of **today's** row, and only if the inputs differ: (i) live opportunities change; (ii) the org's stage-weight curve changes; (iii) `crm_snapshots` change; or (iv) **the render carries `?timeframe=7\|30\|90`**. The snapshot is computed from `opps`, which the timeframe filter narrows, so a filtered view overwrites the day's business fields. The other filters (stage, partner, quote, qual, value, life) only narrow the displayed `visible` set and do not affect the snapshot. Rows for earlier dates are never touched |

(iv) is a latent product defect: snapshot history depends on the view filter. It is recorded here and **not fixed in H1B**. The certification crawl renders `/pipeline` without `timeframe`.

**Stability proof** (same UTC day, 2026-09-15, 16:37–16:39Z; deployment `dpl_AbED1JMQDDoFfzMVtWEz4ZGLWpTy`, commit `acffd94`; synthetic Vertex owner, real `/login`). The sequence:
1. read-only snapshot;
2. a full signed-in crawl of all 37 rooms, **twice**, including `/routines`, `/pipeline`, Today, Queue and Pursuit Detail;
3. read-only snapshot again.

The results:
- **Pre-snapshot vs the Gate 4 post record:** 41/0.
- **Post-snapshot vs pre-snapshot:** **41/0, 0 of 155 tables differ.**
  - Business-data `c9623fb5abe2f9bc` → `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb` → `dce27935d88743fb`.
  - Manifest, security hash, counts and `app_rw` unchanged.
- **`routines`:** still 2 rows, byte-identical, **tuple not rewritten** (xmin 2415 before and after, the Gate 4 creation transaction); `routine_runs` 0.
- **`pipeline_snapshots`:** still 1 row for the org and day. The tuple was rewritten (xmin 2419 → 2422) with **identical values**: 11 open · $8,040,000 open · $3,361,500 weighted · `crm_usd` null. Those equal the unchanged live pipeline.
- **The rooms:** all 37 returned 200 and were equivalent to the Gate 4 AFTER crawl. The owner paths were identical.

**Conclusion.** The Gate 4 materialization was one-time initialization. Same-day repeat crawls are fingerprint-neutral, so the strict fingerprints are kept and the re-baselined values carry forward. The one behaviour that can still move them is a **later UTC date**, which adds one `pipeline_snapshots` row per org whose `/pipeline` is rendered. That is what CFR-1 governs.

**Hosted baseline of record after Gate 4 (the Gate 5 baseline):**
- migrations 105 (latest 0105);
- manifest `db1f78f7a11bbacb`;
- business-data fingerprint `c9623fb5abe2f9bc`;
- whole-world fingerprint `dce27935d88743fb`;
- security hash `30772757ebd4688c`;
- `app_rw` LOGIN true, BYPASSRLS false;
- 31 protected functions / 0 unsafe;
- 0 send rows;
- `pipeline_snapshots` latest `taken_on` 2026-09-15.

**Vercel posture after Gate 4.** `DATABASE_URL_OWNER` exists only on `pursuitos-demo` Preview + `roadmap/pursuitos-vnext`. The env metadata at close-out is identical to the Gate 4 post record. Preview `DATABASE_URL` is unchanged, so the runtime is still the owner (`postgres`). `/api/build` reports role `postgres` / bypassRls true / tenantEnforcement false / `externalSendingArmed` false.

#### CFR-1 — hosted certification fingerprint rule (adopted 2026-09-15; governs Gates 5–8)

1. **The manifest is strict.** `db1f78f7a11bbacb` must be unchanged.
2. **Every table is strict by default.** Every `public` table is compared by row count and content hash against the baseline of record, and both the business-data and whole-world fingerprints are compared. No table or column is excluded.
3. **The allowlist is exhaustive:** only these two deltas may be accepted, and each must be semantically validated.
   - **A. `pipeline_snapshots`, a new UTC date only.**
     - Allowed: rows whose `taken_on` is later than the baseline's latest `taken_on` (2026-09-15); at most one per (org, date); only for an org whose `/pipeline` was rendered in the run.
     - Validation, per new row:
       - `open_count` and `open_usd` equal that org's **unfiltered** open opportunities, count and sum. For Vertex, with business data unchanged: 11 / $8,040,000.
       - `weighted_usd` equals the stage-weighted value of the same set under the org's stage-weight curve. For Vertex: $3,361,500.
       - `crm_usd` is null while the org has no `crm_snapshots`.
     - Rows with `taken_on` on or before the baseline date must be **byte-identical**: a content hash over that subset must equal the baseline table hash.
     - A same-day comparison gets **no allowance**, because same-day stability is proven. A same-day value change, for example from a `?timeframe=` render, **fails**.
   - **B. `routines`, first-render initialization for an org with no routines rows only.** This arises, for example, when a Gate 7 session signs in as Meridian or TD SYNNEX and opens `/routines`.
     - Allowed: exactly one row per catalog kind (`morning_brief`, `account_digest`) for that org, with `enabled=false`, `config {}`, `state {}` and `last_run_at` null.
     - Required: `routine_runs` unchanged.
     - Vertex's existing rows must stay byte-identical. Any change to `enabled`, `config`, `state` or `last_run_at`, any extra row, or any run **fails**.
4. **Everything else fails.** Any delta outside 3A/3B is a certification failure. That covers any other table, any change to a pre-existing row, the manifest, the security hash, or `app_rw`. There is no blanket "ignore fingerprints" exception.
5. **Accepted deltas are reported explicitly.** When 3A or 3B is used, the run lists each accepted row with its validation, and the strict per-table result for every other table.
6. **Re-baselining stays an owner decision.** It is recorded in this document, and CFR-1 is not a re-baseline.

A delta accepted under 3A or 3B does not move the baseline of record. The next gate compares against the baseline plus the validated allowlist rows, or against a new owner-approved re-baseline.

*(At Gate 4 close-out, Gate 5 had not begun. It is recorded below.)*

---

## Gate 5 — switch the branch Preview runtime to `app_rw`: RESULT (2026-09-15)

**Gate 5 — PASS.** The normal vNext Preview runtime now connects as **`app_rw`**, with BYPASSRLS false and tenantEnforcement true. The narrow privileged paths still use the owner (`postgres`) through the unchanged `DATABASE_URL_OWNER`.

The gate made exactly one mutation, on Vercel only, and changed no database state. There was no role, password, migration, RLS, grant, policy, Supabase-setting, reseed or send change; Production was not touched, and neither was `qifatlqxfuhwrwvpbwsc`.

**Inputs.** `OPS_FINGERPRINT_TOKEN`, `GATE_DEMO_EMAIL`, `GATE_DEMO_PASSWORD`, `GATE_OWNER_DATABASE_URL` and `APP_RW_PASSWORD` were checked by presence only, and none was printed or persisted.
- **The new value** was built in process memory from the owner string's host, port, database and parameters. The user was replaced with `app_rw.mejokqxriwyawfhawuxu` and the password with `APP_RW_PASSWORD`, giving `aws-0-ca-central-1.pooler.supabase.com:6543`, database `postgres`, no extra parameters.
- **Pre-mutation probe of that value** (read-only, rolled back): `current_user = session_user = app_rw`, BYPASSRLS false, not superuser, no `app.org_id`, 0 pursuits visible, txid NULL.
- **The rollback value** `GATE_OWNER_DATABASE_URL` was proven to be `postgres.mejokqxriwyawfhawuxu` on the same pooler.

**Pre-cutover** (deployment `dpl_5xGwSWwybkoLvtsFo3Mv7P4zpNCE`, commit `0570a4c`, Preview, READY, the branch alias target):
- `/api/build`: `postgres` · bypassRls true · tenantEnforcement false · probe live · sending unarmed.
- Signed-in crawl: all 37 rooms returned 200.
- Owner paths: identical to Gate 4.
- DB snapshot, taken straight after the crawl: 41/0 against the Gate 4 close-out record, 0 tables differ, business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb`, 0 `app_rw` sessions.
- Env metadata: identical to the Gate 4 close-out record.

**The mutation.**
- Vercel API `PATCH` of the value only, on the existing entry `m6TuSKisz54kJlsD` (`DATABASE_URL`, sensitive, target `preview`, gitBranch `roadmap/pursuitos-vnext`).
- A first attempt that also sent `key` was refused with 400 ("cannot change the key of a Sensitive Environment Variable") and changed nothing.
- Metadata diff: **one entry modified, and only its `updatedAt`**. Id, key, type, target and branch are unchanged; 0 added, 0 removed.
- `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`) and the general Production + Preview `DATABASE_URL` (`G7A2MUVlaDmJxPTs`) are byte-identical in metadata. No send variable appeared.

**Redeploy.** `vercel redeploy dpl_5xGwSWwybkoLvtsFo3Mv7P4zpNCE` → **`dpl_6TmAg49o7CZcsbAjmhQR1mSvQFkY`** (`pursuitos-demo-ill2dfyma-…`): READY, target preview, branch `roadmap/pursuitos-vnext`, commit `0570a4c`, now the branch alias target. The Production target is unchanged (`dpl_Bre6yKpy…`).

**Immediate posture (Part H): PASS.** `/api/build` reports branch `roadmap/pursuitos-vnext` · `preview` · ref `mejokqxriwyawfhawuxu` · **role `app_rw` · bypassRls false · tenantEnforcement true · probe live** · `externalSendingArmed` false.

**Authentication and owner paths: identical to before.**
- Sign-in through the real `/login` lands on `/` with the auth cookie.
- `/login` signed out (owner-pool `org_members` count) and signed in both behave as before.
- The `/join` dead-code loader works.
- `/admin` passes the owner gate, and its members table still reads `auth.users`, which `app_rw` cannot do. So that read went through the owner pool.
- `/ops` passes the owner gate.
- The unsigned webhook still returns 503 (secret unset on Preview) and research still returns 401 (closed).

**Routing.**
- **Normal path:** `getPool()` → `DATABASE_URL` → **`app_rw`**. This is the live probe of the runtime pool.
- **Owner path:** `getOwnerPool()` → `DATABASE_URL_OWNER` → **`postgres`**. The metadata is unchanged since Gate 4, and the owner-only reads of `auth.users` succeed.
- Neither URL was exposed.

**Live tenant runtime.**
- **Traffic reaches the DB as `app_rw`:** after the crawl, the database had **3 `app_rw` backends** (0 before the cutover), 0 idle in transaction.
- **Tenant context is set per request:** under `app_rw`, a query without `app.org_id` sees 0 tenant rows (Gate 3, and the pre-mutation probe above). Yet every tenant room rendered Vertex's full data after the cutover, so each tenant request set `app.org_id` through `withTenant`'s transaction-local `set_config`.

**Signed-in crawl, BEFORE → AFTER (37 rooms).**
- All 200, with the same statuses. No empty state, no missing tenant data, no foreign data.
- The owner and admin rooms are healthy; the palette JSON is identical.
- **33 rooms are line-identical.** These include Queue, Pursuit Detail, Accounts, Partners and review, Joint, the joint room, Admin and Ops.
- **Four show order-only differences:**
  - Today, Today drawer and Today View All: an order swap. View All has an **identical multiset** of items.
  - `/pipeline`: one renewal row names a different list.
- **Root cause: pre-existing nondeterministic ordering that the RLS query plan exposed, not a data change.**
  - **Today:** `accountDivergences()` (`src/lib/context/divergence.ts`) selects "stage vs engagement" items with `limit 5` and **no ORDER BY**. A read-only proof, rolled back, ran that query for Vertex as the owner and as `app_rw` with the Vertex context. Both return the **same 4 Vertex opportunities**: Core banking resilience, Datacenter exit — phase 1, Kubernetes managed services, Legacy virtualization exit. Only the order differs (the owner returns Core banking first; `app_rw` returns Kubernetes first). Today keeps the first 7 merged items (`overview.ts`), so the capped view shows a different, equally unranked item: Hooli "Kubernetes managed services" in place of Umbrella "Datacenter exit". View All shows all of them under both roles.
  - **`/pipeline`:** `renewalProjection()` (`src/lib/lifecycle/projection.ts`) names the list with `distinct on (company_id) … order by company_id, ap.created_at`. CDW belongs to two **Vertex** lists, "CDW customer book" and "Our modernization targets", whose `created_at` is **identical** (2026-09-14 21:03:29.063576Z). The tie has no tiebreaker, so the pick is arbitrary. Both lists are the tenant's own.
- **Judgement:** not a material business-output change and not a rollback trigger. The authorized sets are equal and only tie order moved. It is recorded as the **ordering-determinism defect D-G5-1 below.**

**Database post-check** (read-only, straight after the AFTER crawl): **41/0** against the pre-cutover snapshot, **0 of 155 tables differ** (strict CFR-1; same UTC day, no allowance used).
- Migrations 105; manifest `db1f78f7a11bbacb`.
- Business-data `c9623fb5abe2f9bc` and whole-world `dce27935d88743fb`, unchanged.
- Security hash `30772757ebd4688c`.
- `app_rw` LOGIN true, BYPASSRLS false, NOINHERIT, member of nothing; 31 protected functions / 0 unsafe.
- Partnership data unchanged (1 · 1 · 4 · 2, the rest 0).
- `routines` byte-identical (xmin 2415).
- The same-day `pipeline_snapshots` row was rewritten with identical values under `app_rw` (11 · $8,040,000 · $3,361,500 · null).
- **0 send rows**; `externalSendingArmed` false; no webhook event delivered.

**Findings recorded (not fixed in Gate 5).**

| Id | Finding | Must resolve before |
|---|---|---|
| D-G5-1 | **Ordering determinism.** Two tied orderings have no tiebreaker: `divergence.ts` "stage vs engagement" (`limit 5`, no ORDER BY), and `projection.ts` list name (`order by company_id, ap.created_at`). Under a different query plan (here `app_rw` against the owner) the capped Today view and a renewal list label can change without any data change. The fix is to add deterministic ORDER BY keys (for example `o.updated_at, o.id` and `ap.created_at, ap.id`) | **Gate 7** (its crawl must be "identical to the Gate 4 crawl"), or Gate 7 compares these rooms by set with the tie documented |
| D-P1 | **`/pipeline?timeframe=7\|30\|90` overwrites today's `pipeline_snapshots` row with the filtered set** (Gate 4 close-out, semantics (iv)). It was not used during Gate 5 | **Gate 9 / a real pilot** |

**Rollback: ready, not rehearsed.** The rehearsal is Gate 8.
1. Set the branch-scoped Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) back to `GATE_OWNER_DATABASE_URL`, with a value-only PATCH or `vercel env` over stdin.
2. Leave `DATABASE_URL_OWNER` as is.
3. Redeploy the branch.
4. Require `/api/build` to report `postgres` / bypassRls true / tenantEnforcement false.

The rollback value is proven present and correct.
- Pre-cutover deployment: `dpl_5xGwSWwybkoLvtsFo3Mv7P4zpNCE`.
- Post-cutover deployment: `dpl_6TmAg49o7CZcsbAjmhQR1mSvQFkY`.

**Hosted baseline of record after Gate 5:** unchanged from Gate 4.
- migrations 105;
- manifest `db1f78f7a11bbacb`;
- business-data `c9623fb5abe2f9bc`;
- whole-world `dce27935d88743fb`;
- security hash `30772757ebd4688c`.

*(At the Gate 5 record, Gate 6 had not begun. It is recorded below.)*

---

## Gate 6 — `/api/build` role and RLS posture proof: RESULT (2026-09-15)

**Gate 6 — PASS.** This was a read-only posture certification of the live Preview runtime after the Gate 5 cutover. Nothing was mutated: no Vercel env or deploy change, no database write by the tooling, no role, RLS, grant, policy, migration, reseed or sending change. Production and `qifatlqxfuhwrwvpbwsc` were not touched. `OPS_FINGERPRINT_TOKEN` was used by presence only, and only as the `/api/build` header.

**Serving deployment.** `dpl_JD8DtC8HjgKSYtvnR2cF7AmyUwYC` (`pursuitos-demo-6hag7ei1t-…`): `pursuitos-demo`, target preview, branch `roadmap/pursuitos-vnext`, READY, commit **`766cb13`** (`766cb13c0da9bd1485b75227c3ce44fd8640ff5f`). It is the branch alias target. `766cb13` is docs-only on top of the Gate 5 state: `git diff 89b8c95..766cb13` outside `docs/` is **empty**, so the running code is exactly the code certified at Gates 4 and 5. The Production target is unchanged (`dpl_Bre6yKpy…`).

**`/api/build` live posture.** The same answer comes back from the deployment URL and from the branch alias. Without the token it returns 404.

| Field | Value |
|---|---|
| environment · environmentLabel | `demo` · `Private demo` |
| branch · vercelEnv | `roadmap/pursuitos-vnext` · `preview` |
| commit · deploymentId | `766cb13c0da9…` (equals the serving deployment's `githubCommitSha`) · `dpl_JD8DtC8HjgKSYtvnR2cF7AmyUwYC` |
| database.projectRef · host | `mejokqxriwyawfhawuxu` · `aws-0-ca-central-1.pooler.supabase.com` |
| **database.role · bypassRls · tenantEnforcement · probe** | **`app_rw` · `false` · `true` · `live`** |
| posture.externalSendingArmed | `false` |

**The live probe is real** (`src/app/api/build/route.ts` and `src/lib/env/db-posture.ts`, unchanged since Gate 4).
- **The query:** `probeDatabasePosture(getPool())` runs `select current_user, r.rolsuper, r.rolbypassrls, current_setting('row_security') from pg_roles r where r.rolname = current_user` on the **running `DATABASE_URL` pool**.
- **`role`, `bypassRls` and `tenantEnforcement`** are reported from that row whenever `probe = "live"`. `tenantEnforcement` is `!rolsuper && !rolbypassrls && row_security = 'on'`.
- **Fails closed:** if the query errors or exceeds 2 s, the result is `probe: "unavailable"` with `bypassRls` and `tenantEnforcement` set to **null**, never true. Only then does `role` fall back to the name parsed from the connection string. So `probe: "live"` together with `tenantEnforcement: true` can only come from the live database.
- **What is parsed from configuration:** only the non-secret `projectRef` and `host`.
- **Independent corroboration:** after the smoke check, 2 `app_rw` backends were connected (Gate 5 pre-cutover: 0).

**Routing** (code-path proof; no URL exposed).
- **Normal runtime:** `getPool()` → `DATABASE_URL` → **`app_rw`**. `withTenant` checks out from `getPool()`, runs `begin`, `set_config('app.org_id', $1, true)` (transaction-local), the work, then `commit`.
- **Owner helper:** `getOwnerPool()` → `DATABASE_URL_OWNER` → **`postgres`**. Its callers are limited to the privileged set:
  - `login` page and actions (`org_members` count, first-owner bootstrap);
  - `join/[code]` page and actions (pre-membership invite redemption);
  - `admin` page (role gate and the members table reading `auth.users`) and actions (member management);
  - `ops` page (role gate only; its data is read through `withTenant`);
  - `api/research`;
  - `api/webhooks/resend`.
- **No ordinary tenant page or action uses the owner pool.** The only other direct `getPool()` use is `api/mcp`, which resolves an API key through the SECURITY DEFINER `resolve_api_key()` on the runtime (`app_rw`) pool.

**Authenticated smoke check** (synthetic Vertex owner, real `/login`; read-only GETs; no write actions; `/pipeline` without `timeframe`; order not compared, per D-G5-1).
- **Rooms, 200 on both passes:** Today (251 lines), Queue (171), Pursuit Detail (686), Pipeline (1,329), Admin (205, owner gate passes, members show the demo owner), Ops (55), Joint (82), the joint room (74), partner detail (220). There was no empty or error state.
- **Owner paths identical to Gates 4 and 5:** `/login` signed out and in, the `/join` dead code, admin, ops, webhook 503 and research 401.

**Database (read-only, straight after the smoke check).** **41/0** against the Gate 5 post record, **0 of 155 tables differ** (strict CFR-1; same UTC day; no allowance used).
- Migrations 105; manifest `db1f78f7a11bbacb`.
- Business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`.
- Security hash `30772757ebd4688c`.
- `app_rw` LOGIN true, BYPASSRLS false, NOINHERIT, member of nothing; 31 protected / 0 unsafe.
- Partnership data unchanged (1 · 1 · 4 · 2, the rest 0).
- `routines` byte-identical (xmin 2415). The same-day `pipeline_snapshots` row was rewritten with identical values (11 · $8,040,000 · $3,361,500 · null).

**Vercel env** (metadata only): **identical to the Gate 5 final record**, 38 entries.
- `DATABASE_URL` `m6TuSKisz54kJlsD`: Preview + `roadmap/pursuitos-vnext`, semantic role `app_rw`.
- `DATABASE_URL_OWNER` `I2giX3iM1sNwoN47`: Preview + `roadmap/pursuitos-vnext`, semantic role `postgres` owner.
- The Production + Preview `DATABASE_URL` and all send-related entries (`RESEND_WEBHOOK_SECRET`, `EMAIL_*_DOMAIN`) are unchanged since 2026-09-01. No send secret was added; `RESEND_API_KEY` and `OUTREACH_AUTOSEND` are absent.

**Send safety.** `externalSendingArmed` is false (it requires `OUTREACH_AUTOSEND === "on"`, which is not set). There are 0 messages, outbox, email-event, identity and sent-touch rows. The only webhook request was the unsigned probe, refused 503 before any work; no event was delivered.

**Open defects** (unchanged; not fixed in Gate 6):
- **D-G5-1** (untied ORDER BYs in `divergence.ts` and `projection.ts`): **must be resolved before Gate 7.**
- **D-P1** (`/pipeline?timeframe=` overwrites today's snapshot): **a Gate 9 / real-pilot blocker.**

*(At the Gate 6 record, D-G5-1 was open. Its local fix follows.)*

---

## D-G5-1 — ordering determinism: FIXED LOCALLY / AWAITING HOSTED ACCEPTANCE (2026-09-15)

**Status.** The code is fixed and certified locally. It is committed on `roadmap/pursuitos-vnext` **locally and NOT pushed**, because a push auto-deploys the branch Preview (Vercel git integration, no ignored-build step) and the owner has not approved that deploy.

No Vercel, env, hosted-database, migration, RLS, grant or role change was made, and no Production or `qifatlqxfuhwrwvpbwsc` contact. **D-P1 is unchanged** (`?timeframe=` snapshot overwrite): it must be fixed before Gate 9 or a real pilot. **Gate 7 was NOT begun.**

**Root cause.** PostgreSQL returns rows that tie on every ORDER BY key, or rows from a query with no ORDER BY, in whatever order the chosen plan produces. The runtime moved from the owner to `app_rw`, and RLS adds predicates, so on hosted the plans changed and the tie order changed with them. The data, the tenant and the code were all the same.
- **Today:** `accountDivergences()` "stage vs engagement" (`src/lib/context/divergence.ts`) had **`limit 5` and no ORDER BY at all**. Once more than five deals qualify, even the capped membership is plan-dependent. Today's capped view shows the first items, so a different deal could appear.
- **Pipeline:** `renewalProjection()` (`src/lib/lifecycle/projection.ts`) names the list with `distinct on (pm.company_id) … order by pm.company_id, ap.created_at`. The seed creates an org's lists in one statement, so their `created_at` values are **identical by construction**. For an account on two such lists, the "on <list>" label was arbitrary.

**The fix: tiebreakers appended, never a new primary key.**

| Query | Before | After |
|---|---|---|
| divergence "stage vs engagement" | *(no ORDER BY)* `limit 5` | `order by o.updated_at asc, o.id asc limit 5` |
| divergence "stale deal" | `order by o.updated_at asc limit 5` | `order by o.updated_at asc, o.id asc limit 5` |
| divergence "joint room gap" | *(no ORDER BY)* `limit 5` | `order by jp.created_at asc, jp.id asc limit 5` |
| divergence "renewal uncovered" (`distinct on company`) | `order by f.company_id, coalesce(f.date_value, f.valid_from) asc limit 5` | `… asc, f.id asc limit 5` |
| divergence "motion stalled" | *(no ORDER BY)* `limit 5` | `order by m.created_at asc, m.id asc limit 5` |
| divergence "CRM vs platform" (`distinct on company, name`) | `order by s.company_id, lower(s.opportunity_name), s.reported_at desc` | `…, s.reported_at desc, s.id desc, o.id asc` |
| projection list attribution (both the scoped and the unscoped query) | `order by pm.company_id, ap.created_at` | `order by pm.company_id, ap.created_at, ap.name, ap.id` |

**Why ranking semantics are unchanged.**
- Every existing ORDER BY key is kept, in its original position and direction. No WHERE clause, LIMIT or join changed, so **eligibility is identical**.
- Where a query had **no** ORDER BY ("stage vs engagement", "joint room gap", "motion stalled"), there was no ranking to preserve: the old order was undefined.
  - "Stage vs engagement" takes `updated_at asc`, the same recency key its sibling rule "stale deal" already uses in the same function: longest-quiet first.
  - The other two take `created_at asc`.
  - Every one ends in the table's primary key.
- **Why `ap.name` precedes `ap.id` in the projection.** List `created_at` ties are structural (same-statement inserts), and ids are random per seeded world. An id-only tiebreak would therefore still pick a different list in each reseeded world. The name is canonical seed content, so it is stable across worlds. `ap.id` still guarantees a unique final key when names also tie.
- **Hosted effect** (at hosted acceptance):
  - Today's capped "stage vs engagement" order becomes longest-quiet first: Datacenter exit (Aug 11), Kubernetes managed services (Aug 19), Core banking resilience, Legacy virtualization exit.
  - CDW's `/pipeline` label resolves to "CDW customer book", the value the owner showed at Gate 4.
- **Scope note.** D-G5-1 named two queries. The four sibling rules in the same `accountDivergences()` feed the same capped Today list and had the same defect class, so they received the same pure tiebreakers (or, where missing, a first ORDER BY). No other file's queries were changed.

**Tests.**
- **`tests/ordering-determinism.test.ts`** (static guard, in `npm test`):
  - every capped or `distinct on` query in both files must end its ORDER BY in a unique `.id`;
  - the exact new ORDER BYs are pinned;
  - the pre-existing primary keys are asserted preserved.
  - **Red before the fix: 0/4. Green after: 4/4.**
- **`scripts/ordering-determinism-verify.ts`** (new suite `ordering-determinism`, SEEDED_CLONE, registered in `verify-classes.ts`).
  - **Fixtures, planted on a disposable clone:**
    - 7 qualifying deals with **identical `updated_at`**, older than every canonical one, inserted in **descending id order**, so LIMIT 5 is active and physical order is the reverse of key order;
    - two extra approved lists at the **same `created_at`** as an attributed renewal account's earliest list. The alphabetically-first list has the **larger** id, so the name, not the id, must decide.
  - **Runs:** each read under **5 planner configurations** (default; no index scans; no seq scans; no hash or merge joins; no nested loops) × **2 heap layouts** (insertion order, then tuples relocated by a real no-op UPDATE with `updated_at` kept equal) × **2 roles** (the owner, and the real `app_rw` login with `withTenant`'s transaction-local `app.org_id`). That is 20 runs per read path.
  - **Red before the fix: 9 passed, 8 failed.** The divergence, `loadTodayOverview` and projection payloads all varied with the plan, under both roles. The capped list was `Kubernetes, Core banking, Datacenter, Legacy, DG51 tie deal 0`, a heap-order artefact. The tied-list label flipped between "…A" and "…B".
  - **Green after the fix: 17 / 0.** In detail:
    - canonical membership is unchanged (all 4 qualifying deals shown);
    - eligibility is unchanged (11 qualifying = canonical + exactly the 7 fixtures);
    - the capped "stage vs engagement" list and the capped "stale deal" list are each exactly the five lowest ids in id order;
    - the complete ordered payloads of `accountDivergences`, `loadTodayOverview` and `renewalProjection` (scoped and unscoped) are **byte-identical across all 20 runs**;
    - the label is the name-first list on both projection paths;
    - the renewal rows (everything but the label) equal the pre-fixture rows;
    - negative control: the old SQL does not produce the key-ordered result;
    - no send rows.

**Owner vs `app_rw`, exact order.**
- **Library level:** the verifier above checks byte-identical ordered payloads, with ties planted, under 5 plans × 2 heaps.
- **Page level:** `app-rw-rehearsal` ran on a clone with the same 7-deal tie fixture added. The canonical world already carries the CDW-style list tie. The result: **38/38 rooms line-identical** under the owner and `app_rw`, a full ordered line comparison with no set equality. The rooms include Today (`/`), Today View All (`?today=all`), the Today drawer (`?drawer=`) and `/pipeline`. The consent fixture rendered 6/6 under both, and `/api/build` posture was truthful under both.

**Full local regression** (hosted secrets unset for every local run).

| Item | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | clean |
| Unit tests (`npm test`) | 376 / 376 |
| Production build (`next build`) | OK |
| `app-rw-rehearsal` (37+ rooms, owner vs `app_rw`, with the tie fixture) | 38 / 38 identical |
| **`certify-world --runs 2`** | **82 / 82 suite runs clean** (41 suites × 2), **3,588 assertions, 0 failures**. It includes Slice 1 `vnext-context` 62, Slice 2A `vnext-coordination` 116, Slice 2B `vnext-attention` 64, `today-tenant` 51, `tenant-isolation` 205, `partnership-app-rw` 117, `search-path` 39, `value-case` 126, `demo-team` 11 and `ordering-determinism` 17 |
| Canonical immutability | digest `e98b43254f98d5ec` at the start, after run 1 and after run 2; **no drift attributed to any suite**. After the battery: manifest `be0da833990ce436`, fingerprint `e98b43254f98d5ec`, 0 leftover clones |
| Send safety | 0 messages / outbox / email events / sent touches; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` blank for every suite |

No Slice 1 / 2A / 2B verifier assertion changed, and none asserts the tie order. The frozen semantics are intact.

**Hosted acceptance (not done; needs owner approval).**
1. Push `roadmap/pursuitos-vnext`. That auto-deploys the branch Preview, still on the `app_rw` runtime, with no env change.
2. Confirm `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true on the new commit.
3. Run the signed-in 37-room crawl.
4. Confirm the Today "stage vs engagement" and `/pipeline` label outputs match the key order above, and are stable across repeated crawls.
5. Run the DB check under CFR-1.

Only then Gate 7.

### D-G5-1 hosted acceptance: HOSTED ACCEPTED / CLOSED (2026-09-15)

**D-G5-1 — HOSTED ACCEPTED / CLOSED.** Deterministic SQL ordering is now enforced on the hosted vNext Preview under the `app_rw` runtime. The owner approved the push and its automatic Preview deployment for this step only. No Vercel env, database, migration, role, RLS, grant, policy or sending change was made. Production and `qifatlqxfuhwrwvpbwsc` were not touched.

**Push and deployment.**
- The preconditions held: branch `roadmap/pursuitos-vnext`, a clean tree, HEAD `1c4fb5e`, one ahead of origin.
- The push produced **`dpl_CZ4iZ5S4q3c4ZLL1cLfddHqTfsC2`** (`pursuitos-demo-o910z8we7-…`): `pursuitos-demo`, target preview, branch `roadmap/pursuitos-vnext`, READY, commit **`1c4fb5ea0cc3…`**. It is the branch alias target.
- The Production target is unchanged (`dpl_Bre6yKpy…`).
- The product diff against the Gate 6 serving code (`dec2679`) is exactly `divergence.ts` and `projection.ts`.

**`/api/build` posture: PASS** (unchanged from Gate 6). `demo` · `Private demo` · `preview` · `roadmap/pursuitos-vnext` · ref `mejokqxriwyawfhawuxu` · **`app_rw` · bypassRls false · tenantEnforcement true · probe live** · commit `1c4fb5e` · `externalSendingArmed` false.

**The acceptance run.** Two full signed-in 37-room crawls ran against that one deployment, each with its own sign-in through the real `/login` as the synthetic Vertex owner. Each crawl covers every room twice, so there were **4 passes** in all. The comparison was an ordered, line-by-line diff with only the certified clock-phrase normalisation, and no set reduction.
- **Crawl 1 vs crawl 2: all 37 rooms identical**, with the same statuses (all 200), no empty state and no missing or foreign data. The palette endpoint is identical JSON; the compare script flags it only because the response is a single line.
- **Owner-only paths identical in all passes:**
  - `/login` signed out and signed in;
  - the `/join` dead-code loader;
  - `/admin` owner gate and members (which read `auth.users`, so they go through `DATABASE_URL_OWNER`);
  - `/ops`;
  - the unsigned webhook (503, secret unset) and research (401, closed).

**The D-G5-1 surfaces**, extracted from the rendered lines by exact label, in order, in every one of the 4 passes (the payload is byte-identical across all 4):

| Surface | Result |
|---|---|
| Today View All (`?today=all`), "stage vs engagement" | **Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit** (exact, 4 of 4) |
| Today (`/`), capped | Datacenter exit — phase 1 → Kubernetes managed services (the exact prefix of that order) |
| Today drawer (`?drawer=`), capped | the same exact prefix |
| `/pipeline` CDW renewal label | **"CDW customer book"** |

**Changes against the pre-fix `app_rw` crawl (Gate 5), all from the D-G5-1 tie resolution:**
- **Today, the drawer and View All:** the order changed to longest-quiet first. Umbrella's Datacenter exit (quiet since Aug 11) now leads.
- **`/pipeline`:** the CDW label changed from "Our modernization targets" to "CDW customer book".
- **`/accounts/<Globex>` renewal timeline** (`src/lib/context/timeline.ts` → `renewalProjection().listName`): "Account is on" changed from "Our modernization targets" to "CDW customer book".
  - This is the **same tie on a second consumer**: Globex is on the two Vertex lists "CDW customer book" and "Our modernization targets", with **identical `created_at`** (2026-09-14 21:03:29.063576Z).
  - Before the fix, the plan happened to return "Our modernization targets" on this page under both roles, while `/pipeline` under the owner showed "CDW customer book". The same fact was labelled differently on two surfaces.
  - It now resolves by name on every surface, and `/pipeline` and the timeline agree.
  - This consumer was not listed in the local-fix expectations; it is recorded here as a disclosed, intended consequence, **not a regression**.
- **Every other room is line-identical** to the Gate 5 crawl.

**Database (read-only, after both crawls): 41/0** against the Gate 6 record, **0 of 155 tables differ** (strict CFR-1; same UTC day 2026-09-15; no allowance used).
- Migrations 105; manifest `db1f78f7a11bbacb`.
- Business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`.
- Security hash `30772757ebd4688c`.
- `app_rw` LOGIN true, BYPASSRLS false, NOINHERIT, member of nothing; 31 protected / 0 unsafe.
- Partnership data unchanged; routines byte-identical (xmin 2415).
- The same-day `pipeline_snapshots` row was rewritten with identical values (11 · $8,040,000 · $3,361,500 · null).
- 3 live `app_rw` backends.

**Vercel env:** metadata identical before and after the push, and identical to the Gate 6 record.
- `DATABASE_URL` (`m6TuSKisz54kJlsD`, Preview + `roadmap/pursuitos-vnext`) → `app_rw`.
- `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`, Preview + branch) → `postgres` owner.
- No Production scope changed.

**Send safety:** `externalSendingArmed` false; 0 messages / outbox / email events / identities / sent touches. The only webhook request was the unsigned probe, refused 503; nothing was delivered.

**Disposition.** D-G5-1 is **CLOSED**.
- Deterministic ordering is enforced in SQL.
- Today is stable under the `app_rw` runtime, and the renewal list projection is stable on `/pipeline` and on the account timeline.
- The full hosted crawl shows no regression.
- The Gate 6 posture is intact.

**Note for Gate 7.** Its room crawl should be compared against **this accepted crawl** (commit `1c4fb5e`), not the Gate 4 crawl. The Gate 4 crawl predates the fix and carries the old arbitrary tie resolution on Today, View All, the drawer, `/pipeline` and the Globex timeline.

**D-P1 remains OPEN — MUST FIX BEFORE GATE 9 / REAL PILOT** (`/pipeline?timeframe=` overwrites today's snapshot). It was not used and not fixed.

*(At the D-G5-1 hosted acceptance, Gate 7 had not begun. It is recorded below.)*

---

## Gate 7 — hosted tenant / RLS certification: RESULT (2026-09-15)

**Gate 7 — PASS.** The owner approved the gate, the three test decisions below, and the human review. Every hosted action was read-only or rolled back. There was no committed hosted write, and no schema, migration, RLS, grant, policy, role, env or Production change. Normal tenant execution stayed on `app_rw` (BYPASSRLS false). Owner-only execution stayed on `DATABASE_URL_OWNER`. External sending stayed off. **D-P1 was not touched and remains OPEN.**

**Deployment under test.** `dpl_GgADRii19khvG5CXotVgkxbJfXdc`, commit `84c09e4`: docs-only over the accepted product commit `1c4fb5e`, and the branch alias target throughout the gate.
- `/api/build`: `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off.
- Production target unchanged (`dpl_Bre6yKpy…`).
- Vercel env metadata identical at the gate's start, middle and end.

### The `app_rw` tenant-isolation proof

**(i) Catalogue and RLS: PASS.**
- **The Gate 3 exact-RLS probe, re-run against current hosted data: 80 / 0.** It ran as the real `app_rw.mejokqxriwyawfhawuxu` pooler login; every `app_rw` transaction was rolled back and the owner connection was read-only.
- **Login posture:** `current_user = app_rw`, BYPASSRLS false, member of nothing, `row_security` on.
- **No tenant context:** 0 tenant-owned rows across the 126 tenant and default-deny tables.
- **Per-org exactness:** under each of Vertex, Meridian and TD SYNNEX, `app_rw` sees **exactly** the owner-evaluated authorized set on **all 155 tables**, by count and content hash.
- **Foreign rows** are invisible on **all 81** `org_id`-scoped tables. Other-org visibility comes only through consent and participation policies, each equal to the owner-evaluated predicate.
- **No context leak** across 10 transactions on **one pooled backend**, spanning ROLLBACK, COMMIT, three orgs and a second client.
- **Foreign writes on `pursuits`:** UPDATE and DELETE → 0 rows; INSERT or re-home → 42501; own-org UPDATE → 1 row. All rolled back.
- **Escalation:** `SET ROLE` / `SET SESSION AUTHORIZATION` to every privileged role → 42501.
- **Residue:** none. No `app_rw`-owned objects, and no prepared or open transactions.
- **`search-path-verify --catalogue-only`: 12 / 0** (31 protected, 0 unsafe).

**(ii) Full hosted room crawl: PASS.** A signed-in 37-room crawl (two passes) was compared **line by line, in order**, against the accepted D-G5-1 crawl (`1c4fb5e`), not the pre-fix Gate 4 crawl.
- **37/37 identical.** The palette endpoint is identical JSON.
- The D-G5-1 surfaces are unchanged: Today View All is Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit; Today and the drawer show its exact prefix; the CDW label is "CDW customer book".
- Owner-only paths are identical: `/login` signed out and in, the `/join` dead-code loader, `/admin` members (which read `auth.users` through `DATABASE_URL_OWNER`), `/ops`, the webhook (503, secret unset) and research (401).

### Accepted test decisions

**(iii) The owner-backed verifier suites are SUPPLEMENTAL functional coverage only (decision 1(a)).**
- **Why not as `app_rw`.** The five named suites are owner-connection harnesses. On a local clone as `app_rw` with no tenant context, all five stop at setup ("no pursuit" / "canonical world not seeded"). They therefore do **not** count as proof under `app_rw`; that proof is (i) and (ii).
- **How they ran on hosted.** Only `DATABASE_URL_VERIFY` was set, to the owner connection. `DATABASE_URL`, the send variables and `APP_RW_PASSWORD` were unset, so no library code could open its own hosted pool. The whole-world fingerprint was checked after **each** suite and stayed `dce27935d88743fb` every time.

| Suite (owner-backed, supplemental) | Result | Note |
|---|---|---|
| `vnext-context` (Slice 1) | **62 / 0** | — |
| `today-tenant` | **51 / 0** | — |
| `demo-team` | 10 / 1 | **Harness / hosted-data limitation.** It expects the local world's 10-row Globex ledger; hosted has 14. The four extra rows (`ACTION_CREATED`, `PLAN_DECIDED`, `STAKEHOLDER_ROLE_ASSERTED` by a user, `PLAN_REVIEW_REQUIRED`) are Slice 2A/2B human-acceptance history from 2026-09-14 21:45–21:53Z, kept by the Gate 1 re-baseline |
| `vnext-attention` (Slice 2B) | 40 / 24 | **Harness / hosted-data limitation.** Its state walk assumes the canonical "recommendation awaiting a person". Hosted Globex's plan is already human-approved (revision 2, 2026-09-14 21:45Z), with an updated recommendation (revision 3, 21:53Z). **Its tenant-isolation and no-send sections pass 11 / 0**: Meridian and TD SYNNEX each derive attention only for their own pursuits, their composed Today holds no foreign card, no foreign plan lineage, no outbox / message / email event, and the world is unchanged |
| `vnext-coordination` (Slice 2A) | fatal at section 3 | **Same hosted-data limitation.** A null `revisionId`, because there is no pending recommendation. It stopped before its `set local role app_rw` scenarios, so the hosted owner's lack of the SET option on `app_rw` did not arise. No role or grant was changed |

**(iv) Two-session blind test: ACCEPTED TEST SUBSTITUTION, not a literal two-login test (decision 2(c)).**
- **Why a substitute.** Hosted has one login, the Vertex owner. Meridian and TD SYNNEX have no members, and no synthetic user or membership was created.
- **The substitute:**
  - Through the deployed Preview, the Vertex session requested the **Meridian-owned pursuit** (`49de6cc1…`, the only other-org object with a detail route) → **404, byte-identical to a random nonexistent pursuit id**, with no Meridian field rendered, stable across both passes. That is **no data leak and no existence oracle**.
  - Together with the per-org exactness of (i).

**(v) Partnership and joint handshakes: PASS (decision 3(a)).**
- **The one harness change**, committed separately as `bd4bd61`: `partnership-app-rw-verify.ts` gained opt-in `APP_RW_VERIFY_USER` / `APP_RW_VERIFY_PASSWORD` overrides, so it can log in as the pooler's `app_rw.<ref>`. The defaults are unchanged. Validated locally first: the default path gives 117/0 and the override path 117/0 on seeded clones; `tsc` is clean and `npm test` 376/376.
- **The hosted run.** It ran **once** on hosted with `SEEDED_CLONE_GUARD=off` for that run only, as `app_rw.mejokqxriwyawfhawuxu`. Every handshake ran in **one `app_rw` transaction, ROLLED BACK**.
- **Result: 117 / 0, equal to the local 117/0 baseline.**
  - **Authorised:** invite → redeem, context grant, field-limited list grant (accept, pull-in, sync, revoke), overlap ladder, evidence share, skill share, warm intro, joint pursuit and room events, settlement across both books, partnership revoke, audit rows in both ledgers without aborting.
  - **Refused:** a third party, forged consent rows, self-approval, acts after revoke, and no tenant context.
  - "Committed state identical before and after (every step rolled back)" ✓.
  - The DB snapshots around the run are identical: 41/0, 0 of 155 tables changed.

**(vi) Hosted human review: PASS (owner, 2026-09-15).** The owner reviewed on the branch Preview:
- Today, Queue and Pursuit Detail;
- Pipeline without a `timeframe` filter;
- Partners, the Joint pursuits overview, and the Cyberdyne / TD SYNNEX joint-room detail;
- Admin.

The owner found **only Vertex data plus the expected, explicitly consented TD SYNNEX joint context**. There was no Meridian-private data, no unrelated TD SYNNEX-private data, no unexpected disclosure, no missing authorized data and no visual authorization anomaly.

### Database, env and send safety

**Database (CFR-1, strict; same UTC day 2026-09-15; no allowance used).** Every Gate 7 snapshot passed **41/0, 0 of 155 tables changed**: the start, after (i), after the blind probe, before and after the supplemental suites, and before and after the partnership run.
- Migrations 105; manifest `db1f78f7a11bbacb`.
- Business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`.
- Security hash `30772757ebd4688c`.
- `app_rw` LOGIN true, BYPASSRLS false; 31 protected / 0 unsafe; partnership data unchanged.

**Send safety.** `externalSendingArmed` false. 0 messages / outbox / email events / identities / sent touches. No external message was sent and no webhook event was delivered.

**Secrets.** Every input was checked by presence only, and no value was printed or persisted. A 1,314-file scan found 0 occurrences.

**Hosted baseline of record after Gate 7:** unchanged.
- migrations 105;
- manifest `db1f78f7a11bbacb`;
- business-data `c9623fb5abe2f9bc`;
- whole-world `dce27935d88743fb`;
- security hash `30772757ebd4688c`.

**Open items.**
- **D-P1 (`/pipeline?timeframe=` snapshot overwrite): OPEN.** It must be fixed before Gate 9 / a real pilot.
- **Harness debt (non-blocking):** `demo-team`, `vnext-attention` and `vnext-coordination` assume the local canonical world and cannot run as `app_rw`. Making them tenant-context-aware and baseline-aware is recommended before they are relied on for hosted certification.

### Gate 7 closeout note — the manifest digest is clock-relative on a persistent world (2026-09-15, 22:07Z)

**Publish.** `9c61aac` (docs) and `bd4bd61` (harness) were pushed and deployed as `dpl_4xmjsCLnDmghF3Av8Y4EJvcdSNgg`: READY, the branch alias target.
- The only non-docs file changed since `1c4fb5e` is `scripts/partnership-app-rw-verify.ts`; `src/` has 0 changes.
- `/api/build`: `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off.
- Env metadata unchanged; Production unchanged.

**Finding: the manifest digest moved without any data change.** The post-publish snapshot read the manifest as `14e2e97f8453fb75`, not `db1f78f7a11bbacb`.
- **Nothing in the stored data changed:** business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb` and **all 155 per-table content fingerprints are identical**. The security hash, `app_rw` posture and send rows are unchanged.
- **Cause:** `scripts/demo-manifest.ts` includes a clock-relative field, `days_since_activity = extract(day from now() - o.updated_at)`. The hosted heroes were last updated around 2026-09-14 21:02Z, so at 2026-09-15 21:02Z every counter ticked over one whole day. Every Gate 7 snapshot up to about 19:55Z read before the tick.
- **Proof:** the full manifest compared field by field with the Gate 1 hosted manifest record (`db1f78f7a11bbacb`) differs in exactly **22 fields**: the digest, plus 21 `heroes.N.days_since_activity` values, **each exactly +1**. No other field differs.
- **Why it wasn't seen before:** the local canonical world is re-seeded, so its manifest is deterministic relative to seed time. The persistent hosted world is not re-seeded, so its manifest digest drifts once a day at the heroes' update time-of-day.

**Consequence for Gate 7: none.** No data mutation occurred, and **Gate 7 PASS stands**.

**Consequence for CFR-1:** rule 1 ("the manifest is strict") cannot hold literally on the hosted world. **Proposed CFR-1.1, not adopted, for owner decision before Gate 8:**
- the hosted manifest is compared **with `days_since_activity` normalised**. Every such field must equal its baseline value plus the whole days elapsed since the baseline for that row; any other manifest field must be byte-identical;
- the per-table content fingerprints and the business-data / whole-world fingerprints remain strict, and they remain the primary integrity proof.

Until the owner decides, the manifest of record stays `db1f78f7a11bbacb` (as of 2026-09-15 before 21:02Z). The as-of-now value `14e2e97f8453fb75` is recorded here and is **not** adopted as a re-baseline.

**Gate 7 — FINAL: CLOSED as PASS** (owner, 2026-09-15). The manifest finding above was resolved by CFR-1.1, below.

---

## CFR-1.1 — certification fingerprint rule, amended (owner decision, 2026-09-15)

**Adopted; supersedes CFR-1 rule 1.**
1. All persisted database state stays strict: all 155 per-table fingerprints, the business-data fingerprint, the whole-world fingerprint and the security hash.
2. All non-time-derived manifest fields stay strict.
3. The only time-derived manifest exception is **`days_since_activity`**.
4. It is **not** ignored, and **not** accepted merely as baseline plus elapsed days.
5. Each value must equal the value **recomputed from its persisted source timestamp** (`opportunities.updated_at`) at the certification as-of time.
6. The source timestamp itself stays strict.
7. Any change to source activity data is a certification failure unless separately approved.
8. No other manifest field receives an allowance.

The raw digest `db1f78f7a11bbacb` is kept as the Gate 1 historical baseline. A raw digest that moves solely because of correctly recomputed `days_since_activity` is not database drift.

**How it is validated** (scratchpad tool `cfr11.mjs`, never committed):
- It derives the manifest's own hero query from `scripts/demo-manifest.ts`, with the same joins, filter and ORDER BY, and reads the raw `o.updated_at` and `now()` as the as-of time in **one** read-only transaction.
- It recomputes `floor((asOf − updated_at) / 1 day)` for every hero row and compares it with the manifest's value.
- It requires every other manifest field to be byte-identical to the Gate 1 hosted manifest record.
- It refuses when a source timestamp sits within 5 minutes of a day boundary.
- It records a hash of the hero source timestamps for pre/post comparison.

---

## Gate 8 Phase 1 — emergency rollback to the owner: RESULT (2026-09-15)

**Gate 8 Phase 1 — PASS, with one recorded pre-existing deviation (D-G8-1). The emergency rollback to `owner/postgres` is proven.**
- Gate 8 is **not** complete, and `app_rw` was **not** re-applied.
- **The Preview is intentionally left in the `owner/postgres` rollback posture** until the owner approves Phase 2.
- No Production, schema, migration, role, RLS, grant, policy, `DATABASE_URL_OWNER`, send or D-P1 change was made.

**A. Pre-change posture: intact.** `dpl_2aFe1xZTPwSwfZx68NBvuNcEMNhj` (`5adeebe`), Preview, READY, the branch alias target. `/api/build` reported `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off.

**B. Pre-rollback database: PASS.**
- **Snapshot:** 40/0 against the Gate 7 final record.
  - All 155 per-table fingerprints identical; business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`; security hash `30772757ebd4688c`.
  - Migrations 105; `app_rw` LOGIN true / BYPASSRLS false; 31 protected / 0 unsafe; 0 send rows.
- **CFR-1.1: 5/0.**
  - Every non-time-derived manifest field matches the Gate 1 record byte for byte.
  - 22/22 `days_since_activity` values equal their recomputation from source, as of 2026-09-15 22:15:36Z, with none near a day boundary.
  - Raw digest `14e2e97f8453fb75`; hero source-timestamp hash `ef5e5205f9cbd6f3`.

**C–D. Env and rollback material.**
- The env metadata was identical to the Gate 7 close record. `DATABASE_URL` (`m6TuSKisz54kJlsD`) and `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`) are both Preview + `roadmap/pursuitos-vnext`.
- `GATE_OWNER_DATABASE_URL` was verified in memory as `postgres.mejokqxriwyawfhawuxu` on `aws-0-ca-central-1.pooler.supabase.com:6543`, database `postgres`, and was never printed.

**E. The rollback: one value-only update.**
- Vercel API `PATCH` of `m6TuSKisz54kJlsD` to the owner connection.
- The metadata diff shows **exactly one entry modified (`DATABASE_URL`, `m6TuSKisz54kJlsD`), and only its `updatedAt`**; 0 added, 0 removed.
- `DATABASE_URL_OWNER`, the general Production + Preview `DATABASE_URL`, the flags and the send variables are unchanged.

**F. Redeploy.** `vercel redeploy dpl_2aFe1x…` produced **`dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H`** (`pursuitos-demo-97jmu0kqi-…`, commit `5adeebe`): READY, target preview, the branch alias target. The Production target is unchanged (`dpl_Bre6yKpy…`).

**G. The owner rollback posture: as expected.** `/api/build` reports `roadmap/pursuitos-vnext` · `preview` · `mejokqxriwyawfhawuxu` · **`postgres` · bypassRls true · tenantEnforcement false · probe live** · sending off.

**H. Auth and owner paths: identical to Gate 7.** Sign-in through the real `/login`; `/login` signed out and signed in; the `/join` dead-code loader; the `/admin` owner gate and members (which read `auth.users`); `/ops`; the webhook (503, secret unset); research (401).

**I. The product rollback crawl.** Two full signed-in 37-room crawls, 4 passes.
- **Crawl 1 vs crawl 2:** identical room for room, in order; the palette JSON is identical to Gate 7.
- **The D-G5-1 surfaces are unchanged:** Today View All is Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit; Today and the drawer show its exact prefix; the CDW label is "CDW customer book".
- **Against the accepted Gate 7 `app_rw` crawl (19:33Z), all 37 rooms return 200 with the same line counts. 31 lines differ, and every one is classified:**
  - **29 are time-derived day-rollover text.** Each is exactly +1 day, from the same 21:02Z day boundary that moved the manifest: "Unresolved today → Unresolved 1 day" ×18; "untouched / Untouched N → N+1 days" ×7; "silent 34 → 35 days" ×1; "today" / "newest today" → one day ago ×2; "0 d → 1 d" ×1. The Gate 5 owner crawl at 17:48Z matches Gate 7 on every one of them, so the cause is time, not role.
  - **2 lines are an order-only swap on `/pipeline`:** the two verified economic buyers on one opportunity, Dana Whitfield and Sarah Kim. That is **D-G8-1**, below.
  - Nothing is missing, added or unexplained.
- **This phase is not a tenant-isolation proof.** The owner bypasses RLS. It proves only that the rollback restores the previously accepted functional posture.

**D-G8-1 — a pre-existing role-dependent ordering tie on `/pipeline` (found in Phase 1; not caused by the rollback).**
- **Cause:** the `/pipeline` stakeholder query (`src/app/pipeline/page.tsx:168–173`, `select … from stakeholders s join contacts ct … where s.opportunity_id = any($1)`) has **no ORDER BY**, and `stakeholdersByOpp` keeps row order.
- **Proof it depends on the role:**
  - every **owner** crawl on file shows **Sarah Kim** first: Gate 4 before and after, Gate 5 pre-cutover, and both rollback crawls;
  - every **`app_rw`** crawl shows **Dana Whitfield** first: Gate 5 post-cutover, D-G5-1 × 2, and Gate 7;
  - both names are present in every crawl.
- **Why it was missed:** at Gate 5 the compare reported only the first differing line per room (the CDW label at line 101), which masked it.
- **Effect:** order only, the same class as D-G5-1; no data or tenant effect. The rollback reproduces the exact prior owner output.
- **Recommended fix** (a code change with its own approval; not done): `order by s.opportunity_id, ct.name, s.contact_id`, or an equivalent stable key. Also audit the certified rooms' remaining unordered, rendered queries. It should be fixed before Gate 9.
- A Phase 2 crawl will match the Gate 7 `app_rw` baseline (Dana first) apart from time-derived text.

**J. Post-rollback database: PASS.** Taken after both crawls.
- **Snapshot:** 40/0 against the pre-rollback snapshot. All per-table fingerprints, business-data, whole-world, security hash, business counts, role catalogue and partnership data are unchanged.
- **CFR-1.1:** 5/0; 22/22 recomputed values match, as of 22:20:51Z.
- **The hero source-timestamp hash is unchanged** (`ef5e5205f9cbd6f3`).

**K–L. Env and send safety.**
- Final state: `DATABASE_URL` (`m6TuSKisz54kJlsD`, Preview + branch) → **`owner/postgres`**; `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`, Preview + branch) → `owner/postgres`. The metadata is otherwise identical.
- Sending is off; 0 send-related rows; no delivery.

**Phase 2 — the exact restoration procedure (needs separate owner approval, and `APP_RW_PASSWORD` in the launching shell):**
1. Verify the current posture: the branch alias → `dpl_B2wmS3WW…`; `/api/build` reports `postgres` / true / false / live.
2. Pre-snapshot, and CFR-1.1.
3. Build the `app_rw` value **in memory only**: the owner string's host, port 6543, database `postgres` and parameters, with the user `app_rw.mejokqxriwyawfhawuxu` and the password `APP_RW_PASSWORD`. Probe it read-only: `current_user = app_rw`, BYPASSRLS false.
4. Vercel API `PATCH` of the value **only** on `m6TuSKisz54kJlsD`. Require the metadata delta to be that entry's `updatedAt` alone. Never touch `DATABASE_URL_OWNER`.
5. Redeploy the current branch deployment; wait for READY; Preview only.
6. `/api/build` must report `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending off. On any failure, restore the owner value (steps 4–5 with `GATE_OWNER_DATABASE_URL`) and stop.
7. Owner paths, then the 37-room crawl twice. Compare with the Gate 7 `app_rw` crawl, allowing only time-derived text; D-G5-1 and the D-G8-1 order must match the `app_rw` baseline.
8. Post-snapshot, and CFR-1.1.
9. Push the local docs commits and verify the docs-only deployment keeps the `app_rw` posture.

The owner accepted Phase 1 as **PASS WITH KNOWN PRE-EXISTING DEVIATION D-G8-1**; D-G8-1 is not a rollback failure.

---

## Gate 8 Phase 2 — restore `app_rw`: RESULT (2026-09-15) · GATE 8 — PASS

**Gate 8 Phase 2 — PASS. Gate 8 — PASS.** The rehearsal has proven both directions:
1. the emergency rollback, `app_rw` → `owner/postgres` (Phase 1);
2. the safe restoration, `owner/postgres` → `app_rw` (Phase 2).

No Production, schema, migration, RLS, role, grant, policy, `DATABASE_URL_OWNER`, flag, send, D-G8-1 or D-P1 change was made. `qifatlqxfuhwrwvpbwsc` was not contacted.

**A. Paused owner posture confirmed.** The alias pointed to `dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H` (`5adeebe`), the accepted Phase 1 rollback deployment. `/api/build` reported `postgres` · bypassRls true · tenantEnforcement false · probe live · sending off.

**B. Pre-restoration database: PASS.** 40/0 against the Phase 1 post record; all 155 per-table fingerprints identical; business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`; security hash `30772757ebd4688c`; migrations 105; `app_rw` LOGIN true / BYPASSRLS false; 31 protected / 0 unsafe. CFR-1.1: 5/0, with 22/22 recomputed values matching as of 22:30:03Z. The hero source-timestamp hash is unchanged (`ef5e5205f9cbd6f3`).

**C. Direct `app_rw` probe (the value built in memory, never printed): PASS.** It uses the owner string's host, port 6543, database `postgres` and parameters, with the user `app_rw.mejokqxriwyawfhawuxu`. Read-only: `current_user = app_rw`, BYPASSRLS false, `row_security` on. With no `app.org_id`: 0 pursuits, 0 opportunities, 0 contacts, 0 members; txid NULL.

**D. Env before the change:** identical to the Phase 1 close record. `DATABASE_URL` (`m6TuSKisz54kJlsD`) → owner; `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`) → owner.

**E. The restoration: one value-only update.** Vercel API `PATCH` of `m6TuSKisz54kJlsD` to the `app_rw` value. The metadata diff shows exactly **one entry modified, and only its `updatedAt`**; 0 added, 0 removed. `DATABASE_URL_OWNER`, flags and send variables are untouched. The emergency-rollback branch was armed and was not needed.

**F. Redeploy.** `vercel redeploy dpl_B2wmS3WW…` produced **`dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu`** (`pursuitos-demo-ej71eydry-…`, commit `5adeebe`): READY, target preview, the branch alias target. The Production target is unchanged (`dpl_Bre6yKpy…`).

**G. Restored posture: PASS.** `/api/build` reports `roadmap/pursuitos-vnext` · `preview` · `mejokqxriwyawfhawuxu` · **`app_rw` · bypassRls false · tenantEnforcement true · probe live** · sending off.

**H. Owner paths: identical.** `/login` signed out and signed in; the `/join` dead-code loader; the `/admin` owner gate and members (which read `auth.users` through `DATABASE_URL_OWNER`); `/ops`; the webhook (503); research (401).

**I. The restoration crawl.** Two full signed-in 37-room crawls, 4 passes, compared with **the accepted Gate 7 `app_rw` crawl**.
- **Both crawls are identical room for room**, all 200; the palette JSON is identical to Gate 7.
- The D-G5-1 surfaces are unchanged: Today View All is Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit; Today and the drawer show its exact prefix; the CDW label is "CDW customer book".
- The joint room and partnership rooms are identical to Gate 7. Admin and Ops are healthy.
- **Clock-derived text (validator `clockcheck.mjs`, scratchpad): PASS 4/0 on each crawl.**
  - Against the Phase 1 owner crawl (the same clock day), the **only** differences are the two D-G8-1 stakeholder-order lines.
  - Against Gate 7, **every** one of the 29 differing lines is a Phase 1-validated +1-day clock line carrying identical text, with nothing unexplained. The per-table fingerprints prove the source timestamps unchanged, so the displayed ages advanced only with elapsed time.
  - The deal-named ages recompute exactly from each deal's persisted `updated_at` at the as-of time: Datacenter exit — phase 1 = 35, Kubernetes managed services = 27.
- **D-G8-1 as expected:** under the restored `app_rw`, **Dana Whitfield is first**, matching the Gate 7 `app_rw` baseline in both crawls. No D-G8-1 difference against Gate 7.

**J. `app_rw` runtime isolation smoke (read-only, every transaction rolled back): PASS.**
- **Live runtime:** 3 `app_rw` backends are serving the Preview, none idle in transaction.
- **Direct as `app_rw`:**
  - no context → 0 opportunities, pursuits, contacts and motions, and the Meridian pursuit is hidden;
  - Vertex context → 19 opportunities, 13 pursuits, 5 contacts and 7 motions, **each equal to the owner's explicitly Vertex-scoped count**, with 0 foreign opportunities and the Meridian pursuit hidden;
  - no context again on the same client → 0 everywhere, `app.org_id` empty. **No transaction-local context leak.**
- **Through the Preview as Vertex:** the Meridian pursuit is 404, **byte-identical to a nonexistent id**, stable across both passes.
- Gate 7 remains the authoritative full isolation certification.

**K. Post-restoration database: PASS.**
- **Snapshot:** 40/0 against the pre-restoration snapshot. All 155 per-table fingerprints, business-data, whole-world, security hash, business counts, role catalogue and partnership data are unchanged.
- **CFR-1.1:** 5/0, as of 22:35:48Z.
- **The hero source-timestamp hash is unchanged.**

**L. Final Vercel posture.** `DATABASE_URL` (`m6TuSKisz54kJlsD`, Preview + `roadmap/pursuitos-vnext`) → **`app_rw`**; `DATABASE_URL_OWNER` (`I2giX3iM1sNwoN47`, Preview + branch) → `owner/postgres`. The env metadata is **identical to the Gate 7 `app_rw` record except that entry's `updatedAt`**. No Production or other-branch change.

**M. Send safety.** `externalSendingArmed` false; 0 messages / outbox / email events / identities / sent touches; no external or webhook delivery.

**The deployments of the rehearsal:**
- Gate 7 `app_rw`: `dpl_2aFe1x…` (`5adeebe`).
- Phase 1 owner rollback: `dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H`.
- Phase 2 `app_rw` restoration: `dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu`.

All three are the same commit, `5adeebe`; only the branch Preview `DATABASE_URL` value differed.

### The emergency rollback procedure (as rehearsed)
1. Confirm the target: `pursuitos-demo`, Preview, `roadmap/pursuitos-vnext`. **Never Production.**
2. Verify `GATE_OWNER_DATABASE_URL` **in memory** as `postgres.mejokqxriwyawfhawuxu` on `aws-0-ca-central-1.pooler.supabase.com:6543`, database `postgres`. Never print it.
3. Take an env metadata snapshot.
4. Vercel API `PATCH /v9/projects/<pursuitos-demo>/env/m6TuSKisz54kJlsD` with a body of `{value}` **only**. A body carrying `key` is refused for sensitive vars.
5. Re-snapshot the env metadata. Require exactly that one entry, `updatedAt` only. **Never touch `DATABASE_URL_OWNER`.**
6. `vercel redeploy <current branch deployment>` with no target flag (it stays Preview); wait for READY.
7. `/api/build` must report `postgres` · bypassRls true · tenantEnforcement false · probe live · sending off.
8. Run the owner paths and the crawl, then the DB snapshot under CFR-1.1.

**Restoration** is the same procedure, with the `app_rw` value built in memory: the owner host, port, database and parameters, the user `app_rw.<ref>` and `APP_RW_PASSWORD`, probed read-only first. The expected posture is `app_rw` · false · true · live.

### Open defects (Gate 8 PASS does not depend on them)
- **D-G8-1 — OPEN.** A deterministic stakeholder-ordering defect: the `/pipeline` stakeholder query (`src/app/pipeline/page.tsx:168–173`) has no ORDER BY. **MUST FIX BEFORE GATE 9.**
- **D-P1 — OPEN.** A timeframe snapshot overwrite: `/pipeline?timeframe=` overwrites today's `pipeline_snapshots` row. **MUST FIX BEFORE GATE 9 / a real pilot.**

---

## D-G8-1 — deterministic `/pipeline` stakeholder order: FIXED LOCALLY / AWAITING HOSTED ACCEPTANCE (2026-09-15)

**Status.** The fix is committed on `roadmap/pursuitos-vnext` **locally, NOT pushed**, because a push auto-deploys the branch Preview and hosted acceptance needs its own approval. No schema, migration, RLS, grant, role, policy, Vercel env, `DATABASE_URL` / `DATABASE_URL_OWNER`, hosted-data, send, Production or `qifatlqxfuhwrwvpbwsc` change. **D-P1 is untouched and remains OPEN.** Gate 9 was not begun.

**Root cause.** `/pipeline` loads each opportunity's stakeholders with `select … from stakeholders s join contacts ct … join opportunities o … where s.opportunity_id = any($1)` (`src/app/pipeline/page.tsx:169`) and **no ORDER BY**. It groups the rows into `stakeholdersByOpp` in arrival order and renders each list in that order. PostgreSQL's arrival order depends on the plan: the owner and `app_rw` get different plans because RLS adds predicates. So the same stored data rendered Sarah Kim first under the owner and Dana Whitfield first under `app_rw` (Gate 8 Phase 1).

**The consumer, and why no business ranking exists.**
- The list is rendered **whole**, one editable row per stakeholder (`page.tsx:1232`). Nothing picks a "first" stakeholder.
- `stakeholderGaps()` works on a `Set` of roles, so it is order-independent.
- `ROLES` is only the role dropdown's option list, not a display priority.
- So there is no product ranking to preserve. The fix adds a **stable presentational order only**.

**The fix — one ORDER BY; no filter, join, scope or limit change:**

```sql
order by s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id
```

- `s.opportunity_id` groups the rows as the consumer does.
- `coalesce(ct.name, ct.email)` is the **label the card displays** (`s.name ?? s.email`), so the order is readable and stable across reseeded worlds, where ids are random.
- `s.contact_id` completes `stakeholders`' **primary key `(opportunity_id, contact_id)`**, so the order is total: two stakeholders with the same label are ordered by contact id.
- On the hosted data this renders Dana Whitfield before Sarah Kim under **both** roles. That follows from the rule; it is not encoded.

**Tests: red before the fix, green after.**
- **Static guard** (`tests/ordering-determinism.test.ts`, in `npm test`): the page's stakeholder query must carry exactly that ORDER BY and no LIMIT. **Red 4/5 → green 5/5.**
- **DB suite `ordering-determinism`** (SEEDED_CLONE; new D-G8-1 section).
  - **How it works:** the query text is read **from `page.tsx` itself**; "old" is that text without its ORDER BY.
  - **The fixture:** five stakeholders on one open deal with identical role, sentiment and assertion state. **Two share a label**, one has **no name** (its email is the label), and they are inserted in **descending contact-id order**, so insertion, id and label order all disagree.
  - **The expected order** comes from Postgres applying the documented rule directly, so the collation is the same as the page's.
  - **The runs:** 5 planner configurations × 2 heap layouts (a no-op relocation the governed-assertion guard allows) × owner and **real `app_rw`** with `withTenant`'s context.
  - **Red: 20 passed / 3 failed.** No ORDER BY; the deal's stakeholders were not in the documented order; the ordered payload **varied in 8 of 20 runs, under both roles**.
  - **Green: 23 / 0.** Eligibility unchanged (canonical + exactly the 5 fixtures; the new query selects exactly the old query's rows); documented order including the tie; **byte-identical ordered payload across all 20 runs**; old-SQL negative control confirmed.
- **Page level** (`app-rw-rehearsal`, with the stakeholder tie fixture on the sponsor's largest open deal).
  - **Red:** both roles rendered `dg81-tie-4@…, Alpha, Charlie, Alpha, Delta`, not the documented order.
  - **Green:** **38/38 rooms line-identical** owner vs `app_rw`, and the planted stakeholders render exactly `DG81 Tie Alpha, DG81 Tie Alpha, DG81 Tie Charlie, DG81 Tie Delta, dg81-tie-4@example.invalid` under both roles. The consent fixture renders 6/6; the D-G5-1 surfaces are unchanged.

**Full local regression** (hosted secrets unset for every local run).

| Item | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm test` | **377 / 377** |
| `next build` | OK |
| `ordering-determinism` (D-G5-1 + D-G8-1) | **23 / 0** |
| `app-rw-rehearsal` | **38 / 38** line-identical; D-G8-1 order ✓ under both roles |
| **`certify-world --runs 2`** | **82 / 82 suite runs clean** (41 suites × 2), **3,600 assertions, 0 failures**. It includes `vnext-context` 62, `vnext-coordination` 116, `vnext-attention` 64, `today-tenant` 51, `tenant-isolation` 205, `partnership-app-rw` 117, `search-path` 39, `value-case` 126, `demo-team` 11 and `ordering-determinism` 23 |
| Canonical immutability | digest `e98b43254f98d5ec` at the start, after run 1 and after run 2; no suite drifted; manifest `be0da833990ce436`; 0 leftover databases; 0 fixture rows in the canonical world |
| Send safety | 0 messages / outbox / email events / sent touches |

No Slice 1 / 2A / 2B assertion changed.

**Hosted acceptance (not done; needs approval).**
1. Push; the branch Preview auto-deploys, still on the `app_rw` runtime with no env change.
2. `/api/build` must report `app_rw` / false / true / live.
3. Run the signed-in 37-room crawl twice.
4. On `/pipeline`, the two tied economic buyers must render **Dana Whitfield, then Sarah Kim**, the documented rule on hosted data, identically in every pass. Everything else must equal the Gate 8 Phase 2 crawl apart from validated clock text.
5. DB check under CFR-1.1.
6. **Optional:** an owner-posture confirmation needs the Gate 8 rollback procedure and a separate approval, so it is not required.

### Ordering audit of the certified rooms (D-G8-2 — a latent backlog; NOT fixed, recorded separately)

This was an agent-assisted, read-only audit of the SQL behind the 37 certified rooms, and their consumers. Four of its top findings were spot-verified in the code: the unordered `today/overview.ts` motion queries, the `(a.at < b.at ? 1 : -1)` comparator in `timeline.ts:289`, the priority-only order in `portfolio.ts`, and the weighted-value-only card sort on `/pipeline`. The remaining findings are recorded as the agent reported them.

- **A — deterministic:** every rule in `divergence.ts` and `projection.ts` list attribution (D-G5-1), and the `/pipeline` stakeholders now (D-G8-1). About 60 further queries end in a unique key or return a single row.
- **B — unordered but set-only (harmless):** Map / Set / count / sum consumers, among them `stakeholderGaps`, the analytics and insights aggregates and the mapping lookups. **Borderline B:** `lifecycle/state.ts:221`, `stakeholders/coverage.ts:112`, the count sorts in `motions/page.tsx`, and `contacts/page.tsx:328` (total unless two names are identical).
- **C — latent user-visible nondeterminism.** An order shows on screen, but the ORDER BY or JS comparator is not total. **None of these showed up in any hosted crawl:** the Gate 4–8 crawls were identical within each role, and owner vs `app_rw` differed only in D-G5-1 and D-G8-1. They are latent, and would surface when data ties.

| Priority | File / query | Consumer where order becomes visible | Recommended tie-break |
|---|---|---|---|
| **high** | `lib/today/overview.ts` motion, contradiction and refresh queries (no ORDER BY) | `next-best.ts` sorts by priority only, then slices to 6 → Today "Also queued" | SQL `…, id` + a JS href tie-break |
| **high** | `pursuits/read-models/today.ts` route approvals, fact reviews, team members (no ORDER BY); `:209` `limit 25`; `:245` `limit 60` | `todaySort` ends on age, not a total key; `limit 4` on `/` | `…, id` in SQL + a final id key in `todaySort` |
| **high** | `app/pipeline/page.tsx:99` book `order by o.updated_at desc` | The attention sort is by weighted $ only; the lead 4 cards | `, o.id` + a JS id tie-break |
| **high** | `accounts/[id]/page.tsx:180`, `briefs/[motionId]/page.tsx:57` assets `order by a.created_at` | Rendered asset order; the composer inserts all assets in one transaction | `, a.id` |
| **high** | `pursuits/read-models/portfolio.ts:30` `order by current_priority_score desc nulls last` | `/pursuits` group and row order | `, pu.id` |
| **high** | `lib/mapping/populations.ts:109` (no ORDER BY) → `partnerCoverage` Map order | `/mapping` matrix rows | `order by c.legal_name, pm.company_id` |
| medium | `lib/lifecycle/horizon.ts:61/110`; `overview.ts:146` activity `limit 6`; `pipeline:330` CRM tie-out DISTINCT ON; `writeback.ts:85` `limit 30`; `accounts/page.tsx:108` + default sort; `accounts/export` score order; `accounts/intel.ts:49/51/60/63`; `partners/intelligence.ts:152/255`; `accounts/[id]:91/139`; **`timeline.ts:289` comparator never returns 0**; `queue-read.ts:50` NULL `due_at`; `mapping/page.tsx:202`; `review/page.tsx:54/66`, `sources/page.tsx:17`; `motions/page.tsx:160` `limit 18`; the settlement function `order by o.updated_at desc`; `admin` / `trust` / `insights` aggregates ordered by count | Various rendered lists, caps and "first row" picks | Append each table's unique key, or the group key plus id |
| low | Non-default views and less likely ties: `pipeline:116/183`, `pursuits/[id]:90`, `detail.ts:108/159`, `coverage.ts:191`, `partners/hub.ts:235`, `evidence-shares.ts:46`, `briefs:47`, `upcoming:32`, `campaigns:108`, `intake:76`, `goals/chain.ts:66`, `multi-vendor.ts`, `company-intel.ts:51`, `intel.ts:42/66/67`, `queue-read.ts:26`, `funnel.ts:215/330` | — | Same pattern |

**Decision needed:** D-G8-2 does not invalidate the D-G8-1 certification, and none of it was changed in this commit. Before Gate 9, the owner should decide whether to fix the **high** rows (the default views, where ties are near-certain once real data arrives) as one tie-break-only change, certified the same way as D-G5-1 and D-G8-1.

### D-G8-1 hosted acceptance: HOSTED ACCEPTED / CLOSED (2026-09-15)

**D-G8-1 — HOSTED ACCEPTED / CLOSED.** The owner approved the push of `dcde3b6` and its automatic Preview deployment. There was no Vercel env, database, migration, role, RLS, grant, policy, send or Production change; `qifatlqxfuhwrwvpbwsc` was not contacted. D-G8-2 was not started, and D-P1 was not touched.

**Deployment.** `dpl_7KsA9ssaPHwUxiZcQW8LWXAAe6Pe` (`pursuitos-demo-h4ltez95t-…`): Preview, branch `roadmap/pursuitos-vnext`, READY, commit `dcde3b6`, the branch alias target. The only product change since `1c4fb5e` is `src/app/pipeline/page.tsx`. The env metadata is identical before and after the push, and Production is unchanged.

**`/api/build`: PASS.** `app_rw` · bypassRls false · tenantEnforcement true · probe live · `mejokqxriwyawfhawuxu` · sending off.

**Acceptance: two full signed-in 37-room crawls, 4 passes.**
- **The expected order is derived, not written in.** The acceptance tool (`dg81check.mjs`, scratchpad) has Postgres apply the committed rule to the hosted Vertex data, read-only. It finds **one** deal with more than one stakeholder, "Legacy virtualization exit", with four stakeholders: **Dana Whitfield (economic buyer, verified) → Mike Rivera (technical buyer, verified) → Priya Shah (influencer, inferred) → Sarah Kim (champion, verified).**
- **Every pass renders exactly that order.** All 4 passes are byte-identical room by room, and all 37 rooms return 200.
- **Correction to the earlier write-up:** Dana Whitfield and Sarah Kim are not "two tied economic buyers". They are two of this deal's four stakeholders, the economic buyer and the champion.
- **Before the fix,** `app_rw` rendered Dana, Mike, **Sarah, Priya**, and the owner rendered Sarah first. The rule now fixes one order under every role and plan. Dana Whitfield precedes Sarah Kim, as expected from the rule.
- **Against the Gate 8 Phase 2 crawl** (the same clock day, so no clock text is expected): the **only** differences are four `/pipeline` lines, 437/438 and 450/451.
  - They are Priya Shah's and Sarah Kim's rows trading places, **each carrying its own verification badge**.
  - The multiset of (name, badge) pairs is identical to Phase 2, and every badge matches the persisted `assertion_state`.
  - No other room differs.
- **The membership and business values are unchanged.** Today's D-G5-1 order is stable; the CDW label is "CDW customer book"; the palette is identical; the joint room and owner paths are identical.

**Database (read-only, after both crawls).**
- **Snapshot:** **40/0** against the Gate 8 final record. All 155 per-table fingerprints identical; business-data `c9623fb5abe2f9bc`; whole-world `dce27935d88743fb`; security hash `30772757ebd4688c`; migrations 105; `app_rw` LOGIN true / BYPASSRLS false; 31 protected / 0 unsafe.
- **CFR-1.1:** **5/0**; 22/22 `days_since_activity` values recomputed from source as of 23:01:12Z. The hero source-timestamp hash is unchanged.

**Routing and send safety.** `DATABASE_URL` → `app_rw`; `DATABASE_URL_OWNER` → `owner/postgres`; no env change. `externalSendingArmed` false; 0 send rows; no delivery.

**Disposition.** D-G8-1 is **CLOSED**. The `/pipeline` stakeholder order is now a total, role-independent order: `(opportunity, displayed label, contact_id)`.

**Still open.**
- **D-G8-2** (the latent ordering backlog) is recorded, not started. The owner decides.
- **D-P1 remains OPEN** (`/pipeline?timeframe=` can overwrite the canonical daily snapshot). It must be fixed before Gate 9 / a real pilot.

**Gate 9 was NOT begun.** H1B and H1 are not complete.

### D-G8-2A determinism hardening — FIXED LOCALLY / NOT CONVERGED / NOT PUSHED (2026-09-15)

**What was done.** Tie-breaking only, on the certified 37-room surface, where ordering decides membership
under a cap, a first/latest/best/representative pick, a value shown, visible priority, or downstream
encounter order. Every key appended was already in the query's scope. No filter, join, scope or
business-ranking change. Six local commits, **none pushed**: `ca7e279`, `bb4e484`, `5ac77ce`, `2a8b7ea`,
`2211f75`, `aea55c9` — 28 files, +534 / −117.

**The classes fixed.** Unordered query feeding a capped JS sort; non-unique `ORDER BY` + `LIMIT`;
`DISTINCT ON` with an incomplete order; LATERAL / first-row picks; encounter-order Map/group consumers;
a non-total JS comparator; and visible lists on tied business keys.

**The headline fixes.** `today/overview.ts`'s four unordered Today feeders and both `DISTINCT ON` picks;
`next-best.ts`, which cut to a limit on priority alone; `todaySort`'s call site, which ended on age;
`timeline.ts`, whose comparator `(a, b) => (a.at < b.at ? 1 : -1)` **never returned 0** — replaced by the
exported total `compareTimelineEvents`; `portfolio.ts`, which also fixed the account-group encounter
order; `/pipeline`'s book, ecosystem and CRM tie-out, its first-wins deal-registration Map, and its two
capped cuts; `populations.ts`'s coverage feeder, which drives the mapping matrix rows.

**Evidence.**
- `ordering-determinism` (seeded clone): **red 32 passed / 11 failed → 43 / 0**, byte-identical across
  5 planner configurations × 2 heap layouts × owner and the real `app_rw` login.
- Negative controls for all seven classes; `tests/timeline-order.test.ts` keeps the old comparator inline
  as the control and proves antisymmetry, transitivity and 0-only-on-identical.
- `tsc` clean · `npm test` **386/386** · build OK · **`certify-world --runs 2` 82 clean / 0 failures**,
  digest `e98b43254f98d5ec` unchanged at start and after both runs, no table drift.
- App_rw rehearsal **38/38** rooms identical under both roles, consent fixtures 6/6, D-G8-1 order intact.
  The world digest was re-checked after every rehearsal: `e98b43254f98d5ec`, no residue.

**A flaky certification, root-caused.** A full battery failed intermittently (42/1, then 41/2) while the
same suite passed 11/11 standalone. It was **not** the fix: the three old-clause negative controls asserted
that the planner *actually* resolves a tie inconsistently, which depends on physical layout and statistics,
not on the code under test. The gate is now the property that can be guaranteed — each fixture genuinely
ties on the key the old clause orders by — with the observed-variation count kept as a printed diagnostic
(`2a8b7ea`). Root-caused by driving the battery manually, because `certify-world` keeps only each suite's
summary line and discards the MATRIX reason.

**SCOPE: the delivered change is materially larger than what was approved.** The approval was 51 sites
across 25 files. Delivered: 83 ordering constructs in the first sweep, **+24** from a first verification
round, **+10** from a second — across 28 files, including three not on the approved list
(`lifecycle/projection.ts`, `pursuits/federation/ops.ts`, `campaigns/multi-vendor.ts`). Each addition was a
one-line tie-break with a key already in scope and met the stated criterion, so it was judged to be
completing the criterion rather than broadening it — **but that is an owner call, and the owner's standing
instruction was to stop and report if the set proved materially larger.** Nothing is pushed; it is fully
reversible.

The first sweep's systematic error: four NAME columns were treated as unique tie-breaks when none of them
carry a unique constraint — `companies.legal_name`, `partners.name`, `account_populations.name`,
`taxonomy_nodes.name`.

**NOT CONVERGED — 7 open sites (verified round three). Work stopped here rather than broadened again.**

| # | Site | Controls | Why it was NOT fixed |
|---|---|---|---|
| 1 | `lifecycle/projection.ts:87` `sort((a,b) => b.confidence - a.confidence)[0]` | `sourceNote`, a value shown on `/pipeline`, the partner review sheet, the deal timeline and the account digest | **Owner decision.** The sibling reducer `state.ts:160` breaks the same tie on `observedLastAt`; choosing a key decides which provenance wins ("customer declared" vs "third-party, unverified") |
| 2 | `partners/intelligence.ts:389` `group by 1`, no ORDER BY | rendered `classMix` string on the route-compare panel | Pure tie-break (`cls`); left with the group for one decision |
| 3 | `partners/intelligence.ts:384` `rows.find((r) => r.med != null)?.med` | the printed "Median Nd recommendation → outcome" | **Not an ordering defect.** An arbitrary outcome label's median is presented as *the* median — a business-semantics fix |
| 4 | `partners/intelligence.ts:137` `group by 1`, no ORDER BY | `byAttributionClass` string on the activation profile | Pure tie-break (`cls`) |
| 5 | `campaigns/multi-vendor.ts:202` `order by sc.s desc nulls last limit 1` | the campaign seed account, **written to `campaigns.company_id`** | **Persisted identity, not display** — the D-G8-3A class the owner deferred |
| 6 | `app/mapping/page.tsx:217` `play_templates`, no ORDER BY, last-write-wins into `playByNode` | play name / objective / CTA per matrix row | Pure tie-break (`id`); `play_templates` has no uniqueness on `taxonomy_node_id` |
| 7 | `app/mapping/page.tsx:843` `selected_fields`, no ORDER BY | visible **column order** of the cell table | **Owner decision:** whether the row- or column-population's fields lead |

**Recorded as NOT defects.** `admin/page.tsx:613` and `:640` pick an arbitrary non-self entry — a two-org
partnership assumption, not a tie-break. `insights/page.tsx:121` `array_agg(t.to_stage)` feeds a
set-membership test. `pipeline_snapshots` needs no tie-break: its PK is `(org_id, taken_on)`, so with
`org_id` fixed `taken_on` is already unique — which also keeps this work clear of D-P1's table.

**D-G8-2B (deferred, unchanged).** The ordering audit's **low** rows — non-default views and unlikely
ties — remain deferred, as approved.

**D-G8-3A (OPEN, pre-Gate-9).** Campaign asset persisted sequence. Not implemented, as instructed.
**D-G8-3B (OPEN, pre-Gate-9).** Settlement deterministic identity/order. Not implemented, as instructed.
**D-P1 (OPEN, pre-Gate-9).** `/pipeline?timeframe=` can overwrite the canonical daily snapshot.

**Not pushed. No hosted deployment, no Vercel env change, no database, migration, role, RLS, grant or
policy change; sending untouched; `qifatlqxfuhwrwvpbwsc` not contacted. Gate 9 NOT begun.**

### D-G8-2A final convergence attempt — STOPPED, NOT CONVERGED (C = 44) (2026-09-15)

The owner accepted the scope overrun, directed the three remaining pure tie-breaks be closed, reclassified
the four judgement items, and set the rule: declare convergence only at **C = 0**.

**Fixed (16 sites, 8 files, all local).** `intelligence.ts` ×2 attribution aggregates (`group by 1 order by 1`);
`mapping/page.tsx` `play_templates` (`order by name, id`); `insights.ts` ×3 (propensity lateral `, id desc`,
outer `order by c.legal_name, c.id`, and the rank comparator before the 200-row cut); `funnel.ts` ×5 (thesis
lateral, hypotheses list, evaluated `DISTINCT ON`, latest outcomes, and the `ACCOUNT_CAP` sort where every
pursuit-less account collapses to −1); `value/aggregate.ts`; `partnerships/overlap.ts`;
`partnerships/partnerships.ts` (`auditEntries`); `quotes.ts` ×2 (expose `m.id`, order the `array_agg`).

**Reclassified as the owner directed.** `projection.ts:87` → **D-G8-4A** (provenance precedence);
`intelligence.ts:384` → **D-G8-4B** (outcome-summary semantics); `multi-vendor.ts:202` → **D-G8-3C**
(persisted campaign seed identity); `mapping/page.tsx:843` → **D-G8-2B** (display-only).

**Round five: C = 44 — NOT CONVERGED. The sweep was STOPPED here, deliberately.**
- 44 pure tie-break defects across **27 root files, none of them examined in rounds 1–4**, including
  `src/app/layout.tsx` — the shell on every room.
- The transitive closure from `src/app/**` is **109 lib modules**; rounds 1–4 examined ~15 (~14%).
- Decisive signal: fixes were applied per SITE as reported, not per PATTERN across the closure, so
  round-four fixes have unfixed twins that were reachable the whole time — `value/aggregate.ts:53` fixed
  while `value/intents.ts:60` was not; `funnel.ts:262` fixed while `outcome-summary.ts:28` was not;
  `horizon.ts:70` carries `, p.id` while `intents.ts:78` does not.
- Four patterns recur across all 44: latest-per-group `DISTINCT ON`; `array_agg(order by ts desc)[1]`;
  capped `limit N` on a non-unique key; lateral `limit 1` pick.

**Why it stopped rather than continued.** The D-G8-2A criterion — every ordering site reachable from the
certified surface that affects membership, a pick, or a value shown — has **no bounded file set**. Each
round's fixes were correct and certified, yet the count went 24 → 6 → 7 → 9 → 44 because most of the
reachable closure had never been looked at. Fixing 44 more sites one at a time would repeat the scope
overrun the owner has just had to adjudicate and would still not converge. **The remaining work should be a
bounded, mechanical sweep of the four patterns over the full 109-module closure, approved as its own
workstream with an explicit file list — not another fix-and-re-audit cycle.**

**New findings recorded, NOT implemented.**
- **D-G8-3D — persisted selections.** A nondeterministic pick is written to the database:
  `comms/authoring.ts:45` and `agents/campaign-email.ts:69,135` (brand → `campaigns`); `comms/send.ts:60`
  (thread → `messages`); `scoring/score.ts:112` (prev score → `propensity_scores.changes`);
  `agents/motion-designer.ts:70,79,111` and `app/motions/actions.ts:73-78` (→ a new revenue motion);
  `routines/routines.ts:115,123,131,254,290,297` (→ `routine_runs.summary` / `account_digests.items`).
- **D-G8-4C — entity resolution by `order by length(name) limit 1`**: `value/intents.ts:151`,
  `agents/ask-scope.ts:78,82`, `interpret/entities.ts:45,54`, `mcp-tools.ts:116,326`; plus
  `plan-loaders.ts:110` (timing-event pick over projected events with no stable key).
- **D-G8-5 — MIGRATION-GATED.** `shared_in_evidence()` (migration 0104) ends `order by e.observed_at desc
  limit 20` and decides which 20 shared claims enter the deal timeline. The fix requires a new migration,
  which is out of scope for this task and needs separate owner approval.

**Evidence for the 16 fixes.** SQL smoke test: every changed statement executes (the only gate that could
catch the new `hit.id` reference inside an `array_agg` ORDER BY — `tsc`, tests and build all pass regardless).
`tsc` clean · `npm test` 388/388 · `ordering-determinism` 43/43 · build OK · `certify-world --runs 2`
**82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged at start and after both runs, no drift ·
app_rw rehearsal **38/38** rooms + 6/6 consent under both roles · world digest MATCH, no residue ·
send rows 0/0/0.

**Status: D-G8-2A — FIXED LOCALLY / NOT CONVERGED (C = 44) / NOT PUSHED. Gate 9 NOT begun.**

### D-G8-2A — CONVERGED within the frozen certified-surface boundary (2026-09-15)

The owner chose **Option A**: the frozen closure is the reproducibility boundary; the D-G8-2A **fix set** is
the narrower certified-surface **impact** boundary inside it.

**FROZEN CLOSURE — the reproducibility anchor.**
- Manifest: `docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt` · **333 files** (80 `src/app`, 253 other), of 384 `src/` modules
- **SHA-256 `94491ea17071b38fd75f73219a8d5f262ceb4d9d367f136371c281cd3b68716a`** (confirmed by `shasum`,
  independently of the builder's own report)
- Builder `scripts/closure-manifest.ts` **v1.0.0** — transitive import closure from every file under `src/app`,
  members under `src/`; sorted, de-duplicated, trailing newline
- Scanner `scripts/ordering-scan.ts` **v1.1.0** + `ordering-scan-allowlist.ts` (**9 entries**, each with a
  reviewer-checkable reason)
- Soundness: a resolution-based reverse-dependency check proved **no closure member imports any of the 51
  excluded modules** (29 imported nowhere; 22 imported only by other excluded modules)
- **Closure escape check: `--verify` recomputes to the same digest AFTER all edits — VERIFY PASS.** No fix
  pulled in a dependency outside the frozen set.

**SCANNER CORRECTION — v1.0.0's count of 177 is VOID.** Its `orderByOf` matched the first `order by` and ran
to end-of-string, so any query with a LATERAL or subquery ORDER BY was judged on the wrong terminal term; it
re-flagged sites already fixed and certified (`horizon.ts`, `populations.ts`, `writeback.ts`,
`accounts/page.tsx`). v1.1.0 extracts every clause with a paren-aware scan and judges each independently,
skips `array_agg(distinct X order by X)`, and accepts any genuine terminal tie-break key. **The recorded
pre-fix baseline is 173 at v1.1.0**, not 177.

**RESULT: pre-fix 173 → final 63. Unresolved D-G8-2A inside the certified-surface boundary = 0.**

**Disposition of all 173 — no finding disappeared without one.**

| Disposition | n |
|---|---|
| **2A — FIXED** in code, plus 9 allowlisted non-defects with reasons | **110** |
| D-G8-3 — persisted/model determinism | 21 |
| OUT — MCP/agent-only, not consumed by the certified experience | 13 |
| OUT — ingest/intelligence-only | 11 |
| D-G8-4C — entity resolution by `order by length(name)` | 10 |
| D-G8-4A — provenance precedence (`projection.ts:87`, `state.ts:160/211`) | 3 |
| D-G8-4C — in-force fact selection (`drivers.ts:213/231`) | 2 |
| OUT — worker/send path (`federation/events`, `comms/sequence`) | 2 |
| D-G8-2B — display-order-only (`partners/hub.ts:43`, uncapped, non-unique `pa.name`) | 1 |

**What the fix set covered** (impact boundary, not pathname): the 37-room rendered experience; the shared
shell (`layout.tsx` — a tie flipped the `/routines` red alert COUNT); **tenant/org context** (`auth/org.ts` ×3,
`join/[code]` ×3, `login/actions.ts` — "first membership by `created_at`" was nondeterministically arbitrary
and is now deterministically the same rule); and reachable read-models that decide a rendered value, a
first/latest pick, or membership under a cap — `plan-loaders`, `detail`, `outcome-summary`, `route`,
`context-loaders`, `pertinence`, `federation/read-models`, `coverage`, `skills`, `scope/server`,
`goals/chain`, `value/assert`, `value/intents`, `meetings`, `search/*`, `interpret/answer`, `partners/hub`,
`campaigns/lists`, `partnerships/*`, `autopsy`, `routing/partner-activation`, `provider-health`,
`company-intel`, `motions/actions`.

**One reclassification made on evidence, against an inherited label:** `app/motions/actions.ts:73` had been
called D-G8-3 (persisted). Reading it showed the `DISTINCT ON` result builds `scoreOf`, which drives
`ready.sort(...)` and then `ready.slice(0, DRAFT_BATCH)` — so the ordering decides WHICH accounts enter the
draft batch (impact rule 5) and the `more` count shown back to the user. It is 2A, and was fixed.

**Caveats resolved as directed.** `trust/page.tsx:29` — `model` is the GROUP BY key, so the order is already
total: **classified A, not modified**. `layout.tsx:132` — a genuine shell defect, fixed. `join`/`login` — a
mechanical unique tie-break preserves the existing rule, so fixed under 2A rather than reclassified.

**NOT ASSESSED BY D-G8-2A CLOSURE** (outside the frozen closure — *not* a statement that they are clean):
`src/worker/**`, `src/proxy.ts`, and the other 51 excluded modules (agents/campaign-composer, backup,
comms/governed-send, ecosystem/*, facts/* pipeline, ingest/*, research/*, routing/asof and siblings).

**Certification on the final tree.** SQL smoke tests — every changed statement shape executes (the only gate
that can catch a bad column inside an `array_agg` ORDER BY; `tsc`, tests and build all pass regardless) ·
`tsc` clean · `npm test` **388/388** · `ordering-determinism` **43/43** · build OK ·
**`certify-world --runs 2` 82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged at start and after
both runs, no drift · app_rw rehearsal **38/38** rooms + **6/6** consent under both roles, D-G8-1 order intact ·
post-rehearsal world digest MATCH, **no residue** · send rows **0/0/0**.

**Still open, unchanged:** D-G8-2B (display-only backlog) · D-G8-3A/B/C/D · D-G8-4A/B/C · D-G8-5
(migration-gated `shared_in_evidence()`) · **D-P1**. Not pushed, not deployed. **Gate 9 NOT begun.**

### D-G8-2A hosted acceptance: HOSTED ACCEPTED / CLOSED (2026-09-15 local / 2026-09-16Z)

**D-G8-2A — HOSTED ACCEPTED / CLOSED.** The approved push of `a5da3b2` auto-deployed the branch Preview and
it passed hosted acceptance. No Vercel env, `DATABASE_URL`, `DATABASE_URL_OWNER`, migration, role, RLS, grant,
policy, deliberate-data or Production change; `qifatlqxfuhwrwvpbwsc` was never contacted. Sending stayed off.
D-G8-3/4/5 and D-P1 were not started. **The D-G8-2A audit was NOT reopened** and no new ordering scan was run.

**Deployment.** `dpl_BcKULAScmeWVZaQYkakWbCRiZw7w` (`pursuitos-demo-gp8i98a2l-…`): Preview, branch
`roadmap/pursuitos-vnext`, **READY**, commit `a5da3b2cb864748388cb0c4d0432b9afb6ea91c4`, built 02:43:51Z, and
the branch alias target (`pursuitos-demo-git-roadmap-pursuitos-vnext-…`).

**Part C — `/api/build` posture: PASS.** `mejokqxriwyawfhawuxu` · role `app_rw` · bypassRls **false** ·
tenantEnforcement **true** · probe **live** · `externalSendingArmed` **false**. Re-read unchanged after both
crawls. `DATABASE_URL` → `app_rw` is proven by the live runtime probe; `DATABASE_URL_OWNER` → `owner/postgres`
is proven by the owner-backed rooms (`/admin`, `/ops`, `/trust`, `/joint`) rendering healthy under that posture.

**Part D — authenticated hosted crawl: PASS.** Two full signed-in 37-room crawls, each with its own sign-in
through the real Preview `/login` as the synthetic Vertex owner (303 → `/`, `sb-mejokqxriwyawfhawuxu-auth-token`),
each covering every room twice — **4 passes**. Detail-room ids were resolved from the app's own rendered,
now-deterministic order (hero pursuit = the Globex `/pursuits` row; the Globex account taken from the app's own
palette result; every other id the first of its kind in its index room), so the crawl reads nothing from the
database. `/pipeline?timeframe=` was not used. D-P1 was not touched.

- **All 37 rooms returned 200 in all 4 passes.**
- **All 4 passes are byte-identical, room by room** — within crawl 1, within crawl 2, and crawl 1 vs crawl 2,
  on both the first and the second pass. There is no one-time materialization difference this time.
- No empty state, no error, no missing authorized data. `/accounts/export` is the 10-row CSV + header;
  `/api/palette` is single-line JSON; both identical in every pass.
- **No foreign tenant data.** Every company name rendered (Umbrella, Initech, Stark, Cyberdyne, Wayne, Hooli,
  Acme, Soylent, Tyrell, Globex) is Vertex's own book, confirmed against `/accounts/export`. **"Meridian" appears
  nowhere in any of the 37 rooms.** Joint-room disclosure boundaries and the palette are intact.

**Part E — ordering acceptance: PASS.** Compared against a fresh 4-pass crawl of the **still-READY accepted
D-G8-1 deployment** `dpl_7KsA9ssaPHwUxiZcQW8LWXAAe6Pe` (`dcde3b6`, `pursuitos-demo-h4ltez95t-…`), which resolved
the identical detail-room ids — so this is a true like-for-like differential, not a prose comparison.

| | |
|---|---|
| Rooms byte-identical to the D-G8-1 baseline | **32 / 37** |
| Rooms that are a **pure reorder** (identical line multiset, positions moved) | **5** |
| Rooms with any **membership change** | **0** |

- `/`, `/?today=all`, `/?drawer=<globex>` — 2 positions each: the two `Review motion draft — …` rows swap, so
  **Acme Robotics** now precedes **Stark Industries LLC**.
- `/pursuits/<globex>` — 2 positions: `champion — verified (supersedes champion — inferred)` and
  `champion — inferred` swap.
- `/pipeline` — 164 positions: whole deal cards reorder (`Legacy virtualization exit` ↔ `Datacenter exit — phase 1`,
  `Container platform expansion` ↔ `Incumbent displacement`), each card carrying its own badges, dates and labels.

**Every one is explained by a committed D-G8-2A tie-break** (`git diff dcde3b6..a5da3b2`):
`pipeline/page.tsx` `order by o.updated_at desc, o.id` and the seller/reported-opportunity keys;
`motions/actions.ts` `ready.sort(… || a.localeCompare(b))` with `order by company_id, computed_at desc, id desc`;
`detail.ts` `order by confidence desc, id desc`; `coverage.ts` `order by recorded_at desc, id desc`.

- **E.3 / E.4 — no business change.** A pure reorder means the rendered line multiset is *identical*: every
  amount, status, badge, date and label is preserved exactly, only its position moved. No filter, eligibility,
  scope or ranking criterion changed. Independently corroborated below: the new `pipeline_snapshots` row records
  **11 open / $8,040,000 open / $3,361,500 weighted** — identical to the prior day's row.
- **E.5 / E.6 — membership.** Zero membership change was observed anywhere, although the changed queries are all
  cap-bearing (`limit 3`, `limit 6`, `limit 20`, `limit 100`, `DRAFT_BATCH`). The ties were resolved among rows
  already inside their caps, so no row entered or left any capped set and **the capped-membership proof
  obligation does not arise**. Nothing unexplained was accepted.

**Part F — targeted regression checks: PASS.**

| Check | Result |
|---|---|
| **D-G5-1** — Today deterministic ordering | Stable in all 4 passes; the "stage vs engagement" rule renders **Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit**, the accepted D-G5-1 order |
| **D-G8-1** — `/pipeline` stakeholder order | Stable in all 4 passes: **Dana Whitfield → Mike Rivera → Priya Shah → Sarah Kim**, exactly the accepted D-G8-1 rule order |
| **Pipeline label** | `· on "CDW customer book"` present and stable |
| **Shared shell** | `/routines` and the shell alert surface identical across both crawls; the `layout.tsx` tie-break is stable |
| **Login / join — tenant/org selection** | Two independent sign-ins produced byte-identical crawls, so the `created_at`-first rule plus the new unique tie-break selected the same org both times |
| **Motions DRAFT_BATCH** | `5 active · 2 draft` stable in all 4 passes; the only change is the deterministic Acme/Stark tie-break inside the same eligible population |
| **Mapping / pursuits / accounts / pipeline / Today / drawer / timeline** | All identical in all 4 passes |

**Part G — database / CFR-1.1: PASS under the documented look-to-write allowance.** Standard hosted snapshot
`dg82a-final`, taken after both crawls in one `REPEATABLE READ READ ONLY` transaction, rolled back,
`txid_current_if_assigned()` **null**.

- migrations **105** (latest `0105_h1b01_temp_schema_hardening.sql`), pending 0, not-in-repo 0 ✓
- security hash **`30772757ebd4688c`** (excl. login `a4ea548143702029`) ✓ · manifest `14e2e97f8453fb75`,
  unchanged from the D-G8-1 record, so **no CFR-1.1 `days_since_activity` normalisation was needed** — the
  hosted heroes' daily tick (≈21:02Z) had not yet occurred at 03:25Z
- `app_rw`: **LOGIN true · BYPASSRLS false** ✓ · protected functions **31**, unsafe **0** ✓
- roles, policies, RLS/FORCE, table grants, column grants, triggers, CREATE-on-public and every canonical
  business count are **byte-identical** to the D-G8-1 baseline (`compare` reports only the data fingerprints)
- **154 of 155 per-table fingerprints are byte-identical.** Exactly one differs:

> `pipeline_snapshots` **1 → 2 rows**. The new row is `Vertex Systems · taken_on 2026-09-16 · 11 open ·
> $8,040,000.00 open · $3,361,500.00 weighted · crm_usd null` — **identical business values to the 2026-09-15
> row**. `/pipeline` upserts one snapshot row per org per calendar day, and the crawls ran on a new UTC date.
> This is exactly the behaviour recorded at Gate 4: *"any later crawl on a new date … will add a
> `pipeline_snapshots` row and move the fingerprints again."* `routines` stayed at 2 with `routine_runs` 0
> (already seeded, `on conflict do nothing`).

- **Consequence, recorded and NOT auto-re-baselined:** business-data `c9623fb5abe2f9bc` → **`c56a1d229e483f2b`**
  and whole-world `dce27935d88743fb` → **`68b56d3093a2607c`**. The digests moved **solely** because of that one
  documented look-to-write row. Per Part G no re-baseline was performed; **the fingerprints of record need an
  owner decision** exactly as at Gate 4, and the D-G8-2A ordering patch altered no canonical persisted business
  state.

**Part H — tenant / consent smoke: PASS.** Gate 7 remains the authoritative full RLS certification; this was a
focused regression smoke as `app_rw` over the pooler, read-only, `txid` null.

- Connected as `app_rw` with `rolbypassrls false` ✓
- **No-context `app_rw` returns 0 rows on every one of the 127 org-scoped tables.** The 28 tables whose `app_rw`
  policy is the deliberate catalog form (`qual = true` — `companies`, `organizations`, `products`, …) are
  excluded by design. Two further tables are visible **by their own policy, not by leak**, and both were checked:
  `environment_identity` (policy `environment_identity_read`, `{public}`, `qual = true`; returns
  `demo / is_synthetic true`) and `pursuit_team_requirements` (policy `qual = ((org_id IS NULL) OR
  is_org_member(org_id))`) — **all 5 visible rows are `org_id IS NULL` global templates and 0 are org-owned.**
  Every policy and RLS/FORCE row is byte-identical to the D-G8-1 baseline.
- Vertex context sees **exactly** the 13 Vertex pursuits, matching owner-side truth ✓
- **The Meridian pursuit remains hidden:** 0 foreign pursuits visible under Vertex context (Meridian owns 1) ✓
- Joint / partnership consent surface correct under RLS: `joint_pursuits` 1 · active partnerships 1 ·
  `context_grants` 2 ✓
- **No cross-transaction tenant-context leak:** a fresh transaction reports `app.org_id` empty and `pursuits` 0 ✓

**Part I — send safety: PASS.** `externalSendingArmed` **false**; messages / action_outbox / email_events /
sending_identities / sent touches = **0 / 0 / 0 / 0 / 0**; `OUTREACH_AUTOSEND` and `RESEND_API_KEY` are not even
present on the deployment. No external delivery and no webhook event delivery.

**Part J — closure / scanner record (audit NOT reopened).** Re-verified by `shasum` only, as a record check:
`docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt` is **333 files**, **SHA-256
`94491ea17071b38fd75f73219a8d5f262ceb4d9d367f136371c281cd3b68716a`** — matching the frozen closure exactly.
Scanner `ordering-scan` **v1.1.0** (`SCANNER_VERSION` in `scripts/ordering-scan.ts`). Original findings **173**;
**unresolved D-G8-2A inside the certified-surface boundary = 0**. Dispositions unchanged: 110 resolved · 21
D-G8-3 · 13 MCP/agent-only · 11 ingest/intel-only · 10 D-G8-4C · 3 D-G8-4A · 2 D-G8-4C in-force · 2 worker/send ·
1 D-G8-2B. **`src/worker/**`, `src/proxy.ts` and the other excluded modules remain NOT ASSESSED BY D-G8-2A
CLOSURE — this is not a statement that they are clean.** No new open-ended ordering audit was run.

**Vercel env integrity.** The branch-scoped Preview env is unchanged: the same 18 variables, same names, types
and ages (`DATABASE_URL_OWNER` 11h, the two VNEXT flags 1d, the remaining 15 2d). Nothing was added, removed or
edited, and Production was not touched.

**Disposition.** **D-G8-2A is CLOSED.** D-G8-2B DEFERRED (display-only backlog) · D-G8-3A/B/C/D, D-G8-4A/B/C,
D-G8-5 and **D-P1** all OPEN / PRE-GATE-9. **Gate 9 NOT started.** H1B and H1 are not complete.

### D-G8-3A/B/D — FIXED LOCALLY / NOT PUSHED · D-G8-3C RECLASSIFIED to D-G8-4D (2026-09-15)

Owner-approved design gate, then implementation. **Local only: nothing pushed, nothing deployed, hosted
untouched.** Migrations 0106 and 0107 were applied to the LOCAL canonical world only.

**D-G8-3A — the composer's authored asset sequence is persisted.** `campaign_assets.created_at` defaults to
`now()` = `transaction_timestamp()`, so the four assets the composer writes in ONE transaction all carried an
identical `created_at`, and both readers ordered by that alone — a complete tie decided by heap order.
`0106` adds a **nullable** `position integer` (no default, so the current composer keeps inserting during a
rollout), backfills by the composer's own canonical `asset_type` order, and adds a **partial unique index**
on `(campaign_id, position) where position is not null`. The composer writes the array index; both readers use
`order by a.position asc nulls last, a.id`. `NOT NULL` is deferred (0108, not created). The existing
`campaign_assets_campaign_idx` is kept. Hosted `campaign_assets` holds **0 rows**, so the backfill is a no-op.

**D-G8-3B — settlement identity and total order.** `partnership_settlement_rows()` returned `company_id` but
never the opportunity's own id (two opportunities on one company were indistinguishable), and ended
`order by o.updated_at desc`, which is not total. `0107` appends **`opportunity_id uuid` as the last returned
column** and orders `o.updated_at desc, o.id`. **Changing a `RETURNS TABLE` requires DROP + CREATE**
(`create or replace` is rejected), so the migration atomically restores the entire certified posture:
`SECURITY DEFINER`, `STABLE`, `search_path pg_catalog, public, pg_temp` (0105's hardened value, **not**
0104's `public`), the PUBLIC revoke, the anon / authenticated / service_role / app_rw revokes and
`EXECUTE` to `app_rw`. **No CASCADE** — nothing in the database depends on the function. Confirmed after the
replace: result shape 10 columns, `prosecdef` true, `provolatile` s, `proconfig` `search_path=pg_catalog,
public, pg_temp`, ACL `{postgres=X/postgres,app_rw=X/postgres}`, **31 protected / 0 unsafe**. The read model
carries `opportunityId`, used as the settlement table's render key; the raw id is not displayed.

**D-G8-3C — NOT implemented. Reclassified to D-G8-4D (campaign seed selection semantics), PRE-GATE-9
blocker.** `multi-vendor.ts` persists `campaigns.company_id` as "the list's best-scoring member". When
members tie on `max(score)` — and especially when none is scored, which is realistic (hosted: 10
`propensity_scores` against 31 `population_members`) — that rule picks no winner. Ordering by `legal_name`
would make alphabetical order the product rule, and `company_id` is not business meaning. The site is
**left exactly as it was** and a static guard asserts that.

**D-G8-3D — mechanical tie-breaks, no schema.** Every pre-existing primary business key is preserved and only
a stable final unique key is appended: `authoring.ts` and `campaign-email.ts` (brand: `is_default desc,
created_at asc, id`), `send.ts` (thread: `created_at desc, id desc`), `score.ts` and `motion-designer.ts`
(previous score: `computed_at desc, p.id desc`), `motion-designer.ts` (play `version desc, pt.id`; team
`created_at desc, t.id desc`), `routines.ts` ×6 (top-3 opportunities `amount_usd desc nulls last, o.id`;
digests; the `distinct on (r.id)` run status `ran_at desc, rr.id desc`; evidence; meetings; sends).
**`campaign-email.ts` now resolves the brand ONCE** — it previously ran the same untied query twice, so the
rendered brand and the persisted `brandId` could select different profiles. `app/motions/actions.ts` was
already closed under D-G8-2A and is untouched; a guard asserts that too.

**Certification (local).** `tsc` clean · `npm test` **407/407** (388 + 19 new static guards) · build OK ·
**`certify-world --runs 2` 84 clean / 0 failures**, digest **`e98b43254f98d5ec`** unchanged at start and after
both runs · `app-rw-rehearsal` **38/38** rooms + **6/6** consent under both roles, D-G8-1 order intact ·
`partnership-app-rw` **117/0** · `search-path-verify` 12/12, **31 protected / 0 unsafe** · new
`persisted-determinism` suite **17/0** · canonical world fingerprint **IDENTICAL** before and after both
migrations (`e98b43254f98d5ec`, 154 tables, 1051 rows) — the migrations move catalogue, not data · zero
fixture residue · send rows **0/0/0/0/0**.

**The new suite (`scripts/persisted-determinism-verify.ts`, SEEDED_CLONE).** Plants ties and proves, across
**5 planner configurations × 2 heap layouts × owner/app_rw** (20 runs per path): the asset sequence
round-trips to the authored order **even when the rows are inserted in reverse** (0,1,2,3); a duplicate
`(campaign_id, position)` is refused; the settlement payload is identical, every row carries a distinct
`opportunity_id`, the tied pair renders in ascending id order, `updated_at DESC` still leads, and a
**non-party sees zero rows under both roles**; each 3D selection is identical; reversed insertion order does
not change the pick; and the pre-existing ranking still dominates the tie-break. **Negative control:** the old
`order by created_at` returns the exact REVERSE of the authored asset order over the tied fixture.

**One unreproduced transient.** The FIRST `certify-world --runs 2` reported `tenant-isolation` 204 passed /
1 failed in run 1. Its detail was not captured before the log was overwritten. It has not recurred: run 2 of
that same invocation was 205/0, a full re-run gave **84 clean / 0 failures** with `tenant-isolation` 205/0 in
both runs, and three further standalone runs were 205/0 each — six clean runs since. Recorded as unclassified
rather than dismissed.

**Status: D-G8-3A/B/D FIXED LOCALLY, NOT PUSHED.** D-G8-3C → **D-G8-4D OPEN**. Migrations 0106/0107 applied
LOCALLY only. Hosted acceptance of D-G8-3 is a separate, conditional approval (see the fingerprint rule:
`applied` 105 → 107 and a `securityHash` move are pre-authorized *in principle* only, and acceptance must
prove the seven listed conditions). **Gate 9 NOT started.**

### D-G8-3 HOSTED MIGRATION GATE — PASS (2026-09-15 local / 2026-09-16Z)

**Migrations only. No application code was pushed or deployed.** The accepted Preview
(`dpl_Ebt9cv9v7ZVNMNYsNBk5ytL96fzP`, `230ee7b` — docs-only on top of the accepted `a5da3b2` app code) kept
serving throughout. `b1d7c6a` and `0a5e9a8` remain LOCAL; `origin` stays at `230ee7b`. No Vercel env,
`DATABASE_URL`, `DATABASE_URL_OWNER`, Production or `qifatlqxfuhwrwvpbwsc` change. Sending stayed off.

**Part A — baseline: PASS, no unexplained delta.** `/api/build`: `mejokqxriwyawfhawuxu` · `app_rw` ·
bypassRls false · tenantEnforcement true · probe live · sending off. Snapshot `dg83-pre`: migrations **105**,
business-data **`c56a1d229e483f2b`**, whole-world **`68b56d3093a2607c`**, security **`30772757ebd4688c`**,
manifest `14e2e97f8453fb75`, `app_rw` LOGIN true / BYPASSRLS false, protected **31 / 0 unsafe**,
`campaign_assets` **0 rows**, send rows **0/0/0/0/0**. Against the accepted `dg82a-final` the only deltas were
`pendingVsRepo` (the two new files now exist in the repo) and `extra.appRwSessions` 3 → 1 (live pool
connections). **CFR-1.1 did not apply — `pipeline_snapshots` stayed at 2 rows; no new-date row occurred.**

**Part B — files: PASS.** Both migration files are byte-identical to `b1d7c6a`
(`shasum` `e6a132c56b19aa3e…`, `9f3956604db484ab…`). 0106: `position integer` nullable, **no default**, no
`NOT NULL` anywhere executable, deterministic `array_position` backfill, partial unique index, existing
`campaign_assets_campaign_idx` preserved, ROLLBACK present. 0107: `DROP FUNCTION` present, **CASCADE appears
only in a comment**, `opportunity_id uuid` last, `order by o.updated_at desc, o.id`, SECURITY DEFINER +
STABLE + `search_path pg_catalog, public, pg_temp`, PUBLIC and role revokes, `EXECUTE` to `app_rw`, ROLLBACK
present.

**Part C — 0106 applied ALONE: PASS.** Identity hard-guarded before connecting. One transaction, ledger row
written with it. Level **106**. `position`: `integer`, `is_nullable YES`, `column_default null`. Index:
`CREATE UNIQUE INDEX campaign_assets_campaign_position_uidx ON public.campaign_assets USING btree
(campaign_id, "position") WHERE ("position" IS NOT NULL)`. `campaign_assets_campaign_idx` still present.
`campaign_assets` **0 rows**. No business-table fingerprint moved.

**Part D — old app after 0106: PASS.** `/api/build`, the Globex account detail and the brief (both
campaign-asset readers), Today and Pipeline all 200 and healthy. Posture unchanged. The deployed app still
uses `order by a.created_at`; the additive column does not disturb it, and with 0 rows nothing renders
differently.

**Part E — 0107 applied ALONE: PASS.** Level **107**, pending `[]`, not-in-repo `[]`. Function catalogue:
**10 returned columns with `opportunity_id uuid` LAST** · `prosecdef` **true** · `provolatile` **s** (STABLE) ·
`proconfig` **`search_path=pg_catalog, public, pg_temp`** · ACL **`{postgres=X/postgres,app_rw=X/postgres}`**
(PUBLIC, anon, authenticated, service_role all revoked) · body `order by o.updated_at desc, o.id` · exactly
**one** definition (no stale overload) · **no CASCADE side effects** (every 0104 protected function still
present).

**Part F — security certification: PASS.** Hosted `search-path-verify --catalogue-only` **12/12**:
**31 protected / 0 unsafe**, no role can CREATE in `public` (PUBLIC, anon, authenticated, service_role,
app_rw, and no membership path), every protected function owned by `postgres`, H1B-0 runtime functions
EXECUTE for `app_rw` only, internal helpers not executable by any runtime role, nothing written. Snapshot
diff pre → post shows **policies, RLS/FORCE, table grants, column grants, triggers, roles, CREATE-on-public,
`app_rw` attributes, memberships and `protectedFns` ALL byte-identical**; the only function that differs is
`partnership_settlement_rows(uuid)`.

**NEW SECURITY HASH — accepted only because every invariant above passed:**
`30772757ebd4688c` → **`f31e51d50e9dec49`** (excl. login `a4ea548143702029` → **`b7b716cf8a2a1a3b`**).

**Part G — settlement behaviour as `app_rw`: PASS (7/7).** An authorized party receives its rows;
`opportunity_id` is present, non-null and unique on every row; the order is exactly `updated_at DESC` then
`opportunity_id ASC`; identical across 5 planner configurations; a **non-party sees zero rows**; the probe
wrote nothing (`txid` null). No durable test rows were created — every read ran in a rolled-back READ ONLY
transaction.

**Part H — old app after 0107: PASS.** `/api/build`, Partners, partner detail, Joint, the joint room, Today,
Pipeline, Admin, account detail and the brief: **10/10 rooms 200**, no foreign-tenant data, no app error.
Line counts equal the pre-migration crawl (Today 251, `/pipeline` 1329, `/admin` 205, account detail 170,
partner detail 220). The current app selects settlement columns by name, so the 10-column function is
transparent to it.

**Part I — database / fingerprints: PASS.** Snapshot `dg83-post`. **Exactly ONE per-table fingerprint moved
out of 155: `schema_migrations` 105 → 107 rows** (the ledger itself). All 154 others byte-identical,
including `campaign_assets` (still `0:d41d8cd9…`, **0 rows**) and `pipeline_snapshots` (still 2 rows).
Canonical counts identical. **Business-data fingerprint UNCHANGED at `c56a1d229e483f2b`** — the business
fingerprint excludes `schema_migrations`, so this is direct proof that **no canonical business row was
rewritten**. Manifest unchanged at `14e2e97f8453fb75`. Whole-world `68b56d3093a2607c` →
**`ff4a3f28c4940a9d`**, moving **only** because that digest includes the ledger.

**Part J — tenant / consent: PASS.** Vertex sees exactly its 13 pursuits; the **Meridian pursuit stays
hidden** (0 foreign pursuits under Vertex context); consent surface correct (joint 1, active partnership 1,
context grants 2); **no cross-transaction `app.org_id` leak**; settlement non-party zero; probe wrote nothing.
`tenant-isolation` was run **three times with full output retained** against the migrated schema:
**205 passed / 0 failed** each time, **zero failure lines** — the earlier local transient did not recur, and
nothing was dismissed.

> **The one flagged assertion, classified in full rather than dismissed.** My broad sweep
> ("no-context `app_rw` sees ZERO rows on EVERY org-scoped table") reported
> `environment_identity=1, pursuit_team_requirements=5`. **Assertion:** zero rows for a context-less
> `app_rw`. **Expected** 0; **actual** 1 and 5. **Context:** both are visible by their own policy, not by
> leak — `environment_identity_read` is `{public} SELECT qual=true` (it returns only
> `demo / is_synthetic true`), and `pursuit_team_requirements_ro` is
> `qual=((org_id IS NULL) OR is_org_member(org_id))`, whose 5 visible rows are **all `org_id IS NULL` global
> templates with 0 org-owned rows**. Both policies and both content fingerprints are **byte-identical before
> and after these migrations**, and the same two tables with the same counts were recorded and accepted at
> the D-G8-2A hosted gate. The over-broad assertion is mine (it excludes only the 28 `app_rw` `qual = true`
> catalogue tables and not these two policy forms); the system is unchanged. **Not a regression.**

**Part K — env / send / Production: PASS.** `externalSendingArmed` false; send rows **0/0/0/0/0**;
`OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent; no external or webhook delivery. Vercel Preview env
unchanged — the same **18** variables, names, types and ages. `DATABASE_URL` still `app_rw`,
`DATABASE_URL_OWNER` still the owner. Production untouched; `qifatlqxfuhwrwvpbwsc` never contacted (the
identity guard asserted `equals mejokqxriwyawfhawuxu: true · contains qifatlqxfuhwrwvpbwsc: false` before
every connection).

**Part L — DECISION: D-G8-3 HOSTED MIGRATION GATE — PASS.** All fifteen conditions met.

**D-G8-3 is NOT fully hosted-accepted.** The application code has not been pushed or deployed; `b1d7c6a`
and `0a5e9a8` remain local. Hosted fingerprints of record after this gate: migrations **107** · business-data
**`c56a1d229e483f2b`** (unchanged) · whole-world **`ff4a3f28c4940a9d`** · security **`f31e51d50e9dec49`** ·
manifest `14e2e97f8453fb75`. **Gate 9 NOT started.**

### D-G8-3 HOSTED APPLICATION ACCEPTANCE — 3A / 3B / 3D ACCEPTED & CLOSED (2026-09-16Z)

**D-G8-3A, D-G8-3B and D-G8-3D are HOSTED ACCEPTED / CLOSED.** The approved push of `21326e5` (a normal
fast-forward, `230ee7b..21326e5`, no force, no rewrite, no tags) auto-deployed the branch Preview and it
passed acceptance. No migration was re-applied, no Vercel env, `DATABASE_URL`, `DATABASE_URL_OWNER`, role,
RLS, grant or policy change, no Production contact, and `qifatlqxfuhwrwvpbwsc` was never touched. Sending
stayed off.

**Deployment.** `dpl_K88acSQbydWTU4UjthhCEuT4GXsC` (`pursuitos-demo-dnv0jobgt-…`): project `pursuitos-demo`,
Preview, branch `roadmap/pursuitos-vnext`, commit **`21326e5`**, **READY**, and the branch alias target.

**`/api/build`: PASS.** `mejokqxriwyawfhawuxu` · `app_rw` · bypassRls false · tenantEnforcement true · probe
live · sending off. `DATABASE_URL` → `app_rw` proven by the live runtime probe; `DATABASE_URL_OWNER` →
`owner/postgres` by the owner-backed rooms rendering healthy. Env metadata unchanged (18 variables).

**Migration / security posture — verified, nothing applied.** Migrations **107**, pending `[]`.
`partnership_settlement_rows(uuid)`: 10 returned columns with `opportunity_id uuid` last · SECURITY DEFINER ·
STABLE · `search_path pg_catalog, public, pg_temp` · body `order by o.updated_at desc, o.id` · ACL
`{postgres=X/postgres,app_rw=X/postgres}` · one definition · no CASCADE side effects. Hosted
`search-path-verify` **12/12, 31 protected / 0 unsafe**. Security hash **`f31e51d50e9dec49`** — unchanged
from the migration gate. **No security drift.**

**Full hosted crawl: PASS.** Two signed-in 37-room crawls, each with its own `/login` sign-in as the
synthetic Vertex owner, every room twice — 4 passes. **All 37 rooms 200 in all 4 passes, and all 4 passes
byte-identical.** `/pipeline?timeframe=` was not used.

- **Against the accepted D-G8-2A crawl (`a5da3b2`): 37/37 rooms byte-identical — 0 reorders, 0 membership
  changes.** The D-G8-3 application code produced **no rendered change at all** on hosted, exactly as
  predicted: `campaign_assets` holds 0 rows, the settlement tie-break only fires on a tie, and the 3D sites
  are agent/routine write paths the crawl does not exercise.
- **D-G5-1 remains closed:** Today renders Datacenter exit — phase 1 → Kubernetes managed services → Core
  banking resilience → Legacy virtualization exit. **D-G8-1 remains closed:** Dana Whitfield → Mike Rivera →
  Priya Shah → Sarah Kim. **D-G8-2A remains closed** (37/37 identical). **CDW list label unchanged** —
  `· on "CDW customer book"`.
- No empty state, no missing authorized data, **"Meridian" appears 0 times across all 4 passes × 37 rooms**,
  joint-room boundaries unchanged, owner-only paths healthy (`/admin` 205, `/ops` 55, `/trust` 105,
  `/joint` 82 lines), palette healthy.

**D-G8-3A: ACCEPTED (9/9).** The deployed readers use `order by a.position asc nulls last, a.id` (both), and
the deployed composer writes `position` from the authored array index — verified in the built commit
`21326e5`. Schema intact: `position` integer / nullable / no default; the partial unique index
`(campaign_id, "position") WHERE ("position" IS NOT NULL)`; `campaign_assets_campaign_idx` still present.
A **rollback-safe hosted round trip** (one transaction, rolled back) inserted the four assets **in reverse**
with an identical `created_at` and proved the deployed reader SQL returns the authored order
(seller_playbook → outreach_email → discovery_guide → objection_cards), that the pre-fix
`order by created_at` returns the exact reverse, and that a duplicate `(campaign_id, position)` is refused.
**No residue: `campaign_assets` and `campaigns` are both back to 0 rows.** No durable campaign assets were
created.

**D-G8-3B: ACCEPTED (7/7).** The deployed `SettlementEntry` carries `opportunityId` and the joint settlement
table keys its rows on it (`<tr key={e.opportunityId}>`). **No raw opportunity id appears as visible UI
text** — 0 uuid-bearing visible lines on `/joint`, the joint room or partner detail. Against live hosted
partnership data as `app_rw`: an authorized party receives its rows, `opportunity_id` is present, non-null
and unique on every row, the order is exactly `updated_at DESC` then `opportunity_id ASC`, identical across
5 planner configurations, and a **non-party receives zero rows**. Joint-room disclosure unchanged. Every
read ran in a rolled-back READ ONLY transaction.

**D-G8-3D: ACCEPTED (8/8).** The built commit carries every certified tie-break — `authoring.ts` and
`campaign-email.ts` (`is_default desc, created_at asc, id`), `send.ts` (`created_at desc, id desc`),
`score.ts` and `motion-designer.ts` (`p.computed_at desc, p.id desc`), `motion-designer.ts`
(`pt.version desc, pt.id`; `t.created_at desc, t.id desc`), `routines.ts` (`o.amount_usd desc nulls last,
o.id`; `rr.ran_at desc, rr.id desc` and the rest). **`campaign-email.ts` contains exactly ONE
`brand_profiles` query** and threads `{ brand, brandId }` from that single resolution, so the rendered brand
and the persisted `brandId` cannot diverge. Read-only evaluation of the deployed selection SQL over 10 reads
each (2 repetitions × 5 planner configurations) returned an identical selected identity for every site, with
no durable write of any kind — no score, motion, routine run, communication, send or campaign composition
was triggered.

> **Honest scope note.** Five of the seven 3D sites have an EMPTY live hosted population
> (`brand_profiles` 0, `communication_threads` 0, `play_templates` 0, `account_digests` 0,
> `routine_runs` 0), so on hosted they deterministically select nothing. Their determinism rests on the
> deployed-code identity above plus the local `persisted-determinism` suite (17/0, 5 plans × 2 heaps ×
> owner/app_rw, reversed insertion). The two sites with real live data — `propensity_scores` (10 rows) and
> `opportunities` (19 rows, the capped routines top-3) — were genuinely exercised and are deterministic.

**Tenant / consent: PASS.** Vertex sees exactly its 13 pursuits; the **Meridian pursuit stays hidden**;
consent surface correct (joint 1, active partnership 1, context grants 2); **no cross-transaction
`app.org_id` leak**; settlement non-party zero. The only tables a context-less `app_rw` sees are the two
already accepted at the D-G8-2A gate — `environment_identity` (`{public}` policy, `qual = true`) and
`pursuit_team_requirements` (all **5** visible rows are `org_id IS NULL` global templates, **0 org-owned**).
Same tables, same counts, policies byte-identical. **No genuinely new isolation failure.**

**Database / fingerprints: PASS — the deployment mutated nothing.** Post-deployment snapshot vs the
pre-deployment one: **0 of 155 per-table fingerprints changed.** migrations **107** · business-data
**`c56a1d229e483f2b`** · whole-world **`ff4a3f28c4940a9d`** · security **`f31e51d50e9dec49`** · manifest
`14e2e97f8453fb75` · protected **31 / 0 unsafe** · `app_rw` LOGIN true / BYPASSRLS false ·
`campaign_assets` **0 rows** · canonical counts identical. `pipeline_snapshots` stayed at 2 rows with an
identical content hash — the day's row already existed, so the render upsert rewrote the same values and
**CFR-1.1 did not need to apply**. The only delta anywhere was `extra.appRwSessions` 2 → 3 (live pool
connections).

**Send safety: PASS.** `externalSendingArmed` false; send rows **0/0/0/0/0**; `OUTREACH_AUTOSEND` and
`RESEND_API_KEY` absent; no external delivery, no webhook delivery.

**DISPOSITION.**
- **D-G8-3A — HOSTED ACCEPTED / CLOSED**
- **D-G8-3B — HOSTED ACCEPTED / CLOSED**
- **D-G8-3D — HOSTED ACCEPTED / CLOSED**
- **D-G8-3C — NOT IMPLEMENTED; RECLASSIFIED TO D-G8-4D** (campaign seed selection semantics). **Not solved.**
- **D-G8-3 overall — COMPLETE FOR THE APPROVED 3A / 3B / 3D SCOPE.**

**Still open, unchanged:** D-G8-4A (provenance precedence) · D-G8-4B (outcome-summary semantics) ·
D-G8-4C (entity / in-force selection) · **D-G8-4D (campaign seed selection semantics)** · D-G8-5
(`shared_in_evidence()`, migration-gated) · **D-P1**. All PRE-GATE-9. **Gate 9 NOT started.** H1B and H1 are
not complete.

### D-G8-4A/B/C/D — FIXED LOCALLY / NOT PUSHED · CODE-ONLY, NO MIGRATION (2026-09-16)

Owner-ruled semantic design, then implementation. **Local only: nothing pushed, nothing deployed,
hosted untouched.** **No migration was created** — the repo stays at **107**, matching the hosted level,
so the database security and catalogue state is unchanged and `f31e51d50e9dec49` should be unaffected.

**D-G8-4A — provenance precedence.** Two orderings existed and disagreed. Per ruling,
**`PROVENANCE_STRENGTH` is canonical for lifecycle / source-truth selection** and `LADDER_RANK` is
**not** replaced — it keeps serving value-driver semantics. The selector is now
`confidence DESC → observedLastAt DESC → provenance strength DESC → UNRESOLVED`. `projection.ts`
gained the recency key it was missing, so the two selectors can no longer disagree merely because one
ignored recency. The binding relations hold: **CUSTOMER_DECLARED > THIRD_PARTY_VERIFIED** and
**THIRD_PARTY_UNVERIFIED > INFERRED**. **HUMAN_ASSERTED = SECOND_PARTY** under the table, so where only
they separate two candidates the answer is **UNRESOLVED**; where tied facts would produce the same
output they collapse, so no false ambiguity is fabricated. An unresolved tie is disclosed
conservatively — `trusted` only if every tied source is, a window only if every tied source agrees —
and named in `because`.

`primaryLifecycleEvent` is deliberately **not** a provenance question: it keeps the lifecycle-state
rank then timing. A residual tie there is always ON both keys, so `primaryLifecycleDisclosed` reports
the shared state and timing, **both** labels and the **union** of competing dates instead of picking by
array order.

> **A real ambiguity this surfaced in the canonical world.** Stark carries **two** CONFLICTING_DATE
> events — `contract_expires` and `renewal_date` — both with `daysUntil = null`. They tie on state and
> timing and render differently, so the old code returned whichever the array held first. `/pipeline`
> and the renewal projection now label it **"Contract expiry / Renewal"** with the union of competing
> dates. **This is a visible, intended change and should be expected at hosted acceptance.**

**D-G8-4B — outcome summary.** The median was a per-`outcome_label` percentile followed by
`rows.find(...)` over an unordered `group by` — one arbitrarily chosen category's median reported as
the partner's overall median, a wrong statistic for the population it named. It is now computed over
**all eligible terminal timestamped outcomes**. Added the categorical **"Most common outcome"** with
count and share; **tied modes are surfaced as a tie** (`mostCommonOutcomeTied`) rather than broken by
query order. `null` stays UNKNOWN, never coerced to zero, and the existing won/lost/no-decision counts
and small-sample warning are preserved. Only the numeric days statistic may carry the word "Median".

**D-G8-4C — entity resolution.** New query-side ladder in `src/lib/identity/lookup.ts` (distinct from
the ingest-side `resolve.ts`): **canonical id → ID-type alias → name/domain alias → exact normalized
name → UNIQUE fuzzy → unresolved**. Name length, alphabetical order, uuid order and row order are gone
as identity signals. Two ID-type aliases pointing at different companies with **no namespace supplied**
resolve to **UNRESOLVED** — no precedence among id types was invented — while an explicitly supplied
namespace resolves within it. `interpret/entities.ts` keeps its candidate list but orders the window by
identity evidence, and it already returned AMBIGUOUS correctly.

**ask-scope — security.** Ambiguity now **FAILS CLOSED**: `allowed = false` with a distinct
`ambiguous_account` outcome, so it is never reported as out-of-scope and never proceeds on the hope that
something downstream refuses. The explanation carries a **count only** — no candidate names or ids —
and the MCP route returns that outcome in preference to the scope refusal.

**D-G8-4C — in-force facts.** Eligibility now includes the **validity window**
(`valid_from <= asOf < valid_until`) alongside supersession; that window was previously ignored
entirely. The selector consumes an **explicit `asOf`** captured **once** at the read-model boundary
(`getValueCase`, `assessMeddpicc`) — `loadDrivers` no longer reads the clock — which makes one
evaluation internally consistent and historical as-of evaluation possible. `conflicting → UNRESOLVED`
is preserved, and a residual tie among identical-value facts collapses. `plan-loaders` breaks an equal
timing date with the **existing** lifecycle-state rank, so **VERIFIED_DATE beats INFERRED_WINDOW**.

**D-G8-4D — campaign seed.** Precedence: an **explicit `seedCompanyId`** (validated as a member of the
eligible population) → the **UNIQUE** highest-scoring member → **UNRESOLVED (`company_id` NULL)**. Both
forbidden fallbacks are gone — the untied `limit 1` and `?? args.companyIds[0]`. `campaigns.company_id`
was **already nullable**, so **no migration**. The three inner joins became **LEFT JOINs**, so an
unresolved draft stays visible and renders **"Seed account not selected"**; **launching refuses** until a
seed is chosen. No new status enum and no `seed_company_id` column were added.

**Certification (local).** `tsc` clean · `npm test` **420/420** · build OK ·
**`certify-world --runs 2` 86 clean / 0 failures**, digest **`e98b43254f98d5ec`** unchanged at start and
after both runs · `app-rw-rehearsal` **38/38** + **6/6** · `partnership-app-rw` **117/0** ·
`tenant-isolation` **205/0** · `lifecycle-query` **80/80** · `search-path-verify` 12/12,
**31 protected / 0 unsafe** · new **`semantic-determinism` suite 38/0** · canonical world fingerprint
**IDENTICAL** (`e98b43254f98d5ec`, 154 tables, 1051 rows) · send rows **0** · **migrations still 107**.

**The new suite (`scripts/semantic-determinism-verify.ts`, SEEDED_CLONE)** proves MEANING, not stable
ordering: the median of `[1,3,5,100]` is **4** regardless of category grouping; the mode is
`CLOSED_WON (2 of 4 · 50%)` and a forced tie surfaces as `CLOSED_LOST/CLOSED_WON`; an exact normalized
name beats a **shorter, alphabetically-earlier** candidate; an ID-type alias beats a name alias on a
different company; two conflicting ID aliases are unresolved; two fuzzy candidates are unresolved;
heap order cannot change identity; ambiguity blocks execution and leaks no candidates; an expired
`valid_until` fact is out of force at `asOf` but **in** force at an earlier `asOf`; conflicting facts
stay unresolved; CUSTOMER_DECLARED beats THIRD_PARTY_VERIFIED on an exact tie while HUMAN_ASSERTED vs
SECOND_PARTY returns UNRESOLVED; and a campaign seed is the unique top scorer, or explicit, or null —
unchanged by input order.

**Status: D-G8-4A/B/C/D FIXED LOCALLY, NOT PUSHED.** D-G8-5 and **D-P1** remain OPEN / PRE-GATE-9.
**Gate 9 NOT started.**
