# Workstream E3-C — Context contributions (verification)

The durable provenance object beneath the contribution modes — "org X contributed information Y, under policy Z, for purpose P, to Pursuit Q" (R4) — with the no-central-custody constraint (R5) and provenance-retained/disclosure-controlled invariant (R3).

## Delivered
- `supabase/migrations/0082_context_contributions.sql` — `context_contributions` (source_org_id, mode ∈ RAW/DERIVED/FEDERATED/ASSERTED/AGGREGATED, disclosure+sensitivity classes, purpose+scope+consent_grant_id, `raw_stored`/`derived_only` for R5, retention/expiry, `revocation_state` for R28, event vs knowledge time for R12). `facts.source_org_id` + `facts.contribution_id` (provenance boundary). Transaction mode CHECK widened to the full 5-value set. RLS: visible via `can_see_pursuit` or source-org; written only by the source org.
- `src/lib/pursuits/federation/contributions.ts` — `recordContribution` (no-custody defaults per mode), `revokeContribution`, `contributionsForPursuit`, `liveContributionsForPursuit` (revocation/expiry-filtered usable set), `linkFactToContribution`, `impliesRawCustody`.
- `src/lib/transactions/provider.ts` — `ProviderMode` extended to the 5 modes (R5).
- `scripts/contributions-verify.ts` — blind harness.

## Blind harness — 12 / 12
- **No-central-custody (R5):** RAW implies custody; FEDERATED/ASSERTED/AGGREGATED do not; a FEDERATED distributor contribution records with `raw_stored=false`/`derived_only=true`; all 5 modes accepted.
- **Provenance retained / disclosure controlled (R3):** the contribution edge (source_org_id) is always known and visible to an ACTIVE participant, while the VALUE disclosure is governed independently by the E3-B engine; a non-participant outsider sees no contributions.
- **Revocation (R28):** a revoked contribution leaves the live/usable set but its history is preserved (state REVOKED).
- **Fact provenance boundary (R4):** a Fact binds to its originating contribution + source org.
- Cross-tenant write refusal (an org cannot claim another org as the contribution source).

## Gate
tsc **clean** · migration **82 applied** · RLS + provenance/disclosure separation **proven** · flags **default OFF** · **no production backfill** · regression: E3-A **19/19**, E3-B **21/21**.

**E3-C complete. Proceeding to E3-D (governed Skill boundary).**
