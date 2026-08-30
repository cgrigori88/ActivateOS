# Workstream E3-D — Governed Skill boundary (verification)

`dispatchSkill` as a commercial transaction boundary (R9): UI asks, the Skill boundary decides legality, the domain service mutates, the invocation records what happened.

## Delivered
- `supabase/migrations/0083_governed_actions.sql` — `governed_skills` (versioned registry: effect_class incl. `EXTERNAL_ACTION`, eligible_actors, required_permission, preconditions, approval, idempotent, retry, compensation, action_family), `governed_action_invocations` (idempotency unique key, status machine, causation/correlation loop-guard ids R23, consent_grant_id), `action_outbox` (R25 external-action boundary), `action_receipts` (R26), RLS.
- `src/lib/pursuits/federation/skills.ts` — `SKILL_REGISTRY` (code-defined handlers) + `seedGovernedSkills` + **`dispatchSkill`** chokepoint + `drainActionOutbox` (simulated-provider executor → receipt).
- `src/lib/pursuits/federation/flags.ts` — `governedActionEnabled()` (dependency fail-safe on federation).
- `scripts/governance-verify.ts` — blind harness.

## Blind harness — 15 / 15
- Registry seeded.
- **Permission + actor eligibility (R9):** READ runs for viewer; INTERNAL_WRITE rejected for viewer (insufficient permission) and for an ineligible actor type (AGENT); executes for an operator and performs the real mutation.
- **Idempotency:** repeated idempotency key dedupes to a single invocation.
- **Cross-tenant authority (R24):** CROSS_TENANT_ACTION rejected without an ACTION grant; a **DATA grant does NOT authorize** it; an **ACTION grant** does.
- **External-action outbox + receipt (R25/R26):** EXTERNAL_ACTION is queued (EXECUTING), never run inline; an outbox row waits PENDING; the executor drains it, writes a receipt, and completes the invocation EXECUTED.
- **Loop guard (R23):** an action chain beyond the depth limit is rejected.
- Flag fail-safe (governed action OFF when federation dependency off).

## Gate
tsc **clean** · migration **83 applied** · enforcement + RLS **proven** · flags **default OFF** · **no production backfill** · regression E3-A **19/19**, E3-B **21/21**, E3-C **12/12**.

## Deferred (by design)
- Emitting a `change_ledger` event per invocation (`emitted_event_id`) + recompute triggering → **E3-E** (owns the `change_type` extension + event engine).
- Routing the MCP write surface (`draft_touch`, `request_warm_intro`) through `dispatchSkill` + governed-action UI → **E3-H**.

**E3-D complete. Proceeding to E3-E (event / recompute engine).**
