# Stack-specific sweep checklist (PursuitOS)

Companion to SKILL.md's 15-step sweep — the concrete checks for THIS stack
(Next.js App Router + Postgres multi-tenant + MCP agent surface). Never print
secret values; name file and key only.

1. Tracked secrets: grep tracked files for `sk-ant-`, `sk_live`,
   `SUPABASE_SERVICE_ROLE`, PEM headers; `.env*` absent from `git ls-files`
   and from `git log --diff-filter=A` history.
2. `.gitignore` covers env files, build output, scratch scripts, dumps.
3. `npm audit --omit=dev`.
4. SQL: every query parameterized; dynamic SET/identifier fragments only from
   static allowlists (`EDITABLE_FIELDS` pattern).
5. Server actions: every mutation behind `requireWrite`/`requireOwner` (or the
   file's `ownerOrg()`/`writerOrg()` helper) with org scope resolved
   server-side — never from the target row (the briefs-actions bug class).
6. Route handlers: auth before work; MCP auths + rate-limits before dispatch;
   `/api/research` closed until its bearer secret is configured.
7. Tenancy: reads/writes scoped by `org_id` in SQL; RLS enabled + policies on
   every tenant table (see 0056) — required even while the app pool owns the
   tables, so the #67 role flip can't silently open them.
8. Cross-tenant: partnership membership AND consent rung verified in SQL
   (named-overlap gate on shares/intros).
9. Secrets in code: no key/token logging; API keys hashed; BYO-model keys
   AES-256-GCM under `APP_ENCRYPTION_KEY`; feature disabled when the env
   secret is absent.
10. Headers: CSP nonces intact in `src/proxy.ts`; no `unsafe-eval`.
11. XSS: `dangerouslySetInnerHTML` only for the nonce'd theme-boot constant;
    email HTML escapes interpolated fields.
12. SSRF: provider fetches on data-derived hosts (domains from CSVs) — check
    protocol allow-list and redirect handling.
13. Rate limits on login, MCP, AI-spending endpoints; AI actions write-gated.
14. CSV: in-tenant parsing, size bounds; exports neutralize `= + - @` formula
    cells (writeback exporter pattern).
15. Agent surface: external content (CSVs, shares, replies) is data, not
    instructions; MCP writes create only gated drafts/requests.
