# PursuitOS vNext — Status

**Last updated:** 2026-09-15 (D-G8-2A — FIXED LOCALLY, NOT CONVERGED, NOT PUSHED; 7 open sites, 4 needing an owner decision; D-G8-2B deferred; D-G8-3A / D-G8-3B / D-P1 OPEN; Gate 9 not begun)

**2026-09-15 (latest) — D-G8-2A: FIXED LOCALLY / NOT CONVERGED / NOT PUSHED.**
- **The sweep:** tie-breaking only across the certified surface — every key appended was already in the query's scope; no filter, join, scope or business-ranking change. Six local commits (`ca7e279`, `bb4e484`, `5ac77ce`, `2a8b7ea`, `2211f75`, `aea55c9`), 28 files, +534 / −117.
- **Headlines:** Today's four unordered feeders and both DISTINCT ON picks; `next-best.ts` (cut to a limit on priority alone); the `todaySort` call site; `timeline.ts`, whose comparator never returned 0 — now the exported total `compareTimelineEvents`; the portfolio order and its account-group encounter order; `/pipeline`'s book, ecosystem, CRM tie-out, first-wins registration Map and both capped cuts; the mapping matrix's coverage feeder.
- **Evidence:** `ordering-determinism` red **32/11 → 43/0**, byte-identical over 5 plans × 2 heaps × owner/`app_rw`; negative controls for all seven classes; `tsc` clean; `npm test` **386/386**; build OK; **`certify-world --runs 2` 82 clean / 0 failures**, digest `e98b43254f98d5ec` unchanged, no drift; rehearsal **38/38** + 6/6 consent under both roles, no residue.
- **A flaky certification, root-caused — and it was the harness, not the fix.** Three old-clause negative controls asserted that the planner *must* misbehave, which depends on physical layout, not on the code. Now a deterministic tie-existence check with the variation count kept as a diagnostic.
- **SCOPE EXCEEDED APPROVAL:** 51 sites / 25 files were approved; 83 constructs + 24 + 10 were delivered across 28 files, three of them off the approved list. Each was a one-line tie-break meeting the stated criterion, but the size is an owner call. Nothing is pushed.
- **NOT CONVERGED:** three audit rounds found 24 → 6 → 7. **7 sites remain open**, 4 of which need an owner decision (a provenance tie in `projection.ts:87`; a business-semantics defect at `intelligence.ts:384` where an arbitrary label's median prints as *the* median; a **persisted** campaign seed identity at `multi-vendor.ts:202`, which is the deferred D-G8-3A class; and a column-order choice at `mapping/page.tsx:843`).
- **Open:** D-G8-2B deferred; **D-G8-3A, D-G8-3B and D-P1 remain OPEN** pre-Gate-9.

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-2A determinism hardening". **Gate 9 NOT begun.**

**2026-09-15 (latest) — D-G8-1: HOSTED ACCEPTED / CLOSED.**
- **The deployment:** `dcde3b6` auto-deployed as `dpl_7KsA9ssaPHwUxiZcQW8LWXAAe6Pe` (Preview, READY, the alias target). `/api/build` reports `app_rw` / false / true / live; sending off; env unchanged.
- **The crawls:** two full signed-in crawls (4 passes), byte-identical, all 37 rooms 200.
- **The stakeholder order:** on the one multi-stakeholder deal, "Legacy virtualization exit", Postgres derives the order **Dana Whitfield → Mike Rivera → Priya Shah → Sarah Kim** from the rule, and every pass renders it. Against the Gate 8 Phase 2 crawl, the only difference is Priya's and Sarah's rows trading places, each with its own badge.
- **Unchanged:** D-G5-1 order and the CDW label.
- **Database:** 40/0; CFR-1.1 5/0.

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-1 hosted acceptance". **Gate 9 NOT begun.**

**2026-09-15 — D-G8-1: FIXED LOCALLY** (hosted-accepted above).
- **The fix:** the `/pipeline` stakeholder query (`page.tsx:169`) had no ORDER BY, so the owner rendered Sarah Kim first and `app_rw` Dana Whitfield. It now orders by `s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id`: the displayed label, then the primary key. There is no business ranking, and no filter, join or scope change.
- **Tests:**
  - static guard: red 4/5 → 5/5;
  - `ordering-determinism` D-G8-1 section: tie fixture, query read from `page.tsx`, 5 plans × 2 heaps × owner/`app_rw`; red 20/3 → **23/0**, byte-identical;
  - rehearsal with a stakeholder tie fixture: **38/38**, documented order under both roles.
- **Regression:** `tsc` clean; `npm test` 377/377; build OK; **`certify-world --runs 2`: 82/82 clean, 3,600 assertions**; digest `e98b43254f98d5ec` throughout; 0 send rows.
- **Audit:** the ordering audit recorded latent category-C candidates as **D-G8-2**. None were observed in hosted crawls; not fixed; the owner decides before Gate 9.
- **Open:** D-P1 stays OPEN. **Not pushed** (a push auto-deploys).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G8-1". **Gate 9 NOT begun.**

**2026-09-15 — H1B GATE 8: PASS** (Phase 2, restoring `app_rw`: PASS).
- **The restoration:** a value-only update of the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) from the owner to `app_rw`, built in memory and probed first. Only its `updatedAt` changed; `DATABASE_URL_OWNER` is untouched.
- **The deployment:** `dpl_7UEXPHAU63VqEAuDZja4Ba99iEtu` (`5adeebe`). `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / probe live, sending off.
- **Owner paths:** identical.
- **Crawls:** two full crawls, identical to each other; against the Gate 7 `app_rw` crawl, only the 29 Phase 1-validated clock lines differ (deal ages recomputed from source). **D-G8-1: Dana Whitfield first again, matching Gate 7.**
- **Isolation smoke:** 0 tenant rows with no context; Vertex counts equal the owner-scoped counts; the Meridian pursuit is hidden, and 404 through the Preview; no context leak; 3 live `app_rw` backends.
- **Database:** 40/0 pre and post; CFR-1.1 5/0.
- **Env:** equals the Gate 7 `app_rw` record apart from `updatedAt`. Sending is off; Production is untouched.
- **Open:** D-G8-1 (stakeholder ORDER BY) and D-P1 (`?timeframe=` overwrite) — both **must be fixed before Gate 9**.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 8 Phase 2". **Gate 9 NOT begun.**

**2026-09-15 — H1B GATE 8 PHASE 1: PASS, with one recorded pre-existing deviation (D-G8-1)** (the rollback to the owner, since restored).
- **CFR-1.1 adopted:** `days_since_activity` is validated by recomputation from its source `updated_at`; everything else stays strict.
- **The rollback:** a value-only update of the branch Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) to the owner connection. The metadata delta is that entry's `updatedAt` only; `DATABASE_URL_OWNER` is untouched.
- **The deployment:** `dpl_B2wmS3WW1eGeugYnsiWwr6WHsj8H` (`5adeebe`, Preview). `/api/build` reports **`postgres` / bypassRls true / tenantEnforcement false / probe live**, sending off: the expected emergency posture.
- **Owner paths:** identical.
- **Crawls:** two full crawls, identical to each other; D-G5-1 order and the CDW label unchanged. Against the Gate 7 `app_rw` crawl, 29 lines are time-derived +1-day text (the 21:02Z rollover) and 2 lines are the **D-G8-1** swap: the `/pipeline` stakeholder query has no ORDER BY, so Sarah Kim comes first under the owner in every owner crawl and Dana Whitfield first under `app_rw` in every `app_rw` crawl. It is order only and pre-existing.
- **Database:** 40/0 pre and post, every per-table fingerprint identical; CFR-1.1 5/0 pre and post; hero source timestamps unchanged.
- **Production:** untouched.
- **Docs:** committed locally and **not pushed**, so the paused owner state is not redeployed.

Record: `H1-PRE-PILOT-HARDENING.md` § "CFR-1.1" and § "Gate 8 Phase 1". **Phase 2 NOT begun.**

**2026-09-15 — H1B GATE 7: PASS** (final; closed). On `84c09e4` (docs-only over `1c4fb5e`) on the `app_rw` Preview; read-only or rolled back throughout.
- **(i) RLS:** the exact-RLS probe as the real `app_rw` pooler login gives **80/0**.
  - 0 tenant rows with no context.
  - Exact authorized visibility for Vertex, Meridian and TD SYNNEX on all 155 tables.
  - Foreign rows hidden on all 81 org-scoped tables.
  - No pooled-context leak; cross-org writes and escalation refused.
  - `search-path` 12/0.
- **(ii) Crawl:** 37 rooms identical in order to the accepted D-G5-1 crawl; owner paths intact.
- **(iii) Supplemental owner-backed suites:** `vnext-context` 62/0 and `today-tenant` 51/0. `demo-team`, `vnext-attention` and `vnext-coordination` hit hosted-data harness limitations: the kept Slice 2A/2B acceptance history; `vnext-attention`'s tenant sections pass 11/0. The world is unchanged after each suite.
- **(iv) Blind test, an accepted substitution:** the Meridian pursuit fetched through the Preview as Vertex is 404, identical to a nonexistent id.
- **(v) Handshakes:** `partnership-app-rw` on hosted as `app_rw`, in one rolled-back transaction, gives **117/0**, equal to the local baseline.
- **(vi) Owner human review:** PASS.
- **DB (CFR-1):** 0 of 155 tables changed in every snapshot. Env unchanged. Sending off.
- **Open:** D-P1 stays OPEN (before Gate 9).

**Closeout note:** after publishing, the hosted manifest digest read `14e2e97f8453fb75`, not `db1f78f7a11bbacb`, **with no data change**: all 155 per-table fingerprints and the business-data / whole-world fingerprints are identical. `demo-manifest.ts`'s `days_since_activity` is clock-relative, and all 21 values ticked +1 at 21:02Z. Gate 7 PASS stands. **CFR-1.1** (normalise `days_since_activity` in the hosted manifest comparison) is proposed for an owner decision before Gate 8.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 7" and § "Gate 7 closeout note". **Gate 8 NOT begun.**

**2026-09-15 — D-G5-1: HOSTED ACCEPTED / CLOSED.**
- **The deploy:** the owner-approved push of `1c4fb5e` auto-deployed `dpl_CZ4iZ5S4q3c4ZLL1cLfddHqTfsC2` (Preview, READY, the branch alias target). Its `/api/build` reports `app_rw` / bypassRls false / tenantEnforcement true / probe live / sending unarmed.
- **Crawls:** two full signed-in 37-room crawls (4 passes) are **identical room for room**, in order. Owner paths are intact through `DATABASE_URL_OWNER`.
- **Exact D-G5-1 results, the same in every pass:**
  - Today View All "stage vs engagement": **Datacenter exit — phase 1 → Kubernetes managed services → Core banking resilience → Legacy virtualization exit**;
  - Today and the drawer show its exact prefix;
  - `/pipeline` CDW label: **"CDW customer book"**.
- **Also changed:** the Globex account timeline's list label ("Account is on …") now reads "CDW customer book". It is the same tied list pair on a second consumer, now consistent with `/pipeline`; disclosed, not a regression.
- **Database (CFR-1 strict):** 0 of 155 tables changed; posture unchanged.
- **Env:** metadata unchanged. Sending is off.
- **D-P1:** stays OPEN (must fix before Gate 9 / a real pilot).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1 hosted acceptance". **Gate 7 NOT begun.**

**2026-09-15 — D-G5-1: FIXED LOCALLY** (then hosted-accepted, above).
- **The fix:** deterministic tiebreakers, appended after every existing ranking key.
  - `divergence.ts` "stage vs engagement" had no ORDER BY at all; it is now `o.updated_at asc, o.id asc`.
  - The 4 sibling capped rules in the same function each get a final unique key.
  - `projection.ts` list attribution is now `ap.created_at, ap.name, ap.id`.
- **Tests:**
  - new static guard: red 0/4 before the fix, green 4/4 after;
  - new DB suite `ordering-determinism` (SEEDED_CLONE): red 9/8 before (the payloads varied with the plan under both roles), green 17/0 after. It shows byte-identical ordered payloads across 5 planner configurations × 2 heap layouts × owner/`app_rw`, with eligibility unchanged.
- **Page level:** `app-rw-rehearsal` with the tie fixture gives **38/38 rooms line-identical** owner vs `app_rw` (Today, drawer, View All, `/pipeline` included).
- **Regression:** `tsc` clean; `npm test` 376/376; build OK; **`certify-world --runs 2`: 82/82 clean, 3,588 assertions, 0 failures**, canonical digest `e98b43254f98d5ec` throughout; 0 send rows.
- **Not pushed:** a push auto-deploys the branch Preview. **D-P1 unchanged** (it must be fixed before Gate 9 / a real pilot).

Record: `H1-PRE-PILOT-HARDENING.md` § "D-G5-1". **Gate 7 NOT begun.**

**2026-09-15 — H1B GATE 6: PASS (read-only).**
- **Serving:** `dpl_JD8DtC8HjgKSYtvnR2cF7AmyUwYC`, commit `766cb13`. It is docs-only over the Gate 5 code (no non-doc diff since `89b8c95`) and is the branch alias target.
- **Live `/api/build`:** demo · Private demo · `preview` · `roadmap/pursuitos-vnext` · ref `mejokqxriwyawfhawuxu` · **`app_rw` · bypassRls false · tenantEnforcement true · probe live** · commit matches the deployment · sending unarmed.
- **The probe is real:** it queries `current_user`, `rolsuper`, `rolbypassrls` and `row_security` on the running `getPool()`. It fails closed to `unavailable` with nulls.
- **Routing:** normal `getPool()` → `app_rw`, with `withTenant` setting `app.org_id` transaction-locally. `getOwnerPool()` → `postgres`, used only by login, join, admin, ops, research and the webhook.
- **Smoke:** 9 signed-in rooms all return 200. Owner paths are identical.
- **DB (CFR-1 strict):** 0 of 155 tables changed; all posture values unchanged.
- **Env:** metadata identical to Gate 5. Sending is off.
- **Open defects:** D-G5-1 must be fixed **before Gate 7**; D-P1 blocks **Gate 9 / pilot**.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 6". **Gate 7 NOT begun.**

**2026-09-15 — H1B GATE 5: PASS.** The normal vNext Preview runtime now runs as **`app_rw`**.
- **The change:** exactly one Vercel mutation. The branch-scoped Preview `DATABASE_URL` (`m6TuSKisz54kJlsD`) received the `app_rw` pooler string by value-only PATCH; its metadata delta is `updatedAt` only. `DATABASE_URL_OWNER` is untouched and still the owner. Production is untouched.
- **The deployment:** `dpl_6TmAg49o7CZcsbAjmhQR1mSvQFkY` (`0570a4c`), redeployed from `dpl_5xGwSWwy…`.
- **`/api/build`:** role `app_rw` · bypassRls false · tenantEnforcement true · probe live · sending unarmed.
- **Auth and owner paths:** identical, including admin members reading `auth.users` through the owner pool.
- **Live evidence:** 3 `app_rw` backends are serving traffic, and tenant rooms render Vertex data, which requires `withTenant` to have set `app.org_id`.
- **Crawl:** all 37 rooms 200. 33 are line-identical; 4 show order-only differences (Today ×3, `/pipeline` list label). The cause is pre-existing untied ORDER BYs; the row sets are proven equal under both roles (**D-G5-1, must resolve before Gate 7**).
- **Database (CFR-1, strict):** 0 of 155 tables changed; business-data `c9623fb5abe2f9bc` and whole-world `dce27935d88743fb` stable; 0 send rows.
- **Rollback:** ready, not rehearsed (Gate 8).
- `?timeframe=` snapshot defect **D-P1** (must resolve before Gate 9 / a real pilot); not used.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 5". **Gate 6 NOT begun.**

**2026-09-15 — H1B GATE 4: PASS AFTER DOCUMENTED RE-BASELINE.** Owner decision: re-baseline (option a). The three render-created rows stay; they are not deleted.
- **The three rows:** Vertex `routines` `morning_brief` and `account_digest` (disabled, no runs), plus the Vertex `pipeline_snapshots` row for 2026-09-15. The Gate 4 BEFORE crawl wrote them through the normal `DATABASE_URL` pool, before `DATABASE_URL_OWNER` existed.
- **Stability proof:** snapshot → a second full signed-in crawl (37 rooms × 2) → snapshot, all on the same UTC day. **0 tables changed**; the fingerprints stayed at business-data `c9623fb5abe2f9bc` / whole-world `dce27935d88743fb`; 41/0.
  - The `routines` rows are byte-identical and were not rewritten (xmin unchanged).
  - The same-day `pipeline_snapshots` row is rewritten with identical values.
- **Baseline of record:** migrations 105, manifest `db1f78f7a11bbacb`, business-data `c9623fb5abe2f9bc`, whole-world `dce27935d88743fb`, security hash `30772757ebd4688c`, `app_rw` LOGIN true / BYPASSRLS false.
- **CFR-1:** the manifest and every per-table fingerprint stay strict. There is a narrow, semantically validated allowance for a new `pipeline_snapshots` row on a later UTC date, and for first-render `routines` catalog defaults for an org with none. Any other delta fails.
- **Posture:** `DATABASE_URL_OWNER` is on Preview + `roadmap/pursuitos-vnext` only; `DATABASE_URL` is unchanged; `/api/build` reports `postgres` / bypassRls true / tenantEnforcement false; sending is off.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 4" and § "Gate 4 close-out". **Gate 5 NOT begun.**

**2026-09-15 — H1B GATE 4 (as first run): CHANGE APPLIED AND VERIFIED · ONE CRITERION NOT MET · AWAITING OWNER DECISION** (resolved above by re-baseline).
- **The change:** `DATABASE_URL_OWNER` was added to `pursuitos-demo`, **Preview, branch `roadmap/pursuitos-vnext` only**, through stdin. The env metadata diff shows +1 and nothing else; both `DATABASE_URL` entries are identical. No other project or target was touched.
- **The redeploy:** `dpl_4WcVaMZ4jRwzuAppkcdqb5wDCmmn` (`89b8c95`, Preview, READY). Production is unchanged.
- **`/api/build` before and after:** `postgres`, bypassRls true, tenantEnforcement false, ref `mejokqxriwyawfhawuxu`, sending unarmed. **The normal runtime is still `postgres`.**
- **Owner-only paths** (login, join loader, admin members via `auth.users`, ops role) are identical before and after, now served through the separate owner pool. The webhook (503, secret unset) and research (401, closed) are unchanged.
- **Signed-in crawl:** 37 / 37 rooms equivalent before and after, covering Today, Queue, Pursuit Detail, Pipeline, the partnership and joint rooms, and Admin.
- **Database, read-only:** migrations 105, manifest `db1f78f7a11bbacb`, security hash, `app_rw` (LOGIN true, BYPASSRLS false), 31 protected / 0 unsafe and 0 send rows are all unchanged.
- **Not met:** the business-data fingerprint moved `79321d9130d1dc94` → `c9623fb5abe2f9bc`, and the whole-world fingerprint `de05e204801988d1` → `dce27935d88743fb`. The **BEFORE crawl itself caused it, on the pre-change deployment:** `/routines` seeded 2 disabled catalog rows and `/pipeline` wrote today's snapshot row, both through the normal `DATABASE_URL` pool. It is not caused by the variable, so no rollback; the variable stays in place.
- **Owner decision:** (a) re-baseline (recommended), or (b) an approved delete of those 3 rows.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 4". **Gate 5 NOT begun.**

**2026-09-15 — H1B GATE 3: PASS.** This was a probe on the isolated vNext database `mejokqxriwyawfhawuxu`, with no hosted mutation: every `app_rw` transaction was rolled back, and the owner was read-only.
- **Login:** `app_rw.mejokqxriwyawfhawuxu` logs in through the transaction pooler `aws-0-ca-central-1.pooler.supabase.com:6543`, using SCRAM, with the password held in memory and never printed or stored. From the connection itself: `current_user = session_user = app_rw`, BYPASSRLS false, not superuser, member of no role, `row_security` on.
- **Method:** the catalogue-driven check compares `app_rw`'s RLS-filtered read of all 155 tables with the owner's evaluation of each table's own policies, on count plus content hash. It is exact for no context and for the Vertex, Meridian and TD SYNNEX contexts.
  - **No context:** 0 tenant-owned rows. Only the 5 designed org-less team-requirement rows and the 29 global reference tables are visible.
  - **Vertex:** counts equal the owner's explicitly Vertex-scoped counts (opportunities 19, contacts 5, pursuits 13, motions 7, stakeholders via parent 5).
  - **Foreign rows:** hidden on all 81 `org_id` tables.
- **Context leak test:** no context → Vertex (ROLLBACK and COMMIT) → no context → Meridian → no context → TD SYNNEX → no context, plus a second fresh client. Every transaction began with no context, and all 10 ran on the **same pooled backend**. **No leak.**
- **Foreign writes on `pursuits`:** foreign UPDATE and DELETE → 0 rows; an INSERT or re-home into another org → 42501; an own-org same-value UPDATE → 1 row. Everything was rolled back.
- **Escalation:** `SET ROLE` to `postgres`, `service_role`, `supabase_admin` and the rest → all refused (42501).
- **Boundary:** `--catalogue-only` gives 12 / 0 pre and post (31 protected, 0 unsafe).
- **Zero residue:** manifest `db1f78f7a11bbacb`, business-data fingerprint `79321d9130d1dc94`, whole-world fingerprint `de05e204801988d1` and every per-table hash are unchanged. No `app_rw`-owned object, no prepared transaction, 0 send rows.
- **Nothing in Vercel changed — Gate 4 NOT begun.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 3". **Next:** Gate 4, which adds `DATABASE_URL_OWNER` to the Vercel Preview and is owner-approved separately.

**2026-09-15 — H1B GATE 2: PASS.** On the isolated vNext database `mejokqxriwyawfhawuxu` **only**, the one approved mutation was run: semantically `ALTER ROLE app_rw WITH LOGIN PASSWORD <operator secret>`.
- All 13 pre-mutation checks passed (32 / 0), with zero delta against the Gate 1b.1 record: target identity; demo / synthetic; migrations 105, latest 0105; manifest `db1f78f7a11bbacb`; business-data fingerprint `79321d9130d1dc94`; whole-world fingerprint `de05e204801988d1`; `app_rw` LOGIN false and BYPASSRLS false; 0 unsafe protected functions; no runtime CREATE on `public`; sending unarmed.
- The secret was checked by presence only. It was hashed in-process to a SCRAM-SHA-256 verifier and applied through a bound parameter, so the plaintext never reached the server, its logs or any file (0 occurrences in a 323-file scan). The mechanism was proven first on a disposable local PostgreSQL 17 with SCRAM host auth.
- The exact role delta: **`rolcanlogin` false → true**, plus the credential. SUPERUSER, BYPASSRLS, NOINHERIT, CREATEROLE, CREATEDB, REPLICATION, connection limit, expiry and memberships are unchanged, and no other role changed (post-check 45 / 0).
- Catalogue, search path (31 / 31 hardened, 0 unsafe; `--catalogue-only` 12 / 0), policies, grants, triggers, manifest, both fingerprints, business counts and partnership data are all **unchanged**. There are 0 send rows.
- The rollback `ALTER ROLE app_rw NOLOGIN` is ready and not executed; it keeps the credential.
- **`app_rw` has not connected — Gate 3 NOT begun.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 2 (re-run)". **Next (done — see Gate 3 above):** Gate 3, the pooler login proof, which is owner-approved separately.

**2026-09-15 — H1B GATE 1b.1: PASS.** Migration `0105_h1b01_temp_schema_hardening.sql` was applied to the isolated vNext database `mejokqxriwyawfhawuxu` **only**, as the one approved mutation, through `scripts/migrate.ts` in a single transaction.
- All 12 pre-mutation checks passed: target identity; demo / synthetic; migrations 104, latest 0104, only 0105 pending; manifest `db1f78f7a11bbacb`; business-data fingerprint `79321d9130d1dc94`; whole-world fingerprint `0288ae73bb385a1c`; `app_rw` LOGIN false with no credential; sending unarmed.
- Migrations 104 → **105** (latest 0105, nothing pending). Manifest `db1f78f7a11bbacb` and business-data fingerprint `79321d9130d1dc94` **unchanged**; business row counts unchanged. The whole-world fingerprint moves `0288ae73bb385a1c` → **`de05e204801988d1`**, and only the `schema_migrations` tracker changed.
- **31 / 31 hardened, 0 unsafe**, derived from the hosted catalogue: 30 functions `pg_catalog, public, pg_temp`, and `app_current_org()` `pg_catalog, pg_temp`. `search-path-verify --catalogue-only` (read-only, hosted-safe) gives 12/0.
- The security-object delta is exactly one tracker row plus `proconfig` on the 31 protected functions. Bodies, owners, EXECUTE grants, definer posture, RLS / FORCE, policies, table and column grants, triggers, roles and memberships are all identical. No CREATE on `public` for any runtime role.
- Partnership data is unchanged, and there are 0 send rows.
- **`app_rw` is still NOLOGIN — Gate 2 NOT performed.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 1b.1". **Next (done — see Gate 2 above):** the Gate 2 re-run, with `APP_RW_PASSWORD` loaded via hidden input in the launching shell.

**2026-09-15 — H1B-0.1 COMPLETE (local): temporary-schema shadowing closed by migration 0105 (not applied to hosted). Gate 2 remains BLOCKED / NOT EXECUTED.**

The owner decision (D-050) is that temporary-schema shadowing is **not** accepted as residual risk for the `app_rw` boundary.

**Migration `0105_h1b01_temp_schema_hardening.sql`:**
- It pins `search_path = pg_catalog, public, pg_temp` on **31** authorization-sensitive functions (`app_current_org`: `pg_catalog, pg_temp`).
- The protected class was derived from the catalogue: every SECURITY DEFINER function, every function an RLS policy calls, and every trigger function. That found 4 more than the known 27: `app_current_org`, `enforce_verified_evidence`, `economic_fact_assertion_guard` and `stakeholder_assertion_guard`.
- No body, owner, grant or data change.

**Proof:**
- `search-path` **39/0**, as the real `app_rw` login:
  - negative control: 0105's own rollback restores the vulnerable posture, the guard flags 31/31, and all 11 exploits succeed;
  - after 0105: 0 unsafe functions, all 11 exploits fail, the guard catches reintroduction, and the CREATE-on-public and definer EXECUTE assumptions hold.
- Static migration lint in `npm test`.
- `partnership-app-rw` **117/0**.
- Rehearsal: `app-rw-rehearsal` after 0105: **38 / 38 rooms identical** under `app_rw` and the owner (Today, Queue, Pursuit Detail — Slice 1 / 2A / 2B — every partnership room); consent fixture **6 / 6** rendered under both; `/api/build` posture truthful — owner `postgres` / `bypassRls: true` / `tenantEnforcement: false`, app_rw `app_rw` / `false` / `true`.
- Certification: `certify-world --runs 2` **80 / 80 suite runs clean** (40 suites incl. `search-path` 39/0 and `partnership-app-rw` 117/0; 3,554 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.
- Canonical world unchanged: `e98b43254f98d5ec` / `be0da833990ce436`.

**Next (done — see Gate 1b.1 above):** Gate 1b.1 (owner-approved), which applies 0105 to `mejokqxriwyawfhawuxu`. Then the Gate 2 re-run with the secret loaded.

**2026-09-15 — H1B GATE 2: BLOCKED AT PRECHECK, NOT EXECUTED. `app_rw` is still NOLOGIN; no hosted change.**

All 8 identity and data prechecks passed: `mejokqxriwyawfhawuxu` · `demo`/synthetic · 104 migrations with 0104 latest · manifest `db1f78f7a11bbacb` · business-data fingerprint `79321d9130d1dc94` · LOGIN false. Nobody but the owner can CREATE in `public`.

**Blocker 1: the operator secret is not loaded.** `APP_RW_PASSWORD` is absent; no password was generated.

**Blocker 2: SECURITY DEFINER name resolution is shadowable through `pg_temp`.**
- PUBLIC has `TEMPORARY`, and PostgreSQL searches `pg_temp` first for tables unless it is listed.
- Proven locally as `app_rw`: a non-party's temp `partnerships` table let it read another org's settlement rows (0 → 2) and write a broker line.
- A pinned `search_path = pg_catalog, public, pg_temp` blocks it (proven locally).
- It affects 27 hosted functions: 0104's 18, 8 pre-existing RLS helpers, and the guard.

**Recommended:** hardening migration 0105 (search_path only, no data change), certified locally and applied as its own approved step, before a Gate 2 re-run with the secret loaded.

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 2 — PRECHECK BLOCKED".

**2026-09-15 — H1B GATE 1b: PASS.** Migration `0104_h1b0_consent_scoped_access.sql` was applied to the isolated vNext database `mejokqxriwyawfhawuxu` **only**, as the one approved mutation, through the repo runner in a single transaction.

**Before:** read-only; identity, `demo`/synthetic, 103 migrations with exactly `{0104}` pending, manifest `db1f78f7a11bbacb`, fingerprint `2678f34d4fc7b0a2`, sending unarmed.

**After:** read-only.
- 104 migrations, latest 0104.
- Manifest `db1f78f7a11bbacb` unchanged. The whole-world fingerprint is now `0288ae73bb385a1c`; `schema_migrations` is the only table whose hash changed, and business data is identical.
- Exactly 19 functions, 8 guard triggers and 4 policy changes appeared, identical to the locally certified catalogue. No RLS, grant, role or membership change.
- All definer functions are owned by `postgres` with a pinned `search_path`. No PUBLIC, anon, authenticated or service_role EXECUTE; `app_rw` can execute exactly the 14 runtime functions.
- Partnership and send state are unchanged.
- **`app_rw` is still NOLOGIN — Gate 2 NOT performed.**

Record: `H1-PRE-PILOT-HARDENING.md` § "Gate 1b".

**2026-09-15 — H1B-0 COMPLETE (local). Gate 5 is no longer blocked by partnership / consent behaviour; Gate 1b needs approval.**

Record: `H1-PRE-PILOT-HARDENING.md` § H1B-0; D-049; migration `0104_h1b0_consent_scoped_access.sql` (**not applied to any hosted database**).

- **Partnership flows now work under `app_rw`.** Consent-scoped SECURITY DEFINER functions, one per consent object, return only authorised columns. There is no broad cross-tenant policy.
- **Consent rows cannot be forged.** An `app_rw`-only guard trigger on eight consent tables prevents it.
- **Audit is now truly best-effort.** It goes through a validated function under a savepoint, so an audit write can never abort the business action.
- **Invite redemption** goes through a narrow function that acts only on the presented code.
- **`/api/build`** reports `database.role`, `database.bypassRls` and `database.tenantEnforcement` live.

**Proof:**
- `partnership-app-rw` **117/0**, as the real `app_rw` login. A guard-dropped negative control fails as expected.
- `app-rw-rehearsal`: **38/38 rooms identical**; consent fixture **6/6** rendered under both roles; posture correct under both.
- Certification: `certify-world --runs 2` **78 / 78 suite runs clean** (39 suites incl. `partnership-app-rw`; 3,476 assertions, 0 failures); canonical digest `e98b43254f98d5ec` before run 1, after run 1 and after run 2 — CERTIFICATION INTEGRITY: PASS; manifest `be0da833990ce436` unchanged; 0 send rows.

**Gate 1 (2026-09-15T02:40Z) — PASS AFTER DOCUMENTED RE-BASELINE.** The owner chose re-baseline, not reseed. The hosted baseline of record is manifest `db1f78f7a11bbacb` and fingerprint `2678f34d4fc7b0a2`, intentional Slice 2A/2B acceptance residue. Every other Gate 1 criterion passed as run. Gate 1b is not begun.

**2026-09-14 — H1B BASELINE: COMPLETELY GREEN.** `certify-world --runs 2` gives **76/76 suite runs clean**: 3,242 assertions, 0 failures. The canonical digest is `e98b43254f98d5ec` before run 1, after run 1 and after run 2, and the manifest `be0da833990ce436` is unchanged.

The last failure (`motion-intel`, pre-existing) was a verifier fixture gap, fixed in the verifier (D-047): it had borrowed a linked motion that another suite committed.

**H1B readiness review** (D-048; nothing executed):
- 1 **MUST_RESOLVE_BEFORE_CUTOVER**, proven empirically as `app_rw`: cross-tenant consent flows. Counterpart audit writes abort every partnership handshake, and consented shared reads lose the counterpart's data.
- 2 **SAFE_TO_VALIDATE_DURING_H1B**: stored digests (Gate 1) and the pooler login (Gate 3).
- 2 **POST_CUTOVER**: global learning tables, and inbound subject matching.

Nine gates are defined, each hosted mutation separately approved, with local work item H1B-0 first. **Gate 1 (read-only preflight) may begin; Gate 5 may not until H1B-0 is done.**

**Earlier the same day — H1A COMPLETE (local). H1B is design only, and H1 is NOT complete until H1B passes hosted certification.** Record: `H1-PRE-PILOT-HARDENING.md`, decisions D-043…D-046.

**Slices.** Slice 1, Slice 2A and **Slice 2B are DEMO CERTIFIED / FROZEN**; Slice 2B passed hosted human review. One account may contain multiple independent pursuits: Today composes one card per PURSUIT, not per account.

**Audit.** 293 application data paths were inventoried. 153 of them were RLS_ONLY or UNSCOPED and reachable, including cross-tenant writes and sends:
- the campaign send chain;
- Pipeline deal writes;
- pursuit route override;
- motion approval;
- evidence-share and broker injection;
- engagement deletes.

152 are fixed with explicit org predicates, and 1 is reclassified as system-by-design. 0 remain.

**Verification:**
- **Broad adversarial verifier `tenant-isolation`: 205/0.** It plants a foreign tenant across 33 record kinds, crawls 38 rooms and API responses of the real build, calls 27 write paths with foreign ids, and runs a negative control in which every room moves.
- **Harness.** 8 SEEDED suites were measured changing the canonical world. They now run on disposable seeded clones, every FRESH/EITHER suite is guarded, and 0 suites are UNSAFE. The whole-world fingerprint gate, run twice: PASS (`e98b43254f98d5ec` at start, after run 1 and after run 2; 74/76 suite runs clean, the 2 exceptions being the pre-existing `motion-intel` fixture gap).
- **Local app_rw rehearsal.** 36/36 rooms are identical under RLS binding and under the owner.
- **Baselines unchanged.** Manifest `be0da833990ce436`; canonical fingerprint `e98b43254f98d5ec`.

No hosted database, Vercel setting, Supabase role or grant, flag, deployment or Production change was made.

**Earlier the same day — SLICE 2B HOSTED REVIEW: the final Today defect was fixed locally** (it was subsequently accepted: DEMO CERTIFIED / FROZEN).

The hosted review passed the Queue and the Pursuit Detail labelling, but failed Today: State D showed two Globex cards.

**Root cause, confirmed with a guarded read-only query of `mejokqxriwyawfhawuxu`.** They are two canonical pursuits:
- the hero MODERNIZATION pursuit, whose route is decided (WWT);
- a separate EXPANSION pursuit, "AI platform expansion", with its own pending CDW route approval.

Grouping already held one card per pursuit, but the two cards named only the account.

**Fix (D-042):**
- Grouping stays by pursuit identity, never by account.
- Where one account has several pursuit cards, each names its pursuit.
- Every reason for one pursuit competes under the existing ranking and folds beneath the winner with its own CTA ("Approve route via CDW → Approve").
- "Decisions to make" again counts underlying reasons (its certified meaning); View all counts cards.

Proven:
- `vnext-attention` 64/0 (+7, on the real world in State D);
- `today-tenant` 51/0;
- `npm test` 362/0; `tsc` 0; build 0;
- Slice 1 62/0; Slice 2A 116/0; team 11/0;
- manifest `be0da833990ce436`.

Against the accepted build (`c0eea5a`), Queue, Pursuit Detail, the drawers and all flag-OFF Today pages are unchanged. With attention on, only Today differs.

Also fixed from the render review: composed cards on mobile clipped long lines past the card edge. The stacked layout used `items-start`; it now uses `items-stretch`, and 0 elements cross a card edge at 390 or 1440.

**Earlier the same day — TENANT HARDENING PASSED: the Slice 2B security gate is closed.**

**The leak.** A pre-existing Today / Queue tenant leak was found during Slice 2B. With the flag OFF, the guest org's certified Today listed 17–18 of Vertex's items and Vertex's whole $8,040,000 open pipeline.

**Root cause.** Several Today and Queue queries named no org and relied on RLS, and RLS is inert while the app connects as the owner (task #67).

**The fix.** Every Today, Queue and drawer query now names the caller's org explicitly in SQL, before any ranking, count or `LIMIT`. The Queue's two resolve actions are also scoped to the caller's org (D-041).

**Proven:**
- `today-tenant` verifier 51/0: zero foreign items for every org, flag OFF and ON, and planted foreign rows change nothing for Vertex;
- negative control: the pre-fix code gives the guest 17 foreign items;
- source guard 4/0;
- `tsc` 0; `npm test` 355/0; build 0;
- Slice 1 62/0; 2A 116/0; 2B 57/0; value-case 126/0; team 11/0; spot checks green;
- manifest `be0da833990ce436`.

For the owning org, the pages are byte-identical to the pre-fix build in five configurations, apart from one declared change in tie order. Security correctness supersedes byte-identical flag-OFF output.

Task #67 (the `app_rw` / RLS cutover) remains the future defence in depth. No role, grant, hosted database, Vercel setting, flag or deployment was touched.

**Slice 1 and Slice 2A are both DEMO CERTIFIED / FROZEN.** Slice 2A passed human product acceptance on the isolated hosted Preview; the twelve steps are recorded in `ACCEPTANCE.md`.

**Slice 2B (Pursuit Attention + Today / Queue coordination) is PREVIEW READY on the local synthetic path only.** It is behind `VNEXT_PURSUIT_ATTENTION_ENABLED`, default OFF, which requires Slice 2A coordination. It is NOT DEMO CERTIFIED: that needs a hosted human review, and no hosted work was done in this pass.

Verified locally:
- `tsc` 0;
- `npm test` 351 / 0 (+25);
- `vnext-attention` 57 / 0 (new);
- `vnext-coordination` 116 / 0;
- Slice 1 62 / 0;
- `demo-team` 11 / 0;
- manifest `be0da833990ce436` unchanged;
- build 0;
- flag-OFF Today, Queue and Pursuit Detail identical to the pre-slice build.

No migration. No hosted database, Vercel setting, flag, deployment or Production system was touched.

**2026-09-14 (later) — the hosted seeding defect is FIXED and the isolated world REPAIRED; Slice 2A hosted verification now has ZERO failures.** Root cause: the in-place reseed cleared `pursuit_team_requirements` and never replays migration 0075, which is the only thing that ever inserted its five global roles, so no pursuit got a team. Fix `6ab3599`: the canonical seed re-establishes those five from one definition (`src/lib/routing/team-requirements.ts`) on both provisioning paths. Locally, a fresh build, an in-place reseed and a repeated in-place reseed are identical (154 tables; team digest `b63845ca021fe143`). `mejokqxriwyawfhawuxu` was reseeded in place (all 11 layers, plan story re-recorded) and now matches that build table for table, apart from the carried operator membership and the migration tracker. Hosted: coordination **112 pass / 0 fail / 4 not run** — the 4 are the as-`app_rw` checks, **environmentally not run** (hosted `app_rw` is NOLOGIN; `postgres` holds it without SET), with their grant/RLS equivalents passing. Slice 1 62/0 · team 11/0 · manifest `be0da833990ce436` unchanged · 0 messages/outbox/email rows. **Slice 2A stays PREVIEW READY, not DEMO CERTIFIED.** The paragraph below is the prior state.

**2026-09-14T16:49Z — Slice 2A schema and the Globex plan layer are INSTALLED on the isolated hosted database `mejokqxriwyawfhawuxu`; hosted verification is PARTIAL.** Migration 0103 applied (1 applied, 102 already tracked); `demo-plan-story.ts` recorded the Globex recommendation (goal route-independent, WWT only in the plan, no decision). Canonical world unchanged: 3 · 14 · 19 · 11 open · $8,040,000 · 14, digest `be0da833990ce436`. Slice 1 verifier 62/0 on hosted. **Coordination verifier NOT green on hosted:** the unmodified harness ran 60 ✓ / 1 ✗ then crashed in section 6; a scratchpad copy skipping only the unrunnable parts gave 103 pass / 2 fail / 11 not run. Both failures are one **pre-existing hosted-world defect — no pursuit team** (the in-place seed truncates `pursuit_team_requirements` and never replays the migration that fills it), so the Globex owner reads "No account executive on the pursuit team yet" instead of the canonical "role proposed, no one confirmed yet". Tenant isolation, disclosure and no-send checks pass; 0 messages / outbox rows. **Slice 2A stays PREVIEW READY (local) — not DEMO CERTIFIED.** No Vercel, flag, deployment or Production change. The earlier sentence below that the isolated database "does not have migration 0103 or the plan layer" is superseded by this paragraph. See `SESSION-HANDOFF.md` § "Slice 2A hosted promotion".

**2026-09-14 — Vertical Slice 1 is DEMO CERTIFIED / FROZEN. Vertical Slice 2A (Pursuit Coordination — Goal → Plan → Motion → Action) is PREVIEW READY on the local synthetic path**, behind `VNEXT_PURSUIT_COORDINATION_ENABLED` (default OFF). Verified locally: `tsc` 0 · `npm test` 313/0 · build 0 · `vnext-coordination` 86/0 · `vnext-context` 62/0 · manifest digest `be0da833990ce436` unchanged · flag-OFF page byte-identical to the pre-slice build · "What matters now" byte-identical with the slice ON. **Not yet visible on the hosted Preview**: the isolated vNext database does not have migration 0103 or the plan layer, and the Preview scope does not arm the flag — both are owner-approved steps (`SESSION-HANDOFF.md` → exact next step). No hosted database, Vercel setting or deployment was touched.

**Lane:** `roadmap/pursuitos-vnext` @ `5ee1dfe` + docs — Slice 1 **PRODUCT SIGNED OFF / PREVIEW READY**, untouched. **2026-09-14T02:59Z: the isolated vNext database `mejokqxriwyawfhawuxu` is INITIALIZED** — 102 migrations, marked `demo` / `is_synthetic=true`, canonical world seeded and reconciled exactly (3 · 14 · 19 · 11 open · $8,040,000 · 14; manifest digest `be0da833990ce436` = certified). It is ready to be wired to the Vercel Preview scope; **nothing on Vercel has been touched.** History: before the owner's credential reset, the initialization had stopped at the target safety gate **twice, by design, for two different reasons**. First from Claude Code Web (no Postgres egress). Then from a laptop, which **resolved the egress blocker** — the project answers on all three endpoints — only to hit a **rejected credential**: `28P01 password authentication failed`, identically from the session pooler, the transaction pooler and the direct host. The target ref is confirmed `mejokqxriwyawfhawuxu` and confirmed **not** the Monday demo. **Nothing has been written to any database.** See `ENVIRONMENT-MAP.md` §10.

States: `NOT STARTED` · `BUILDING` · `PREVIEW READY` · `DEMO CERTIFIED` · `BLOCKED`

---

## Foundation

| Item | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|
| vNext branch | **DEMO CERTIFIED** (n/a — infrastructure) | `roadmap/pursuitos-vnext` from `97e975f0` | 2026-09-12 | — | — |
| Known-good demo reference | **DEMO CERTIFIED** | `backup/2026-09-04/tds-live-demo` → `97e975f0` (on origin) | 2026-09-12 | — | Local tag `demo-safe-2026-09-12` was created at the same commit but its **push was refused (HTTP 403)** — this remote rejects tag pushes. The already-pushed `backup/…/tds-live-demo` tag plus the SHA recorded throughout these docs are the durable references. |
| Durable agent memory | **DEMO CERTIFIED** | `docs/vnext/*` | 2026-09-12 | Keep `SESSION-HANDOFF.md` current every session | Goes stale silently if a session forgets to update it |
| Feature-flag scaffolding | **PREVIEW READY** | `src/lib/env/vnext-flags.ts`, `tests/vnext-flags.test.ts` | 2026-09-12 | Nothing — no capability behind any flag yet | None. Default OFF, narrowing-only, 4/4 tests green |
| Preview environment | **BLOCKED** — needs a credential, not a decision | — | 2026-09-12 | One read-only Vercel API call, or one signed-in visit to `/api/build`. Isolation design is **complete and waiting**: `PREVIEW-ISOLATION-PLAN.md` Option 2 | Classification still **UNKNOWN**. Newly proven: **no application-layer mitigation exists** if Preview does share the DB — `VERCEL_ENV` gates nothing, `assertSyntheticDatabase` passes for anything marked synthetic (the demo DB is), 22 files carry server actions. Bounded by: a build performs no DB access. `ENVIRONMENT-MAP.md` §6 B-a…B-e |
| Live serving SHA | **BLOCKED** — every unauthenticated avenue exhausted | — | 2026-09-12 | `/api/build` with `OPS_FINGERPRINT_TOKEN`, **or** an owner signed in visiting `/api/build`, **or** the Vercel API | Branch head is Wave 6D `97e975f0`; last observed serving SHA was Wave 3 `66f72f61`. Seven avenues attempted and closed — recorded in `ENVIRONMENT-MAP.md` §9 so no session repeats the search. Cannot certify a promotion against an unknown baseline |
| **vNext isolated database** | **PREVIEW READY** (database only) — initialized, marked, seeded, reconciled; Slice 2A schema + Globex plan installed; **team layer repaired and reseeded 2026-09-14T21:08Z** | target ref `mejokqxriwyawfhawuxu` | 2026-09-14T21:08Z | Nothing in the database. Next is the Vercel wiring (row below) | 103/103 migrations. Reseeded in place with fix `6ab3599`: 5 canonical team requirements, 45 members, Globex ledger 10, plan owner `ROLE_UNFILLED`; matches a fresh local build table for table. Coordination 112 pass / 0 fail / 4 as-`app_rw` checks environmentally not run (hosted `app_rw` NOLOGIN; `postgres` membership has no SET); grant/RLS equivalents pass. Slice 1 62/0, demo-team 11/0, manifest unchanged, 0 messages | Migrated **102/102** from empty. `environment_identity` = `demo` / `is_synthetic=true` / "pursuitos-vnext — isolated synthetic preview". Seed 10/10 layers, `verify()` 17/17. Reconciled **exactly**: 3 orgs · 14 companies · 19 opportunities · 11 open · $8,040,000 · 14 pursuits; manifest digest `be0da833990ce436` = certified. 0 messages. Identity **proven distinct** from `qifatlqxfuhwrwvpbwsc`. Still unverified: whether it is a Supabase branch or a standalone project. One transient `28P01` on the first probe, then consistent success — `ENVIRONMENT-MAP.md` §10 |
| vNext isolated preview | **NOT STARTED** — no longer blocked upstream; waits on one owner-approved Vercel action | — | 2026-09-14T02:59Z | `PREVIEW-ISOLATION-PLAN.md` Objective C Option 2 step 5: a Preview-scoped `DATABASE_URL` for branch `roadmap/pursuitos-vnext` pointing at the isolated target, plus the Objective D Preview flags; then V-1…V-10 | Nothing built. No Vercel scope has been touched in any session. Owning an isolated database does not by itself isolate Preview — the Preview scope's current `DATABASE_URL` is still UNKNOWN (§6) |

---

## Roadmap capabilities

| Capability | Phase | Status | Branch / commit | Updated | What remains | Known risks |
|---|---|---|---|---|---|---|
| Canonical commercial foundation | P0 | **DEMO CERTIFIED** (pre-existing) | `97e975f0` | 2026-09-03 | — | Substantially already built: orgs, companies, products, sellers, partners, opportunities, motions, campaigns, entity resolution, aliases, provenance |
| Living Pursuit Context — **Vertical Slice 1** | P1 | **DEMO CERTIFIED / FROZEN** (owner, 2026-09-14) | `roadmap/pursuitos-vnext` @ `c4f4196` | 2026-09-14 | Nothing. "What matters now" is frozen absent real pilot feedback — do not redesign, rename or restructure it | Slice 2A re-proved it byte-identical (12,761 bytes, 1,092×792 desktop / 326×1,251 mobile) with the coordination flag ON |
| **Pursuit Coordination — Vertical Slice 2A** | P3 | **DEMO CERTIFIED / FROZEN** (owner, human product acceptance on the isolated hosted Preview, 2026-09-14) | `roadmap/pursuitos-vnext` @ `6ab3599` | 2026-09-14 | Nothing. Do not materially redesign it absent pilot feedback | Goal → Plan → Motion → Action on Pursuit Detail. Migration 0103. The twelve accepted steps are in `ACCEPTANCE.md`. Its UX note (preserved plan content read as current) is addressed by Slice 2B labelling |
| **Today / Queue tenant scoping (hardening)** | P6 / #67 | **DONE (local)** — the Slice 2B security gate; subsumed by H1A | `c0eea5a` | 2026-09-14 | — | D-041. `today-tenant` verifier + source guard |
| **Pursuit Attention + Today / Queue — Vertical Slice 2B** | P3 | **DEMO CERTIFIED / FROZEN** (hosted human review on the isolated Preview, 2026-09-14) | `roadmap/pursuitos-vnext` @ `54ab990` | 2026-09-14 | Nothing. Do not materially redesign it absent pilot feedback | One card per PURSUIT, not per account (Globex modernization → Plan needs review; Globex expansion → its own CDW route decision). Plan review outranks the stale action; the Queue preserves the action once with plan-review context; "Current approved plan / Focus when approved". D-034…D-042, D-046 |
| **H1A — Tenant isolation + certification integrity** | P6 / #67 | **COMPLETE (local)** | `roadmap/pursuitos-vnext` (H1A commit) | 2026-09-14 | Nothing in H1A. H1 completes with H1B | 293 paths audited; 152 fixed + 1 reclassified; `tenant-isolation` 205/0; 0 UNSAFE verifiers; fingerprint gate PASS (`e98b43254f98d5ec` at start, after run 1 and after run 2; 74/76 suite runs clean, the 2 exceptions being the pre-existing `motion-intel` fixture gap); app_rw rehearsal 36/36. D-043, D-044. Reported, not fixed: global learning tables, inbound subject matching, stored digests (`H1-PRE-PILOT-HARDENING.md` § C) |
| **H1B — Least-privilege runtime / RLS cutover** | P6 / #67 | **IN PROGRESS** — Gate 1 PASS (re-baselined) · H1B-0 COMPLETE · Gate 1b PASS · **Gate 2 BLOCKED / NOT EXECUTED** · **H1B-0.1 COMPLETE (local)** · **Gate 1b.1 PASS** (0105 hosted; 31/31 hardened, 0 unsafe) · **Gate 2 PASS** (`app_rw` LOGIN false → true; nothing else changed) · **Gate 3 PASS** (pooler login proven; RLS exact on 155 tables for no context and 3 orgs; no context leak; foreign writes refused; zero residue) · **Gate 4 PASS AFTER DOCUMENTED RE-BASELINE** (branch Preview `DATABASE_URL_OWNER` added; runtime still `postgres`; crawl 37/37 equivalent; one-time render materialization proven stable; CFR-1 adopted) · **Gate 5 PASS** (branch Preview runtime `app_rw`, bypassRls false, tenantEnforcement true; owner paths through `DATABASE_URL_OWNER`; crawl healthy; D-G5-1 ordering defect recorded) · **Gate 6 PASS** (live posture `app_rw` / bypassRls false / tenantEnforcement true / probe live) · **D-G5-1 HOSTED ACCEPTED / CLOSED** (`1c4fb5e` on the `app_rw` Preview; two full crawls identical in order; DB 0/155 changed) · **Gate 7 PASS** (exact-RLS probe as `app_rw` 80/0; crawl identical; hosted handshakes 117/0 rolled back; owner human review PASS) · **Gate 8 PASS** (rollback to the owner and restoration to `app_rw` both proven; the Preview is back on `app_rw`) · **D-G8-1 HOSTED ACCEPTED / CLOSED** (`dcde3b6` on the `app_rw` Preview) | `roadmap/pursuitos-vnext` | 2026-09-15 | Owner decision on the D-G8-2 backlog → fix D-P1 → Gate 9 | D-045, D-048, D-049, D-050. Hosted baseline: migrations 105 · manifest `db1f78f7a11bbacb` · business-data fingerprint `79321d9130d1dc94` · whole-world fingerprint `de05e204801988d1` · `app_rw` LOGIN true (not yet used) |
| · pursuit context narrative (rendered) | P1 | **PREVIEW READY** | `6c5b7a9` `components/pursuit/context-narrative.tsx` | 2026-09-12 | Product sign-off on the refined surface, then GATE D/E | Titled **"What matters now"**, full-width on desktop. GATE C **N-1 fixed** (all 10 ledger rows reachable, override chronology included), **N-2/N-4/N-6 fixed**. Flag OFF verified identical panel-for-panel. Residual: R-1 "What changed" right half empty (cosmetic), R-2 283px void beside Value case. See `GATE-C-PRODUCT-REVIEW.md` § GATE C REFINEMENT |
| · pursuit evidence (direct + supporting) | P1 | **PREVIEW READY** | `620bc12` `read-models/pursuit-evidence.ts` | 2026-09-12 | Consumed by "What matters now" since `99bd5dd` | 18 tests. **Supersedes the plan to swap `getFacts` to pursuit scope** — Globex has 1 linked fact, so the swap would have deleted the best evidence on the screen. See D-020 |
| · fact freshness | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/facts/freshness.ts` | — | Compose at pursuit level | Exists per-fact; nothing composes per-pursuit |
| · research coverage | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/intel/completeness.ts` | — | Compose at pursuit level | Account-scoped today |
| · context health (pursuit level) | P1 | **PREVIEW READY** | `d1e5685` `read-models/context-health.ts` | 2026-09-12 | Consumed as the one confidence word since `99bd5dd` | Pure function, 13 tests. Composes `factFreshness` + `computeCompleteness`; re-implements neither |
| · pursuit state | P1 | **DEMO CERTIFIED** (pre-existing) | `src/lib/pursuits/lifecycle.ts`, `src/lib/lifecycle/state.ts` | — | Surface as "current state" narrative | — |
| · pursuit memory | P1 | **PREVIEW READY** | `b6b7b33` `read-models/memory.ts` | 2026-09-12 | Consumed by "What changed"; all entries reachable since `1ed0105` | Pure function, 21 tests. Business-time ordering, no materiality filter, ledger never mutated |
| · what's missing (ranked) | P1 | **PREVIEW READY** | `ac572ba` `read-models/missing-context.ts` | 2026-09-12 | Consumed by "Needs attention"; secondaries expandable since `6c5b7a9` | Pure function, 15 tests. Composes the 4 existing gap computations; adds no fifth |
| · pertinence (pursuit + decision scoped) | P2 | **PREVIEW READY** | `1b05b8a` `read-models/pertinence.ts` | 2026-09-12 | Consumed via `pursuit-evidence` ranking since `620bc12` | 18 + 13 tests. Pursuit-scoped, not portfolio-scoped (D-017). Consumes upstream gap rank/source (D-019) |
| · why this pursuit (portfolio-relative) | P2 | **NOT STARTED** | — | 2026-09-12 | Deferred to Slice 3 — needs cross-pursuit inputs | D-017: a different computation from pertinence |
| Pursuit Intelligence | P2 | **NOT STARTED** | — | 2026-09-12 | Slice 3 | Depends on Slice 1 |
| Next Move / coordination | P3 | **SUPERSEDED** by Slice 2A | — | 2026-09-14 | — | The P3 amendment replaced isolated next-best-action with Goal → Plan → Motion → Action (D-025). `VNEXT_NEXT_BEST_ACTION_ENABLED` stays reserved and unimplemented |
| · pursuit goal | P3 | **PREVIEW READY** | `pursuit_goals` (0103) | 2026-09-14 | A UI for goal replacement (the governed `replace_pursuit_goal` path exists and is verified) | The commercial outcome only — route-, motion- and action-independent; append-only replacement via `supersedes_goal_id` (D-033). Not the org-level `goals` table (D-026) |
| · pursuit plan + revisions | P3 | **PREVIEW READY** | `pursuit_plans`, `pursuit_plan_revisions` (0103), `read-models/pursuit-plan.ts`, `coordination/plan-store.ts` | 2026-09-14 | Worker-driven review recording; plan closure | Append-only by grant, proven as `app_rw` (42501) |
| · course correction | P3 | **PREVIEW READY** | `assessPlanReview` + `PLAN_REVIEW_REQUIRED` | 2026-09-14 | Automatic recording on material events (today: detected on read, recorded on request) | Fingerprint comparison, never a rewrite (D-028) |
| AI Control Plane | P4 | **NOT STARTED** | — | 2026-09-12 | Slice 4, thin backend only | D-011: no new room |
| Pursuit Runtime | P5 | **BUILDING** (partial, pre-existing) | `governed_action_invocations`, `GOVERNED_ACTION_ENABLED` | — | Run ledger, cost tracking | Governed actions + append-only ledgers already exist |
| Intercompany Governance | P6 | **DEMO CERTIFIED** (pre-existing) | disclosure ladder, grants, contributions | 2026-09-03 | — | Server-side withholding is load-bearing for the demo; do not touch |
| Pursuit Analysis / Dynamic Surfaces | P7 | **BUILDING** (partial, pre-existing) | `src/lib/search/registry.ts`, `src/lib/interpret/catalog.ts` | — | ANALYZE verb, cohort engine, dynamic surfaces | D-010: cannot invent permissions/metrics/writes |
| Learning System | P8 | **BUILDING** (partial, pre-existing) | outcome bridge, experiments, attribution | — | Prediction snapshots, evaluation | Slice 5; depends on 2 and 4 |
| Ecosystem Intelligence | P9 | **NOT STARTED** | — | 2026-09-12 | — | — |
| Attribution & Settlement | P10 | **BUILDING** (partial, pre-existing) | settlement ledger, contribution tracking | — | Reconciliation, incentives | Symmetric settlement ledger already ships |

---

## Validation

| Check | Session 0 | 1–4 | 5A | 5B-1 | 5B-2 | 6A+6B |
|---|---|---|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `npm test` | 149 / 0 | 220 / 0 | 220 / 0 | 233 / 0 | 251 / 0 | **271 pass / 0 fail** |
| `npm run build` | exit 0 | exit 0 | exit 0 | exit 0 | exit 0 | **exit 0** |
| `vnext-context` verifier | — | — | 42 / 0 | 47 / 0 | 55 / 0 | **55 passed / 0 failed** |
| SEEDED spot-check | — | — | green | green | green | **interpret 255 · lifecycle-query 80 · value-case 126 · stakeholder-intel 43** |

### GATE C refinement validation (`1ed0105`, `6c5b7a9`)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **290 pass / 0 fail** (from 271; +19 tests) |
| `npm run build` | exit 0 |
| `vnext-context` verifier | **62 passed / 0 failed** (from 55; new section 6) |
| Flag-OFF desktop / mobile height | 3,827px / 7,870px — **unchanged**, panel geometry identical panel-for-panel |
| Flag-ON desktop / mobile height | 3,861px / 7,221px |
| Composed surface | 538×1,068 → **1,092×792** |
| Desktop void | 785px → **283px** (beside the surface: 593px → **0**) |
| History reachable, flag ON | 3 of 10 → **10 of 10** |
| Horizontal overflow @1440 / @390 | none / none |

### Vertical Slice 2A validation (2026-09-14, local synthetic, Globex)

Local Postgres 17.11 + pgvector 0.8.6 (Homebrew) on `127.0.0.1:5433`, canonical world rebuilt from scratch with the new 11th layer. No hosted database contacted.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **313 pass / 0 fail** (from 290; +23: 22 plan tests + 1 flag test) |
| `npm run build` | exit 0 |
| `vnext-coordination` verifier (new, SEEDED) | **86 passed / 0 failed** — all writes rolled back, world unchanged afterwards |
| `vnext-context` verifier (Slice 1) | **62 passed / 0 failed** — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — **unchanged** (= certified) |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| Flag-OFF, pre-slice build (`a04f0c8`) vs this build | same raw size (234,511 bytes); **full body byte-identical** after normalizing only per-build asset names, build id, per-request CSP nonce, server-action id hashes and the request-time timestamp existing team gap actions stamp; panel geometry identical panel-for-panel (3,827px desktop / 7,916px mobile, 11 panels) |
| "What matters now", Slice-1-only vs 2A ON | outerHTML **byte-identical** at 1440 and 390 |
| Flag-ON | "Pursuit plan" at 1,092×547 directly beneath "What matters now"; 10 panels; no horizontal overflow @1440 / @390 |
| Screenshots | `docs/vnext/review/slice-2a/` |

**Defects found and fixed before commit** (all caught by the new harness or the render review, none shipped): 0103 first draft left `app_rw` full DML on the new tables because of 0058's default privileges (D-031); the two plan skills appeared in the Federation panel's registry list and the seed's invocation became its "Last action" — both visible flag-OFF — fixed by keeping them in `COORDINATION_SKILLS` and seeding through the store; a `plan && …` child that left a `null` in the flag-OFF flight payload (5 bytes, no markup) — fixed with a ternary; a raw ISO date and a two-column grid that did not form.

### Slice 2A Goal ↔ Plan boundary refinement (2026-09-14, D-033)

The goal is now the durable commercial outcome only. Globex: "Exit legacy virtualization before renewal and close the $920K opportunity" — previously "…with WWT". The route, motion, action and owner live in plan revisions. 0103 was amended in place (never applied to any hosted/shared database): an append-only `supersedes_goal_id` + `supersession_reason` on the new goal row replaces the mutable forward pointer, plus `GOAL_REPLACED` and the governed USER-only `replace_pursuit_goal` skill (no UI). The local world was rebuilt from scratch.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **316 pass / 0 fail** (+3: route WWT↔CDW, motion/action, 0103 supersession schema; Globex goal test rewritten) |
| `vnext-coordination` verifier | **116 passed / 0 failed** (from 86): WWT → CDW → WWT keeps the same goal row and changes only plan history; motion change and action adjustment keep the goal; replacement keeps the old goal byte-identical and SUPERSEDED, forks refused (23505), non-human/unexplained supersession refused (23514), `app_rw` cannot rewrite objective or pointer (42501), another org cannot replace |
| `vnext-context` verifier (Slice 1) | 62 passed / 0 failed — Globex ledger still 10 rows |
| Manifest digest | `be0da833990ce436` — unchanged |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 |
| `npm run build` | exit 0 |
| Flag-OFF, pre-slice build vs refined build | same raw size (234,511 bytes); full body byte-identical under the same normalization as before; zero plan markers |
| "What matters now", Slice-1-only vs refined 2A ON | outerHTML byte-identical at 1440 and 390 (1,092×792 / 326×1,251) |
| Flag-ON goal area | shows "Exit legacy virtualization before renewal and close the $920K opportunity"; "opportunity with WWT" absent; "via WWT" present only in the plan's Next move; plan panel geometry unchanged (1,092×547) |

**Found while testing the boundary, fixed:** when a person approves the *recommended* route, the route read-model deliberately reports `selected = null`. The plan loader took that as "no route", which left the plan unable to name an approved recommendation. It now resolves the choice from `selectedKey`. Globex (an override) was unaffected.

### Today / Queue tenant hardening validation (2026-09-14, local synthetic)

| Check | Result |
|---|---|
| Negative control: pre-fix code (`8261ef3`), guest org Meridian, flag OFF | **17 of 17** Today items are Vertex's. The open pipeline shows **$8,040,000 over 11 opportunities**, and the guest owns 0. (18 items earlier in the session; one aged out of the 14-day change window) |
| `today-tenant` verifier (new, SEEDED) | **51 passed / 0 failed**. All three orgs: every read inside `READ ONLY`, zero foreign Today items flag OFF and ON, own-only pipeline, counts, queue, lineage and drawer. It plants 10 guest-org clones of real Vertex rows, and **Vertex's full Today + Queue projection stays identical**: cards, ranks, urgency, other items, badge, counts, pipeline, activity, leaderboard, drawer, queue, lineage, attention. The guest's own rows render. A guest cannot resolve a Vertex queue item. 0 send rows; world unchanged |
| `tests/today-tenant-scope.test.ts` | **4 / 0**. Every Today and Queue query carries an org predicate or a declared org-owned parent. The pages run no SQL. The org comes from `withTenant`. The filters sit before `LIMIT` |
| `tsc` / `npm test` / build | exit 0 / **355 / 0** (+4) / exit 0 |
| Slice 1 · Slice 2A · Slice 2B | 62 / 0 · 116 / 0 · 57 / 0 |
| value-case (drawer consumer) · demo-team · append-only · stakeholder-intel · team-motion | 126 / 0 · 11 / 0 · 11 / 0 · 43 / 0 · 22 / 0 |
| Manifest | `be0da833990ce436`, unchanged |
| Owning-org render, pre-fix build vs fix, same env and DB, five configurations × 7 pages (Today, view-all, Today drawer, Queue, Pursuit Detail, Pipeline drawer, Accounts drawer) | Byte-identical, or markup-identical for the Queue, whose payload order varies per request. One declared exception: flag-OFF `/?today=all`, proven **reorder-only**. Equal-materiality economic-buyer cards now follow a declared, deterministic tie order; the cards are the same byte for byte and the page length is identical (D-041). Checked on a freshly rebuilt world, with ids resolved per database |

### Vertical Slice 2B validation (2026-09-14, local synthetic, Globex)

This is a disposable local Postgres 17 on `127.0.0.1:5433`, rebuilt from scratch. States B, C and D were rendered from template copies of that world (`pursuit_state_b/c/d`), each advanced through the real governed skills. On those copies only, the approved action's due date was moved into this week so that State B shows "due". No hosted database was contacted.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | **351 pass / 0 fail** (from 326; +24 attention tests, +1 flag test) |
| `vnext-attention` verifier (new, SEEDED) | **57 passed / 0 failed**. Every Today and Queue read ran inside `READ ONLY` transactions; all writes were rolled back; the world was unchanged afterwards |
| `vnext-coordination` (Slice 2A) | **116 passed / 0 failed** |
| `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| `demo-team` | 11 / 0 · team digest `b63845ca021fe143` |
| SEEDED spot-check | append-only 11/0 · stakeholder-intel 43/0 · value-case 126/0 · team-motion 22/0 |
| Manifest digest | `be0da833990ce436`, unchanged |
| `npm run build` | exit 0 |
| Flag-OFF vs pre-slice build (`b677acf`), same env, same DB | **Today (`/` and `/?today=all`) and Pursuit Detail are byte-identical** after normalizing only build assets, build id, nonce, action-id hashes, action-ref numbers and request stamps. This holds in three configurations: Slice 1 + 2A ON on the seeded world; Slice 1 + 2A ON on State C (plan needs review); and no vNext flags. **Queue:** the rendered markup (scripts removed) is identical in all three. Its raw Flight payload is not comparable, because the baseline differs from itself between two requests (React streams server-action chunks in per-request order) |
| Today, attention ON | 11 pursuit cards instead of 34–36 item cards. Globex is card 6 in A, card 11 in B, and **card 1 in C and D**. No horizontal overflow at 1440 or 390 |
| Screenshots | `docs/vnext/review/slice-2b/` |

**Defects found and fixed before commit.** Both were caught by the render comparison, and neither shipped:
- An `attention && …` child in the Today card, and an `approvedPlanFrame && …` slot in the plan surface, each serialized a `"$undefined"` into the flag-OFF Flight payload. Both were restructured so the flag-OFF branch is the original JSX verbatim.
- Trailing-period stripping turned "Globex Manufacturing Inc." into "Inc".

**Found, pre-existing, not fixed:**
- The certified Today card collapses to a sliver at 390px ("S…", "A…", with the CTA overlapping). Composed cards stack under the flag instead; flag-OFF is untouched.
- Several `getTodayQueue` reads have no `org_id` predicate, so the guest org's certified Today shows 18 of Vertex's items while RLS is inert (task #67). The composed Today drops them (D-038).
- Some existing Today item ids embed `Date.now()`, so they are unstable across reads.

### Hosted team-layer repair (2026-09-14T21:08Z, fix `6ab3599`)

| Check | Result |
|---|---|
| Root cause reproduced locally | pre-fix `demo-db.ts` in place → 0 requirements / 0 members / 0 `TEAM_CHANGED` (= the hosted state) |
| `tsc --noEmit` / `npm test` | exit 0 / **326 pass, 0 fail** (+10 in `tests/team-requirements.test.ts`) |
| Local fresh · in-place #1 · in-place #2 | each: demo-team 11/0 (digest `b63845ca021fe143`), coordination **116/0**, Slice 1 62/0, manifest `be0da833990ce436`, append-only 11/0, stakeholder-intel 43/0, value-case 126/0, team-motion 22/0; whole-world snapshots identical across all three |
| Hosted gate (before the write, and at the end) | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; not `qifatlqxfuhwrwvpbwsc` |
| Hosted in-place reseed | 11/11 layers ok; `verify()` all ok, including canonical team requirements (5) and the Globex hero team (5 roles) |
| Hosted `demo-team` | **11 passed / 0 failed**; digest = local |
| Hosted `vnext-coordination` | repo harness: 96 ✓ / 0 ✗, then it aborts at the first `set local role app_rw`. Copy with only those scenarios skipped: **112 pass / 0 fail / 4 not run** |
| 4 not run | as-`app_rw` checks only — **environmentally not run** (`app_rw` NOLOGIN; `postgres` holds it with ADMIN, no SET, no INHERIT). Grant/RLS equivalents pass |
| Hosted `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| Hosted manifest | `be0da833990ce436` before and after |
| Send | 0 `messages` / `action_outbox` / `email_events` / `sending_identities` |

### Slice 2A hosted installation (2026-09-14T16:49Z, isolated `mejokqxriwyawfhawuxu`)

Schema and data readiness only — no Vercel, flag or deployment. Slice 2A is **not** DEMO CERTIFIED.

| Check | Result |
|---|---|
| Target gate (before any write, and at the end) | `mejokqxriwyawfhawuxu` · `demo` · `is_synthetic true`; not `qifatlqxfuhwrwvpbwsc` |
| `migrate.ts` | 0103 applied — 1 applied, 102 already tracked, exit 0 (dry-run first showed exactly that one file) |
| `demo-plan-story.ts` | Globex recommendation recorded, exit 0. Goal route-free ("…close the $920K opportunity"), WWT only in the plan's motion, plan linked to goal, 0 decisions |
| `vnext-coordination` (repo harness) | **FAIL** — 60 ✓ / 1 ✗, then fatal in section 6 |
| `vnext-coordination` (scratchpad copy, only unrunnable parts skipped) | **103 pass / 2 fail / 11 not run.** Both failures are the hosted no-team defect (owner line; Globex ledger 9 ≠ 10). Not run: section 6 (7, needs a team member), as-`app_rw` (4, `postgres` cannot `SET ROLE app_rw` here) |
| `vnext-context` (Slice 1) | **62 passed / 0 failed** |
| Manifest digest | `be0da833990ce436` before and after — unchanged (= certified) |
| Canonical facts | 3 · 14 · 19 · 11 open · $8,040,000 · 14 |
| Send | `messages` / `action_outbox` / `email_events` / `sending_identities` = 0 throughout |
| `tsc --noEmit` / `npm test` (local) | exit 0 / 316 pass, 0 fail |

### Chunk 6B rendered evidence (local synthetic, Globex pursuit)

| | flag OFF | flag ON |
|---|---|---|
| Rendered `Panel` surfaces | 11 | **9** |
| "Why now" / "Facts behind this" / "What changed" panel titles | 1 / 1 / 1 | **0 / 0 / 0** |
| "This pursuit" panel | 0 | **1** |
| Anchors `#whynow` `#evidence` `#activity` | all present | **all present** |
| Page bytes | 235,042 | 217,010 |
| Horizontal overflow @1440 and @390 | none | **none** |

**Flag-OFF regression proven by render**, not assumed: the pre-6B commit and the
post-6B commit with the flag off produce byte-identical bodies (231,410 bytes);
the only differences are per-build Turbopack chunk filenames in `<head>`.

**Zero pre-existing failures at any point.** The 71 added tests are 4 flag tests
(Session 0) plus 67 read-model tests (chunks 1–4: 13 + 21 + 15 + 18). Any future
failure is attributable and must not be dismissed as pre-existing.

Not run in Session 0 (require a database; no roadmap code was written that could
affect them): the 33 verifier suites. Run them before GATE B.

---

## Open documentation debt

| Item | Note |
|---|---|
| `.env.example` incomplete | Missing `PURSUITOS_ENV`, `OPS_FINGERPRINT_TOKEN`, `DATABASE_URL_OWNER`, `BASIC_AUTH_*`, and the shipped feature-flag variables. The vNext block was added in Session 0; the rest was deliberately left to keep the diff reviewable. |
| `audit/DEMO-ITINERARY.md` ambiguity | Says the demo runs "under `app_rw` + FORCE RLS". True of the **local** demo; **not** true of hosted `demo.pursuitos.io`, which runs as `postgres`/`BYPASSRLS`. Not wrong, but reads as a stronger claim about the hosted demo than the evidence supports. Recorded in `ENVIRONMENT-MAP.md` §4. |
| **Synthetic-lineage defect (NEW, found by the chunk-5A harness)** | Two `change_ledger` rows in the canonical synthetic world carry `data_environment = 'PRODUCTION'` — `PARTNER_OVERRIDE` and `OVERRIDE_RECORDED`, on the Globex hero pursuit the demo's §2 beat turns on. Cause: `recordChange()` defaults `dataEnvironment` to `'PRODUCTION'` (`src/lib/pursuits/ledger.ts`) and the two override call sites omit it, so those entries are not labelable as synthetic. **Not fixed** — it is a seed-path change two days before the demo. Fix after Monday by passing `dataEnvironment` at `src/lib/routing/override.ts` and `src/lib/pursuits/overrides.ts`. |
| ~~Pertinence task-fit ignores gap source~~ | **RESOLVED in 5B-1** (`1b05b8a`). Gap `rank` and `source` now travel onto `PertinenceCandidate`; linkage uses the upstream rank instead of `gapKind` alone, and `TASK_FIT` matches on `GapSource`. All six task contexts now reorder, where four did before. See **D-019**. |
| ~~**In-place reseed drops the pursuit-team layer (2026-09-14T16:49Z)**~~ **FIXED `6ab3599`; `mejokqxriwyawfhawuxu` reseeded 21:08Z** — the canonical seed re-establishes the five global requirements from `src/lib/routing/team-requirements.ts` on both paths; `demo-team` verifier + `verify()` now cover the team layer. Other databases seeded in place before the fix keep the defect until reseeded (Monday demo: UNVERIFIED, not queried). Original note: | `scripts/demo-db.ts` in-place mode truncates `pursuit_team_requirements` (it carries `org_id`), but its only rows are the five global roles migration 0075 inserts, and in-place mode never replays migrations. So `assembleTeam` creates nothing: the isolated hosted world has 0 team members, 0 `TEAM_CHANGED` rows, and a Globex ledger of 9, not 10. `verify()` and the manifest do not cover team tables. **Not fixed.** Fix: preserve `org_id is null` rows of that table in the in-place truncate, then reseed the isolated DB. See `SESSION-HANDOFF.md` → exact next step. |
| **`team-motion-verify` can commit into the canonical world (NEW, 2026-09-14)** | During one local run it wrote a route selection plus partner-account-manager and account-executive invite/accept onto the Globex hero, taking the ledger from 10 to 17 rows. That moved the route from WWT to CDW and staled the seeded Slice 2A recommendation, so `vnext-attention` then correctly refused to approve it. It picks "a canonical routed pursuit" by a whatever-is-first read (see `verify-classes.ts`), so it does not always hit Globex: on a fresh rebuild it left Globex untouched. **Not fixed** (outside the tenant pass). Until it is, run it last, and rebuild the world before any certification run. |
| Task #67 outstanding → **H1B** | RLS fully built, fully inert on the app path. H1A made every audited path explicitly tenant-scoped; the runtime cutover is H1B — design in `H1-PRE-PILOT-HARDENING.md` § H1B (the previously cited `audit/TASK-67-RLS-RUNTIME-CUTOVER-PLAN.md` does not exist). |
| ~~GATE C findings N-1 … N-6~~ | **N-1, N-2, N-4 and N-6 RESOLVED** in `1ed0105` + `6c5b7a9`. N-5 is explained rather than fixed (see R-1). N-3 stands as a *review-coverage* note, not a product defect: every evidence row on the Globex pursuit is VERIFIED, so the five-state vocabulary is only observable in Needs attention — review a thinner pursuit to see it. New residuals R-1…R-3 are cosmetic and recorded in `GATE-C-PRODUCT-REVIEW.md` § GATE C REFINEMENT. |
