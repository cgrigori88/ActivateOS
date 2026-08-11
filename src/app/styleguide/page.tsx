import type { Metadata } from "next";
import {
  BAND_LABELS,
  BandBadge,
  Card,
  CompletenessGrid,
  CountChip,
  DimensionBars,
  EvidenceLine,
  FEATURE_LABELS,
  FilterPill,
  PageHeader,
  Score,
  SearchBox,
  SortHeader,
  StatChip,
  StatusBadge,
  Toolbar,
} from "@/components/ui";

/**
 * Living reference for the brand kit (docs/BRAND.md) — every primitive in every
 * state, on mock data. It exists because the product screens need a database to
 * render, so this is the surface the design lane can actually iterate against.
 *
 * Internal: deliberately NOT added to the middleware matcher exclusion, so it
 * sits behind the Basic Auth gate in deployed environments.
 */

export const metadata: Metadata = {
  title: "Style guide — PursuitOS",
  robots: { index: false, follow: false },
};

const BANDS = ["very_high", "high", "medium", "low"];
const STATUSES = [
  "draft",
  "approved",
  "active",
  "completed",
  "abandoned",
  "verified",
  "quarantined",
  "running",
  "rejected",
  "failed",
  "skipped",
  "disabled",
];

const ROWS = [
  { name: "Northwind Logistics", solution: "data-platform", score: 87.4, band: "very_high", conf: 0.72, dims: [82, 68, 59, 34, 91, 20, 44] },
  { name: "Arclight Consulting", solution: "observability", score: 74.1, band: "high", conf: 0.65, dims: [61, 74, 40, 52, 33, 28, 66] },
  { name: "Vantage Cloud", solution: "finops", score: 58.9, band: "medium", conf: 0.51, dims: [44, 39, 71, 22, 48, 61, 30] },
  { name: "Redline Partners", solution: "compliance", score: 31.2, band: "low", conf: 0.38, dims: [22, 18, 34, 41, 12, 25, 19] },
];

const NEUTRAL_SWATCHES: Array<[string, string]> = [
  ["50", "bg-neutral-50"],
  ["100", "bg-neutral-100"],
  ["200", "bg-neutral-200"],
  ["300", "bg-neutral-300"],
  ["400", "bg-neutral-400"],
  ["500", "bg-neutral-500"],
  ["600", "bg-neutral-600"],
  ["700", "bg-neutral-700"],
  ["800", "bg-neutral-800"],
  ["900", "bg-neutral-900"],
  ["950", "bg-neutral-950"],
];

const BLUE_SWATCHES: Array<[string, string]> = [
  ["50", "bg-blue-50"],
  ["100", "bg-blue-100"],
  ["200", "bg-blue-200"],
  ["300", "bg-blue-300"],
  ["400", "bg-blue-400"],
  ["500", "bg-blue-500"],
  ["600", "bg-blue-600"],
  ["700", "bg-blue-700"],
  ["800", "bg-blue-800"],
  ["900", "bg-blue-900"],
  ["950", "bg-blue-950"],
];

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div>
      <div className={`h-14 rounded-[10px] border border-neutral-200 dark:border-neutral-800 ${className}`} />
      <p className="mt-1.5 text-[11px] text-neutral-500">{name}</p>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {note && <p className="mt-1 mb-4 text-[13px] text-neutral-500">{note}</p>}
      <div className={note ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export default function StyleGuidePage() {
  return (
    <main>
      <PageHeader
        title="Style guide"
        subtitle="Every primitive in every state, on mock data. The living reference for docs/BRAND.md."
      />

      <Section title="Neutral ramp" note="Cool and blue-tinted, so the greys sit with the accent rather than fighting it.">
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
          {NEUTRAL_SWATCHES.map(([name, cls]) => (
            <Swatch key={name} name={name} className={cls} />
          ))}
        </div>
      </Section>

      <Section title="Brand ramp" note="Centred on the site's #2563EB. The accent stays under roughly 10% of any screen.">
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
          {BLUE_SWATCHES.map(([name, cls]) => (
            <Swatch key={name} name={name} className={cls} />
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <Card>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Page title — 24 / 600</h1>
          <h2 className="mt-4 text-[15px] font-semibold">Section heading — 15 / 600</h2>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
            Eyebrow — 11 / 600 / 0.08em
          </p>
          <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            Body — 14 / 400 / 1.6. Every score opens into the features that produced it and the
            evidence behind them. No number in PursuitOS is unexplained.
          </p>
          <p className="mt-2 text-[13px] text-neutral-500">Meta — 13 / 400 / neutral-500</p>
          <p className="tnum mt-4 text-[32px] font-semibold tracking-[-0.02em]">1,840,000</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
            Metric — tabular, always
          </p>
        </Card>
      </Section>

      <Section title="Bands and statuses" note="These describe the data. They never mean success or error in the chrome — the accent does that.">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <BandBadge key={b} band={b} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Count chips" note="Every number is clickable and filters the table below.">
        <div className="flex flex-wrap gap-2">
          <CountChip label="Awaiting approval" value={12} tone="amber" />
          <CountChip label="Evidence to review" value={38} tone="sky" />
          <CountChip label="Verified" value={214} tone="green" />
          <CountChip label="Contradictions" value={3} tone="red" />
          <CountChip label="Selected" value={4} active />
        </div>
      </Section>

      <Section title="Stat chips">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatChip label="Scored accounts" value={1284} />
          <StatChip label="Pending review" value={38} tone="attention" />
          <StatChip label="Median confidence" value="0.72" />
        </div>
      </Section>

      <Section title="Toolbar, search and filters">
        <Card>
          <Toolbar
            actions={
              <button className="rounded-[6px] bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors duration-[120ms] hover:bg-accent-strong">
                Export
              </button>
            }
          >
            <SearchBox placeholder="Search accounts…" defaultValue="" />
            <FilterPill label="Band: very high" clearHref="#" />
            <FilterPill label="“logistics”" clearHref="#" />
          </Toolbar>
        </Card>
      </Section>

      <Section title="Data table" note="44px rows, hairline separators, a header that reads as a label rather than a band of chrome.">
        <Card className="!p-0 overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Solution</th>
                  <th>
                    <SortHeader label="Score" sortKey="score" current="-score" makeHref={() => "#"} />
                  </th>
                  <th>Band</th>
                  <th>Confidence</th>
                  <th>Dimensions</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.name}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-neutral-500">{r.solution}</td>
                    <td>
                      <Score value={r.score} />
                    </td>
                    <td>
                      <BandBadge band={r.band} />
                    </td>
                    <td className="tnum text-neutral-500">{r.conf.toFixed(2)}</td>
                    <td>
                      <DimensionBars values={r.dims} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section title="Evidence" note="The claim reads first; its provenance sits quietly beneath it.">
        <Card>
          <ul className="space-y-3">
            <EvidenceLine
              claim="Two senior data platform roles posted."
              meta="Hiring signal · 2026-07-30 · confidence 0.82"
            />
            <EvidenceLine
              claim="Legacy warehouse contract renews in Q4."
              meta="Filing · 2026-06-30 · confidence 0.68"
            />
            <EvidenceLine
              claim="Dormant 14 months, no open opportunity."
              meta="CRM · 2026-08-01 · confidence 0.34"
            />
          </ul>
        </Card>
      </Section>

      <Section title="Coverage" note="Completeness is not propensity. A gap is a research to-do, never low intent.">
        <Card>
          <CompletenessGrid
            overall={62}
            byCategory={{
              firmographic: true,
              technographic: true,
              hiring: true,
              filings: false,
              news: true,
              partners: false,
              crm: true,
              network: false,
            }}
          />
        </Card>
      </Section>

      <Section title="Feature labels">
        <Card>
          <div className="flex flex-wrap gap-2">
            {Object.entries(FEATURE_LABELS).map(([k, v]) => (
              <span
                key={k}
                className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {v}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-neutral-500">
            Bands: {Object.values(BAND_LABELS).join(" · ")}
          </p>
        </Card>
      </Section>

      <Section title="Buttons">
        <Card>
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="rounded-[6px] bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors duration-[120ms] hover:bg-accent-strong">
              Approve
            </button>
            <button className="rounded-[6px] border border-neutral-200 px-3.5 py-2 text-[13px] font-medium transition-colors duration-[120ms] hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
              Secondary
            </button>
            <button className="rounded-[6px] px-3.5 py-2 text-[13px] font-medium text-red-700 transition-colors duration-[120ms] hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
              Reject
            </button>
            <button
              disabled
              className="cursor-not-allowed rounded-[6px] bg-neutral-100 px-3.5 py-2 text-[13px] font-medium text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
            >
              Disabled
            </button>
          </div>
        </Card>
      </Section>
    </main>
  );
}
