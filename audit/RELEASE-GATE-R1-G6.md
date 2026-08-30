# Release Gate R1-G6 — Ops surface + correlation IDs (verification)

**Goal (approved minimum):** a read-only, owner-gated operational view sufficient to diagnose the closed loop without SQL, plus correlation IDs flowing through the chain. External error tracking/alerting is a separate **pre-pilot gate** before an external partner receives access — not required for architectural completion.

## Delivered
- `src/lib/pursuits/federation/ops.ts` — `governanceHealth` (governed actions / recompute / outbox counts by status), `deadLetters` (failed / compensated / dead-lettered work needing attention across outbox, recompute, invocations), `traceCorrelation` (stitches one logical operation across invocation → outbox → receipt → recompute by correlation id). Org-scoped by RLS.
- `src/app/ops/page.tsx` — owner-gated ops view: three health cards + a "needs attention" dead-letter table. Read-only, native to the existing admin/ui system.
- `src/lib/obs/log.ts` + `executor.ts` — a minimal correlation-aware structured logger; the executor emits one `outbox.executed` line per job carrying `correlationId / orgId / outboxId / invocationId / actionFamily / attempt / outcome / simulated`, so a single operation is traceable across app and worker.
- `scripts/ops-verify.ts` — blind harness.

Correlation IDs already persist through the chain from G4 (invocation → outbox → receipt → recompute all carry `correlation_id`), so this surface reads them without retrofitting the execution path.

## Blind harness — 10 / 10
- **Health:** outbox shows SUCCEEDED + FAILED_FINAL; invocations show EXECUTED + FAILED.
- **Dead-letters:** the FAILED_FINAL outbox row, the FAILED invocation, and a FAILED recompute surface to the operator.
- **Correlation trace:** collects both invocations, both outbox rows, and a provider receipt for one correlation id; reflects the SUCCEEDED + FAILED_FINAL split; a different correlation id returns an empty (scoped) trace.

## Real booted-app verification
`/ops` renders **200** (owner-gated) with the Governed actions / Recompute queue / Action outbox health cards and the "Needs attention" dead-letter section.

## Gate
tsc **clean** · ops read models proven **10/10** · correlation trace stitches the chain · `/ops` renders owner-gated · correlation-aware structured logging live · regression outbox **20/20**, recompute-recovery **8/8**, isolation/flags/governed-mutation/closed-loop green.

## Deferred (named pre-pilot gate)
External error tracking / alerting (Sentry-class) — **required before an external design partner receives access**, per the approved D3. The pilot is not "operationally ready" until that alerting gate is satisfied; the architectural ops surface (this gate) is complete.

**R1-G6 complete. Proceeding to R1-G7 (migration reconciliation → clean-rebuild proof → backup/restore + rollback rehearsal) — the remaining RELEASE BLOCKER for the pilot.**
