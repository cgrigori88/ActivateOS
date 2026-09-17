/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],

  // Build provenance (§15). Evaluated once, when the bundle is compiled, so
  // /api/build reports when this DEPLOYMENT was built rather than when the
  // request happened to arrive. Vercel supplies the commit SHA itself via
  // VERCEL_GIT_COMMIT_SHA; this fills the one field it has no variable for.
  env: {
    PURSUITOS_BUILT_AT: new Date().toISOString(),
  },

  // CSV intake uploads the file to a server action (analysis runs in-app so
  // partner data never transits a third party). Default cap is 1MB; the
  // intake code enforces its own 8MB/10k-row limits inside that envelope.
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },

  // The app renders no <Image>; disabling the optimizer removes the
  // /_next/image endpoint (and with it the sharp/libvips attack surface,
  // which npm audit flags and which only a breaking Next major would patch).
  images: { unoptimized: true },

  // Don't advertise the framework.
  poweredByHeader: false,

  // Baseline security headers. Deliberately NO Content-Security-Policy yet:
  // a strict CSP needs nonce plumbing for the theme-boot inline script and
  // Next's own inline chunks — worth doing, but not as a header that could
  // silently break rendering. Everything below is non-breaking.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // The app is never legitimately framed (touch previews use srcdoc,
          // which this header does not affect).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // 180 days, no includeSubDomains — other subdomains of the apex are
          // not ours to commit to HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
          // ── P6-IG: recipient-specific projections must be NON-SHARED and NON-STORABLE. ──
          // `force-dynamic` already disables Next's route and data caches, so governance is
          // re-evaluated per request — but the response was advertising itself as `public`, which
          // authorizes a shared cache to STORE a confidential intercompany projection. Read-time
          // revocation is not complete until a revoked recipient cannot retrieve a previously
          // authorized response from a shared or server cache.
          //
          // MEASURED DELIVERY, hosted 2026-09-17. These two land on ROUTE HANDLERS and static assets
          // (/api/build answers `vary: Cookie`, `cache-control: no-store`). On a rendered RSC page
          // Next owns both: it replaces Vary with its router-negotiation list, so `Cookie` does NOT
          // reach the wire there, and it replaces Cache-Control with `private, no-cache, no-store,
          // max-age=0, must-revalidate` — strictly STRONGER than the value below. So the control
          // that matters, non-storable and non-shared, holds on every rendered room (7/7 measured),
          // and the Vary beside it is defense in depth that the framework declines to carry on
          // pages. Setting it from the proxy was tried and does not survive either. It is kept here
          // for the surfaces that DO deliver it; the claim is stated to match the wire, not this file.
          //
          // `Vary: Cookie` is correct here because BOTH credential dimensions are cookies, traced:
          // Supabase session cookies (src/lib/auth/supabase.ts) and SCOPE_COOKIE
          // (src/lib/scope/server.ts), which changes what the projection contains. There is no auth
          // header and no query-parameter credential. It is defense-in-depth; `no-store` is the
          // control that actually matters.
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
};

export default nextConfig;
