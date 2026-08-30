# Workstream B — Facts / Intelligence · Phase 2 Technical Design

**Foreman-Architect loop, Phase 2 (Technical Design). No code is written until this
document is signed off.** Grounded in a full map of the existing intelligence layer
(evidence → signals → scores → contradictions → motion narrative), not on narration.

**Objective (from the directive):** PursuitOS must be able to distinguish
**what was observed → what evidence supports it → what the system believes → how that
affects a Pursuit.** Today the platform has the first two and the fourth, but the
**third — a durable, structured "belief" layer — does not exist.** This workstream
builds it.

## 0. Two binding constraints (carried verbatim into the design)

1. **A Fact is a normalized proposition, not an LLM summary we liked.** Every Fact has
   an explicit **subject / predicate / object**, plus support, contradiction, validity,
   source class, and confidence. The LLM may *extract candidates*; the durable
   commercial context stays **structured and auditable**. This is enforced structurally:
   a candidate that cannot be mapped to the controlled predicate vocabulary **never
   becomes a Fact** — it stays as evidence only.
2. **Why Now is an output of the Fact/Signal graph, not a freeform reasoning blob.** It
   is reconstructable from structured pieces: business trigger, technology condition,
   timing anchor, partner-route relevance, signal convergence, contradictory evidence,
   recommended immediate action. Every element of `why_now` references a real
   fact/signal/evidence id.

Both are consistent with the codebase's existing invariant (`src/lib/quality/*`): **a
single model call never sets durable state; deterministic gates do.**

## 1. Where Facts sit (the substrate, mapped)

| Layer | Table | Meaning | Status |
|---|---|---|---|
| What a source claims | `evidence` (0001/0002/0013) | source_type, claim, confidence, stance supports/refutes, `claim_fingerprint`, verified via `verifyEvidence` | exists |
| A typed observation | `signals` (0001/0004) | signal_type, direction ±1, magnitude, half_life, `value` jsonb, `evidence_id` | exists |
| **What the system believes** | **`facts` (NEW)** | **normalized proposition + belief lifecycle** | **net-new — the gap** |
| How it affects a Pursuit | `pursuit_facts`/`pursuit_signals`/`pursuit_evidence` (0066) + `pursuit_score_contributions` (`referenceKind='fact'`) + `pursuits.why_now` (0063, reserved) | M:N links + scored contributions + structured Why Now | anchors already in place |

Anchors deliberately pre-placed in Workstream A: `pursuits.why_now jsonb` ("Workstream B
authors"), `pursuit_facts.ref_id` awaiting `facts.id`, and the scoring `Contribution`
model already carrying `referenceKind='fact'` + `feature_observed_at` (leakage guard).

## 2. Facts schema — `0069_facts_core.sql`

```sql
create table facts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  company_id         uuid not null references companies(id) on delete cascade,   -- the account the fact is about

  -- Normalized proposition (the anti-blob spine) — subject · predicate · object
  subject_type       text not null,     -- 'company'|'product'|'person'|'contract'|'technology'|'market'|'org_unit'
  subject_ref        uuid,              -- typed entity ref when applicable (company_id/product_id/person_id)
  subject_label      text not null,     -- snapshot label for audit/display
  predicate          text not null references fact_predicates(key),  -- controlled vocabulary (see §3)
  object_type        text not null,     -- 'taxonomy_node'|'product'|'date'|'text'|'quantity'|'money'|'boolean'|'person'
  object_ref         uuid,              -- typed entity ref when object is an entity
  object_value       jsonb not null default '{}',  -- normalized literal: {date}|{amount,currency}|{count}|{text}|{node_slug}
  polarity           smallint not null default 1 check (polarity in (-1,1)),  -- proposition asserted true(+1)/false(-1)

  -- Belief state
  status             text not null default 'CANDIDATE',   -- lifecycle enum (§4)
  confidence         numeric not null default 0 check (confidence between 0 and 1),  -- deterministic (§8)

  -- Provenance (§5)
  provenance_class   text not null default 'THIRD_PARTY_UNVERIFIED',
  origin_kind        text not null,     -- 'EVIDENCE_PROMOTION'|'SIGNAL_PROMOTION'|'CONVERGENCE'|'HUMAN'|'IMPORT'|'AGENT_PROPOSED'

  -- Validity / freshness / supersession (§6)
  as_of              timestamptz not null,          -- belief anchor (leakage/as-of key)
  valid_from         timestamptz,
  valid_until        timestamptz,                   -- expiry (contract end, event date…)
  half_life_days     integer,                       -- freshness decay (inherited from signal family)
  observed_first_at  timestamptz not null,
  observed_last_at   timestamptz not null,          -- freshness
  superseded_by      uuid references facts(id) on delete set null,
  supersedes         uuid references facts(id) on delete set null,

  -- Identity / dedup (§14)
  fact_key           text not null,     -- sha40 over org|company|subject|predicate|object-canonical

  -- Convergence family (§9)
  family             text,              -- canonical signal family or predicate→family map

  -- Lineage (reuse Workstream A contract)
  data_environment   text not null default 'PRODUCTION',
  is_simulated       boolean not null default false,

  -- Audit
  created_by_actor_type text, created_by_actor_id uuid, created_via text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_material_change_at timestamptz not null default now()
);

-- One LIVE fact per proposition (dedup); terminal/superseded rows never block a future fact.
create unique index facts_active_key on facts (org_id, fact_key)
  where status in ('CANDIDATE','REVIEW_REQUIRED','ASSERTED','CONTRADICTED') and superseded_by is null;
```

`fact_predicates` (controlled vocabulary table — data, not logic):

```sql
create table fact_predicates (
  key           text primary key,       -- 'uses_technology','contract_expires','migrating_from','has_initiative',
                                         -- 'is_hiring_for','leadership_change','funding_event','compliance_deadline',...
  label         text not null,
  subject_type  text not null,
  object_type   text not null,
  family        text not null,          -- canonical family (maps to SignalFamily)
  is_material   boolean not null default false,  -- material predicates raise review + ledger materiality
  signal_type   text                    -- optional 1:1 map from an existing SIGNAL_DEFS type (deterministic promotion)
);
```

The vocabulary is **seeded from `src/lib/signals/types.ts` SIGNAL_DEFS** (each canonical
signal type gets a predicate) plus a handful of first-party/CRM predicates. It is the
guardrail that makes "Fact ≠ blob" structurally true.

## 3. Provenance taxonomy (§5)

Two orthogonal axes, both deterministic:

- **`provenance_class`** — trust tier of the belief's strongest *non-refuted* basis:
  `FIRST_PARTY` (customer/CRM declared) › `SECOND_PARTY` (partner declared) ›
  `THIRD_PARTY_VERIFIED` (corroborated public) › `THIRD_PARTY_UNVERIFIED` (single public) ›
  `INFERRED` (convergence, no direct claim) · `HUMAN_ASSERTED`. Rolled up as the max
  trust across supporting evidence/signals (reuses `src/lib/quality/trust.ts` source
  trust), never LLM-chosen.
- **`origin_kind`** — how the fact entered the graph (see column enum). Per-source
  provenance stays on each association row (`fact_evidence`/`fact_signals`), so the full
  chain is auditable down to the individual evidence claim.

## 4. Fact states & transition rules (§ lifecycle)

States: `CANDIDATE` (proposed, below belief threshold) · `REVIEW_REQUIRED` (needs human
adjudication) · `ASSERTED` (believed — the live belief) · `CONTRADICTED` (support
outweighed by contradiction; belief suspended, not deleted) · `SUPERSEDED` (replaced by a
newer fact; terminal) · `EXPIRED` (past `valid_until`; historically true; terminal) ·
`RETRACTED` (withdrawn as wrong; terminal).

```
CANDIDATE        → ASSERTED | REVIEW_REQUIRED | CONTRADICTED | RETRACTED
REVIEW_REQUIRED  → ASSERTED | CONTRADICTED | RETRACTED
ASSERTED         → CONTRADICTED | SUPERSEDED | EXPIRED | REVIEW_REQUIRED | RETRACTED
CONTRADICTED     → ASSERTED | SUPERSEDED | RETRACTED
SUPERSEDED | EXPIRED | RETRACTED → (terminal)
```

Enforced service-side by `transitionFact()` (SELECT FOR UPDATE → validate against
`ALLOWED_FACT_TRANSITIONS` → write → `recordChange`), the exact pattern proven in
`src/lib/pursuits/lifecycle.ts`. No DB trigger pre-demo (consistent with A §22).
"Believed" = `ASSERTED`. "Active" (participates in dedup) = status ∈
{CANDIDATE, REVIEW_REQUIRED, ASSERTED, CONTRADICTED} and `superseded_by is null`.

## 5. Evidence-to-Fact promotion policy (§ promotion) — deterministic

1. **Candidate proposition** (structured): produced either
   (a) **deterministically** — a signal whose `signal_type` maps to a `fact_predicates.signal_type`
   (e.g. `TECH_INSTALLED → uses_technology`, `CONTRACT_EXPIRING → contract_expires`), no LLM; or
   (b) **agent-extracted** — `fact-extractor.ts` (cheap tier) maps a *verified* evidence
   claim to `{subject, predicate ∈ vocabulary, object}`. **If it cannot map to the
   vocabulary, no candidate is created.**
2. **Promotion gate (deterministic):** candidate → `ASSERTED` iff supported by ≥1
   `verified` evidence (or a signal from verified evidence) **and** net support
   (Σ support weight − Σ contradiction weight) ≥ `PROMOTE_THRESHOLD` **and** not blocked
   by a higher-trust open fact-contradiction. Otherwise it stays `CANDIDATE`.
3. **Review routing:** if predicate `is_material` **and** (confidence < `REVIEW_FLOOR`
   **or** only a single `THIRD_PARTY_UNVERIFIED` source) → `REVIEW_REQUIRED` (into the
   existing `review_queue` with `fact_id` + reason), never silently asserted.
4. **Confidence** is computed deterministically (§8); a single model proposal never sets it.

## 6. Support / contradiction associations — `0070_fact_associations.sql`

```sql
create table fact_evidence (
  fact_id     uuid not null references facts(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  stance      text not null check (stance in ('SUPPORTS','CONTRADICTS')),
  weight      numeric,                     -- contribution to fact confidence
  observed_at timestamptz not null,        -- snapshot of evidence.observed_at (as-of)
  linked_by   text, linked_at timestamptz not null default now(),
  primary key (fact_id, evidence_id)
);
create table fact_signals (
  fact_id   uuid not null references facts(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  stance    text not null check (stance in ('SUPPORTS','CONTRADICTS')),
  weight    numeric, observed_at timestamptz not null,
  linked_by text, linked_at timestamptz not null default now(),
  primary key (fact_id, signal_id)
);
-- Fact-level contradiction: two facts asserting incompatible propositions.
create table fact_contradictions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  fact_id_a   uuid not null references facts(id) on delete cascade,
  fact_id_b   uuid not null references facts(id) on delete cascade,
  basis       text not null,               -- 'incompatible_object'|'polarity_conflict'|'opposing_signals'
  status      text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at timestamptz not null default now()
);
```

Two contradiction mechanisms preserved from today, both **recorded, never netted away**:
*within-fact* (`fact_evidence.stance='CONTRADICTS'` → confidence penalty) and *between-fact*
(`fact_contradictions` → `CONTRADICTION_DETECTED` ledger + status `CONTRADICTED`). The
existing signal-level `contradictions` table (opposing-direction signals) feeds
`fact_contradictions` during backfill.

## 7. Pursuit ↔ Fact/Signal/Evidence associations (§ association)

Reuse the 0066 M:N link tables (`linkContext` already exists). B adds **relevance
derivation**: when a fact is asserted/updated on a company, live pursuits for that company
are linked via `pursuit_facts` with `relevance_type` = `PRIMARY_TRIGGER` (predicate is the
pursuit's originating trigger), `SUPPORTING_CONTEXT`, or `CONTRADICTING`. `0071` adds real
FKs `pursuit_facts.ref_id→facts`, `pursuit_signals.ref_id→signals`,
`pursuit_evidence.ref_id→evidence` (tables are currently empty, so integrity is free).

## 8. Confidence contract (§8, deterministic)

`computeFactConfidence()` mirrors `src/lib/quality/confidence.ts` multiplicatively:
`base_extraction × source_trust × (1 + k_corrob·min(independent_source_types,3)) ×
(1 + k_family·min(independent_families,3)) × 0.5^contradiction_count × freshness_factor`,
clamped [0,1]. Corroboration requires independent `source_type` **and** distinct family
(reuses `dimensions.ts` corroboration logic). Freshness = `decay(observed_last_at, half_life_days)`
(reuses `scoring/compute.ts`). **No single LLM call can set it** — invariant preserved.

## 9. Validity / freshness / supersession + as-of semantics (§6/§ as-of)

- **Validity:** `valid_from`/`valid_until`. Dated predicates set `valid_until`; timing uses
  `eventProximity` (ramp toward the date) from `compute.ts`.
- **Freshness:** `observed_last_at` + `half_life_days` → `decay` factor; affects
  `evidence_confidence`, **not truth**.
- **Supersession:** a newer incompatible fact on the same (subject, predicate) with ≥ trust
  → old `ASSERTED` fact becomes `SUPERSEDED` (`superseded_by`/`supersedes` set),
  `FACT_SUPERSEDED` ledger; nothing deleted.
- **Expiry:** a sweep transitions `ASSERTED` facts past `valid_until` → `EXPIRED`
  (`FACT_EXPIRED` ledger). A renewal is a **new** fact, not a reactivation.
- **As-of:** `factsAsOf(db, companyId, t)` returns facts believed at `t`
  (`as_of ≤ t`, not superseded before `t`, valid at `t`). This backs "what did we believe
  then" and the scorer's leakage guard.

## 10. Signal-family convergence (§ convergence)

Facts carry `family`. `factConvergence(companyId, windowDays)` = count of distinct positive
families with ≥1 `ASSERTED` fact in the recency window (reuses `convergenceIndex`
semantics; requires ≥2 families to register). Feeds `pursuit_priority`/`convergence`
dimensions and the Why-Now "signal convergence" block.

## 11. Structured Why Now (§ Why Now) — `pursuits.why_now` jsonb

`assembleWhyNow(db, pursuitId, asOf)` deterministically builds, from the linked facts/signals:

```jsonc
{
  "version": 1, "generated_at": "...", "as_of": "...",
  "business_trigger":        { "fact_id": "...", "predicate": "...", "label": "...", "confidence": 0.0 } | null,
  "technology_condition":    { "fact_id": "...", "predicate": "uses_technology", "node_slug": "...", "confidence": 0.0 } | null,
  "timing_anchor":           { "fact_id": "...", "signal_id": "...", "kind": "contract_expiry|event_date|fiscal", "date": "...", "proximity": 0.0 } | null,
  "partner_route_relevance": { "partner_id": "...", "reason": "..." } | null,   // SCAFFOLD — enriched in Workstream C
  "signal_convergence":      { "families": ["technology","trigger"], "count": 2, "window_days": 90, "fact_ids": ["..."] },
  "contradictory_evidence":  [ { "fact_id": "...", "basis": "...", "status": "open" } ],
  "recommended_immediate_action": { "kind": "...", "label": "...", "ref": "..." } | null,  // deterministic hint; full NBA is Workstream E
  "contributing_fact_ids": ["..."], "contributing_signal_ids": ["..."]
}
```

Every element is id-referenced → fully reconstructable and auditable. An LLM may render a
one-line human gloss **from** these pieces, but the gloss is derived and non-authoritative;
the structured object is the durable truth. `partner_route_relevance` is scaffolded here and
**completed in Workstream C** (B precedes C per the execution order). A material change to
`why_now` emits `WHY_NOW_CHANGED` (drives "What Changed?"); an unchanged recompute emits
nothing (idempotent).

## 12. Score-impact contract (§ score impact)

`factsToContributions(db, pursuitId, asOf)` produces `Contribution[]` fed to the existing
`writeScoreSnapshot` (Workstream A). Rules:

- Only `ASSERTED` facts (and `CONTRADICTED` as negative) with `as_of ≤ snapshot.as_of`
  contribute. `CANDIDATE`/`REVIEW_REQUIRED` **never** score.
- Each contribution: `referenceKind='fact'`, `evidenceReference=fact.id`,
  `featureName=predicate|family`, **`featureObservedAt=fact.as_of` (≤ snapshot as_of —
  leakage guard holds)**, `rawValue/normalizedValue/weight` per dimension.
- Fact→dimension map: business-trigger → `timing`+`purchase_propensity`; technology →
  `solution_fit`; convergence → `pursuit_priority`+`convergence`; contradicting facts →
  reduce `evidence_confidence` (penalty, never netted); freshness decay →
  `evidence_confidence`.
- Directional & versioned (`score_version` e.g. `v1-facts-directional`) — consistent with
  the binding "no 88% chance to buy" rule. Augments pursuit snapshots; does **not** replace
  the company-propensity engine.

## 13. Change Ledger event contract (§ ledger)

Reuse `change_ledger` + `recordChange` (actor ≠ trigger, 4-level materiality). ChangeTypes:
`FACT_PROMOTED`, `FACT_SUPERSEDED`, `CONTRADICTION_DETECTED` (already in the enum) + **new
additive TS union members** `FACT_CONTRADICTED`, `FACT_EXPIRED`, `FACT_REVIEW_REQUIRED`,
`FACT_RETRACTED`, `WHY_NOW_CHANGED` (column is `text`, no DB migration). Materiality: material
predicates → `HIGH`; expiry → `LOW/MEDIUM`; contradictions/retractions → `HIGH` (surfaced).
`actor_type` ∈ {SYSTEM, AGENT, USER}, `trigger_type` ∈ {EVIDENCE_VERIFIED, FACT_PROMOTED,
MODEL_RECALCULATION, CONTRADICTION, USER_OVERRIDE}. `before`/`after` carry the structured
proposition state.

## 14. Idempotency (§ idempotency)

- **Promotion** is upsert-by-`fact_key` (`ON CONFLICT (facts_active_key) DO NOTHING` → then
  attach support), mirroring `upsertPursuit`. Re-processing the same evidence attaches the
  same `fact_evidence` row (PK) → no double-count. Confidence recomputed from the current
  support set, not incremented.
- **assembleWhyNow / factsToContributions** are pure recomputes from the current graph.
- **Score snapshots** are append-only + one-current (A), written only when inputs change.

## 15. RLS (§ RLS)

All new tables org-scoped, one policy each, `app_rw` grants — the 0058/0066 pattern:
`facts` → `is_org_member(org_id)`; `fact_evidence`/`fact_signals` → parent-scoped via the
fact's org (EXISTS on `facts`); `fact_contradictions` → `is_org_member(org_id)`;
`fact_predicates` → reference table, `using(true)` for `app_rw`, writable by owner only.

## 16. Indexes (§ indexes)

`facts`: partial-unique `facts_active_key`; `(org_id, company_id, status)`;
`(company_id, predicate)`; `(org_id) where status='REVIEW_REQUIRED'`;
`(valid_until) where status='ASSERTED'` (expiry sweep); `(superseded_by)`;
`(org_id, company_id, as_of desc)` (as-of). `fact_evidence`: `(evidence_id)`,
`(fact_id, stance)`. `fact_signals`: `(signal_id)`. `fact_contradictions`:
`(fact_id_a)`, `(fact_id_b)`, `(org_id) where status='open'`.

## 17. Exact migrations & file targets (§ file targets)

**Migrations (additive only):**
- `0069_facts_core.sql` — `facts` + `fact_predicates` (+ seed) + RLS + indexes + partial-unique.
- `0070_fact_associations.sql` — `fact_evidence`, `fact_signals`, `fact_contradictions` + RLS + indexes.
- `0071_fact_pursuit_fks.sql` — FKs `pursuit_facts.ref_id→facts`, `pursuit_signals.ref_id→signals`, `pursuit_evidence.ref_id→evidence`; `review_queue.fact_id` nullable column.

**Services — `src/lib/facts/`:**
`predicates.ts` (vocabulary registry + seed) · `model.ts` (`factKey`, `upsertFact`, `getFact`) ·
`lifecycle.ts` (`ALLOWED_FACT_TRANSITIONS`, `transitionFact`) · `provenance.ts` ·
`confidence.ts` (`computeFactConfidence`) · `associations.ts` (`attachEvidence`/`attachSignal`/`linkContradiction`) ·
`supersession.ts` · `freshness.ts` · `convergence.ts` · `promote.ts`
(`promoteFromEvidence`/`promoteFromSignal` — the deterministic orchestrator) ·
`why-now.ts` (`assembleWhyNow`) · `score-impact.ts` (`factsToContributions`) ·
`asof.ts` (`factsAsOf`) · `flags.ts` (`factsEnabled()` — new `FACTS_ENABLED`, default off).

**Agent:** `src/lib/agents/fact-extractor.ts` — cheap tier, Zod-enum-constrained to
`fact_predicates`; candidate-only.

**Integration hooks (additive, gated by `FACTS_ENABLED`, off in prod):** post-`verifyEvidence`
→ `promoteFromEvidence`; post-`insertSignal`/`mapSignals` → `promoteFromSignal`; pursuit
snapshot recompute → `factsToContributions`.

**Scripts:** `scripts/backfill-facts.ts`, `scripts/facts-verify.ts`; `package.json`
`facts:backfill`, `facts:verify`.

## 18. Backfill / migration treatment of existing evidence & signals (§ backfill)

`backfillOrg`-style, per-org, RLS-scoped, **idempotent, dry-run-first**:
- Each **signal** with a registry predicate map → fact + `fact_signals` support; inherit
  `family`/`half_life_days`; `valid_until` from `value.event_date`.
- Each **verified evidence** with a mappable claim → candidate → gate. Deterministic
  predicate map first; **LLM extraction only in the demo tenant / opt-in** (cost + prod
  safety).
- Evidence sharing a `claim_fingerprint` collapses into **one** fact (many support rows) via
  `fact_key`. Refuting stance → `fact_evidence.stance='CONTRADICTS'`. Existing
  `contradictions` (opposing signals) → `fact_contradictions`.
- Produces the standing anomaly report shape: candidate facts, **predicate distribution**,
  unmapped/UNCLASSIFIED claims, dedup collisions, contradictions, unmappable rows, RLS
  anomalies. Prod stays dark; the **demo tenant** is where facts light up.

## 19. Tests — blind verification (§ tests)

Harness extends `supabase/verify/wsa_harness.sql` with `evidence`/`signals`/`contradictions`/
`review_queue` base tables; `scripts/facts-verify.ts` runs as `app_rw` + `app.org_id` GUC.
Assertions: (1) unvocabularied candidate rejected — no fact; (2) supported candidate →
ASSERTED, unsupported → CANDIDATE; (3) material + single unverified → REVIEW_REQUIRED;
(4) same evidence promoted twice → one fact, one support row, no double-count;
(5) two independent source_types → one fact, higher confidence, provenance upgraded;
(6) refuting evidence → penalty; opposing fact → `fact_contradictions` + CONTRADICTION_DETECTED
+ status CONTRADICTED, not deleted; (7) newer incompatible fact → old SUPERSEDED, history intact;
(8) expiry sweep → EXPIRED, not deleted; (9) freshness decay lowers evidence_confidence, not truth;
(10) `factsAsOf(T)` returns only facts believed at T; (11) convergence correct, <2 families → 0;
(12) asserting a fact links live pursuits with correct relevance_type; contradicting → CONTRADICTING;
(13) `assembleWhyNow` structured, every element id-referenced, WHY_NOW_CHANGED on material change,
idempotent when unchanged; (14) `factsToContributions` → `referenceKind='fact'`,
`featureObservedAt ≤ snapshot as_of`, CANDIDATE never contributes; (15) ledger actor≠trigger;
(16) tenant isolation read+write under RLS; (17) backfill deterministic+idempotent, no false
predicate defaults, corroboration collapses; (18) `FACTS_ENABLED` off → hooks inert. `tsc` clean.

## 20. Rollback (§ rollback)

Everything additive; `FACTS_ENABLED` (default **off**) gates every hook and surface. Off = the
live pipeline behaves exactly as today (fact tables unread). Clean, data-preserving rollback =
unset the flag. Backfill is operator-invoked, **dry-run-first**, **demo-tenant only** pre-demo.
**No production tenant is enabled until explicit sign-off** — the standing rule from Workstream A.

## 21. Workstream B — Definition of Done

- Migrations 0069–0071 additive; apply clean on a fresh DB.
- `facts` is a normalized subject·predicate·object proposition against a **controlled
  predicate vocabulary**; no code path stores an LLM blob as a fact.
- Fact lifecycle service-guarded; transitions enforced; append-only ledger.
- Deterministic promotion gate; LLM proposes candidates only; confidence never set by a
  single model call.
- Provenance (class + origin) computed deterministically.
- Support/contradiction associations M:N; contradictions recorded, never netted.
- Validity/freshness/supersession implemented; nothing deleted; **as-of reconstruction works**.
- Signal-family convergence over facts.
- Pursuit↔fact/signal/evidence links via 0066 **with FK integrity**.
- **Why Now reconstructable from the graph; every element id-referenced;** WHY_NOW_CHANGED on
  material change.
- Fact→score contribution honors the **leakage guard** + directional/versioned scoring.
- Change-ledger events with actor≠trigger.
- Human-review thresholds enforced; `review_queue` integration.
- RLS on all new tables; read+write isolation proven under `app_rw`.
- Idempotent promotion + backfill; deterministic; dry-run first.
- Blind-verification harness green; `tsc` clean.
- Ships dark behind `FACTS_ENABLED`; clean rollback; **no prod tenant enabled**.

## 22. Standing operating constraints carried into B (acknowledged)

- **Production backfill rule:** dry-run only first → anomaly report (candidate facts,
  predicate distribution, unmapped claims, dedup collisions, contradictions, unmappable rows,
  RLS anomalies) → manual inspection → real backfill only after explicit approval. Applies to
  the facts backfill exactly as to pursuits.
- **`PURSUITS_ENABLED`/`FACTS_ENABLED` stay OFF for production tenants** until sign-off.
- **Verification caveat:** the isolated harness is strong Workstream-verification, **not** the
  final production-release certification — the pre-demo release gate must still run a full
  application/database integration check in the real deployment environment.

---

## HALT — awaiting Phase 2 (Workstream B) design sign-off

Per the foreman-architect loop and your directive, I stop here. On your approval I will
proceed to Phase 3 (atomic execution) in the §-ordered sequence, then Phase 4 blind
verification, and return a Workstream B Phase 4 Verification Report before touching any
production data.
