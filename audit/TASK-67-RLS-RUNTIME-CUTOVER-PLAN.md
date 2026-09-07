# Task #67 — RLS runtime cutover: execution plan

**Written:** 2026-09-07
**Base commit:** `97e975f0d9895c54bfc49cdcc24924d6ac58e796` (Wave 6D)
**Status:** PLAN ONLY. Nothing in this document has been executed. No Supabase
role, grant, policy, schema object, migration, `DATABASE_URL`, Vercel variable,
deployment, or production branch was modified to produce it.

**Scope:** the synthetic demo deployment `PursuitOS-demo` / `demo.pursuitos.io`
only. `app.pursuitos.io` is out of scope.

---

## 1. Current state

Verified read-only on 2026-09-07 against the live demo project.

### 1.1 Identity

| | |
|---|---|
| Supabase project | `pursuitos-demo` · ref `qifatlqxfuhwrwvpbwsc` · org `lvnwjnvkoekicyfrebol` · `ca-central-1` · PG 17.6.1.166 |
| Environment identity row | `environment=demo`, `is_synthetic=true`, label `pursuitos-demo — TD SYNNEX walkthrough` |
| Canonical world | 3 orgs · 14 companies · 19 opportunities · **11 open** · **$8,040,000 open** · 14 pursuits (all DEMO) |
| Vercel project | `PursuitOS-demo` · `prj_mMYSZIaIQPwkqRrhKPcV7HbhdpXc` · Next.js · Node 24.x |
| Production branch | `claude/activateos-platform-review-xzkgmd` — head `97e975f0` (Wave 6D) |
| Last observed serving SHA | `66f72f61` (Wave 3) — **differs from branch head; must be re-established before cutover** |
| Runtime DB role | `postgres` |
| Migrations | 102 applied = 102 on disk, filename sets identical, **zero drift** |

### 1.2 Database posture

| | |
|---|---|
| `public` ordinary tables | 152 |
| RLS enabled | **152 / 152** |
| `FORCE ROW LEVEL SECURITY` | **152 / 152** |
| Tables with ≥1 policy | 151 (`schema_migrations` is deny-all by design) |
| Tables carrying `org_id` | 85 |
| Org-scoped tables with `app_rw` predicate `is_org_member(org_id)` | **85 / 85** |
| Org-scoped tables with an unscoped `app_rw` policy | **0** |
| Total policies | 375 — 154 for `app_rw`, 220 for `authenticated`, 1 for `public` |

### 1.3 `app_rw` role

| Attribute | State |
|---|---|
| exists | ✅ (migration `0058`) |
| `LOGIN` | ❌ **NOLOGIN — the only blocker** |
| password | set, no expiry, value unknown to this audit |
| `BYPASSRLS` | no (correct) |
| `INHERIT` | no — irrelevant; all grants are direct |
| `CONNECT` on database | ✅ |
| `USAGE` on `public` | ✅ |
| `SELECT` / `INSERT` | **152 / 152** |
| `UPDATE` / `DELETE` | 149 / 152 — the 3 exclusions are the append-only ledgers `change_ledger`, `governed_action_invocations`, `pursuit_overrides`. Deliberate. |
| `EXECUTE` on public functions | **126 / 126**, including `app_current_org`, `is_org_member`, `resolve_user_org`, `resolve_api_key` |
| sequences / views needing grants | 0 / 0 (all-UUID PKs, no public views) |

**Grants are complete. No grant changes are required** — subject to the single
preflight check in §5.2 on default privileges for future tables.

---

## 2. Root cause

On Supabase, `postgres` is **not** a superuser (`rolsuper = false`) but carries
**`BYPASSRLS`**. `BYPASSRLS` skips row-level security entirely and therefore also
overrides `FORCE ROW LEVEL SECURITY`. The application connects as `postgres`.

Consequently:

- All 375 policies are inert on the application path.
- Tenant isolation today rests **solely** on application-layer `where org_id`
  predicates, gated by `requireWrite` / `requireOwner` / `currentOrgId`.
- A single query that forgets its `org_id` predicate is an immediate cross-tenant
  read with no second line of defence. One such defect is already known:
  `src/lib/pursuits/read-models/detail.ts:71-72` selects
  `why_now, org_id, account_id from pursuits where id = $1` with no `org_id`
  predicate.

The database side of the fix is already built. `withTenant()` sets
`app.org_id`; `is_org_member(org)` honours it via
`app_current_org() → current_setting('app.org_id', true)`. The only thing making
it inert is the connecting role. **The fix is a role change, not a schema change.**

Because `BYPASSRLS` beats `FORCE`, the belt cannot be switched on by tightening
tables. Conversely, this is exactly what makes rollback clean: pointing
`DATABASE_URL` back at `postgres` restores the current behaviour with no DDL.

---

## 3. Exact application changes

### 3.1 Direct `getPool()` call-site audit

Six references to `getPool()` exist. Two are infrastructure (the definition and
the `withTenant` wrapper itself). **Three are real application call sites.**

| file | function | operation | data touched | tenant-sensitive? | current behavior | required change |
|---|---|---|---|---|---|---|
| `src/db/client.ts:85` | `getPool` | pool factory | — | n/a | defines the shared tenant pool | rename to `getTenantPoolUnsafe()`; export a guarded accessor (§3.3) |
| `src/lib/db/tenant.ts:58` | `withTenantOrg` | `connect()` + `BEGIN` + `set_config` | all tenant tables | **yes — by design** | correct: explicit org, GUC is transaction-local | none, plus the echo assertion in §3.3 |
| `src/lib/db/tenant.ts:87` | `withTenant` | `connect()` + `BEGIN` + `resolve_user_org` + `set_config` | all tenant tables | **yes — by design** | correct: fails closed with `"No organization in scope"` if no org resolves | none, plus the echo assertion in §3.3 |
| `src/app/api/mcp/route.ts:128` | `POST` → `resolveKey` | read API key → org | `api_keys` via `resolve_api_key()` | **bootstrap** — org is not yet known | **already cutover-safe.** `resolve_api_key()` (migration `0062`) is `SECURITY DEFINER`, so it works under `app_rw`, which cannot read `api_keys` directly. Per-request work after this point already runs through `withTenantOrg`. | switch the accessor to `getOwnerPool()` for clarity and to remove the tenant pool from a pre-tenant path. Functionally optional; recommended. |
| `src/app/sources/page.tsx:14` | `SourcesPage` | `select … from signal_sources s left join evidence e …` | `signal_sources` (**global**, `USING(true)`) LEFT JOIN `evidence` (**org-scoped**, `is_org_member(org_id)`) | **YES — tenant-scoped read** | runs on the raw tenant pool with **no `app.org_id` set** | **must be wrapped in `withTenant`.** Under `app_rw` with no GUC every `evidence` row is invisible, so `total`, `verified`, `quarantined`, `rejected` and `last_seen` all silently become 0/null while the page still renders. This is the exact silent-empty failure mode. |
| `src/app/provider-health/page.tsx:35` | `ProviderHealthPage` → `loadProviderHealth` | `select … from provider_runs group by provider_id` | `provider_runs` — **carries `org_id`** | **YES — tenant-scoped read** | runs on the raw tenant pool with **no `app.org_id` set** | **must be wrapped in `withTenant`.** Under `app_rw` every provider would report zero runs, zero cost, `never_run` state and no last error — a wholly plausible-looking but entirely false health board. |

**Two genuine silent-empty regressions found.** Neither would throw; both would
render a confident, wrong page. This is precisely why the cutover cannot be a
single env-var change.

Also queued, though outside the strict `getPool()` set:

| file | issue | required change |
|---|---|---|
| `src/lib/pursuits/read-models/detail.ts:71` | `select why_now, org_id, account_id from pursuits where id = $1` — no `org_id` predicate | this is the known tenant-isolation defect. Under `app_rw` RLS would close it automatically, but the predicate should be added anyway so the app layer and the DB layer agree. Fixing it is a **precondition** for the §8.1 certification test to mean anything. |

### 3.2 `getOwnerPool()` is already built and already adopted

`getOwnerPool()` exists in `src/db/client.ts:149` and is **inert** while
`DATABASE_URL_OWNER` is unset — it returns the tenant pool. 15 files and
28 call sites already use it, covering exactly the paths that legitimately cannot
be tenant-scoped:

| Area | Files | Why owner |
|---|---|---|
| Login / first-owner | `src/app/login/actions.ts`, `src/app/login/page.tsx` | no caller org exists yet; reads `auth` schema |
| Guest join | `src/app/join/[code]/actions.ts` + `page.tsx`, via `lib/partnerships/guest.ts` | mints a brand-new org — a tenant-scoped role cannot insert an org it is not yet a member of |
| Admin / ops | `src/app/admin/actions.ts` + `page.tsx`, `src/app/ops/page.tsx` | member management, `auth.users` |
| Research trigger | `src/app/api/research/route.ts` | intentionally cross-tenant system work |
| Inbound email webhook | `src/app/api/webhooks/resend/route.ts` | org derived from the thread, not a session |
| Worker | `src/worker/index.ts` (10 sites) | cross-tenant by design |
| Backfills / identity | `scripts/routes-backfill.ts`, `backfill-facts.ts`, `backfill-pursuits.ts`, `environment-identity.ts` | administrative |

**Verified:** no tenant-pool path inserts into `organizations`. The two
`insert into organizations` sites — `lib/partnerships/guest.ts:54` (via the join
actions) and `lib/ingest/ingest-accounts.ts:167` (called only from
`src/worker/index.ts`) — both run on the owner pool. This matters for §4.

### 3.3 Fail-loud tenant-context assertion

**Requirement.** RLS fails *closed* when `app.org_id` is absent —
`is_org_member()` evaluates `false OR NULL` → `NULL`, which RLS treats as false.
That is safe but silent: a forgotten `withTenant` returns **zero rows, not an
error**. The mechanism below converts silence into a loud failure without
weakening RLS, without any unrestricted fallback, and without disturbing tables
that are intentionally global.

Four layers, cheapest first. **None of them touches a policy.**

**(a) Keep the existing guard.** `withTenant` already throws
`"No organization in scope — refusing to run a tenant query unscoped."` when no
org resolves. That covers the intended path. No change.

**(b) Echo-assert the GUC — zero extra round-trips.** `withTenant` /
`withTenantOrg` already run `select set_config('app.org_id', $1, true)`.
`set_config` *returns the value it set*. Read it and assert it equals `orgId`:

```ts
const { rows } = await db.query<{ v: string }>(
  `select set_config('app.org_id', $1, true) as v`, [orgId]);
if (rows[0]?.v !== orgId) {
  throw new Error("Tenant context was not applied — refusing to run the transaction.");
}
```

Cost: none — same statement, same round-trip. This catches the one plausible way
the GUC could vanish on the *intended* path: a pooler in transaction mode
mishandling a transaction-local setting. It converts that from silent-empty into
an immediate, named failure.

**(c) Make the tenant pool structurally unusable outside `withTenant`.** This is
the layer that actually eliminates the class of bug found in §3.1.

- Rename `getPool()` → `getTenantPoolUnsafe()`, used only by `src/lib/db/tenant.ts`.
- Every other consumer must reach the database through `withTenant`,
  `withTenantOrg`, or `getOwnerPool()`.
- Optionally, have the renamed accessor return a Proxy whose `.query()` throws
  outside the wrapper, so a stray call fails at the first statement with a clear
  message rather than returning `[]`.

This makes "forgot the tenant context" a *compile-or-first-call* failure instead
of a data-correctness failure. It is a mechanical, reviewable change and its
blast radius is exactly the three sites in §3.1.

**(d) A regression gate, so it stays fixed.** Add to the verify suite:

- a grep/lint gate asserting no `getTenantPoolUnsafe()` reference outside
  `src/lib/db/tenant.ts`;
- a **canary test** that, connected as `app_rw` with **no** `app.org_id` set,
  runs a known tenant query and asserts it **throws** rather than returning `[]`.

**Explicitly rejected: making `is_org_member` raise.** Pushing the assertion into
the policy predicate would be loud at exactly the right point, but
`is_org_member` is `LANGUAGE sql STABLE` and therefore inlinable; converting it
to PL/pgSQL to `raise` would defeat inlining and regress query plans across all
85 org-scoped tables on every row. The cost is not worth it when (b) and (c)
achieve the same outcome at zero runtime cost. **Do not change `is_org_member`.**

---

## 4. The two intentional global-scope decisions

Four tables carry an `app_rw` policy of `USING (true)`, plus 24 others that are
uncontroversially global reference data (taxonomy, products, providers, score
versions, play templates, fact predicates, partner capability graph). None of the
85 `org_id`-carrying tables is unscoped. The four worth an explicit decision:

### 4.1 `companies`, `company_aliases`, `company_hierarchies` — **keep global**

**Recommendation: keep as a globally readable and writable shared catalog. No change.**

Rationale. A shared company graph is not an accident of the schema, it is the
product. Two tenants both selling into "Umbrella Health Systems" must resolve to
the same `companies` row, or overlap detection, coverage mapping, partner
matching and entity resolution all stop working — those features *are* the
comparison across tenants. The tenant-private layer sits on top of the shared
identity, not inside it: `evidence`, `opportunities`, `pursuits`,
`propensity_scores` and `partner_accounts` all carry `org_id` and all resolve
through `is_org_member(org_id)`.

The rule worth writing down: **company *identity* is global; company
*intelligence* is tenant-scoped.** `companies` holds `legal_name`,
`normalized_name`, `industry`, `country` — no PII, no commercial signal. Nothing
in these three tables discloses that a given tenant is working an account.
`companies` additionally carries `catalog_read SELECT USING (true)` for
`authenticated`, which is consistent with the same decision.

Residual risk, accepted and recorded: a tenant can UPDATE a `companies` row
another tenant created — normalising a name, correcting an industry. That is
shared-catalog write contention, not a disclosure. If it becomes a problem the
answer is to route writes through a normalisation path, not to shard the catalog.

### 4.2 `organizations` — **tighten writes, keep reads global**

**Recommendation: split the single `ALL USING (true)` policy into a global
SELECT and a member-scoped write.** This is the one change worth making.

Current: `organizations_rw ALL TO app_rw USING (true) WITH CHECK (true)` — under
`app_rw`, any tenant path could `UPDATE` or `DELETE` **any other tenant's
organization row**. A bug in an org-settings mutation could rename or delete
another tenant's workspace. That is a genuine, if narrow, gap that the cutover
would otherwise carry forward unchanged.

Reads must stay global. Scoping SELECT to `is_org_member(id)` would break partner
name rendering in the Partner Hub, joint pursuit rooms, the settlement ledger and
the guest join flow — all of which legitimately display another org's name. The
correct read predicate is not "member" but "member or partner-visible", which is
more surface than this cutover should introduce. Organization *names* are already
mutually visible to partners by design; keeping SELECT global changes nothing
about what is disclosed today.

Proposed shape, for a **separate migration gated behind its own review** — not
part of the cutover itself:

```sql
drop policy if exists organizations_rw on public.organizations;
create policy organizations_ro on public.organizations
  for select to app_rw using (true);
create policy organizations_rw on public.organizations
  for all to app_rw
  using (is_org_member(id)) with check (is_org_member(id));
```

This is safe because **no tenant-pool path inserts into `organizations`** (§3.2,
verified): guest-org minting and CSV-intake org creation both run on the owner
pool, which bypasses RLS. A member-scoped `WITH CHECK` would otherwise block
INSERT, since a brand-new org has no members yet.

**Sequencing:** do the cutover first, prove it green, then land this as a small
follow-up. Bundling a policy change into the role change would make a failure
ambiguous.

---

## 5. Database cutover

### 5.1 The only DDL required

```sql
-- connected as postgres (owner), against the demo project only
alter role app_rw with login password '<generated — see 5.3>';
```

That is the whole database change. No grants, no policies, no schema, no data.

### 5.2 Preflight to run before that statement

1. **Default privileges for future tables.** Three `pg_default_acl` entries
   mention `app_rw`. Confirm they cover `public` for SELECT/INSERT/UPDATE/DELETE
   so that migration `0103` and later do not create tables `app_rw` cannot touch:
   ```sql
   select defaclobjtype, array_to_string(defaclacl, ',') from pg_default_acl;
   ```
   If coverage is incomplete, add the missing `ALTER DEFAULT PRIVILEGES` — and
   note that this is the one legitimate grant change, contrary to the "no grant
   changes" finding, which applies to *existing* objects only.
2. **Re-confirm the grant counts** from §1.3 immediately before the cutover; they
   were verified on 2026-09-07 and any migration since then could change them.
3. **Re-confirm `is_org_member` is still `LANGUAGE sql STABLE`** (inlinable).
4. **Re-establish the serving SHA** via `/api/build` (§1.1 divergence).

### 5.3 Password generation and handling

Generate on the operator's own machine, never in an agent session, never in CI:

```sh
openssl rand -base64 39 | tr -d '\n'
```

- Percent-encode it before embedding in a URI (`+`, `/`, `=` are all legal
  base64 output and all significant in a connection string). Generating
  URL-safe output instead — `openssl rand -hex 32` — avoids the problem entirely
  and is the recommended form.
- Store in the team password manager **before** running the `ALTER ROLE`.
- Paste into the Vercel env store directly. It must never appear in: a shell that
  logs history, a Git-tracked file, `.env` committed by accident, a CI log, a
  chat transcript, or an agent-visible environment.
- The `ALTER ROLE` statement itself is logged by Postgres in some
  configurations — prefer running it via `psql` with `\set` from a prompt, or
  accept the risk knowingly on this synthetic-only project.

### 5.4 Connection-string forms

| Purpose | Form |
|---|---|
| Vercel (serverless) — **use this** | `postgresql://app_rw.qifatlqxfuhwrwvpbwsc:<pw>@aws-0-ca-central-1.pooler.supabase.com:6543/postgres` |
| Railway worker (long-lived) | `postgresql://app_rw.qifatlqxfuhwrwvpbwsc:<pw>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres` |
| Direct / psql testing | `postgresql://app_rw:<pw>@db.qifatlqxfuhwrwvpbwsc.supabase.co:5432/postgres` |

Note the pooler username form is `<role>.<project-ref>`, not the bare role.

### 5.5 Transaction-pooler consideration — the one that must be tested, not assumed

`withTenant` sets the GUC with `set_config(..., is_local => true)` inside an
explicit `BEGIN … COMMIT`. Supavisor's transaction mode pins one server
connection for the duration of a transaction, so a transaction-local setting is
safe there. `sessionOrgId()` runs `select public.resolve_user_org($1)` inside
that same transaction, which is also fine.

The failure mode would be any code that sets the GUC *outside* a transaction —
both wrappers `BEGIN` first, so by inspection there is none. **This must still be
proved empirically against port 6543 before production cutover** (§7 step 6),
because the cost of being wrong is every tenant query silently returning zero
rows. The §3.3(b) echo assertion is the tripwire that would catch it loudly.

### 5.6 SSL

`DATABASE_CA_CERT` is already set on `PursuitOS-demo`, which turns on
`rejectUnauthorized: true` against the system roots plus the Supabase Root 2021
CA embedded in `src/db/client.ts`. The host and its certificate chain do not
change at cutover — only the username does. **No SSL change required.** Do not
attempt to move the CA into an env var; that previously caused an outage through
newline mangling.

One nuance carried over from `audit/RISK-1-CUTOVER-STATE.md`: a `DATABASE_URL`
whose query string says `sslmode=no-verify` is still verified, because the `ssl`
object built by `sslOption()` overrides the connection string. Preserve whatever
`sslmode` the current value carries when constructing the `app_rw` URL rather
than "fixing" it as part of this cutover — changing two things at once makes a
TLS failure indistinguishable from a role failure.

### 5.7 Relationship to the earlier RISK-1 documents

`audit/RISK-1-CUTOVER-STATE.md`, `audit/PRODUCTION-RLS-STATUS.md` and
`audit/RISK-1-rls-enforcement-TDD.md` describe an **earlier, different Supabase
project** (ref `sxtwrrckvlohottrdsbr`) and are explicitly marked
"UNKNOWN / REQUIRES OPERATOR VERIFICATION". They are useful background on the
TLS work and on the shape of the intended cutover, but **none of their state
claims apply to `pursuitos-demo` (`qifatlqxfuhwrwvpbwsc`)**. Everything in §1 of
this document was re-verified read-only against the demo project on 2026-09-07
and supersedes them for that project.

---

## 6. Vercel cutover

### 6.1 Variables

| Variable | Action | Value source |
|---|---|---|
| `DATABASE_URL_OWNER` | **ADD** — Production and Preview | the *current* value of `DATABASE_URL` (the `postgres` connection) |
| `DATABASE_URL` | **CHANGE** — Production and Preview | the new `app_rw` connection string (§5.4) |
| `PG_OWNER_POOL_MAX` | optional | defaults to 3; the owner pool is now a second pool, so total connections per instance become `PG_POOL_MAX + PG_OWNER_POOL_MAX`. Re-check against the pooler ceiling. |

> **The single biggest hazard in this cutover.** Changing `DATABASE_URL` without
> first setting `DATABASE_URL_OWNER` breaks **login, guest join, admin, ops, the
> research trigger, the inbound email webhook, and the entire worker** — 28 call
> sites that legitimately need the owner and which today silently fall back to
> the tenant pool because `getOwnerPool()` is inert. `DATABASE_URL_OWNER` must be
> set **first, in its own deploy**, and proved before `DATABASE_URL` moves.

### 6.2 Order and scope

1. Set `DATABASE_URL_OWNER` = current `DATABASE_URL` value, on **Preview and
   Production**. Redeploy. This is functionally a no-op — the same URL, now
   reached through a second pool — which is exactly what makes it a safe way to
   prove the variable is read and the second pool works.
2. Change `DATABASE_URL` on **Preview only**. Redeploy preview. Certify (§8).
3. Change `DATABASE_URL` on **Production**. Redeploy. Certify (§8).

Preview first is not optional. It exercises the same database with the same role
under the same runtime, at zero cost to the demo domain.

### 6.3 Redeployment

Vercel bakes environment variables at **build** time. Every step above requires a
new build; editing a variable alone changes nothing about the running deployment.

### 6.4 Proving the deployment actually uses `app_rw`

"The pages load" is not proof — under `app_rw` with a missing GUC the pages would
also load, with silently empty data. Add an objective fingerprint:

Extend `GET /api/build` (`src/app/api/build/route.ts`) with a `database.role`
field sourced from `select current_user`, wrapped so a database failure yields
`"unavailable"` rather than breaking the endpoint — the header comment there
deliberately avoids depending on a DB read, and that property must be preserved.

Then:

```sh
curl -s -H "x-ops-token: $OPS_FINGERPRINT_TOKEN" https://demo.pursuitos.io/api/build \
  | jq '{commit, branch, role: .database.role, ref: .database.projectRef}'
```

**The cutover is not complete until that reads `"role": "app_rw"`** on the
production deployment, alongside the expected commit and project ref.

### 6.5 Preserving rollback without exposing anything

The rollback value is the `postgres` connection string — and after step 6.2.1 it
is already sitting in the Vercel env store as `DATABASE_URL_OWNER`. Rollback is
therefore "copy `DATABASE_URL_OWNER` into `DATABASE_URL`", performed entirely
inside the Vercel UI, with the value never displayed, printed, or passed through
any log or transcript.

---

## 7. Staged cutover sequence

The order below moves every reversible step ahead of every irreversible one, and
puts all early risk on a disposable database.

| # | Step | Gate to pass before continuing |
|---|---|---|
| 1 | Fix the three application call sites (§3.1): wrap `sources` and `provider-health` in `withTenant`; move MCP key resolution to `getOwnerPool()`. Add the `org_id` predicate in `detail.ts:71`. | code review |
| 2 | Add the fail-loud assertion (§3.3 b–d): echo-assert, rename the accessor, add the lint gate and the canary test. | code review |
| 3 | Run the **full regression matrix (§9) under the current `postgres` connection**. | everything green — this is the baseline the cutover must reproduce |
| 4 | On a **local / disposable Postgres**: create an `app_rw` equivalent with login, point the app at it, and re-run the full matrix. | everything green as `app_rw`, locally |
| 5 | Preflight §5.2 against the hosted demo DB. | all four checks pass |
| 6 | `alter role app_rw with login password …` on the hosted demo DB. Test **directly with `psql` as `app_rw`** through port **6543**, running the §8.1 DB-level tests by hand. | GUC honoured through the transaction pooler; §8.1 all pass |
| 7 | Vercel: add `DATABASE_URL_OWNER` (Preview + Production). Redeploy both. | app behaviour unchanged; `/api/build` still healthy |
| 8 | Vercel: change `DATABASE_URL` on **Preview**. Redeploy preview. | `/api/build` reports `role: app_rw`; §8.2 browser certification passes on preview |
| 9 | Vercel: change `DATABASE_URL` on **Production**. Redeploy. | `/api/build` on `demo.pursuitos.io` reports `role: app_rw` |
| 10 | Full live tenant-isolation certification (§8) against `demo.pursuitos.io`. | §8 matrix complete |
| 11 | Follow-up, separately reviewed: the `organizations` policy split (§4.2). | — |

**Why this differs from the obvious sequence.** Three deliberate changes:

- **Step 4 comes before step 6.** Enabling `app_rw` login on a disposable local
  database first means the entire suite is proved as a non-owner role before the
  hosted project is touched at all. All the discovery pain lands on a throwaway.
- **Step 7 is its own deploy.** Setting `DATABASE_URL_OWNER` to the *same* value
  the app already uses is a no-op by design, which makes it a free proof that the
  owner pool activates cleanly. It also removes the §6.1 hazard from the moment
  that matters.
- **Step 1 comes before everything.** The two silent-empty pages must be fixed
  before the role changes, or the cutover will look like a data-loss incident.

---

## 8. Security certification

The cutover is not complete because pages render. It is complete when the
following are all demonstrated.

### 8.1 Database level — as `app_rw` via `psql`, port 6543

| # | Test | Expected |
|---|---|---|
| D1 | `select current_user` | `app_rw` |
| D2 | `select rolbypassrls from pg_roles where rolname = current_user` | `false` |
| D3 | With **no** `app.org_id`: `select count(*) from pursuits` | `0` rows (fails closed) |
| D4 | With **no** `app.org_id`, through the application wrapper | **throws** — never returns `[]` (this is the §3.3 canary) |
| D5 | `set_config('app.org_id', '<Vertex org id>', true)` then `select count(*) from pursuits` | only Vertex-owned rows |
| D6 | Same session: `select * from pursuits where id = '<Meridian-owned pursuit uuid>'` | **0 rows** |
| D7 | Same session: `update pursuits set why_now='x' where id = '<Meridian pursuit>'` | `UPDATE 0` |
| D8 | Same session: `insert into pursuits (org_id, …) values ('<Meridian org>', …)` | **rejected** by `WITH CHECK` |
| D9 | Same session: `select count(*) from evidence`, `opportunities`, `propensity_scores`, `revenue_motions` | Vertex-only counts, non-zero |
| D10 | A participant-authorized cross-tenant pursuit, read as the partner org | visible **via `can_see_pursuit`**, per the federation model — not via `is_org_member` |
| D11 | `insert into change_ledger …` then `update change_ledger …` | insert succeeds, update **denied** (append-only preserved) |
| D12 | `select count(*) from taxonomy_nodes`, `products`, `signal_sources` | unchanged, non-zero (global tables still readable) |
| D13 | GUC leakage: set the GUC in one transaction, `COMMIT`, then query in a new transaction without setting it | 0 rows — `is_local` scoping held; nothing leaked to the next pooled checkout |

### 8.2 Application level — browser, against the cut-over deployment

| # | Test | Expected |
|---|---|---|
| A1 | Signed in as a **Vertex-only** user, navigate directly to a **Meridian-owned** pursuit UUID | not found / no record — **not** a rendered page with another tenant's data |
| A2 | Same user, a Vertex-owned pursuit | loads fully, unchanged from the pre-cutover baseline |
| A3 | A **participant-authorized** cross-tenant pursuit | behaves per the federation/disclosure policy — visible at the granted disclosure level, no more |
| A4 | Attempt a write against a record outside the tenant (form submission or server action) | rejected, with an error — **not** a silent no-op |
| A5 | Governed mutation (propose → approve → apply) within tenant | still works end to end |
| A6 | Sponsor / Partner disclosure ladder (counts → bands → named) | unchanged; mutual-approval gate still enforced; audit rows still written |
| A7 | Ask / readability: request something referencing an inaccessible record | the record is not exposed; unreadable links are dropped silently per `filterReadableRecordHrefs` |
| A8 | **Today, Queue, Goals, Motions, Pipeline, Accounts, Sources, Provider health** | all populated, and matching the §1.1 canonical facts — 11 open opportunities, $8,040,000 open, $3,361,500 weighted, $1,850,000 motion value |
| A9 | **Sources** page specifically | evidence totals / verified / quarantined / last-seen are **non-zero** (the §3.1 regression) |
| A10 | **Provider health** page specifically | run counts, costs, last-run times and states are **populated** (the §3.1 regression) |
| A11 | Login, guest join via `/join/[code]`, admin, ops | all work — proves `DATABASE_URL_OWNER` is correctly wired |
| A12 | MCP surface with a valid API key | resolves its org and returns scoped results |
| A13 | Inbound email webhook | still resolves its thread's org and writes |
| A14 | `GET /api/build` | `role: app_rw`, expected `commit`, expected `projectRef` |

**A8/A9/A10 are the anti-silent-empty gate.** A cutover that passes A1–A7 and
fails A8–A10 has traded a disclosure bug for a data bug and must be rolled back.

---

## 9. Regression requirements

The Wave 6D locally certified baseline must be reproduced, not assumed. Run the
full matrix twice — once at step 3 under `postgres`, once at step 4 under a local
`app_rw` — and diff the results.

| Group | Suites |
|---|---|
| `FRESH` (5) — disposable DB only | `experience`, `facts`, `governance`, `pursuit`, `routes` |
| `SEEDED` (13) — seeded DB | `append-only`, `canonical-microloop`, `interpret`, `lifecycle-acceptance`, `lifecycle-query`, `motion-intel`, `outcome-bridge`, `partner-intel`, `route-persistence`, `scope`, `stakeholder-intel`, `team-motion`, `value-case` |
| `EITHER` (14) — disposable by default; also run with `EITHER_ON_SEEDED=1` | `closed-loop`, `contributions`, `disclosure`, `entity-resolution`, `federation`, `governed-mutation`, `isolation`, `observability`, `ops`, `outbox`, `outcomes`, `recompute`, `recompute-recovery`, `tenant-flags` |
| `DEPLOYMENT_ONLY` (1) | `migrations-only` |
| Static | `npm run typecheck`, `npm test`, `next build` |
| Manual | authenticated route crawl over every room |
| Demo integrity | `scripts/seed-demo-world.ts` `verify()` + `scripts/demo-manifest.ts` digest |

Suites carrying the most cutover signal: `isolation`, `federation`, `disclosure`,
`scope`, `governed-mutation`, `outcomes`, `tenant-flags`, `interpret`.

**Never run a `FRESH` suite against the hosted demo database** — they commit
fixtures and would pollute the canonical world.

### 9.1 New tests this task must add

| Test | Class | Asserts |
|---|---|---|
| `tenant-context` canary | `EITHER` | as `app_rw` with no `app.org_id`, a tenant query **throws** rather than returning `[]` |
| accessor lint gate | static | no reference to `getTenantPoolUnsafe()` outside `src/lib/db/tenant.ts` |
| GUC echo assertion | unit | `withTenant` throws when `set_config` does not echo the expected org |
| pooler GUC survival | `EITHER` | the transaction-local GUC survives a transaction through port 6543 |
| owner-pool separation | `EITHER` | with `DATABASE_URL_OWNER` set, `getOwnerPool()` returns a distinct pool connecting as the owner |
| direct-UUID isolation | `EITHER` | the `detail.ts:71` read model refuses a foreign-org pursuit at both the app and DB layers |

---

## 10. Rollback

### 10.1 Triggers — any one of these, no debate at the time

- Any room renders with materially empty data (Today, Pipeline, Accounts,
  Motions, Goals, Queue, Sources, Provider health).
- Any write path fails that worked before.
- Login, guest join, admin or ops breaks.
- A database function errors under `app_rw` where it did not under `postgres`.
- Unexpected policy denials on a same-tenant read or write.
- Elevated error rate, connection saturation, or latency regression on
  `demo.pursuitos.io`.
- `/api/build` reports a role other than `app_rw` after a cutover deploy, or
  fails to respond.

### 10.2 Procedure

1. **Vercel → `PursuitOS-demo` → Settings → Environment Variables.** Set
   `DATABASE_URL` (Production, and Preview if it was cut over) back to the value
   held in `DATABASE_URL_OWNER`. The value never leaves the Vercel UI.
2. **Redeploy.** Env vars bind at build time — the running deployment will not
   change until a new build completes. Promoting the last known-good deployment
   is faster and equally valid, provided it was built with the pre-cutover env.
3. **Leave `DATABASE_URL_OWNER` in place.** It is now the rollback value and it
   is also correct for the next attempt.
4. **Leave `app_rw` `LOGIN` enabled.** Disabling it destroys the ability to
   diagnose what went wrong, and it is inert once nothing connects as it. Revoke
   it only if the credential is believed compromised — and then rotate rather
   than disable.
5. **Verify:** `/api/build` reports the owner role and the expected commit; then
   re-run §8.2 A2, A5, A8, A11.
6. **Confirm data integrity.** Re-run `scripts/seed-demo-world.ts` `verify()` and
   the `demo-manifest` digest, and re-check the §1.1 canonical facts.

### 10.3 Rollback is non-destructive by construction

No step drops a role, a policy, a grant, a table, or a row. The cutover changes
**which user connects**, nothing about what exists. `postgres` retains
`BYPASSRLS`, so pointing back at it restores exactly the prior behaviour with no
DDL and no data movement. This property is why the plan is shaped this way, and
it must not be traded away for convenience in execution.

---

## 11. Estimated execution time

| Phase | Estimate |
|---|---|
| §3.1 app fixes + §3.3 assertion + new tests | 3–5 h |
| Full regression under `postgres` (step 3) | 1–2 h |
| Local `app_rw` proving run (step 4) | 2–3 h |
| Preflight + `ALTER ROLE` + psql tests (steps 5–6) | 1 h |
| Vercel owner-pool deploy (step 7) | 30 min incl. build |
| Preview cutover + certification (step 8) | 1–2 h |
| Production cutover + live certification (steps 9–10) | 1–2 h |
| **Total** | **10–16 h**, comfortably two working days |
| Rollback, if needed | **< 10 min** to the env change, plus one build |
| `organizations` policy follow-up (§4.2) | 1–2 h, separate |

---

## 12. Permissions required to execute

Not yet requested. Listed here so the grant can be made deliberately and scoped.

| Capability | Needed for | Minimum scope |
|---|---|---|
| Supabase SQL **write** on `pursuitos-demo` | the single `ALTER ROLE` in §5.1, plus any §5.2 default-privilege fix | project-scoped; demo project only |
| Supabase direct DB connection as `postgres` | psql-level §8.1 testing | demo project only |
| Vercel **env-variable write** on `PursuitOS-demo` | §6.1 | **project-scoped token — `PursuitOS-demo` only.** The token creation screen does allow selecting individual projects. |
| Vercel **deploy / redeploy** on `PursuitOS-demo` | §6.3 | same token |
| Git push to `claude/activateos-platform-review-xzkgmd` | §3 application changes | already held |
| The new `app_rw` password | §5.3, §6.1 | generated by the operator, entered directly into Vercel; **must never reach an agent session** |

**Deliberately not requested:** account-level Supabase access, organization-level
Vercel access, any credential for `app.pursuitos.io`, or any production tenant
database.

---

## 13. Open items to resolve before execution

1. **Serving SHA divergence.** Production branch head is `97e975f0` (Wave 6D);
   the last observed serving SHA was `66f72f61` (Wave 3). Establish the current
   truth from `/api/build` before anything else — a cutover cannot be certified
   against an unknown baseline.
2. **Default privileges** (§5.2 item 1) — the one place the "no grant changes"
   finding might not hold.
3. **`PG_OWNER_POOL_MAX` sizing** — the owner pool adds a second set of
   connections per warm instance; re-check the total against the pooler ceiling
   given the `EMAXCONNSESSION` history.

---

*This document is a plan. Executing it requires explicit authorization and the
credentials in §12, neither of which has been requested or granted.*
