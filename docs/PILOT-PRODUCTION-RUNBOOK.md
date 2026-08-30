# Pilot Production Commissioning Runbook

**Single consolidated package to take PursuitOS from its current rehearsed state to a
first authenticated design-partner pilot.** This document is instructions only. It
performs nothing. Every production step is an explicit operator action, gated on a
credential this environment deliberately does not hold.

> **Status honesty.** No known application-code blocker remains from the completed
> readiness scope (A→E + R1 + OR-1/2/3, 0 failing checks locally). **Production
> commissioning and live verification remain.** Nothing in this runbook has been executed
> against production. RPO/RTO figures are **rehearsal-measured** until the real exercise
> in §2 is completed.

**Locked and unchanged:** all A→E and R1 invariants — single mutation authority through
`dispatchSkill`, FORCE RLS tenant isolation, two-dimension disclosure, tenant-scoped
fail-closed flags, governed external-action outbox, event-driven recompute, dark outcome
learning. This runbook enables nothing new and weakens nothing.

**Execution-state labels:** `READY FOR LIVE EXECUTION` · `REQUIRES OPERATOR CREDENTIALS`
· `NOT YET VERIFIED IN PRODUCTION`. Local proofs are `VERIFIED LOCALLY`.

**Credentials the operator supplies (never in the repo):** production `DATABASE_URL`
(read-only and read-write forms), `DATABASE_URL_OWNER` (owner-pool), `BACKUP_ENCRYPTION_KEY`,
an offsite backup destination, a throwaway restore target URL, and any observability
provider endpoint. Set TLS verification with `DATABASE_CA_CERT` (or `DATABASE_CA_PATH`).

---

## 1. OR-1 — Production migration reconciliation

**Goal:** make the production tracker match the 93-file codebase without a blind replay.
**No automatic migration execution — inspection first, decision second, apply only on operator command.**

### 1.1 Read-only inspection FIRST (no writes) · READY FOR LIVE EXECUTION · REQUIRES OPERATOR CREDENTIALS
```
DATABASE_URL='postgres://…READ-ONLY…' MIGRATION_REPORT_JSON=1 \
  npx tsx scripts/migration-state-report.ts
```
This connects, probes for the objects each migration creates, and prints a BEFORE/AFTER
picture. It **never writes**. (Optionally `npx tsx scripts/migrate.ts --dry-run` also lists
what a run *would* apply, without applying.)

### 1.2 Expected migration state
- `files in codebase: 93`.
- A healthy prod already at current schema → `tracked` near 93, `MISSING 0`.
- The known drift case → `tracked ~12`, the rest classified `APPLIED_EVIDENCE` (objects exist), `MISSING 0`.

### 1.3 How to read each signal
| Report line | Meaning | Implication |
|---|---|---|
| `TRACKED` | file is in `schema_migrations` | nothing to do |
| `APPLIED_EVIDENCE` | untracked, but its tables/functions **exist** | stale tracker → **baseline-stamp**, do not re-run |
| `MISSING` | untracked and its objects **absent** | genuinely not applied → **apply** |
| `NO_DDL_SIGNAL` | alter-/data-only; can't be evidenced | treat by position; spot-check manually |
| duplicate application | same objects, tracker double-counts | not possible via runner (idempotent + tracked once); if seen, **halt** |

### 1.4 Decision tree
```
run 1.1 read-only report
├─ MISSING = 0 and APPLIED_EVIDENCE = 0 and tracked = 93 → DONE (already reconciled)
├─ MISSING = 0 and APPLIED_EVIDENCE > 0 (stale tracker)
│     → BASELINE:  npx tsx scripts/migrate.ts --baseline     (stamps evidence-applied, NO DDL)
│     → verify 1.6 → tracker = 93
├─ MISSING > 0 and every MISSING file reviewed & expected
│     → (baseline first if APPLIED_EVIDENCE > 0) then APPLY:  npm run db:migrate   (applies only missing)
│     → verify 1.6
└─ anything unexpected (core table MISSING, NO_DDL_SIGNAL on a data migration you can't confirm,
   report error, tracker > 93) → HALT, do not apply, escalate.
```

### 1.5 Apply commands (only after a decision above) · REQUIRES OPERATOR CREDENTIALS
- Baseline-stamp (no schema change): `DATABASE_URL='…RW…' npx tsx scripts/migrate.ts --baseline` → "stamped …".
- Apply missing (idempotent): `DATABASE_URL='…RW…' npm run db:migrate` → "N applied, M already tracked".

### 1.6 Verify
Re-run 1.1 → `tracked = 93`, `MISSING = 0`. A follow-up `db:migrate` reports `0 applied`.

### 1.7 Abort conditions (stop, do not apply)
- The report errors or cannot connect read-only.
- A **core** table (organizations, pursuits, change_ledger, governed_action_invocations) shows `MISSING` on a prod believed to be live.
- `tracked > 93`, or filenames in the tracker not present in the codebase.
- Any `NO_DDL_SIGNAL` migration whose effect you cannot independently confirm.
- Rollback note: `--baseline` writes only tracker rows (no schema change) and is reversible by deleting exactly those rows; forward migrations are idempotent, so a re-run is safe, but **there is no down-path** — recovery from a bad apply is restore-based (§2, §4 of the readiness report).

---

## 2. OR-2 — Production backup / restore verification

**Goal:** prove one real encrypted backup restores into an **isolated** recovery
environment and passes full integrity — and measure true durations. **Never restore over the live DB.**

### 2.1 Prerequisites (encrypted offsite destination) · REQUIRES OPERATOR CREDENTIALS
- `BACKUP_ENCRYPTION_KEY` — a 64-char hex key (`openssl rand -hex 32`) or a strong passphrase, stored **only** in the deployment secret manager. Losing it makes backups unrecoverable; leaking it exposes all tenant data.
- `BACKUP_DIR` — a private path the nightly worker writes to; `BACKUP_KEEP` (default 14) rotation.
- An **offsite** destination (object storage) with encryption-at-rest and restricted access; the `.enc` file is copied there after each backup.
- A **throwaway** restore-target Postgres (`TARGET_DATABASE_URL`) — never production.

### 2.2 Backup (configuration + on-demand) · READY FOR LIVE EXECUTION · REQUIRES OPERATOR CREDENTIALS
- Scheduled: set `BACKUP_DIR` + `BACKUP_ENCRYPTION_KEY` in the worker; confirm it emits `pursuitos-backup-<ts>.json.gz.enc` nightly.
- On demand (time it — **backup duration**):
```
time DATABASE_URL='postgres://…prod…' BACKUP_ENCRYPTION_KEY='…' \
  npx tsx scripts/backup-dump.ts /secure/backups
```
Expected: `encrypted at rest (AES-256-GCM)`, a `.enc` file, and a table/row summary. Copy the file offsite.

### 2.3 Encryption / key handling requirements
- AES-256-GCM (authenticated): confidential **and** tamper-evident. A wrong key or altered byte fails the auth tag on restore.
- Key lives in the secret manager only; rotate by re-encrypting new backups under a new key (old backups still need the old key — retain per policy).
- Never commit a `.enc` file or the key; `backups/` is gitignored.

### 2.4 Integrity verification (before trusting a backup)
- `isEncrypted` header present (magic `POSAENC1`), file is not a plaintext gzip.
- A deliberate wrong-key decrypt must fail (auth tag) — proves tamper-evidence.
- (These exact checks are the ones `scripts/recovery-rehearsal.ts` runs; 16/16 locally.)

### 2.5 Restore into an ISOLATED recovery environment (never live) · REQUIRES OPERATOR CREDENTIALS
Provision a fresh target, apply schema, then restore (time it — **restore duration**):
```
# fresh target: bootstrap + migrate to 93 first, then:
time TARGET_DATABASE_URL='postgres://…RECOVERY-only…' BACKUP_ENCRYPTION_KEY='…' \
  npx tsx scripts/backup-restore.ts /secure/backups/<file>.enc --force
```
`TARGET_DATABASE_URL` is a **different variable** from `DATABASE_URL` by design — production cannot be hit by accident.

### 2.6 Recovery verification (time it — **recovery verification duration**)
Confirm on the restored DB:
- **Schema / migration:** tracker = 93; table set matches.
- **Row parity:** per-substrate counts match the source (participants, grants, contributions, governed actions, outbox, receipts, outcomes, attribution, recompute, ledger, entity resolution).
- **RLS / FORCE RLS:** still enabled on the core tenant tables (owner not exempt).
- **Tenant isolation:** under `app_rw` + `app.org_id`, the sponsor sees its pursuits, a non-participant sees zero.
- **Closed-loop operability:** the LOCKED hero scenarios run green **against the restored DB** (`DATABASE_URL_VERIFY='…recovery…' npx tsx scripts/closed-loop-verify.ts`).

### 2.7 Metrics — measure and label distinctly (do NOT call these production RTO/RPO yet)
| Metric | How | Rehearsal reference (synthetic, small volume) |
|---|---|---|
| Backup duration | `time` on 2.2 | — |
| Restore duration | `time` on 2.5 | in-proc ≈46 ms / CLI ≈871 ms @ 658 rows |
| Recovery verification duration | `time` on 2.6 | closed-loop + parity in seconds |
| **Estimated achievable RPO** | = max backup interval + copy-to-offsite lag (nightly ⇒ ≤ ~24 h unless more frequent) | — |
| **Measured recovery rehearsal time** | sum of restore + verification on the drill | recovery-rehearsal 16/16 |
| **Production RTO/RPO** | **NOT YET VERIFIED IN PRODUCTION** — only the real drill on the live volume establishes these | — |

---

## 3. OR-3 — Production observability activation

**Provider-agnostic boundary is preserved.** Core code depends only on the `Reporter`
interface (`src/lib/obs/reporter.ts`) and never on a provider's SDK.

### 3.1 What is wired today (accurate)
- Selectable sinks in core: `null` (default, no-op, fail-safe) and `console` (structured JSON to stdout). A dedicated SaaS adapter (Sentry/Datadog) is **not** in core by design — adding one is a small, isolated code change (a new `Reporter` module + one branch in `getReporter()`), out of the completed readiness scope. The production-safe activation available **now** uses `console` + the host log drain.

### 3.2 Exact configuration · READY FOR LIVE EXECUTION · (provider endpoint) REQUIRES OPERATOR CREDENTIALS
- `TELEMETRY_SINK=console` — emit structured telemetry JSON to stdout, ingested by the deployment's log pipeline / alerting.
- `APP_ENV=production` — stamps `environment` on every event.
- (If a SaaS provider is desired: land its `Reporter` adapter module, extend `getReporter()` to select it on `TELEMETRY_SINK=<name>`, and set the provider's endpoint/DSN env. This is a code change + review, then redeploy.)

### 3.3 Controlled production-safe test event
Trigger one bounded failure on a **non-critical** path (e.g. a governed action dispatched by a viewer role → a `dispatch_skill` reject event; or a deliberately dead-lettered `test.echo` outbox job → a `dead_letter` event). Do **not** use real customer data.

### 3.4 Verify correlation IDs + tenant-safe metadata
Confirm the event carries: `kind`, `severity`, `timestamp`, `environment`, and the ids present for that path (`correlationId`, `requestId`, `orgId`, `pursuitId`, `actionInvocationId`, `recomputeRequestId`, `provider`, `effectClass`, `retryCount`).

### 3.5 Confirm no confidential emission (redaction by construction)
`TelemetryEvent` has **no** free-form payload/data field — only ids, typed metadata, and a short safe `message`. Confirm the emitted event contains **no** raw customer data, confidential facts, **confidential route reasons**, secrets/tokens, or cross-tenant content. (This is exactly what `observability-verify` asserts, 13/13: a `CONFIDENTIAL-…-DONOTLEAK` arg never appears in any telemetry field.)

### 3.6 Alert delivery + degraded-mode
- **Delivery:** confirm the sink/log pipeline raises an alert to a human for `severity: error|critical` (dead-letter, tenant-isolation, recovery failure).
- **Degraded mode:** with `TELEMETRY_SINK` unset the reporter is a no-op and adds **no** runtime dependency; `reportEvent` never throws into the request/execution path. Verify a telemetry outage does not affect serving.

---

## 4. First-pilot flag matrix

Enforcement: **`live_for(org, flag) = envMaster(flag) AND org_features.flag`.** Both required;
**absent env master OR absent tenant row ⇒ OFF (fail-closed).** Inspect/verify with
`scripts/pilot-flags.ts --list` (read-only); set one audited flag with a single `--set`.

| Flag | Layer | Classification | Notes |
|---|---|---|---|
| `PURSUITS_ENABLED` | env master | **ENABLE GLOBALLY** | infrastructure; existing capability |
| `FACTS_ENABLED` | env master | **ENABLE GLOBALLY** | infrastructure |
| `ROUTING_ENABLED` | env master | **ENABLE GLOBALLY** | infrastructure |
| `PURSUIT_EXPERIENCE_ENABLED` | env master | **ENABLE GLOBALLY** | infrastructure; per-org row gates who sees it |
| `FEDERATION_ENABLED` | env master | **ENABLE GLOBALLY** (infrastructure) | required on for the participant projection; per-org gates reach |
| `GOVERNED_ACTION_ENABLED` | env master | **ENABLE GLOBALLY** (infrastructure) | per-org gates reach |
| `OUTCOME_LEARNING_ENABLED` | env master | **MUST REMAIN OFF** | learning/calibration dark; never calibrate on synthetic data |
| `OUTREACH_AUTOSEND` (worker) | worker env | **NOT USED IN PILOT** (default off) | real external send; even on, only affects `PRODUCTION` data with a wired provider family. Turn on **only** for a specific, wired, human-approved send — never as blanket enablement |
| `org_features.pursuits/facts/routing/pursuit_experience` | per-org | **ENABLE FOR PILOT ORG ONLY** | the pilot tenant opts in |
| `org_features.federation` | per-org | **ENABLE FOR PILOT ORG ONLY** | |
| `org_features.governed_action` | per-org | **ENABLE FOR PILOT ORG ONLY** | |
| `org_features.outcome_learning` | per-org | **MUST REMAIN OFF** | including the pilot org initially |
| `TELEMETRY_SINK` | env | **ENABLE GLOBALLY** (`console`) | observability; see §3 |

**Dependencies + required activation order** (each conjunct = env master AND per-org):
```
experience     = pursuits ∧ facts ∧ routing ∧ pursuit_experience
federation     = experience ∧ federation
governed_action= federation ∧ governed_action
outcome_learning = experience ∧ outcome_learning     (stays OFF)
```
Order: **(1)** set env masters globally (pursuits, facts, routing, pursuit_experience, federation, governed_action ON; outcome_learning OFF) → **(2)** pilot org per-org, in dependency order: pursuits/facts/routing → pursuit_experience → federation → governed_action. Never enable a downstream flag before its prerequisite; the resolver fails closed if you do.

**Everyone else stays dark:** every non-pilot org keeps `federation`, `governed_action` (and external send) OFF. Do not touch their rows.

---

## 5. Pilot activation sequence

Ordered from the current state to the first authenticated pilot. **No bulk activation** —
one flag per step, precondition before each externally visible/irreversible action,
verification after each, rollback beside each enable.

| # | Action | Precondition | Verify | Rollback |
|---|---|---|---|---|
| 0 | OR-1 reconcile prod tracker (§1) | read-only report reviewed | tracker = 93, MISSING 0 | restore-based only (no down-path) |
| 1 | OR-2 real backup + isolated restore drill (§2) | encryption key + offsite + recovery target set | recovery verification green; record durations | drill is isolated; nothing to roll back |
| 2 | OR-3 set `TELEMETRY_SINK=console`, `APP_ENV=production`; redeploy | log pipeline ready | controlled test event lands, redaction-safe (§3) | unset `TELEMETRY_SINK` → no-op |
| 3 | Set env masters ON (pursuits, facts, routing, pursuit_experience, federation, governed_action); `OUTCOME_LEARNING_ENABLED` **unset/off**; `OUTREACH_AUTOSEND` **off**; redeploy | steps 0–2 done | `pilot-flags.ts --list` shows masters ON, outcome_learning off | unset the master → capability dark platform-wide |
| 4 | Confirm every non-pilot org is dark | — | `pilot-flags.ts --list` → non-pilot orgs `(none)` for federation/governed | n/a (read) |
| 5 | Pilot org: enable `pursuits`,`facts`,`routing` (per-org) | pilot org id confirmed | `--list --org <id>` shows them ON | `--set <flag> --off` (audited) |
| 6 | Pilot org: enable `pursuit_experience` | step 5 ON | pilot user loads `/pursuits` (200) | `--set pursuit_experience --off` |
| 7 | Pilot org: enable `federation` | step 6 ON | participant projection engages (sponsor 200 w/ figure; participant 200 suppressed; outsider 404) | `--set federation --off` |
| 8 | Pilot org: enable `governed_action` | step 7 ON | a governed action dispatches + audits; cross-tenant refused without grant | `--set governed_action --off` |
| 9 | First authenticated pilot session | steps 0–8 verified | disclosure + isolation hold live; outcomes captured, learning dark | disable any per-org flag; unset a master to kill platform-wide |
| — | (Deferred) external send | a wired provider family + explicit human-approved send | only that family + `PRODUCTION` data sends | `OUTREACH_AUTOSEND` off |

Enable-one, verify, proceed. If any verify fails, roll back that step and halt.

Example audited enable (step 7):
```
DATABASE_URL='postgres://…owner/RW…' PURSUIT_EXPERIENCE_ENABLED=1 FEDERATION_ENABLED=1 \
  npx tsx scripts/pilot-flags.ts --org <PILOT_ORG_UUID> --set federation --on \
  --reason "pilot commissioning" --changed-by "<operator>"
```

---

## 6. Go / No-Go gate

Pilot may proceed only when **every** item is checked. Nothing below is checked yet.

- [ ] **OR-1 LIVE PASS** — prod migration tracker reconciled to 93, MISSING 0 (§1)
- [ ] **OR-2 LIVE PASS** — a real encrypted backup **successfully restored to an isolated recovery** env; integrity + parity + RLS/FORCE RLS + isolation + closed-loop all green; true durations recorded (§2)
- [ ] **OR-3 LIVE PASS** — a controlled **observability event received** by the sink/alert path (§3)
- [ ] migration state reconciled (matches §1 verify)
- [ ] real encrypted backup successfully restored to isolated recovery (matches §2)
- [ ] observability event received (matches §3)
- [ ] **tenant isolation verified** live — non-participant 404 / zero cross-tenant read
- [ ] **disclosure absence verified** live — participant payload lacks the confidential figure; outsider cannot see existence
- [ ] **synthetic data cannot generate external actions** — DEMO/non-PRODUCTION data never sends (real send requires `PRODUCTION` data AND `OUTREACH_AUTOSEND=on` AND a wired provider family)
- [ ] **all non-pilot tenants remain dark** — `pilot-flags.ts --list` shows federation/governed OFF for every non-pilot org
- [ ] **pilot flags reviewed** — env masters + pilot-org per-org set exactly per §4; `outcome_learning` OFF; `OUTREACH_AUTOSEND` off
- [ ] **rollback path validated** — each per-org flag disables via audited `--set … --off`; each master unsets to dark; recovery is restore-based

**Recommendation:** no known application-code blocker remains from the completed readiness
scope; the remaining work is production commissioning and live verification per §1–§5,
then this gate. **This runbook performs no production operation. Halt for operator action
and final go/no-go.**
