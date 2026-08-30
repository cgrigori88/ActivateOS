# Release Gate R1-G2 — Tenant-scoped feature flags (verification)

**Goal (approved D5):** one deployment supports a design-partner tenant enabled for specific capabilities while every other tenant stays dark; server-side enforcement (UI hiding does not count); audit history for flag changes; fail-closed on unresolved state; `OUTCOME_LEARNING` dark unless explicitly enabled for an authorized tenant.

## Delivered
- `supabase/migrations/0089_org_features.sql` — `org_features` (per-org booleans for pursuits/facts/routing/pursuit_experience/federation/governed_action/outcome_learning, all default false, own RLS) + `org_feature_changes` (immutable who/when/why audit, own RLS). Additive; every column defaults false ⇒ nothing changes for existing tenants until an authorized enablement writes a row.
- `src/lib/pursuits/tenant-flags.ts` — the enforcement rule **`live_for(org, flag) = envEnabled(flag) && org_features.<flag>`**: env var = deployment kill-switch, per-org row = tenant opt-in. `tenantFeatures`/`experienceEnabledFor`/`federationEnabledFor`/`governedActionEnabledFor`/`outcomeLearningEnabledFor` (dependency chains applied; outcome_learning is org-local, does NOT require federation). **Fail-closed**: missing row / null / query error ⇒ OFF. `setOrgFeature` upserts + writes the audit row (column name whitelisted against the known flag set — never interpolated caller input).
- `src/app/pursuits/page.tsx` + `[id]/page.tsx` — the hard route gate is now **env master (fast deny) AND per-tenant `experienceEnabledFor` inside `withTenant`**; the federation panel gates on per-tenant `federationEnabledFor`. A tenant not enabled gets `notFound()` server-side, not a hidden-but-reachable page.
- `scripts/demo-db.ts` — enables the demo vendor org's flags (experience + federation + governed_action) so the demo boots under the per-tenant gate; **outcome_learning deliberately left OFF** (synthetic tenant).

## Blind harness — 13 / 13
- **Fail-closed by default:** an org with no row is fully dark even with env on.
- **Single-tenant enablement + isolation:** enabling the pilot enables it for the pilot only; a different org stays dark.
- **Dependency chains:** federation OFF until its own flag is set (needs experience); governed_action needs federation; outcome_learning is org-local and never implied by federation.
- **Env master kill-switch:** env-off forces everything OFF even with the org row all true.
- **Audit + RLS:** every change wrote an audit row; another org cannot read the pilot's `org_features` or `org_feature_changes` (RLS).

## Real booted-app verification
Booted against `pursuit_demo` (`app_rw` under RLS). `/pursuits` serves **200** for the enabled tenant and the hero renders its Federation panel; setting `org_features.pursuit_experience=false` for that tenant makes `/pursuits` return **404**, and re-enabling returns **200** — the route enforces per-tenant server-side, not the UI.

## Gate
tsc **clean** · migration **89 applied** (additive, own RLS, **no destructive statements**) · server-side per-tenant enforcement proven in the running app · audit history + fail-closed proven · outcome_learning dark unless explicitly enabled · regression G1 **13/13**, E3-A…E3-H **134/134**.

## Note
Nav item visibility (Shell) remains env-level — it is cosmetic; the **route** is the enforcement boundary, which is now per-tenant. Threading per-tenant flags into every library call site is unnecessary: the enforcement lives at the route/read-model boundary where `orgId` is resolved.

**R1-G2 complete. Proceeding to R1-G3 (runtime cross-tenant isolation proof — FORCE RLS, owner-pool hardening, /api/research fix, two-tenant negative tests).**
