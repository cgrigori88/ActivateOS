# PursuitOS — Canonical Micro-Loop Execution

**What shipped.** The first genuine canonical closed micro-loop, end-to-end:

> **recommend route → authorized human decision/override → governed mutation → immutable audit
> evidence → recompute enqueued → worker drains → refreshed read model** — with recommendation ≠
> decision preserved, sponsor/partner disclosure intact, and an unauthorized tenant unable to
> observe or mutate any part of the sequence.

This is the **reference implementation** for how every future PursuitOS governed decision works:
the UI asks; the single mutation authority (`dispatchSkill`) decides; the change ledger and
governed-action ledger record it immutably; the recompute engine reacts; the read model refreshes
honestly.

Scope delivered: **P0 correctness fixes + Phase 1 (govern the route decision) + Phase 2 (recompute
producer + append-only enforcement)**, plus the closed-loop integration proof and the deterministic
legacy→canonical backfill. **Nothing beyond this scope was implemented** (see §Deferred). Halts here.

**Branch:** `claude/activateos-platform-review-xzkgmd` · **Date:** 2026-08-31

---

## 1. Before / after architecture

| Concern | Before | After |
|---|---|---|
| Route decision | `selectPartnerRoute` existed but **no app caller** — the decision was unreachable; the Today CTA 404'd to a non-existent `/pursuits/[id]/route`; the advertised skills weren't registered | A **governed** decision on the Pursuit detail route panel → `dispatchSkill('select_partner_route' \| 'override_partner_route')`; Today CTA anchors to `/pursuits/[id]#route` |
| Mutation authority | Route selection bypassed `dispatchSkill` (bare lib fn); registry had no route skills | **One authoritative path**: the only human entry is `decideRouteAction` → `dispatchSkill` → `selectPartnerRoute`. Two skills registered; selection vs override computed in the mutation, recorded truthfully |
| Recompute | `recordAndEnqueue` had **no live producer**; the worker drained an always-empty queue | A committed decision **enqueues its recompute** (`selectPartnerRoute` → `recordAndEnqueue`); the worker drains it |
| Audit immutability | append-only was **service convention only**; `app_rw` could UPDATE/DELETE `change_ledger`, `pursuit_overrides`, `governed_action_invocations` | **DB-enforced** (migration 0094): destructive/identity writes revoked from `app_rw`; only forward-lifecycle columns writable |
| Scope | Accounts, Queue **not** scope-aware; PERSONAL scope leaked cross-tenant (no `org_id` predicate) | Accounts (+ CSV export) and Queue narrow to the resolved scope; PERSONAL scope org-bounded |
| Docs | prod RLS state contradictory across 5 artifacts; duplicate security-audit stub | Authoritative **UNKNOWN / REQUIRES OPERATOR VERIFICATION**; stub retired |

---

## 2. The authoritative mutation path (one path, confirmed)

```
Pursuit detail  →  RouteDecision (client)  →  decideRouteAction (server action)
    →  withTenant + role gate + experience flag
    →  dispatchSkill(select_partner_route | override_partner_route, actor=USER/operator, {pursuitId, args:{candidateKey, reason, category}, correlationId})
         · idempotency · actor eligibility + role rank (R9) · loop guard (R23) · effect-class routing (INTERNAL_WRITE)
         · handler → selectRouteByCandidate → selectPartnerRoute   ← THE single route mutation
              · pursuit_route_snapshots.selected_partner_id + route_candidates.is_selected + route_status='SELECTED'
              · pursuit_overrides (original_recommendation + human_decision, separate) when it diverges
              · recordAndEnqueue → change_ledger (PARTNER_SELECTED | PARTNER_OVERRIDE) + recompute_requests (READINESS, TODAY)
         · governed_action_invocations row (EXECUTED), correlated
```

**Confirmed single path.** `selectPartnerRoute` is reached from the app only through the two
governed skills; the MCP surface already routes writes through `dispatchSkill`; the route write no
longer has an ungoverned caller. Grep of `src/app` for `selectPartnerRoute`/`selectRouteByCandidate`
= none outside the skill registry.

---

## 3. Exact callers added / changed

| File | Change |
|---|---|
| `src/lib/pursuits/federation/skills.ts` | Registered `select_partner_route`, `override_partner_route` (INTERNAL_WRITE, operator) and `explain_partner_route` (READ). Handlers wrap `selectRouteByCandidate`. |
| `src/lib/routing/override.ts` | New `selectRouteByCandidate` (resolves candidate → partner, single entry for the skills). `selectPartnerRoute` now records via `recordAndEnqueue` (producer) with a correlation id; added `correlationId` opt. |
| `src/lib/pursuits/federation/events.ts` | `PARTNER_OVERRIDE` added to `DEPENDENCY_MAP` (→ READINESS/TODAY, never ROUTE). `enqueueRecompute` guards on `to_regclass('recompute_requests')` so a decision still records its ledger event where the rollout-gated recompute table isn't deployed. |
| `src/app/pursuits/[id]/actions.ts` (new) | `decideRouteAction` — the only human entry; mints correlation id, gates role + experience flag, keeps DEMO pursuits DEMO, dispatches. |
| `src/components/pursuit/route-decision.tsx` (new) | The decision control: approve / override (reason required), decided-state with governed-by label, **recompute-pending** honesty indicator, contextual "View in Ops". |
| `src/app/pursuits/[id]/page.tsx` | Renders `RouteDecision` in the route panel under `#route`; passes `canDecide` (operator/owner). |
| `src/lib/pursuits/read-models/route.ts` + `types.ts` | `RouteComparisonView` gains `decided`, `selectedKey`, `recomputePending` (catalog-guarded). |
| `src/lib/pursuits/read-models/today.ts` | ROUTE_APPROVAL CTA → `/pursuits/[id]#route` (was the 404 `/route` sub-room). |
| `src/app/accounts/page.tsx`, `accounts/export/route.ts`, `queue/page.tsx` | Ecosystem-scope narrowing (mirrors Today/Pipeline). |
| `src/lib/scope/server.ts` | PERSONAL scope org-scoped (isolation fix). |
| `supabase/migrations/0094_append_only_history.sql` (new) | Append-only enforcement. |

---

## 4. Recompute path

- **Producer (new, live):** a route decision → `recordAndEnqueue` → `recompute_requests` rows for
  **READINESS + TODAY only**. Never ROUTE — a ROUTE recompute rebuilds the snapshot and would drop
  the human selection, so recommendation ≠ decision would be lost. (`persistRoute` currently
  resets `is_selected`; preserving a selection across a belief-driven ROUTE recompute is the
  documented follow-up for the belief-change phase — not exercised by this loop.)
- **No second queue.** The existing `recompute_requests` table and the worker's
  `drainRecomputeQueue` are reused unchanged.
- **Idempotency / retry / duplicate-decision / failure:** the enqueue de-dupes a PENDING request
  for the same (pursuit, target, as-of, correlation); the drain is `for update skip locked` with
  attempt caps and lease recovery; a redundant decision is a fresh correlated invocation (audited),
  and its recompute de-dupes; a missing recompute substrate is a clean skip, never a failed INSERT.
- **UI honesty:** `recomputePending` is true while any decision-triggered request is PENDING/RUNNING;
  the control says *"propagating the decision — downstream state isn't settled yet"* and never
  implies a refreshed downstream until the queue drains.

---

## 5. Append-only enforcement (migration 0094)

From the normal application-write role `app_rw`:

| Table | Enforcement | Why |
|---|---|---|
| `change_ledger` | REVOKE UPDATE, DELETE | pure append-only ledger — the app only ever INSERTs |
| `pursuit_overrides` | REVOKE UPDATE, DELETE; GRANT UPDATE only on `system_converged, converged_at, outcome_id` | the divergence RECORD is immutable evidence; only the R17 convergence annotation is written forward |
| `governed_action_invocations` | REVOKE UPDATE, DELETE; GRANT UPDATE only on `status, executed_at` | request identity + args immutable; a full UPDATE revoke is **technically impossible** — the outbox executor legitimately advances status. Documented; no trigger-based rewriting used |

Semantic corrections **append a superseding row**; history is never rewritten. Enforcement binds at
the `app_rw` cutover (task #67); the table owner is unaffected — consistent with the currently-latent
RLS model. **Verified as the real `app_rw` role under RLS:** destructive/identity writes denied
(42501), forward writes allowed — `append-only:verify` 11/11.

---

## 6. Scope verification

`npm run scope:verify` — **17/17**. ALL → no narrowing; PARTNER / SELLER / PERSONAL → subset of the
org's authorized set; **hostile/foreign identifiers never widen or leak** (fall back to the caller's
own authorized set, or resolve empty — never another tenant's rows); the exact Accounts + Queue
predicates narrow; **empty scope → zero rows** (never widened). The run surfaced and fixed a real
isolation gap: PERSONAL scope had no `org_id` predicate and, with RLS latent, leaked one other
tenant's active account into the lens — now org-bounded.

---

## 7. Security / isolation tests

`npm run microloop:verify` — **23/23** (the CDW→WWT reference proof):

1. recommendation is CDW; route undecided (Today shows the decision).
2–3. a **viewer** override is REJECTED; an **unknown candidate** → FAILED invocation (audited), no
   mutation; the **authorized operator** override EXECUTES via `override_partner_route` (correlated).
4. canonical mutation: `selected_partner_id`=WWT, `route_status`=SELECTED, `pursuit_overrides`
   captured recommendation AND decision separately, `change_ledger` PARTNER_OVERRIDE.
5. append-only: `change_ledger` UPDATE denied to `app_rw`.
6–7. recompute enqueued (READINESS/TODAY only, never ROUTE); worker drains — nothing left
   PENDING/RUNNING.
8–9. read model refreshed: decided, selection ≠ recommendation, recompute settled; recommendation
   (CDW) and decision (WWT) remain distinguishable; the Today decision is gone (loop closed).
10. **disclosure:** a partner-class viewer receives **no** internal reasons (withheld server-side);
    the sponsor does.
11. **isolation:** a foreign tenant cannot **observe** the candidate, **mutate** the snapshot (RLS →
    0 rows), or claim the invocation.

Rollback/failure is asserted at each boundary (viewer, unknown candidate, foreign tenant, append-only).

Preserved suites re-run with 0094 + backfill applied: **isolation 12, disclosure 21, federation 19,
governed-mutation 13, tenant-flags 13, closed-loop 18, recompute 20, experience 34, governance 15,
outbox 20, outcomes 18** — all green. `routes` 62/2 (the 2 are pre-existing entity-resolution
failures, identical on baseline). Unit suite **124/124**. Typecheck clean. Production build green.

---

## 8. Deterministic backfill report

`npm run backfill:pursuit-links --apply` — links a legacy row to a Pursuit **only** where the
company has exactly one live Pursuit; ambiguous rows (0 or >1 live pursuits) are **left unlinked,
never guessed**.

| Entity | Deterministic backfill | Ambiguous / unresolved | Already linked | New-path enforced | Total |
|---|---|---|---|---|---|
| `opportunities` | 5 | 1 | 10 | 0 | 16 |
| `revenue_motions` | 6 | 1 | 0 | 0 | 7 |

**New-path enforced = 0:** creation-time linkage (new legacy records carrying `pursuit_id` at
creation, so the ambiguity disappears prospectively) is a change to the legacy creation paths that
belongs to the **deferred outcome-bridge phase** — not implemented here, per "don't migrate the CRM
model in this phase / halt after Phase 2."

---

## 9. UX changes (doctrine-preserving)

- **Pursuit detail** gains the governed decision control inside the existing route panel
  (progressive disclosure under the candidate table). No new room. Recommendation ≠ decision stays
  explicit; override requires a reason; the decided state names the governing skill and links to Ops.
- **Today** ROUTE_APPROVAL now leads to a working decision (`#route` anchor). No 404 in the hero
  journey.
- **Accounts / Queue** respect the ecosystem scope chip — consistency with Today/Pipeline; no new UI.
- **Ops** stays an owner-only diagnostic surface (not promoted to primary nav); operational
  traceability is reachable **contextually** from the decided-state ("View in Ops →"), per the
  approved treatment.

---

## 10. Regressions discovered / fixed

- **PERSONAL scope cross-tenant leak** (pre-existing) — fixed (org-scoped).
- **Today ROUTE_APPROVAL 404** (pre-existing) — fixed (anchor into the decision room).
- **Route decision bypassed the mutation authority** (pre-existing) — fixed (governed).
- **Append-only was convention-only** (pre-existing) — fixed (DB-enforced).
- **`recordAndEnqueue`/`getRouteComparison` hard-dependence on the rollout-gated `recompute_requests`
  table** would have broken isolated harnesses — fixed with catalog-existence guards.
- No **new** regressions: every preserved suite is green; the only red assertions (routes 62/2) are
  pre-existing and unrelated (entity resolution).

---

## 11. Unresolved issues / notes

- `persistRoute` resets `is_selected` on a ROUTE recompute (would drop a human selection). Not
  triggered by this loop (decisions never enqueue ROUTE), but **must be addressed before belief-driven
  ROUTE recomputes run** in a later phase — documented follow-up.
- `routes-verify` 2 entity-resolution failures are pre-existing (DUNS/external-id) in the `wsc_verify`
  harness; unrelated to this work.
- The `wsc_verify` / experience harness DBs carry a subset of migrations; the catalog guards make the
  app resilient to that, but those harness DBs remain independently provisioned.

---

## 12. Explicitly deferred (NOT implemented — awaiting approval)

- **External send** — no send path wired; the outbox executor stays dark
  (`dataEnvironment==='PRODUCTION' && OUTREACH_AUTOSEND==='on'`); demo simulates.
- **Outcome/attribution bridge (Phase 3)** — legacy close does not yet record a canonical
  `pursuit_outcomes`; creation-time `pursuit_id` linkage (new-path enforcement) not wired.
- **Team formation + governed motion approval (Phase 4)**, **belief-driven ROUTE recompute +
  selection-preserving `persistRoute`**, the **CRM model migration**, and the broader deferred
  feature set — none implemented.
- **Production commissioning** — not performed; the halt is preserved (§13).

---

## 13. Production status — separated from local/demo verification

**Everything in this document was verified LOCALLY, against the `pursuit_demo` tenant.** No
production change was made or claimed.

- Migration `0094` is authored and **applied to the demo DB**; it is **NOT applied to production**.
  Its enforcement binds at the `app_rw` cutover (task #67), which is **not done** — production RLS /
  FORCE-RLS / cutover status is **UNKNOWN / REQUIRES OPERATOR VERIFICATION** (see
  `audit/PRODUCTION-RLS-STATUS.md`). The commissioning halt is preserved.
- The governed route decision, recompute wiring, scope fixes, and append-only enforcement run on the
  demo tenant behind the per-org flags. Turning the loop on for a real pilot tenant additionally
  requires the `app_rw` cutover (so the append-only REVOKEs actually bite) — an operator action,
  tracked, not performed here.

---

## 14. Demo screenshots

The production build is green (committed, with auth). Capturing live UI screenshots here requires a
throwaway build with `NEXT_PUBLIC_SUPABASE_*` unset (owner/basic mode) because the auth gate that
redirects to `/login` is baked into the middleware at build time; that auxiliary build did not
complete reliably in this environment, so live frames are not attached to this pass.

The UI states the screenshots would show are instead **asserted programmatically** by
`microloop:verify`, which reads the same read-model values the components render:
- **Today** — `ROUTE_APPROVAL` decision present before, gone after (loop closed).
- **Pursuit route panel — undecided** — `decided=false`, recommended=CDW, viable alternative (WWT);
  the control renders Approve / Override.
- **Pursuit route panel — decided (override)** — `decided=true`,
  `selectionMatchesRecommendation=false`, recommended=CDW preserved, selected=WWT, governed-by
  `override_partner_route`, `recomputePending` clears after the drain.
- **Disclosure** — partner-class viewer `reasonsInternal=null`; sponsor gets internal reasons.
- **Accounts / Queue** — scoped counts ≤ full; empty scope → zero rows.

Re-run `npm run microloop:verify` for the live transcript. (Prior demo-surface screenshots from
earlier phases remain under `audit/demo-screens/`, `audit/scope-shots/`, etc.)

## 15. How to reproduce

```
npm run scope:verify           # 17/17 — narrowing-only, foreign-safe
npm run append-only:verify     # 11/11 — DB-enforced immutability as app_rw
npm run microloop:verify       # 23/23 — the CDW→WWT closed-loop proof
npm run backfill:pursuit-links # dry-run counts (add --apply to write)
npm test                       # 124/124 unit
```

**HALT.** P0 + Phase 1 + Phase 2 complete and verified. Not proceeding into external send, the
outcome bridge, broad lifecycle expansion, production commissioning, or the deferred feature roadmap
without approval.
