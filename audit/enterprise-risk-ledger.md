# Enterprise Risk Ledger — PursuitOS

**Date:** 2026-08-27 · **Phase 1 of the /architect enterprise-readiness audit** · Analysis only, no code changed.

## The one blocker

**RISK-1 — RLS is present but NOT enforced: the app connects as the table owner.**
Severity: **CRITICAL (enterprise sign-off blocker).** Tracked as task #67.
**Status: FOUNDATION + PLUMBING BUILT & VERIFIED; adoption + prod flip remain.**
0058 makes RLS coherent across all 53 org-scoped tables (blind-verified as
app_rw, both directions). 0059 + `src/lib/db/tenant.ts` solve the cutover's
hard blocker — org resolution off the owner role — via a SECURITY DEFINER
`resolve_user_org()` and a `withTenant()` wrapper, verified end-to-end under
app_rw. What remains: route query sites through `withTenant` (mechanical),
then the gated prod flip (DATABASE_URL → app_rw). See RISK-1 TDD.

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
**Status: ADDRESSED** (owner-only data-subject surface on Admin + blind-verified).
- Built: `src/lib/privacy/data-subject.ts` (find / export / erase),
  `GET /api/privacy/export` (portable JSON, Art. 15/20), and an Admin
  "Privacy & data-subject rights" card with preview → typed-`ERASE` confirm.
  Erasure is anonymize-in-place in one transaction (contacts/sellers are
  FK-referenced by opportunities, motions, teams, engagement — nulling the
  identifiers removes the PII while preserving the non-personal business
  record), tenant-scoped, audited as `privacy.subject_erased` with a SHA-256
  of the email (never the address).
- Verified (`audit/RISK-2-erasure-verify.log`): seed → erase → residual PII
  in-org = 0 across contacts/sellers/messages(authored+recipient)/meeting_notes;
  a same-email decoy in another org was untouched (tenant scoping).
- Scope, stated honestly: covers the CRM personal data the tenant controls.
  It does NOT erase Supabase `auth.users` / `org_members` (a member's own
  platform login — that is account closure, handled by removing the member),
  and free-text *name* mentions inside message/note bodies are not scrubbed —
  only the email identifier is redacted (deterministic literal redaction;
  arbitrary name-in-prose scrubbing is unreliable and out of scope).
- Original PII inventory: `contacts` (name, email, phone, title), `sellers`
  (name, email), `org_members`, `messages` (from/to/cc emails),
  `meeting_notes`.

**RISK-6 — Data residency not pinned/documented.**
Severity: **MEDIUM (GDPR data-residency commitments).**
**Status: ADDRESSED (documentation).**
- The trust center now states residency explicitly: primary data (system of
  record + backups) in Supabase Postgres, **Canada / AWS ca-central-1** (a
  fact read off the deployment's connection string), and each sub-processor
  with its processing region (Anthropic/Vercel/Railway/Resend/Tavily/PDL,
  primarily US, transient — never the system of record). Notes that EU /
  in-region pinning is available to enterprise customers under a DPA.
- Not asserted as fact where unknown: sub-processor regions are stated at
  their standard/default; confirm per-vendor DPA before an EU commitment.

## Hardening gaps

**RISK-3 — DB connection template uses `sslmode=no-verify`.**
Severity: **MEDIUM.** **Status: PARTIALLY ADDRESSED (code + template);
prod confirmation + rotation still required.**
- Code: `src/db/client.ts` now supports verify-full turnkey via a pinned CA
  (`DATABASE_CA_CERT` inline or `DATABASE_CA_PATH`). When set, the pool uses
  `ssl: { ca, rejectUnauthorized: true }`, overriding the connection string.
  Deliberately opt-in: with neither env set, behavior is unchanged, so this
  ships with zero outage risk.
- Template: `.env.example` now defaults to `sslmode=verify-full` and documents
  the CA vars (local dev can use `sslmode=disable`).
- STILL NEEDS THE OWNER (can't be done safely from here, needs prod):
  (1) confirm the prod `DATABASE_URL` sslmode; (2) download Supabase's CA
  (Dashboard → Settings → Database → SSL) and set `DATABASE_CA_PATH`/`_CERT`
  on Vercel + Railway, then set the string to `verify-full`; (3) rotate the DB
  password (it has been transiting under no-verify). Verify with one real
  connection after cutover before removing the fallback.

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
