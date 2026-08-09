# Data Quality & Bounded Self-Learning

The system must consume far more data than any human can review, learn from it,
and not drift. The scaling principle:

> **Humans set policy and audit samples. Machines gate volume.
> Nothing structural changes itself silently.**

Three control planes implement this.

---

## Plane 1 — Evidence quality gates (automated, applied to every item)

No evidence row is scoreable until it passes the verification pipeline. This is
enforced in the database: a trigger rejects any signal whose evidence is not
`verified` — the "no scored signal without verified evidence" rule is a hard
invariant, not a convention.

```text
raw extraction
     │
     ▼
[1] Deterministic checks           claim well-formed? date plausible? entity
     │                             resolved? claim supported by the excerpt?
     ▼
[2] Model cross-check (cheap tier) a SECOND model, with a different prompt,
     │                             answers one question: "is this claim
     │                             actually supported by this excerpt?"
     ▼                             Extractor and checker must agree.
[3] Corroboration & contradiction  same claim from independent sources raises
     │                             confidence; contradicting claims lower it
     │                             and flag both for review.
     ▼
[4] Computed confidence            extraction_confidence × source_trust ×
     │                             corroboration factor × cross-check factor.
     ▼                             Confidence is COMPUTED, never asserted by
                                   one model call. An affirming cross-check
                                   boosts modestly (max +15%) — enough that a
                                   perfect extraction from a brand-new source
                                   can clear the bar, so new sources have no
                                   cold-start deadlock.
status: verified | quarantined | rejected
```

- **Hard failures** (unresolvable entity, claim not present in excerpt,
  impossible dates) → `rejected`.
- **Soft failures** (checker disagreement, low computed confidence,
  contradiction) → `quarantined`: kept, visible, never scored, eligible for
  review.
- Quarantined volume per source is itself a health metric (Plane 3).

## Plane 2 — Trust-weighted human sampling (how founder review scales)

You never review the stream; you review a **sample whose size the system sets
per source, based on earned trust**.

- Every `signal_source` carries a `trust_score` (0–1, starts at 0.5; first-party
  customer data starts higher).
- Audit sample rate per source: `rate = clamp(0.02 + 0.6·(1 − trust)², 0.02, 0.5)`
  — a new or shaky source gets ~20–50% of items sampled into your review queue;
  a proven source decays to a 2% floor. **Your per-item effort shrinks as
  volume grows.**
- Three things enter the review queue: random samples (at the source's rate),
  **high-impact items** (evidence that would swing a score band or launch a
  motion), and **disagreements** (checker vs. extractor, or contradictions).
- Your verdicts (`accurate` / `inaccurate`) feed a **bounded trust update**
  (small-step EWMA with a per-update cap), which automatically:
  - re-weights every future confidence computation for that source, and
  - adjusts that source's sample rate.

So the calibration loop runs on minutes of your time per week, and the system
gets more autonomous exactly where it has proven it deserves to be.

## Plane 3 — Bounded self-learning (improve without drifting)

Two classes of things learn, with different rules.

### Class A — numeric parameters (self-tuning, bounded)

Source trust scores, corroboration weights, per-play performance stats,
audit sample rates. These update automatically but only through **capped,
small-step updates** (no single observation can move a parameter far), with
floors/ceilings, and full history retained.

### Class B — structural artifacts (system proposes, evals gate, humans approve the big ones)

Prompts, ontology nodes/edges, play templates, scoring weights. The system is
expected to *draft* improvements — from human-edit patterns, outcome data, and
quarantine patterns — but a proposal can only move through this pipeline:

```text
PROPOSED      system (or human) drafts the change with rationale + diff
   │
   ▼
EVALUATED     run against the golden set + historical outcomes.
   │          Fails eval → auto-rejected. No human time spent.
   ▼
IN_SHADOW     new version runs alongside current; divergence measured on
   │          live traffic; no customer-facing effect.
   ▼
PROMOTED      • low-impact + within guardrails → auto-promote (logged)
              • high-impact (scoring weights, play logic, ontology
                structure, any prompt used by Motion Designer) → requires
                explicit human approval, presented WITH eval + shadow results
```

Every artifact is versioned; every promotion is reversible; the previous
version stays deployable.

### Golden sets (the regression tests of judgment)

Fixed, human-curated example sets per workflow (extraction cases, taxonomy
mappings, scored accounts with expected bands). Sources: your seed examples +
every human correction from the review queue (each verdict you give becomes a
candidate golden example — **your review time compounds into the eval
harness**). No prompt or weight version ships without passing them.

### Drift monitors (detect what the gates miss)

Continuously tracked, alert on threshold breach:

- score distribution shift between score versions (population stability);
- per-source quarantine and rejection rates (a good source going bad);
- extractor/checker disagreement rate (prompt or model drift);
- corroboration rate trend (signal quality decay);
- human-overturn rate in the review queue (the ultimate ground truth —
  if your sampled verdicts start disagreeing with the machine, sample rates
  automatically rise until trust is re-earned).

---

## Invariants (enforced, not aspirational)

1. No signal is created from unverified evidence (database trigger).
2. Confidence is always computed from (extraction, source trust,
   corroboration) — a single model call can never set final confidence.
3. Numeric self-tuning is capped per update and bounded in range.
4. Structural changes only via PROPOSED → EVALUATED → SHADOW → PROMOTED;
   failing eval auto-rejects with zero human cost.
5. High-impact promotions require human approval with evidence attached.
6. Everything is versioned; every promotion is reversible.
7. Human review verdicts are never discarded: they update trust AND become
   golden-set candidates.
