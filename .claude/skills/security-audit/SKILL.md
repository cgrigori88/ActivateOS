---
name: security-audit
description: Run a senior-AppSec 15-step security sweep of this codebase — secrets, injection, authz, tenancy, headers, dependencies, crypto — and report findings ranked by severity with file:line evidence. Use when asked for a security audit, AppSec review, or pre-release security pass. For a diff-scoped review of pending branch changes, prefer the built-in security-review skill instead.
---

# Security audit — the 15-step codebase sweep

Act as a senior application security engineer auditing this repository
(Next.js App Router + Postgres multi-tenant SaaS with an MCP agent surface).
Report findings ranked CRITICAL / HIGH / MEDIUM / LOW / INFO, each with
file:line evidence and a concrete fix. No finding without evidence; no
severity inflation. **Never print secret values** — name the file and key
name only.

## The sweep

1. **Tracked secrets.** Grep tracked files for credential patterns
   (`sk-ant-`, `sk_live`, `SUPABASE_SERVICE`, `password=`, PEM headers,
   bearer tokens). Verify `.env*` files are gitignored and none are in
   `git ls-files`.
2. **Ignore coverage.** `.gitignore` covers env files, build output,
   scratch scripts, and dumps. Check `git log --diff-filter=A` history for
   accidentally committed env files.
3. **Dependency audit.** `npm audit` (production severity); note advisories
   with an available upgrade path separately from unfixable transitive ones.
4. **SQL injection surface.** Every query must be parameterized. Flag any
   template-literal interpolation into SQL that isn't a static identifier
   or a reviewed constant (grep `query(\`` for `${`).
5. **Server-action authorization.** Every mutating server action calls the
   auth gate (`requireWrite` / `requireOwner`) before touching the pool, and
   resolves org scope server-side — never from client input.
6. **Route-handler authorization.** Every `route.ts` authenticates before
   doing work; the MCP endpoint must auth before `tools/list`.
7. **Multi-tenant scoping.** Spot-check newest libs: every read/write is
   scoped by `org_id` (or partnership membership) in SQL, not in JS after
   the fetch. RLS enabled on new tables with cross-tenant reach.
8. **Cross-tenant consent boundaries.** Anything crossing the partnership
   fence (shares, probes, joint data) verifies membership AND consent rung
   in SQL before returning rows.
9. **Secret handling in code.** No `console.log` of keys/tokens; secrets
   encrypted at rest where stored (verify algorithm and that plaintext
   never hits the DB); API keys stored hashed, compared by hash.
10. **Headers & CSP.** Strict CSP with nonces still intact in the proxy;
    no `unsafe-eval`; frame-ancestors restricted; auth cookies HttpOnly.
11. **XSS surface.** Grep `dangerouslySetInnerHTML` and any HTML rendered
    from user/partner/CSV input; email HTML rendering must escape
    interpolated fields.
12. **SSRF & outbound fetch.** Providers fetching URLs derived from data
    (domains from CSVs, webhooks) must not reach internal ranges; check
    redirects and protocol allow-lists.
13. **Rate limiting & abuse.** Rate limits still cover login, MCP, and
    AI-spending endpoints; AI actions gated behind write role.
14. **File/CSV intake.** Uploads parsed in-tenant, size-bounded, no path
    traversal on names, formulas not executed (CSV injection on export:
    fields starting with `= + - @` are prefixed on export).
15. **Prompt-injection & agent surface.** Content from external sources
    (CSVs, partner shares, email replies) is treated as data in agent
    prompts; MCP write tools create only gated drafts/requests; tool
    outputs never grant instructions authority.

## Reporting

Summary table first (severity, finding, location), then details. Close with
what was checked and found clean — an audit that only lists problems hides
its own coverage. If a step cannot be completed, say so rather than
skipping silently.
