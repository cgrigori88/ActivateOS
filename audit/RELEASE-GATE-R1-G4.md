# Release Gate R1-G4 — Governed external-action outbox (verification)

**Invariant (approved):** decision/authorization → `dispatchSkill` → governed action invocation → transactional outbox → external-action executor → provider receipt → event/change ledger. The outbox replaces the execution transport, not the authorization boundary. For outreach: drafting ≠ sending, approval ≠ execution, and the **executor** — not the UI/agent/request handler — performs the side effect. Outreach send is no longer a privileged direct-execution path.

## Delivered
- `supabase/migrations/0091_outbox_lifecycle.sql` — explicit outbox lifecycle (`PENDING/EXECUTING/SUCCEEDED/FAILED_RETRYABLE/FAILED_FINAL/COMPENSATED`), transport-level idempotency (`unique(org_id, idempotency_key)`), retry bounds (`max_attempts`, `next_attempt_at`), `correlation_id`, `data_environment`, sanitized failure fields; receipts gain `attempt`, `correlation_id`, `failure_class`.
- `src/lib/pursuits/federation/executor.ts` — `drainOutbox`: the single execution transport. Revocation re-check before execution → COMPENSATED; feature gating (real provider only for a PRODUCTION action with real execution explicitly allowed — synthetic/demo always simulates); provider registry; bounded exponential retry with retryable/final classification; dead-letter surfacing; receipts + `ACTION_EXECUTED` ledger event on success; per-skill compensation semantics.
- `src/lib/pursuits/federation/skills.ts` — `send_campaign_touch` (EXTERNAL_ACTION); the EXTERNAL_ACTION enqueue now writes idempotency/correlation/env and is unique-idempotent.
- `src/lib/pursuits/federation/grants.ts` — `grantIsLiveById` (executor's pre-execution consent re-check).
- `src/lib/comms/governed-send.ts` — `registerOutreachExecutor` (binds the real `sendTouchNow` to `outreach.send`) + `enqueueApprovedSend`.
- `src/lib/comms/sequence.ts` — `drainScheduledTouches` now **enqueues** governed sends (dispatchSkill) instead of sending inline; it touches no provider.
- `src/worker/index.ts` — `runOutreach` registers the executor, enqueues due sends, then drains the outbox; real execution gated on `OUTREACH_AUTOSEND` (dark by default).
- `scripts/outbox-verify.ts` — blind harness.

## Blind harness — 20 / 20 (all 10 required properties)
1. **Executes once** — an approved send SUCCEEDS once with one receipt; **2. duplicate** enqueue collapses to one invocation (idempotent); re-draining never re-executes. 3. **Retryable failure retries then succeeds** (FAILED_RETRYABLE → later drain SUCCEEDED). 4. **Permanent failure** → FAILED_FINAL (dead-letter) + failure receipt (visible). Poison exhausts bounded retries → FAILED_FINAL (not forever). 5. **Unauthorized** send → REJECTED, **no outbox row**. 6. **Cross-tenant without a grant** → REJECTED (no outbox, no execution). 7. **Revoked authority before execution** → COMPENSATED, not executed; no accepted receipt. 8. **BYO LLM** — `send_campaign_touch` is an internal skill, never an MCP tool; the LLM tool set has no external-send/write tool. 9. **Synthetic/demo never reaches a live provider** — a DEMO action's receipt is simulated and the touch is never flipped to `sent`. 10. **Append-only** — re-draining never deletes/rewrites receipts; an EXECUTED invocation keeps its `executed_at`.

Observability hooks land now (correlation ids + lifecycle + receipts) so G6 reads execution history without retrofitting.

## Gate
tsc **clean** · migration **91 applied** (additive lifecycle/idempotency/retry columns, **no destructive statements**) · outreach send routed entirely through the governed outbox (no privileged direct path) · **never marks "sent" before the provider confirms** (the touch flips only inside the executor after a message id) · real execution tenant/deployment-gated + dark by default · regression G1 **13/13**, G2 **13/13**, G3 **12/12**, E3-A…E3-H **134/134**.

**R1-G4 complete. Proceeding to R1-G5 (recompute queue recovery).**
