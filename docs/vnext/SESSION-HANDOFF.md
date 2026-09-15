# PursuitOS vNext — Session Handoff

> **Read this file first.** It is written so a brand-new Claude Code Web session can
> resume with no prior chat context. **Every work session must update it before
> stopping.**

---

## Where things stand

| | |
|---|---|
| **Date/time** | 2026-09-14 (H1A — Pre-Pilot Hardening Gate session, on the owner's Mac) |
| **Repository** | `cgrigori88/ActivateOS` — run **locally on the owner's Mac** at `/Users/cgrigori/Documents/ActivateOS/pursuitos-vnext` |
| **Current branch** | `roadmap/pursuitos-vnext` |
| **Current commit** | this session's H1A commit, on top of `54ab990` |
| **Known-good demo commit** | **`97e975f0d9895c54bfc49cdcc24924d6ac58e796`** (Wave 6D) |
| **Slice status** | Slice 1 · Slice 2A · **Slice 2B** — all **DEMO CERTIFIED / FROZEN** (2B passed hosted human review). One account may contain multiple independent pursuits; Today composes one card per PURSUIT, not per account. **No product slice before H1 completes.** |
| **Gate status** | **H1A COMPLETE (local)** · Gate 1 PASS (re-baselined) · H1B-0 COMPLETE (local) · **Gate 1b PASS** · Gate 2 precheck BLOCKED (superseded) · **H1B-0.1 COMPLETE (local)** · **Gate 1b.1 PASS** · **Gate 2 PASS** · **Gate 3 PASS** · **H1B IN PROGRESS** — readiness reviewed, nine gates defined (`H1-PRE-PILOT-HARDENING.md` § H1B execution plan). H1 NOT complete until H1B passes hosted certification |
| **Session completed** | **H1B BASELINE + READINESS REVIEW.** `motion-intel` verifier fixture gap fixed (D-047). `certify-world --runs 2` gives 76/76 clean, 3,242 assertions, 0 failures, with digest `e98b43254f98d5ec` identical before and after both runs. Readiness review: consent flows under app_rw are MUST_RESOLVE_BEFORE_CUTOVER, proven empirically on a local clone (D-048). No hosted database, Vercel, Supabase role/grant, flag, deployment or Production change; `qifatlqxfuhwrwvpbwsc` untouched. |
| **Gate 1 (2026-09-15T02:40Z)** | **PASS AFTER DOCUMENTED RE-BASELINE.** The owner chose re-baseline, not reseed. The hosted baseline of record is manifest `db1f78f7a11bbacb` and fingerprint `2678f34d4fc7b0a2`, intentional Slice 2A/2B acceptance residue that must not be erased. All other criteria passed read-only, with zero writes. |
| **H1B-0 (2026-09-15)** | **COMPLETE (local).**<br>• Migration `0104` holds consent-scoped definer functions, the consent guard, the joint-room and organisation policies, and a savepointed audit; it is **not applied to any hosted DB**.<br>• `/api/build` posture proof.<br>• `partnership-app-rw` 117/0 as the real `app_rw` login.<br>• Rehearsal 38/38 identical, consent fixture 6/6, posture correct under both roles.<br>• Certification `certify-world --runs 2` **78 / 78 suite runs clean** (39 suites incl. `partnership-app-rw`; 3,476 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.<br>Record: `H1-PRE-PILOT-HARDENING.md` § H1B-0, D-049 |
| **Gate 1b (2026-09-15)** | **PASS.** `0104` was applied to `mejokqxriwyawfhawuxu` only, in one transaction via `scripts/migrate.ts`.<br>• Migrations 103 → 104. Manifest `db1f78f7a11bbacb` unchanged. Fingerprint `2678f34d4fc7b0a2` → `0288ae73bb385a1c`; only the `schema_migrations` tracker changed, business data identical.<br>• Exactly 0104's objects were added: 19 functions, 8 guard triggers, 2 policies added and 2 narrowed. They are identical to the local certified catalogue.<br>• Definer safety was verified from the hosted catalogue.<br>• `app_rw` is still NOLOGIN, not superuser, no bypass, membership unchanged. **Gate 2 not performed.**<br>Record: `H1-PRE-PILOT-HARDENING.md` § \"Gate 1b\" |
| **Gate 2 (2026-09-15)** | **BLOCKED AT PRECHECK — NOT EXECUTED; `app_rw` still NOLOGIN; no hosted change.**<br>• All 8 identity and data prechecks passed. Schema CREATE on `public` is held only by the owner.<br>• Blocker 1: `APP_RW_PASSWORD` is not loaded.<br>• Blocker 2: SECURITY DEFINER name resolution is shadowable via `pg_temp` (PUBLIC has TEMPORARY; `search_path=public` does not list `pg_temp`). Proven locally as `app_rw`, and fixed locally by `search_path = pg_catalog, public, pg_temp`. 27 hosted functions are affected.<br>Record: `H1-PRE-PILOT-HARDENING.md` § \"Gate 2 — PRECHECK BLOCKED\" |
| **H1B-0.1 (2026-09-15)** | **COMPLETE (local).** Owner decision D-050: temp-schema shadowing is not accepted. Migration `0105_h1b01_temp_schema_hardening.sql` pins `pg_catalog, public, pg_temp` on 31 catalogue-derived functions; it is **not applied to hosted**.<br>• `search-path` 39/0: the negative control proves all 11 exploits pre-0105, and all are closed after it.<br>• Static lint in `npm test`.<br>• `partnership-app-rw` 117/0.<br>• Rehearsal `app-rw-rehearsal` after 0105: **38 / 38 rooms identical** under `app_rw` and the owner (Today, Queue, Pursuit Detail — Slice 1 / 2A / 2B — every partnership room); consent fixture **6 / 6** rendered under both; `/api/build` posture truthful — owner `postgres` / `bypassRls: true` / `tenantEnforcement: false`, app_rw `app_rw` / `false` / `true`.<br>• Certification `certify-world --runs 2` **80 / 80 suite runs clean** (40 suites incl. `search-path` 39/0 and `partnership-app-rw` 117/0; 3,554 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.<br>Record: `H1-PRE-PILOT-HARDENING.md` § H1B-0.1 |
| **Gate 1b.1 (2026-09-15)** | **PASS.** `0105` was applied to `mejokqxriwyawfhawuxu` only, in one transaction via `scripts/migrate.ts`, after all 12 pre-mutation checks passed.<br>• Migrations 104 → **105**, nothing pending.<br>• Manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94` and business row counts are unchanged. Whole-world fingerprint `0288ae73bb385a1c` → **`de05e204801988d1`**; only the `schema_migrations` tracker changed.<br>• **31 / 31 hardened, 0 unsafe** from the hosted catalogue: 30 `pg_catalog, public, pg_temp`, and `app_current_org` `pg_catalog, pg_temp`. `search-path-verify --catalogue-only` gives 12/0, read-only.<br>• Only `proconfig` changed on the 31. Bodies, owners, EXECUTE, definer posture, RLS, policies, grants, triggers, roles and memberships are all identical. No runtime CREATE on `public`.<br>• Partnership data unchanged; 0 send rows. The 0105 rollback set equals the hosted set; it was not executed.<br>• **`app_rw` still NOLOGIN — Gate 2 not performed.**<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 1b.1" |
| **Gate 2 re-run (2026-09-15)** | **PASS.** Semantically `ALTER ROLE app_rw WITH LOGIN PASSWORD <operator secret>` on `mejokqxriwyawfhawuxu` only, after all 13 pre-mutation checks (32 / 0, zero delta against the Gate 1b.1 record).<br>• The secret was checked by presence only, hashed in-process to a SCRAM-SHA-256 verifier and applied through a bound parameter inside a `DO` block. The plaintext never reached the server, its logs or any file (0 occurrences in a 323-file scan). The mechanism was proven first on a disposable local PG 17 with SCRAM auth: a real login succeeded, a wrong password was refused, and `NOLOGIN` keeps the credential.<br>• The in-transaction check before commit and the read-only post-check (45 / 0) agree: the only delta is **`rolcanlogin` false → true**. SUPERUSER / BYPASSRLS false, NOINHERIT, no CREATEROLE / CREATEDB / REPLICATION, connection limit −1, no expiry, memberships unchanged; no other role changed.<br>• Migrations 105, manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1`, all per-table fingerprints and partnership data are unchanged. 31/31 hardened, 0 unsafe (`--catalogue-only` 12/0). Policies, grants, triggers and CREATE facts identical. 0 send rows.<br>• Security hash `4682f232e8392034` → `30772757ebd4688c` (it includes the `app_rw` row); with `rolcanlogin` masked, `a4ea548143702029` both pre and post.<br>• Rollback `ALTER ROLE app_rw NOLOGIN` is ready, not executed. **`app_rw` has not connected — Gate 3 not begun.**<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 2 (re-run)" |
| **Gate 3 (2026-09-15)** | **PASS — probe only, no hosted mutation.**<br>• `app_rw.mejokqxriwyawfhawuxu` logs in through the transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`, using SCRAM, with the secret held in memory (0 occurrences in a 332-file scan). From the connection itself: `current_user = session_user = app_rw`, BYPASSRLS false, not superuser, member of no role, `row_security` on.<br>• The catalogue-driven check (155 tables: 125 tenant, 29 global, none of which has `org_id`, and 1 default-deny) compares `app_rw`'s RLS-filtered read with the owner's evaluation of each table's own policies. It is exact on count plus content hash for no context and for Vertex, Meridian and TD SYNNEX.<br>• No context → 0 tenant rows. Vertex equals the explicitly scoped owner counts, parent-scoped children included. Foreign rows are hidden on all 81 `org_id` tables; other-org rows appear only through participation, as the policies intend.<br>• Leak test: 10 transactions on the same pooled backend, across ROLLBACK and COMMIT, three orgs and a second client. Every one began with no context. **No leak.**<br>• Foreign writes on `pursuits`: UPDATE and DELETE → 0 rows; INSERT or re-home → 42501; own-org same-value UPDATE → 1 row; all rolled back. `SET ROLE` to privileged roles → 42501.<br>• `--catalogue-only` 12/0. Pre and post snapshots are identical (manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1`, security hash `30772757ebd4688c`). No `app_rw` objects, no prepared transaction, 0 send rows.<br>• The first run stopped by design at 3E (no foreign `contacts` row on hosted) before any write; the probe was fixed and the rerun passed 80/0.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 3" |
| **Gate 4 (2026-09-15)** | **PASS AFTER DOCUMENTED RE-BASELINE** (owner decision: option a; the 3 render-created rows are kept). A same-day repeat crawl proved the materialization one-time: 0 tables changed, fingerprints stable at business-data `c9623fb5abe2f9bc` / whole-world `dce27935d88743fb`. Certification fingerprint rule CFR-1 adopted (`H1-PRE-PILOT-HARDENING.md` § "Gate 4 close-out").<br>*As first run:* change applied and verified; database-fingerprint criterion not met.<br>• `DATABASE_URL_OWNER` was added to `pursuitos-demo` Preview, branch `roadmap/pursuitos-vnext` only (id `I2giX3iM1sNwoN47`, sensitive, via stdin). Env diff: +1 only; both `DATABASE_URL` entries identical; no other project or target touched.<br>• Redeployed as `dpl_4WcVaMZ4jRwzuAppkcdqb5wDCmmn` (`89b8c95`, Preview, READY); Production unchanged.<br>• `/api/build` before and after: `postgres` / bypassRls true / tenantEnforcement false / ref `mejokqxriwyawfhawuxu` / sending unarmed.<br>• Owner-only paths identical (login, join loader, admin members via `auth.users`, ops); webhook 503 and research 401 unchanged.<br>• Signed-in crawl 37 / 37 equivalent.<br>• DB read-only: migrations 105, manifest, security hash, `app_rw`, 31 protected / 0 unsafe, 0 send rows all unchanged.<br>• **Business-data `79321d9130d1dc94` → `c9623fb5abe2f9bc`, whole-world `de05e204801988d1` → `dce27935d88743fb`.** The BEFORE crawl caused this on the pre-change deployment: `/routines` seeded 2 disabled catalog rows; `/pipeline` wrote today's snapshot. Both run on the normal pool, not through the variable, so no rollback.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 4" |
| **Gate 5 (2026-09-15)** | **PASS — the branch Preview runtime is now `app_rw`.**<br>• One Vercel mutation: a value-only PATCH of the branch-scoped Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) to the `app_rw` pooler string. Metadata delta `updatedAt` only. `DATABASE_URL_OWNER` untouched (still the owner); Production untouched.<br>• `dpl_6TmAg49o7CZcsbAjmhQR1mSvQFkY` (`0570a4c`): `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending unarmed.<br>• Auth and owner paths identical.<br>• 3 live `app_rw` backends.<br>• Crawl: 37/37 rooms 200; 33 line-identical; 4 order-only (Today ×3, the `/pipeline` list label) from pre-existing untied ORDER BYs, with row sets proven equal (**D-G5-1, before Gate 7**).<br>• DB (CFR-1 strict): 0/155 tables changed; fingerprints stable; 0 send rows.<br>• Rollback ready: branch Preview `DATABASE_URL` → `GATE_OWNER_DATABASE_URL`, then redeploy.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 5" |
| **Gate 6 (2026-09-15)** | **PASS — read-only posture proof.**<br>• Serving `dpl_JD8DtC8HjgKSYtvnR2cF7AmyUwYC` (`766cb13`, docs-only over the Gate 5 code; the branch alias target).<br>• `/api/build`: demo / Private demo / `preview` / ref `mejokqxriwyawfhawuxu` / **`app_rw` / bypassRls false / tenantEnforcement true / probe live** / commit matches / sending unarmed.<br>• The probe is a live query on `getPool()` and fails closed to `unavailable`.<br>• Owner pool used only by login, join, admin, ops, research and the webhook.<br>• Signed-in smoke: 9 rooms 200.<br>• DB (CFR-1): 0 of 155 tables changed. Env metadata identical to Gate 5.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 6" |
| **D-G5-1 (2026-09-15)** | **FIXED LOCALLY / AWAITING HOSTED ACCEPTANCE — committed locally, NOT pushed** (a push auto-deploys the branch Preview).<br>• `divergence.ts`: "stage vs engagement" `order by o.updated_at asc, o.id asc` (previously no ORDER BY); the 4 sibling capped rules each get a final unique key.<br>• `projection.ts`: `order by pm.company_id, ap.created_at, ap.name, ap.id`.<br>• Ranking keys preserved; eligibility unchanged.<br>• New static guard (red 0/4 → 4/4) and DB suite `ordering-determinism` (red 9/8 → 17/0; byte-identical across 5 plans × 2 heaps × owner/`app_rw`).<br>• Rehearsal with the tie fixture: 38/38 line-identical.<br>• `tsc` clean, `npm test` 376/376, build OK, `certify-world --runs 2` 82/82 clean (3,588 assertions), digest `e98b43254f98d5ec` unchanged, 0 send rows.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1" |
| **D-G5-1 hosted (2026-09-15)** | **HOSTED ACCEPTED / CLOSED.**<br>• The push of `1c4fb5e` auto-deployed `dpl_CZ4iZ5S4q3c4ZLL1cLfddHqTfsC2` (Preview, READY, the alias target). `/api/build` reports `app_rw` / false / true / probe live / sending unarmed.<br>• Two full signed-in crawls (4 passes): 37/37 rooms identical, in order.<br>• Today View All: Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit; Today and the drawer show its exact prefix; `/pipeline` CDW label "CDW customer book". All identical in every pass.<br>• The Globex timeline list label now reads "CDW customer book": the same tie on a second consumer; disclosed.<br>• DB (CFR-1): 0/155 changed. Env unchanged. Sending off.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1 hosted acceptance" |
| **Gate 7 (2026-09-15)** | **PASS — hosted tenant/RLS certification** on `84c09e4` (docs-only over `1c4fb5e`), `app_rw` Preview; read-only or rolled back throughout.<br>• (i) Exact-RLS probe as the `app_rw` pooler login: 80/0 (0 tenant rows with no context; exact authorized visibility for 3 orgs on 155 tables; foreign rows hidden on 81; no pooled leak; writes and escalation refused); `search-path` 12/0.<br>• (ii) 37 rooms identical in order to the accepted D-G5-1 crawl.<br>• (iii) Supplemental owner-backed suites: context 62/0, today-tenant 51/0; team, attention and coordination hit hosted-data harness limits (attention's tenant sections 11/0).<br>• (iv) Accepted substitution: the Meridian pursuit is 404, identical to a nonexistent id.<br>• (v) `partnership-app-rw` on hosted as `app_rw`, rolled back: 117/0 (= local), via harness commit `bd4bd61`.<br>• (vi) Owner human review: PASS.<br>• DB (CFR-1): 0/155 changed every time; env unchanged; sending off.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 7" |
| **CFR-1.1 (2026-09-15)** | **Adopted by the owner.**<br>• All persisted state stays strict: 155 per-table fingerprints, business-data, whole-world, security hash.<br>• All non-time-derived manifest fields stay strict.<br>• `days_since_activity` is validated by **recomputation from its source `updated_at`** at the as-of time, and the source timestamp stays strict.<br>• The raw digest `db1f78f7a11bbacb` is kept as the Gate 1 historical baseline. |
| **Gate 8 Phase 1 (2026-09-15)** | **PASS, with one recorded pre-existing deviation (D-G8-1). Emergency rollback to `owner/postgres` proven.**<br>• A value-only update moved the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) from `app_rw` to the owner. The only metadata delta is its `updatedAt`. `DATABASE_URL_OWNER` is untouched.<br>• Redeployed as `dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H` (`5adeebe`). `/api/build` reports `postgres` / bypassRls true / tenantEnforcement false / probe live / sending off.<br>• Owner paths identical.<br>• Two full crawls, identical to each other. Against the Gate 7 `app_rw` crawl: 29 time-derived +1-day lines, plus the D-G8-1 order-only swap (the `/pipeline` stakeholder query has no ORDER BY: Sarah Kim first under the owner, Dana Whitfield under `app_rw`).<br>• DB 40/0 pre and post; CFR-1.1 5/0 pre and post.<br>• **The Preview is paused in the owner posture.** Docs are committed locally and not pushed.<br>Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 8 Phase 1" |
| **Gate 8 Phase 2 / Gate 8 (2026-09-15)** | **PASS — both directions proven.**<br>• A value-only update moved the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) from the owner back to `app_rw`, probed in memory first. Only its `updatedAt` changed; `DATABASE_URL_OWNER` is untouched.<br>• `dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu` (`5adeebe`): `/api/build` reports `app_rw` / false / true / live, sending off.<br>• Owner paths identical.<br>• Two crawls, identical to each other; against Gate 7 `app_rw`, only the 29 validated clock lines differ; D-G8-1 shows Dana first, as in Gate 7.<br>• Isolation smoke passes.<br>• DB 40/0 pre and post; CFR-1.1 5/0.<br>• Env equals the Gate 7 record apart from `updatedAt`.<br>The emergency rollback procedure is recorded in `H1-PRE-PILOT-HARDENING.md` § "Gate 8 Phase 2" |
| **D-G8-1 (2026-09-15)** | **FIXED LOCALLY / AWAITING HOSTED ACCEPTANCE — committed locally, NOT pushed.**<br>• `/pipeline` stakeholders: `order by s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id` (the displayed label, then the primary key; no business ranking; no filter / join / scope change).<br>• Static guard: red 4/5 → 5/5.<br>• `ordering-determinism`: red 20/3 → 23/0; byte-identical across 5 plans × 2 heaps × owner/`app_rw`.<br>• Rehearsal 38/38 with the documented stakeholder order under both roles.<br>• `tsc` clean, `npm test` 377/377, build OK, `certify-world --runs 2` 82/82 (3,600 assertions), digest `e98b43254f98d5ec` unchanged, 0 send rows.<br>• The audit found latent category-C ordering candidates, recorded as **D-G8-2** (not fixed).<br>Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-1" |
| **Exact next step** | **Hosted D-G8-1 acceptance (owner approval; a push auto-deploys the branch Preview on `app_rw`):**<br>• push `roadmap/pursuitos-vnext`;<br>• `/api/build` must report `app_rw` / false / true / live;<br>• run the signed-in 37-room crawl twice: `/pipeline`'s tied economic buyers must render Dana Whitfield, then Sarah Kim, in every pass, and everything else must equal the Gate 8 Phase 2 crawl apart from validated clock text;<br>• DB check under CFR-1.1.<br>**Then** an owner decision on the D-G8-2 backlog (fix its high-priority rows before Gate 9?), and **fix D-P1** (`?timeframe=` snapshot overwrite) before Gate 9.<br>Baseline: migrations 105, business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb`, security hash `30772757ebd4688c`, manifest under CFR-1.1. |
| **Before that** | **H1A — TENANT ISOLATION + CERTIFICATION INTEGRITY** (`39acb05`). See § "H1A" below. |
| **Before that** | **SLICE 2B HOSTED-REVIEW DEFECT — FIXED** (`54ab990`), then accepted on the hosted Preview → Slice 2B DEMO CERTIFIED / FROZEN. |
| **Before that** | **TODAY / QUEUE TENANT HARDENING — PASSED** (`c0eea5a`, the Slice 2B release blocker). See § "Today / Queue tenant hardening". |
| **Before that** | **SLICE 2B — PURSUIT ATTENTION + TODAY / QUEUE, LOCAL** (`8261ef3`). See § "Vertical Slice 2B". |
| **Previous session** | **HOSTED TEAM-LAYER REPAIR — FIXED.** Root cause (in-place reseed clears the 0075-only team requirements) reproduced locally and fixed in code (`6ab3599`); `mejokqxriwyawfhawuxu` reseeded in place. Hosted coordination **112 pass / 0 fail / 4 environmentally not run** (as-`app_rw` only; equivalents pass), Slice 1 62/0, demo-team 11/0, manifest unchanged, 0 send rows. Slice 2A stays **PREVIEW READY**, not DEMO CERTIFIED. No Vercel, flag, deploy, auth or Production change; Monday demo never addressed. See § "Hosted team-layer repair" below. |
| **Previous session** | **SLICE 2A HOSTED PROMOTION — INSTALLED, VERIFICATION PARTIAL** (16:49Z, docs `a9846b4`): 0103 + Globex plan story on `mejokqxriwyawfhawuxu`; found the no-team defect. |
| **Preview URL** | **UNVERIFIED** — unchanged |
| **Preview data safety** | **UNKNOWN** — unchanged. No Vercel scope was touched |
| **vNext isolated database** | Ref `mejokqxriwyawfhawuxu`: migrated **103/103**, `environment_identity` = `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview", canonical world reconciled (digest `be0da833990ce436`), **Slice 2A Globex plan installed** (1 goal · 1 plan · 1 recommendation · 0 decisions), zero messages of any kind. **Team layer repaired 21:08Z** (fix `6ab3599`, reseeded in place): 5 canonical team requirements, 45 members, Globex ledger 10, plan owner `ROLE_UNFILLED`; matches a fresh local build table for table. **Ready for the Vercel step** (`ENVIRONMENT-MAP.md` §10, 21:08Z) |
| **Live serving SHA** | **UNRESOLVED** — all seven unauthenticated avenues exhausted and recorded (`ENVIRONMENT-MAP.md` §9) |

### Demo baseline, unchanged and re-verified this session

- Production branch `claude/activateos-platform-review-xzkgmd` → `97e975f0`.
- Also the head of `ui-wave-6d`, and tagged `backup/2026-09-04/tds-live-demo`
  (annotated, already on origin — the durable immutable reference).
- Working tree clean at session start and at session end.

---

## H1A (2026-09-14) — tenant isolation + certification integrity: COMPLETE (local)

Full record: `H1-PRE-PILOT-HARDENING.md`. Decisions D-043 (explicit tenant scoping everywhere), D-044 (certification must not change the world), D-045 (H1B design) and D-046 (Slice 2B certified; many pursuits per account).

**Audit.** 293 application data paths were inventoried. 153 were reachable RLS_ONLY or UNSCOPED:
- 152 are fixed;
- 1 is reclassified as system-by-design;
- 0 remain.

The worst were cross-tenant writes and sends:
- another tenant's approved email could be sent to an attacker recipient;
- deals advanced or closed by foreign id;
- a pursuit route overridden by foreign id;
- motions approved by foreign id;
- evidence-share and broker injection;
- another tenant's engagement scores deleted.

Whole other-tenant books (Pipeline, Contacts, Campaigns, pursuit detail) and every aggregate on Analytics and Insights also leaked.

**Proof:**

| Check | Result |
|---|---|
| `tenant-isolation` (new, SEEDED_CLONE) | **205/0** — foreign tenant planted (33 kinds), 38 rooms and APIs of the real build crawled, 27 writes with foreign ids refused, negative control moves every room |
| `certify-world --runs 2` | **PASS**: digest `e98b43254f98d5ec` at start, after run 1 and after run 2. 74/76 suite runs clean; `motion-intel` 18/1 in both runs is pre-existing, as `54ab990` fails the same assertion identically |
| Verifier harness | 0 UNSAFE. 8 SEEDED suites that committed into the canonical world now run on seeded clones. All 19 FRESH/EITHER suites are guarded. `--either-on-seeded` is refused |
| `app-rw-rehearsal` | **36/36** rooms identical as `app_rw` (RLS binding, `rolbypassrls=false`, 0 rows with no GUC) and as the owner |
| `tsc`, `npm test`, `build` | 0 · 362/0 · 0 |
| Slice 1 / 2A / 2B / today-tenant / team | 62/0 · 116/0 · 64/0 · 51/0 · 11/0 |
| Canonical world | manifest `be0da833990ce436`; fingerprint `e98b43254f98d5ec`, unchanged |

**Reported, not fixed** (ambiguous ownership or product semantics; `H1-PRE-PILOT-HARDENING.md` § C):
- global `signal_sources` / `golden_examples` written by tenant verdicts;
- inbound email subject matching across tenants;
- stored `account_digests` needing regeneration;
- cross-tenant consent flows that may need policies under app_rw (H1B).

**Local environment notes:**
- Postgres 17 on :5433, socket `/tmp/pgv5433`. `pursuit_demo` is pristine; `pursuit_cert` is the certification copy.
- `verify-run.ts` now defaults to :5433.
- `scripts/motion.ts approve|reject` now needs `--org <id>`.

**Exact next step: H1B, owner-approved, in `H1-PRE-PILOT-HARDENING.md` § "H1B sequence".**
1. Read-only pre-flight on `mejokqxriwyawfhawuxu`.
2. `alter role app_rw with login password …` there, never on `qifatlqxfuhwrwvpbwsc`.
3. A direct `app_rw.<ref>` pooler login test.
4. Vercel Preview for this branch only: add `DATABASE_URL_OWNER`, then switch `DATABASE_URL` to app_rw.
5. `/api/build` posture probe (to be implemented in H1B).
6. Hosted certification: tenant verifiers as app_rw, a two-org blind test, the rollback rehearsal.

**No product slice before H1 completes.**

---

## Slice 2B hosted review (2026-09-14) — the final Today defect, fixed locally

**Review results:** Queue PASS · Pursuit Detail labelling PASS · Today FAIL: two Globex cards in State D, "Plan needs review" and "Approve route via CDW".

**Root cause.** Confirmed with a guarded, read-only query of `mejokqxriwyawfhawuxu`: the script refuses any other ref, runs in a `READ ONLY` transaction, and never prints the credential.

| Hosted pursuit | Type · thesis | Route | Plan |
|---|---|---|---|
| `8e5f5d34` (hero) | MODERNIZATION · "Exit legacy virtualization before renewal" | SELECTED — WWT, over the CDW recommendation | 1 |
| `db8cf1b8` | EXPANSION · "AI platform expansion" | RECOMMENDED — CDW, pending | 0 |

"Approve route via CDW" is the EXPANSION pursuit's own item. The composition already produced one card per pursuit; both cards showed only "Globex Manufacturing Inc.". A pristine local State D reproduces the hosted result exactly. The local copies had hidden it before, because `team-motion-verify` had selected that route.

**Fix (D-042):**

| Change | Where |
|---|---|
| Two pursuits stay two cards (never merged by account). Where one account has several pursuit cards, each title leads with the pursuit's thesis, e.g. "AI platform expansion · Approve route via CDW". Keyed by company id, after the tenant filter | `composeAttentionQueue`, `pursuitCardLabel`; labels read org-scoped in `composeTodayAttention` |
| Every reason for one pursuit competes under the existing `todaySort`; the plan wins exact ties; the loser folds beneath the winner | `composeAttentionQueue` (amends D-035) |
| Each folded item keeps its CTA — "Approve route via CDW → Approve" | `DecisionOther.actionLabel`, `components/pursuit/today.tsx` |
| "Decisions to make" = every underlying reason (`decisionCount`), its certified meaning; "View all N" counts cards | `TodayQueueView.decisionCount`, `app/page.tsx` |

**Tests:**
- 7 new unit tests: State D one card with plan review primary; route approval folded and actionable; top-4 and View all never duplicate; a lone route approval stays unchanged; two same-account pursuits are not collapsed and are named; foreign same-account items change nothing; the metric semantics.
- 7 new `vnext-attention` checks on the real world in State D.

**Render proof, against the accepted build `c0eea5a`** (fresh world, ids resolved per database):
- Queue, Pursuit Detail, the Today/Pipeline/Accounts drawers and every flag-OFF Today page are identical in all five configurations.
- With attention on, only Today differs.
- In State D, Today shows "Exit legacy virtualization before renewal · Plan needs review" and "AI platform expansion · Approve route via CDW"; "decisions to make" = 38.
- Screenshots: `docs/vnext/review/slice-2b/today-D-*-final.png`.

**One mobile fix from the same review.** The composed cards' stacked layout used `items-start`, so long titles clipped past the card edge at 390px. It now uses `items-stretch`: 0 elements cross a card edge on desktop or mobile. This only affects composed cards; flag-OFF markup is unchanged.

**Next:** the owner-approved redeploy of the branch head to the Preview scope, then the final hosted human review. Slice 2B remains PREVIEW READY until then.

---

## Today / Queue tenant hardening (2026-09-14) — PASSED; the Slice 2B security gate

**What was wrong.** A pre-existing leak, found during Slice 2B and made its release blocker.
- The app connects as the table owner, which bypasses RLS (task #67), and several Today and Queue queries named no org.
- **Measured on the pre-fix code (`8261ef3`), flag OFF:** the guest org Meridian's Today listed 17 items, all of them Vertex's, plus Vertex's whole $8,040,000 open pipeline (11 opportunities; Meridian owns 0).
- The account drawer took a company id from the URL, then read the pursuit, pipeline, evidence and history about it with no org. It even guessed the org from the account's first motion.
- The Queue's resolve actions updated a row by id alone.

**What was fixed (D-041).** Every Today, Queue and drawer query now names the caller's org (from `withTenant`) in SQL, before ranking, counting or `LIMIT`:

| Path | File |
|---|---|
| Decision queue: route approvals, fact reviews, team waits, ledger changes | `src/lib/pursuits/read-models/today.ts` |
| Pipeline band | `getTodayExposure(db, orgId, scope)` |
| Also queued · At a glance · Top opportunities · Recent activity | new `src/lib/today/overview.ts` (moved from `app/page.tsx`) |
| "Where your systems disagree" subqueries | `src/lib/context/divergence.ts` |
| Account drawer (Today, Pipeline, Accounts) | `getAccountIntel(db, companyId, orgId)` |
| Queue worklist | new `src/lib/motions/queue-read.ts` (moved from `app/queue/page.tsx`) |
| Queue Mark handled / Skip / Dismiss | `app/queue/actions.ts`, `resolveMotionAction(..., orgId)` |

Already scoped and left alone:
- the lifecycle horizon, value gaps, motion blockage, digests and the scope resolver;
- the layout badges;
- all Slice 2B attention and lineage loaders.

**Proof:**
- `scripts/today-tenant-verify.ts` (SEEDED, registered): 51 / 0. It includes 10 planted guest-org clones of real rows, which leave Vertex's surfaces identical.
- `tests/today-tenant-scope.test.ts`: 4 / 0.
- Full regression is green; see STATUS.

For the owning org, the pages are byte-identical to the pre-fix build in five configurations × 7 pages. The one exception is a declared tie order among equal-materiality economic-buyer cards (`ORDER BY pu.created_at, pu.id`). Before, those ties followed undeclared planner order. In flag-OFF "View all" this is proven reorder-only: the same cards byte for byte, the same page length.

**Security correctness supersedes byte-identical flag-OFF output:** the old identity partly held because both sides leaked.

**Still open:**
- Task #67, the `app_rw` / RLS cutover: defence in depth, not replaced.
- Every other room (Pipeline list, Accounts list, Motions, Partners, …) is unaudited and carries the same class of risk.

**Local run:**

```sh
DATABASE_URL_VERIFY=… npx tsx scripts/today-tenant-verify.ts
```

**Verifier hygiene trap found this session.** `team-motion-verify` once committed a route selection and team invite/accept onto the Globex hero, taking its ledger from 10 to 17. The seeded Slice 2A recommendation went stale, and `vnext-attention` then failed at State B. So run the committing spot checks **last**, and rebuild the world (`seed-demo-world.ts`) before any certification run. All final numbers here come from a fresh rebuild.

The negative control uses a scratch worktree at `8261ef3` with `cp -cR node_modules` and imports that tree's `today.ts`. The script is in the session scratchpad; it was not committed.

---

## Vertical Slice 2B — Pursuit Attention + Today / Queue coordination (2026-09-14)

**State: PREVIEW READY on the local synthetic path.** It sits behind `VNEXT_PURSUIT_ATTENTION_ENABLED`, default OFF, which requires `VNEXT_PURSUIT_COORDINATION_ENABLED`. It is not on any hosted scope. Decisions D-034…D-040; acceptance `ACCEPTANCE.md` § Slice 2B; numbers `STATUS.md` § "Vertical Slice 2B validation".

### The boundary

```
TODAY  = decision / attention  "what needs my judgment across my pursuits right now, and why?"
QUEUE  = execution             "what work exists, and what do I execute?"
```

Both run on the same primitives: pursuit, plan and revisions, motion, `motion_actions`, team and ledger. Attention is a **derived read-model** — no table, no migration, nothing persisted.

### How it works

**Attention model.** `read-models/pursuit-attention.ts` is pure.
- Input: the Slice 2A plan context of one pursuit, via `loadPursuitPlanContext` — the same read Pursuit Detail makes.
- It derives seven reasons: `PLAN_REVIEW_REQUIRED`, `PLAN_DECISION_REQUIRED`, `ACTION_OVERDUE`, `ACTION_BLOCKED`, `OWNER_MISSING`, `ACTION_DUE`, `MILESTONE_ADVANCED`.
- It ranks them by a declared order, validated against Today's class ranking.
- It collapses them to one primary per pursuit. The rest become "other items"; reasons the card already carries are "subsumed".
- Keys are deterministic, e.g. `attention:<pursuit>:<kind>:<revision / motion action / fingerprint>`.

**Loaders.** `read-models/attention-loaders.ts`:
- `loadPursuitAttention` — org-scoped: only pursuits with a live plan;
- `composeTodayAttention` — one card per pursuit, tenant-scoped;
- `loadQueuePlanLineage` — joins through the existing `stagedMotionActionId`.

**Today** (`app/page.tsx`). With the capability on, the existing decision panel is composed and retitled "Needs your attention". The existing items fold under their pursuit's card. On the seeded world this is 36 → 11 cards, with nothing lost.

**Queue** (`app/queue/page.tsx`). A plan-queued row says so on its meta line: "From the approved plan · View plan →", or a "PLAN NEEDS REVIEW" chip with "Review plan →". Nothing is cancelled or replaced. The due buckets now come from `src/lib/motions/due-buckets.ts`, shared with Today.

**Pursuit Detail.** `frameApprovedPlan`, applied after the 2A composer and only under the capability, adds "Current approved plan — Approved Sep 14, recorded before the changes above" and "Focus when approved". It is labelling only.

### Globex, locally

| State | Today | Queue |
|---|---|---|
| A — recommendation awaiting approval | "Plan awaiting approval" · Review plan · card 6 of 11 (ranks with the route approvals — honest materiality) | no lineage (nothing approved) |
| B — approved, action due | "Approved action has no confirmed owner", with "Approved action is due" beneath · Open team | exactly one row · "From the approved plan · View plan →" |
| C — economic buyer verified after approval | **"Plan needs review" · CRITICAL · card 1** · Review plan. The old action is only an "other item" | the same row, still pending · "PLAN NEEDS REVIEW · Review plan →" |
| D — updated recommendation undecided | still ONE card: "Plan needs review … An updated recommendation is waiting for your decision." | unchanged, still marked |

### Local environment (this session)

The cluster is in the session scratchpad, on port 5433, with socket dir `/tmp/pgv5433`. Recreate it as in § Slice 2A below.

Render copies: `createdb -T pursuit_demo pursuit_state_b`, then advance it through `decide_pursuit_plan`. `pursuit_state_c` adds `assert_stakeholder_role` for Dana Whitfield as a verified economic buyer; `pursuit_state_d` adds `recommend_pursuit_plan`.

Run the verifier with: `DATABASE_URL_VERIFY=… npx tsx scripts/vnext-attention-verify.ts`.

**zsh trap.** Pass the server environment as an **array** (`ENV=(A=1 B=1); env $ENV …`). zsh does not word-split a string variable, so every flag but the first silently stays unset.

**Turbopack trap.** Turbopack refuses a `node_modules` symlink that points outside the project root. For a baseline worktree, copy with `cp -cR` (APFS clone).

### Deferred

- **Attention impressions for P8** — who saw which key, when. That is an impression log; the keys make it possible without storing attention.
- **Automatic review recording** on material events (P5 worker).
- **Goal editing UI**, and **plan closure** on WON / LOST.
- **Queue-side cleanup of earlier-plan actions.** They are labelled "From an earlier approved plan" and left for a person to close.
- **Attention for pursuits without a plan** beyond the existing items.
- **An expression index** on `content->'nextAction'->>'stagedMotionActionId'`, if revision volume grows.
- **The pre-existing mobile sliver** of the certified Today card, and the `getTodayQueue` org predicates (task #67).

### Exact next step — owner-approved, NOT executed

The tenant hardening (above) is done, so the security gate no longer blocks this.

1. On the Vercel Preview scope for `roadmap/pursuitos-vnext` only, add `VNEXT_PURSUIT_ATTENTION_ENABLED=1` alongside the already-armed Slice 1 + 2A flags. No database change is needed: Slice 2B has no migration.
2. Redeploy the branch head, and confirm `/api/build` reports `database.projectRef = mejokqxriwyawfhawuxu`.
3. Run `vnext-attention-verify.ts` and `today-tenant-verify.ts` against `mejokqxriwyawfhawuxu`. Both write only inside rolled-back transactions.
   - Expect the four as-`app_rw`-style constraints not to apply: this harness does not `SET ROLE`.
   - Because the hosted Globex plan was already walked to State D during Slice 2A acceptance, its State A expectations will differ. Read section 2 as informational there, or reseed first.
4. Hosted human review of Today, Queue and the Globex plan in States C/D. Only then consider DEMO CERTIFIED.

---

## Hosted team-layer repair (2026-09-14T21:08Z) — FIXED; coordination 0 failures

**The seeding defect found during the Slice 2A promotion is fixed in code
(`6ab3599`), and `mejokqxriwyawfhawuxu` has been reseeded with it.** The
hosted world now matches a fresh local build table for table. On hosted the
coordination verifier has **0 failures**. Its only not-run checks are the four
that must act *as* `app_rw`, which this host cannot do through the owner
connection. Slice 2A stays **PREVIEW READY**, not DEMO CERTIFIED. No Vercel,
flag, deployment, auth or Production change was made. The Globex plan was not
approved or adjusted. The Monday demo was never addressed.

### Root cause — confirmed by reproduction, not only by reading

`scripts/demo-db.ts` in-place mode truncates every table that carries `org_id`,
and `pursuit_team_requirements` is one of them. Its only rows are the five
global roles migration **0075** inserts. In-place mode never replays
migrations, so after the clear nothing put them back. `assembleTeam` creates
one member per requirement, so it created no team for any pursuit, and wrote no
`TEAM_CHANGED` row.

**Reproduced locally:** the pre-fix `demo-db.ts` (from `HEAD`), run in place
against a disposable local database, left **0 requirements, 0 members, 0
Globex team, 0 `TEAM_CHANGED`** — exactly the hosted state. So a fresh
`migrate → seed` and an in-place reseed did not converge. 0075's `on conflict do
nothing` never guarded anything either: the table has no unique key.

### The fix (`6ab3599`)

| File | Change |
|---|---|
| `src/lib/routing/team-requirements.ts` | **new.** `CANONICAL_TEAM_REQUIREMENTS` — the one definition of the five global roles (account executive and partner account manager required; specialist, solution architect and distributor BDM optional). `planCanonicalTeamRequirements` is pure: it makes the global rows **exactly** canonical — inserts missing rows, corrects a drifted `required`, drops duplicates (keeping the oldest) and non-canonical global rows. It never preserves arbitrary rows. `establishCanonicalTeamRequirements` runs that plan at seed time. Tenant-scoped rows are untouched |
| `scripts/demo-db.ts` | `seed()` establishes them first, before any team is assembled. Both provisioning paths build through `seed()`. On a freshly migrated database the plan is empty and nothing is written. The truncate comment now says why clearing the table is safe |
| `scripts/seed-demo-world.ts` | `verify()` now checks the canonical requirements and the Globex hero team |
| `scripts/demo-team-verify.ts` + `verify-classes.ts` | **new SEEDED, read-only** `demo-team` verifier (11 checks) covering what the manifest does not count: exact requirements, no duplicates, empty repair plan, Globex team roles/sides/status, one "Team assembled (5 roles)" event, the certified 10-row Globex ledger. It prints a team digest |
| `tests/team-requirements.test.ts` | **new, 10 tests.** They pin the list to 0075's insert, and cover: the fresh world needs no repair, an in-place clear gets exactly five back, fresh and in-place converge, repeated seeding is idempotent with no id churn, duplicates are removed, arbitrary rows are not preserved. A source check makes sure `seed()` establishes the requirements before `assembleTeam`, on both paths |

**No migration was created.** 0075 stays untouched history. The manifest is
unchanged, and the team tables are covered by the new supplemental verifier
instead.

### Local regression (disposable DB, `127.0.0.1:5433`)

| Build | demo-team | coordination | Slice 1 | manifest | spot suites |
|---|---|---|---|---|---|
| Fresh (drop → migrate → seed) | 11/0, digest `b63845ca021fe143` | **116/0** | 62/0 | `be0da833990ce436` | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 · team-motion 22/0 |
| In-place reseed #1 | 11/0, `b63845ca021fe143` | **116/0** | 62/0 | `be0da833990ce436` | same |
| In-place reseed #2 | 11/0, `b63845ca021fe143` | **116/0** | 62/0 | `be0da833990ce436` | same |

Whole-world snapshots (row count of every public table, plus Globex
ledger/team, requirements, plan and identity) are **identical** across all three
builds. The one exception is `schema_migrations`, which exists in the in-place
runs only because the local tracker was stamped with `migrate.ts --baseline` so
the in-place path would accept the database. `tsc` 0 · `npm test` **326/0**
(+10).

### Hosted repair (`mejokqxriwyawfhawuxu` only)

Same guarded wrapper as the promotion. It refused any target but
`mejokqxriwyawfhawuxu`, and bound `DATABASE_URL`, `DEMO_URL`,
`DATABASE_URL_VERIFY` and `DEMO_TARGET_URL` to one value. The redaction filter
never saw the secret.

| Step | Result |
|---|---|
| Gate | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; demo ref absent |
| Pre-repair (read-only) | requirements **0**, members **0**, Globex ledger **9**, plan owner `UNASSIGNED` |
| `seed-demo-world.ts` (in place) | **11/11 layers ok**; `verify()` all ok, including "canonical team requirements (5)" and "Globex hero team assembled (5 roles)". The Slice 2A plan story re-ran as layer 11, so `demo-plan-story.ts` did not need a separate run |
| Post-repair vs local fresh | **identical** in every table except `org_members` (1 hosted operator membership, carried and re-linked by design) and the tracker |
| Pre → post row changes | `pursuit_team_requirements` 0→5 · `pursuit_team_members` 0→45 · `change_ledger` 48→64 · `governed_action_invocations` 18→25. Every other table is unchanged, and all four new totals equal the canonical local build — the team layer and what later layers do with it (not itemised) |
| Residue after every verifier | none — all 155 table counts and the Globex ledger/team/plan unchanged since the reseed |

**Hosted verifier outcome**

| Verifier | Result |
|---|---|
| `demo-team` | **11 passed, 0 failed**; team digest `b63845ca021fe143` = local |
| `vnext-coordination` (repo, unmodified) | 96 ✓ and **0 ✗**, then it aborts at the first `set local role app_rw` (section 7b), before sections 8–10 |
| same harness, scratchpad copy with **only** the as-`app_rw` scenarios skipped (section 6 enabled) | **112 passed · 0 failed · 4 not run** = 116. Section 6 (needs the team) 7/7; tenant isolation 4/4; disclosure 3/3; no-send and residue 8/8, including "the seeded recommendation wrote no ledger row" |
| `vnext-context` (Slice 1) | **62 passed, 0 failed** |
| manifest | `be0da833990ce436` before and after; counts, figures and tenants byte-identical |

**Globex** — owner "Unassigned — Account executive role proposed — no one confirmed
yet" (`ROLE_UNFILLED`, the canonical semantics). Team: five RECOMMENDED
members, one per role, each on its correct side. Ledger: the certified 10 rows
including one "Team assembled (5 roles)". Goal unchanged and route-free; WWT
only in the plan; one recommendation, 0 decisions.

### The four as-`app_rw` checks — ENVIRONMENTALLY NOT RUN

The four checks: objective rewrite → 42501, supersession pointer rewrite →
42501, RLS cross-org read → 0, revision UPDATE → 42501. All four are proven
locally (116/0).

**What the host says (read-only):**
- PG 17.6.
- `app_rw` is `NOLOGIN`.
- `postgres` holds `app_rw` with `admin_option = true`, `set_option = false`,
  `inherit_option = false`, granted by `supabase_admin`.

So PG16+ refuses `SET ROLE app_rw` by design.

**The repository's supported paths for acting as `app_rw` on Supabase** are:
- a real `app_rw` login credential — `alter role app_rw with login password …`,
  `audit/RISK-1-CUTOVER-STATE.md`;
- a temporary `grant app_rw to postgres` in the SQL editor.

Both are Supabase role/grant changes, which are out of scope. No `app_rw`
credential variable exists in this environment. Nothing was faked or weakened.

**The grant/RLS equivalents all pass on hosted:**
- (A) `app_rw` has no UPDATE on `pursuit_goals.objective`.
- (B) `app_rw` has no UPDATE on `supersedes_goal_id`.
- (C) `pursuit_plan_revisions` has RLS enabled **and forced**, with policy
  `pursuit_plan_revisions_rw` to `{app_rw}` using and checking
  `is_org_member(org_id)`, and `is_org_member` reads the tenant context.
- (D) `app_rw` has no table UPDATE or DELETE on revisions, and 0 column UPDATE
  grants.
- Section 1's `has_table_privilege` checks also pass.

### Security · send · Monday demo

- **Tenant isolation and partner disclosure unchanged:** section 8 4/4 and
  section 9 3/3 on hosted.
- **No send activity:** `messages` / `action_outbox` / `email_events` /
  `sending_identities` = 0 before, after, and after every harness run.
- **Sending off:** `OUTREACH_AUTOSEND`, `RESEND_API_KEY` and
  `VNEXT_PURSUIT_COORDINATION_ENABLED` unset in every command.
- **Monday demo:** `qifatlqxfuhwrwvpbwsc` was never contacted. Every command
  connected as `postgres.mejokqxriwyawfhawuxu`, and the wrapper refused any
  string containing the demo ref.
- **Credential:** `DEMO_TARGET_URL` was never printed, logged or persisted.
- **Still open:** ENVIRONMENT-MAP risk 10 notes that any database seeded in place
  *before* this fix would lack teams. The Monday demo database was not queried,
  so whether that applies to it is **UNVERIFIED**.

---

## Slice 2A hosted promotion (2026-09-14T16:49Z) — INSTALLED, VERIFICATION PARTIAL

> **Superseded by "Hosted team-layer repair" above.** Kept as the record of how
> the defect was found.

**Schema and the Globex plan layer are on the isolated hosted database
`mejokqxriwyawfhawuxu`. The coordination verifier is not green there, for one
reason that predates this session: the hosted canonical world has no pursuit
team.** Slice 2A stays **PREVIEW READY (local)** — hosted schema/data readiness
is not product certification. No Vercel surface, flag, deployment, auth setting
or Production system was touched. `VNEXT_PURSUIT_COORDINATION_ENABLED` was not
set. The Globex plan was not approved or adjusted, and no economic buyer was
confirmed. The Monday demo `qifatlqxfuhwrwvpbwsc` was never addressed.

### How every command was run

Through a guarded wrapper in the session scratchpad (not committed). It:
- refused to run unless the parsed `DEMO_TARGET_URL` user named
  `mejokqxriwyawfhawuxu` and the string contained no `qifatlqxfuhwrwvpbwsc`;
- bound `DATABASE_URL`, `DEMO_URL`, `DATABASE_URL_VERIFY` and `DEMO_TARGET_URL`
  to that one value for every command (derivation in `ENVIRONMENT-MAP.md` §10,
  16:49Z);
- unset every other database, `PG*`, send and coordination-flag variable;
- piped all output through a filter that strips the URL, its password and any
  `postgres://` string.

The filter only ever redacted the password-masked connection line both
verifiers print about themselves. It never saw the secret.

| Step | Result |
|---|---|
| Gate | `target : project mejokqxriwyawfhawuxu` · `environment demo` · `is_synthetic true`. The demo ref does not appear in the string |
| Pre-write baseline (read-only txn) | 102 migrations; no coordination tables; 3 · 14 · 19 · 11 open · $8,040,000 · 14 (14/14 `DEMO`); messages / outbox / email_events / sending_identities all 0; Globex ledger **9**; digest `be0da833990ce436` |
| `migrate.ts --dry-run` | 1 would apply (`0103_pursuit_coordination.sql`), 102 already tracked |
| **1 · `migrate.ts`** | **0103 applied — "1 applied, 102 already tracked", exit 0.** Additive: its `drop` lines are drop-policy-then-create and CHECK widenings that keep every prior value (the ledger CHECK still carries `PURSUIT_CREATED`) |
| **2 · `demo-plan-story.ts`** | **`✓ Globex — pursuit plan recommended (awaiting a person's decision)`**, exit 0 (plus the known pg `DeprecationWarning`) |
| Post-install probe (read-only txn) | 1 goal · 1 plan · 1 revision, all Globex. Goal **"Exit legacy virtualization before renewal and close the $920K opportunity"**: `PROPOSED`, `SYSTEM_RECOMMENDED`, target 2026-10-24, `DEMO`. **Neither the objective nor the basis matches `WWT\|CDW`.** Plan: `PROPOSED`, its `goal_id` is that goal. Revision 1: `RECOMMENDATION` by `SYSTEM` (`pursuit-plan-v1`); motion "Virtualization" · partner **WWT** · linked via `OPPORTUNITY` · `active`; next action "Identify and verify the economic buyer at Globex Manufacturing Inc."; focus "No economic buyer identified". **0 `DECISION` rows anywhere, 0 goals past PROPOSED.** RLS enabled and forced with one policy on each new table; `app_rw` has no UPDATE/DELETE on any of them. Ledger 9, governed invocations 18, motion_actions 5, overrides 1, pursuit_facts 2, `goals` 1, `revenue_motions` 7 — all unchanged from the baseline |
| 3 · `vnext-coordination-verify.ts` (repo, unmodified) | **FAIL — 60 ✓, 1 ✗, then fatal** `TypeError … reading 'id'` at `scripts/vnext-coordination-verify.ts:234` (section 6). Exit 1. **Not 116/0** |
| 3b · the same harness, as a scratchpad copy | Imports made absolute. **Only** section 6 and the four `set local role app_rw` scenarios are skipped, behind env guards. **103 pass · 2 fail · 11 not run** (7 in section 6, 4 as-`app_rw`) = 116. Tenant isolation 4/4 (another org cannot load, read, decide or recommend), disclosure 3/3, no-send 7/7, "world unchanged after the harness" ✓ |
| 4 · Slice 1 `vnext-context-verify.ts` | **PASS — 62 passed, 0 failed** |
| 4 · `demo-manifest.ts` | **`be0da833990ce436`** before and after; counts and figures byte-identical; = certified |
| 4 · `tsc --noEmit` / `npm test` (local, no DB vars) | exit 0 / **316 pass, 0 fail** |
| Residue | Re-probed after every verifier run: all 17 probe fields unchanged since post-install |
| 5 · Final | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; `OUTREACH_AUTOSEND`, `RESEND_API_KEY`, `VNEXT_PURSUIT_COORDINATION_ENABLED` unset |

### Both failures are one pre-existing defect: the hosted world has no pursuit team

| Fact (read-only) | Hosted | Local rebuild |
|---|---|---|
| `pursuit_team_requirements` rows | **0** | 5 global roles from migration 0075 |
| `pursuit_team_members` rows (all pursuits) | **0** | Globex: every role `RECOMMENDED` |
| `TEAM_CHANGED` ledger rows | **0** | one "Team assembled (n roles)" per assembled pursuit |
| Globex ledger rows | **9** | 10 |

**Cause, from the code.** In in-place mode `scripts/demo-db.ts` truncates the
demo world but preserves reference data. Its rule is "tables a migration
INSERTs into, minus those carrying `org_id`". `pursuit_team_requirements`
carries `org_id`, so it is truncated as tenant data — the comment at
`demo-db.ts:300` names it. But its only rows are the five **global**
(`org_id` null) roles migration 0075 inserts, and in-place mode never replays
migrations. `assembleTeam` (`src/lib/routing/team.ts:28`) creates one member per
requirement, so it created nothing and wrote no `TEAM_CHANGED`. The local path
drops the database and replays every migration, so it never shows this. **It
has been true of the hosted world since the 02:59Z initialization.**
`demo-manifest.ts` does not count team tables, which is why reconciliation stayed
exact and the defect went unseen.

**What it does to Slice 2A on hosted:**
- The owner resolves `UNASSIGNED` — "Unassigned — No account executive on the
  pursuit team yet". The canonical `ROLE_UNFILLED` reads "Unassigned — Account
  executive role proposed, no one confirmed yet". **S2A-12's owner clause is not
  met on hosted.** (✗ 1)
- Section 10's "Globex ledger === 10" fails at 9 (✗ 2). The plan story itself
  wrote **no** ledger row — 9 before, 9 after — so the property that check guards
  (a recommendation writes nothing to Slice 1 history) holds.
- Section 6 finds no `VENDOR_SPECIALIST` to reassign the action to, which crashes
  the unmodified harness.
- **The seeded recommendation carries the defect in its fingerprint.** The basis
  fingerprint includes the owner assignment (D-028). If the team is restored
  underneath it, the recommendation goes stale and can no longer be approved.
  Re-running the idempotent plan story would then append a second recommendation
  rather than correct the first.

**Not fixed, deliberately.** Restoring requirements or teams would rewrite the
canonical world beyond what `demo-plan-story.ts` is designed to add.

### A hosted-only verifier limit (separate from the defect)

`set local role app_rw` is refused to `postgres` on this host (`permission
denied to set role "app_rw"`), although `pg_has_role(current_user, 'app_rw',
'MEMBER')` is true. That is consistent with PG16+ membership granted without the
SET option (**UNVERIFIED**). So the four behavioural as-`app_rw` checks cannot
run as `postgres` here: objective rewrite 42501, pointer rewrite 42501, RLS
cross-org read 0, revision UPDATE 42501. Their grant-level equivalents do run and
pass: section 1's `has_table_privilege` checks, and the probe's forced RLS with a
policy on every new table. The behaviour itself is proven locally (116/0).

### Also observed

`DEMO_TARGET_URL` now parses to the **transaction pooler, `:6543`**. It was the
session pooler, `:5432`, at initialization. It was parsed only, never printed.
Every script here keeps each transaction on one client, so all ran unchanged. If
the same string goes into the Preview scope, this also settles the "session vs
transaction pooler for serverless" consideration under the Vercel step.

### Send safety · Monday demo · secrets

- `messages`, `action_outbox`, `email_events`, `sending_identities`: **0**
  before, after, and after every harness run. Both plan skills are
  INTERNAL_WRITE. `OUTREACH_AUTOSEND` and `RESEND_API_KEY` were unset in every
  command's environment, so `externalSendingArmed()` is false.
- `qifatlqxfuhwrwvpbwsc` was **not contacted** — not even to prove it
  unchanged. The wrapper refused any string containing it, and the parsed user
  in every command was `postgres.mejokqxriwyawfhawuxu`. No fallback existed:
  every other DB variable was unset, there is no `.env`, and no local Postgres
  was listening.
- The `DEMO_TARGET_URL` value was never printed, echoed, logged, persisted or
  documented. No `env`/`printenv`.

---

## Vertical Slice 2A — Pursuit Coordination (2026-09-14)

**State: PREVIEW READY on the local synthetic path. Not yet visible on the hosted
Preview** (needs the owner-approved steps under "Exact next step" below).

### What it is

On Pursuit Detail, one full-width **"Pursuit plan"** panel directly beneath the frozen
"What matters now", behind `VNEXT_PURSUIT_COORDINATION_ENABLED` (requires the Slice 1
chain). It answers: goal · progress · current focus · why · motion · next action ·
owner · when · approve / adjust — with milestones and plan history each behind one
disclosure, and a "This plan needs review" block only when new evidence has made the
approved plan stale.

### Model (D-024…D-032)

```
pursuit_goals            the commercial OUTCOME only (never route/motion/action/owner — D-033);
                         PROPOSED by PursuitOS → ACTIVE when a person approves a plan for it;
                         replaced only append-only: new row supersedes_goal_id + reason, old row
                         SUPERSEDED with its meaning intact (governed replace_pursuit_goal, USER only)
pursuit_plans            stable identity (what a P5 runtime resumes)
pursuit_plan_revisions   APPEND-ONLY. RECOMMENDATION rows (system) and DECISION rows (person:
                         APPROVED / ADJUSTED / REJECTED) — a decision references the recommendation
                         it answers; content = focus · motion ref · next action · owner ·
                         milestones · why; basis = evidence refs + normalized inputs + fingerprint
revenue_motions          REUSED — the motion, reached only by a canonical link (pursuit, or the
                         pursuit's opportunity). Globex: the WWT Virtualization motion, via the opp
motion_actions           REUSED — approval stages the next action as a pending step (active motion only)
dispatchSkill            REUSED — recommend_pursuit_plan / decide_pursuit_plan (INTERNAL_WRITE),
                         held in COORDINATION_SKILLS, not SKILL_REGISTRY (keeps the flag-OFF
                         Federation panel unchanged)
pursuit_overrides        REUSED — field 'plan' for ADJUSTED / REJECTED
change_ledger            REUSED — PLAN_DECIDED, PLAN_REVIEW_REQUIRED (recommendations write none)
pursuit_team_members     REUSED — owner = a role; Unassigned is explicit
```

### Globex, as seeded (layer 11, `scripts/demo-plan-story.ts`)

Goal "Exit legacy virtualization before renewal and close the $920K opportunity" (no route
in it — WWT appears only in the plan, D-033)
· Target Oct 24 (the opportunity's close date) · proposed, not yet confirmed · 4 of 8
milestones (route, champion, technical buyer, value case done; economic buyer and
pursuit timing open; decision/paper process waiting on the economic buyer; close) ·
focus "No economic buyer identified" · motion "Virtualization motion · via WWT · active,
linked through this pursuit's opportunity" · next "Identify and verify the economic
buyer at Globex Manufacturing Inc." · owner **Unassigned — account executive role
proposed, no one confirmed yet** · why: buying authority; "Runs through WWT — the route a
person chose over the CDW recommendation"; champion (Sarah Kim) and technical buyer
(Mike Rivera) confirmed; renewal held on the account for Nov 29, 2026 — account context,
not confirmed for this pursuit. **Awaiting approval** — no decision is seeded.

### Files

| File | Change |
|---|---|
| `supabase/migrations/0103_pursuit_coordination.sql` | **new** — 3 tables, RLS forced, append-only by REVOKE, ledger + override vocab widened |
| `src/lib/pursuits/read-models/pursuit-plan.ts` | **new** — pure: goal, milestones, focus, owner, why, fingerprint, review, adjustments, view-model |
| `src/lib/pursuits/read-models/plan-loaders.ts` | **new** — tenant-scoped, disclosure-aware loaders; reading never writes |
| `src/lib/pursuits/coordination/plan-store.ts` | **new** — the two governed write paths |
| `src/components/pursuit/pursuit-plan.tsx`, `pursuit-plan-controls.tsx` | **new** — surface + approve/adjust |
| `src/app/pursuits/[id]/page.tsx` | flag-gated load + render beneath "What matters now" |
| `src/app/pursuits/[id]/actions.ts` | `requestPlanRecommendationAction`, `decidePlanAction` |
| `src/lib/pursuits/federation/skills.ts` | `COORDINATION_SKILLS` + `pursuitInOrg`; `defFor` resolves both arrays |
| `src/lib/env/vnext-flags.ts` | `pursuit_coordination` flag; `next_best_action` marked reserved |
| `src/lib/pursuits/ledger.ts`, `overrides.ts` | two change types, one override field |
| `scripts/demo-plan-story.ts`, `seed-demo-world.ts` | layer 11 |
| `scripts/vnext-coordination-verify.ts`, `verify-classes.ts` | new SEEDED harness (86 checks, all writes rolled back) |
| `tests/vnext-pursuit-plan.test.ts`, `tests/vnext-flags.test.ts` | +23 tests |
| `docs/vnext/review/slice-2a/*.png` | desktop/mobile, flag ON/OFF, plan panel default + expanded |

### Local environment established this session

Homebrew `postgresql@17` + `pgvector` (local only). Cluster in the session scratchpad,
port 5433, socket dir `/tmp/pgv5433` (the scratchpad path exceeds the 103-byte socket
limit). Recreate:

```sh
PG=/opt/homebrew/opt/postgresql@17/bin
$PG/initdb -D <dir> -U postgres --auth=trust -E UTF8 --locale=en_US.UTF-8
mkdir -p /tmp/pgv5433 && $PG/pg_ctl -D <dir> -o "-p 5433 -k /tmp/pgv5433" -l <dir>/log start
env -u DEMO_TARGET_URL -u DATABASE_URL DEMO_PGHOST=127.0.0.1 DEMO_PGPORT=5433 DEMO_DB_NAME=pursuit_demo \
  DEMO_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
  DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo npx tsx scripts/seed-demo-world.ts
DATABASE_URL_VERIFY=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo npx tsx scripts/vnext-coordination-verify.ts
```

Note: a `demo-db.ts`-built database applies every migration file directly and leaves
`schema_migrations` empty, so `scripts/migrate.ts` against it replays 0001 and fails.
Rebuild the world (as above) rather than migrating it. The hosted isolated database IS
tracked (102 rows), so `migrate.ts` there applies only 0103.

### Deferred (explicitly not built)

- **Today integration** — a plan awaiting approval / needing review is not yet a Today item (Today is shared and not flag-scoped; kept untouched).
- **Human-authored goal editing** — schema supports `HUMAN_AUTHORED` + supersession; no UI.
- **Plan closure** on WON / LOST / DISQUALIFIED; `CLOSED` status exists, nothing sets it.
- **Automatic review recording** — staleness is detected on every read; it is *recorded* (revision + `PLAN_REVIEW_REQUIRED`) when someone asks for the updated recommendation. A worker hook on material ledger events is P5 work.
- **Superseded staged actions** — a re-approved plan queues a new step; the earlier queued step is left for a person to close (no silent rewrite).
- **Plans for pursuits other than Globex** — any pursuit shows "Recommend a plan" to an operator when the flag is on; only Globex is seeded.
- P5 runtime, P8 learning/analysis, P9 playbooks — the data they will need is recorded; nothing consumes it yet.

### Observed, not fixed (pre-existing, outside this slice)

- Globex's `PARTNER_ACCOUNT_MANAGER` team recommendation still names **CDW** after the WWT override (team assembled before the override; `assembleTeam` is idempotent per role).
- Globex MEDDPICC marks `economic_buyer` **strong** while stakeholder coverage has **no** economic buyer. The plan follows coverage (the ranked gap); the disagreement is a Slice-1-era data question.
- Slice 1 loaders queue concurrent queries on one pg client (`Promise.all`) → pg 8 DeprecationWarning. The new loaders are sequential.
- The synthetic PRODUCTION-lineage defect on the two route-override rows (STATUS debt) is still open. The new plan override path passes the pursuit's own lineage.

### Exact next step — the owner-approved Vercel step (step 3), NOT executed

> **Updated 2026-09-14T21:08Z.** Steps 1 and 2 below are **DONE**. Step 1 put
> 0103 and the plan story on `mejokqxriwyawfhawuxu`. Step 2 took the
> recommended option: the seeding fix `6ab3599` plus an in-place reseed. Hosted
> coordination now has 0 failures; its 4 as-`app_rw` checks are environmentally
> not run, and their equivalents pass. **The next action is step 3.** Nothing on
> Vercel has been touched.

To show Slice 2A on the hosted isolated Preview (never the Monday demo `qifatlqxfuhwrwvpbwsc`):

1. ~~Apply 0103, install the Globex plan story, verify on `mejokqxriwyawfhawuxu`~~ — **DONE 2026-09-14T16:49Z, verification PARTIAL.** See § "Slice 2A hosted promotion" above.
2. **Decide the hosted no-team defect — recommended before any Vercel step.** A reviewer would otherwise see a Globex owner line that differs from S2A-12, and the seeded recommendation would go stale the moment a team appears.
   - *Recommended:* a small fix to `scripts/demo-db.ts` so in-place mode also preserves the global (`org_id is null`) rows of `pursuit_team_requirements` that migration 0075 inserts. Then a guarded in-place reseed of `mejokqxriwyawfhawuxu` (all four DB variables bound to the target, `ENVIRONMENT-MAP.md` §10), which rebuilds every layer including 11.
   - Re-run both verifiers on hosted: expect 62/0, and 116/0 except the four as-`app_rw` checks, unless `postgres` is given SET on `app_rw` there or those checks are accepted as local-only.
   - *Alternative:* proceed to Vercel knowing the owner line reads "No account executive on the pursuit team yet".
3. Vercel Preview scope for `roadmap/pursuitos-vnext` only: add `VNEXT_PURSUIT_COORDINATION_ENABLED=1` alongside the Slice 1 chain (which the owner reports already armed); redeploy the branch head; confirm `/api/build` → `database.projectRef = mejokqxriwyawfhawuxu`.
4. Product review of the "Pursuit plan" surface on Globex (approve, adjust, then verify the economic buyer in Stakeholders and watch the plan go to "needs review"). Only after that can Slice 2A be considered for DEMO CERTIFIED.

With the flag unset, the hosted page never reads the new tables, so the installed schema and data are inert until step 3.

---

## Commits produced

| Chunk | SHA | Title |
|---|---|---|
| 1 | `d1e5685` | feat(vnext): add pursuit context health read model |
| 2 | `b6b7b33` | feat(vnext): add chronological pursuit memory read model |
| 3 | `ac572ba` | feat(vnext): compose ranked missing-context read model |
| 4 | `77f72ef` | feat(vnext): add pursuit pertinence read model |
| — | `a13c2fa` | docs(vnext): record chunks 1–4 as built |
| 5A | `0f86079` | feat(vnext): connect living pursuit context loaders |
| — | `9744335`, `20ee049` | docs(vnext): chunk 5A record + handoff correction |
| 5B-1 | `1b05b8a` | fix(vnext): preserve gap semantics in pursuit pertinence |
| — | `494d166` | docs(vnext): chunk 5B-1 record + D-019 |
| 5B-2 | `620bc12` | feat(vnext): compose pursuit evidence context |
| — | `b3abac9` | docs(vnext): chunk 5B-2 record + D-020 |
| 6A | `ed3416c` | feat(vnext): add composed pursuit brief (unrendered) |
| 6B | `99bd5dd` | feat(vnext): gate pursuit brief on pursuit detail |
| — | `e0365d4` | docs(vnext): record the first rendered vNext surface |
| GATE C | `a4a3314` | docs(vnext): GATE C product review package |
| — | `284c4dc` | docs(vnext): always deliver review screenshots in-conversation |
| refine | `1ed0105` | fix(vnext): restore complete pursuit history access |
| refine | `6c5b7a9` | refactor(vnext): refine pursuit context experience |
| — | `c4f4196` | docs(vnext): record the GATE C refinement |
| preview | `714433b` | docs(vnext): plan isolated vNext preview, record blockers as exhausted |
| vNext DB #1 | `072bd56` | docs(vnext): record the isolated vNext target and its egress blocker |
| vNext DB #2 | `5ee1dfe` | docs(vnext): record the vNext target credential blocker |
| **vNext DB #3** | **(this session)** | **docs(vnext): record the initialized isolated vNext database** — documentation only; the database work itself leaves no commit |
| **Slice 2A** | **`524af12`** | **feat(vnext): pursuit coordination — goal, plan, motion, action (Slice 2A)** |
| Slice 2A docs | (the commit after `524af12`) | docs(vnext): record Slice 2A and freeze Slice 1 |
| D-033 | `c79efc6` | refactor(vnext): pursuit goals are commercial outcomes; plans carry the route (D-033) |
| Slice 2A hosted | `a9846b4` | docs(vnext): record Slice 2A installed on the isolated hosted database |
| **Team-layer fix** | **`6ab3599`** | **fix(vnext): canonical seed re-establishes the global team requirements** |
| Team-layer repair docs | (this session) | docs(vnext): record the hosted team-layer repair — documentation only; the reseed itself leaves no commit |

## Chunks 6A + 6B files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pursuit-context.ts` | **new** — the composed narrative view-model |
| `src/components/pursuit/context-narrative.tsx` | **new** — `PursuitContextNarrative` |
| `src/app/pursuits/[id]/page.tsx` | flag-gated three-for-one swap; context loaded only when armed |
| `tests/vnext-pursuit-context.test.ts` | **new** — 20 tests |

**Renamed to avoid a collision:** `read-models/brief.ts` already owns
`PursuitBrief` (the exportable document behind the Brief button on the same
page). The new surface is Pursuit **Context** in code.

**Visible surface count: 11 → 9.** "Why now", "Facts behind this" and "What
changed" all disappear; one "This pursuit" panel replaces them. `#whynow`,
`#evidence` and `#activity` all still resolve — they are deep-linked from six
call sites.

**Flag-OFF regression proven by render:** the pre-6B and post-6B commits produce
**byte-identical bodies (231,410)** with the flag off. Only per-build Turbopack
chunk filenames differ. Flag-off also issues no extra queries.

**The Globex nuance was strengthened after seeing it render.** 6A attached the
timing caveat to the top gap; on real data the economic-buyer gap outranks
timing, so it stayed silent. It is now section-level and reads "Customer-declared
timing exists on the account — not yet confirmed for this pursuit". This became
`ACCEPTANCE.md` U-15.

## Chunk 5B-2 files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pursuit-evidence.ts` | **new** — direct vs supporting evidence composition |
| `src/lib/pursuits/read-models/context-loaders.ts` | `loadPursuitEvidence` / `loadPursuitEvidenceInput`, reusing `deriveRelevance()` |
| `src/lib/pursuits/read-models/pertinence.ts` | `relevanceInferred` on the candidate — wording only, no score change |
| `scripts/vnext-context-verify.ts` | 8 new assertions + the evidence report |
| `tests/vnext-pursuit-evidence.test.ts` | **new** — 18 tests |

**The original 5B-2 plan is superseded, and the reasoning is preserved** in the
Slice 1 AS-BUILT section. The swap to pursuit-scoped facts would have deleted
the best evidence on the screen: Globex has 7 account facts, 1 linked, and the
6 unlinked include the `renewal_date` that answers the pursuit's own
second-ranked gap. See **D-020**.

**Seeded Globex result:** 1 direct (`strategic_initiative`, SOLUTION_FIT) and
6 supporting, led by `renewal_date` at 67 as an inferred TIMING_ANCHOR. All 7
account facts accounted for exactly once; 0 rejected, 0 withheld, 0 below band.

**UI recommendation from the real data: `DIRECT_PLUS_SUPPORTING`.** Direct-only
would leave a single `strategic_initiative` fact with no timing and no economics
— materially weaker than today's account-scoped panel.

## Chunk 5B-1 files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/pertinence.ts` | `gapRank` / `gapSource` / `whyItMatters` on the candidate; GAP linkage uses the upstream rank; `TASK_FIT` matches `GapSource` |
| `src/lib/pursuits/read-models/context-loaders.ts` | carries `rank`, `source`, `whyItMatters` from `ContextGap` |
| `scripts/vnext-context-verify.ts` | 5 new assertions + all six task contexts reported |
| `tests/vnext-gap-pertinence.test.ts` | **new** — 13 tests |

**Semantic fields preserved:** `gapRank` (upstream importance), `gapSource`
(producing domain), `whyItMatters` (upstream explanation), `gapKind` (four-state).

**Ranking design:** substitution, not addition. Upstream rank
(`KIND_WEIGHT + SOURCE_WEIGHT + blocking`) **replaces** `LINKAGE_BY_GAP[kind]` at
the same 0.30 linkage weight, because both encode the same question at different
resolutions. Nothing is summed on top, so gap kind is never counted twice —
pinned by a test asserting two gaps with equal rank but different kind score
identically. Normalised against the fixed 0..100 scale, never against the other
candidates, so no score depends on its neighbours (which would break D-018).

**Disclosure invariance evidence:** two tests add a *top-ranked* inaccessible gap
(rank 100 / rank 95) to a guest's candidate set and assert the visible items,
scores and order are byte-identical to the set without it — once under GENERAL,
once under a task that would have boosted it. The verifier re-proves it against
the real world by comparing a guest ranking to an independently ranked
guest-visible subset.

## Chunk 5A files

| File | Change |
|---|---|
| `src/lib/pursuits/read-models/context-loaders.ts` | **new** — four thin loaders + convenience wrappers |
| `scripts/vnext-context-verify.ts` | **new** — 42-assertion read-only integration harness |
| `scripts/verify-classes.ts` | modified — registry entry `vnext-context` (SEEDED) |
| `src/lib/intel/company-intel.ts` | modified — **one word**: `export function familiesFromSignalTypes`. Zero runtime effect. |

Nothing imports `context-loaders`; there is still no rendered consumer.

## Chunk 1–4 files — and nothing else touched

| File | Lines |
|---|---|
| `src/lib/pursuits/read-models/context-health.ts` | 427 |
| `src/lib/pursuits/read-models/memory.ts` | 269 |
| `src/lib/pursuits/read-models/missing-context.ts` | 378 |
| `src/lib/pursuits/read-models/pertinence.ts` | 329 |
| `tests/vnext-context-health.test.ts` | 193 |
| `tests/vnext-pursuit-memory.test.ts` | 245 |
| `tests/vnext-missing-context.test.ts` | 266 |
| `tests/vnext-pertinence.test.ts` | 250 |

**8 files added. 0 pre-existing files modified.** Verified with
`git diff --stat bfca1d7..HEAD` — every line is an insertion in a new file.

The four modules are **not** exported from `read-models/index.ts`, which is the
boundary the UI consumes. Nothing outside `src/lib/pursuits/read-models/` imports
them. They are unreachable from any rendered path.

## Tests and build

| Check | Session 0 | 1–4 | 5A | 5B-1 | 5B-2 | 6A+6B |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | 220 / 0 | 233 / 0 | 251 / 0 | **271 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | 42 / 0 | 47 / 0 | 55 / 0 | **55 passed / 0 failed** |
| SEEDED spot-check | — | — | green | green | green | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

### Chunk 5B-1 measured effect (Globex pursuit, local synthetic world)

| | before | after |
|---|---|---|
| GENERAL top 5 | five coverage gaps tied at 69 | economic buyer 69 · timing anchor 67 · decision process 62 · paper process 62 · value driver 60 |
| task contexts that reorder | 4 of 6 | **6 of 6** |
| VALIDATE_TIMING leader | "No economic buyer identified" (69) | **"No verified timing anchor" (79)** |

### Local synthetic database — how it was established

PostgreSQL 16.13 from `/usr/lib/postgresql/16/bin`, `initdb` as the `postgres`
user (it refuses to run as root) under `/var/lib/postgresql/vnext/pgdata`, port
5433. **`pgvector` is required** — `0001_core_schema.sql` does
`create extension vector` — and is not installed by default:
`apt-get install -y postgresql-16-pgvector`, then restart the server.

```sh
export DEMO_PGHOST=127.0.0.1 DEMO_PGPORT=5433 DEMO_DB_NAME=pursuit_demo
export DEMO_ADMIN_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
export DEMO_URL="postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo"
npx tsx scripts/seed-demo-world.ts            # all 10 layers + verify()
export DATABASE_URL_VERIFY="$DEMO_URL"
npx tsx scripts/vnext-context-verify.ts       # 42/42
```

The seeded world reconciled exactly against the certified canonical facts:
3 orgs · 14 companies · 19 opportunities · **11 open** · **$8,040,000** ·
14 pursuits · `environment_identity` = `demo` / `is_synthetic=true`.

**No hosted database was contacted at any point.**

71 tests added in total: 4 flag tests (Session 0) + 67 read-model tests
(13 + 21 + 15 + 18). **Zero pre-existing failures at any point**, so any future
failure is attributable and must not be dismissed as pre-existing.

No snapshot was updated and no test was weakened. One expectation of mine was
wrong during chunk 4 — a settled primary trigger scores 78 (`high`), not
`very_high`, because `unresolved` contributes nothing to it. The arithmetic was
verified by hand and the *test* corrected, not the implementation.

---

## Architectural discoveries

**0. (chunk 5A) Two real findings the integration harness surfaced.**

*A world defect, reported not fixed.* Two `change_ledger` rows in the wholly
synthetic canonical world carry `data_environment = 'PRODUCTION'` —
`PARTNER_OVERRIDE` and `OVERRIDE_RECORDED`, on the **Globex hero pursuit the
demo's §2 beat turns on**. Cause: `recordChange()` defaults `dataEnvironment` to
`'PRODUCTION'` (`src/lib/pursuits/ledger.ts`) and the two override call sites
(`src/lib/routing/override.ts`, `src/lib/pursuits/overrides.ts`) omit it, so
those entries are not labelable as synthetic. **Left alone** — a seed-path change
two days before the demo is not worth it. Fix after Monday by passing
`dataEnvironment` at the two call sites.

*Pertinence task-fit ignores gap source.* `"No verified timing anchor"` ranks
second in missing-context (72) but `VALIDATE_TIMING` does not lift it, because
`TASK_FIT` matches relevance types and refTypes while a WHY_NOW gap's `refType`
is the generic `"pursuit"`. Relatedly, all same-kind gaps **tie** in pertinence:
a GAP's linkage comes from `gapKind` alone, so missing-context's carefully ranked
order (economic buyer 80, timing anchor 72) is discarded and the GENERAL top-5 is
five coverage gaps at 69. Chunk 4 was **not** redesigned — this is composition
work for 5B: pertinence should consume the gap's `rank` and `source`.

**1. The house four-state conclusion vocabulary.** Three domains already express
a four-way judgement separating verified / inferred / degraded / absent:
`ValueCaseState` (STRONG · INCOMPLETE · CONFLICTING · NOT_ESTABLISHED),
`CoverageState` (VERIFIED · INFERRED · UNVERIFIED · MISSING), and lifecycle dates
(VERIFIED_DATE · INFERRED_WINDOW · STALE_DATE · CONFLICTING_DATE). This is a
deliberate pattern. Chunks 1 and 3 adopt the same shape instead of inventing a
fourth and fifth. **Chunk 6 must preserve it in the UI** — rendering all four as
"missing" discards a distinction the product has maintained in three places.

**2. Pertinence and "why this pursuit" are different computations.** Ranking
*within* a pursuit for the decision at hand needs only pursuit-scoped inputs.
"Why this pursuit rather than another" needs cross-pursuit inputs that do not
belong in a pursuit-scoped slice. The former shipped; the latter is deferred to
Slice 3. See **D-017**. Chunk 6's "Why this matters" must not imply it answers
the portfolio question.

**3. Disclosure must filter before ranking, not penalise within it.** An
un-entitled item that merely scores lower still shifts the positions of visible
items around it, so its existence becomes inferable from the ordering — a leak by
arithmetic that a "the secret string is absent" test would not catch. See
**D-018**. Both ranking modules filter first and disclose only an aggregate count.

## Existing primitives reused — nothing re-implemented

| Primitive | Where | Used by |
|---|---|---|
| `factFreshness()`, predicate-specific policy | `src/lib/facts/freshness.ts` | context-health |
| `computeCompleteness()`, `COVERAGE_CATEGORIES` | `src/lib/intel/completeness.ts` | context-health |
| `bandOf()`, `Caller` | `read-models/helpers.ts` | context-health, pertinence |
| `Band`, `ScoreReason`, `TrustLabel`, `DisclosureClass` | `read-models/types.ts` | all four |
| `ELEMENTS`, `Meddpicc` | `src/lib/opportunities/meddpicc.ts` | missing-context |
| `StakeholderCoverage`, `CoverageState` | `src/lib/stakeholders/coverage.ts` | missing-context |
| `ValueCaseState` | `src/lib/value/case.ts` | missing-context |
| `WhyNowView` (`unknowns[]`, `contradictions[]`) | `read-models/types.ts` | missing-context |
| `change_ledger` column semantics | migration `0065` | memory |
| `pursuit_facts.relevance_type` | migrations `0066` + `0072` | context-health, pertinence |

## Discrepancies between the prior audit and the implementation

Two suspected schema/implementation disagreements were checked. **Neither is
real** — both were resolved by later migrations, and I verified rather than
reporting a false defect:

- `pursuit_facts.relevance_type` — `0066` allows four values, `deriveRelevance()`
  returns nine. **`0072` widens the constraint** to all nine.
- `change_ledger.change_type` — `FACT_LINKED_TO_PURSUIT` is absent from `0065`'s
  CHECK. **`0073`/`0079`/`0084` extend it.**

Both confirm that LOW-materiality linkage events genuinely exist in the ledger,
which is exactly the connective tissue `getPursuitTimeline` filters out and
Pursuit Memory retains. The Session 0 audit finding stands.

No other discrepancy was found. The Session 0 "what already exists" inventory was
accurate.

---

## Blockers

| # | Blocker | Impact | Unblock |
|---|---|---|---|
| B-1 | **Preview data access UNKNOWN** | Slice 1 is read-only, so unaffected. Blocks Slice 2+. | `ENVIRONMENT-MAP.md` §6 — one read-only Vercel API call |
| B-2 | **Live serving SHA unresolved** | Cannot certify any promotion | `/api/build` with `OPS_FINGERPRINT_TOKEN`, or the Vercel API |
| B-3 | Tag pushes refused (403) | Cosmetic — durable references exist | None needed |
| B-4 | ~~**No Postgres egress from Claude Code Web**~~ — **CLEARED 2026-09-14T02:44Z** for this work, by running locally. Still true *of Claude Code Web*: do not attempt hosted-database work from there | — | Run the §10 sequence locally, as this session did |
| B-5 | ~~**The `DEMO_TARGET_URL` credential is rejected by `mejokqxriwyawfhawuxu`**~~ — **CLEARED 2026-09-14T02:59Z.** The owner supplied a fresh credential; it authenticated (after one transient `28P01` on the very first probe) and the database was initialized | — | Done |

Neither B-1 nor B-2 blocked chunks 1–4 or 5A, and neither blocks 5B (still no
writes). B-2 must be resolved before GATE E. **With B-5 cleared, B-1 is now the
blocker that matters: the isolated database exists, but the Vercel Preview scope
has not been pointed at it, and what it points at today is still UNKNOWN.**

---

## DO NOT TOUCH

- `app.pursuitos.io` — production. Out of scope entirely.
- `demo.pursuitos.io` — Monday's demo.
- Branch `claude/activateos-platform-review-xzkgmd` — **the Vercel production
  branch.** Never push to it, never merge into it, without an explicit
  instruction naming that action. Green tests are not approval.
- Any Vercel environment variable, deployment, alias, domain, or build setting.
- Any Supabase role, grant, RLS policy, schema object, migration, or credential.
- The hosted demo database (`qifatlqxfuhwrwvpbwsc`). No writes, no reseed.
- DNS, secrets, `main`.
- Disclosure/grant layer, governed-action semantics, append-only ledgers
  (`change_ledger`, `governed_action_invocations`, `pursuit_overrides`),
  recommendation-vs-decision semantics, `externalSendingArmed()`.

---

## STANDING INSTRUCTION — deliver review screenshots in-conversation

For **every** review/gate phase (GATE C and any later gate, promotion
certification, or visual review), do not merely commit the screenshots and cite
their paths. **Send the image files into the conversation** so the reviewer can
see them without leaving the session. Committing them as well is correct — the
repo is the archive, the conversation is the review surface.

Practical constraints learned on 2026-09-12:

- The file uploader **rejects very tall images with HTTP 400.** A 2×
  full-page mobile capture (780×15,740) fails; the 2× desktop full pages
  (2880×7,654) succeed. When a capture is rejected, re-render the same state at
  `deviceScaleFactor: 1` (or crop to the changed region) for delivery, keep the
  2× version in the repo, and say plainly which is which.
- Verify the re-render is the same state before sending — compare page bytes and
  `document.documentElement.scrollHeight` against the committed capture.
- Lead with the element-scoped capture of the surface under review; send the
  full-page pairs after it, and caption each with what to look at.

## GATE C review package (2026-09-12, docs only)

`docs/vnext/GATE-C-PRODUCT-REVIEW.md` — flag OFF vs flag ON on the seeded Globex
pursuit, measured from the rendered DOM. Screenshots: `docs/vnext/review/gate-c/`
(`desktop-off`, `desktop-on`, `mobile-off`, `mobile-on`, `desktop-on-full-context`).

**Zero product-code change.** `tsc` 0 · `npm test` 271/0 · `build` 0 ·
verifier 55/0 · flag-OFF 235,042 bytes and flag-ON 217,010 bytes, both identical
to the 6B session.

### Six findings — none fixed, per instruction

| # | Finding | Severity |
|---|---|---|
| **N-1** | **`Earlier history (7 more)` reveals NO events** — only "…continues below in the activity record", and that record was one of the three panels this surface replaced. **7 of 10 `change_ledger` rows are unreachable with the flag on, including `PARTNER_OVERRIDE` / `OVERRIDE_RECORDED` (the demo's §2 beat), `ROUTE_RECOMMENDATION_CHANGED` and `PURSUIT_CREATED`.** Verified by opening every `<details>` and probing text: "Route override", "partner override", "Partner-led", "Pursuit detected", "Recommended route" are all absent flag-ON and present flag-OFF. The override *decision* survives in the Route decision panel; the *chronology* does not. | **Promotion blocker** |
| **N-6** | The merge makes the left column 1,068px against a 475px neighbour → **593px void** beside the new panel just below the fold (48px imbalance before). "Outcome & attribution" is orphaned. This is why the desktop page did not get shorter (3,827 → 3,855px). | High — composition |
| N-2 | "3 more items of supporting context available." and "10 other unresolved items." are plain text — no link, no disclosure. | Medium |
| N-3 | All four evidence rows on this pursuit read `Verified`, so the five-state vocabulary is not observable on evidence rows here. Review a thinner pursuit too. | Medium — review coverage |
| N-4 | Pre-existing copy defects now in the panel's first three lines: "1 independent families" (`read-models/detail.ts:95`) and a semicolon-joined route fragment. Present in **both** states — not a slice regression. | Low |
| N-5 | Desktop page not shorter (+28px). Mobile −8.9%. | Informational |

Also corrected: the 6B mobile screenshots were **viewport-only** (`fullPage` was
set for desktop only), so they showed the hero, not the changed surface — which
is why both were byte-identical at 334,356 bytes. The GATE C captures use
`fullPage` at both widths. The 6B *overflow* claim is unaffected; it was measured
from `document.documentElement.scrollWidth`, not from the image.

Also confirmed: `#whynow` → `y` 532, `#evidence` → 745, `#activity` → 1,086 —
all three land on the right movement, so U-13 holds structurally. N-1 is about
the **content** the anchor promised, not the anchor.

## GATE C refinement (2026-09-12) — what changed

Two commits, deliberately split: **`1ed0105`** correctness, **`6c5b7a9`**
experience. Full measured record in `GATE-C-PRODUCT-REVIEW.md`
§ "GATE C REFINEMENT".

| # | Objective | Outcome |
|---|---|---|
| 1 | Earlier History blocker | **FIXED.** `whatChanged.earlier` carries the remaining memory entries and the disclosure renders them. Globex: **10 of 10** ledger rows reachable, override chronology included. `hiddenCount` is now *defined* as `earlier.length`, so count and content cannot drift again. |
| 2 | Desktop composition | **FIXED.** Surface spans both columns: 538×1,068 → **1,092×792**. Void beside it **593px → 0**; total desktop void 785px → 283px. Value case + Outcome & attribution now pair (`lg:order-3`), which also fixed the 6B orphan. |
| 3 | Title + deterministic copy | **DONE.** "This pursuit" → **"What matters now"**. Copy translated in the view-model from canonical *structure*, not prose. See **D-022**. |
| 4 | Supporting-evidence state language | **DONE.** Account rows read **"Verified on account"**; direct rows keep "Verified". Underlying state untouched, nothing written to `pursuit_facts`. Lifecycle block moved under the timing caveat and relabelled "Account lifecycle timing". |
| 5 | Needs attention | **DONE.** Still one primary by default; "10 other unresolved items." became a real disclosure carrying the ranked gaps, each with its own state chip. |

**Key code shapes now in place**

- `ContextChangeLine` = `{ id, changeType, text, meta, canonicalReason, at, materiality, byPerson }` — rendered words plus the ledger's own reason.
- `whatChanged.earlier` and `needsAttention.others` — the two lists that make the disclosures real.
- `stateLabelFor(state, origin)` — the only place a scope-qualified chip label is chosen.
- `changeCopy()` reads `afterState.role` / `assertion_state` and `beforeState.assertion_state`. When the payload is **withheld** (guest callers) it falls through to the canonical reason — a guest gets plainer copy, never an invented detail. Pinned by test.
- `PursuitContextNarrative` takes a `lifecycleSlot` node so the component owns placement while the route owns the data.

**Residual, all cosmetic** — R-1 "What changed" leaves its right half empty at
full width (keeping the chronology vertical is the right call, so this is a
composition question); R-2 283px void beside Value case (structural: an odd
number of half-width panels); R-3 mobile +50px, +0.7%, in exchange for two
working affordances. R-4 restates N-3: every evidence row on Globex is VERIFIED,
so the five-state vocabulary is only observable in Needs attention — **review a
thinner or staler pursuit to see it**.

## Preview isolation session (2026-09-12T14:30Z) — what happened

**No product code changed. No preview created. No hosted configuration touched.**
Documentation only, plus one accuracy correction to `STATUS.md`.

### Why it stopped

Every credential the two blockers need is absent here. Checked by variable
**name** only — no value was read, and none is recorded anywhere:

`VERCEL_TOKEN` · `VERCEL_API_TOKEN` · `VERCEL_OIDC_TOKEN` · `VERCEL_TEAM_ID` ·
`OPS_FINGERPRINT_TOKEN` · `SUPABASE_ACCESS_TOKEN` · `SUPABASE_SERVICE_ROLE_KEY` ·
`DATABASE_URL` · `BASIC_AUTH_*` — **all unset.** No Vercel CLI, no Supabase CLI,
no `~/.vercel` state. Only a GitHub token.

So Objective F fired: *do not create a preview connected to unknown or shared
writable data.* Nothing did.

### What was nevertheless established (new, verified)

| # | Finding | Why it matters |
|---|---|---|
| B-a | **`VERCEL_ENV` has no behavioural gate** — one hit in `src/`, in `buildInfo()`, reporting only | The app cannot tell Preview from Production at runtime |
| B-b | **`assertSyntheticDatabase` does not protect the demo DB** — it refuses only `is_synthetic=false`, and the demo DB is marked `is_synthetic=true`, so it **passes** | Its threat model is "operator reseeds production", not "preview writes to demo" |
| B-c | **22 files declare `"use server"`** | Real write paths; no read-only mode exists |
| B-d | **A Vercel build performs no DB access** — 47 routes compile `ƒ` (dynamic); the only prerendered route is `/icon.svg` | **Bounds the risk.** A preview nobody opens has touched nothing |
| B-e | **Zero deployment config in the repo** — no `vercel.json`, no `.vercelignore`, no `.github/` | Branch tracking and env scoping stay dashboard-only |

Together: the classification stays **UNKNOWN**, but if it turns out Preview
shares `DATABASE_URL`, **there is no application-layer mitigation.**

Seven avenues to the live serving SHA were attempted and all are closed —
`/api/build` 404 unauthenticated (3/3, verified), no deployment id in response
headers, `builtAt` server-only, Next build IDs random per build, CSS
fingerprinting already invalidated, GitHub MCP has no deployments endpoint, no
Vercel credential. Recorded in `ENVIRONMENT-MAP.md` §9 **so no future session
repeats the search.**

### Deliverables

- **`PREVIEW-ISOLATION-PLAN.md`** (new) — Objective C isolation design in the
  stated preference order (Option 2 recommended: 5 steps, 4 of them existing
  tooling, 1 additive Vercel env var), Objective D flag plan, Objective E
  continuous workflow, a 10-point validation checklist to run when isolation
  exists, and the one open question below.
- `ENVIRONMENT-MAP.md` §6 sharpened, new §9.
- `DEMO-PROMOTION-GATE.md` — GATE B and GATE C marked **PASSED**, with the
  caveat that **P-2 is still open**: the review happened on local synthetic
  renders, not on a hosted preview.

### One open question worth a dashboard glance

**Have Preview deployments already been built for `roadmap/pursuitos-vnext`?**
The branch took ~18 pushes this weekend. If the Vercel GitHub integration runs
with defaults, each produced a preview build against whatever `DATABASE_URL` the
Preview scope carries. Unverifiable from here. Bounded by B-d (a build touches
nothing), all `VNEXT_*` defaulting OFF, and Slice 1 being read-only — so the
plausible worst case is *reads* from an opened preview URL. One glance answers
it: **Vercel → `PursuitOS-demo` → Deployments, filter Preview.**

## vNext database initialization session (2026-09-14T02:16Z) — what happened

**No product code changed. No database was written to. No hosted configuration
was touched. The Monday demo project was never contacted.** Documentation only.

### What was asked, and how far it got

| Step | Outcome |
|---|---|
| Pre-flight — clean tree, HEAD/origin, read the four docs | **DONE.** Tree clean, `714433b`, 0 ahead / 0 behind `origin/roadmap/pursuitos-vnext`. Monday demo ref reconfirmed `qifatlqxfuhwrwvpbwsc` |
| `DEMO_TARGET_URL` presence check | **PRESENT.** Checked with `test -n` only. **The value was never read, printed, logged, or recorded anywhere** |
| Inspect `environment-identity.ts`, `seed-demo-world.ts`, `demo-db.ts`, `migrate.ts`, `demo-manifest.ts` | **DONE.** Exact invocations derived from the code — recorded in `ENVIRONMENT-MAP.md` §10 |
| **TARGET SAFETY GATE** | **PASSED on identity, FAILED on proof-of-marker.** Ref is `mejokqxriwyawfhawuxu` ≠ `qifatlqxfuhwrwvpbwsc`. But the database's own marker is **UNREADABLE** |
| Step 2 — mark synthetic | **NOT RUN.** The gate says: if identity cannot be proven, STOP |
| Step 3 — seed | **NOT RUN** |
| Steps 4-5 — verification | **NOT RUN** — nothing to verify |

### Why it stopped — proven, not inferred

This environment has **no Postgres egress at all**:

| Probe | Result |
|---|---|
| DNS `aws-0-ca-central-1.pooler.supabase.com` | resolves (`15.156.180.136`, `15.156.188.226`) |
| TCP **:5432** | TIMEOUT |
| TCP **:6543** | TIMEOUT |
| HTTPS `api.supabase.com` | `connect_rejected` — egress proxy, organization policy |

DNS resolving while both Postgres ports black-hole is a port policy, not a bad
credential — an auth failure returns a distinct error and none was ever reached.
**The credential was therefore never validated either way.** The network policy
is the environment's and was **not** worked around; two probes that would have
tunnelled around it were correctly denied and not retried.

### The finding worth carrying forward

**The canonical seed path has no HTTPS fallback.** `scripts/db-remote.ts` runs
SQL over the Supabase Management API "anywhere HTTPS works", but it executes
plain SQL files only and needs `SUPABASE_ACCESS_TOKEN` (unset here);
`scripts/generate-seed-sql.ts` emits only the knowledge-base ontology. The demo
world is built by ten TypeScript layer scripts calling application code over a
live `pg` pool. **Migrations could travel over HTTPS; the world cannot.** So the
vNext database must be initialized from a context with direct Postgres egress —
a laptop, a CI runner, or a cloud environment whose network policy permits 5432.

### And the trap that would have cost a session

`seed-demo-world.ts` orchestrates the layers by `execFileSync`, and the three
database variables are genuinely distinct: `demo-db.ts` reads `DEMO_TARGET_URL`,
the nine layer scripts read `DEMO_URL`, `verify()` reads `DEMO_URL ?? DATABASE_URL`.
Setting **only** `DEMO_TARGET_URL` would seed the hosted target at layer 1 and let
layers 2-10 silently fall back to `127.0.0.1:5433` — printing `ok` the whole way.
All three must name the same target. Recorded in `ENVIRONMENT-MAP.md` §10.

### Deliverables

- `ENVIRONMENT-MAP.md` — §3 row for the vNext isolated target, new **§10**
  (identity, egress evidence, the exact five-command sequence, the trap), risk #7.
- `STATUS.md` — new **vNext isolated database = BLOCKED** row.
- `PREVIEW-ISOLATION-PLAN.md` — Option 1 upgraded to PARTIALLY ANSWERED; the
  missing `migrate.ts` step added to Option 2.

## vNext database initialization, attempt 2 — LOCAL (2026-09-14T02:44Z)

**Run on the owner's Mac precisely because Claude Code Web has no Postgres
egress.** That worked. **No product code changed. No database was written to. No
hosted configuration was touched. The Monday demo project was never addressed.**

### What was asked, and how far it got

| Step | Outcome |
|---|---|
| Pre-flight — clean tree, branch, fetch, read the four docs | **DONE.** Clean, `roadmap/pursuitos-vnext` @ `072bd56`, 0 ahead / 0 behind origin. Both refs reconfirmed from the docs |
| `DEMO_TARGET_URL` presence check | **PRESENT.** Checked with a `-n` test only. **The value was never printed, logged, written to a file, or recorded anywhere** |
| Derive the required database variables **from the code, not the prompt** | **DONE — the docs' three are confirmed correct.** `migrate.ts` → `getPool()` → `DATABASE_URL`; `environment-identity.ts` → `getOwnerPool()`, which falls back to `getPool()` because `DATABASE_URL_OWNER` is unset, → `DATABASE_URL`; `demo-db.ts` → `DEMO_TARGET_URL`; the nine layer scripts → `DEMO_URL`; `seed-demo-world.ts` `verify()` and `demo-manifest.ts` → `DEMO_URL ?? DATABASE_URL`. So: **`DATABASE_URL`, `DEMO_TARGET_URL`, `DEMO_URL`** |
| **STEP 1 — connection + identity safety gate** | **PASSED on identity. FAILED on connection.** `scripts/environment-identity.ts` printed `target : project mejokqxriwyawfhawuxu` — the required ref, and **not** `qifatlqxfuhwrwvpbwsc` — then `CANNOT READ` |
| Steps 2-5 — migrate, mark synthetic, seed, reconcile | **NOT RUN.** The gate says: if identity cannot be proven, STOP without writing |

### Why it stopped — a credential, proven at three endpoints

| Probe (every one against `mejokqxriwyawfhawuxu`) | Result |
|---|---|
| Session pooler `:5432`, user `postgres.<ref>` | **`28P01` password authentication failed** |
| Transaction pooler `:6543`, user `postgres.<ref>` | **`28P01`** |
| Direct `db.<ref>.supabase.co:5432`, user `postgres` | **`28P01`** |

**This is a fact about the password, not about the network or the string.** All
three completed TCP and TLS and returned a *Postgres* error; the direct host does
not traverse Supavisor at all, so the pooled-username convention is not
implicated; and Supavisor answers `Tenant or user not found` for an unknown ref,
which it did not — the project resolved. The connection string's own structure
was cleared separately, **without reading it**: WHATWG `URL` and
`pg-connection-string` (the parser `pg` actually uses) agree on host, port, user
and database; the password round-trips byte-identically through both; and the
component lengths account for the whole string exactly, so nothing was truncated
at a `#` or `?`.

### What is now settled that was not before

- **Where this work runs is settled.** A laptop reaches the target fine. B-4 is
  a property of Claude Code Web, not of the task.
- **The three-variable trap was respected and is now confirmed from the code**,
  not from prior notes. Every command bound all three to the same value.
- **The gate is doing its job, twice over.** `environment-identity.ts --set`
  refuses an `unreadable` identity, and `assertSyntheticDatabase` refuses an
  unmarked or unreadable target. Neither was reached, because the read-only gate
  stopped first — which is the intended order.

### What was NOT done, deliberately

The demo project `qifatlqxfuhwrwvpbwsc` was **not contacted, queried, or
modified** — including not being queried to prove it was untouched. The proof is
by construction and is recorded below under *Monday demo zero-change*.

### Monday demo zero-change — the evidence

- Every command in this session bound `DATABASE_URL` / `DEMO_TARGET_URL` /
  `DEMO_URL` to one value, whose parsed identity is `postgres.mejokqxriwyawfhawuxu`
  @ `aws-0-ca-central-1.pooler.supabase.com`. The demo ref appears in **no**
  command, no variable, and no probe.
- The three raw probes named their host and user explicitly, all
  `mejokqxriwyawfhawuxu`. On Supabase the pooler hostname is regional and shared;
  **the project is selected by the ref in the username**, which was never the
  demo's.
- No `DATABASE_URL` was inherited: it was **unset** in this shell before the
  session, as were `DEMO_URL`, `DATABASE_URL_OWNER`, `DEMO_ADMIN_URL`,
  `DEMO_PGHOST`, `DEMO_PGPORT` and `DEMO_DB_NAME` — so no fallback existed
  either to the demo or to `127.0.0.1:5433`.
- **Zero writes were issued to any database.** The only statements executed were
  `select` in the identity read and `select current_user, current_database()` in
  the probe, and all of them failed at authentication before reaching a server-side
  query.
- No Vercel, Supabase dashboard, or DNS surface was touched.

### Send safety — verified by code and environment, nothing sent

- `externalSendingArmed()` (`src/lib/env/environment.ts:131`) returns
  `process.env.OUTREACH_AUTOSEND === "on"`, and **`OUTREACH_AUTOSEND` is unset**
  in this shell — so sending is disarmed by the invariant, not by convention.
- **`RESEND_API_KEY` is unset**, so `apiKey()` in `src/lib/comms/resend.ts`
  throws before any request is constructed; `send.ts:162` persists such a message
  as *failed* rather than sending it. **No real outreach provider credential is
  present, required, or used.**
- Nothing in this session executed a send path at all: the only code run was the
  read-only identity script and a raw `pg` probe.

## vNext database initialization, attempt 3 — LOCAL, COMPLETED (2026-09-14T02:59Z)

**The isolated vNext database is initialized, marked synthetic, seeded, and
reconciled exactly.** Run on the owner's Mac after the owner replaced
`DEMO_TARGET_URL` with a fresh credential. **No product code changed. No Vercel
surface touched. No feature flag changed. No deployment. No deferred defect
fixed. The Monday demo project was never addressed.**

| Step | Outcome |
|---|---|
| Pre-flight | Clean tree, `5ee1dfe`, 0 ahead / 0 behind origin; production branch still `97e975f0`. By name only: `DEMO_TARGET_URL` set; `DATABASE_URL`, `DEMO_URL`, `DATABASE_URL_OWNER`, `DEMO_ADMIN_URL`, `DEMO_PGHOST/PORT`, `DEMO_DB_NAME`, `OUTREACH_AUTOSEND`, `RESEND_API_KEY` unset. No `.env*` but `.env.example`; no local Postgres listener — so nothing to fall back to |
| **Gate** — ref / not-demo / auth | `postgres.mejokqxriwyawfhawuxu` @ the ca-central-1 session pooler; the demo ref appears nowhere in the string; **authenticated** (one transient `28P01` first — below) |
| Pre-write state | **Empty** — 0 `public` tables, no `schema_migrations`, no `environment_identity` |
| 1 · migrate | **102 applied, 0 already tracked**, exit 0 |
| 2 · mark | `environment="demo" is_synthetic=true label="pursuitos-vnext — isolated synthetic preview"` |
| 3 · read back | `demo` · `true` · established `2026-09-14T02:56:52Z` |
| 4 · seed | all three vars bound to the same target · **10/10 layers ok** · `verify()` **17/17** · "canonical demo world built and verified." · exit 0 |
| 5 · reconcile | **3 · 14 · 19 · 11 open · $8,040,000 · 14** (14/14 `DEMO`) — exact. Manifest digest **`be0da833990ce436`** = certified `audit/canonical-demo-world.json` |
| Final re-verify | project `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true` · sending unarmed |

### The transient `28P01`, and why it did not stop the session

The first raw probe failed `28P01`; the repository's own identity read, seconds
later with the same string, reached the database. **No write was issued while
the two disagreed.** The disagreement was resolved by evidence, not by retrying
until green: no `.env` redirect, no local listener, and `getPool()` passes
`DATABASE_URL` straight to `pg`, so both reads used the same string and host.
Then four consecutive raw probes and one through the app's TLS-verifying pool
all authenticated, as did every later command. The likely cause — the new
password not yet on every Supavisor node — is **unverified**, and recorded as
such in `ENVIRONMENT-MAP.md` §10.

### Send safety

`messages` 0 rows (0 outbound / queued / sent / with a provider id),
`email_events` 0, `sending_identities` 0. `OUTREACH_AUTOSEND` and
`RESEND_API_KEY` unset in the shell that ran every step, so
`externalSendingArmed()` is false and `apiKey()` throws before any request.

### Monday demo zero-change — by construction, not by contact

- Every command bound `DATABASE_URL` / `DEMO_TARGET_URL` / `DEMO_URL` to one
  value whose parsed user is `postgres.mejokqxriwyawfhawuxu`; on Supabase the
  pooler host is shared and **the project is selected by the ref in the
  username**. The demo ref occurs in no command, variable, or probe.
- No fallback existed: every other database variable was unset, no `.env` file
  supplies one, no local Postgres was listening.
- `qifatlqxfuhwrwvpbwsc` was **not contacted, queried, or modified** — including
  not to prove it was unchanged, per instruction.
- No Vercel, Supabase dashboard, DNS, or production-branch surface was touched.

### Secret handling

The value of `DEMO_TARGET_URL` was never printed, echoed, logged, persisted, or
documented. No `env`/`printenv`. Every command's output was piped through a
scratchpad filter that strips the URL and its password; **it never had to
redact anything.** No repository file contains it.

## Superseded next action — the Vercel Preview wiring (the owner reports the isolated Preview operational and certified, 2026-09-14; not re-verified in the Slice 2A session)

`PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 **step 5**. It is the first
change to hosted configuration in this whole effort, so it needs the owner's
explicit go-ahead.

1. **Read first (read-only, answers B-1 / §6):** Vercel → `PursuitOS-demo`
   (`prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc`) → Settings → Environment Variables →
   look at **which environments** the existing `DATABASE_URL` is scoped to.
   Do not reveal or edit its value.
2. **Add, don't edit:** a **new** `DATABASE_URL` entry, environment **Preview
   only**, Git branch **`roadmap/pursuitos-vnext`**, value = the isolated
   target's connection string (the one proven here), marked Sensitive. The
   existing Production (and any existing Preview) entry stays untouched.
3. On the same Preview + branch scope, the Objective D variables:
   `VNEXT_CONTEXT_HEALTH_ENABLED` · `VNEXT_PURSUIT_STATE_ENABLED` ·
   `VNEXT_PURSUIT_MEMORY_ENABLED` · `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` = `1`;
   `PURSUITS_ENABLED` · `FACTS_ENABLED` · `ROUTING_ENABLED` ·
   `PURSUIT_EXPERIENCE_ENABLED` · `FEDERATION_ENABLED` = `1`;
   `PURSUITOS_ENV` = `demo`; `OPS_FINGERPRINT_TOKEN` set.
   **Leave `OUTREACH_AUTOSEND` and `RESEND_API_KEY` absent.** No Production-scope
   change of any kind.
4. Redeploy the `roadmap/pursuitos-vnext` head (env binds at build time), then
   run V-1…V-10 — above all **V-4**: `/api/build` must report
   `database.projectRef = mejokqxriwyawfhawuxu`, not `qifatlqxfuhwrwvpbwsc`.

Open consideration, not decided here: serverless functions on the **session**
pooler (`:5432`) hold connections per instance; Supabase generally steers
serverless to the transaction pooler (`:6543`). Watch for connection exhaustion
on the first preview.

## Superseded next action — database password reset (DONE 2026-09-14T02:59Z)

**Reset the database password on `mejokqxriwyawfhawuxu` and re-run the sequence.**
Nothing else about it is unknown — not the commands, not the variables, not where
to run them. Only the credential is wrong.

1. Supabase dashboard → project **`mejokqxriwyawfhawuxu`** → Settings → Database
   → **Reset database password**. If that project turns out to be a Supabase
   *branch*, take the branch's own credentials — a parent-project password would
   fail exactly like this.
2. Re-export `DEMO_TARGET_URL` with the new password in the shell that will run
   the work, **locally, not in Claude Code Web** (B-4).
3. Run `ENVIRONMENT-MAP.md` §10 from step 0, unchanged. Step 0 is the proof: it
   must print `environment` and `is_synthetic` instead of `CANNOT READ`. Do not
   run step 2 (`--set demo`) until it does.
4. Reconcile against the canonical facts: 3 orgs · 14 companies · 19
   opportunities · 11 open · $8,040,000 · 14 pursuits.

Then, and only then, `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 step 5 (the
one additive Vercel env var, `DATABASE_URL` scoped to **Preview only**, pointing
at the isolated target) and Objective D's flag plan. **An isolated database does
not by itself isolate Preview.**

Still open and unchanged: the live serving SHA (`ENVIRONMENT-MAP.md` §9) and the
Vercel Preview `DATABASE_URL` classification (§6). Until both are resolved, the
local synthetic render loop remains the review mechanism; it produced every
GATE C measurement.

## Superseded next action (kept for context)

**A decision, not code: product sign-off on the refined surface.** — *Done.
Slice 1 is signed off.*

Slice 1 is functionally complete and at PREVIEW READY behind
`VNEXT_PURSUIT_INTELLIGENCE_ENABLED`. Nothing is deployed and the demo is
untouched. Screenshots for the sign-off are in
`docs/vnext/review/gate-c-refined/` (same filenames and dimensions as
`gate-c/`, for direct comparison).

Monday is unaffected: the flag defaults OFF, and flag-OFF was verified
**panel-for-panel identical** to the pre-refinement page — 11 panels at the same
x/w/y/h, 3,827px desktop, 7,870px mobile, anchors at 532/1,071/2,767.

### The next step is a decision, not code

**GATE C — product review.** Look at the rendered surface and answer one
question: *is Pursuit Detail now simpler to read, or merely differently
arranged?* If it is only differently arranged, the slice has not landed
(`ACCEPTANCE.md` U-9, D-003).

Screenshots from this session (local synthetic, Globex pursuit, flag ON and OFF,
1440×1000 and 390×844) are in the session scratchpad. Regenerate with:

```sh
# seed + serve locally, then screenshot — see "Local synthetic database" above
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo \
PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 PURSUIT_EXPERIENCE_ENABLED=1 \
FEDERATION_ENABLED=1 PURSUITOS_ENV=local VNEXT_PURSUIT_INTELLIGENCE_ENABLED=1 \
VNEXT_CONTEXT_HEALTH_ENABLED=1 VNEXT_PURSUIT_STATE_ENABLED=1 VNEXT_PURSUIT_MEMORY_ENABLED=1 \
npx next start -p 3106
```

### If GATE C passes — recommended chunk 7 scope

Three small corrections the rendered surface exposed, none of them new capability:

1. **The lifecycle/timing proximity.** `LifecycleBento` reads "Renewal verified
   … in 76d" directly beneath a narrative saying pursuit timing is unconfirmed.
   Both are true; the adjacency invites conflation. Smallest fix is a label
   clarifying the renewal is the *account's* lifecycle event.
2. **"Why this matters" appears twice** on the page with the flag on — as the
   narrative heading and as an inline label in `StakeholderPanel`. Rename one.
3. **`BUILD_VALUE_CASE` still does not lift economic facts** (they derive to
   `SUPPORTING_CONTEXT` with `refType` "fact"; matching on `family = 'economic'`
   would fix it). It did **not** harm the 6B experience — the economic facts
   surface anyway under account context — so it stays deferred.

### Do NOT do next

Next-best action, cross-pursuit prioritisation, Today/Pipeline changes, dynamic
surfaces, the synthetic PRODUCTION-lineage fix, or any deployment. Slice 2
begins only after GATE C.

---

## Run these first in the next session

```sh
# Locally: cd /Users/cgrigori/Documents/ActivateOS/pursuitos-vnext
# In Claude Code Web: cd /home/user/ActivateOS
# Hosted-database work must run LOCALLY — see B-4.

# 1. Confirm the lane and that nothing drifted.
git fetch --all --tags
git checkout roadmap/pursuitos-vnext
git log --oneline -11                     # newest: docs, 620bc12, 494d166, 1b05b8a, 20ee049, 9744335, 0f86079, a13c2fa, 77f72ef …
git status --porcelain                    # expect clean
git rev-parse origin/claude/activateos-platform-review-xzkgmd   # expect 97e975f0…  (unchanged)

# 2. Read the durable memory. Start here, not with the code.
cat docs/vnext/SESSION-HANDOFF.md
cat docs/vnext/STATUS.md
cat docs/vnext/DECISIONS.md               # D-016/017/018 explain the chunk 1–4 shape
sed -n '/^# AS-BUILT/,$p' docs/vnext/SLICE-1-LIVING-PURSUIT-CONTEXT.md

# 3. Re-establish the baseline before changing anything.
npm install
npx tsc --noEmit                          # expect exit 0
npm test                                  # expect 271/271

# 4. Re-establish the local synthetic DB before touching the loaders
#    (see "Local synthetic database" above — pgvector is required).
#    Then: npx tsx scripts/vnext-context-verify.ts   # expect 55/55
npm run build                             # expect exit 0
```

### Container-loss notes

This is a cloud sandbox and may disappear at any time.

- `node_modules` is **not** committed — `npm install` is always step one.
- The container may be **re-cloned mid-session** onto a stale branch. Always
  `git fetch --all --tags` and verify SHAs against `git ls-remote` rather than
  trusting the local checkout. This has already happened twice in this project.
- A local-only tag (`demo-safe-2026-09-12`) will be gone. Use
  `backup/2026-09-04/tds-live-demo` or the SHA `97e975f0`.
- Anything not pushed is lost. Commit and push early.

### Before you stop, next session

1. Update **this file**: date, branch, commit, files changed, tests run,
   completed work, in-progress work, exact next action, blockers.
2. Update `STATUS.md` for every capability you touched.
3. Append to `DECISIONS.md` any durable decision you made.
4. Append to the **AS-BUILT** section of `SLICE-1-LIVING-PURSUIT-CONTEXT.md` if
   the implementation diverged from the plan.
5. Commit and push.
