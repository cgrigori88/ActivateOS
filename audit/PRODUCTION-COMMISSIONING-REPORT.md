# Production Commissioning / Controlled Pilot Validation — Report

**Date:** 2026-08-30 · **Branch:** `claude/activateos-platform-review-xzkgmd` · **tsc:** clean · **migrations:** 93

> ## Headline
> The **controlled pilot demo is commissioned and spectacular on the real application
> stack** (production architecture, real `app_rw` + FORCE RLS, canonical UI), populated
> with clearly-labeled synthetic data, with tenant isolation, server-side disclosure, and
> audited flag rollback all **VERIFIED LOCALLY**. Every unsafe capability is **OFF**.
>
> The **production commissioning gates cannot be marked LIVE PASS** — the §0 Production
> Preflight production values (prod environment identity, read-only + scoped-write
> `DATABASE_URL`s, `BACKUP_ENCRYPTION_KEY` + offsite destination, telemetry destination,
> pilot-org UUID, operator authorization) **were not supplied in this request.** Per the
> §0 invariant *"never infer or auto-select a production target,"* I did **not** substitute
> a target (a `DATABASE_URL` present in `.env.local` was deliberately **not** used). Those
> gates are **BLOCKED pending operator-supplied production inputs.** Nothing ran against
> production; no irreversible or customer-facing external-action capability was enabled.

**Label legend:** `VERIFIED LOCALLY` · `BLOCKED — needs operator prod input` · `NOT VERIFIED IN PRODUCTION`.

---

## 1. What was commissioned (VERIFIED LOCALLY)

- The **real Next application** booted against `pursuit_demo` under `app_rw` + FORCE RLS, pilot-representative env masters (`PURSUIT_EXPERIENCE_ENABLED`, `FEDERATION_ENABLED`, `GOVERNED_ACTION_ENABLED` on; `OUTCOME_LEARNING_ENABLED` off; `OUTREACH_AUTOSEND` unset).
- A **single controlled pilot org** (Vertex Systems) as sponsor, plus a distributor participant (TD SYNNEX (demo)) and a non-participant/guest (Meridian) — the federation cast for the hero.
- A **populated, coherent synthetic book of business** (additive, `scripts/demo-enrich.ts`): +7 scored accounts, +10 opportunities ($5.89M pipeline), +7 pursuits, +3 outcomes, +3 composed (unsent) campaigns — every record DEMO/`is_simulated` and visibly labeled.
- The **canonical PursuitOS design system and IA preserved** (no redesign): left rail, glass/tinted bento, hairline boundaries, semantic dimension colors, light/dark parity, mobile decision-first ordering.

### Demo hero scenario (preserved, the centerpiece)
The Globex virtualization-modernization Pursuit — **Vendor (Vertex) → Reseller (CDW) → Customer (Globex)** with **Distributor (TD SYNNEX)** federated in — carries: modernization trigger, legacy-virtualization condition, incomplete timing evidence ("no verified timing anchor"), partner-route comparison (CDW vs WWT vs Direct), recommended route (CDW), **human override to WWT** ("recommendation preserved"), role readiness, the **internal-vs-shareable disclosure split** (the confidential "$1.84M … through TD SYNNEX" is present only in the sponsor payload and *absent from the partner payload, not hidden in the browser*), material-change history, governed actions with effect classes, and an outcome trail.

---

## 2. Exact environment + flag-state matrix

**Environment (local, real app):** Postgres `127.0.0.1:5433/pursuit_demo`; app `:3100`; `DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo`; Supabase auth env empty (demo/basic-auth). **Not a production deployment.**

**Env masters (deployment kill-switch) as run:**

| Master | State | Class |
|---|---|---|
| `PURSUITS_ENABLED` / `FACTS_ENABLED` / `ROUTING_ENABLED` | ON | infrastructure |
| `PURSUIT_EXPERIENCE_ENABLED` | ON | infrastructure |
| `FEDERATION_ENABLED` | ON | infrastructure (required for participant projection) |
| `GOVERNED_ACTION_ENABLED` | ON | infrastructure |
| `OUTCOME_LEARNING_ENABLED` | **OFF** | MUST REMAIN OFF |
| `OUTREACH_AUTOSEND` (worker) | **unset → external send DARK** | MUST REMAIN OFF until separately authorized |
| `TELEMETRY_SINK` | unset locally (`console` for pilot) | observability |

**Per-org flags (`org_features`), live-resolved = envMaster AND per-org:**

| Org | Role | pursuits/facts/routing | pursuit_experience | federation | governed_action | outcome_learning |
|---|---|---|---|---|---|---|
| Vertex Systems `379b34b3…` | **pilot sponsor** | ON | ON | ON | ON | **OFF** |
| TD SYNNEX (demo) `50b5e9e6…` | distributor participant | ON | ON | ON | ON | OFF |
| Meridian `aabc5fbd…` | guest / non-participant | ON | ON | ON | ON | OFF |
| _any new org_ | — | **(none — dark, fail-closed)** | — | — | — | — |

_In production, only the single pilot org receives these; every other tenant's row is absent → dark (fail-closed), demonstrated below._

---

## 3. OR-1 / OR-2 / OR-3 status

| Gate | Local | Production | Blocker |
|---|---|---|---|
| **OR-1 migration reconciliation** | LOCAL/REHEARSAL PASS (reconcile 7/7; clean-rebuild = 93) | **BLOCKED — LIVE EXECUTION REQUIRED** | needs read-only prod `DATABASE_URL` to run `scripts/migration-state-report.ts` |
| **OR-2 backup / restore / recovery** | LOCAL/REHEARSAL PASS (`recovery-rehearsal` 16/16; encrypted round-trip; recovery-point coverage 18/18) | **BLOCKED — LIVE EXECUTION REQUIRED** | needs prod `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, offsite + isolated restore target |
| **OR-3 observability** | LOCAL/REHEARSAL PASS (`observability-verify` 13/13; redaction-safe; fail-safe) | **BLOCKED — LIVE PASS BLOCKED** | core ships only `null`/`console` sinks — a real provider adapter must be wired (kept behind the provider-agnostic `Reporter` boundary) + a prod telemetry destination supplied |

None is LIVE PASS. Full operator procedures: `docs/PILOT-PRODUCTION-RUNBOOK.md` §1–§3.

**On OR-3 specifically:** the abstraction the platform built (`src/lib/obs/reporter.ts`, provider-agnostic `Reporter`) is the right seam — keep it. Wiring Sentry/Datadog is a small isolated adapter (a new `Reporter` + one `getReporter()` branch) selected by env; the core stays vendor-neutral. That adapter is a code change outside the completed readiness scope and is a prerequisite for OR-3 LIVE PASS.

---

## 4. Tenant-isolation + disclosure evidence (VERIFIED LOCALLY, served-payload boundary)

`scripts/pilot-readiness-rehearsal.ts` against the running app — **10/10**, one canonical hero Pursuit, three orgs:

| Viewpoint | HTTP | Confidential `1.84M` | Raw `1840000` |
|---|---|---|---|
| Vendor (sponsor) | 200 | **present** | never sent |
| Distributor (participant) | 200 | **absent (suppressed)** | never sent |
| Non-participant | **404** | — | — |

An unauthorized org receives **no pursuit information** (404, existence hidden); the confidential internal reason is **absent from the partner payload at the server**, not merely hidden in the browser. `isolation-verify` 12/0 and the full regression suite corroborate (closed-loop 18 · disclosure 21 · outbox 20 · recompute 20 · federation 19 · outcomes 18 · governance 15 · tenant-flags 13 · governed-mutation 13 · ops 10 · recompute-recovery 8; standalone rehearsals: recovery 16 · release 8 · migration-reconcile 7).

---

## 5. Rollback evidence (VERIFIED LOCALLY)

Via the audited `scripts/pilot-flags.ts` (writes `org_features` + append-only `org_feature_changes`):

- **Fail-closed default:** a fresh org shows `ON: (none — dark, fail-closed)`.
- **Enable → live:** `pursuit_experience --on` ⇒ `live_for = envMaster(ON) AND org_features(true) ⇒ LIVE` (audited).
- **Rollback → dark:** `pursuit_experience --off` ⇒ `⇒ DARK` (audited); org returns to `(none — dark)`.
- Every enable has a one-command audited rollback (runbook §5 rollback column); no bulk activation — one flag at a time.

---

## 6. Safety posture — nothing unsafe is enabled

| Capability | State |
|---|---|
| `OUTREACH_AUTOSEND` / autonomous outbound email/messaging | **OFF** (unset) |
| Autonomous warm-intro execution | OFF (governed; requires grant + human) |
| Unrestricted cross-tenant writes | OFF (cross-tenant refused without an ACTION grant) |
| Bulk feature activation | not used (one-flag-at-a-time) |
| Production-wide outcome learning/calibration | OFF (`OUTCOME_LEARNING_ENABLED` off) |
| Irreversible external side effects | none possible — real send requires `dataEnvironment=PRODUCTION` **and** `OUTREACH_AUTOSEND=on` **and** a wired provider family; **all demo data is `DEMO` → simulated only** |

**Synthetic data cannot trigger external actions** — verified by the executor gate (`real = dataEnvironment==="PRODUCTION" && allowRealProvider`). Demo sends simulate. The 3 seeded campaigns are **composed/approved but NONE sent** — the safe-demo representation of outreach.

---

## 7. Remaining risks / limitations

1. **OR-1/2/3 not run against production** — LIVE PASS requires operator-supplied prod inputs (runbook §0). **BLOCKED**, by design.
2. **OR-3 provider adapter not written** — vendor-neutral seam exists; a Sentry/Datadog adapter + prod destination is still required for OR-3 LIVE PASS.
3. **Demo breadth honestly bounded:** Accounts show `unmapped` partners (partner↔account mapping not seeded); **Outreach Analytics funnel reads 0** because no external send occurred (the safety boundary) — campaigns are shown composed, not sent; Motions/“Pending approvals” is empty (the motion designer is a live-action flow). These are truthful empty/─ states, not broken screens.
4. **Local ≠ production deployment:** the app runs under the real RLS/auth *semantics* locally, but not on the production deployment or data volume; true RTO/RPO and prod isolation are only established live.
5. Backlog (non-blocking): task #67 owner-pool cutover; parked UI items #46/#47.

---

## 8. Design Partner Demo Readiness checklist

- [x] Real application + production architecture (app_rw, FORCE RLS, governed actions)
- [x] Canonical UI/design system + navigation preserved (light/dark parity, mobile)
- [x] Synthetic/DEMO data clearly labeled ("Demo environment", "demo"/"synthetic" badges)
- [x] Hero story end-to-end (trigger → evidence → route → override → disclosure split → federation → outcome)
- [x] Breadth populated: Today, Pursuits, Accounts, Pipeline, Campaigns (composed), hero Pursuit
- [x] Tenant isolation + server-side disclosure absence demonstrable live (10/10)
- [x] External actions approval-gated / simulated — no live customer side effect possible
- [x] Screenshots captured (desktop light/dark + mobile) — §9
- [x] The claim holds: *"This is PursuitOS on the real application and production architecture; the commercial data here is illustrative synthetic data, and external actions are approval-gated."*
- [ ] Production LIVE PASS (OR-1/2/3) — **awaiting operator prod inputs (runbook §0)**

**Boot the demo:**
```
npx tsx scripts/demo-db.ts && npx tsx scripts/demo-stories.ts
DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo \
  NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
  PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 PURSUIT_EXPERIENCE_ENABLED=1 \
  FEDERATION_ENABLED=1 GOVERNED_ACTION_ENABLED=1 PORT=3100 npx next dev -p 3100
```

---

## 9. Screenshots index (`audit/demo-screens/`)

Desktop light + (parity) dark + mobile, captured from the running app:

- **Today** — `today.desktop-light.png`, `today.desktop-dark.png`, `today.mobile-light.png`
- **Pursuits** — `pursuits.desktop-light.png`, `pursuits.mobile-light.png`
- **Hero Pursuit** (disclosure split) — `pursuit-hero.desktop-light.png`, `pursuit-hero.desktop-dark.png`, `pursuit-hero.mobile-light.png`
- **Accounts** — `accounts.desktop-light.png`
- **Pipeline** — `pipeline.desktop-light.png`, `pipeline.desktop-dark.png`, `pipeline.mobile-light.png`
- **Partners / Campaigns / Analytics / Insights / Sources / Trust** — `*.desktop-light.png`

---

## 10. Halt

The controlled pilot is commissioned and demo-ready on the real application stack, safely.
**Production LIVE commissioning (OR-1/2/3), real-environment isolation/disclosure proof, and
pilot-org activation in production remain BLOCKED pending operator-supplied, confirmed
production inputs per `docs/PILOT-PRODUCTION-RUNBOOK.md` §0.** No production operation was
performed; no irreversible or customer-facing external-action capability was enabled.
**Halting for your production inputs and go/no-go.**
