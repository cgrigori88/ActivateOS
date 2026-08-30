# Workstream E3-B — Consent + disclosure (verification)

The federation security spine: purpose-limited grants + the two-dimension disclosure vocabulary + the generalized `applyDisclosure` policy engine + the federation viewer. Proves T1–T11-relevant invariants at the policy layer.

## Delivered
- `supabase/migrations/0081_context_grants.sql` — `context_grants` (purpose-limited, scoped, `expires_at`, `delegation_allowed`/`onward_sharing_allowed`/`retention_class`; DATA vs ACTION `grant_kind`, R24), FK from `pursuit_participants.consent_grant_id`, RLS, `grant_is_live()` (checks accepted + unexpired).
- `src/lib/pursuits/federation/disclosure.ts` — two INDEPENDENT dimensions (R6): **Audience** (`ORG_PRIVATE, PURSUIT_INTERNAL, PARTICIPANT_SHARED, ORG_ALLOWLIST, GENERALIZED, AGGREGATED, PUBLIC`) × **Sensitivity** (`PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED`), plus the legacy 6→audience map. `resolveDisclosure`/`applyDisclosure` do **policy resolution** (EXACT / GENERALIZED / AGGREGATED / **SUPPRESSED**), never string redaction (R7); a viewer with no standing gets nothing pursuit-scoped except PUBLIC (existence hidden — T11).
- `src/lib/pursuits/federation/grants.ts` — grant engine (`proposeGrant`/`accept`/`revoke`/`expireDueGrants`), `hasLiveDataGrant`, `hasActionAuthority` (separate from data consent, R24), `buildFederationViewer` (R6 richer Caller).
- `scripts/disclosure-verify.ts` — blind harness.

## Blind harness — 21 / 21
- Disclosure matrix: sponsor EXACT; PUBLIC everyone; PARTICIPANT_SHARED exact-for-participant/suppressed-for-outsider; PURSUIT_INTERNAL→generalized for participant; ORG_PRIVATE suppressed; ORG_ALLOWLIST exact only for granted org; AGGREGATED→aggregate; **outsider suppressed for every pursuit-scoped class (T11)**.
- **TD SYNNEX three-tier permanent regression (R7):** internal EXACT with the figure · partner-safe GENERALIZED with **no** figure · unauthorized SUPPRESSED (null); exact figure **absent from the serialized partner/outsider payload**; `applyDisclosure` omits suppressed items (existence not leaked).
- Grant lifecycle (R8/R28): no access pre-accept → accept grants access → **revoke blocks future access immediately** → expired grant confers no access → sweeper flips accepted-past-expiry to expired.
- **Data consent ≠ action authority (R24):** a DATA grant does not satisfy `hasActionAuthority`.
- Federation viewer: sponsor/participant flags correct.

## Gate
tsc **clean** · migration **81 applied** on `pursuit_demo` · grant RLS + disclosure resolution **proven in-harness** · flags **default OFF** · **no production backfill** · E3-A regression **19/19**.

## Deferred (by design)
- Applying `applyDisclosure` inside the participant-facing read models + widening Pursuit-child SELECT RLS to `can_see_pursuit` → **E3-H** (UI/read-model integration), so the engine is proven before it is wired app-wide.
- Per-object `disclosure_class`/`sensitivity_class` columns on facts/evidence/etc. + `source_org_id` → **E3-C** (contributions).

**E3-B complete. Proceeding to E3-C (context contributions).**
