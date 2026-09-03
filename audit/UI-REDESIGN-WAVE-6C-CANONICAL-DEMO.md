# Wave 6C — Canonical demo world reconciliation + readability integrity

**Branch** `ui-wave-6c`, from `f5061932f7a194b48e4d3016e6167ea8362fb906` (Wave 6B).
**Not pushed. Not deployed. The production-designated branch is untouched.**

Wave 6B ended on a NO-GO whose stated blocker was honest but incomplete: *22 assertions
across 5 SEEDED suites could not be adjudicated as code-vs-data, because the canonical
demo world had no faithful build recipe.* This wave establishes the recipe, reconciles all
22, and closes a readability defect in Ask.

The finding underneath all of it: **the canonical demo world was never authored — it
accreted.** Two seed layers described the same hero accounts and both wrote them; 19
verifier suites committed run-scoped fixtures into it; and nothing ever checked what a
rebuild produced. Assertions were then written against whatever that sediment happened to
be. Rebuilding it was not a fix by itself — it *moved assertions in both directions*, which
is exactly what Wave 6B reported and could not explain.

---

> **Reconstruction note.** The original Wave 6C commit was lost when this container was
> reclaimed before it had been pushed. Every code change below was replayed mechanically
> from the persisted session transcript — 28 recorded file operations, all of which applied
> cleanly with no ambiguity — and **every number was re-measured on the replayed tree.** The
> re-measured results match the original run exactly: same manifest digest
> (`be0da833990ce436`), same 238 / 215 / 658 class totals, same canonical figures. That
> agreement is evidence the recipe is genuinely deterministic across containers, not just
> within one.
>
> One artefact was not in the replay set: `audit/canonical-demo-world.json` was originally
> produced by a shell redirect of the manifest tool rather than a file write, so it was
> regenerated here from the rebuilt world — which is its correct provenance in any case.

## §1 Wave 6B fixes preserved

Verified present and unweakened; none was relaxed to make a SEEDED test green.

| Wave 6B fix | Location | State |
|---|---|---|
| `SAVEPOINT` around governed-skill dispatch, so a DB-level failure still records a `FAILED` invocation | `src/lib/pursuits/federation/skills.ts` | unchanged |
| Disclosure absence assertions made non-vacuous (`RESTRICTED_AMOUNT_*`) | `scripts/experience-verify.ts` | unchanged |
| Verifier class contract + connection guard | `scripts/verify-classes.ts`, `verify-guard.ts` | extended, not weakened |
| Written build recipe for the demo world | `scripts/seed-demo-world.ts` | extended with verification |

---

## §2 The canonical demo world is now declared, not inferred

`scripts/demo-manifest.ts` emits the world as stable JSON; `audit/canonical-demo-world.json`
is the committed copy. Identifiers and timestamps are excluded deliberately — they are
regenerated every build, so including them would make the digest differ every time and prove
nothing. What is included is what a demo is actually given on: the tenants, the hero cast
with the facts that distinguish each one, the four headline figures with their definitions,
and row counts for the material tables.

**Digest `be0da833990ce436`** · 3 tenants (1 guest) · 14 companies · 14 pursuits · 19
opportunities · 7 motions · 1 goal.

One correction worth recording: the first draft of the manifest counted `value_cases` and
`stakeholder_assertions`, tables that do not exist under those names, and a `.catch(() => 0)`
reported them as **0 rows**. A manifest that quietly says "there is none of this" when it
means "I asked the wrong question" reads as a finding and is worse than no manifest. Missing
tables now throw.

---

## §3 The 22 SEEDED failures, adjudicated

Every one is resolved. Root causes, against Wave 6B's recorded per-suite counts:

| Suite | 6B fail | Root cause | Class | Correction |
|---|---|---|---|---|
| `outcome-bridge` | 11 | Feature flags never armed. They are **two-layer** (env master switch **and** a per-org `org_features` row) and they **compose**: `outcomeLearning = experience && outcome_learning`, and `experience = pursuits && facts && routing && pursuit_experience`. So the bridge needs **five** switches on **both** layers — ten conditions. Setting `OUTCOME_LEARNING_ENABLED` alone left it correctly skipping, which reads like a broken bridge rather than one never switched on. | stale verifier expectation | Per-suite `env` in `verify-classes.ts` + full-chain `org_features` upsert. Declared per suite, never globally — `routes-verify` asserts `routingEnabled()` is *false* by default. |
| `lifecycle-acceptance` | 4 + FATAL | Same. | stale verifier expectation | Same. |
| `lifecycle-query` | 2 | Hero accounts **duplicated on a clean build**. `companies.legal_name` carries no unique constraint and three layers created overlapping accounts with bare inserts, so six of ten heroes existed twice. The suite read whichever `Globex` row it matched. | incomplete seed recipe | Reuse-not-fork on `companies`. |
| `value-case` | 2 | Same duplication. | incomplete seed recipe | Same. |
| `stakeholder-intel` | 3 | Duplication, plus the flagship deal not attached to its pursuit. | incomplete seed recipe | Reuse + adoption (below). |
| `motion-intel` | 2 (accreted world only; already 20/0 once rebuilt) | 106 stray `Tenant A` / `E3D Vendor` fixture orgs written into the demo world by suites pointed at it. | unintended data accretion | Disposable databases for FRESH **and** EITHER (§4). |

**No application defect was found among the 22.** Wave 6B's own instruction was not to assume
the test is correct; here the tests were right about the behaviour and wrong about the world
they were run against, and in two cases the world was wrong in a way that had never been checked.

---

## §4 What was intentional, and what had merely accumulated

### The layers were fighting over the same accounts

`demo-enrich` (breadth) and `demo-stories` (the hero narratives) both describe Umbrella,
Stark, Wayne, Acme and Initech, and they **disagreed**. On Stark, enrich said timing `61` and
authored a $1.45M deal called *Hybrid cloud landing zone*; the narrative layer says timing
`null` — **UNKNOWN**, which is the entire point of the Stark story — and authors the same
$1.45M as *Sovereign landing zone*. A clean build therefore gave Stark **two** $1.45M deals
and $2.9M open where the itinerary says one deal at $1.45M.

Deduplication by name cannot catch that. Only ownership can, so ownership is now explicit:
**the narrative layer owns the hero accounts.** The breadth layer no longer authors deals the
narrative layer authors, and where it has already written an artefact, the narrative layer
**adopts** it rather than appending beside it.

Adoption matters more than it sounds. An intermediate version of this fix deduplicated by
name and merely *reused* the breadth layer's row — which was worse than the duplication it
replaced, because that row has no `pursuit_id` and no backdated `updated_at`. It silently
unlinked the flagship deals from their pursuits and made Umbrella silent for zero days
instead of 34. `stakeholder-intel` caught it as a fatal. The layer now writes the narrative's
authority onto whichever row exists.

Removed from the canonical world as unauthored, on a **clean** build:

| Accretion | Count | Surfaced where |
|---|---|---|
| Duplicate hero accounts | 6 of 10 | everywhere |
| Duplicate opportunities (same name, same account) | 5 | Pipeline, goal roll-up |
| Same deal under two names (Stark, Acme) | 2 | Pipeline, account value |
| Duplicate evidence claims | 13 | **Evidence and Trust rooms count rows** — the demo showed twice the corroboration it had |
| Duplicate propensity scores | 7 | invisible (readers take `order by computed_at desc limit 1`), which is why it survived |

### The verifiers were writing into the world they were meant to read

EITHER suites ran against the demo database. They need nothing from it — that is the
definition of the class — but they still **commit** run-scoped fixtures, so every battery run
left another `Hero Vendor u6wvlx` org and another `Globex cgvous` company behind. Nineteen
suites doing that is why the world had to be rebuilt to be trusted, and why a rebuilt world
stopped matching assertions written against the accreted one.

EITHER now gets a disposable database per suite (`--either-on-seeded` still proves the other
half of the "either" claim on demand). **Demonstrated, not asserted:** the manifest digest is
byte-identical before and after a full FRESH + EITHER run.

Two classification errors surfaced while proving it, and both are corrected in
`verify-classes.ts`:

- **`closed-loop` was SEEDED and is EITHER.** It references zero canonical data — every
  fixture is run-suffixed — and passes 18/18 on a bare migrated database.
- **Five suites were EITHER and are SEEDED**: `append-only`, `canonical-microloop`,
  `route-persistence`, `scope`, `team-motion`. Each opens with an unqualified
  `select … limit 1` over a table it never wrote and asserts against whatever comes back.

That `limit 1` pattern is *also* why accreted fixtures could change their verdicts without
anyone touching them. **Tightening those reads is real work and is deliberately not done
here** — this wave classifies; it does not rewrite suites to be green. It is recorded as a
known weakness.

---

## §5 The hero cast

All ten exist **exactly once** after a clean build, asserted by the reset contract. Their
distinguishing facts are preserved as authored — no story was altered to satisfy an assertion:

| Account | The distinction | Verified |
|---|---|---|
| Umbrella Health Systems | late-stage on paper, **silent 34 days** | `updated_at` backdated 34d, deal linked to pursuit |
| Globex Manufacturing Inc. | flagship; CDW recommended, **WWT human override**; $1.84M TD-confidential | route + override + RESTRICTED disclosure intact |
| Stark Industries LLC | **timing UNKNOWN** — `current_timing_score is null` — at $1.45M | one deal, `timing = null` |
| Cyberdyne Systems | multi-partner overlap | intact |
| Hooli Cloud | dormant / overdue | 26 days since activity |
| Acme Robotics | incumbent displacement | one deal, $540K |
| Initech Financial | **a win** | `DR site build-out` closed_won |
| Wayne, Soylent, Tyrell | breadth; Tyrell carries the loss | Tyrell `closed_lost`, 0 open |

---

## §6 The four headline figures, recomputed from the canonical seed

| Figure | Canonical | Definition |
|---|---|---|
| Goal target | **$5,000,000** | typed target on the active goal — an intention, not a measurement |
| Motion-level | **$1,250,000** | `estimated_value_usd` on the 5 goal-linked motions; what goal progress computes from |
| Opportunity-level | **$4,920,000** | open amount beneath those motions — the deals the goal is carried by |
| Whole book, open | **$8,040,000** | every open opportunity — what Pipeline shows |

Two reconcile exactly with the historical figures in `audit/UI-REDESIGN-WAVE-3.md:89-91`;
two do not, and the differences are accounted for rather than explained away:

- **$3.67M → $4.92M.** The Wave 3 figure was four deals: $1.12M + $920K + $920K + $710K =
  **$3,670,000 exactly**. The canonical world adds two authored deals — *Core banking
  resilience* ($990K) and *Backup modernization* ($260K) — and $3,670,000 + $990,000 +
  $260,000 = **$4,920,000 exactly**. Intentional seed growth, fully reconciled.
- **$6.25M → $8.04M.** The book grew with the seed. The Wave-3-era world no longer exists,
  so this delta is **not** reconcilable line by line, and I am not going to reverse-engineer
  an arithmetic story for it. The current book is itemised in the manifest; that is the record.

The $1.25M / $4.92M gap on the Goals screen remains **two different measures, not a defect** —
still the position taken in Wave 2 and Wave 3, and now with both definitions written beside
both numbers.

---

## §7 Determinism

Two independent clean rebuilds, each followed by the **complete** battery:

```
build 1 → digest be0da833990ce436 → FRESH 238/0 · EITHER 215/0 · SEEDED 658/0
build 2 → digest be0da833990ce436 → FRESH 238/0 · EITHER 215/0 · SEEDED 658/0

manifest diff  IDENTICAL
FRESH matrix   IDENTICAL
EITHER matrix  IDENTICAL
SEEDED matrix  IDENTICAL
```

---

## §8 Ask no longer offers doors it knows are locked

`logAnswer` stores the deep links an answer stood on, under a comment recording the
assumption they rest on: *"record_hrefs are deep links, which disclose nothing on their own
and re-resolve under the reader's authorisation."*

Half true, and the other half is the defect. Nothing **is** disclosed — RLS refuses the record
and the route 404s, confirmed on a real cross-tenant href. But the product still put an
actionable navigation target in front of an operator who cannot resolve it, and delegated the
refusal to a browser round-trip. A governed product does not do that.

`src/lib/interpret/readable-records.ts` keeps only the hrefs whose target row is readable **on
the caller's own RLS-scoped connection** — the same authorization the resolve would use, so
the answer is authoritative rather than a second, weaker guess at the policy. Room links
(`/pipeline?stage=closed_won`) are not record references and pass through. Failures fail closed.

It **does not label, count, or acknowledge** what it drops. "1 record withheld" would disclose
the existence of a record whose existence is itself outside the reader's view — the thing §8
forbids. Unreadable links are simply absent.

Seven assertions added to `isolation-verify` (12 → 19): readable link emitted; unreadable
absent; room link passes; nothing emitted *about* the withheld record; the owning tenant still
gets its own.

---

## §9 Cross-room reconciliation

One account → one pursuit → one deal, across Accounts, Pipeline, Pursuits, Today and Goals.
Every hero resolves to exactly one pursuit and one open deal, with three intentional and
explained exceptions: Globex carries a second pursuit (AI platform, seeded by `demo-db`);
Umbrella and Wayne each carry one additional breadth deal; Tyrell has zero open because its
deal is the loss.

---

## §10 The demo reset contract

`scripts/seed-demo-world.ts` builds and then **verifies** what it built — a reset that does not
check its output is a reset you cannot trust twice:

```
ok  every hero account exists exactly once     (10 checks)
ok  no verifier-fixture pollution
ok  no duplicated opportunities
ok  no duplicated same-amount open deals on one account
ok  no duplicated revenue motions
ok  no duplicated pursuits
ok  no duplicated evidence claims
ok  no duplicated propensity scores
```

Proven only on disposable local infrastructure. **Not run against any remote environment.**

---

## §11 Complete local certification

| Class | Suites | Passed | Failed | Fatal |
|---|---|---|---|---|
| FRESH | 5 | 238 | 0 | 0 |
| EITHER | 14 | 215 | 0 | 0 |
| SEEDED | 13 | 658 | 0 | 0 |
| **TOTAL** | **32** | **1,111** | **0** | **0** |
| `migrations-only` | 1 | — | — | DEPLOYMENT_ENVIRONMENT ONLY, by design |

`npm test` 149/149 · `tsc --noEmit` clean · `next build` compiles · visual system clean across
363 files.

**Authenticated link crawl.** 120 routes reached from `/` by following in-app links, with the
login gate bypassed at build time: **119 × 200, 0 × 4xx, 0 × 5xx.** The single non-200 is
`/accounts/export`, which the crawler reports as "Download is starting" because it is a CSV
endpoint rather than a page; fetched directly it returns `200 text/csv`. No dead links, no
broken redirects.

---

## §12 What this wave does *not* establish

Local certification is not live certification, and the distinction Wave 6B drew still stands.
Untouched here, and still required before any demo deployment:

- **Deployment environment variables**, `RESEND_API_KEY` foremost. Wave 6B's §10 position is
  unchanged: sending must be proven impossible, not assumed, and it cannot be proven from here.
- **`migrations-only`**, which by design needs a separately provisioned instance.
- **The live demo environment's own data**, which is not this world.

Nothing was deployed. Nothing was pushed.

---

## §13 Changed files

| File | Change |
|---|---|
| `scripts/demo-manifest.ts` | **new** — the declared canonical world |
| `audit/canonical-demo-world.json` | **new** — committed manifest, digest `be0da833990ce436` |
| `src/lib/interpret/readable-records.ts` | **new** — §8 readability filtering |
| `src/app/ask/page.tsx` | filter stored hrefs through the caller's own connection |
| `scripts/demo-enrich.ts` | reuse accounts; stop authoring narrative-owned deals |
| `scripts/demo-stories.ts` | reuse accounts; **adopt** deal, evidence and score rather than append |
| `scripts/seed-demo-world.ts` | hero cast + five duplication classes verified after build |
| `scripts/verify-classes.ts` | per-suite env; `closed-loop` → EITHER; five suites → SEEDED |
| `scripts/verify-run.ts` | EITHER on disposable databases; `--either-on-seeded` |
| `scripts/isolation-verify.ts` | +7 §8 assertions (12 → 19) |
| `scripts/outcome-bridge-verify.ts`, `scripts/lifecycle-acceptance-verify.ts` | full `org_features` chain |

---

**LOCAL GO — canonical release candidate is reproducible; live demo certification remains**
