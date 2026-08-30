# Release Gate R1-G5 — Recompute queue recovery (verification)

**Goal:** the event-driven recompute queue survives retries/restarts without corrupting history.

## Delivered
- `supabase/migrations/0092_recompute_recovery.sql` — `recompute_requests.locked_at` (lease) + `max_attempts` + a recovery index. Additive.
- `src/lib/pursuits/federation/events.ts` — `drainRecomputeQueue` now (a) picks PENDING **and** any RUNNING row whose lease has expired (a worker that died mid-drain), stamping `locked_at` when it claims one; (b) leaves a **fresh** RUNNING row alone; (c) caps poison requests — a row that has burned its `max_attempts` is marked FAILED (visible) instead of retrying forever. The drain remains transactional, so a crash rolls back to PENDING with no partial snapshot.
- `src/worker/index.ts` — the worker drains the recompute queue every tick (inert until a tenant's federation/experience is enabled; recovers stale RUNNING on restart).
- `scripts/recompute-recovery-verify.ts` — blind harness.

## Blind harness — 8 / 8
- **Crash mid-drain leaves no partial state:** a crashed (rolled-back) drain leaves requests PENDING (not stuck RUNNING) and writes **no** snapshot; a clean re-drain then appends exactly one snapshot and resolves the request; re-draining never duplicates the snapshot (append-only, idempotent).
- **Lease-based recovery:** a RUNNING row whose lease expired is recovered and completed; a **fresh** RUNNING row (recent lease) is NOT stolen mid-flight.
- **Poison cap:** a request that has burned its attempts is FAILED, not retried forever.

## Gate
tsc **clean** · migration **92 applied** (additive lease + attempt cap, **no destructive statements**) · crash-safe + lease-recovered + poison-capped + append-only proven · worker drains the queue · regression recompute **20/20**, closed-loop **18/18**, outbox **20/20**, G1–G4 + E green.

**R1-G5 complete. Proceeding to R1-G6 (ops surface + correlation IDs).**
