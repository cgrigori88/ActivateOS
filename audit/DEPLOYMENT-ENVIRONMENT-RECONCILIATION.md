# Deployment + Environment Reconciliation

**Result: the four states are NOT one state.** The approved commit, the deployed application, the
hosted database and the demo world are four different things, and the gap is not a lag of hours —
the deployed application is the **pre-transformation product**.

No environment was mutated. No deploy was triggered, no migration applied, no data written, no flag
changed. Every finding below comes from read-only inspection. Secret **values** are never printed;
credentials are reported only as present / missing / invalid.

---

## 0. The one-paragraph version

`pursuitos.io` is serving `origin/main` @ **`b237e3b`** (2026-08-29), and the hosted Supabase
database matches that commit **exactly** — 62 migrations, 98 tables, zero drift. The approved commit
`4dbe485` sits on an unmerged branch **113 commits ahead**, carrying 39 unapplied migrations
(`0063`–`0101`) and the entire pursuit/fact/route/governance/outcome core, P1C, P2A, P2B, P2C-0,
P2C-1, the TD SYNNEX certification and the visual-system normalization. The demo world that all of
that was certified against exists **only in this container's local Postgres**, which is ephemeral.
Nothing here is broken; it is simply that **none of the last 113 commits has ever been deployed.**

---

## 1. PASS / FAIL matrix

| § | Check | Result | Evidence |
|---|---|---|---|
| 1 | Source-of-truth commit identified | **PASS** | HEAD = `origin/…-xzkgmd` = `4dbe485`, clean tree, 0 divergence |
| 2 | GitHub reconciled | **PASS (with finding)** | branch pushed and current; **`main` is not an ancestor**, 113 commits behind |
| 3 | Vercel deployment matches approved commit | **FAIL** | deployed build fingerprints to `b237e3b`, not `4dbe485` |
| 3b | Normalized visual system live | **FAIL** | deployed CSS still carries the positional rainbow (21×), lacks every 4dbe485 token |
| 4 | Database matches code expectations | **FAIL** | hosted DB is at migration `0062`; `0063`–`0101` never applied |
| 4b | Database target identified | **PASS** | project `sxtwrrckvlohottrdsbr`, `postgres`, ca-central-1 pooler |
| 4c | Migration tracking accurate | **FAIL** | `schema_migrations` stamped to `0012` while `0013`–`0062` are physically applied |
| 5 | Demo world healthy | **PASS (with risk)** | canonical graph populated; **but it lives only in an ephemeral container DB** |
| 6 | Environment variables present | **PASS (with finding)** | all app/DB credentials present; 4 deploy-platform credentials missing |
| 6b | Model credential usable | **FAIL** | `ANTHROPIC_API_KEY` present, correct shape, **rejected as invalid by the API** |
| 6c | Fallback intact | **PASS** | deterministic path unchanged and fully operational; no fallback weakened |
| 7 | Worker / background process | **BLOCKED** | no `RAILWAY_TOKEN`, no CLI, no service URL — unverifiable from here |
| 8 | External sending disabled | **PASS (code-level)** | `OUTREACH_AUTOSEND` unset and every consumer is `=== "on"` fail-closed |
| 9 | Deployed functional smoke test | **PARTIAL** | unauthenticated surface healthy; authenticated journey not run (see §9) |
| 10 | Build fingerprint endpoint | **ABSENT** | none exists; verified externally by asset fingerprinting instead |
| 11 | Production safety | **HELD** | nothing commissioned, inferred or mutated |

---

## 2. §1–§2 Source of truth and GitHub

```
HEAD                                   4dbe485244f6ac8f2ba2283a9cffd61344b6f35e
origin/claude/activateos-platform-review-xzkgmd   4dbe485  (identical)
origin/main                            b237e3bdee979ab66ac17798c818fd1cf3c72899
left/right vs main                     1  113
main is an ancestor of HEAD            NO
working tree                           0 uncommitted changes
```

`main` holds **1** commit not on the branch — the PR #12 merge commit (merged 2026-08-29). The
branch holds **113** commits not on `main`. The two histories have diverged; `main` is not simply
behind, it is on a different line.

Everything from `63605ae` (*Pursuit transformation — Phase 1*) onward — Workstreams A–E, the
canonical operating loop, P0/P1A/P1B/P1C, P2A/P2B/P2C-0/P2C-1, the TD SYNNEX certification and the
visual normalization — exists **only** on the unmerged branch.

---

## 3. §3 Vercel — the deployed application is `b237e3b`

Vercel could not be queried directly: no `vercel.json`, no `.vercel/`, no CLI, and
`VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` are all **missing** from this environment.
So the deployed commit was established from the outside, from the served assets themselves.

`https://pursuitos.io` responds `server: Vercel`; `/` returns **401** (correct — the app is
authenticated), `/login` returns **200** and is public. All CSS chunks referenced by `/login` were
fetched (126,326 bytes) and fingerprinted against the source tree.

**Three independent signals agree:**

| Signal | Deployed | `4dbe485` | `b237e3b` (main) |
|---|---|---|---|
| `nth-child(7n` positional-rainbow rules | **21** | 0 (comment only) | **21** |
| `--ink-faint`, `--text-copy`, `--text-section` | **absent** | present | **absent** |
| `.pos-summary`, `.pos-metric-fig` | **absent** | present | **absent** |
| globals.css custom properties resolved | — | 39 missing | **6 missing** ¹ |
| declared tables vs live DB | — | 21 migrations' worth missing | **exact match** |

¹ the 6 are route-scoped chunks not loaded by `/login`; every property `/login` can reach is present.

**Conclusion: the deployed application does not contain `4dbe485`.** It fingerprints to `origin/main`
@ `b237e3b`, which is consistent with Vercel deploying the repository's default branch.

**No deploy was attempted.** Per §11 the platform target could not be identified from this container,
and §3 forbids introducing code changes to trigger a deploy. Promoting `4dbe485` requires either
merging the branch to `main` (if Vercel tracks the default branch) or deploying the branch through
the authorized Vercel path — both are decisions for the operator, not inferences for me to act on.

### §12 — the normalized visual system is confirmed *not* live

Checked exactly as instructed, and the answer is negative on every point. The deployed CSS still
colours metric figures by DOM position (`nth-child(7n + N)` → `--color-cat-N`, 21 rules, 3 `7n+3`
matches, 4 `color-cat-3` references). The 8-step type scale, the 4-role ink ramp, the `data-intent`
metric semantics, `.pos-summary` and `.pos-metric-fig` are all absent. The page loads; the design
system on it is the old one.

---

## 4. §4 Supabase — identified, and stale by 39 migrations

**Target** (unambiguous — exactly one Supabase project exists in this environment):

```
project ref   sxtwrrckvlohottrdsbr
host          aws-0-ca-central-1.pooler.supabase.com:5432
database      postgres
```

Raw TCP 5432 is blocked by this container's egress proxy, confirmed against the application's own
`pg` client (`Connection terminated due to connection timeout`). Inspection therefore ran over the
Supabase Management API with `read_only: true` — **SELECTs only, no DDL, no writes.**

### A correction to an earlier probe

An initial probe reported *zero* for every object including `pursuits`. That was **wrong, and wrong
in a way worth recording**: it queried `information_schema.tables`, which is filtered by the calling
role's privileges, and the Management API connects as `supabase_read_only_user`. Re-run against
`pg_catalog` (not privilege-filtered), the database in fact holds **99 public tables**. The
conclusion below rests on the corrected probe.

### Actual state

| | |
|---|---|
| public tables | **99** |
| `schema_migrations` rows | **12** (`0001_core_schema` … `0012_intelligence_providers`) |
| migration files on the approved branch | **101** |
| migration files on `main` | **62** |

Two separate problems, and they must not be confused:

**(a) A tracking defect, not a schema defect.** `schema_migrations` claims `0012`, but tables created
by `0013`–`0062` are all physically present. Migrations `0013`–`0062` were applied without being
stamped. Since `scripts/migrate.ts` skips only what is recorded, it would attempt to re-apply 50
migrations. They are written idempotently, so this is recoverable — `migrate.ts --baseline` exists
precisely to stamp them — but it must be done deliberately, not discovered mid-deploy.

**(b) Real, total drift against the approved commit.** Every `CREATE TABLE` declared by `main` exists
live; the only live table `main` does not declare is `schema_migrations` itself. **Zero drift against
main.** Against `4dbe485`, 21 migration files' worth of tables are missing:

```
0063 pursuits · 0064 pursuit_score_* · 0065 change_ledger · 0066 pursuit_context_links
0068 pursuit_overrides · 0069 fact_predicates · 0070 facts · 0071 fact_associations
0072 pursuit_why_now/convergence · 0074 route_core · 0075 route_sellers_team
0076 transaction_signals · 0077 entity_resolution · 0078 route_outcomes
0080 pursuit_participation · 0081 context_grants · 0082 context_contributions
0083 governed_actions · 0084 recompute_requests · 0085 outcomes/attribution/experiments
0089 org_features
```

That is the entire canonical substrate: pursuits, the fact graph, the change ledger, routing,
governed actions, outcomes and attribution, and tenant feature flags. The hosted database is
internally consistent — it is simply the *pre-transformation* database, matching the
*pre-transformation* deployment.

**Nothing was written.** The environment is a single Supabase project serving whatever
`pursuitos.io` is; whether it is "production", "demo" or both is **not established**, and §11 makes
that ambiguity disqualifying for mutation. No migration was applied.

---

## 5. §5 Demo data — healthy, but it exists nowhere durable

The world every certification in this session was run against is **not** the Supabase project. It is
a **container-local Postgres 16 on port 5433, database `pursuit_demo`**, provisioned by
`scripts/demo-db.ts` with all 101 migrations applied directly.

```
orgs 153 · accounts 89 · pursuits 79 · facts 25 · change_ledger 430
opportunities 31 · partners 17 · stakeholders 4 · ask_exchanges 12 · outcomes 56
```

Populated across the whole canonical graph. **Not reseeded** — §5 forbids reseeding a healthy world,
and this one is healthy.

**The risk is not its contents, it is its location.** This database lives in an ephemeral session
container that is reclaimed after inactivity. It is not backed up, not replicated, and not reachable
from the deployed application. `pursuit_demo` also has **no `schema_migrations` table at all** —
`demo-db.ts` applies the files without stamping — so it cannot be reconciled by `migrate.ts` either.
A demo that depends on this container is a demo that depends on the container surviving.

Also present on 5433: `wsb_verify` (**exists but is empty — 0 relations**, so the five suites that
need it still cannot run) and `migrations_only_verify` (also unstamped).

---

## 6. §6 Environment variables — presence, and one failure

Values are never printed. Reported only as present / missing / invalid.

| Variable | State |
|---|---|
| `DATABASE_URL` | present |
| `SUPABASE_PROJECT_REF` · `SUPABASE_ACCESS_TOKEN` | present |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | present |
| `RESEND_API_KEY` · `TAVILY_API_KEY` · `PDL_API_KEY` · `RESEARCH_TRIGGER_SECRET` | present |
| **`ANTHROPIC_API_KEY`** | **present but INVALID** |
| `VERCEL_TOKEN` · `VERCEL_TEAM_ID` · `VERCEL_PROJECT_ID` | **missing** |
| `RAILWAY_TOKEN` | **missing** |

### The model credential is present and does not work

Presence is not usability, so it was tested rather than assumed. A minimal 4-token call to
`api.anthropic.com` returns:

```
HTTP 401  {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}
```

The key is well-formed (`sk-ant-api0…`, 108 characters) and the 401 is a genuine Anthropic response,
not a proxy rejection — a deliberately bogus key produces the identical status, and the message text
is Anthropic's own. **The credential is invalid or revoked.**

**Consequence, stated plainly: P2C-1 live model interpretation cannot run in this environment.**

**The fallback is intact and was not touched.** P2C-1 was built deterministic-first: the model is
consulted only where the deterministic parsers decline, and every interpreter failure path —
including transport failure — returns `REJECTED`, which routes back to the deterministic resolver.
So an invalid credential degrades the product to exactly the P2C-0 behaviour: registered intents,
GO TO, SHOW ME, EXPLAIN and structured ambiguity all work; only free-form paraphrase that no parser
recognises is lost. No fallback was weakened to accommodate this finding.

---

## 7. §7 Worker — BLOCKED

`railway.json` + `nixpacks.toml` + `docs/RAILWAY.md` define the worker (`npm run worker`, health
check `/health`). But there is no `RAILWAY_TOKEN`, no Railway CLI, and the service URL is held in the
Railway dashboard rather than the repo. **Whether the worker is running, and at which commit, could
not be determined.** Nothing was started, stopped or redeployed.

Worth noting for whoever checks: the worker on the branch depends on `recompute_requests`,
`action_outbox` and `governed_action_invocations` (migrations `0083`/`0084`), none of which exist in
the hosted database. A branch-built worker pointed at that database would fail on those paths.

---

## 8. §8 Feature flags — external sending is off

`OUTREACH_AUTOSEND` is **unset**; it appears only as a commented line in `.env.example`. Every
consumer tests `process.env.OUTREACH_AUTOSEND === "on"`, so absence is **fail-closed**:

```
src/worker/index.ts:86    allowRealProvider = … === "on"      → false
src/worker/index.ts:286   autosend          = … === "on"      → false
src/app/upcoming/page.tsx:45                 … === "on"       → false
```

**External sending is disabled.** No flag was changed, no production default touched, no global flag
widened. This is verified at code and local-environment level; the Vercel and Railway environments
hold their own variables, which this container cannot read — so their flag state is asserted by
neither this document nor me.

---

## 9. §9 Deployed smoke test — partial, and honestly so

What was verified against the real deployed application:

| Check | Result |
|---|---|
| `GET /` | **401** — authenticated app correctly refuses anonymous access |
| `GET /login` | **200**, 18,224 bytes, renders |
| `GET /api/health` | **401** — gated, consistent with the auth boundary |
| CSP | present, `default-src 'self'`, per-request nonce, `strict-dynamic` |
| HSTS | `max-age=15552000` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

**The authenticated journey was not run.** There are no credentials for the deployed environment in
this container, and §11 forbids operating on a production target that has not been explicitly
identified and authorized. Signing in would also have been of limited value: the deployed build is
`b237e3b`, so a walkthrough would certify the *old* product, not the approved one.

---

## 10. §10 Build fingerprint — absent, verified externally instead

The application exposes **no** build-fingerprint endpoint (no `/api/version`, no build SHA in the
served HTML; `/api/health` is auth-gated and returns no version). There is therefore no operator-only
surface reporting the running commit.

Verification was done externally instead, and is reproducible without any secret:

```bash
curl -s https://pursuitos.io/login \
  | grep -oE '/_next/static/immutable/chunks/[a-z0-9._-]+\.css' | sort -u \
  | while read p; do curl -s "https://pursuitos.io$p"; done \
  | grep -c 'nth-child(7n'
# 21  → pre-4dbe485        0 → 4dbe485 or later
```

**Recommendation (not implemented — this pass adds no features):** a `/api/build` returning
`{ commit, builtAt }` from `VERCEL_GIT_COMMIT_SHA`, operator-gated, no secrets. It would have made
this entire section a single request instead of an inference.

---

## 11. §11 Production safety — held

- Nothing was commissioned. Nothing was mutated. No DDL, no writes, no deploy, no flag change.
- No production target was inferred. The single Supabase project backs whatever `pursuitos.io` is,
  but **that identity was not established**, and per §11 that ambiguity is itself disqualifying for
  mutation.
- Database access was read-only by construction (`read_only: true` on every Management API call).
- No secret value was printed, logged or committed. The invalid model key is reported by state and
  shape only.
- The one artefact created during this pass (a temporary connection probe) was deleted; the working
  tree is clean.

---

## 12. What has to happen, in order

Not implemented — this pass makes no changes. Sequenced because the order matters.

1. **Decide what `4dbe485` is for.** It is not deployed anywhere. Either merge the branch to `main`
   (if Vercel tracks the default branch) or deploy the branch through the authorized Vercel path.
   113 commits is a large first deployment; it deserves a deliberate window, not a demo-morning push.
2. **Identify the Supabase project's role** — production, demo, or both — *before* touching it. Every
   step below is blocked on this and only the operator can answer it.
3. **Stamp the existing schema**: `migrate.ts --baseline` through `0062`, so the tracker matches
   physical reality and the 50 already-applied migrations are not re-run blind.
4. **Apply `0063`–`0101`** to that database. This is the substantive change: 21 files' worth of new
   tables carrying the entire canonical model. It should be rehearsed against a restored copy first,
   and the existing backup tooling (`scripts/backup-restore.ts`) should run immediately before.
5. **Replace the `ANTHROPIC_API_KEY`** wherever it is configured — this container, Vercel, Railway.
   Until then P2C-1 runs deterministic-only, which is correct but is not the certified experience.
6. **Establish a durable demo world.** The certified TD SYNNEX demo currently exists only in an
   ephemeral container database. It needs to live somewhere that survives.
7. **Verify the worker** and, if it is deployed from the branch, apply step 4 before restarting it.
8. **Add the build-fingerprint endpoint** so the next reconciliation is a query, not an inference.

---

## HALT FOR REVIEW

The reconciliation is complete and the answer is unambiguous: **one known-good commit exists, and it
is deployed nowhere.** The deployed application and its database are mutually consistent with each
other and with `main` — they are simply 113 commits and 39 migrations behind what was approved.

Remediation stops here by instruction. Steps 1 and 2 above are operator decisions about environment
identity and deployment authorization, and §11 requires a halt before any mutation while that
identity is ambiguous.
