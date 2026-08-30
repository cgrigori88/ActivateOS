# Workstream E3-F — Outcomes, attribution, experiments, override convergence (verification)

The learning record the mapping found split across two spines (`route_outcomes` + opportunity advancement) and missing its intermediate signal. Three deliberately **separate** Pursuit-spined objects that never collapse (R10/R15), plus override convergence (R17).

## Delivered
- `supabase/migrations/0085_outcomes_attribution_experiments.sql`
  - `pursuit_outcomes` (R14) — event-rich labels incl. the missing **NO_DECISION / DORMANT / DISQUALIFIED** and economically-meaningful intermediates (intro-accepted, meeting-booked/completed, opportunity-created/qualified/progressed, deal-registered, quote-created, renewal-retained, expansion-created …), each linked to its **decision-time context** (score/route/why-now snapshot ids); `is_terminal`; value lives here, not on attribution.
  - `attribution` (R15) — explicit, versioned, **NOT ROI**: classes `SOURCE/INFLUENCED/ASSISTED/OBSERVED/UNKNOWN`, `model_version` NOT NULL, `evidence`, `reason`, and a **human override** that preserves the machine claim.
  - `experiments` / `experiment_arms` / `cohort_assignments` (R16) — intervention history carrying the **intelligence state BEFORE the intervention**; org-scoped, never crossing tenant/disclosure (fairness invariant).
  - `pursuit_overrides` additive columns (R17) — `outcome_id`, `system_converged`, `converged_at`, `recommendation_confidence`, `alternatives`, `override_category`, `actor_role`.
- `src/lib/pursuits/federation/outcomes.ts` — `recordOutcome`/`outcomesForPursuit`, `recordAttribution`/`overrideAttribution`/`attributionsForPursuit`, `createExperiment`/`addArm`/`assignCohort`/`linkCohortOutcome`, `markOverrideConvergence`.
- `src/lib/pursuits/federation/flags.ts` — `outcomeLearningEnabled()` (org-local; depends on the Pursuit experience, not federation).
- `scripts/outcomes-verify.ts` — blind harness.

## Blind harness — 18 / 18
- **Outcomes (R14):** the missing terminal labels exist; an intermediate is not terminal; an outcome is captured **with** its decision-time route snapshot; the trail records intermediate → terminal in order; economic value lives on the outcome.
- **Outcome ≠ attribution (R15):** an attribution with no `model_version` is refused; recording attribution does not mutate the factual outcome; the outcome back-links the claim (linked, not merged); a human override preserves the machine class and surfaces the effective class.
- **Experiments (R16):** cohort assignment is idempotent per (experiment, pursuit); the intelligence-state-**before** is captured once and is immutable across re-assignment; the realized outcome binds back to the assignment.
- **Override convergence (R17):** an override records whether the system later converged + the realized outcome.
- **Tenant isolation:** another org cannot read the outcomes/attribution/experiment or write an outcome onto this org's pursuit (RLS with-check).
- **Flag fail-safe:** outcome learning OFF when the experience dependency is off.

## Gate
tsc **clean** · migration **85 applied** (additive: create-if-not-exists + `add column if not exists` + guarded FK, **no destructive statements**) · learning objects **dark** (referenced only by the lib + harness — call-site emission from `transitionPursuit`/`advanceOpportunity` is deferred to E3-H) · separation + versioning + isolation **proven under RLS** · flags **default OFF** · **no production backfill** · **no predictive-calibration claim on synthetic data** (analytics-only) · regression E3-A **19/19**, E3-B **21/21**, E3-C **12/12**, E3-D **15/15**, E3-E **20/20**.

## Deferred (by design)
- Emitting a unified outcome on close from `transitionPursuit`/`advanceOpportunity`, and surfacing the outcome/attribution trail in the D.5 Pursuit detail → **E3-H** (closed-loop integration + UX).
- Fractional attribution policies and any calibrated model → future; E3-F ships the explicit, versioned substrate, not a scorer (R15/§48).

**E3-F complete. Proceeding to E3-G (federation-aware entity resolution + provider contract hardening).**
