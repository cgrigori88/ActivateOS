# Release Gate R1 — Phase 1 (Deep Mapping) + Phase 2 (Technical Design)

**Purpose:** make the *existing* A→E platform safe and credible for a real design-partner pilot. This is **hardening and proving what exists** — not Workstream F, not an A→E extension. No new features, scoring dimensions, federation abstractions, agents, marketplace, or integrations. No live distributor data.

> Foreman discipline: this map is verified against source, not narration. Where an audit doc and the code disagree, the code wins and the conflict is flagged. **No code changes until this design is signed off.**

---

## PHASE 1 — DEEP MAPPING (the runtime as it actually is)

### 1.1 Mutation authority — three models, one un-wired governor

There is **one intended UI model** and **several parallel non-UI paths that don't use it**, and the governed chokepoint is wired to nothing.

| Caller class | Path | Tenancy | Governed? |
|---|---|---|---|
| **UI** (~50 server actions) | `withTenant` + `requireWrite`/`requireOwner` → domain service | session → `app.org_id` GUC (RLS on) | via `dispatchSkill`? **No** |
| **MCP** `draft_touch` (INTERNAL_WRITE) | raw `upsertTouch` insert | API key → `withTenantOrg` GUC (RLS on), **no role/requireWrite** | **No** |
| **MCP** `request_warm_intro` (**CROSS_TENANT_ACTION**) | `requestWarmIntro` writes shared object + **both orgs' ledgers** | API key → `withTenantOrg` | **No** |
| **Ask LLM agent** | `MCP_TOOLS.filter(t => t.name !== "draft_touch")` — **`request_warm_intro` stays exposed to the model** (`agents/ask.ts:34`; the "one write tool" comment at `:10` is false) | session GUC | **No** |
| **Worker** (Railway): research, screening, **outreach send**, import, routines, backup | `getOwnerPool()` — **owner role, RLS BYPASSED**, no `app.org_id` set | shared secret `RESEARCH_TRIGGER_SECRET`; isolation rests entirely on app-layer `where org_id` | **No** |
| **`/api/research`** | `getOwnerPool()`, **`orgId` from query param** (`route.ts:68`) | shared secret; a secret-holder can aim a run at any org | **No** |
| **`/api/webhooks/resend`** | `getOwnerPool()`, org resolved from the message row | svix signature | **No** |
| **Admin / provisioning** (`admin`, `login`, `join`) | owner pool + `supabaseAdmin()` service-role for auth user-mgmt | `requireOwner` + explicit `org_id` filters | **No** (expected: bootstrap) |

**`dispatchSkill` runtime callers = 0.** `SKILL_REGISTRY` has 4 skills (`explain_route`, `accept_participation`, `request_team_acceptance`, `send_partner_intro`); none is bound to any live surface. The effect-class boundary (R24 cross-tenant authority, idempotency, loop guard, `governed_action_invocations` audit) is real code exercised only by `governance-verify`/`closed-loop-verify`.

**Highest-signal exposures:**
1. **A cross-tenant write (`request_warm_intro`) is callable by the BYO LLM** with no governance.
2. **No agent/MCP mutation is governed** — no effect-class check, idempotency, loop guard, or audit invocation for agent-initiated writes.
3. **`/api/research` trusts an `orgId` query param on the RLS-bypassing owner pool.**
4. **The worker sends real outreach on the owner role** with no EXTERNAL_ACTION outbox governance and no DB-level tenant floor.

### 1.2 Auth / RLS boundary

- App connects as non-owner **`app_rw`**; owner is a separate `getOwnerPool()` keyed on `DATABASE_URL_OWNER`. `RISK-1-CUTOVER-STATE.md` says prod is flipped and RLS verified enforcing (count=0 with no org context) — **verified as current** (this supersedes the older `enterprise-risk-ledger.md`, which predates the cutover; the two docs conflict and must be reconciled).
- `withTenant` resolves org from the **verified Supabase session** via `resolve_user_org()` (SECURITY DEFINER), pins `app.org_id` as a transaction-local GUC, **fails closed**. ~67 call sites; only 3 residual direct `getPool()` in `src/app`.
- **Gaps:** `FORCE ROW LEVEL SECURITY` **not applied** (owner still bypasses); the **two-tenant blind isolation test has never been run** (prod has one org) — the exact thing a security reviewer asks for; owner-pool paths (§1.1) are RLS-exempt by construction.

### 1.3 Feature-flag model

- **Every flag is global `process.env`** (`PURSUITS/FACTS/ROUTING/PURSUIT_EXPERIENCE/FEDERATION/GOVERNED_ACTION/OUTCOME_LEARNING`), default OFF, with fail-safe dependency chains. **No per-tenant enablement exists** — the `organizations` table has only `id, name, created_at`; there is no `org_features`/entitlements table. Flipping a flag turns a capability on for **every** org in the deployment.
- **Good foundation:** synthetic-vs-real separation is real and row-level — `data_environment` + `is_simulated` on every learning table, and calibration reads use an **allow-list** `learningEligibleSql` = `PRODUCTION` only (`lib/pursuits/lineage.ts`). So synthetic outcomes are structurally excluded from calibration **as long as every calibration query uses that filter**.
- Only **5 flag gate sites** + nav plumbing — a bounded retrofit surface.
- **New-table RLS caveat:** the `0029/0030` "policy for every `org_id` table" loop was a **one-time snapshot**; every table since `0063` declares its own RLS. A new `org_features` table **must declare its own tenant policy** — it is not auto-covered.

### 1.4 Operational observability — the weakest area

- **No structured logging, no Sentry/telemetry, no request/correlation IDs** (~4 `console.*` in all of `src/`; the app self-admits this at `admin/page.tsx:908`). Worker logs are ephemeral Railway stdout.
- **No ops UI for the federation/governance loop.** `change_ledger`, `governed_action_invocations`, `recompute_requests`, `action_outbox`/`action_receipts` are written/read only by libraries and surfaced in **zero** app pages. A failed recompute, a stuck outbox row, or a governance denial is **invisible without direct SQL** — "why did this pursuit's action fail?" cannot be answered from the product.

### 1.5 Deployment / migration / backup / rollback

- **Topology:** Web app → Vercel (serverless, `pg.Pool` over the transaction pooler); Worker → Railway (long-lived, `setInterval` scheduler); DB → Supabase Postgres. Supabase CA embedded in code (a mangled env PEM once disabled verification in prod).
- **Migration hazard:** three runners exist and **disagree with prod reality** — prod's `schema_migrations` tracker is **stale at 0012** (0058–0062 applied by hand via SQL editor), so `npm run db:migrate` (what the README says to run) **would replay everything against prod**. This is an undocumented landmine.
- **Rollback:** migrations are **forward-only, no down-path**. The only documented rollback is RLS-level (repoint `DATABASE_URL` at owner → RLS inert). Schema rollback = restore a logical backup into a fresh project — **never rehearsed end-to-end**.
- **Backups:** logical `to_jsonb` dump lib + worker nightly + CLI exist, but are **OFF unless `BACKUP_DIR` is set**, single Railway volume, unencrypted, no offsite copy, no restore verification, whole-table-in-memory.
- **Regression suite:** 13 verify scripts (reduced `ws*_verify` tiers + full `pursuit_demo` under RLS) + unit tests — **not in CI**; "must stay green" is an unenforced manual convention run against local :5433.

### 1.6 What is already strong (do not rebuild)
`app_rw` RLS cutover done; `withTenant` fail-closed GUC discipline; the whole E governed substrate (dispatchSkill effect classes, outbox/receipts, recompute idempotency + loop guard, disclosure engine, data_environment learning allow-list); the D.5 UI; the two closed-loop hero scenarios. R1 **wires and proves** these, it does not re-architect them.

---

## PHASE 2 — TECHNICAL DESIGN (bounded R1 work)

Eight gated workstreams. Each ends with a targeted blind harness / runtime proof and holds every A→E invariant and production-safety rule. Ordering is dependency-driven; **G1–G3 are the release-blockers**, G4–G7 are the proof/robustness layer, G8 is the pilot scenario.

### R1-G1 — One mutation authority (govern all agent/MCP writes)
**Goal:** the chain **authz → consent → disclosure → governed skill → idempotency → audited invocation → mutation → event** applies to every commercial-state mutation, whatever the caller. No privileged bypass.
- Register the two MCP writes as governed skills and route them through `dispatchSkill`: `draft_touch` (INTERNAL_WRITE) and `request_warm_intro` (CROSS_TENANT_ACTION → requires an accepted ACTION grant per R24, not just an in-function partnership check). The domain fns (`upsertTouch`, `requestWarmIntro`) become the skills' bound handlers — one authority model, not a parallel one.
- **Remove `request_warm_intro` from the autonomous Ask LLM tool set** (or require explicit human approval per call); fix the false `agents/ask.ts:10` comment. A cross-tenant write must never be a free autonomous agent tool.
- Give MCP keys a **role** so `requiredPermission` is enforceable (today any live key can invoke writes).
- **Outreach send** (worker `drainScheduledTouches`, EXTERNAL_ACTION) routes through the governed outbox/receipt path rather than sending inline on the owner pool.
- **Bypass assertion:** a static check + a runtime test proving no MCP/agent/automation commercial-state write reaches a table without a `governed_action_invocations` row.
- **Design decision for sign-off (D1):** scope of "commercial-state mutation." Proposed boundary — governance applies to *commercial* actions (participation, route selection, drafts→sends, warm intros, outcomes); pure *intelligence-gathering* writes (evidence/facts/research_jobs) stay on the domain-service+RLS path and are **not** re-routed through dispatchSkill, but are moved off the owner-pool-no-GUC path for tenant-owned data (see G3).

### R1-G2 — Tenant-scoped feature flags (prove single-tenant enablement)
- New `org_features` table (PK `org_id → organizations`, one boolean per flag, **its own RLS policy** declared in-migration; default all-false). Additive; inert until read.
- Composition: **global env = deployment master kill-switch AND per-org flag = the tenant opt-in.** A capability is live for an org only if `env_on(flag) && org_features.flag`. Preserves the clean env-rollback and the fail-safe dependency chains; enables one pilot tenant without touching others.
- Thread `orgId` into the readers (`pursuitExperienceEnabled(orgId)` … `outcomeLearningEnabled(orgId)`); update the 5 gate sites + Shell plumbing.
- **Prove:** enabling the designated pilot org enables it for that org only; a second org stays dark. `OUTCOME_LEARNING_ENABLED` for the pilot org emits outcomes **scoped to that org**, and — because pilot outcomes are still `data_environment`-tagged and calibration uses the `PRODUCTION` allow-list — synthetic/demo outcomes cannot contaminate calibration.
- **Design decision (D2):** confirm the env-AND-org composition (vs. org-flag-only). Recommended: env-AND-org (keeps the global kill-switch).

### R1-G3 — Runtime cross-tenant isolation proof
- Apply **`FORCE ROW LEVEL SECURITY`** to tenant tables so even the owner role is bound (removes the belt-and-suspenders gap), verifying the owner-pool system paths still function with explicit `org_id` scoping.
- Audit every owner-pool path (§1.1): each must either set an explicit per-org GUC when it processes a single tenant, or be justified as a genuinely cross-tenant system job with documented app-layer scoping. **Fix `/api/research`** so `orgId` is not an unauthenticated query param controlling an owner-pool run.
- **The two-tenant blind isolation test in the deployed runtime** (two real authed users in two orgs) — the outstanding gold-standard sign-off. Plus **disclosure absence at the HTTP payload boundary**: assert a participant/outsider payload never contains a sponsor-only value (extends the D.5 payload probe to the federation read models).
- Consent + participant-withdrawal correctness (revoked grant / left participant loses access) proven in the running app.

### R1-G4 — Governed-action robustness (idempotency / retries / compensation / duplicates)
- Idempotency, loop guard, and the outbox/receipt path already exist and are unit-proven; R1 **proves them end-to-end through the running app** and fills gaps: duplicate-action submission dedupes to one invocation; a failed EXTERNAL_ACTION retries and does not double-send; a compensating action is recorded. No new mechanism unless a gap is found.

### R1-G5 — Recompute queue recovery
- Prove the recompute queue survives retries/worker restarts without corrupting history: a `RUNNING` request interrupted mid-drain is safely re-drained; append-only snapshots are never rewritten; as-of stays the event time. Add a drain caller in the worker (behind the tenant flag) so recompute actually runs in the pilot, and prove restart recovery.

### R1-G6 — Operational observability (diagnose without DB archaeology)
- A read-only **ops surface** (owner/admin-gated) over the governance loop: `change_ledger`, `governed_action_invocations` (status + reason), `recompute_requests` (pending/failed/suppressed), `action_outbox`/`action_receipts` (stuck/dead-lettered). Enough to answer "why did this pursuit's action/recompute fail?" from the product.
- Minimal **structured logging with a correlation/request id** threaded through `withTenant`, `dispatchSkill`, and the recompute drain, so a single pursuit/action/recompute is traceable across app + worker. Degraded-mode: a provider failure surfaces as a visible degraded state, not a silent gap.
- **Design decision (D3):** observability depth for R1 — proposed **minimum**: the ops read surface + correlation-id logging + degraded-mode flags. Full Sentry-class alerting stays on the roadmap (not R1).

### R1-G7 — Migration / backup / rollback rehearsal
- **Reconcile the prod migration tracker** (document the true applied state; a safe, idempotent prod-migration procedure; stop pointing the README at `db:migrate` for prod).
- A **documented rollback path** appropriate to the current architecture (RLS-level repoint for the app; logical-backup restore drill for schema), with a **rehearsed restore** into a throwaway target proving the dump→restore round-trips.
- Turn backups **on** for the pilot (set `BACKUP_DIR`), and document retention/encryption/offsite as pilot prerequisites.

### R1-G8 — The R1 proof scenario (A→E through the authenticated running app)
- One representative 3-org pilot scenario booted through the **real authenticated app** (real Supabase session, RLS as `app_rw`, per-tenant flags): **Vendor** contributes thesis/target/product; **Distributor** contributes only its scoped, consented transaction context; **Partner** contributes relationship/seller/capability context. Each org sees a **different disclosure-appropriate projection** of the *same* canonical Pursuit.
- Drive the full loop: observe → Facts → Pursuit intelligence → route eval → recommend → human selects → **governed action executes (through dispatchSkill)** → outcome/event → recompute → Today changes.
- Run **both** locked scenarios (happy path + adverse/resource-decline) through the authenticated app; they remain permanent regression tests (§6.5 of the platform record). No live distributor data — synthetic, `data_environment='DEMO'`, unmistakably separated from any real pilot tenant.

### R1 Definition of Done (traceability)
| DoD clause | Gate |
|---|---|
| every writable agent/MCP path routes through dispatchSkill; no privileged bypass | G1 |
| cross-tenant isolation proven in deployed runtime | G3 |
| disclosure-sensitive fields absent from unauthorized HTTP payloads | G3 |
| consent + participant withdrawal correct | G3 |
| governed actions idempotent + auditable | G1, G4 |
| recomputation survives retries/restarts without corrupting history | G5 |
| feature flags tenant-scoped, default dark | G2 |
| synthetic data cannot contaminate real calibration | G2 |
| both closed-loop scenarios pass through the authenticated app | G8 |
| A→E blind/regression suites remain green | all (regression gate each subphase) |
| documented rollback path | G7 |
| no production-readiness claim beyond what was tested | all (honest DoD) |

### Explicitly OUT of R1 scope
New features, scoring dimensions, federation abstractions, AI agents, marketplace, or integrations; live distributor data / live TD SYNNEX dependency; enabling any flag globally; full Sentry-class alerting (roadmap); a migrations down-path framework (rollback is restore-based for now).

### Production-safety posture (unchanged, release-blocking)
Flags default OFF (now also per-tenant dark); no production backfill without dry-run + explicit approval; no live distributor data; demo/synthetic provenance retained and separated; cross-tenant RLS release-blocking; disclosure absence tested at the served payload; recommendation ≠ decision ≠ action ≠ outcome; append-only/reconstructable history; Unknown ≠ zero/false/negative.

---

## Decisions needed before Phase 3 (sign-off)
- **D1 — Governed-mutation boundary:** confirm governance wraps *commercial-state* mutations (participation, route selection, drafts→sends, warm intros, outcomes, outreach send) while pure intelligence-gathering writes stay on the domain-service+RLS path (moved off owner-pool-no-GUC for tenant data). Or: a stricter "everything through dispatchSkill" reading (larger, includes the worker's research writes).
- **D2 — Flag composition:** confirm **global-env-AND-per-org** (env as master kill-switch, org flag as opt-in) vs. org-flag-only.
- **D3 — Observability depth for R1:** confirm the **minimum** (ops read surface + correlation-id logging + degraded-mode) with Sentry-class alerting deferred to roadmap.
- **D4 — Worker/owner-pool paths:** confirm R1 **hardens + isolation-tests** the owner-pool system jobs (FORCE RLS + explicit per-org GUC + fix `/api/research`) rather than re-architecting the worker onto `app_rw` (which would be a larger change than "harden what exists").
- **D5 — Pilot topology:** is the pilot a **single deployment with per-tenant flags** (recommended, matches G2), or a **dedicated deployment** for the design partner? This changes how much of G2 is on the critical path.

**HALT — awaiting design sign-off. No code will be written until these are approved or amended.**
