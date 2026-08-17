# Security roadmap

Status of the platform's security posture: what has been hardened, what risk is
accepted **temporarily**, and the architecture the product must reach before a
serious business runs on it. Treat the "Before first customer" section as a
release gate, not a wishlist.

## Done (hardening pass, Aug 2026)

- Baseline security headers on every response (nosniff, X-Frame-Options DENY,
  strict referrer policy, Permissions-Policy, HSTS 180d); `X-Powered-By` off.
- Timing-safe credential comparison everywhere a secret is checked: Basic Auth
  middleware (digest compare), research trigger + worker (`timingSafeEqual`),
  svix webhook signatures (already safe).
- Closed-by-default posture on machine endpoints: webhook and trigger refuse
  when their secret is unconfigured.
- CSV export formula-injection guard (leading `=`/`+`/`-`/`@` neutralized).
- `/_next/image` endpoint removed (`images.unoptimized`) — eliminates the
  sharp/libvips CVE surface without a breaking Next upgrade.
- SQL parameterized throughout; dynamic fragments are whitelist-only
  (`EDITABLE_FIELDS`, fixed timeframe numbers). HTML sinks limited to a static
  boot script and fully sandboxed `srcdoc` previews.
- `.env*` never committed (verified across full git history).
- **Data API closed (was a live exposure).** RLS enabled on all public tables
  (migration 0028) — before it, every table was readable/writable via the
  project's REST endpoint with the public anon key, verified live. The app is
  unaffected (owner connection). Every future `create table` MUST enable RLS.
- **Identity foundation (multi-tenant slice 1).** Supabase Auth sessions
  accepted by the middleware alongside Basic Auth (checked first, so demo
  deployments are unchanged); `/login` with a first-run owner-creation form
  that self-destructs once any membership exists; `org_members` (owner /
  operator / viewer) + `is_org_member()` — the predicate all future tenant
  policies key on. Requires `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in host env;
  absent → previous behavior exactly.
- **Tenant isolation in the database (multi-tenant slice 2).** Every table
  carrying `org_id` has a `tenant_isolation` RLS policy (migration 0029):
  authenticated users read/write only rows of orgs they are members of;
  NULL-org rows are invisible. Verified live: an org member sees their org's
  rows through the API, a signed-in outsider sees nothing, anon sees nothing.
  App-side, ALL org resolution goes through `currentOrgId()` — the signed-in
  user's membership, falling back to sole-org only in Basic-Auth/demo mode —
  so no screen or action hardcodes "the first organization" anymore.
- **Role-gated writes + child-table tenancy (multi-tenant slice 3).**
  Migration 0030: members read, owners/operators write, viewers are read-only;
  org_members management is owner-only; child tables (touches, population
  members, stakeholders, MEDDPICC, messages chain, partner children) carry
  join-through policies keyed on their parent's org; the shared catalog
  (company graph, taxonomy, plays, providers) is read-only-global. Verified
  live: viewer write 403, operator write 201, operator self-promotion filtered
  to a no-op. App mirrors it: requireWrite() guards all 46 mutating server
  actions; the rail chip shows the signed-in user with sign-out.
- **Admin room (multi-tenant slice 4).** `/admin`, owner-only: member
  management (invite with out-of-band temp password, role changes, removal —
  all with last-owner guards) and AI-operations observability (agent runs /
  spend / overrides, provider failures, queue depths, worker heartbeat).
- **Partnership handshake + cross-tenant audit log (multi-tenant slice 5).**
  Migration 0031: `partnerships` connect two tenants (invite code → their
  owner redeems → active → either side revokes), while `partners` rows remain
  each org's private lens so every existing screen keeps working; `list_grants`
  are the ONLY thing that crosses the boundary — field-scoped, materialized in
  the receiving org only after THEIR owner accepts, flipped off on revocation
  (severing a partnership sweeps all its grants); `audit_log` is each org's
  own ledger of every membership + cross-tenant event (both sides get mirror
  entries). All owner-driven from `/admin`. RLS: each side reads its own
  partnerships/grants/ledger; API writes refused (app-only ledger). Verified
  live end-to-end with a second tenant: 18/18 checks (handshake, field
  stripping, revocation sweep, anon/member/outsider visibility, forged-ledger
  write refused).
- **Live grant sync + deletion safety (slice 5b).** Migration 0032: accepted
  shares are no longer frozen snapshots — a "source changed" flag appears when
  the list behind a share drifts from the copy, and either side can re-sync
  (wipe + re-copy, still field-scoped). A DB trigger closes two deletion
  holes: the sharer deleting a granted source list now withdraws every
  materialized copy and writes `grant.source_deleted` to both ledgers (it
  used to cascade the grant away silently, leaving the copy live); the
  receiver deleting their copy marks the grant declined so the sharer's view
  never claims a live share that isn't. Verified live: 11/11 checks.
- **Rate limiting on auth + trigger surfaces (#66).** Fixed-window in-memory
  limiter (edge- and Node-safe). Wrong-but-presented Basic credentials: 20 /
  10 min per IP (no-header prompts and valid creds never limited); sign-in /
  owner-create / password-change actions: 10 / 5 min per IP + 10 / 15 min per
  account; research trigger + worker trigger endpoints: 10 failed auths /
  10 min per IP → 429 (correct secrets never limited). Honest caveat: counters
  are per serverless instance, so the real ceiling is limit × warm instances —
  still collapses credential stuffing; a Redis-class shared store is the
  upgrade if the app outgrows it.
- **Strict CSP with nonces (#65).** Per-request nonce minted in the
  middleware; Next reads it from the forwarded request header and stamps
  every inline script it emits, the root layout stamps the theme-boot
  script. Policy: `script-src 'self' 'nonce-…' 'strict-dynamic'`, styles
  keep `'unsafe-inline'` (the standard trade — styles can't exfiltrate),
  `img-src https:` so branded-email previews (sandboxed srcdoc iframes
  inherit the page CSP) keep remote logos, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
  Production-only (dev needs eval for react-refresh). Verified in a real
  Chromium run against a production build: 7/7 — page renders + hydrates
  with zero violations, dark-mode boot executes under the policy, and an
  injected inline event handler (the markup-injection XSS class) is
  refused and reported.
- **Next 16 upgrade (#66).** 15.3 → 16.3: clears every `npm audit` finding
  (the bundled postcss and sharp advisories) — audit is now clean. The
  gate file moved to the new `proxy.ts` convention (same code, new name);
  builds run on Turbopack. Verified the same way as the CSP: production
  build served locally, Chromium run, 7/7 including nonce injection,
  dark-mode boot, hydration, and blocked markup injection.
- **Staged CSV intake (#48, migration 0035).** Partner books are the most
  sensitive thing the platform holds, so intake became a two-step handshake
  with an explicit data-minimization contract: upload → the file is parsed
  and profiled entirely in-app (deterministic detection, no AI, no third
  party sees the content) → raw rows are staged in `import_rows` behind
  org-membership RLS → the operator confirms the column mapping and chooses
  which fields are surfaced (`selected_fields`) → commit resolves rows into
  the identity graph and a *pending* population (human review gate), and the
  staged rows are **deleted** on commit or discard (plus a 7-day sweep for
  abandoned reviews). Surfacing is enforced at read time in the mapping
  workbench: unsurfaced attributes stay stored but never reach a screen or
  the column menu. Verified end-to-end in Chromium against the local mirror
  (32 detection unit cases across 8 messy CSV shapes; upload → map → commit
  → DB ground truth; discard deletes staged rows).
- **Data resilience (#70).** Findings, 2026-08-16: the GitHub repo was
  PUBLIC (code only — a full-history secret scan found nothing beyond
  `.env.example` placeholders; flipping it private is a user-side step), and
  the Supabase project has ZERO restorable backups (Management API:
  `pitr_enabled=false`, empty backup list — free-tier behavior). Mitigation
  shipped: an independent logical backup path — `src/lib/backup/dump.ts`
  (full jsonb dump of every public table, FK-topological restore order,
  `import_rows` deliberately excluded so staged uploads never outlive their
  delete-on-decision contract) + `scripts/backup-dump.ts` /
  `scripts/backup-restore.ts` (restore refuses non-empty tables without
  `--force`, targets `TARGET_DATABASE_URL` so production can't be hit by
  accident) + a worker nightly job (BACKUP_DIR on a Railway volume,
  BACKUP_KEEP retention, `POST /backup` on-demand). Roundtrip verified
  locally: dump → schema-only scratch DB → restore, all row counts match,
  jsonb/array payloads intact. A backup file is a complete copy of tenant
  data — the volume is exactly as sensitive as the database itself.
  User-side remaining: make the repo private, upgrade Supabase for native
  daily backups/PITR, attach the Railway volume + env vars.
- **Blind overlap (#72, migration 0037 — Phase A of the unicorn roadmap).**
  "How much do our books overlap?" answered before either side reveals an
  account: a disclosure ladder (counts → bands → named) on each active
  partnership where the requester's request is their consent and the
  counterpart must approve every rung; results are computed once at approval
  by the platform as neutral broker and stored SYMMETRIC — both sides read
  the identical payload, viewer-relative framing ("% of your book") is
  computed at render from the viewer's own data. Safety property: an
  intersection can only contain accounts already in the viewer's own book,
  so a probe never reveals an unknown account — only which of yours the
  partner also has (and, at the named rung, each side's categorization).
  Every request/decision lands in BOTH orgs' audit ledgers. Verified with a
  seeded second tenant: 20/20 lib tests (ladder enforcement, self-approval
  and stranger rejection, symmetric payloads, equal ledgers) and 16/16
  Chromium checks (request → waiting → counterpart approval → results at
  every rung, incoming-probe rail badge appearing and clearing). PSI-based
  computation, where the platform itself cannot see undisclosed rows, stays
  on the roadmap as the endgame hardening.
  Remaining for a later slice: per-request scoped DB connections (the app's
  own pool still connects as table owner, so DB-level RLS backs the API path
  only; app-path scoping is enforced in code via `currentOrgId`). Deferred
  deliberately: switching `DATABASE_URL` to a non-owner role needs a staging
  environment to verify against — this sandbox cannot open raw Postgres
  connections, and a blind role switch could take down the deployment.

## Accepted risk — open items, tracked

| # | Item | Why deferred | Trigger to fix |
|---|------|--------------|----------------|
| 1 | **Credential rotation** (Supabase password + access token, Anthropic, Tavily, PDL, trigger secret, Basic Auth) — keys were shared in a chat session | Owner action pending | **Immediately**, and before the demo video circulates |
| 2 | ~~No Content-Security-Policy~~ **Done** (#65) — nonce-based, verified in-browser | — | Watch the browser console after the next deploy; report-uri collection is a later nicety |
| 3 | Rate limiter is **per-instance** (in-memory) | Real limiter shipped (#66); a shared store only matters at multi-instance scale | Move to Redis-class store when traffic warrants |
| 4 | ~~postcss/sharp advisories bundled in Next 15~~ **Done** — Next 16.3, `npm audit` clean | — | Keep the dependency-update cadence |
| 5 | **App pool connects as table owner** — DB-level RLS backs the API path; the app path relies on `currentOrgId` scoping in code | Sandbox can't verify a `DATABASE_URL` role switch (raw Postgres blocked); blind switch risks downtime | With a staging environment, before first customer |

## Before first customer: the multi-tenant architecture

The product's real shape is **tenants that connect to each other** — a
reseller, a distributor, and a vendor each running their own tenant, linked
partner-to-partner, including many-partners-to-one (a hub vendor connected to
many spokes). The current single-tenant build already prefigures this: nearly
every table carries `org_id`, lists have a `pending → approved` consent gate,
sharing is field-scoped (`selected_fields`), and every partner-facing view is
scoped by `partner_id`. The migration is an upgrade, not a rewrite.

1. **Identity & access.** Real user accounts (Supabase Auth or Auth.js),
   org membership, roles (owner / operator / viewer). Basic Auth retires.
2. **Tenant isolation.** Postgres RLS on `org_id`, driven by JWT claims —
   defense in depth even if app-layer scoping has a bug. The app's direct
   `pg` pool moves behind per-request tenant context (`set_config`) or
   Supabase clients.
3. **Partnership handshake.** Partnerships become first-class rows between
   two *tenants* (invite → accept → active → revoked), replacing today's
   partner records that live inside one org.
4. **Explicit cross-tenant grants.** Nothing crosses a tenant boundary except
   what a tenant *pushed*: a list shared to a partner is a grant (list +
   selected fields + status), visible to the counterparty only after THEIR
   approval — exactly the review flow that exists today, made two-sided.
   Grants are revocable; revocation removes downstream visibility.
5. **Spoke isolation in hub topologies.** When many partners connect to one
   vendor, partner A must never infer partner B's existence, lists, or
   overlap. Every hub rollup ("all partners") is a *hub-side* privilege;
   spoke views are always pairwise. The matrix/hub views already scope by
   `partner_id` — the isolation boundary moves from UI convention to RLS.
6. **Audit log.** Every cross-tenant read/write (list pushed, grant approved,
   field mapped, target created from shared data) recorded per tenant —
   partners will ask "what did they see and when."
7. **Operational**: rate limiting (per-IP and per-tenant), CSP with nonces,
   secrets in a managed store (Vercel/Railway env is fine; no secrets in
   code or chat), Supabase backups verified, dependency update cadence.

## Incident log

- **2026-08-12 — production outage, `EMAXCONNSESSION` (resolved).** First
  night on the production domain: `DATABASE_URL` pointed at Supabase's
  session-mode pooler (15-client ceiling); each warm Vercel instance holds a
  pool of 5, so three instances exhausted it and every page 500'd, recovering
  whenever idle connections timed out — an outage that surfaces exactly under
  load. Fixed both sides: `DATABASE_URL` moved to the transaction pooler
  (same host/user, port 6543), and the app pool became serverless-shaped
  (10s idle release, 5s fail-fast, `PG_POOL_MAX` knob). Two latent bugs
  fixed in the same pass: the pipeline advisory lock is now
  transaction-scoped (a session lock leaks onto a pooled backend forever
  under transaction mode), and /mapping no longer runs parallel queries on
  one checked-out client (pg@9 removes that). Rule going forward: serverless
  deployments use the transaction pooler; only the long-lived worker may use
  session mode or a direct connection.

## Standing rules

- Secrets live only in `.env.local` (gitignored) and host env vars — never in
  code, migrations, commits, or chat.
- Machine endpoints ship closed-by-default: unset secret = refuse, never open.
- New user-supplied strings that reach SQL are parameterized; that reach HTML
  are escaped or sandboxed; that reach CSV are formula-guarded.
