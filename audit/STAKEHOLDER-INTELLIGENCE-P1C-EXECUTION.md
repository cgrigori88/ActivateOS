# Stakeholder Intelligence — P1C Execution

**Goal delivered:** the canonical Pursuit can now answer *who matters in this buying decision, which
roles are verified, which are missing, who has a credible warm path to them, through which ecosystem
participant, and what we know versus infer versus do not know* — without becoming a contact database.

---

## 0. Recovery state found (this session)

The previous session's P1C work did **not** survive. Recovery inventory, performed before any edit:

| Check | Finding |
|---|---|
| Container checkout | **STALE** — local HEAD was `7b27d90` (B+3 / task #82), six commits behind |
| `origin/claude/activateos-platform-review-xzkgmd` HEAD | `a7bc982` (P1AB UX normalization) |
| Commits after `a7bc982` (local **and** remote) | **none** |
| Working tree / index / stashes | clean — no uncommitted or staged changes, no stashes |
| P1C artifacts on disk | absent (`src/lib/stakeholders/`, `0097_*`, stakeholder scripts, this artifact) |
| **P1C requirements surviving** | **none — every requirement was NOT STARTED** |

**Commits recovered / preserved:** the pre-P1C foundation was verified present in ancestry and left
untouched — `b467b1d` (P0 hygiene) · `063b9c6` (P1A Motion Intelligence) · `c07a0b7` (P1B
Seller/Partner Intelligence) · `7c73b0a` (demo story + P1AB artifact) · `a7bc982` (P1AB UX
normalization). Nothing was reset, force-pushed, discarded, or recreated; the stale checkout was
**fast-forwarded** to the authoritative remote HEAD.

**Partial work preserved:** none existed to preserve. P1C was rebuilt in full against the approved,
unchanged design (no redesign, no scope drift).

**Environment reconstruction.** The fresh container had an empty Postgres cluster, so the demo world
was rebuilt from source before work began: cluster moved to port 5433 → `scripts/demo-db.ts`
(bootstrap + **96** migrations + WS-D seed) → `demo-stories.ts` (4 hero + 6 supporting accounts) →
`demo-intel-story.ts` (funnel variety + partner disagreement) → `backfill-motion-pursuits.ts` (the P0
deterministic motion→pursuit linkage). **Baseline health before resuming P1C:** typecheck clean,
unit 130/130, canonical-microloop 23/23, disclosure 21/21, lifecycle-acceptance 21/21, motion-intel
20/20, partner-intel 17/17. (motion-intel initially reported 19/20 — "Brief motion-context check (no
linked motion)" — which was missing demo-world state, not a code defect; the P0 backfill resolved it.)

---

## 1. Schema (migration `0097_stakeholder_intelligence.sql`)

**Additive extension of the existing `stakeholders` table. No second stakeholder/person primitive,
and the `(opportunity_id, contact_id)` primary key is untouched.**

```sql
alter table stakeholders add column pursuit_id      uuid references pursuits(id) on delete set null;  -- nullable
alter table stakeholders add column source          text;         -- provenance of the assertion
alter table stakeholders add column assertion_state text not null default 'unverified'
  check (assertion_state in ('verified','inferred','unverified'));
alter table stakeholders add column asserted_at     timestamptz;
alter table stakeholders add column asserted_by     uuid;
```

- `pursuit_id` is **backfilled only** from the opportunity that already carries one; rows whose
  opportunity has no pursuit stay NULL — honestly unlinked, never guessed.
- All legacy rows default to `unverified`, so nothing pre-existing is silently promoted.
- `change_ledger`'s change-type check gains exactly one value, `STAKEHOLDER_ROLE_ASSERTED`
  (constraint rebuilt preserving every prior value).

## 2. Governed assertion path — enforced in the database, not by convention

`assert_stakeholder_role` is registered in `SKILL_REGISTRY` (INTERNAL_WRITE, USER+AGENT, operator)
with a tenant precheck, and is the single authority for buying-role assertions.

The guarantee is not a code convention. Trigger `stakeholder_assertion_guard` rejects, at the DB
level, any INSERT above `unverified` and any UPDATE that changes `role` or `assertion_state` unless
the transaction-local GUC `app.governed_assertion='1'` is set — and that flag is set **only** inside
`assertStakeholderRole`, released in a `finally`. Consequences, all asserted by tests:

- a direct `update stakeholders set role=…` raises *"must go through the governed
  assert_stakeholder_role skill"*;
- a direct `insert … assertion_state='verified'` raises the same;
- the pre-existing unverified seeding path (conversation ingest) keeps working untouched;
- Pipeline's `setStakeholderAction` was rewired: sentiment stays a plain observation, while a role
  change now dispatches the governed skill as an honest `unverified` proposal (`source:
  human:pipeline`) — verification happens on the Pursuit with evidence.

## 3. Stakeholder truth model — concepts kept distinct

| Concept | Where it lives | Never merged into |
|---|---|---|
| Person identity | `contacts.id/name` | — |
| Employment / organization | `contacts.company_id/title` | authority |
| Relationship | `seller_account_relationships`, `partner_relationships`, `warm_intro_requests` | role |
| Buying role | `stakeholders.role` (canonical 0011 vocabulary — no new roles) | state |
| Assertion status | `stakeholders.assertion_state` | a score |
| Evidence / provenance | `stakeholders.source` + ledger `after_state.evidence/basis` | the assertion |
| Disclosure | read-model projection + RLS | client-side hiding |

**There is no composite "stakeholder confidence" score.** Coverage roles reuse the existing deal-risk
checklist (`economic_buyer`, `champion`, `technical_buyer`).

## 4. Title-inference prohibition — proof

Three independent guards, each with a test:

1. `basis: ["title"]` (title alone) is rejected for `verified` **and** for `inferred` — it may only
   ever be an `unverified` proposal;
2. an `AGENT` actor may propose (`inferred`/`unverified`) but is refused `verified` — verification is
   a human act;
3. `verified` without stated evidence is refused.

The UI reinforces it: a person's title renders as *"(title = context, not authority)"*, and the
evidence field is labeled *"required to verify — a title alone is never enough"*. In the demo world
Dana Whitfield (**VP Infrastructure**) sits on the account as a contact and the economic buyer stays
**MISSING** — the product refuses to promote her.

## 5. Warm-path derivation — evidence-tiered, never manufactured

`getWarmPaths()` emits typed statements that never claim more than their tier supports:

| Tier | Evidence required | Statement |
|---|---|---|
| `PERSON_VERIFIED` | an **accepted** warm intro that revealed a named contact | "…introduced <name> here — person-level, verified by the introduction itself" |
| `SELLER_ACCOUNT` | a named seller with an asserted account relationship (decayed; NULL recency ⇒ UNKNOWN) | "…holds an active relationship at this account (recency UNKNOWN) — **an account-level relationship, not a claim about a specific person**" |
| `ACCOUNT_OVERLAP` | partner overlap **without** a seller-level relationship | "…has account overlap here, but no seller-level relationship is currently verified — **overlap alone is not a warm path**" |
| `UNKNOWN` | nothing | "No warm path is known… **UNKNOWN, not zero**" |

Account ownership, a selected partner, a job title and contact-list presence produce **nothing**.

**Regression found and fixed during screenshot review:** on an overlap-only account (Stark) the
next-step copy read *"Validate the economic buyer through WWT"* — exactly the forbidden "they own the
account, therefore they know the buyer" inference, and it contradicted the overlap disclaimer
rendered directly above it. The panel now names a partner **only** on `PERSON_VERIFIED`/
`SELLER_ACCOUNT`; overlap-only and UNKNOWN both route to discovery. A dedicated assertion locks it.

## 6. Constraint integration — the shared canonical language

`stakeholderConstraint()` returns the existing `ConstraintView` shape, computed at render time — **no
stored blocker record, no score, no duplicate state**:

```
BLOCKED BY      Economic buyer not identified        (or: not verified (inferred|unverified))
WHY             No verified buying authority on this pursuit.
EXPOSURE        $1.3M                                 (pursuit expected value; omitted when unknown)
WHAT CHANGES IT Verify economic buyer  → /pursuits/<id>#stakeholders
BEST KNOWN PATH <grounded statement>  or  UNKNOWN
```

In **Motion Intelligence** `STAKEHOLDER_GAP` joins `aggregateConstraints()` as an **informational
overlay**, rendered under "INFORMATIONAL — NEVER GATES", visually and numerically separate from the
gating rows (demo: *Economic buyer not verified · 10 pursuits · $8.1M*, beside a `$5.6M currently
constrained` figure that still sums the gating rows alone). The overlay drill-in resolves exactly its
members. Locked P1A semantics hold: **coverage never gates** — a verified assertion clears the overlay
and leaves the execution-ready cohort byte-identical (asserted).

The gap is **verified-only**: the funnel predicate now requires `assertion_state='verified'`, so an
inferred or unverified proposal does not silently satisfy coverage.

## 7. UX integrations (no new room)

- **Pursuit Detail** — a `Stakeholders` panel at `#stakeholders`. Default view is **role coverage,
  not contact cards**: one row per coverage role with its state chip and person. The signature
  moment leads: *"Globex Manufacturing Inc. is missing economic buyer — $1.3M in play without
  verified buying authority"* + strongest known path + a next step. Each row expands to why the role
  matters, other asserted candidates, what evidence would verify it, the best known path, and the
  governed assertion form (operators only). Assertion history is a disclosure, showing supersedes.
- **Accounts** — two honest lines inside the existing HUNT/WHY NOW/THROUGH WHOM/WHAT NEXT model:
  a *Buying team* coverage summary under THROUGH WHOM, and the gap under WHAT NEXT
  (*"Economic buyer remains unidentified — validate buying authority before an executive-value
  motion"*). Pre-opportunity shows *"Stakeholder coverage not established yet."*
- **Today** — exceptions only, above a $500k materiality floor: *"$1.3M pursuit lacks a verified
  economic buyer"* with a grounded path or an honest UNKNOWN, actioned by `Verify role →`
  deep-linking to `#stakeholders`. Not a prospecting feed.
- **Queue** — reads the same governed action model; no separate stakeholder work type.
- **Pipeline** — restrained: an assertion-state chip beside each stakeholder, and role edits routed
  through the governed skill. Attention/Portfolio/All behavior untouched; no dashboard added.
- **Contacts** — preserved as the directory; each contact carrying an assertion gains a small
  `role · state` chip linking to the Pursuit. The commercial interpretation stays on the Pursuit.
- **Brief** — the canonical disclosure-aware Brief, extended (no separate summary system):
  **WHO MATTERS** gains the buying side, **WHAT TO ASK** gains coverage-gap questions ("Who owns
  final economic approval for this program?"), **WHAT NOT TO CLAIM** guards unverified authority,
  **WHAT NEXT** names the grounded path or UNKNOWN.
- **⌘K** — the existing single resolver only. New intents: *Who is the economic buyer for Globex?*
  (→ **UNKNOWN — no verified economic buyer exists**, with any proposal labeled as a proposal),
  *Which high-value pursuits lack an economic buyer?*, *Show WWT pursuits missing a verified
  champion*, *Why is stakeholder coverage blocking Globex?*. Two parser defects were fixed: leading
  question words no longer become the account name, and "high-value" is no longer mistaken for a
  partner.

## 8. Disclosure proof

- Buying-side stakeholder identity is **confidential by default**: every stakeholder line the Brief
  emits is marked `confidential`, so the partner rendering drops it server-side rather than hiding it
  in the browser (asserted).
- The partner-facing federation payload contains **no** stakeholder names or role vocabulary — proven
  by scanning the serialized payload for every demo person and for `economic_buyer`.
- **RLS**: under `app_rw` with the owning org's GUC the stakeholder rows are visible; a foreign
  tenant reads **zero** rows for the same opportunity.
- **Cross-tenant assertion** is REJECTED by the governed precheck with an audited invocation
  (*"opportunity not found in this org"*).
- Assertion history is append-only: `update change_ledger …` under `app_rw` is *permission denied*
  (0094 holds).

## 9. Demo enrichment (synthetic, deliberately incomplete)

Built entirely through `dispatchSkill` (`scripts/demo-stakeholder-story.ts`, idempotent, resolves
entities **by name** so a rebuilt world just works):

| Case | Where | What it demonstrates |
|---|---|---|
| verified champion (after an **inferred → verified** supersede) | Globex · Sarah Kim | assertion history, agent-proposes/human-verifies |
| verified technical validator | Globex · Mike Rivera | a second verified role |
| **missing** economic buyer | Globex | the signature "who are we missing?" moment |
| inferred role | Globex · Priya Shah (influencer, `ai:conversation`) | proposals stay proposals |
| unverified assertion | Umbrella · Alex Moreau (CFO, basis `["title"]`) | **UNVERIFIED ≠ MISSING**; title ≠ authority |
| candidate never promoted | Globex · Dana Whitfield (VP Infrastructure) | a title on the account that stays a contact |
| **grounded** warm path | Globex | named sellers with asserted account relationships |
| **UNKNOWN** warm path | Initech Financial (no relationship evidence) | UNKNOWN is a valid answer |
| overlap-only (not a path) | Stark Industries | "overlap alone is not a warm path" |
| coverage **not established** | Globex's second pursuit (no opportunity) | the PK boundary, stated honestly |

No buying committee is complete. All provenance is DEMO/synthetic.

## 10. Tests

`scripts/stakeholder-intel-verify.ts` — **43 passed, 0 failed**, covering every §5 acceptance item:
governed-only assertion · no alternate authoritative path (DB-enforced) · history preserved across
supersede · the three states distinct · UNVERIFIED ≠ MISSING · title alone insufficient (verified and
inferred) · agent may not verify · pre-opportunity UNKNOWN · warm path requires relationship evidence
· overlap alone is not a path · overlap never yields "validate through <partner>" · no evidence ⇒
UNKNOWN · constraint-language integration · overlay non-gating + drill-in · Motion constraints still
reconcile · coverage never gates · Today materiality + grounded path · Brief WHO/ASK/NOT-CLAIM/NEXT ·
partner payload free of stakeholder identity · RLS cross-tenant read denied · cross-tenant assertion
rejected · scope narrowing · three ⌘K intents answering UNKNOWN rather than guessing.

**Full regression battery (all green):**

| Suite | Result | Suite | Result |
|---|---|---|---|
| stakeholder-intel (new) | 43/43 | append-only | 11/11 |
| motion-intel | 20/20 | disclosure | 21/21 |
| partner-intel | 17/17 | lifecycle-acceptance | 21/21 |
| canonical-microloop | 23/23 | isolation | 12/12 |
| route-persistence | 10/10 | governed-mutation | 13/13 |
| team-motion | 22/22 | migrations-only routing | 5/5 |
| outcome-bridge | 13/13 | unit tests | 130/130 |
| closed-loop | 18/18 | production build | clean |
| recompute | 20/20 | typecheck | clean |
| outcomes | 18/18 | | |

Route, team and outcome behavior are unchanged — route-persistence, team-motion, outcome-bridge,
outcomes and closed-loop all pass at their prior counts.

## 11. Screenshots

`audit/stakeholder-screens/` (desktop 1440px, dark, mobile 390px):

- `stakeholders-globex-open.desktop.png` — the signature moment, all roles expanded, history visible;
- `stakeholders-stark-missing.desktop.png` — three MISSING roles, overlap-only, discovery next step;
- `stakeholders-umbrella-unverified.desktop.png` — UNVERIFIED ≠ MISSING;
- `stakeholders-preopportunity-unknown.desktop.png` — coverage not established;
- `motions-constraints-overlay.desktop.png` / `.dark` — the informational overlay tier;
- `pursuit-globex.desktop/.dark/.mobile`, `today.desktop/.mobile`, `contacts.desktop`.

## 12. Regressions discovered / fixed

1. **Warm-path copy leaked an inference** (found in screenshot review, fixed + test added) — see §5.
2. **⌘K account resolution** — "Who is the economic buyer for Globex?" grounded against "Who"; leading
   question words are now stripped.
3. **⌘K partner parsing** — "high-value pursuits" was captured as a partner name; the match is now
   case-sensitive with a stop-word list.
4. **Ledger vocabulary** — `STAKEHOLDER_ROLE_ASSERTED` had to be admitted to the `change_ledger`
   check constraint (rebuilt preserving all prior values).
5. **Demo-world completeness** (environment, not code) — the P0 motion→pursuit backfill is required
   after a world rebuild for motion-intel to reach 20/20.

## 13. Unresolved structural limitations

- **Coverage is opportunity-scoped.** A pursuit with no linked opportunity cannot carry stakeholder
  assertions, so its coverage is reported `NOT ESTABLISHED` with the reason stated in the UI, the
  Brief, ⌘K and the Accounts pane. This is the agreed v1 answer, not a defect.
- **Coverage roles are the existing three** (economic buyer, champion, technical buyer). "Procurement"
  and "executive sponsor" appear in the requirement's illustrative sketch but are not in the canonical
  0011 role vocabulary; adding them would be a vocabulary change, which this pass was not authorized
  to make. They can be added later as a deliberate, migrated vocabulary extension.
- **`last_interaction_at` still has no producer** (carried over from P1AB §6). Seller recency renders
  UNKNOWN and warm-path statements say so; a future lifecycle slice must define the producing events.
- **No person-level path exists in the demo world** because no warm intro has been accepted there.
  The `PERSON_VERIFIED` tier is implemented and will render when one is.

## 14. Did the opportunity-dependent PK materially limit v1?

**No.** Every approved P1C capability is delivered without touching it. The PK's only consequence is
that pre-opportunity pursuits report `NOT ESTABLISHED` instead of a coverage grid — which is the
honest answer the design chose, and which the product states plainly rather than hiding.

The limitation would only become material if PursuitOS wanted **pre-opportunity buying-committee
mapping** (asserting roles during qualification, before an opportunity exists). Recommendation: do
**not** relax the PK reactively. If that capability is ever prioritized, the correct move is a
deliberate slice that makes `pursuit_id` a first-class assertion scope (a new key of
`(scope_kind, scope_id, contact_id)`, migrating existing rows), with its own governance and disclosure
review — not an opportunistic PK widening. Nothing in P1C forecloses that.

## 15. Deferred (explicitly not built)

Value Case · Renewal/Lifecycle Intelligence · expanded Ask · external sending · broad Pursuit creation
· CRM migration · MDF · executive reporting expansion · fit-v2 scoring · relationship-substrate
consolidation · production commissioning. Demo-only `outcome_learning` posture is unchanged. No new
identity/person primitive was created; no PK was relaxed; no disclosure or RLS rule was weakened; no
route/team/outcome semantics were changed.

**HALTED FOR REVIEW.**
