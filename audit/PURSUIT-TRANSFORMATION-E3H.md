# Workstream E3-H — Closed-loop integration + UX (verification)

The final subphase. It joins the E3-A…E3-G substrates into one operating loop, adds the participant-facing read models and the D.5-native federation surface, and locks the **two hero scenarios** (R38 happy path + R39 adverse path) as **permanent** regression scenarios.

## Delivered
- `supabase/migrations/0087_pursuit_child_visibility.sql` — SELECT-only participant read policies (`can_see_pursuit`) on `pursuit_route_snapshots`, `route_candidates`, `pursuit_outcomes`, alongside the existing org-scoped for-all policies. Writes stay org-scoped; non-participants stay refused; inert in production (no participant rows while federation is OFF).
- `src/lib/pursuits/federation/read-models.ts` — `getPursuitFederation` (participants + per-viewer shared context through `applyDisclosure`), `getGovernedActions` (skills THIS actor may take + invocation history), `getPursuitOutcomes` (outcome trail + attribution, value magnitude sponsor-only via per-item disclosure).
- `src/components/pursuit/federation.tsx` + `src/app/pursuits/[id]/page.tsx` — the `Federation` panel, native to the D.5 material system, rendered **only** when `federationEnabled()`; production (flag OFF) is byte-for-byte unchanged.
- `scripts/demo-db.ts` — federation demo fixture (§2.14): a distributor participant, a purpose-limited DATA grant, a FEDERATED contribution, a material outcome — all `DEMO`/`is_simulated`.
- `scripts/closed-loop-verify.ts` — the two LOCKED hero scenarios.

## Blind harness — closed-loop 18 / 18 (both hero scenarios)
**R38 happy path:** recommendation on the shared pursuit → participant sees the roster + PARTICIPANT_SHARED context EXACTLY → outsider sees **nothing** (existence hidden, T11) → governed action runs + is audited (recommendation ≠ decision ≠ action) → cross-tenant ask refused without ACTION authority (DATA grant ≠ action authority) → outcome event fans out recomputes that drain **at the event's as-of** → outsider cannot read the outcome trail (RLS).

**R39 adverse path:** required resource **declines** → readiness falls → the fan-out recomputes (READINESS/ROUTE/TODAY) → the fall is **material** and surfaces a reconsideration event → the real route recompute **flips** the recommendation to the alternate → the flip **appends** a new snapshot (prior route preserved, immutable history) → human selects the alternate (decision object, separate) → terminal outcome + attribution land → the ledger holds the full ordered sequence → a participant sees the outcome **label** but not the sponsor-only **value**.

## Real booted-app verification
Booted the authenticated app against `pursuit_demo` (`app_rw` under real RLS, `FEDERATION_ENABLED=1`). The hero Pursuit detail renders the `Federation` panel with live data: participants (TD SYNNEX (demo) · DISTRIBUTOR), disclosure-filtered shared context, the actions this actor may take, and the outcome trail (meeting booked). HTTP 200; markers present in the served payload.

## Full E blind suite — 134 / 134
E3-A **19** · E3-B **21** · E3-C **12** · E3-D **15** · E3-E **20** · E3-F **18** · E3-G **11** · E3-H (closed-loop) **18**. wsc regression (fresh rebuild): routes **64**, experience **34**.

## Gate
tsc **clean** · migration **87 applied** (additive SELECT-only policies, **no destructive statements**) · federation UI **flag-gated** (production unchanged) · both hero scenarios **green under RLS** · real app **boot-verified** · flags **default OFF** · **no production backfill** · **no self-learning claim** (the loop CAPTURES outcomes/decisions/history so policies can later be evaluated and calibrated with real design-partner data — no automated calibration on synthetic results, R40).

## Deferred (by design, documented follow-ups)
- Routing the MCP write surface (`draft_touch`, `request_warm_intro`) through `dispatchSkill` — a call-site swap onto the proven boundary; lower risk, left for a focused follow-up rather than widening this subphase.
- Call-site emission of unified outcomes from `transitionPursuit`/`advanceOpportunity` and producer wiring through `recordAndEnqueue` in the live path — the libraries + drain are proven here; flipping them on in production is an `OUTCOME_LEARNING_ENABLED` rollout step.

**E3-H complete. Workstream E (Federated Pursuit + Governed Execution + Outcome Loop) — all subphases A–H shipped, verified, and committed.**
