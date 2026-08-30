# Workstream C — Routing / Ecosystem Decisioning · Phase 2 Technical Design

**Foreman-Architect Phase 2 (Technical Design). No code until sign-off.** Grounded in a
direct map of the real substrate (not narration — a mid-session container reset briefly hid
the Pursuit/Facts layer from an explorer; verified against the live branch that migrations
0063–0073 and the `pursuits` route columns exist).

**Objective:** convert trusted Pursuit Intelligence into an **explainable, governed route
decision** — which ecosystem route gives this Pursuit the best chance, which people work it,
why, and what the alternatives are. This is the first real **decisioning layer**:

```
Pursuit Intelligence (Facts, WS-B) → Route Decision → Pursuit Team → Motion / Activation
```

## 0. What already exists (reuse, don't reinvent)

| Capability | Substrate | Migration / file |
|---|---|---|
| Partner-fit scoring | `partner_fit_scores` + `partner_fit_features`, `computePartnerFit` (weights capability .35 / relationship .30 / territory .20 / seller_coverage .15), capability **hard gate** | `0006`, `src/lib/ecosystem/partner-fit.ts`, `match.ts` |
| Partner capability | `partner_capabilities` (taxonomy strength + certified) | `0006` |
| Partner / seller relationships | `partner_relationships` (strength/tenure), `seller_account_relationships` (strength) | `0001` |
| Sellers | `sellers` (vendor_id XOR partner_id; territory free-text) | `0001` |
| Team recommendation | `pursuit_teams` (status recommended/accepted/declined/superseded), `assemblePursuitTeams`, capacity accounting | `0007`, `src/lib/ecosystem/teams.ts`, `routing.ts` |
| **Reserved route columns on `pursuits`** | `recommended/selected_partner_id`, `recommended/selected_vendor_seller_id`, `recommended/selected_partner_seller_id`, `recommended/approved_motion_id`, `recommended/accepted_timing_window`, `current_partner_activation_score`, `current_seller_activation_score` | `0063` |
| Consent fabric | `partnerships` (P2P), `list_grants` (field-scoped), `overlap_probes` (disclosure ladder), `joint_pursuits`, `warm_intro_requests` (EQL), `audit_log` | `0031/0037/0039/0041/0042` |
| Identity | `companies.duns/naics/primary_domain`, `company_aliases` (incl. `distributor_account_id`), `company_hierarchies` (parent/child), `normalizeCompanyName`/`nameSimilarity` | `0001`, `src/lib/identity/normalize.ts` |
| Change ledger / overrides / as-of | `change_ledger` (PARTNER_ROUTE_CHANGED, SELLER_ROUTE_CHANGED, TEAM_CHANGED already present), `pursuit_overrides`, WS-A/B as-of discipline, `pursuit_facts` (PARTNER_ROUTE relevance), `why_now.partner_route_relevance` scaffold | `0063–0072` |

**Net-new for C:** a durable route-decision object + candidate routes + participants + activation
scoring + seller-fit scoring + relationship-truth model + the distributor
TransactionSignalProvider + transaction features + entity-resolution confidence + route outcomes.

## 1. Canonical invariant — recommendation ≠ decision (§2)

Kept distinct end-to-end: `recommended_partner` vs `selected_partner`, `recommended_seller`
vs `assigned_seller`, `recommended_team` vs `accepted_team`. The system proposes; a human or
authorized policy selects. Never silently promote a recommendation to a decision. The reserved
`pursuits.recommended_*`/`selected_*` columns become the **current cache**; the durable history
lives in the snapshot layer (§2 below).

## 2. Durable route model — `0074_route_core.sql` (§3/§4/§37/§39/§40)

```sql
create table pursuit_route_snapshots (       -- append-only, versioned, reconstructable
  id, org_id, pursuit_id, seq, is_current,
  as_of, calculated_at,
  route_topology text,                       -- DIRECT | PARTNER_LED | DISTRIBUTOR_LED | JOINT
  recommended_partner_id, selected_partner_id,
  recommended_distributor_id, selected_distributor_id,
  recommended_vendor_seller_id, selected_vendor_seller_id,
  recommended_partner_seller_id, selected_partner_seller_id,
  route_score numeric,                       -- best candidate's total score (0..100)
  route_confidence numeric,                  -- DISTINCT from score (§11): data-completeness driven
  route_status text,                         -- PROPOSED|REVIEW_REQUIRED|RECOMMENDED|SELECTED|DECLINED|REROUTE_REQUIRED|SUPERSEDED (§37)
  model_version text,                        -- 'route-v1-rules'
  created_by_type, created_by_id,
  data_environment, is_simulated             -- WS-A lineage
);  -- partial-unique one-current per pursuit; unique(pursuit_id, seq)

create table route_candidates (              -- every candidate, not just the winner (§4/§16)
  id, route_snapshot_id, org_id,
  partner_id, distributor_id, route_topology,
  rank int, is_recommended bool, is_selected bool,
  total_score numeric,
  -- explainable sub-scores (§5)
  relationship_score, capability_score, transaction_score, territory_score,
  seller_coverage_score, historical_performance_score, strategic_alignment_score,
  -- suitability vs readiness kept separate (§30)
  suitability_score numeric,                 -- structural quality of the route
  activation_readiness_score numeric,        -- can it execute NOW (seller assigned, capacity, consent)
  candidate_confidence numeric,
  disqualifiers text[]                        -- (§6)
);

create table route_candidate_reasons (       -- structured explanation, every line id-referenced (§12/§33)
  id, candidate_id, org_id,
  reason_code text, polarity smallint,       -- +1 strengthens / -1 weakens
  weight numeric, detail text,
  ref_type text,                             -- 'fact'|'relationship'|'capability'|'transaction'|'seller'|'territory'|'warm_intro'|'outcome'
  ref_id uuid
);

create table pursuit_route_participants (    -- multi-party route topology graph (§39/§40)
  id, org_id, pursuit_id, route_snapshot_id,
  organization_id uuid, partner_id uuid, distributor_id uuid,
  role text,                                 -- VENDOR | DISTRIBUTOR | RESELLER | PARTNER | CUSTOMER
  sequence int, status text
);
```

Route is a **path of organizations**, never just `pursuit.partner_id` (§39). Historical
snapshots stay reconstructable; the current one caches onto `pursuits.recommended_*`/`selected_*`.

## 3. Route candidate generation & scoring (§4/§5)

`rankRoutes(db, pursuitId, asOf)` generates candidates from the partner set that clears the
**capability hard gate** (reusing `partner_capabilities`), plus a `DIRECT` candidate (§38) and,
where transaction data exists, a `DISTRIBUTOR_LED` candidate. Each candidate is scored
deterministically from governed inputs — the existing `computePartnerFit` promoted to
Pursuit-specific and extended with `transaction_score`, `historical_performance_score`,
`strategic_alignment_score`, `activation_readiness_score`. **All alternatives persist**, so the
product answers "CDW 91 · WWT 82 · Insight 74 — and why" and "Why not WWT?" (§16). Versioned as
`route-v1-rules` — unifying the score-version gap (partner-fit currently uses a bare text tag).

## 4. Partner Activation Score dimensions (§5)

Account relationship · product/category capability (gate) · historical performance ·
installed-base/transaction adjacency · territory · segment · vertical · current seller coverage
· technical coverage · response/activation history · strategic alignment · transaction evidence
(where permissioned). Every dimension emits a `route_candidate_reasons` row with a real ref id.

## 5. Disqualifiers (§6)

Registry with hard/soft classification: `NO_ACCOUNT_COVERAGE`, `NO_PRODUCT_CAPABILITY`,
`TERRITORY_MISMATCH`, `PARTNER_DECLINED`, `CONFLICTING_INCUMBENCY`, `NO_ACTIVE_SELLER`,
`CAPACITY_CONSTRAINT`, `CONSENT_NOT_AVAILABLE`. **Hard** removes a candidate from
recommendation; **soft** reduces its score. Stored on `route_candidates.disqualifiers[]`.

## 6. Seller Fit — `route_seller_candidates` (§7/§8)

`Seller × Account × Product × Pursuit` scoring, **independent of the partner route** (§8): a
partner can be right while the first seller declines and a second accepts, without changing the
route. Dimensions: account ownership · territory · relationship history · meeting history ·
responsiveness · product expertise · certifications · historical outcomes · workload/capacity ·
partner alignment · account familiarity · vertical experience. Reuses
`seller_account_relationships`; each contribution reason persisted. `is_recommended` vs
`is_assigned` distinct.

## 7. Pursuit Team — `0075_pursuit_team_members.sql` (§9/§10)

`pursuit_teams` (recommendation row) stays; a new **`pursuit_team_members`** models the
operational team keyed on `pursuit_id`: `side` (VENDOR/PARTNER/DISTRIBUTOR), `role` (AE, PAM,
Specialist, SA, Exec Sponsor / Partner AM, BDM, Technical Architect / Vendor Manager, BD…),
`seller_id`/`person_ref`, `fit_score`, `selection_reason`, `relationship_strength`,
`capability_fit`, `responsibility`, and **lifecycle** `RECOMMENDED → INVITED → ACCEPTED /
DECLINED → ACTIVE → ACTION_REQUIRED → INACTIVE → SUPERSEDED`. A recommended team ≠ an active
team — this matters in Workstream E.

## 8. Route confidence ≠ route score (§11); suitability ≠ readiness (§30)

`route_score` = weighted dimension total. `route_confidence` = how complete/trustworthy the
underlying data is (relationship coverage, evidence density, entity-resolution confidence).
`suitability_score` = structural quality; `activation_readiness_score` = can it execute now
(named seller, capacity, consent). Uncertainty is never hidden — a 92 score with 61 confidence,
or 94 suitability with 42 readiness, are both first-class and displayed.

## 9. Relationship Truth (§13/§14) — `account_relationship_assessments`

Workstream B established *observed* truth; C operationalizes *relationship* truth, tiered:
`OVERLAP_ONLY` < `ACTIVE_RELATIONSHIP` < `NAMED_CONTACT_RELATIONSHIP`. A durable assessment
rolls `relationship_strength` + `relationship_confidence` from `partner_relationships`,
`seller_account_relationships`, interactions, opportunity/transaction history, warm-intro paths,
CRM ownership. **No single email makes a relationship "strong."** Warm-intro decisioning (§15)
reuses the consented `warm_intro_requests` chain and surfaces an available named path when one
exists.

## 10. Distributor architecture — `0076_transaction_signals.sql` (§20–22)

**`TransactionSignalProvider`** interface, independent of any live distributor, with three
privacy-preserving modes:
- **RAW** — authorized raw rows ingested, features computed by PursuitOS.
- **DERIVED** — the distributor computes features and passes only normalized outputs.
- **FEDERATED** — PursuitOS sends a permitted account/category request, receives only allowed outputs.

**`transaction_features`** (a distinct **source family**, §21): normalized per
(company, category, distributor) — `category_spend_12m`, `category_spend_growth`,
`purchase_recency`, `purchase_frequency`, `partner_tenure`, `partner_spend_rank`,
`vendor_concentration`, `category_adjacency`, `sku_family_count`, `purchase_sequence`,
`category_velocity` — each with `observed_at` and **WS-A lineage** (`data_environment`
SYNTHETIC/SIMULATION, `is_simulated`). **No live TD SYNNEX; fixtures only.** Transaction truth
feeds facts **through Workstream B's contracts** (C creates evidence/fact candidates, never
mutates Facts — §35) and the candidate `transaction_score`.

## 11. Identity resolution — `0077_entity_resolution.sql` (§23–26)

Reuse `companies.duns`, `company_aliases` (already carries `distributor_account_id`),
`company_hierarchies`, `normalize.ts`. Add to alias/link records: `resolution_method`,
`resolution_confidence`, `verified_by`, `verified_at`. DUNS/LEI/CRM/distributor/partner IDs are
**first-class aliases**, none mandatory (§24). Low-confidence matches (e.g. "Acme Holdings" vs
"Acme Corporation") route to **review** (§25), never silently linked. **Parent/child hierarchy
resolution** (§26): a distributor transaction under a subsidiary rolls up to the vendor account
at the parent for route context.

## 12. Recommendation vs decision, override capture (§17)

Selection writes `selected_*`; override captured via `pursuit_overrides` (WS-A) extended with
route/seller/team fields: recommendation, chosen route, reason, actor, timestamp, **candidate
ranking snapshot**, model_version — the route-learning supervision data.

## 13. Route change ledger — `0079` (§18/§19)

Add to `change_ledger` change_type: `ROUTE_RECOMMENDATION_CHANGED`, `PARTNER_SELECTED`,
`PARTNER_OVERRIDE`, `SELLER_RECOMMENDATION_CHANGED`, `SELLER_ASSIGNED`, `PARTNER_DECLINED`
(TEAM_CHANGED / PARTNER_ROUTE_CHANGED / SELLER_ROUTE_CHANGED already exist). **A route change
never creates a new Pursuit** (§19) — same Pursuit, new route/team configuration.

## 14. As-of / leakage & versioning (§27/§28)

Route snapshots are append-only + versioned (like Pursuit scores and Why Now). Historical
performance and transaction features are consumed **as-of** scoring time — no future outcome
leaks into a historical route score. Reuses the WS-A/B leakage discipline exactly.

## 15. Route outcomes — `0078_route_outcomes.sql` (§29/§48)

Define labels now for future calibration: `PARTNER_ACCEPTED`, `SELLER_ACCEPTED`,
`FIRST_ACTION_COMPLETED`, `CUSTOMER_ENGAGED`, `MEETING_CREATED`, `OPPORTUNITY_CREATED`,
`PIPELINE_CREATED`, `WON`, `LOST`. **Directional only** — the product says "Partner Activation
91 · Route Confidence High", never "91% win probability."

## 16. Why Now completion (§34) + strategic priority separation (§32)

C populates `pursuits.why_now.partner_route_relevance` from the current route snapshot,
referencing `route_candidate` + reason ids (extends B's `assembleWhyNow`). Business/strategic
priority (`strategic_alignment_score`) is stored and surfaced **separately** from purchase
propensity — priority never masquerades as market intent.

## 17. Cross-tenant / consent (§41/§42)

Route participation ≠ full Pursuit visibility. One tenant owns its Pursuit; a partner
participant sees only consented fields via the existing `list_grants`/`joint_pursuits`
disclosure fabric. All route tables RLS org-scoped (`is_org_member`); child tables parent-scoped.
Blind tests include **association-path** leakage (a partner cannot infer scores/other candidates
via participation).

## 18. Routing Skills (§43/§44)

Governed capabilities with explicit side-effect classes (map to Workstream H later):
`rank_partner_routes` (READ) · `explain_partner_route` (READ) · `rank_sellers` (READ) ·
`assemble_pursuit_team` (READ→INTERNAL_WRITE) · `select_partner_route` (INTERNAL_WRITE) ·
`override_partner_route` (INTERNAL_WRITE) · `request_team_acceptance` (CROSS_TENANT_ACTION).
Read vs internal-write vs cross-tenant-action never blurred.

## 19. Migrations & file targets

**Migrations (additive):** `0074_route_core` · `0075_pursuit_team_members` ·
`0076_transaction_signals` · `0077_entity_resolution` · `0078_route_outcomes` ·
`0079_change_ledger_route_types`.

**Services `src/lib/routing/`:** `flags.ts` (`ROUTING_ENABLED`, default off) · `partner-activation.ts`
· `seller-fit.ts` · `disqualifiers.ts` · `candidates.ts` (rank) · `route-model.ts` (snapshot
upsert, recommend vs select, one-current) · `route-confidence.ts` · `readiness.ts` ·
`participants.ts` · `team.ts` (assemble + lifecycle) · `relationship.ts` (relationship-truth) ·
`override.ts` · `route-why-now.ts` (populate partner_route_relevance) · `outcomes.ts` ·
`score-impact.ts` (activation scores → `pursuits.current_*` cache) · `asof.ts`.
**`src/lib/transactions/`:** `provider.ts` (RAW/DERIVED/FEDERATED interface) · `features.ts` ·
`identity-resolve.ts` · `fixtures.ts` (synthetic distributor data).
**Scripts:** `scripts/routes-backfill.ts` (recompute routes for live pursuits, dry-run first) ·
`scripts/routes-verify.ts` (blind harness) · demo seeding.

## 20. Demo fixtures (§45/§46/§47)

Three scenarios — **A** clear winner (CDW ≫), **B** near tie (CDW vs WWT, different strengths),
**C** route changed (new transaction/relationship flips the recommendation). Plus the **TD SYNNEX
hero**: before distributor signal CDW 78 / WWT 82; adding synthetic transaction features (category
adjacency, recent purchase, partner tenure) → CDW 91 / WWT 82, with the explanation "recommended
route changed because new transaction truth materially strengthened CDW." All simulated data is
**lineage-isolated and clearly labeled** "illustrative / synthetic distributor-derived signal" —
never implying a live feed.

## 21. Tests, rollback, DoD

**Blind verification** (`routes-verify.ts`, run as `app_rw` + GUC) covers the §50 DoD (30
items): multiple candidates, deterministic ranking, explainable scores, partner/seller change
without new Pursuit, recommended≠selected, override preserved, confidence≠score, suitability≠
readiness, hard/soft disqualifiers, append/versioned history, route change ledger, team assembly
+ acceptance lifecycle, alternatives queryable, DIRECT route valid, multi-party topology,
distributor feature flips ranking, simulated data lineage-isolated, external-ID reconciliation,
ambiguous match → review, parent/subsidiary logic, historical scoring excludes future data,
cross-tenant + association-path isolation, Ask/MCP explain via governed context, ROUTING_ENABLED
off preserves legacy, build/tests/RLS green.

**Rollback:** everything additive; `ROUTING_ENABLED` default OFF gates every surface and hook;
demo-tenant only pre-demo; **no production tenant enabled; no production data touched**.

## 22. Workstream C Definition of Done — the §50 checklist, verified in the harness

All 30 criteria demonstrated: candidate generation → deterministic rank → explainable scores →
partner/seller reroute without forking the Pursuit → recommendation/selection & recommended/
assigned distinctions → override lineage → confidence/score & suitability/readiness separation →
hard/soft disqualifiers → append/versioned route history → route change ledger → team assembly +
acceptance states → alternatives queryable → DIRECT + multi-party topology → distributor-derived
feature changes ranking → simulated transaction lineage isolation → external-ID reconciliation +
ambiguous-match review + parent/child → historical route scoring excludes future data →
cross-tenant + association-path isolation → governed Ask/MCP explanation → ROUTING_ENABLED-off
legacy preservation → tsc/tests/RLS green.

## 23. Standing operating constraints (carried into C)

- **No production data touched; no production route/transaction backfill** — dry-run-first →
  anomaly report → inspection → explicit approval, exactly as A/B.
- **`PURSUITS_ENABLED` / `FACTS_ENABLED` / `ROUTING_ENABLED` remain OFF for production tenants.**
- **No live TD SYNNEX / distributor connection** — contracts + synthetic fixtures only, clearly
  labeled.
- **The pre-demo release gate still requires a full app/DB integration check in the real
  deployment environment** — the isolated harness is strong workstream verification, not
  production-release certification.
- **Workstream D does not begin** until C is implemented, blind-verified, and signed off.

---

## HALT — awaiting Phase 2 (Workstream C) design sign-off

On approval I will execute Phase 3 (atomic implementation) in a defined step order, run Phase 4
blind verification, and return a Workstream C Phase 4 Verification Report before any production
data is touched.
