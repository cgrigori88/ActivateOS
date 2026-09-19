# D-SEED-REPRO — characterizing seed nondeterminism

**Status:** **DISCOVERY COMPLETE — returned for ruling.** No production seed behaviour was modified.
`certify-world` was not changed. No expected digest was updated. No baseline was blessed.

> The question is not *"which hash differs"*. It is: **does a clean seed reproduce the same logical
> product world, differing only in generated representation — or does it produce materially different
> business/security semantics?**

---

## Method

Two clean worlds were seeded **on one cluster**, from the **same pre-0114 revision** (`3de4813`),
through the **documented path**, so they could be compared with SQL rather than by sequential
snapshots:

```sh
DEMO_DB_NAME=pursuit_demo    …  npx tsx scripts/seed-demo-world.ts
DEMO_DB_NAME=pursuit_demo_b  …  npx tsx scripts/seed-demo-world.ts
```

Each table was compared twice: **RAW** (every column, as the world fingerprint sees it) and
**LOGICAL** (the same rows with surrogate ids and row timestamps projected away, hashed order-
independently). A column was **not** dismissed for being a UUID or a timestamp — the projection only
isolates *what else* moved, and every excluded column is reported.

## Results

| Dimension | Result |
|---|---|
| schema shape | **IDENTICAL** — 1802 columns, same types, nullability and defaults |
| row cardinalities | **IDENTICAL** — 0 of 159 tables differ, 64 non-empty |
| tables differing RAW | 64 |
| …identical once generated columns are projected away | **46** |
| …still differing logically | 18 |
| policies · RLS · grants · functions · triggers | **IDENTICAL** — 385 · 159 · 1727 · 185 · 12 |
| organizations · org_features · companies · pursuits · opportunities · governed_skills · pursuit_team_members | **IDENTICAL** on every business column |

### The 18 logical differences, traced

Every differing column falls into one of two groups, and **none changes what the product means**:

**A · Representation nondeterminism — generated identifiers.** `subject_ref`, `fact_id_a`,
`fact_id_b`, and UUIDs embedded inside JSON/text payloads (`record_hrefs`, `next_action.href`,
`before_state`, `after_state`), plus hashes *derived from* those identifiers (`fact_identity_key`,
`fact_value_key`). The referenced entities are the same; only their surrogate keys differ.

**B · Observational nondeterminism — clock-derived.** `as_of` and `date_value` (computed relative to
the seed instant) and `resolve_ms` / `total_ms` (measured durations of the seed's own work).

**C · Semantic nondeterminism — NONE FOUND.**

### Two things worth reporting honestly

**`environment_identity.label` differs** — `"local demo database pursuit_demo"` vs
`"…pursuit_demo_b"`. That is **my comparison artifact**: the second database was necessarily given a
different name. It is not seed nondeterminism.

**`ask_exchanges` looked semantic and is not.** The first drill showed different `record_hrefs` and a
different `next_action` label, which would have been a genuine divergence — a different recommended
action. It was an artifact of sampling with `select distinct … order by 1 limit 4`: when embedded
UUIDs change, the *sorted distinct list* changes even though the rows do not. Compared directly, all
twelve recorded questions return **byte-identical** `next_action` labels and **identical** record
counts (5, 3, 5, 5, 12, 1). I verified this rather than reporting a false positive.

## Classification against the acceptance rule

- schema identical ✓
- logical seeded entities equivalent ✓
- business, security and governance semantics equivalent ✓
- differences confined to non-semantic seed-instance representation ✓

**So the acceptance rule is met**, and a freshly reconstructed instance may serve as an
**instance-local certification baseline**:

```
seed → capture baseline for THAT instance → run certification → require start/end stability
```

**What `certify-world` still proves, stated precisely:** unexpected mutation or drift *during a
certification run*. Both reconstructions reported **start digest == end digest**, so that property is
intact and was never in question. **What it must not be represented as proving is `fresh seed A ==
fresh seed B`** — that is false today, and remains false until the seed is made deterministic.

**Recorded:** `c9004670ffda112f` is a **historical accepted-instance baseline, not a reproducible
repository-level canonical digest.** It has not been replaced.

## What was deliberately NOT done

No hash removed from certification · no field normalized · no generated column excluded · no
`stableDigest` rewritten · no expected value updated · no production seed behaviour changed. The
evidence comes first; what the repository-level certification contract *should* be is a separate
ruling.

---

## Ruling 2 — the ordering-determinism fixture repair (DONE, isolated)

**The defect.** The C2 fixture's semantic prerequisite is *"strictly newer than every pre-existing
relevant event"*, encoded as the literal `'2026-09-16T00:00:00Z'`. True when written; false the moment
the world was reseeded on a later date — a fresh world carries outcome events to **2026-09-18**, so
four real rows outranked the fixture and the assertion failed **for a reason unrelated to ordering**.

**The repair.** The anchor is now `MAX(existing occurred_at) + a fixed interval`, in UTC. Not `now()`,
not the wall clock, not today's date, and not another "far enough" literal — each either reintroduces
the staleness or destroys the tie the case exists to create. The offset is deterministic, so all eight
rows still share **one** `occurred_at` and the tie is preserved.

**The prerequisite is asserted, not assumed.** A new check fails *at the fixture* if the planted events
are ever not strictly newer than every pre-existing one — naming the real cause instead of surfacing
later as a mystifying ordering failure. That is the staleness this repair removes permanently.

**Two discriminatory controls** prove the relative anchor does real work: a fixture planted *older*
than the dataset maximum would not hold the newest positions, while the relative one does.

**Evidence:** `ordering-determinism` **43 (1 failing) → 46/46**; `certify-world` **52 clean, 0 with
failures**, digest stable start-to-end (`d43fe13b1f194132`).

**Commit isolation, proven:** `git diff 7e735ce -- src supabase package.json` is **empty**. The Slice 12
runtime and migration 0114 are untouched; the repair is its own commit (`612300e`), and production
ordering semantics were not modified.
