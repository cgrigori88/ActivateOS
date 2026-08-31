# Canonical Lifecycle — Phase B + C + F1 Execution

**Scope executed:** the sequence approved for this run — B1→B2→B3 (Canonical Outcome + Attribution
Bridge), C1→C2→C3→C4 (Pursuit Team + Governed Motion + Multi-Party Execution Plan), F1
(Disclosure-aware Pursuit Brief). Each part was implemented, verified, and committed independently.
**Halted here for review**, exactly as instructed — no Part D external send, no Part E broad Pursuit
creation/advancement, no Value Case, no CRM migration, no production commissioning.

The through-line closed by this work: **Pursuit → recommendation → governed decision → proposed
team → confirmed participants → governed Motion → executable plan → commercial outcome → honest
attribution → recompute → updated intelligence → disclosure-aware Brief.** The learning half and the
team/Motion half now exist as governed, evidence-bound loops rather than gaps.

---

## What changed, by phase

### Phase B — Canonical Outcome + Attribution Bridge (committed earlier this session: `437e8b9`, `86ccfe0`, `60a7876`)
- **B1 — one authoritative outcome path.** `src/lib/pursuits/bridge/outcome-bridge.ts`
  (`bridgePursuitOutcome`) is the single producer: a legacy commercial event (opportunity close /
  progression, motion no-decision) projects into a canonical `pursuit_outcome` + honest attribution +
  a recompute enqueue. Wired into `opportunities/lifecycle.ts` and `motions/lifecycle.ts` as a
  strangler dual-write (legacy `outcome_events` still written).
- **B2/B4 — attribution + Analytics taxonomy.** Attribution preserves SOURCE / INFLUENCED / ASSISTED
  / OBSERVED / UNKNOWN; a selected partner route is **INFLUENCED** (evidence = the route decision),
  never auto-SOURCE; no partner → UNKNOWN. Analytics response/meeting slices were repointed from the
  producerless `outcome_events` to the real `interaction_events` source — no faked records.
- **B3 — learning + recompute + UX.** `OUTCOME_RECORDED → [READINESS, TODAY]` in the dependency map;
  `getPursuitOutcomeSummary` + `OutcomePanel` on Pursuit Detail; canonical-outcomes-by-attribution
  card on Insights. **B5 idempotency:** `pursuit_outcomes.source_ref` unique index (migration
  `0095`), so a duplicated source event collapses to one outcome + one attribution.

### Phase C — Pursuit Team + Governed Motion + Multi-Party Execution Plan (`this run`)
- **C1 — governed team lifecycle, no new primitive.** The existing `pursuit_team_members` substrate
  and `routing/team.ts` engine already expressed the workflow, so **no new domain primitive was
  added** (halt condition not triggered). New governed `INTERNAL_WRITE` skills wrap the single
  team-status mutation `transitionMember`: `assemble_pursuit_team`, `confirm_team_member`
  (RECOMMENDED→INVITED — the human team decision), `accept_team_member` (→ACCEPTED — feeds
  readiness), `decline_team_member`. `request_team_acceptance` is now **real** (requires a confirmed
  role; records the cross-tenant ask) instead of a bare stub. `selectPartnerRoute` now calls
  `assembleTeam` after committing the decision: **selected route → proposed team.**
- **C2 — recommendation ≠ decision, enforced.** `assembleTeam` skips any role already carrying a
  non-superseded member, and recompute never reassembles the team — so a **confirmed human
  assignment is never silently removed**, while the recommended team may still change. A
  `teamMemberInOrg` precheck makes a cross-tenant member id a governed **REJECTION**, not a silent
  write. `decideTeamAction` server action routes confirm/accept/decline through `dispatchSkill`.
- **C3 — Multi-Party Execution Plan, folded in.** `getPursuitTeam` now exposes each member's id,
  partner label, required flag, governed next step, and a `waiting` flag. The `ExecutionPlan` client
  component renders the team as a governed worklist on Pursuit Detail (inline Confirm / Mark-accepted,
  a "waiting on" band, held-readiness note). Today gains a **"waiting on this participant"**
  ACTION_REQUIRED item for each confirmed-but-unaccepted role, deep-linking to `/pursuits/[id]#team`.
- **C4 — one governed Motion-approval path.** `approve_motion` / `reject_motion` governed skills wrap
  the canonical `approveMotion`/`rejectMotion` (human-edit diff preserved) — the same dispatch
  authority as route selection, **no direct CRUD bypass.**

Commits: `Phase C1+C4` and `Phase C2+C3` (this run).

### Phase F1 — Disclosure-aware Pursuit Brief (`this run`)
- A **contextual drawer** (NOT a `/briefs` room — the legacy `/briefs/[motionId]` segment is
  unrelated). `buildPursuitBrief` is a **pure presentation over the already-authorized detail
  view** — no new query, nothing invented. Ten evidence-bound sections: *what is happening / why now
  / who matters / route / what we know / what they can know / what to say / what to ask / what not to
  claim / what next.* Absent inputs yield honest empty notes, never a guess.
- **Sponsor ⇄ Partner wow via the server-side split.** A line carrying a confidential figure the
  shareable projection dropped is marked `confidential`; the Partner rendering drops every such line
  and hides the sponsor-only guardrail section — the confidential figures are **genuinely absent**
  from the partner rendering, the same disclosure the route theater uses, not a browser filter.

Commit: `Phase F1` (this run).

---

## Acceptance proof — the Globex story, end to end

`scripts/lifecycle-acceptance-verify.ts` runs the whole loop on the seeded **Globex Manufacturing**
pursuit (system recommends **CDW**; the story overrides to **WWT**) and asserts every hop against the
real substrate. **21/21 passed:**

1. System recommendation stands before any human decision.
2. Human **overrides** to WWT through `dispatchSkill` — recommendation (CDW) **preserved**; recorded
   as `PARTNER_OVERRIDE` supervision signal.
3. Decision **persists across recompute** (still WWT selected, CDW recommended).
4. Selected route **proposed a Pursuit Team**; required roles **confirmed + accepted** (participant
   assignment/confirmation).
5. **Motion approved** through the governed mutation authority.
6. **Commercial outcome** recorded (CLOSED_WON, terminal); **attribution INFLUENCED on the selected
   partner WWT** — never SOURCE without origination — a claim **with a basis** (model version +
   reason). Outcome **enqueued its recompute**, which **drains cleanly**.
7. The disclosure-aware **Brief reflects state** (route section states the human decision with the
   recommendation preserved) **and withholds the confidential figure** from the partner rendering;
   "what not to claim" guards the sponsor-only figure.
8. **Cross-tenant denial:** a foreign tenant **cannot read** the pursuit under enforced RLS
   (`app_rw`), while the owning tenant can — and **cannot mutate** its team (governed REJECTION).
9. **Append-only:** the decision's ledger entry is immutable to `app_rw` (UPDATE denied).

### Required-testing coverage (mapped)
| Requirement | Where proven |
|---|---|
| Outcome bridge / idempotency / attribution / retry | `outcome-bridge-verify` 13/13 |
| Analytics taxonomy reconciliation | `analytics/page.tsx` → `interaction_events` (B2/B4) |
| Outcome → recompute | acceptance proof #6; `OUTCOME_RECORDED` dependency |
| Human-team-decision persistence across recompute | `team-motion-verify`; acceptance #3–4 |
| Governed Motion approval (no bypass) + **rejected Motion** | `team-motion-verify` (approve EXECUTED; reject-non-draft FAILED) |
| Execution-plan projection + **missing team role** | `team-motion-verify` (readiness held → met); acceptance #4 |
| Scope / ecosystem | `scope-verify` 17/17 |
| Sponsor/partner disclosure + Brief evidence grounding | `brief.test.ts` 6/6; acceptance #7 |
| Cross-tenant denial | acceptance #8; `canonical-microloop`/`isolation` |
| Append-only | `append-only-verify` 11/11; acceptance #9 |
| WON / LOST / NO_DECISION / UNKNOWN attribution / overridden route / outcome retry | `outcome-bridge-verify` + acceptance (WON+override) |

### Full regression battery (this run, demo DB)
`team-motion-verify` 0 failed · `outcome-bridge-verify` 13 · `canonical-microloop-verify` 23 ·
`route-persistence-verify` 10 · `closed-loop-verify` 18 · `recompute-verify` 20 · `outcomes-verify`
18 · `append-only-verify` 11 · `disclosure-verify` 21 · `lifecycle-acceptance-verify` 21 · **unit
tests 130** · `tsc --noEmit` clean · **production `next build` clean.**

> `pursuit-verify.ts` requires a dedicated `wsa_verify` database not provisioned in this
> environment — a pre-existing environmental limitation, unrelated to this work.

---

## Invariants honored
- **Recommendation ≠ decision** — for route and for team. Recompute may change a recommendation; only
  a governed decision moves a human selection or a confirmed assignment.
- **Outcome ≠ Attribution.** Causation is never inferred; UNKNOWN is shown as UNKNOWN; `observed` is
  never silently promoted to `influenced`; a selected route is INFLUENCED, never auto-SOURCE.
- **One mutation authority.** Every team confirmation and Motion approval runs through `dispatchSkill`
  — audited in `governed_action_invocations`, no bespoke CRUD.
- **Disclosure is server-side.** The Brief's partner rendering withholds confidential figures by the
  same engine that filters the route reasons; nothing confidential is serialized into a partner-safe
  payload and hidden in the browser.
- **Evidence-bound.** The Brief invents nothing; empty inputs produce honest empty notes.
- **No new domain primitive** was required for Team or Motion — the halt condition for a new
  primitive / rewrite / weakened invariant / production access / broad CRM migration was **not**
  triggered.

## Demo durability
`scripts/demo-db.ts` now enables `outcome_learning` for the **vendor sponsor** org (the org that
records outcomes), so the closed learning half and the Brief's outcome line are demonstrable in a
fresh demo build without a manual DB tweak. Participant/guest tenants stay OFF.

## Explicitly NOT done (per instruction)
External send / `OUTREACH_AUTOSEND` stays OFF · provider execution · broad Pursuit creation &
advancement (Part E) · Value Case · expanded Ask/NL reasoning · full Motion Intelligence · MDF ·
executive reporting expansion · CRM migration · production commissioning · SSO/compliance expansion ·
nav redesign.

**Status: B + C + F1 complete, verified, committed. Halted for review.**
