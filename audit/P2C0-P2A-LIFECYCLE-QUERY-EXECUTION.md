# P2C-0 + P2A — Query Foundation and Lifecycle Intelligence

**Scope executed:** P2C-0 (intent registry, `/ask` scope invariant, LLM authority boundary) and
P2A (Lifecycle Intelligence over the canonical fact graph).
**Not executed, by instruction:** P2B Value Case, P2C-1 LLM answer tier.
**Status:** green — 80/80 on the new acceptance suite, 130/130 unit tests, full regression battery
passing, production build clean.

---

## 1. Intent registry architecture (P2C-0)

### What was wrong

`/api/palette` dispatched SHOW ME and EXPLAIN through a hand-ordered `if / else if` chain. Three
consequences, all structural rather than cosmetic:

1. **Precedence was source order.** A broad grammar placed above a narrow one silently swallowed it.
   The correctness of an answer depended on where in the file a parser happened to be pasted.
2. **Ambiguity was invisible.** When two parsers could both match, the first one won and the user was
   never told a choice had been made on their behalf.
3. **There was no seam for a model.** Any future natural-language tier would have had to re-enter
   through the same regex chain, which is not a contract.

### What replaced it

`src/lib/search/registry.ts` — a declarative registry. Every intent is one `IntentDefinition`:

| Field | Meaning |
|---|---|
| `intentKey` | Stable identity (`lifecycle.horizon`), the only thing a model may name |
| `intentClass` | `showme` / `explain` — the classifier's existing output, unchanged |
| `precedence` | **Explicit integer.** Higher wins. Never source order |
| `requiredSlots` / `optionalSlots` | The slot contract, validated before any resolver runs |
| `scope` | `COMPANY_SCOPED` / `ORG_SCOPED` |
| `match(q)` | Utterance → slots, or `null` |
| `resolve(ctx, slots)` | The deterministic resolver. The **only** thing that produces an answer |
| `examples` | Documentation and test fixtures |

`routeIntent` collects **every** candidate, then decides:

- **0 candidates → `UNSUPPORTED`.** Says so. Never guesses.
- **1 top candidate → `MATCHED`.**
- **Tie at the top precedence → `AMBIGUOUS`.** Reports the candidates and asks the user to narrow.
  It never picks whichever parser appeared first.

The registry forbids precedence ties among registered intents by design, and the acceptance suite
asserts that no two `showme` intents share a precedence — a tie is a design error caught in CI, not a
coin flip at runtime.

### Migrated intents — behavior preserved

| Intent key | Precedence | Previously |
|---|---|---|
| `motion.execution_ready` | 90 | first branch of the SHOW ME chain |
| `lifecycle.horizon` | 85 | *(new)* |
| `lifecycle.conflicting` | 84 | *(new)* |
| `lifecycle.unknown_timing` | 83 | *(new)* |
| `stakeholder.coverage_gap` | 80 | second branch |
| `opportunity.filter` | 10 | fallback branch (the broad allowlist grammar) |
| `lifecycle.explain` | 60 | *(new)* |
| `record.explain` | 10 | the EXPLAIN branch |

All three pre-existing utterances resolve to the same resolver and return the same shaped answer. The
suite proves this directly, including the precedence relationship that used to be implicit: a
stakeholder phrase is **not** captured by `opportunity.filter`, and that is now provable
(`80 > 10`) rather than a property of line numbers.

GO TO / SHOW ME / EXPLAIN classification (`classifyIntent`) is untouched.

---

## 2. The `/ask` scope invariant (P2C-0)

### The gap

`/ask` runs a tool-using agent (`askTheRecord`, ≤6 rounds over the `MCP_TOOLS` read subset). It
ignored the ecosystem scope entirely. An operator narrowed to one ecosystem could ask about an
account outside it, or ask for a whole-book aggregate, and the model would read and answer from the
full tenant. The disclosure projection ran on the *final answer*, not on what entered the context.

### The fix — `src/lib/agents/ask-scope.ts`

Scope is enforced **at the tool boundary, before the tool runs**, so out-of-scope data never becomes
model-visible context. This is the invariant the spec names: *no confidential evidence may be placed
into the LLM context merely because the final answer would omit it.*

| Situation | Behavior |
|---|---|
| Scope `ALL` (`companyIds == null`) | Unchanged. Byte-identical to pre-P2C-0 |
| Empty scope (`[]`) | Every tool refused. A valid "nothing in scope" |
| Account-addressed tool, account in scope | Allowed |
| Account-addressed tool, account outside scope | **Refused before `tool.run`**. The refusal payload is what reaches the model |
| Org-wide aggregate tool under a narrowing scope | Refused. An aggregate over the whole book carries out-of-scope magnitude |
| Unresolvable account name | Allowed through, so the tool can answer "no such account" — not a scope violation |

`scopeSystemNote` prepends a statement of the active scope to the system prompt, so the model
describes its own limits rather than silently answering from a subset.

**Narrowing-only, proven.** `companyIds` originates from `resolveScope` on the authorized set. The
guard can only ever *subtract*. A foreign or forged scope cannot widen reach: RLS remains the outer
authority, and every tool still runs inside the tenant session.

**One hardening found during verification.** Account names are not unique. The original guard
resolved the named account globally (shortest match) and then checked scope membership. With
look-alike accounts present, this could bind "Globex" to a record the operator cannot see and then
refuse the one they can — a scope check failing closed on the *wrong record* is still a wrong answer.
The guard now resolves **within the authorized set first**, falling back to the global lookup only
when nothing in scope matches, and that fallback path can only ever produce a refusal. This cannot
widen access: the in-scope lookup is a strict subset of `companyIds`.

Sponsor and partner visibility remain distinct: partner-visible payloads are built from federation
contributions and the disclosure ladder, never from `facts`. Cross-tenant isolation is asserted
directly (a foreign tenant reads zero lifecycle facts of this org, and its horizon contains none of
this org's accounts).

---

## 3. The LLM authority boundary (P2C-0)

The target contract is now established in code, with the model tier deliberately **not built**:

```
natural language
   → [P2C-1: LLM/interpreter]        ← NOT IMPLEMENTED
   → { intentKey, slots }
   → schema validation               ← resolveStructured
   → canonical deterministic resolver
   → authorized, evidence-grounded answer
```

`resolveStructured(ctx, intentKey, slots)` is the **only** door a future model tier may use. It:

- rejects an unregistered `intentKey` (`UNSUPPORTED`, "unknown intent") — a model cannot invent one;
- validates required slots before dispatch — a model cannot skip the slot contract;
- calls the registered resolver, which is the same deterministic code the ⌘K path calls.

The model therefore never becomes authoritative for records, facts, amounts, dates, routes,
stakeholders, attribution, readiness, or outcomes. It can only name an intent and fill slots. When
the deterministic resolver cannot support the request, the answer is `UNSUPPORTED` or `UNKNOWN`.

Three acceptance tests hold this line: the LLM path cannot reach an unregistered intent, cannot skip
slot validation, and **can** reach a registered resolver — where the resolver answers, not the model.

---

## 4. Lifecycle state derivation (P2A)

Five states, **derived** at read time from existing canonical columns. No stored status, no new
table, no second score.

| State | Rule |
|---|---|
| `VERIFIED_DATE` | A live fact with a precise `date_value`, from a provenance class trusted for precision, not stale |
| `INFERRED_WINDOW` | Evidence supports a bounded period but not a day — **or** a precise date from a source not trusted for precision |
| `STALE_DATE` | Past `valid_until` (VALID_UNTIL policy) or beyond `half_life_days` (DECAYING). The date is kept as history |
| `CONFLICTING_DATE` | An open `fact_contradictions` row, or two live facts asserting different dates |
| `UNKNOWN` | No authoritative lifecycle evidence |

Precedence when several apply: **CONFLICTING > VERIFIED > INFERRED_WINDOW > STALE > UNKNOWN.** A
conflict outranks a verified date because acting on one of two disagreeing dates is the more
dangerous error.

**CONFLICTING and STALE are never collapsed into UNKNOWN.** "We disagree with ourselves" and "we knew
this once" are different commercial situations from "we never knew", and each has a different next
action. Asserted explicitly in the suite.

Superseded and REJECTED rows are filtered before derivation — history, not current truth — and the
supersession chain remains readable through progressive disclosure.

### False precision, made structural

Migration `0098_lifecycle_predicates.sql` registers `renewal_window` with

```sql
allowed_provenance_classes = ARRAY['THIRD_PARTY_UNVERIFIED','THIRD_PARTY_VERIFIED','INFERRED']
```

so an unverified source **cannot** land a confirmed renewal date by convention drift; the registry
refuses it. In parallel, `deriveLifecycleEvent` returns `INFERRED_WINDOW` with `date: null` whenever
the provenance is untrusted, even if a precise `date_value` is present. Two independent mechanisms,
one rule: *an unverified source never gets to name a day.*

### Cross-predicate conflicts (found in screenshot review, fixed)

The first implementation derived per predicate, so Stark's contradiction — a `contract_expires`
disagreeing with a `renewal_date` — rendered as two rows each labelled "conflicting" while showing a
single date. A row that says *conflicting* beside one lone date is exactly the false confidence this
state exists to remove.

`loadLifecycleFacts` now carries `contradictsFactIds` per fact, and derivation unions this predicate's
own dated rows with every fact an open contradiction links them to — **including facts under a
different predicate**. Both sides are always named; neither is chosen. Competing rows carry their
originating predicate so the reader can see *which* date came from where. Two regression assertions
lock this.

---

## 5. Renewal-radar reconciliation — one renewal truth (P2A)

### What was actually there

Not two renewal truths — **five**. Each of these read `population_members.attributes->>'renewal_date'`
with its own SQL, its own window, and its own casting:

- `src/app/pipeline/page.tsx` (renewal radar, 120 days)
- `src/app/partners/[id]/review/page.tsx` (partner review sheet, 180 days)
- `src/lib/context/timeline.ts` (account timeline, 180 days)
- `src/lib/routines/routines.ts` (weekly account digest, 90 days)
- `src/lib/context/divergence.ts` (uncovered-renewal detector, 60 days)

None of them could see a customer-confirmed date, a contradiction, or an inferred window. All five
rendered every value as a confirmed day.

### The reconciliation

The canonical fact graph is now the single renewal truth.

- **`src/lib/lifecycle/bridge.ts`** — one-way, idempotent promotion of the import attribute into the
  graph. Provenance is preserved honestly (`SECOND_PARTY` for partner populations, else
  `THIRD_PARTY_UNVERIFIED`), the original value and population are kept in `data_lineage`, and the
  fact always lands on `renewal_window` (RANGE, ±15 days) so **an import can never masquerade as a
  confirmed date**. It never overwrites a trusted precise date. Nothing is discarded.
- **`src/lib/lifecycle/projection.ts`** — the *explicit, one-way compatibility projection* the design
  permits. It is the one place a derived `LifecycleEvent` is reduced to the flat `{date, phrase}`
  shape the legacy surfaces render. It is a projection, not a second model: nothing writes, a window
  never becomes a day, a conflict never picks a side, and `state` is exposed so callers can say more
  than "due X".

`divergence.ts` reads the graph directly. The other four now consume the projection. The acceptance
suite scans all five files (comments stripped, so documenting the old path is not an offence) and
fails if any of them reads the import attribute again. `bridge.ts` is asserted to be the *only*
reader, and to be promotion-only.

### An attribution defect found in screenshot review

The reconciled radar initially printed `Renewal due 2026-11-15 · from "Our modernization targets"` —
but that date came from a customer call, not from that list. The list is **membership**, not the
date's source. Misattributing provenance on the very surface built to make provenance legible is a
correctness defect, not a copy nit.

The projection now carries `sourceNote` — the date's own provenance in plain words ("customer
declared", "third-party, unverified", "partner-reported vs customer declared" for a conflict) — and
every consumer prints that. List membership, where relevant, is rendered as `on "<list>"`. Two
assertions hold the rule, including a source scan that fails if any surface renders list membership
as the date's source.

### Debt, documented not hidden

`population_members.attributes.renewal_date` remains the **ingest landing spot**, so the bridge must
run for imported renewals to reach the graph. The permanent fix is ingest writing canonical facts
directly. That is a broad ingestion rewrite, explicitly out of scope here per the halt condition; the
smallest possible compatibility bridge was used instead and the debt is recorded here and in the
module header.

---

## 6. Canonical predicates used

Reused from the existing registry: `renewal_date`, `contract_expires`, `compliance_deadline`.

Added by `0098_lifecycle_predicates.sql` (registry rows only — **no new table, no new column on
`facts`**):

| Predicate | Object type | Freshness | Notes |
|---|---|---|---|
| `renewal_window` | RANGE | DECAYING 270d | Provenance-restricted (see §4) |
| `subscription_term_end` | DATE | VALID_UNTIL | |
| `contract_expires` *(existing)* | DATE | VALID_UNTIL | |
| `end_of_life_date` | DATE | VALID_UNTIL | |
| `end_of_support_date` | DATE | VALID_UNTIL | |
| `support_lifecycle_phase` | ENUM | DECAYING | |
| `migration_deadline` | DATE | VALID_UNTIL | |

Also in 0098: `change_ledger_change_type_check` extended with `LIFECYCLE_DATE_CONFIRMED` /
`LIFECYCLE_DATE_DISPUTED` (constraint read, dropped and re-added preserving existing values), and a
partial index `facts_lifecycle_date on facts (org_id, date_value) where date_value is not null and
status in ('CURRENT','DISPUTED','STALE')`.

Everything else is reuse: `facts.date_value` / `valid_from` / `valid_until` / `status` /
`provenance_class` / `half_life_days` / `freshness_policy` / `supersedes` / `superseded_by`,
`fact_contradictions`, `fact_evidence`, `fact_predicates`.

**No parallel timing score.** Timing remains the existing scoring dimension. Reading lifecycle state
writes nothing. Three assertions: reading never writes a score; no new score/status column exists; no
new renewal/contract/lifecycle table exists.

---

## 7. WHY NOW integration

`WhyNowView` gained `lifecycle: LifecycleEvent[]`, computed in `getPursuitWhyNow` **independently of
whether a structured Why Now exists** — an account with no Why Now record still gets its lifecycle
timing. Both return paths carry it.

The enhancement is state-bearing, never a bare date. Where a window exists it renders as a range;
where sources disagree it renders as a disagreement. Avoiding fake exactness is the point.

`buildPursuitBrief` inherits both the state and the uncertainty:

- WHY NOW appends lifecycle lines (a conflict renders "A vs B"; a window renders a range);
- **WHAT NOT TO CLAIM** gains guardrails — an inferred window is *"not a confirmed date — do not
  state a specific day"*, a conflicting date is *"contradicted across sources"*, a stale date is
  *"past its validity"*.

---

## 8. UX changes

| Surface | Change | Restraint |
|---|---|---|
| **Accounts** (`intel-pane`) | One lifecycle row inside "Why now": label · when · state | One line. UNKNOWN shows nothing rather than an empty promise |
| **Pursuit Detail** | `LifecycleBento` in an anchored `#whynow` panel | Compact first: `label · state · when`, ~2-second read. Sources, provenance, observed dates, half-life, supersession and contradictions are **one click away**, not the first view |
| **Today** | `LIFECYCLE_CONFLICT` (RISK) and `LIFECYCLE_WINDOW` (OPPORTUNITY) items | Materiality floors: $500k for windows, $250k for conflicts. No calendar spam; asserted |
| **Motions** | One context line above the funnel: accounts with a material date in 90 days, how many contradicted, how many have no evidence | **Context only — it does not participate in any gate.** Stated in the UI and in the code comment. A renewal date is not readiness |
| **Pipeline** | Renewal radar reconciled onto the graph; new `Lifecycle` filter (renewing in 90 days / conflicting timing / stale evidence) | A filter beside the existing atomic filters — no new dashboard, no new column, no new score. UNKNOWN is deliberately *not* offered: Accounts already answers "where do we know nothing" |
| **Brief** | Inherits state and uncertainty (§7) | |
| **⌘K** | Four lifecycle intents, all through the registry | **No bespoke parser outside the registry** |

### Evidence and contradiction UX

Progressive disclosure throughout. The first view says **"Renewal: conflicting"** — not a forensic
ledger. Opening the row reveals why, what would change it, every competing source with its predicate
and provenance, the observed dates, the decay policy, and the supersession chain.

The Pipeline lifecycle filter renders a one-line explanation of what it selected on and what that
state means ("Sources disagree — the date is not settled by choosing one"), so the filter is legible
without adding a column.

---

## 9. ⌘K intents

| Utterance | Intent | Behavior |
|---|---|---|
| "what changes in the next 90 days" | `lifecycle.horizon` | Ranked by lifecycle relevance + materiality + existing canonical priority. **States its own blind spot** — how many accounts have no lifecycle evidence at all |
| "which renewal dates are conflicting" | `lifecycle.conflicting` | Both sides shown, neither chosen |
| "which accounts have unknown timing" | `lifecycle.unknown_timing` | UNKNOWN as a first-class answer |
| "explain the renewal for <account>" | `lifecycle.explain` | State, competing dates, grounding. Honors ecosystem scope: an out-of-scope account is not answerable |

The signature interaction ranks by `STATE_RANK` (conflicts first — a contradiction is more urgent
than a known date), then days-until, then the account's **existing** expected value. **No new hidden
composite score**: every input is a named, already-canonical factor, and UNKNOWN accounts are counted
separately rather than padded into the ranked list.

---

## 10. Scope and disclosure proof

| Invariant | How it holds | Test |
|---|---|---|
| Tenant isolation | `org_id` predicate + RLS on every lifecycle query | A foreign tenant reads zero lifecycle facts; its horizon contains none of this org's accounts |
| Ecosystem scope | `companyIds` threaded through `loadLifecycleFacts`, `getLifecycleHorizon`, `renewalProjection`, `resolveLifecycleExplain` | Single account ⇒ that account; empty ⇒ nothing; never widens |
| `/ask` scope | Enforced at the tool boundary before execution (§2) | 6 assertions |
| Sponsor-confidential facts | Partner payloads are built from federation contributions and the disclosure ladder, never from `facts` | Wayne's RESTRICTED contract date exists for the sponsor and is unreachable cross-tenant |
| Aggregations | Computed over the already-authorized set — `getLifecycleHorizon` sums only in-scope pursuits | Exposure sum asserted against the in-window set |

**Known limitation, stated plainly:** `facts` carries no per-row `disclosure_class` column. The
boundary today is tenant + federation projection, which is sufficient for the invariant as specified
(a sponsor-confidential lifecycle fact cannot enter a partner payload), but a per-fact disclosure
class would make it enforceable at the row rather than the surface. Deferred; not silently assumed.

---

## 11. Tests

**New: `scripts/lifecycle-query-verify.ts` — 80 assertions, all passing.**

P2C-0 (20): registry composition; no precedence ties; precedence-ordered listing independent of
source order; all three migrated intents route and resolve identically; precedence beats the broad
grammar; unsupported utterances say so; the ambiguity contract; the structured door rejects unknown
intents and missing slots and lets the resolver answer; `classifyIntent` unchanged; `/ask` scope ALL
unchanged, in-scope allowed, out-of-scope refused **before the tool runs**, org-wide aggregates
refused under narrowing, empty scope refuses everything, narrowing-only.

P2A (60): all five state derivations; false precision blocked; STALE not collapsed into UNKNOWN;
CONFLICTING not collapsed into UNKNOWN; both sides shown and neither chosen; **cross-predicate
conflicts name both dates and carry their predicates**; supersession; conflict outranks verified; all
five demo accounts in their intended state; no parallel score, no new score column, no new table;
horizon behavior, blind-spot reporting, conflict-first ranking, exposure sum, scope narrowing, window
subsetting; shared constraint language; a verified date produces no constraint; **no surface reads
the import JSON attribute**; the bridge is the only reader and promotion-only; the projection carries
state not bare dates and honors scope; **the projection attributes the date to its own provenance,
not the account's list**, and no surface renders membership as source; bridge idempotency, honest
provenance, lineage preservation, never overwriting a trusted date; WHY NOW, Brief WHY NOW, Brief
WHAT-NOT-TO-CLAIM guardrails; Today risk/opportunity items, materiality floors, clean copy; all four
⌘K intents including scope handling; cross-tenant disclosure isolation.

**Full regression battery — all passing, no regressions:**

```
npm test                          130 passed, 0 failed
lifecycle-query-verify             80 passed, 0 failed   (new)
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

**Environment note (not a code result).** `facts`, `experience`, `pursuit`, `routes` and `governance`
verify scripts expect a dedicated `wsb_verify` database whose bootstrap this container does not have,
and their inline seed omits `taxonomy_nodes.slug`, which the current schema requires. This was
confirmed pre-existing by stashing the entire change set and reproducing the identical failures on
the unmodified tree. Not a regression from this work, and not repaired here (out of scope).

---

## 12. Screenshots

`audit/intel-wave-screens/p2a/` — desktop, dark and mobile.

| File | Shows |
|---|---|
| `pursuit-lifecycle.desktop.png` | Lifecycle timing compact-first inside Why Now |
| `pursuit-lifecycle-open.desktop.png` | Progressive disclosure opened: why, what changes it, every competing source with predicate and provenance |
| `today.desktop.png`, `today-all.desktop.png` | Lifecycle risk and opportunity items in materiality order |
| `pipeline-radar.desktop.png` | Reconciled renewal radar — each row states what kind of date it is and where the date came from |
| `pipeline-life-conflicting.desktop.png` | The lifecycle filter with its explanation line |
| `pipeline-life-renew90.desktop.png` | Renewing-in-90-days filter |
| `accounts-whynow.desktop.png` | Account intel pane lifecycle row |
| `motions-lifecycle-context.desktop.png` | Motions context line — explicitly non-gating |
| `*.dark.png`, `*.mobile.png` | Dark mode and 390px mobile |

Three defects were found in screenshot review and fixed, each with a regression assertion added:
cross-predicate conflicts showing one date (§4), list membership printed as the date's source (§5),
and `"renewal window window"` plus a duplicated account name in Today's copy.

---

## 13. Performance

Measured by `scripts/lifecycle-perf.ts` as the non-owner `app_rw` role with RLS active, 20 runs each.
The scale seed runs inside a transaction that is always rolled back.

**Demo world — 28 accounts, 5 dated facts:**

| Query | p50 | p95 |
|---|---|---|
| `loadLifecycleFacts` (whole book) | 0.8 ms | 1.5 ms |
| load + derive all states | 0.8 ms | 1.6 ms |
| `getLifecycleHorizon` 90d (⌘K, Today, Motions) | 1.5 ms | 2.0 ms |
| `renewalProjection` 120d (Pipeline radar) | 1.5 ms | 2.7 ms |
| `renewalProjection` 90d, one account (digest) | 1.6 ms | 2.5 ms |

**At scale — 5,000 extra accounts, 5,005 dated facts:**

| Query | p50 | p95 |
|---|---|---|
| `loadLifecycleFacts` (whole book) | 50.4 ms | 64.0 ms |
| load + derive all states | 70.3 ms | 89.9 ms |
| `getLifecycleHorizon` 90d | 38.1 ms | 62.8 ms |
| `renewalProjection` 120d | 61.3 ms | 92.2 ms |

The read path is O(dated facts in scope). **One deliberate non-optimization:** the loader fetches all
of an account's lifecycle facts, not just those inside the requested window. Narrowing by date in SQL
would be faster and wrong — a competing date sitting *outside* the horizon is exactly what turns a
VERIFIED_DATE into a CONFLICTING_DATE. The cap belongs on the output, not the input. One optimization
was taken: company names and list attribution are resolved only for rows that survive the window and
the cap (`renewalProjection` 120d improved from 98 ms to 61 ms p50 at 5k accounts).

---

## 14. Demo enrichment

`scripts/demo-lifecycle-story.ts` — minimal, explicit, and deliberately incomplete.

| Account | State | Evidence |
|---|---|---|
| Globex | VERIFIED DATE | Customer-declared renewal, 76 days out |
| Umbrella | INFERRED WINDOW | Third-party signal, 58–104 days — a period, never a day |
| Stark | CONFLICTING DATE | `contract_expires` 47d vs `renewal_date` 89d, open contradiction |
| Hooli | STALE DATE | First-party term that ended 24 days ago |
| Cyberdyne | UNKNOWN | Deliberately untouched — no lifecycle evidence at all |
| Wayne | Sponsor-confidential | RESTRICTED contract date; absent from partner payloads |
| Acme | Import bridge | A `population_members` attribute promoted one-way into the graph as a window |

Every row is `DEMO` / `is_simulated` with explicit provenance, and the script is idempotent. **Not
every account conveniently has lifecycle intelligence** — Cyberdyne's UNKNOWN and the several
untouched accounts are the point, not an oversight.

---

## 15. Unresolved lifecycle ingestion needs

1. **Ingest still lands renewal dates in `population_members.attributes`.** The bridge must run for
   imported renewals to reach the graph. The correct fix is ingest writing canonical facts directly
   with provenance at the point of import. Deferred as a broad ingestion rewrite.
2. **No per-fact `disclosure_class`.** The disclosure boundary is tenant + federation projection.
   Row-level disclosure on `facts` would make the sponsor-confidential invariant enforceable at the
   row rather than at the surface (§10).
3. **No lifecycle-date confirmation workflow.** `LIFECYCLE_DATE_CONFIRMED` / `LIFECYCLE_DATE_DISPUTED`
   are registered on the change ledger but no governed skill emits them yet. Resolving a conflict is
   currently a human action in the source system; making it a governed assertion (as P1C did for
   stakeholder roles) is the natural next increment.
4. **No lifecycle provider.** Every lifecycle fact is human-, import-, or demo-sourced. There is no
   automated collector for EOL/EOS or support-lifecycle dates, so `end_of_life_date`,
   `end_of_support_date` and `support_lifecycle_phase` are registered but unpopulated.

---

## 16. P2B design decisions — LOCKED, not implemented

Recorded here so the next window starts from a decision, not a debate.

1. **The Value Case uses the fact graph.** No new generic ROI primitive unless the graph is proven
   insufficient with a named case.
2. **Provenance ladder:** VERIFIED / CUSTOMER-CONFIRMED / INFERRED / ASSUMED / UNKNOWN, mapped onto
   the existing canonical `provenance_class` values rather than a parallel vocabulary.
3. **Three economic truths get reconciled**, not multiplied: the opportunity amount, the expected
   value, and economic/value-case facts. One authority, explicit projections.
4. **MEDDPICC `economic_buyer` / `champion` stop being competing stakeholder authorities.** The P1C
   canonical stakeholder assertions are authoritative; MEDDPICC may consume and reference them as
   qualification context. **No dual-writing of incompatible role truth.**
5. **v1 ships internal + partner projections only.** Customer-ready output is deferred.
6. **Sensitivity is not confidence.** No stated confidence-percentage improvements without a
   legitimate calibration model behind them.

---

## 17. Explicitly deferred

- **P2B Value Case** — designed and locked (§16), not built.
- **P2C-1 LLM answer tier** — the contract and its only entry point exist (§3); the model tier does not.
- Customer-ready Value Case output; external sending.
- Broad Pursuit creation; CRM migration; MDF; executive reporting expansion; fit-v2.
- Production commissioning; stakeholder vocabulary expansion.
- Ingest writing canonical lifecycle facts directly (§15.1).
- Per-fact `disclosure_class` (§15.2).
- Governed lifecycle-date confirmation/dispute skill (§15.3).
- A lifecycle-date provider (§15.4).
- Repair of the five environment-dependent verify scaffolds (§11) — pre-existing, out of scope.

`outcome_learning` remains demo-only and unchanged.

---

## 18. Files

**New**

```
supabase/migrations/0098_lifecycle_predicates.sql   registry rows only — no new table
src/lib/search/registry.ts                          the intent registry + routing + structured door
src/lib/search/intents.ts                           intent registrations with explicit precedence
src/lib/agents/ask-scope.ts                         /ask scope guard at the tool boundary
src/lib/lifecycle/state.ts                          five-state derivation
src/lib/lifecycle/horizon.ts                        "what changes in the next N days"
src/lib/lifecycle/projection.ts                     the one-way renewal compatibility projection
src/lib/lifecycle/bridge.ts                         one-way import → fact graph promotion
src/lib/lifecycle/intents.ts                        lifecycle ⌘K resolvers
src/components/pursuit/lifecycle.tsx                compact-first lifecycle bento
scripts/demo-lifecycle-story.ts                     demo enrichment
scripts/lifecycle-query-verify.ts                   the acceptance suite (80)
scripts/lifecycle-perf.ts                           read-path performance
scripts/lifecycle-screens.mjs                       screenshot harness
```

**Modified**

```
src/app/api/palette/route.ts                        if/else chain → registry dispatch
src/lib/agents/ask.ts                               scope threading + tool-boundary enforcement
src/app/ask/actions.ts                              resolves the ecosystem scope
src/lib/search/query.ts                             ParsedQuery exported
src/lib/context/divergence.ts                       reads the fact graph
src/lib/context/timeline.ts                         reads the projection
src/lib/routines/routines.ts                        reads the projection
src/app/pipeline/page.tsx                           radar reconciled + lifecycle filter
src/app/partners/[id]/review/page.tsx               reads the projection
src/app/motions/page.tsx                            non-gating lifecycle context
src/app/pursuits/[id]/page.tsx                      #whynow anchor + lifecycle bento
src/components/accounts/intel-pane.tsx              lifecycle row in Why now
src/lib/accounts/intel.ts                           lifecycle summary
src/lib/pursuits/read-models/{types,detail,brief,today}.ts   WHY NOW / Brief / Today integration
tests/brief.test.ts                                 fixture update
```
