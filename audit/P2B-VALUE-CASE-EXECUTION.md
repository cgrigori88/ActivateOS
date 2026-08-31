# P2B — Value Case

**Scope executed:** P2B Value Case only.
**Not executed, by instruction:** customer-ready Value Case (boundary designed, §16), P2C-1 LLM answer tier.
**Status:** green — 126/126 on the new acceptance suite, 130/130 unit tests, full regression battery
passing (27 suites), production build clean.

PursuitOS can now answer, for a Pursuit: **what is economically at stake, what part of that value is
actually supported, what is assumed, what remains UNKNOWN, and what evidence would most materially
improve the case.**

---

## 1. Fact predicates used and added

The existing fact graph proved sufficient. `facts` already carries `money_amount` /
`money_currency` for a point, `object_type = 'RANGE'` + `object_value {low, high}` for a bounded
value, plus `provenance_class`, `status`, `fact_evidence`, `fact_contradictions`,
`supersedes`/`superseded_by` and validity windows. **No generic ROI or value-case primitive was
created.**

Migration `0099_economic_value_case.sql` adds **registry rows and one column** — no new table:

| Predicate | Object type | Role in the arithmetic |
|---|---|---|
| `current_operating_cost` | MONEY | BASELINE |
| `license_subscription_cost` | MONEY | BASELINE |
| `labor_cost` | MONEY | BASELINE |
| `infrastructure_cost` | MONEY | BASELINE |
| `contract_cost` | MONEY | BASELINE |
| `incumbent_renewal_exposure` | MONEY | BASELINE |
| `downtime_risk_cost` | MONEY | BENEFIT (risk avoided) |
| `avoided_cost` | MONEY | BENEFIT |
| `productivity_impact` | MONEY | BENEFIT |
| `revenue_impact` | MONEY | BENEFIT |
| `migration_cost` | MONEY | CHANGE |
| `time_to_value_months` | NUMBER | TIMING (never summed) |

**A driver's role is declared in the registry (`signal_type`), not inferred from its name.** A
number whose role is not declared is *not admitted to the model* — the Value Case refuses to guess
whether $2M is a cost being avoided or a cost being incurred. `loadDrivers` silently drops any
economic-family fact whose role is unknown, and the suite asserts every registered driver declares
one.

The one additive column: **`facts.disclosure_class`**, constrained to the **existing** six-value
disclosure vocabulary (`PUBLIC`, `INTERNAL`, `PARTNER_SHARED`, `TRANSACTION_CONFIDENTIAL`, `PII`,
`RESTRICTED`) already used by `route_candidate_reasons` and `transaction_features`, and already
mapped by the federation disclosure engine's `LEGACY_TO_AUDIENCE` / `LEGACY_TO_SENSITIVITY`. This is
not a second classification system; it puts the existing one on the row so §16 can be enforced at
the fact rather than at each surface. **NULL is treated as INTERNAL** — an unclassified economic
fact is never partner-visible by default.

Also added: a partial index `facts_economic_idx`, and `ECONOMIC_FACT_ASSERTED` /
`ECONOMIC_FACT_DISPUTED` on the ledger's change-type vocabulary.

---

## 2. Provenance mapping (the ladder)

The ladder is a **projection of the canonical `provenance_class`**, not a stored second
classification. The translation is not one-to-one, so it is stated explicitly:

| Ladder rung | Canonical `provenance_class` |
|---|---|
| **VERIFIED** | `FIRST_PARTY`, `THIRD_PARTY_VERIFIED` |
| **CUSTOMER-CONFIRMED** | `CUSTOMER_DECLARED` |
| **INFERRED** | `SECOND_PARTY`, `THIRD_PARTY_UNVERIFIED`, `INFERRED` |
| **ASSUMED** | `HUMAN_ASSERTED` |
| **UNKNOWN** | *no fact at all* — an absence, never a stored rung |

**The one judgement call, recorded deliberately.** `HUMAN_ASSERTED` maps to **ASSUMED**, not
VERIFIED. In P2A a human asserting a renewal date was trusted for precision — a person reading a
contract is a reliable reporter of a date. Economics are different: a seller's working figure for a
customer's infrastructure spend is a planning assumption until it is evidenced. The governed path
lets a human record `FIRST_PARTY` or `CUSTOMER_DECLARED` **when they can state the evidence**, so the
rung a fact lands on is a consequence of what could actually be shown, not of who typed it.

Every driver retains source (`subject_label`), provenance (`provenance_class`), evidence
(`fact_evidence` count + the ledger entry), status, contradiction state, and supersession history.

---

## 3. Reconciling the three economic truths

Kept distinct, and **none is derived from another to make them agree**:

| Truth | Source | What it means |
|---|---|---|
| **Deal amount** | `opportunities.amount_usd` | what the commercial deal is worth **to us** |
| **Expected value** | `pursuits.expected_value_weighted` | our probability-weighted representation of that deal |
| **Modeled customer impact** | Σ economic facts | the **customer's** business impact — not our revenue |

`ECONOMIC_TRUTH_LABEL` and `ECONOMIC_TRUTH_MEANING` are the single source of the labels, so no
surface can print three bare dollar amounts. The Pursuit Detail card renders all three with their
meanings beneath; the Brief spells out that the deal amount *"is OUR revenue, not the customer's
impact — the two are different figures and must not be conflated"*; the ⌘K answer says the same.

The suite proves independence directly: re-assembling the same drivers with a fabricated deal
amount and expected value produces a byte-identical modeled impact.

---

## 4. Value Case arithmetic

Interval arithmetic over explicitly-typed drivers. A point value is the degenerate interval `[v, v]`,
so points and ranges compose with no special case.

```
benefit  = Σ BENEFIT drivers            [Σlow, Σhigh]
change   = Σ CHANGE drivers             [Σlow, Σhigh]
impact   = benefit − change             [benefitLow − changeHigh, benefitHigh − changeLow]
baseline = Σ BASELINE drivers           CONTEXT ONLY — never added to impact
```

Interval subtraction pairs the **smallest** benefit against the **largest** change cost, which is the
honest worst case. **BASELINE never enters the impact sum**: spending $2M a year today is not a $2M
benefit. It is reported separately as *"at stake today"*.

**States** (§14's vocabulary exactly): `STRONG` · `INCOMPLETE` · `CONFLICTING` · `NOT_ESTABLISHED`.

- `NOT_ESTABLISHED` — no economic facts at all.
- `CONFLICTING` — any driver's sources disagree. **A conflict outranks strength**, for the same
  reason it does in lifecycle timing: a number two sources disagree about is more dangerous than a
  number we simply do not have.
- `STRONG` — ≥2 benefit drivers and ≥60% of modeled benefit magnitude resting on VERIFIED or
  CUSTOMER-CONFIRMED evidence.
- `INCOMPLETE` — otherwise.

**Defensibility is separate from state.** `defensible = false` when there is no benefit driver, or
every benefit driver is a bare assumption. The output is then **"Value case not yet defensible"** and
no modeled range is stated — a valid answer, not a failure. The Brief additionally records *"Do not
state a modeled value for this pursuit — no defensible range exists yet."*

**Conflicts are never averaged** (§17). A conflicting driver's bounds span every competing value, all
competing figures are rendered, and none is chosen.

---

## 5. Sensitivity model — "what would strengthen this?"

Deterministic, and **arithmetic rather than confidence**. Under interval addition, a driver's own
spread *is* its exact contribution to the total width — so "resolving this narrows the range by X" is
a fact about the sum, not an estimate.

Three outcomes, each honest about what it can and cannot say:

| Case | `narrowsRangeBy` | What is said |
|---|---|---|
| A bounded BENEFIT or CHANGE driver | its exact spread | "Verifying it within its current bounds narrows the modeled range by $X." |
| A **BASELINE** driver | `null` | "Firming it up moves *at stake today*, not the modeled range." |
| An **absent** driver | `null` | "Its effect on the range cannot be calculated until a first bound exists." |

**The BASELINE rule was a defect found in screenshot review**, not a design anticipated up front. The
first implementation ranked *every* wide driver by spread, and the Globex screen consequently claimed
that verifying **infrastructure cost** would narrow the modeled range by $310k — while infrastructure
cost is a BASELINE and contributes exactly zero to that range. That is precisely the invented
improvement §6 forbids. Fixed: only drivers that enter the impact sum can claim to narrow it, the
ranking puts them first, and three assertions lock it — including one proving that every reported
narrowing equals the driver's own spread *and* that the driver is a BENEFIT or CHANGE.

Ranking: conflicts first (an unresolved disagreement blocks the arithmetic itself), then drivers that
actually move the modeled range by the width each removes, then baseline-only drivers, then
unquantifiable gaps.

**No confidence percentage is claimed anywhere**, and the UI says so on the card: *"Range widths are
interval arithmetic over the drivers below. No confidence percentage is claimed, because no
calibrated model for one exists."* The suite scans the model's compiled code (comments stripped) for
any confidence-improvement claim.

---

## 6. Governed assertion path

`assert_economic_fact` — a new governed skill (`INTERNAL_WRITE`, operator), dispatched through
`dispatchSkill` like every other commercial mutation.

**No direct CRUD bypass.** Migration 0099 installs `economic_fact_assertion_guard` on `facts`,
mirroring 0097's stakeholder guard: an economic-family fact carrying a **trusted** provenance class
is rejected unless written inside the handler's transaction-local
`app.governed_economic_assertion` flag.

The guard is deliberately **scoped to authoritative assertions**. A pipeline may still write an
`INFERRED` or `THIRD_PARTY_UNVERIFIED` economic fact without the skill, because a model proposing a
number is a different act from a human asserting one — which is exactly the distinction §7 requires
to stay visible. Both behaviors are asserted.

What the path preserves:

| §7 requirement | Where it lives |
|---|---|
| actor | `change_ledger.actor_type`/`actor_id` + `facts.created_by_actor_type`/`created_via` |
| organization | `facts.org_id` (RLS-scoped) |
| Pursuit | `change_ledger.pursuit_id` (the fact itself is account-scoped, as economics are) |
| predicate / driver | `facts.predicate_key` |
| value / range | `money_amount` (point) or `object_value {low,high}` (range) |
| provenance | `facts.provenance_class` → the ladder rung |
| source / evidence | `facts.subject_label`, `data_lineage`, `fact_evidence` link, ledger entry |
| prior fact | `supersedes` / `superseded_by` — append-only, nothing overwritten |
| audit history | `change_ledger` `ECONOMIC_FACT_ASSERTED` with before/after |

Refusals built into the path: an **AGENT may propose but never assert** verified or
customer-confirmed economics; a rung claiming verification **requires stated evidence**; a value must
be **either** a point **or** a range, never both and never neither; a low above its high is rejected;
a non-economic predicate cannot be asserted through the economic path; and cross-tenant subjects are
refused by the precheck.

**Supersession is three steps**, because two constraints pull in opposite directions:
`facts_current_slot` (unique on `(org_id, fact_identity_key)` where `status = 'CURRENT'`) requires the
prior row to leave CURRENT before the new one arrives, while `facts_superseded_by_fkey` requires the
new row to exist before the prior can point at it. So: retire the prior → insert the new → link the
prior forward. Both constraints caught the naive orderings during verification; the history is now
unambiguous at every instant.

---

## 7. Stakeholder / MEDDPICC reconciliation

**No migration was needed, and none was made.** MEDDPICC already read the canonical `stakeholders`
table — it holds no independent role record (`opportunity_meddpicc` has no contact, role or
assertion-state column, asserted in the suite).

The real gap was subtler: the assessment **ignored `assertion_state`**, so it reported an economic
buyer as `strong` on the strength of an *inferred* assertion. That is a second, weaker standard of
truth living inside the qualification model.

The fix is a read-side change only: `economic_buyer` and `champion` now consume the P1C assertion
state, and **a role may only reach `strong` on a VERIFIED canonical assertion**; anything less reads
`weak` and the note says *"— not yet verified"*. Canonical assertions are authoritative for identity
and role; MEDDPICC consumes them as qualification context. **No dual-write of incompatible role
truth**, and no big-bang migration.

One further honest link: MEDDPICC's `metrics` element now consumes the Value Case. Where a defensible
modeled impact exists it reports it; where none does, it says the deal amount *"is OUR revenue, not
the buyer's metric"*. `assessMeddpicc` continues never to overwrite a human-set element.

---

## 8. Internal projection

`getValueCase` is the full authorized view, carried on `PursuitDetailView.valueCase` and rendered on
Pursuit Detail at the `#value` anchor. It includes confidential economic inputs, assumptions,
internal sensitivity, contradictions with every competing figure, supersession history, and the
explicit list of UNKNOWN drivers. It uses the existing server-authorized projection architecture —
the read model is assembled server-side and the client receives only what the audience may see.

---

## 9. Partner projection and the derived-value leak

`toPartnerValueCase` builds the partner view through the existing disclosure vocabulary. No second
filtering system.

**The leak §16 warns about is not solved by hiding fields.** A derived total computed from a
confidential input leaks that input the moment a reader can subtract:

```
modeled impact   $1.2M–$1.6M      ← internal total from 3 drivers
avoided cost     $0.4M            ← disclosed
productivity     $0.3M            ← disclosed
                                  ⇒ the third driver is solvable exactly
```

So the partner range is **never the internal range with rows hidden**. It is **recomputed from the
partner-disclosable drivers alone**, and the internal total is never placed in the partner payload at
all — which makes the subtraction attack structurally impossible rather than merely unlikely.

**When the disclosable set cannot support a defensible number, the derived value is WITHHELD**, per
the halt condition. The partner is told only that sponsor-confidential context exists, with no
figure, no count and no driver name — a count of confidential drivers is itself a disclosure about
the deal's shape.

The same rule is applied in the **Brief**: the internal modeled-impact line is marked `confidential`
whenever any contributing driver is withheld (so the partner rendering drops it), and a partner-safe
line is recomputed separately.

**One nuance the tests surfaced.** A withheld **BASELINE** contributes nothing to the derived value,
so internal and partner totals may legitimately coincide — that is not a leak, and an assertion
demanding they differ was wrong. The invariant that actually matters, and is now asserted: the
internal total is never published when it differs from the disclosable recompute, and **no withheld
driver's magnitude appears anywhere in the payload**.

### Derived-value disclosure analysis

| Vector | Status |
|---|---|
| Confidential field in payload | Absent — asserted by serializing the payload and searching for the figure |
| Subtraction from a published total | Impossible — the internal total is never in the partner payload |
| Inference from a partner range built on confidential inputs | Prevented — the range is recomputed from disclosable drivers only |
| Inference from the *existence* of withheld data | Bounded — the note carries no figure, count or driver name |
| Unclassified fact leaking by default | Prevented — NULL is treated as INTERNAL |
| **A partner-safe fact DERIVED from a confidential one** | **Not covered in v1** — see §13.2 |

---

## 10. UX

**No `/value-case` room.** The Value Case is a property of a Pursuit, not a destination — asserted by
scanning `src/app` for any value route.

| Surface | Treatment |
|---|---|
| **Pursuit Detail** (primary) | A compact card at `#value`: the three labelled truths, state + one-sentence reason, evidence quality, at-stake-today, cost to change, biggest uncertainty. Progressive disclosure opens *What would strengthen this Value Case?* (ranked, with the arithmetic) and *Economic drivers* (per-driver provenance, competing values, sponsor-only marks, supersession history). |
| **Brief** | New **BUSINESS VALUE** section; contributions into WHAT WE KNOW, WHAT NOT TO CLAIM and WHAT TO ASK (§11 below). |
| **Accounts** | One line: the Value Case state and modeled impact, linking to `#value`. Uses the derived state — **no new score**. |
| **Today** | Exceptions only, above materiality floors ($750k for a missing baseline, $400k for contested economics). Both route to `assert_economic_fact`, not to a form. |
| **Pipeline** | A `Value case` filter beside the existing atomic filters (strong / incomplete / conflicting / not established). No new dashboard, no new column. |
| **Motions** | One aggregate line with explicit semantics (§12). |

---

## 11. Brief integration

- **BUSINESS VALUE** — the defensible range or an explicit "not yet defensible"; at-stake-today
  (marked confidential); cost to change; evidence quality; and the reminder that the deal amount is
  our revenue, not the customer's impact.
- **WHAT WE KNOW** — only VERIFIED and CUSTOMER-CONFIRMED economic facts, each marked confidential
  when its disclosure class is not `PARTNER_SHARED`.
- **WHAT NOT TO CLAIM** — every assumption (*"a working assumption, not a customer-confirmed
  figure"*), every inference (*"do not attribute it to the customer"*), every contradiction with both
  figures, every sponsor-confidential driver, and — when the case is not defensible — *"Do not state
  a modeled value for this pursuit."*
- **WHAT TO ASK** — the highest-value missing economic inputs in sensitivity order, carrying the real
  arithmetic where it exists: *"Verifying it narrows the modeled range by $310k."*

No unsupported value messaging is generated: a pursuit with no economics produces the honest empty
note, *"No economic facts yet — do not manufacture a value story."*

---

## 12. Aggregation semantics (Motions)

§14 forbids summing overlapping impact without explicit semantics. Economic drivers live on the
**account**, so two pursuits against one account model the *same* customer impact. The stated rules:

1. **De-duplicated by account** — each account contributes at most once.
2. **Only defensible cases are summed**; non-defensible ones are excluded and **counted separately,
   never as zero**.
3. **CONFLICTING accounts are excluded** from the sum and reported on their own — summing a contested
   figure bakes a disagreement into a portfolio number.
4. **Interval arithmetic** — the aggregate is a range, never a point.

The result always carries a `basis` sentence stating exactly what the total excludes, so it can never
be mistaken for the whole book. Rendered on Motions as one line.

---

## 13. Ask intents

Registered through the P2C-0 registry with explicit precedence. **No bespoke parser outside the
registry. The resolver answers; the LLM does not. P2C-1 is not implemented.**

| Intent | Precedence | Example |
|---|---|---|
| `value.no_case` | 88 | "which high-value pursuits have no defensible value case" |
| `value.conflicting` | 87 | "which value cases contain conflicting economic facts" |
| `value.confirmed` | 86 | "show pursuits with customer-confirmed economics" |
| `value.explain` | 62 (explain) | "what is the value case for Globex" / "what would strengthen Umbrella's value case" |

### 13.1 A shadowing defect the registry caught

The value intents sit at 88–86, **above** `stakeholder.coverage_gap` at 80. The first parser matched
on the bare word *"economic"*, so **"which high-value pursuits lack an economic buyer"** — a
buying-committee question — was silently captured by `value.no_case`. The P2C-0 regression suite
caught it immediately, which is exactly what the explicit-precedence registry exists to do.

Fixed: an utterance mentioning `economic buyer`, `champion`, `decision maker`, `buying committee` or
`stakeholder` is never a Value Case question — "economic buyer" is a **role**, not economics. Three
assertions now lock it, on both SHOW ME and EXPLAIN.

### 13.2 Scope

`value.explain` distinguishes *outside scope* from *does not exist*, and an empty ecosystem scope
returns nothing. Both asserted.

---

## 14. Tests

**New: `scripts/value-case-verify.ts` — 126 assertions, all passing.** Notable groups:

*Substrate (6):* no value-case/ROI/economic-driver table; 12 registry rows; every driver declares its
arithmetic role; disclosure on the existing row with the existing vocabulary.

*Provenance ladder (6):* all five rungs; UNKNOWN is an absence; no second stored classification.

*Three truths (3):* distinct fields; labels present; modeled impact provably independent of the deal
amount and expected value.

*Arithmetic (9):* interval sums; worst-case subtraction; baseline excluded from impact; points and
ranges compose; no drivers ⇒ NOT_ESTABLISHED with no invented range; `UNKNOWN` not `$0`;
assumption-only ⇒ not defensible; baseline-only ⇒ INCOMPLETE naming the missing benefit.

*Contradictions (6):* never averaged; conflict outranks strength; both sides retained and neither
chosen; sensitivity accounts for conflict explicitly; demo Umbrella.

*Sensitivity (10):* spread is the exact contribution; ranking by width removed; collapsing the top
driver genuinely narrows by the reported amount; **a BASELINE never claims to narrow the modeled
range**; range-movers ranked above baseline-only; every reported narrowing equals a BENEFIT/CHANGE
driver's own spread; absent drivers report `null`; settled points omitted; no fake confidence in code
or UI.

*Governed assertion (16):* skill registered; **no CRUD bypass**; pipeline INFERRED writes still
allowed; agent may not verify; evidence required for verification rungs; point-XOR-range;
supersession preserved and back-linked; ledger entry with before/after and ladder; superseded value
is history not truth; human vs model economics distinguishable; cross-tenant and wrong-predicate
prechecks.

*MEDDPICC (5):* reads canonical stakeholders; consumes `assertion_state`; no independent role
columns; unverified can never be `strong`; `metrics` consumes the Value Case.

*Projections and leakage (10):* confidential figure present for sponsor, absent for partner; internal
total never published when it differs; **no withheld magnitude anywhere in the payload**; range
recomputed from disclosable drivers; withheld-entirely case; withholding names no figure/count/driver;
mixed case shares only the disclosable component; NULL treated as INTERNAL; customer-ready not
implemented; boundary documented.

*Brief (9):* BUSINESS VALUE present; range stated; revenue vs impact separated; WHAT WE KNOW
evidenced-only; WHAT NOT TO CLAIM guards; WHAT TO ASK in sensitivity order; **internal total marked
confidential when any driver is withheld**; partner-safe line offered; no confidential figure in any
partner-visible line; non-defensible produces no value messaging.

*Surfaces (11):* no `/value-case` room; `#value` anchor; detail exposes the internal projection;
Accounts state not a score; NOT ESTABLISHED honest; Today risk item; materiality floors; governed
action routing; aggregation de-duplicated, conflicts excluded, non-defensible not zero, basis stated.

*Ask (13):* four intents registered; distinct precedences; **value intents do not shadow
stakeholder.coverage_gap**; champion questions not captured; EXPLAIN routing; three answers resolve
correctly; three labelled truths in the explanation; real arithmetic in "what would strengthen";
confidence disclaimer; scope honored; empty scope returns nothing.

*Isolation (3):* foreign tenant reads zero drivers, cannot read the Value Case, aggregate contains
none of this org's accounts.

*Outcomes (2):* no automatic value-learning; outcomes are not an input to the arithmetic.

*Demo (9):* all six states present; UNKNOWN preserved; sensitivity example material; every economic
fact DEMO/simulated with explicit provenance.

**Full regression battery — no regressions:**

```
npm test                          130 passed, 0 failed
value-case-verify                 126 passed, 0 failed   (new)
lifecycle-query-verify             80 passed, 0 failed
stakeholder-intel-verify           43 passed, 0 failed
canonical-microloop-verify         23 passed, 0 failed
lifecycle-acceptance-verify        21 passed, 0 failed
disclosure-verify                  21 passed, 0 failed
motion-intel-verify                20 passed, 0 failed
recompute-verify                   20 passed, 0 failed
outbox-verify                      20 passed, 0 failed
federation-verify                  19 passed, 0 failed
closed-loop-verify                 18 passed, 0 failed
outcomes-verify                    18 passed, 0 failed
team-motion-verify                 18 passed, 0 failed
partner-intel-verify               17 passed, 0 failed
scope-verify                       17 passed, 0 failed
outcome-bridge-verify              13 passed, 0 failed
governed-mutation-verify           13 passed, 0 failed
observability-verify               13 passed, 0 failed
tenant-flags-verify                13 passed, 0 failed
isolation-verify                   12 passed, 0 failed
contributions-verify               12 passed, 0 failed
ux-scale-sim                       12 passed, 0 failed
append-only-verify                 11 passed, 0 failed
entity-resolution-verify           11 passed, 0 failed
route-persistence-verify           10 passed, 0 failed
ops-verify                         10 passed, 0 failed
recompute-recovery-verify           8 passed, 0 failed
migrations-only-verify              5 passed, 0 failed
```

Production build: clean.

Two regressions were introduced and fixed during the run: the intent-shadowing defect (§13.1), and
`tests/brief.test.ts` asserting exactly ten canonical Brief sections — the eleventh (BUSINESS VALUE)
is an intentional addition and the canonical list was updated.

**Unchanged environment caveat** (carried from P2A, re-confirmed): `facts`, `experience`, `pursuit`,
`routes` and `governance` verify scripts require a dedicated `wsb_verify` database this container
does not provision, and their inline seed omits `taxonomy_nodes.slug`. Pre-existing; not touched.

---

## 15. Screenshots

`audit/intel-wave-screens/p2b/` — desktop, dark and mobile.

| File | Shows |
|---|---|
| `pursuit-value.desktop.png` | The compact card: three labelled truths, state, evidence quality, biggest uncertainty |
| `pursuit-value-open.desktop.png` | Progressive disclosure: ranked sensitivity with real arithmetic, and every driver's provenance, role and sponsor-only marks |
| `pursuit-value-conflicting.desktop.png` | Umbrella — CONFLICTING, modeled impact spanning $1.8M–$2.4M, neither figure chosen |
| `brief-sponsor.desktop.png` | BUSINESS VALUE in the Brief, with the sponsor/partner split |
| `accounts-value.desktop.png` | Account pane Value Case state line |
| `pipeline-value-conflicting.desktop.png` | The Value case filter |
| `motions-value-aggregate.desktop.png` | The aggregate with its basis line |
| `today-value.desktop.png` | Economic gaps as exceptions |
| `*.dark.png`, `*.mobile.png` | Dark mode and 390px mobile |

The BASELINE sensitivity defect (§5) was found by reading `pursuit-value-open.desktop.png` and
verifying its arithmetic by hand against the demo figures.

---

## 16. Performance

`scripts/value-perf.ts`, as `app_rw` with RLS active, 20 runs each, on the demo world (12 economic
facts):

| Query | p50 | p95 |
|---|---|---|
| `loadDrivers` (one account) | 1.2 ms | 2.4 ms |
| `getValueCase` (drivers + three truths + sensitivity) | 2.4 ms | 9.6 ms |
| `toPartnerValueCase` (recompute from disclosable) | 1.8 ms | 2.8 ms |
| `aggregateValue` (Motions, whole book) | 23.3 ms | 26.5 ms |

`getValueCase` is O(economic facts on the account) plus two small scalar queries. `aggregateValue` is
the only whole-book path and is N+1 by construction — one Value Case per account. At demo scale that
is 23 ms; at large book scale it would need batching, recorded as a limitation in §17.4.

---

## 17. Unresolved economic-model limitations

1. **Single currency.** `money_currency` is carried but v1 sums assume USD. A multi-currency book
   needs a conversion policy with its own provenance (which rate, as of when) — deliberately not
   invented here.
2. **A derived partner-safe fact could still leak.** The leakage guard is sound for facts asserted
   independently. If a future producer *derives* a partner-safe figure from a confidential one (e.g.
   avoided cost computed as 40% of a confidential baseline), the derived fact would need its
   disclosure class set to reflect its input. Nothing in v1 derives facts, so the gap is latent —
   recorded here rather than assumed away. The fix is disclosure propagation at derivation time.
3. **No time value.** All benefits are treated as recurring annual figures. There is no discounting,
   no multi-year horizon and no NPV. `time_to_value_months` is captured but does not shape the
   arithmetic. A payback-period model is a real extension, not a formatting change.
4. **Aggregation is N+1.** `aggregateValue` computes one Value Case per account serially. Fine at
   demo scale (23 ms); a large book needs a batched driver load.
5. **No confidence calibration.** By design — §6 forbids stating confidence improvements without a
   calibrated model, and none exists. Sensitivity therefore reports range widths only.
6. **Evidence links are optional.** `fact_evidence` is populated only when an assertion cites an
   existing `evidence` row by id; a stated evidence sentence lives in `data_lineage` and the ledger.
   A first-class "attach the document" flow does not exist yet.

---

## 18. Customer-ready projection boundary (designed, NOT built)

`CUSTOMER_READY_IMPLEMENTED = false`, and the boundary is recorded in `projection.ts` so nothing here
can be repurposed by accident:

1. **A different question.** Internal and partner projections answer *what do we believe and how well
   is it supported*. A customer-ready projection makes a **claim to the customer about their own
   business**. That needs a claims policy — who may assert a number about someone else's operations,
   and on what evidence — which does not exist.
2. **A review gate, not a filter.** Partner disclosure is a policy decision the engine can make. A
   customer-facing economic claim requires human review **of the claim itself**, recorded, before it
   leaves the building. There is no such review object today.
3. **A narrower evidence bar.** Plausibly INFERRED is adequate internally and often adequate for a
   partner. It is **not** adequate to tell a customer what their own costs are. A customer-ready case
   admits VERIFIED and CUSTOMER-CONFIRMED drivers only — a different assembly, not a filter over this
   one.
4. **No accidental export.** Neither `ValueCase` nor `PartnerValueCase` is customer-safe; neither may
   be serialized outward, and no external send path exists for either in this phase.

---

## 19. Explicitly deferred

- **Customer-ready Value Case** — boundary designed (§18), not built.
- **P2C-1 LLM answer tier** — unchanged from P2C-0: the contract and its single structured entry
  point exist; the model tier does not.
- External sending; broad Pursuit creation; CRM migration; MDF optimization; executive reporting
  expansion; fit-v2; production commissioning; stakeholder vocabulary expansion.
- Multi-currency normalization (§17.1); disclosure propagation through derived facts (§17.2);
  time-value / payback modeling (§17.3); batched aggregation (§17.4); evidence attachment flow
  (§17.6).
- Automatic value learning from outcomes — **not authorized in this phase**. `outcome_learning`
  remains demo-only and unchanged, and the suite asserts outcomes are not an input to the arithmetic.

---

## 20. Files

**New**

```
supabase/migrations/0099_economic_value_case.sql   registry rows + facts.disclosure_class + guard
src/lib/value/drivers.ts                           driver loading, roles, the provenance ladder
src/lib/value/case.ts                              the three truths, arithmetic, states, sensitivity
src/lib/value/projection.ts                        internal/partner projections + leakage guard
src/lib/value/assert.ts                            the governed economic assertion handler
src/lib/value/aggregate.ts                         explicit aggregation semantics
src/lib/value/intents.ts                           deterministic Value Case ⌘K resolvers
src/components/pursuit/value-case.tsx              compact-first Value Case card
scripts/demo-value-story.ts                        demo enrichment via the governed path
scripts/value-case-verify.ts                       the acceptance suite (126)
scripts/value-perf.ts                              read-path performance
scripts/value-screens.mjs                          screenshot harness
```

**Modified**

```
src/lib/pursuits/federation/skills.ts       assert_economic_fact registered
src/lib/opportunities/meddpicc.ts           consumes canonical assertion_state + the Value Case
src/lib/pursuits/read-models/detail.ts      internal Value Case on the detail view
src/lib/pursuits/read-models/types.ts       PursuitDetailView.valueCase
src/lib/pursuits/read-models/brief.ts       BUSINESS VALUE + know/notclaim/ask contributions
src/lib/pursuits/read-models/today.ts       economic gaps as exceptions, above floors
src/lib/accounts/intel.ts                   Value Case state
src/components/accounts/intel-pane.tsx      the state line
src/app/pursuits/[id]/page.tsx              #value panel
src/app/pipeline/page.tsx                   Value case filter
src/app/motions/page.tsx                    aggregate with explicit basis
src/lib/search/intents.ts                   four value intents, explicit precedence
tests/brief.test.ts                         canonical section list gained BUSINESS VALUE
```
