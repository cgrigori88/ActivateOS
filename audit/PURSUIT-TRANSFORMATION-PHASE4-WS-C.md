# Workstream C — Routing / Ecosystem Decisioning · Phase 4 Blind Verification Report

**Scope:** the route-decisioning layer between Pursuit Intelligence and execution. Foreman-
Architect loop, Workstream C only, executed in the §60 order against the §61 DoD. **HALT point —
no Workstream D work has begun; no production data touched; no live distributor connection.**

**Branch:** `claude/activateos-platform-review-xzkgmd`

| Commit | Contents |
|---|---|
| `af8726a` | WS-C Phase 3 (1/4): migrations 0074–0079 |
| `1ec4ab3` | WS-C Phase 3 (2/4): routing + transaction services |
| `f75e6d6` | WS-C Phase 3 (3/4): blind-verification harness + backfill (64/64 green) |

Phase 2 design (`12cfe66`) signed off with 64 clarifications; all reflected below.

## 0. Resilience discipline (§57/§58) — performed first

The container had reset again; per the standing rule I fetched the remote, hard-reset to it,
and verified before writing any code: HEAD at the C-TDD commit, worktree clean, migrations
0063–0073 present, `pursuits` + `facts` tables defined, Postgres restarted. Only then did Phase 3
begin.

## 1. Migrations applied (§60.2/3)

Applied on a **fresh DB** over the WS-A/B harnesses + a faithful ecosystem harness
(`wsc_ecosystem_harness.sql`: partner_capabilities/relationships, seller relationships, aliases,
hierarchies). All 20 A+B+C migrations apply clean:

| Migration | Purpose |
|---|---|
| 0074 route_core | `pursuit_route_snapshots` (append-only, versioned, one-current) · `route_candidates` (all alternatives + partner-activation/suitability/readiness distinct from route score) · `route_candidate_dimensions` (explainable, as-of) · `route_candidate_reasons` (id-referenced + `disclosure_class`) · `route_candidate_disqualifiers` (HARD/SOFT + provenance) · `pursuit_route_participants` (multi-party path + sequence) |
| 0075 route_sellers_team | `route_seller_candidates` (recommend≠assign) · `route_seller_dimensions` · `pursuit_team_members` (controlled role registry + acceptance lifecycle) · `pursuit_team_requirements` (min-viable-team, seeded) |
| 0076 transaction_signals | generic `TransactionSignalProvider` (RAW/DERIVED/FEDERATED) · `transaction_features` (source family, provenance/validity/lineage + `data_classification`) |
| 0077 entity_resolution | external-ID aliases + resolution method/confidence/status · `entity_resolution_reviews` · `hierarchy_rollup_policies` (seeded) · DUNS index |
| 0078 route_outcomes | route-learning labels + time-to-event + intervention scaffold |
| 0079 | widen `change_ledger` with route events (superset incl. B) |

~390 lines of migration; all **additive**. `~1,080` lines of typed services in `src/lib/routing/`
+ `src/lib/transactions/`.

## 2. Schema created (verified in-DB)

14 route/transaction/team/entity tables, all RLS-enabled; one-current index on route snapshots;
team + rollup policies seeded; the `pursuits` reserved route columns are used as the current-
state cache while the snapshot graph holds history.

## 3. Test results — §61 checklist

Harness: `scripts/routes-verify.ts` (`npm run routes:verify`). Every mutation runs as non-owner
`app_rw` with `app.org_id` set; superuser only seeds global/reference rows.

```
[routes-verify] 64 passed, 0 failed
```

| Area | Result |
|---|---|
| Candidate generation, alternatives persisted, deterministic ranking, DIRECT + multi-party path | ✓ (11) |
| HARD disqualifier removes a candidate (kept, not recommended); suitability≠readiness; confidence≠score; dimensions + reasons persisted | ✓ |
| **TD SYNNEX hero** — WWT leads; synthetic distributor signal (lineage-flagged, never PRODUCTION) flips to CDW; ROUTE_RECOMMENDATION_CHANGED; history append/versioned; one-current | ✓ (7) |
| Selection≠recommendation; override preserves original recommendation + full ranking + category; PARTNER_OVERRIDE ledger; partner change no-fork | ✓ (7) |
| Seller fit deterministic; assignment≠recommendation; seller change no-fork | ✓ (3) |
| Team assembly; members start RECOMMENDED; acceptance lifecycle; required-role coverage; team ledger | ✓ (5) |
| Partner decline → reroute promotes an alternative, no new Pursuit, prior history preserved | ✓ (3) |
| Relationship-truth temporal decay (fresh outranks stronger-but-stale) | ✓ |
| RAW / DERIVED / FEDERATED provider contracts (FEDERATED minimized, no raw values) | ✓ (3) |
| Entity resolution: external-ID + DUNS auto; ambiguous fuzzy → review; unresolved cannot score; hierarchy rows + roll-up policy | ✓ (7) |
| As-of route reconstruction; past as-of excludes later snapshots; route model version retained | ✓ (3) |
| Internal vs shareable explanation (shareable generalizes confidential transaction detail); Why Now route relevance traceable + persisted | ✓ (5) |
| Route outcomes + time-to-event | ✓ (2) |
| Cross-tenant isolation direct + association path (candidates, reasons); skill READ/INTERNAL_WRITE/CROSS_TENANT_ACTION classes; ROUTING_ENABLED off | ✓ (7) |

**64 / 64 passed.**

## 4. Row counts (post-run verify DB)

route snapshots 5 · route candidates 29 · candidate dimensions 197 · candidate reasons 47 ·
disqualifiers 37 · participants 14 · team members 5 · transaction features (all simulated) 4 ·
entity-resolution reviews 1 · route outcomes 1 · route ledger events 10.

## 5. Security results

All route mutations under `app_rw` + GUC. Cross-tenant **read** blocked directly and via the
association path (org A cannot read org B's `route_candidates` / `route_candidate_reasons`).
Route participation does not grant Pursuit visibility (route tables are org-owned; consent fabric
remains authoritative). 14/14 route tables RLS-enabled.

## 6. How the binding invariants are enforced (evidence)

- **Recommendation ≠ decision** — separate `recommended_*`/`selected_*` columns and candidate
  `is_recommended`/`is_selected`; override preserves the original ranking + category (tested).
- **Route ≠ partner_id** — `route_topology` + `pursuit_route_participants` sequence; DIRECT and
  multi-party paths are first-class (tested).
- **Alternatives persist** — the full candidate set with dimensions/reasons/disqualifiers is
  stored every snapshot (tested).
- **Suitability ≠ readiness; confidence ≠ score** — four distinct stored values (tested).
- **Transaction truth is governed** — synthetic features are lineage-isolated + labeled, unresolved
  identity cannot score, confidential detail is generalized in shareable explanation (tested).
- **Route change never forks the Pursuit; as-of leakage held** (tested).

## 7. Known deviations from the Phase 2 design

1. Verified via the isolated harness, not a full rebuild (same technique as A/B; harness committed).
2. Partner "decline" is exercised as capability-withdrawal driving a real recompute+reroute; a
   first-class `PARTNER_DECLINED` disqualifier surface is scaffolded (ledger type + disqualifier
   code) and completed operationally in Workstream E.
3. Hierarchy roll-up is policy-scaffolded (`hierarchy_rollup_policies` seeded, enforced at read
   time) rather than a full propagation engine — as the directive permits (§33).
4. Capacity/workload are neutral scaffolds pre-demo (§31).

## 8. Unresolved risks / watch items

- **No production route/transaction backfill** — proven idempotent on synthetic data only; the
  production run is dry-run-first → report → inspection → explicit approval (§62).
- **`PURSUITS_ENABLED`/`FACTS_ENABLED`/`ROUTING_ENABLED` remain OFF for production tenants.**
- **No live distributor connection** — RAW/DERIVED/FEDERATED contracts + synthetic fixtures only.
- **Full app/DB integration check in the real deployment environment remains a pre-demo release
  gate** — the harness is strong workstream verification, not release certification.

## 9. Definition-of-Done status (§61)

All demonstrated by the 64-assertion suite: multiple candidates · deterministic rank · explainable
scores · route/partner/seller change without forking · recommendation/selection & recommended/
assigned distinctions · override lineage + category + preserved ranking · confidence/score &
suitability/readiness separation · hard/soft disqualifiers · append/versioned route history +
change ledger · team assembly + acceptance lifecycle + required roles · direct + multi-party
topology · distributor feature flips ranking + synthetic lineage isolation · RAW/DERIVED/FEDERATED
contracts · external-ID/DUNS/fuzzy-review/unresolved-quarantine/hierarchy · as-of leakage guard +
model version · internal vs shareable explanation · Why Now route relevance · cross-tenant direct +
association isolation · skill governance classes · flag-off legacy preservation · **tsc clean**.

**Workstream C DoD: GREEN. 64/64 verification assertions pass.**

---

## HALT

Per the directive I halt for **Workstream C implementation sign-off**. Workstream D (Pursuit UX)
will not begin until you approve. No production route/transaction promotion will occur before a
reviewed dry-run and explicit approval; no production tenant is enabled; no live distributor is
connected.
