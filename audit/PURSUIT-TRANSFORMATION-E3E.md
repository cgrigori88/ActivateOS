# Workstream E3-E — Event-driven recompute engine (verification)

The reactive half the mapping found missing. A material event **deterministically enqueues** the recomputations it invalidates (R11); each runs **at the event's as-of, never `now()`** (R12); results are **new append-only snapshots** (R13); immaterial recomputes are computed but **suppressed** so a 68→69 nudge never reaches Today (R22); and a correlation chain past the guard depth is **refused** so an event storm cannot loop (R23).

Scope discipline (R40): E3-E wires the **real route recompute** and proves the dispatch / as-of / materiality / loop-guard machinery. It does **not** ship a new dimension scorer — score-like targets classify materiality from the triggering event's before/after and record the dispatch, without fabricating a score.

## Delivered
- `supabase/migrations/0084_event_recompute.sql` — widens `change_ledger.change_type` to the full superset **+ 25 E-family types**; adds `EVENT_TRIGGERED` / `GOVERNED_ACTION` trigger types; creates `recompute_requests` (target ∈ SCORE/ROUTE/READINESS/TODAY/WHY_NOW; `as_of NOT NULL` = triggering event's `occurred_at`, R12; `causation_id`/`correlation_id`, R23; status PENDING/RUNNING/DONE/FAILED/SUPPRESSED) with org-scoped RLS.
- `src/lib/pursuits/federation/events.ts` — `DEPENDENCY_MAP` (R11) + `targetsFor`, `enqueueRecompute` (as-of-carrying, idempotent, loop-guarded), `drainRecomputeQueue` (real `recomputeRoute` at as-of, materiality classification, downstream emit only when material), `recordAndEnqueue` (producer convenience).
- `src/lib/pursuits/ledger.ts` — `ChangeType` / `TriggerType` unions extended to match the widened DB CHECK (type-safe producers).
- `scripts/recompute-verify.ts` — blind harness.

## Blind harness — 20 / 20
- **Dependency map (R11):** FACT_ACCEPTED → SCORE/WHY_NOW/ROUTE/TODAY; CONTRIBUTION_REVOKED → SCORE/ROUTE/READINESS/TODAY; an unlisted type is inert; every mapped set non-empty.
- **As-of propagation (R12):** enqueue fans out to exactly the mapped targets; every request carries the event's business time, not `now()`.
- **Idempotent enqueue:** a re-enqueue at the same as-of adds no duplicate PENDING rows.
- **Materiality suppression (R22):** a 68→69 SCORE recompute is SUPPRESSED:LOW and emits **no** downstream event; a 68→84 recompute is DONE, surfaced, and emits a `SCORE_CHANGED` stamped `EVENT_TRIGGERED` at the source event's as-of.
- **Append-only recompute (R13):** a ROUTE drain **appends** a new route snapshot, keeps exactly one current (prior preserved, not rewritten), stamped at the event's as-of.
- **Loop guard (R23):** a correlation chain past the depth cap is refused and lands a single SUPPRESSED loop-guard marker.
- **change_ledger E family:** all E-family change types insert.
- **Producer path:** `recordAndEnqueue` writes the event and fans out its targets.

## Gate
tsc **clean** · migration **84 applied** (additive: widen CHECK + create-if-not-exists, **no destructive statements**) · engine **dark** (referenced only by itself + the harness — no production caller; producer wiring is E3-H) · dispatch/as-of/materiality/loop-guard **proven under RLS** · flags **default OFF** · **no production backfill** · regression E3-A **19/19**, E3-B **21/21**, E3-C **12/12**, E3-D **15/15**.

## Deferred (by design)
- Production dimension scorer for SCORE/READINESS/WHY_NOW targets → out of E scope (R40).
- Wiring real producers (facts, participation, governed actions) through `recordAndEnqueue`, and a worker that drains the queue → **E3-H** (closed-loop integration).

**E3-E complete. Proceeding to E3-F (outcomes / attribution / experiments).**
