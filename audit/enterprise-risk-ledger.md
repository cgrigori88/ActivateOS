# Enterprise Risk Ledger — PursuitOS

**Date:** 2026-08-27 · **Phase 1 of the /architect enterprise-readiness audit** · Analysis only, no code changed.

## The one blocker

**RISK-1 — RLS is present but NOT enforced: the app connects as the table owner.**
Severity: **CRITICAL (enterprise sign-off blocker).** Tracked as task #67.

- Evidence: every one of 51 org-scoped tables and 8 cross-tenant tables
  (`partnerships`, `overlap_probes`, `joint_pursuits`, `skill_shares`,
  `evidence_shares`, `list_grants`, `warm_intro_requests`,
  `population_members`) has RLS enabled with policies — but `pg_tables.tableowner`
  for `evidence` is `postgres`, and the app's `DATABASE_URL` role is also
  `postgres`. **A table owner (and superuser) bypasses RLS entirely.**
- Impact: tenant isolation currently rests 100% on application-layer
  `org_id` / partnership filters in SQL. The database provides **no
  defense in depth.** A single query that forgets a `where org_id = $x`
  clause is an immediate cross-tenant breach, and nothing beneath the app
  layer would stop it. This is the first thing a corporate security
  reviewer or pen-tester will find and the reason they will withhold approval.
- Remediation (Phase 4 candidate): create a non-owner application role,
  `grant` it DML on the tables, connect the app as that role, and
  `alter table … force row level security` where needed. The policies
  already exist (0056 completed them), so this is a role + grant change,
  not a schema rewrite. **Recommend verifying every policy under the new
  role in a blind test before cutover.**

## Compliance blockers (privacy/legal officer)

**RISK-2 — No right-to-be-forgotten or data-export mechanism.**
Severity: **HIGH (GDPR Art. 17 & 20 blocker for EU customers).**
- No per-data-subject erasure endpoint and no subject-data export exist
  (`grep` for erasure/export/gdpr → none). Org-level delete cascades
  (60 of 61 FKs are `ON DELETE CASCADE`), but a data subject cannot be
  deleted or exported individually on request.
- PII inventory: `contacts` (name, email, phone, title), `sellers`
  (name, email), `org_members`, `messages` (from/to/cc emails),
  `meeting_notes`. All identifiable personal data.

**RISK-6 — Data residency not pinned/documented.**
Severity: **MEDIUM (GDPR data-residency commitments).**
- Region is a placeholder in config; the Supabase project region and
  sub-processor regions are not documented. The trust center lists
  sub-processors (Anthropic, Supabase, Vercel, Railway, Resend, Tavily,
  PDL) but not their processing regions — required for an EU DPA.

## Hardening gaps

**RISK-3 — DB connection template uses `sslmode=no-verify`.**
Severity: **MEDIUM.** The `.env.example` DATABASE_URL disables TLS
certificate verification; `src/db/client.ts` sets no explicit `ssl`
option, so it inherits the connection string. If prod carries the same,
the DB link is MITM-exposed. **Action: confirm prod uses `verify-full`
(or `verify-ca`); if not, fix and rotate.**

**RISK-4 — One non-cascade FK on the erasure path.**
Severity: **LOW.** `joint_playbooks.updated_by_org → organizations`
is `ON DELETE NO ACTION`; deleting an org either blocks on or orphans
this reference. Data-integrity gap in the org-deletion flow.

**RISK-5 — Global PII scan in worker code.**
Severity: **INFO / design note.** `src/lib/comms/inbound.ts:48` reads
`from messages … limit 2000` with no tenant filter to build a
message-id → thread index for inbound matching. Not a live cross-tenant
leak (it resolves to the correct thread), but a cross-tenant PII scan
that will need explicit elevated scope or per-tenant batching once
RISK-1 moves the app to a non-owner role.

## Verified clean (this pass + prior /security-audit)

- RLS **policies** exist on all 51 org tables + 8 cross-tenant tables
  (ready to enforce the moment RISK-1 is fixed).
- `npm audit --omit=dev`: 0 vulnerabilities.
- SQL fully parameterized; dynamic SET fields from static allowlists.
- ~100 server actions gated; routes + MCP auth before work; MCP
  rate-limited before dispatch.
- Prod headers (OUTSIDE-verified): CSP + nonce + strict-dynamic, HSTS,
  X-Frame-Options DENY, nosniff; all app routes/APIs 401 unauthenticated.
- BYO-model keys AES-256-GCM; API keys hashed; no PII in logs.
- Application-layer `org_id` scoping present and dense in newest libs
  (autopsy, initiatives, evidence-shares, writeback all filter by org
  or partnership) — spot-checked, consistent.

## Verdict

**One CRITICAL blocker (RISK-1) and one HIGH compliance blocker (RISK-2)
would stop a corporate cybersecurity + privacy review.** Both are
well-scoped and fixable without touching feature logic: RISK-1 is a DB
role/grant change against policies that already exist; RISK-2 is a new
erasure/export surface over the existing cascade graph. RISK-3 needs a
prod-config confirmation. Everything else is INFO/LOW.
