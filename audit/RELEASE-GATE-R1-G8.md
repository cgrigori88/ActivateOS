# Release Gate R1-G8 — Three-organization authenticated pilot proof (verification)

The final gate: one canonical Pursuit, three organizations, each seeing a disclosure-appropriate projection through the **running authenticated app**, plus the happy-path and adverse-path closed loops as permanent regressions. No live distributor data — synthetic, `DEMO`, unmistakably separated.

## Delivered
- `supabase/migrations/0093_pursuit_participant_select.sql` — a SELECT-only participant policy on `pursuits` (`can_see_pursuit`), so an ACTIVE participant can load the pursuit page; writes stay org-scoped; non-participants still see nothing.
- `src/app/pursuits/[id]/page.tsx` — a **participant branch**: a viewer who can see the pursuit as a participant (not its owner) renders ONLY the disclosure-filtered federation projection (`getPursuitFederation` + shared context + governed actions + outcome trail), never the sponsor's decision surface. The sponsor/owner still gets the full D.5 detail.
- `scripts/demo-db.ts` — enables the pursuit experience + federation for all three demo orgs (vendor sponsor, distributor participant, guest outsider) so each can be viewed through the app; `outcome_learning` stays OFF (synthetic tenants).

## Real booted-app proof — three viewpoints of ONE canonical Pursuit
Booted the authenticated app against `pursuit_demo` (`app_rw` under FORCE RLS, per-tenant flags). Resolving the same hero Pursuit as each org:

| Viewpoint | HTTP | Confidential figure ("1.84M") | Projection |
|---|---|---|---|
| **Vendor (sponsor)** | 200 | **present** | full D.5 decision surface + federation panel |
| **Distributor (participant)** | 200 | **absent** (suppressed) | participant view — "Shared context you may see", no decision surface |
| **Outsider (guest)** | **404** | — | existence hidden (T11) |

The confidential route figure is served only to the sponsor; the participant gets the disclosure-safe shared projection; the non-participant cannot see the Pursuit exists. Disclosure is enforced at the **served-payload boundary**, not by UI hiding.

## The two LOCKED closed-loop scenarios — `closed-loop-verify` 18/18
Both permanent regression scenarios pass end-to-end under real RLS (the same libraries the app runs):
- **Happy path** — shared Pursuit → caller-specific disclosure → recommendation → human decision → governed action (audited) → outcome → event → as-of recompute → material intelligence change → Today changes; tenant isolation, disclosure absence, consent, as-of, provenance, recommendation ≠ decision ≠ action ≠ outcome, immutable history all held.
- **Adverse path** — resource/capability withdrawal → readiness change → material route reconsideration → recompute → alternate recommendation → human decision → immutable prior history → outcome.

## Gate
tsc **clean** · migration **93 applied** (additive SELECT-only participant policy, **no destructive statements**) · three disclosure-appropriate projections proven through the running app · both closed-loop scenarios **18/18** · no live distributor data (synthetic/DEMO) · full R1 + E regression green: closed-loop 18 · outbox 20 · ops 10 · recompute-recovery 8 · isolation 12 · tenant-flags 13 · governed-mutation 13 · federation 19 · disclosure 21 · contributions 12 · governance 15 · recompute 20 · outcomes 18 · entity-resolution 11 (+ wsc routes 64 · experience 34) + release-rehearsal 8.

**R1-G8 complete. Release Gate R1 architecture + implementation done (G1–G8).**

## Standing pre-pilot gates (ops actions, not code — release-blocking for the actual pilot)
1. Reconcile the **real** prod migration tracker per `docs/OPERATIONS.md`.
2. Set `BACKUP_DIR` + rehearse a restore from a real prod backup (offsite, encrypted).
3. Wire external error tracking / alerting (the R1-G6/D3 pre-pilot gate).
