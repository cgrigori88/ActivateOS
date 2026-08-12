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

## Accepted risk — open items, tracked

| # | Item | Why deferred | Trigger to fix |
|---|------|--------------|----------------|
| 1 | **Credential rotation** (Supabase password + access token, Anthropic, Tavily, PDL, trigger secret, Basic Auth) — keys were shared in a chat session | Owner action pending | **Immediately**, and before the demo video circulates |
| 2 | **No Content-Security-Policy** | Needs nonce plumbing for the theme-boot inline script and Next's inline chunks; a wrong CSP silently blanks pages | First hardening sprint |
| 3 | **No rate limiting** on Basic Auth or trigger endpoints | Low exposure while URL is private; timing-safe compare mitigates | Before the URL is shared beyond trusted partners |
| 4 | postcss/sharp advisories bundled in Next 15 | Build-time / removed-endpoint exposure only; npm fix is a breaking major | Next major upgrade window |
| 5 | **Single-tenant trust model** — Basic Auth, one shared credential, no per-row authorization, no RLS | The app is a single-operator demo today | **Before ANY customer** — see below |

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

## Standing rules

- Secrets live only in `.env.local` (gitignored) and host env vars — never in
  code, migrations, commits, or chat.
- Machine endpoints ship closed-by-default: unset secret = refuse, never open.
- New user-supplied strings that reach SQL are parameterized; that reach HTML
  are escaped or sandboxed; that reach CSV are formula-guarded.
