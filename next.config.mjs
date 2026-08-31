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
        ],
      },
    ];
  },
};

export default nextConfig;
