# Workstream E3-G — Federation-aware entity resolution + provider hardening (verification)

The mapping found identity resolution **not** federation-aware and carrying a real column drift: the transactions resolver queried `company_aliases.alias_value`, but the production column is `alias` — so the deterministic path would have thrown against the real schema. E3-G fixes the drift, scopes resolution to the **source org's id space** so the same external id can't collide across orgs (§14/§30), unifies the two resolvers behind one quarantine-safe entry point (§31), and opens the transaction-adjacency vocabulary to distributor inventory/renewal/marketplace signals (§21/§37).

## Delivered
- `supabase/migrations/0086_entity_resolution_source_org.sql` — `source_org_id` on `company_aliases` (+ scoped-lookup index) and on `entity_resolution_reviews` (+ open-review index); `feature_key` vocabulary comment. Additive; NULL preserves the pre-E global/first-party meaning.
- `src/lib/transactions/identity-resolve.ts` — **drift fixed** (`alias_value` → `alias`); alias lookups now scoped to `(source_org_id is null or = :sourceOrgId)`; reviews carry `source_org_id`.
- `src/lib/identity/federation-resolve.ts` — the single federation-aware entry point `resolveIdentity` (deterministic → fuzzy, org-scoped, **quarantine-safe**: unresolved ⇒ `companyId=null`), `rankCandidates` (the shared pure matcher, re-exported so there is one policy not two), and `recordAlias` (org-scoped, idempotent).
- `src/lib/transactions/features.ts` — scorer weights extended for `inventory_availability`, `renewal_window`, `marketplace_presence`, `marketplace_velocity`; still refuses to score an unresolved company (§31).
- `scripts/entity-resolution-verify.ts` — blind harness. (`scripts/routes-verify.ts` alias insert aligned to `alias`.)

## Blind harness — 11 / 11
- **Federation scoping (§14/§30):** resolution runs against the real schema; the **same external id** registered by two orgs resolves to **each org's own company** and never collides; org A's id space cannot see org B's mapping.
- **Global alias:** a null-scoped (first-party) alias resolves for any org.
- **Quarantine (§31):** an unknown external id yields `companyId=null` (never guessed) with a **source-org-scoped review row**; another org cannot see that review.
- **Idempotency:** re-registering an alias does not duplicate.
- **Provider vocabulary:** the scorer consumes inventory/renewal/marketplace features and returns a bounded 0..1 score; an unresolved / absent-signal company yields `available=false` (never invented, §31).

## Gate
tsc **clean** · migration **86 applied** (additive: `add column if not exists` + indexes + comment, **no destructive statements**) · drift fixed against the **real** schema · federation scoping + quarantine + isolation **proven under RLS** · regression **pursuit_demo:** E3-A **19/19**, E3-B **21/21**, E3-C **12/12**, E3-D **15/15**, E3-E **20/20**, E3-F **18/18**; **wsc (fresh rebuild):** routes **64/64**, experience **34/34** — the alias fix + `source_org_id` verified against the C-workstream harness too.

## Deferred (by design)
- Routing federated contribution ingest through `resolveIdentity` at the call sites, and promoting a `renewal_window` feature to a `renewal_date` fact → **E3-H**.
- Collapsing the ingest-path in-memory `resolveCompany` callers onto `rankCandidates` (kept stable this subphase to avoid destabilizing ingest) → follow-up.

**E3-G complete. Proceeding to E3-H (closed-loop integration + UX — the final subphase).**
