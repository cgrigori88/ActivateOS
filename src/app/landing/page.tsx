import type { Metadata } from "next";
import { HeroMesh } from "@/components/hero-mesh";

/**
 * The public PursuitOS site (§4).
 *
 * Three constraints shape every decision here, and they are not stylistic:
 *
 *   1. It must render with NO application database. Nothing on this page reads
 *      a tenant, a company, a pursuit or a count, and the topology verification
 *      proves it by serving this page with an unreachable DATABASE_URL.
 *   2. It must expose no tenant or demo data. The product preview below is
 *      drawn from generic role labels ("Manufacturing · 9 sites"), never from
 *      the synthetic demo world. Real account names in the demo are invented,
 *      but publishing invented company names on an indexable page invites
 *      exactly the wrong question, so none appear.
 *   3. It must look like the application. Same type scale, same ink ramp, same
 *      accent, same radii, same restraint — this reuses the product's tokens
 *      rather than establishing a second visual language for marketing.
 *
 * The brief's "avoid" list (feature walls, logo walls, animation, vague AI copy)
 * is largely a warning against padding. The answer is length: four concepts, one
 * preview, two calls to action, and a stop.
 */

/**
 * Both are read at REQUEST time rather than baked into the bundle.
 *
 * `NEXT_PUBLIC_*` is the obvious choice and the wrong one here: Next inlines
 * those at build time, so changing the contact address later would need a
 * rebuild to take effect. This page renders on the server, so a plain runtime
 * variable works and the address becomes a one-field edit in the dashboard —
 * which matters, because it is expected to change once real mail exists on the
 * domain. The NEXT_PUBLIC_ names are still honoured so an environment already
 * configured with them keeps working.
 */
const APP_URL =
  process.env.PURSUITOS_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://app.pursuitos.io";
const ACCESS_EMAIL =
  process.env.PURSUITOS_ACCESS_EMAIL ?? process.env.NEXT_PUBLIC_ACCESS_EMAIL ?? "";

/**
 * A "Request access" button pointing at `mailto:` with no address is a dead
 * control that looks live — the exact failure this codebase keeps refusing to
 * ship. So the contact route is derived once: configured means a real mailto,
 * unconfigured means the CTA is simply not rendered and Login carries the page.
 */
const CONTACT_HREF = ACCESS_EMAIL ? `mailto:${ACCESS_EMAIL}?subject=PursuitOS%20access` : null;

/**
 * Rendered per request, not prerendered — and the reason is worth recording,
 * because "static" is the obvious choice for a marketing page and it does not
 * work here.
 *
 * The CSP is nonce-based (#65), and Next can only stamp a nonce onto the inline
 * RSC bootstrap scripts it emits during a REQUEST render. A prerendered page
 * carries no nonce, the browser refuses those inline scripts, and hydration dies
 * with React #412 — which presents as a page that looks correct and is inert.
 *
 * The property that actually matters is "touches no database", and that is a
 * fact about this file's imports, not about when it renders. It is asserted
 * directly: the topology verification boots this page with a deliberately
 * unreachable DATABASE_URL and requires HTTP 200.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PursuitOS — The operating system for revenue between companies",
  description:
    "Know what to pursue. Through whom. Why now. Who needs to act. And what actually happened.",
};

/** The four concepts. Each is a claim about what the product decides, not a feature. */
const CONCEPTS = [
  {
    name: "Pursuit Intelligence",
    line: "What to pursue, and why now.",
    body: "Signals become facts with evidence behind them. A pursuit carries its own case — the conditions that make it live, and the ones that are still unknown.",
  },
  {
    name: "Ecosystem Orchestration",
    line: "Through whom.",
    body: "Routing across partners, distributors and sellers, scored on real relationship evidence rather than who asked first. The recommendation is explained, and a human can overrule it.",
  },
  {
    name: "Governed Execution",
    line: "Who needs to act.",
    body: "Every action crosses one authority with a disclosure boundary attached, so what a partner receives is decided at the server — not by remembering what not to paste.",
  },
  {
    name: "Outcome Learning",
    line: "What actually happened.",
    body: "Outcomes settle back against the decisions that produced them. Attribution is recorded, not re-argued at quarter end.",
  },
];

/**
 * Abstracted product preview.
 *
 * A screenshot of the real application would be the obvious move and the wrong
 * one: every surface carries synthetic company names and commercial figures.
 * This is the SHAPE of the decision surface — a scored account, a route with a
 * rationale, a disclosure boundary — with the identifying content removed.
 * It teaches the reader what the product looks like without publishing anything.
 */
function DecisionPreview() {
  return (
    <div
      className="overflow-hidden rounded-panel"
      style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-medium)", border: "1px solid var(--border-subtle)" }}
      aria-label="Illustration of a PursuitOS decision surface"
      role="img"
    >
      {/* Window chrome — reads as "application", costs three dots. */}
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-inset)" }}>
        {["#f87171", "#fbbf24", "#34d399"].map((c) => (
          <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c, opacity: 0.55 }} />
        ))}
        <span className="ml-2 text-micro ink-faint">Pursuit</span>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-title font-semibold ink">Manufacturing · 9 sites</div>
            <div className="mt-0.5 text-body ink-muted">Platform modernization · renewal inside 90 days</div>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-label font-bold uppercase tracking-[0.04em]"
            style={{ background: "color-mix(in srgb, var(--color-band-very-high) 12%, transparent)", color: "var(--color-band-very-high)" }}
          >
            Very high
          </span>
        </div>

        {/* Three measures. Neutral by default; only the one carrying state is coloured. */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          {[
            { label: "Readiness", value: "88", intent: null },
            { label: "Timing", value: "66", intent: null },
            { label: "Conditions open", value: "2", intent: "var(--intent-warning)" },
          ].map((m) => (
            <div key={m.label} className="rounded-card p-3" style={{ background: "var(--surface-inset)" }}>
              <div className="text-display font-bold tabular-nums" style={{ color: m.intent ?? "var(--ink)" }}>{m.value}</div>
              <div className="mt-0.5 text-label font-semibold uppercase tracking-[0.03em] ink-muted">{m.label}</div>
            </div>
          ))}
        </div>

        {/* The route: a recommendation, its reason, and the fact a human chose otherwise. */}
        <div className="mt-4 rounded-card p-3.5" style={{ background: "color-mix(in srgb, var(--color-accent) 4%, var(--surface-primary))", border: "1px solid var(--border-subtle)" }}>
          <div className="text-label font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-accent)" }}>Recommended route</div>
          <div className="mt-1.5 text-copy ink">National reseller · strongest verified relationship at this account</div>
          <div className="mt-1 text-body ink-muted">Human selection differs — recorded, with the reason, and preserved through recompute.</div>
        </div>

        {/* The disclosure boundary, which is the part people do not expect. */}
        <div className="mt-3 flex items-center gap-2 text-micro ink-faint">
          <span aria-hidden>🔒</span>
          <span>Two payloads: the internal case, and what the partner is permitted to receive.</span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main style={{ background: "var(--ground)" }} className="min-h-screen">
      {/* ---- Top bar: wordmark and the one action a returning customer wants ---- */}
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-6 py-5">
        <span className="text-title font-extrabold tracking-[-0.02em] ink">PursuitOS</span>
        <a
          href={APP_URL}
          className="rounded-control px-3.5 py-1.5 text-body font-semibold transition-colors ink-soft hover:ink"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          Login
        </a>
      </header>

      {/* ---- Hero ---- */}
      <section className="mx-auto max-w-[1080px] px-6 pb-2 pt-10 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="text-hero font-extrabold leading-[1.05] tracking-[-0.03em] ink" style={{ textWrap: "balance" }}>
              The operating system for revenue between companies.
            </h1>
            {/* The supporting line is the product's actual sequence, so it doubles
                as the page's structure — the four concepts below are these clauses. */}
            <p className="mt-5 max-w-[52ch] text-title leading-[1.5] ink-soft">
              Know what to pursue. Through whom. Why now. Who needs to act. And what actually happened.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {CONTACT_HREF && (
                <a
                  href={CONTACT_HREF}
                  className="rounded-control px-5 py-2.5 text-copy font-semibold text-white transition-colors"
                  style={{ background: "var(--color-accent)" }}
                >
                  Request access
                </a>
              )}
              {/* Login becomes the primary action when there is no contact route,
                  so the hero never ends without one. */}
              <a
                href={APP_URL}
                className="rounded-control px-5 py-2.5 text-copy font-semibold transition-colors"
                style={CONTACT_HREF
                  ? { border: "1px solid var(--border-emphasis)", color: "var(--ink-soft)" }
                  : { background: "var(--color-accent)", color: "#fff" }}
              >
                Login
              </a>
            </div>
          </div>

          {/* The brand mark, already built for the sign-in gate: Canvas 2D, no
              external assets, honours prefers-reduced-motion, CSP-safe. */}
          <div className="relative hidden h-[340px] lg:block" aria-hidden>
            <HeroMesh className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </section>

      {/* ---- Product preview ---- */}
      <section className="mx-auto max-w-[1080px] px-6 py-10 sm:py-14">
        <div className="mx-auto max-w-[760px]">
          <DecisionPreview />
        </div>
        <p className="mx-auto mt-4 max-w-[62ch] text-center text-body ink-muted">
          Illustrative. Every figure a customer sees is computed from their own evidence.
        </p>
      </section>

      {/* ---- Four concepts ---- */}
      <section className="mx-auto max-w-[1080px] px-6 pb-14 sm:pb-20">
        <div className="grid gap-px overflow-hidden rounded-panel sm:grid-cols-2" style={{ background: "var(--border-subtle)" }}>
          {CONCEPTS.map((c) => (
            <div key={c.name} className="p-7" style={{ background: "var(--surface-primary)" }}>
              <div className="text-label font-bold uppercase tracking-[0.05em]" style={{ color: "var(--color-accent)" }}>
                {c.name}
              </div>
              <div className="mt-2.5 text-section font-semibold tracking-[-0.01em] ink">{c.line}</div>
              <p className="mt-2 max-w-[46ch] text-copy leading-[1.6] ink-soft">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section className="mx-auto max-w-[1080px] px-6 pb-20">
        <div
          className="rounded-panel px-8 py-12 text-center"
          style={{ background: "var(--surface-inset)", border: "1px solid var(--border-subtle)" }}
        >
          <h2 className="text-section font-bold tracking-[-0.015em] ink" style={{ textWrap: "balance" }}>
            Working with partners on revenue you both touch?
          </h2>
          <p className="mx-auto mt-3 max-w-[54ch] text-copy leading-[1.6] ink-soft">
            PursuitOS is in design-partner release. We take on a small number at a time.
          </p>
          <a
            href={CONTACT_HREF ?? APP_URL}
            className="mt-7 inline-block rounded-control px-5 py-2.5 text-copy font-semibold text-white transition-colors"
            style={{ background: "var(--color-accent)" }}
          >
            {CONTACT_HREF ? "Request access" : "Login"}
          </a>
        </div>
      </section>

      <footer className="mx-auto max-w-[1080px] px-6 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6 text-micro ink-faint" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <span>PursuitOS</span>
          {ACCESS_EMAIL && <a href={`mailto:${ACCESS_EMAIL}`} className="hover:ink-muted">{ACCESS_EMAIL}</a>}
        </div>
      </footer>
    </main>
  );
}
