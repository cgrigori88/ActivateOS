import type { Metadata } from "next";
import Link from "next/link";
import { Lockup } from "@/components/brand";

/**
 * Public marketing page. Excluded from the Basic Auth gate in middleware.ts —
 * it holds no customer data.
 *
 * Styling follows docs/DESIGN.md §3: neutral base, semantic colour only, one
 * restrained accent, tabular numerals, whitespace doing the separating rather
 * than boxes inside boxes. Light and dark are of equal quality.
 */

export const metadata: Metadata = {
  title: "PursuitOS — Know where revenue moves next.",
  description:
    "PursuitOS scores the intersection of customer, product, partner, seller and timing, then assembles the motion to pursue it.",
};

const NAV = [
  { label: "The problem", href: "#problem" },
  { label: "Evidence", href: "#evidence" },
  { label: "How it works", href: "#engines" },
];

const HERO_METRICS = [
  { value: "41", label: "Evidence sources per pursuit" },
  { value: "0.72", label: "Median confidence at launch" },
  { value: "7", label: "Stages, data to learning" },
  { value: "3.4×", label: "Pipeline per motion vs. baseline" },
];

const CATEGORIES = [
  { name: "CRM", line: "Records what happened." },
  { name: "PRM", line: "Administers partners, portals and deal registration." },
  { name: "Ecosystem maps", line: "Reveal who is connected to whom." },
  {
    name: "PursuitOS",
    line: "Decides what to activate, through whom, with what message, and why now.",
    assertion: true,
  },
];

const ENGINES = [
  { n: "01", name: "Sense", line: "Entity resolution and signal collection across the graph." },
  { n: "02", name: "Predict", line: "Purchase propensity and activation probability." },
  { n: "03", name: "Match", line: "Customer × product × partner × seller." },
  { n: "04", name: "Design", line: "Revenue motions and the campaigns that carry them." },
  { n: "05", name: "Execute", line: "Seller actions and human-approved outreach." },
  { n: "06", name: "Learn", line: "Outcome events become lift, and lift retrains Predict." },
];

const EVIDENCE = [
  { label: "Two senior data platform roles posted", meta: "Hiring signal · 11d ago", weight: 0.82 },
  { label: "Legacy warehouse contract renews Q4", meta: "Filing · 2026-06-30", weight: 0.68 },
  { label: "Partner closed adjacent motion at 3 peers", meta: "Partner record · 2026-07", weight: 0.59 },
  { label: "Dormant 14 months, no open opportunity", meta: "CRM · 2026-08-01", weight: 0.34 },
];

const TEAM = [
  { name: "Ingram Micro", role: "Distributor", fit: "0.91" },
  { name: "Arclight Consulting", role: "SI partner", fit: "0.84" },
  { name: "M. Okonjo", role: "Seller · prior win at peer", fit: "—" },
];

const ENGAGEMENT = [
  { k: "Scope", v: "One vendor, one product, one partner, one campaign." },
  { k: "Targets", v: "Roughly 100 accounts, ranked and evidenced." },
  { k: "Duration", v: "30 days of activation support." },
  { k: "Output", v: "Approved motions, campaign assets, and the outcome data behind them." },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">
      {children}
    </p>
  );
}

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-neutral-200 py-16 sm:py-24 dark:border-neutral-800">
      <div className="mx-auto max-w-5xl px-6">{children}</div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* ---- Chrome ---------------------------------------------------- */}
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-8 px-6">
          <a href="#top" className="shrink-0">
            <Lockup size={15} />
          </a>
          <nav className="ml-auto flex items-center gap-6">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="hidden text-[13px] text-neutral-600 transition-colors hover:text-neutral-900 sm:block dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {item.label}
              </a>
            ))}
            <a
              href="#request"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Request access
            </a>
          </nav>
        </div>
      </header>

      {/* ---- Hero ------------------------------------------------------ */}
      <div id="top" className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pb-24 sm:pt-28">
        <Eyebrow>Partner-led revenue</Eyebrow>
        <h1 className="mt-6 max-w-[17ch] text-4xl font-semibold tracking-tight sm:text-6xl">
          Know where revenue moves next.
        </h1>
        <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          PursuitOS scores the intersection of customer, product, partner, seller and timing, then
          assembles the motion to pursue it.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#request"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
          >
            Request access
          </a>
          <a
            href="#evidence"
            className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
          >
            See the methodology
          </a>
        </div>

        <dl className="mt-16 grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-4">
          {HERO_METRICS.map((m) => (
            <div key={m.label}>
              <dt className="sr-only">{m.label}</dt>
              <dd>
                <span className="tnum block text-3xl font-semibold tracking-tight">{m.value}</span>
                <span className="mt-2 block text-[13px] leading-snug text-neutral-500 dark:text-neutral-400">
                  {m.label}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ---- 01 · The activation gap ----------------------------------- */}
      <Section id="problem">
        <Eyebrow>01 — The problem</Eyebrow>
        <h2 className="mt-5 max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl">
          The channel does not have a recruitment problem.
        </h2>
        <p className="mt-6 max-w-[64ch] leading-relaxed text-neutral-600 dark:text-neutral-400">
          Vendors sign partners, allocate MDF, publish portal content and distribute generic account
          lists. Very little coordinated seller execution results. The gap is not who you have
          signed — it is knowing which combination to activate, and moving on it while the trigger
          is still open.
        </p>

        <dl className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div
              key={c.name}
              className={`border-l-2 pl-5 ${
                c.assertion
                  ? "border-accent dark:border-blue-400"
                  : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              <dt
                className={`text-sm font-semibold ${
                  c.assertion ? "text-accent dark:text-blue-400" : ""
                }`}
              >
                {c.name}
              </dt>
              <dd className="mt-2 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                {c.line}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ---- 02 · The system doing work -------------------------------- */}
      <Section id="evidence">
        <Eyebrow>02 — The system doing work</Eyebrow>
        <h2 className="mt-5 max-w-[22ch] text-3xl font-semibold tracking-tight sm:text-4xl">
          This account is moving. Here is the evidence.
        </h2>
        <p className="mt-6 max-w-[58ch] leading-relaxed text-neutral-600 dark:text-neutral-400">
          Every score opens into the features that produced it and the evidence behind them. No
          number in PursuitOS is unexplained.
        </p>

        <div className="mt-12 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid lg:grid-cols-[1.4fr_1fr]">
            {/* Pursuit detail */}
            <div className="p-6 sm:p-8">
              <p className="tnum text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                Pursuit · PUR-4417
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight">Northwind Logistics</h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Data platform modernisation · EMEA · via Ingram Micro
              </p>

              <div className="mt-8 flex gap-12">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Propensity
                  </p>
                  <p className="tnum mt-1.5 flex items-center gap-2">
                    <span className="text-3xl font-semibold tracking-tight">87.4</span>
                    <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-600/20 dark:bg-green-950 dark:text-green-300">
                      Very high
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Confidence
                  </p>
                  <p className="tnum mt-1.5 text-3xl font-semibold tracking-tight">0.72</p>
                </div>
              </div>

              <div className="mt-9">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Why now
                </p>
                <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
                  {EVIDENCE.map((e) => (
                    <li key={e.label} className="flex items-baseline gap-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{e.label}</span>
                        <span className="mt-0.5 block text-xs text-neutral-400 dark:text-neutral-500">
                          {e.meta}
                        </span>
                      </span>
                      <span className="tnum shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">
                        {e.weight.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Assembled team */}
            <div className="border-t border-neutral-200 bg-neutral-50 p-6 sm:p-8 lg:border-l lg:border-t-0 dark:border-neutral-800 dark:bg-neutral-950/40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Assembled team
              </p>
              <ul className="mt-4 space-y-3.5">
                {TEAM.map((t) => (
                  <li key={t.name} className="flex items-baseline justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium">{t.name}</span>
                      <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                        {t.role}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-xs text-neutral-400">{t.fit}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Next best action
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                Brief Ingram on the renewal window and request a joint intro to the VP Data Platform
                before the Q3 close.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ---- 03 · Six engines ------------------------------------------ */}
      <Section id="engines">
        <Eyebrow>03 — Six engines, one graph</Eyebrow>
        <h2 className="mt-5 max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl">
          Data to decision to outcome, then back again.
        </h2>
        <p className="mt-6 max-w-[64ch] leading-relaxed text-neutral-600 dark:text-neutral-400">
          The asset is not the dataset. It is the closed loop — who we predicted, why, through which
          partner, what the seller did, and what the customer actually bought — captured as
          immutable events and repeated at scale.
        </p>

        <ol className="mt-12 grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {ENGINES.map((e) => (
            <li key={e.name}>
              <span className="tnum text-xs font-semibold text-neutral-400">{e.n}</span>
              <h3 className="mt-2 text-sm font-semibold">{e.name}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                {e.line}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---- 04 · How it starts ---------------------------------------- */}
      <Section>
        <Eyebrow>04 — How it starts</Eyebrow>
        <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
          30-Day Partner Activation.
        </h2>
        <p className="mt-6 max-w-[58ch] leading-relaxed text-neutral-600 dark:text-neutral-400">
          One motion, run end to end, with the evidence and the outcome data to show whether it
          worked.
        </p>

        <dl className="mt-10 max-w-3xl border-t border-neutral-200 dark:border-neutral-800">
          {ENGAGEMENT.map((row) => (
            <div
              key={row.k}
              className="grid grid-cols-[88px_1fr] gap-6 border-b border-neutral-200 py-4 sm:grid-cols-[140px_1fr] dark:border-neutral-800"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {row.k}
              </dt>
              <dd className="text-[15px] leading-relaxed">{row.v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ---- Close ------------------------------------------------------ */}
      <Section id="request">
        <h2 className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl">
          Know where revenue moves next.
        </h2>
        <p className="mt-6 max-w-[54ch] leading-relaxed text-neutral-600 dark:text-neutral-400">
          We are taking a small number of design partners. One vendor, one partner, one campaign,
          thirty days.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="mailto:hello@pursuitos.io"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
          >
            Request access
          </a>
          <a
            href="#evidence"
            className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
          >
            See the methodology
          </a>
        </div>
      </Section>

      {/* ---- Footer ------------------------------------------------------ */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-8 text-[13px] text-neutral-500 dark:text-neutral-400">
          <Lockup size={14} />
          <span>Partner revenue graph</span>
          <Link href="/" className="ml-auto transition-colors hover:text-neutral-900 dark:hover:text-neutral-100">
            Sign in
          </Link>
          <span className="tnum">© 2026</span>
        </div>
      </footer>
    </div>
  );
}
