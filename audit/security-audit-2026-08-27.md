# Security Audit — PursuitOS

**Date:** 2026-08-27 · **Skill:** security-audit (15-step sweep) · **Modes:** INSIDE (filesystem) + OUTSIDE (https://pursuitos.io)

## Scorecard

| Severity | Finding | Target | Status |
| --- | --- | --- | --- |
| HIGH | Broken function-level auth + IDOR on brief draft actions | `src/app/briefs/[motionId]/actions.ts` | **Fixed** (86cab9c) |
| MEDIUM | CSV formula injection in writeback export | `src/lib/opportunities/writeback.ts:134` | **Fixed** (86cab9c) |
| MEDIUM | Tenant tables shipped without RLS policies | migrations 0051–0055 | **Fixed** — `0056_rls_consistency.sql` |
| LOW | HSTS lacks `includeSubDomains` / `preload` | `src/proxy.ts` (header set) | Open — recommendation below |
| INFO | App pool owns tables, bypassing RLS | task #67 (pending hardening) | Tracked |

No CRITICAL findings. Details for each below.

---

### HIGH — Broken function-level authorization + IDOR (BOLA)
**Target:** `src/app/briefs/[motionId]/actions.ts` — `motionContext()`, `generateDraftAction()`, `sendDraftAction()`

**Flaw:** Unlike every other mutating server action, these carried no
`requireWrite` gate and resolved org scope *from the motion row itself*
(`select m.org_id … where m.id = $1`). Any authenticated user who guessed or
enumerated a motion UUID from another tenant could trigger AI generation
(spending the platform's AI budget) and write outreach drafts against that
tenant's motion — a broken-object-level-authorization + missing-function-auth
pair (OWASP A01).

**Remediation (applied):**
```ts
await requireWrite(pool);
const orgId = await currentOrgId(pool);
if (!orgId) throw new Error("No organization in scope.");
// scope the lookup to the caller's org — never trust the row's org_id
`select … from revenue_motions m where m.id = $1 and m.org_id = $2`, [motionId, orgId]
```

### MEDIUM — CSV formula injection
**Target:** `src/lib/opportunities/writeback.ts:134` — CSV export escaper

**Flaw:** Fields were quote-escaped but not formula-neutralized. Account names
enter the platform via CSV import (attacker-influenced) and flow into the
writeback export CSV; a name like `=HYPERLINK(...)` or `@SUM(...)` executes
when the exported file is opened in Excel/Sheets (OWASP A03, CSV injection).

**Remediation (applied):** prefix any cell beginning with `= + - @` with a
single quote before quoting, rendering it inert.

### MEDIUM — Missing RLS on newer tenant tables
**Target:** `initiatives`, `ask_exchanges`, `crm_writebacks`, `org_ai_settings` (migrations 0051–0055)

**Flaw:** Every earlier tenant-scoped table enables RLS with an
`is_org_member(org_id)` policy; these four shipped without it. Currently inert
because the app connects as the table owner (which bypasses RLS), but it
becomes a live cross-tenant read hole the moment the app pool moves to a
non-owner role — the exact change tracked as pending task #67.

**Remediation (applied):** `0056_rls_consistency.sql` enables RLS and adds the
`is_org_member(org_id)` select policy on all four tables. Applied to prod.

### LOW — HSTS header incomplete
**Target:** the HSTS header in `src/proxy.ts`

**Flaw:** `strict-transport-security: max-age=15552000` omits
`includeSubDomains` and `preload`, so subdomains aren't protected and the
domain can't enter the browser preload list.

**Remediation (recommended, not yet applied):**
`max-age=63072000; includeSubDomains; preload` — only after confirming every
subdomain is HTTPS-only.

### INFO — App pool is the table owner
The application database role owns its tables and therefore bypasses RLS. This
is a known, tracked posture (task #67: run the app on a non-owner role so RLS
is enforced in depth). The 0056 policies are the prerequisite that makes that
flip safe.

---

## Checked and clean

- **Secrets:** no credential patterns in tracked files; `.env*` gitignored and
  never in add-history; `.env.example` is placeholders only.
- **Dependencies:** `npm audit --omit=dev` → 0 vulnerabilities.
- **SQL injection:** all 68 query sites parameterized; the two dynamic-SET
  builders take field names from static `EDITABLE_FIELDS` allowlists.
- **Function-level auth:** ~100 server actions across 21 files gated; admin's
  20 actions route through the `ownerOrg()` owner gate.
- **Route auth (OUTSIDE-verified):** `/pipeline`, `/api/mcp` (no key),
  `/api/research` (no secret), `/api/writebacks` all return **401**
  unauthenticated in production.
- **MCP surface:** authenticates and rate-limits before `tools/list`; write
  tools create only gated drafts/requests.
- **Headers (OUTSIDE-verified):** CSP with per-request nonce + `strict-dynamic`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, tight `Permissions-Policy`, HSTS present.
- **XSS:** the only `dangerouslySetInnerHTML` is the nonce'd theme-boot constant.
- **Crypto at rest:** API keys stored hashed (SHA-256, compared by hash);
  BYO-model keys AES-256-GCM under `APP_ENCRYPTION_KEY`, plaintext never
  reaches the DB; feature disabled when the env secret is absent.
- **Secret handling:** no key/token/password values in `console.log`.

## Outstanding (owner action)
- Repo visibility → private; rotate credentials (Supabase password / access
  token / service-role key, Anthropic / Tavily / PDL keys,
  RESEARCH_TRIGGER_SECRET, Basic Auth); Supabase backup tier; Railway backup
  volume; `APP_ENCRYPTION_KEY` on Vercel for BYO-model.
- LOW: strengthen HSTS after subdomain HTTPS confirmed.
- INFO/#67: move app pool to a non-owner role to enforce RLS in depth.
