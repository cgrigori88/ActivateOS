# Pilot Operational Readiness — Final Report

**Status: HALTED FOR GO / NO-GO.** This report is the deliverable that precedes any
pilot. **No live flags have been enabled and no production mutation has been performed.**
Everything below was built and rehearsed locally and against disposable recovery
databases. Nothing has been executed against the real production deployment.

- **Date:** 2026-08-30
- **Scope:** A→E platform + Release Gate R1 (G1–G8) + Pilot Operational Readiness (OR-1/2/3)
- **Branch:** `claude/activateos-platform-review-xzkgmd`
- **tsc:** clean · **migrations:** 93 (latest `0093_pursuit_participant_select.sql`)

## Legend — execution-state labels (used throughout)

| Label | Meaning |
|---|---|
| **VERIFIED LOCALLY** | Proven on the local cluster / disposable DBs with a committed blind harness. |
| **READY FOR LIVE EXECUTION** | Exact operator commands + expected output + rollback are written; nothing about them is prod-specific beyond the connection string. |
| **REQUIRES OPERATOR CREDENTIALS** | Cannot proceed without a production credential / secret (DB URL, provider DSN, backup key) that this environment deliberately does not hold. |
| **NOT YET VERIFIED IN PRODUCTION** | Has never run against the real deployment or the real data volume; the local result does not transfer as a production guarantee. |

OR gates are additionally labeled with the required set: **LOCAL/REHEARSAL PASS**,
**LIVE EXECUTION REQUIRED**, **LIVE PASS BLOCKED**.

---

## 1. Environment actually tested

| | |
|---|---|
| Environment | **Local** — Postgres 16 on `127.0.0.1:5433`, Next dev app on `:3100`, `app_rw` under FORCE RLS |
| Data | **Synthetic / DEMO only** (`pursuit_demo`, throwaway rehearsal DBs). No live customer data touched. |
| Production | **NOT tested.** No production credentials were requested or held. Every production step below is an operator runbook, not a completed action. |

---

## 2. OR gate results (required labels)

| Gate | Local result | Live label | What remains for a true-prod PASS |
|---|---|---|---|
| **OR-1 Migration reconciliation** | **LOCAL/REHEARSAL PASS** — `migration-reconcile-rehearsal` 7/7; read-only state report + `--baseline` reconcile proven on a DB drifted to 0012 → parity with a clean rebuild. | **LIVE EXECUTION REQUIRED** | Operator runs the read-only report against prod, reviews, then reconciles (§8.1). |
| **OR-2 Backup / restore / recovery** | **LOCAL/REHEARSAL PASS** — `recovery-rehearsal` 16/16; encrypted dump → restore → schema+RLS+isolation+substrate parity → closed loop operable on the restored DB. | **LIVE EXECUTION REQUIRED** · **REQUIRES OPERATOR CREDENTIALS** (`BACKUP_ENCRYPTION_KEY`, prod URL) | One real backup+restore drill against the prod data volume to establish **true** RTO/RPO (§8.2). |
| **OR-3 Observability** | **LOCAL/REHEARSAL PASS** — `observability-verify` 13/13; correct event per failure class, correlation ids present, no confidential payload leaked, fail-safe when unconfigured. | **LIVE EXECUTION REQUIRED** · **REQUIRES OPERATOR CREDENTIALS** (provider DSN) | Wire a provider sink in prod and confirm one real event lands (§8.3). Until then the "an alert reached a human" claim is **LIVE PASS BLOCKED**. |

**No OR gate can be marked LIVE PASS.** Nothing has run against production. Each is
green locally and READY FOR LIVE EXECUTION.

---

## 3. Release invariant matrix (A→E + R1) — PASS / FAIL

All PASS are **VERIFIED LOCALLY** with committed blind harnesses (numbers = checks passing / failing).

| Invariant | Result | Evidence |
|---|---|---|
| Single mutation authority — every persistent commercial-state / external / cross-tenant mutation goes through `dispatchSkill` (UI, MCP, agent, automation alike); no privileged bypass | **PASS** | governed-mutation 13/0 · outbox 20/0 |
| Tenant isolation — FORCE RLS, `app_rw` non-owner, `app.org_id` GUC; owner-pool paths only for system contexts | **PASS** | isolation 12/0 + runtime 404 (§6) |
| Disclosure — two-dimension policy at the served-payload boundary; participant ≠ sponsor projection; absence hides existence | **PASS** | disclosure 21/0 + runtime (§5) |
| Tenant-scoped feature flags — env master AND per-org opt-in, fail-closed, audited | **PASS** | tenant-flags 13/0 |
| Governed external-action outbox — decision → dispatchSkill → outbox → executor → receipt → event/ledger; idempotent; dead-letter capped | **PASS** | outbox 20/0 |
| Event-driven recompute — as-of correctness, materiality, lease recovery, poison cap | **PASS** | recompute 20/0 · recompute-recovery 8/0 |
| Outcomes / attribution / experiments | **PASS** | outcomes 18/0 |
| Federation + federation-aware entity resolution | **PASS** | federation 19/0 · entity-resolution 11/0 · contributions 12/0 |
| Closed-loop hero scenarios (LOCKED regressions R38 happy + R39 adverse) | **PASS** | closed-loop 18/0 |
| Governance / consent enforcement | **PASS** | governance 15/0 |
| Observability instrumentation (Sentry-agnostic reporter) | **PASS** | observability 13/0 |
| Ops surface + correlation IDs | **PASS** | ops 10/0 |
| Migration idempotency + reconcile + backup round-trip | **PASS** | migration-reconcile 7/0 · release-rehearsal 8/0 · recovery 16/0 |
| **Pilot Readiness Rehearsal — 3-org authenticated, real runtime** | **PASS** | pilot-readiness 10/0 (§5) |

**0 failing checks across the suite.** No release invariant is FAIL.

---

## 4. Migration state

- **Codebase:** 93 migration files, latest `0093_pursuit_participant_select.sql`. All additive; no destructive statements.
- **Local:** clean rebuild from zero tracks all 93 (`release-rehearsal` R1-G7.1).
- **Idempotency:** every migration is create-if-not-exists / guarded, so a stale prod tracker (known to sit at ~0012) is **safe** — a replay of an applied file is a no-op, and `--baseline` can stamp evidence-applied files without running DDL.
- **Production:** **NOT YET VERIFIED IN PRODUCTION.** Reconcile per §8.1 before pilot.

---

## 5. Disclosure proof — through the real runtime

`pilot-readiness-rehearsal` booted the authenticated app (`app_rw`, FORCE RLS,
`FEDERATION_ENABLED` + `GOVERNED_ACTION_ENABLED` infrastructure on, `OUTCOME_LEARNING_ENABLED`
off) and resolved the **one** canonical hero Pursuit as each of three orgs over HTTP:

| Viewpoint | HTTP | Confidential figure `1.84M` | Raw `1840000` | Projection |
|---|---|---|---|---|
| **Vendor (sponsor)** | 200 | **present** | never sent | full decision surface |
| **Distributor (ACTIVE participant)** | 200 | **absent (suppressed)** | never sent | disclosure-safe participant view |
| **Outsider (non-participant)** | **404** | — | — | existence hidden (T11) |

Disclosure is enforced at the **served payload**, not by client hiding. **VERIFIED LOCALLY.**

---

## 6. Tenant isolation proof

- Runtime: the non-participant org receives 404 for the hero Pursuit through the running app; the recovered DB (§7) preserves the same isolation (outsider sees 0 pursuits, sponsor sees its own) under `app_rw` + `app.org_id`.
- FORCE RLS confirmed still enabled on `pursuits`, `change_ledger`, `governed_action_invocations`, `pursuit_participants`, `context_contributions` after a full restore.
- **VERIFIED LOCALLY** (isolation 12/0 + recovery-rehearsal isolation checks + runtime 404).

---

## 7. Backup / restore / recovery

- **Encryption at rest:** AES-256-GCM authenticated (`src/lib/backup/crypto.ts`); wrong key / tampered file rejected by the auth tag. **VERIFIED LOCALLY.**
- **Backup artifact produced (local, synthetic):** `pursuitos-backup-2026-08-30T22-31-27.json.gz.enc` — AES-256-GCM, 46 KB gz, 149 tables, 658 rows, schema `0093`. (Local artifact; not committed — `backups/` is private.)
- **Restore result:** restored into a disposable recovery DB; every substrate table at row parity with the source (**recovery-point coverage 18/18 substrate tables**), RLS + FORCE RLS intact, tenant isolation intact, and the closed-loop hero scenarios **PASS against the recovered DB** (operable, not merely row-equal).
- **Rehearsal-measured recovery time (NOT true production RTO/RPO):**
  - in-process restore ≈ **46 ms** (+ ≈2 ms decrypt/parse) on a 658-row synthetic volume;
  - operator CLI end-to-end ≈ **871 ms** (includes runtime startup).
  - These are **small-volume rehearsal figures**. **True production RTO/RPO are NOT YET VERIFIED IN PRODUCTION** and are only established by a real backup+restore drill against the live deployment and data volume (§8.2).

---

## 8. Production runbook (operator-run; nothing here has been executed)

Every command is **READY FOR LIVE EXECUTION** and, where noted, **REQUIRES OPERATOR CREDENTIALS**.
Run in order. Do not proceed past a step whose verification fails.

### 8.1 OR-1 — Reconcile the production migration tracker · LIVE EXECUTION REQUIRED
**Prereq:** a **read-only** prod `DATABASE_URL` (REQUIRES OPERATOR CREDENTIALS).
1. Read-only evidence (no writes):
   `DATABASE_URL='postgres://…READONLY…' npx tsx scripts/migration-state-report.ts`
   **Expected:** a BEFORE/AFTER table; untracked-but-present files classified `APPLIED_EVIDENCE`, genuinely-absent as `MISSING`.
2. Review. If `MISSING` is non-empty, inspect each file before applying.
3. Stamp evidence-applied files without running DDL:
   `DATABASE_URL='postgres://…RW…' npx tsx scripts/migrate.ts --baseline` (REQUIRES OPERATOR CREDENTIALS)
   **Expected:** "stamped …"; tracker count → 93.
4. Apply only genuinely-missing files: `npm run db:migrate` — **Expected:** "N applied" (N = MISSING count), else "0 applied".
5. **Verify:** re-run step 1 → tracker = 93, nothing `MISSING`.
**Rollback/abort:** migrations are forward-only and idempotent; `--baseline` writes only tracker rows (no schema change) and is reversible by deleting the stamped rows. Abort if step 1 shows unexpected `MISSING` core tables — do not blind-apply.

### 8.2 OR-2 — Backup + real restore drill · LIVE EXECUTION REQUIRED · REQUIRES OPERATOR CREDENTIALS
**Prereq:** prod `DATABASE_URL`, a strong `BACKUP_ENCRYPTION_KEY` (64-hex; store in the secret manager, **never** in the repo), an offsite destination, and a throwaway restore target.
1. Set `BACKUP_DIR` and `BACKUP_ENCRYPTION_KEY` in the deployment; confirm the nightly worker writes `…json.gz.enc`.
2. On-demand encrypted backup:
   `DATABASE_URL='postgres://…prod…' BACKUP_ENCRYPTION_KEY=… npx tsx scripts/backup-dump.ts /secure/backups`
   **Expected:** "encrypted at rest (AES-256-GCM)"; a `.enc` file; table/row summary.
3. Copy the `.enc` file offsite.
4. Restore into a **fresh** target (bootstrap + `db:migrate` first), timing it:
   `TARGET_DATABASE_URL='postgres://…restoreTarget…' BACKUP_ENCRYPTION_KEY=… npx tsx scripts/backup-restore.ts /secure/backups/<file>.enc --force`
   **Expected:** "restored N rows into M tables"; **record wall-clock = true RTO**; **backup age at restore = true RPO**.
5. **Verify:** spot-check row counts vs source and load a known Pursuit in the restored app.
**Rollback/abort:** restore targets a throwaway DB only (`TARGET_DATABASE_URL` is deliberately a different variable) — production is untouched. Abort if the auth tag rejects (wrong key/corrupt file) and re-copy from offsite.

### 8.3 OR-3 — Wire the observability provider · LIVE EXECUTION REQUIRED · REQUIRES OPERATOR CREDENTIALS
**Prereq:** a provider DSN/endpoint (REQUIRES OPERATOR CREDENTIALS). Core code depends only on the `Reporter` interface (`src/lib/obs/reporter.ts`), never provider-specific APIs.
1. Set `TELEMETRY_SINK` (+ provider env) in the deployment. With none set the reporter is a **no-op** and adds no runtime dependency (fail-safe, already verified).
2. Deploy. Trigger one controlled failure in a non-critical path.
3. **Verify:** the event appears in the provider with correlation/request/org/pursuit ids and **no** confidential facts, payloads, tokens, or route reasons.
**Rollback/abort:** unset `TELEMETRY_SINK` → reporter returns to no-op; no code change, no restart risk to tenant paths.

### 8.4 RLS/deploy rollbacks (reference)
- **Bad app deploy:** redeploy the previous build (no schema change).
- **RLS/cutover regression:** point `DATABASE_URL` at the owner string, redeploy (RLS inert), investigate, re-point at `app_rw`.
- **Data corruption:** provision fresh DB → bootstrap + `db:migrate` → `backup-restore` last good encrypted backup → cut over.

---

## 9. First-pilot flag matrix (produce before anything goes live)

Deployment model: **single deployment, per-tenant flags** (env master = infrastructure switch; per-org row = opt-in; both required, fail-closed).

| Capability | Global (env master) | Pilot org (per-org) | Everyone else |
|---|---|---|---|
| Pursuit experience | ON | ON | existing/default |
| Federation | ON (infrastructure) | ON | OFF |
| Governed actions | ON (infrastructure) | ON | OFF |
| External action execution | ON (infrastructure) | **narrowly ON** (specific action families) | OFF |
| Outcome capture | ON | ON | OFF |
| Outcome learning / calibration | **OFF** | **OFF initially** | OFF |
| Autonomous cross-tenant actions | **OFF** | **OFF** | OFF |
| Synthetic / demo data | isolated | isolated | isolated |

**Env masters that must be ON as infrastructure (proven required by the runtime rehearsal):**
`PURSUIT_EXPERIENCE_ENABLED`, `FEDERATION_ENABLED`, `GOVERNED_ACTION_ENABLED`.
_Note: with `FEDERATION_ENABLED` off, a participant is served the disclosure-filtered sponsor detail rather than the dedicated participant projection — the pilot boot must have it on._

**Per-org flags to set ON for the first design-partner tenant only** (`org_features`):
`pursuits, facts, routing, pursuit_experience, federation, governed_action`. Outcome capture is on (outcomes recorded, synthetic flagged); **`outcome_learning` stays OFF.**

**Flags that remain OFF (everywhere, including the pilot org):**
- `OUTCOME_LEARNING_ENABLED` / `outcome_learning` — learning/calibration dark; **must not be enabled using synthetic data as calibration material**.
- Autonomous cross-tenant actions — no automatic `CROSS_TENANT_ACTION`; every cross-tenant effect requires an explicit grant + human authority.
- `federation`, `governed_action`, external action execution for **all non-pilot orgs**.

---

## 10. Synthetic vs live execution separation

- All rehearsal/pilot data is `DEMO`/synthetic and `isSimulated`-flagged; the demo boots as isolated tenants.
- Outcome **learning** is gated behind `OUTCOME_LEARNING_ENABLED` (off) and must never be calibrated from synthetic data — enforced as a standing E-sign-off invariant.
- External-action execution defaults to a non-real provider unless explicitly allowed; the outbox dead-letters poison work rather than retrying blindly.

---

## 11. Unresolved risks / open items

1. **True production RTO/RPO unproven** — only the real backup+restore drill (§8.2) establishes them; rehearsal figures are small-volume. **NOT YET VERIFIED IN PRODUCTION.**
2. **Observability provider not wired** — until §8.3 runs in prod, "an alert reaches a human" is **LIVE PASS BLOCKED**.
3. **Prod migration tracker not reconciled** — §8.1 is a release-blocker for the pilot (safe, but must be done).
4. **`BACKUP_ENCRYPTION_KEY` / offsite copy** — must be set in the deployment secret manager before pilot; a backup is a full copy of tenant data.
5. **Backlog (non-blocking):** task #67 per-request scoped DB connections (owner-pool remains inert until cutover); parked UI items #46/#47.

---

## 12. Go / No-Go checklist

**Green now (VERIFIED LOCALLY):**
- [x] A→E + R1 (G1–G8) invariants — 0 failing checks across the harness suite
- [x] 3-org authenticated disclosure proof through the real runtime (10/10)
- [x] Encrypted backup → restore → recovered-DB operable (16/16)
- [x] Migration reconcile safe + rehearsed (7/7); tsc clean; 93 migrations additive

**Operator gates before go-live (LIVE EXECUTION REQUIRED — not yet done):**
- [ ] §8.1 Reconcile the **real** prod migration tracker → 93, nothing missing
- [ ] §8.2 Real backup + restore drill → record **true** RTO/RPO; `BACKUP_ENCRYPTION_KEY` + offsite set
- [ ] §8.3 Wire observability provider → confirm one real, redaction-safe event lands
- [ ] Set env masters (`PURSUIT_EXPERIENCE_ENABLED`, `FEDERATION_ENABLED`, `GOVERNED_ACTION_ENABLED`) ON; `OUTCOME_LEARNING_ENABLED` OFF
- [ ] Set the pilot org's per-org flags per §9; confirm every non-pilot org stays OFF (fail-closed)
- [ ] Confirm external action execution is narrowed to the intended action families for the pilot org

**Recommendation:** the platform is **architecturally and locally READY**; the remaining
work is **operator execution against production** (§8), not code. **No live flag has been
enabled and no production mutation performed. Halting for your go / no-go.**
