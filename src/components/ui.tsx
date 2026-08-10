import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared primitives implementing the brand kit (docs/BRAND.md).
 *
 * Export names and prop signatures are stable — the platform lane's screens
 * consume these unchanged. Everything here is styling.
 */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[14px] border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-7">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
      {subtitle && (
        <p className="mt-1.5 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </p>
      )}
    </header>
  );
}

/**
 * Bands describe the data, not interface state. Quiet fills, no rings — the
 * label carries the meaning and the colour reinforces it.
 */
const BAND_STYLES: Record<string, string> = {
  very_high: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  high: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export const BAND_LABELS: Record<string, string> = {
  very_high: "Very high",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function BandBadge({ band }: { band: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-medium ${
        BAND_STYLES[band] ?? BAND_STYLES.low
      }`}
    >
      {BAND_LABELS[band] ?? band}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  approved: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  active: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  completed: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  abandoned: "bg-neutral-100 text-neutral-500 line-through dark:bg-neutral-800",
  // Evidence quality-gate outcomes + provider-run states (intelligence surface).
  verified: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  succeeded: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  quarantined: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  skipped: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  running: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  disabled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};

/**
 * A dot carries the state at a glance; the word confirms it. Sentence case
 * rather than uppercase — these read as data, not as chrome.
 */
const STATUS_DOTS: Record<string, string> = {
  draft: "bg-amber-500",
  approved: "bg-green-600",
  active: "bg-blue-600",
  verified: "bg-green-600",
  succeeded: "bg-green-600",
  quarantined: "bg-amber-500",
  running: "bg-blue-600",
  rejected: "bg-red-600",
  failed: "bg-red-600",
};

export function StatusBadge({ status }: { status: string }) {
  const dot = STATUS_DOTS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-medium capitalize ${
        STATUS_STYLES[status] ?? STATUS_STYLES.completed
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
      {status}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className="tnum text-lg font-semibold tracking-[-0.02em]">{value.toFixed(0)}</span>;
}

export function StatChip({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "attention";
}) {
  const attention = tone === "attention" && Number(value) > 0;
  const body = (
    <div
      className={`rounded-[14px] border px-4 py-3.5 transition-colors duration-[120ms] ${
        attention
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50"
          : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      }`}
    >
      <div className="tnum text-2xl font-semibold tracking-[-0.02em]">{value}</div>
      <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Count chip that doubles as a filter (the stat-row pattern: every number is
 * clickable and filters the table below). `active` renders the selected state;
 * `href` toggles it. The tone is carried by the number itself rather than by a
 * bar of colour on top of the card.
 */
export function CountChip({
  label,
  value,
  href,
  active = false,
  tone,
}: {
  label: string;
  value: number | string;
  href?: string;
  active?: boolean;
  tone?: "green" | "sky" | "amber" | "neutral" | "red";
}) {
  const toneText: Record<string, string> = {
    green: "text-green-700 dark:text-green-400",
    sky: "text-blue-700 dark:text-blue-400",
    amber: "text-amber-700 dark:text-amber-400",
    red: "text-red-700 dark:text-red-400",
    neutral: "",
  };
  const body = (
    <div
      className={`min-w-[6.5rem] rounded-[12px] border px-3.5 py-2.5 transition-colors duration-[120ms] ${
        active
          ? "border-accent bg-accent text-white"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      }`}
    >
      <div
        className={`tnum text-xl font-semibold leading-none tracking-[-0.02em] ${
          active ? "text-white" : (tone && toneText[tone]) || ""
        }`}
      >
        {value}
      </div>
      <div
        className={`mt-1.5 text-[11px] font-medium ${
          active ? "text-white/75" : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {label}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Toolbar row above a data table: filters left, actions right. */
export function Toolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** GET-form search box that preserves other query params via hidden inputs. */
export function SearchBox({
  placeholder,
  name = "q",
  defaultValue,
  hidden = {},
}: {
  placeholder: string;
  name?: string;
  defaultValue?: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" className="relative">
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <svg
        viewBox="0 0 16 16"
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-60 rounded-[10px] border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm transition-colors duration-[120ms] placeholder:text-neutral-400 hover:border-neutral-300 focus:border-accent focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      />
    </form>
  );
}

/** Active-filter pill with an ✕ that removes just this filter. */
export function FilterPill({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash py-1 pl-3 pr-1.5 text-xs font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
      {label}
      <Link
        href={clearHref}
        aria-label={`Clear ${label}`}
        className="flex h-4 w-4 items-center justify-center rounded-full text-blue-500 transition-colors duration-[120ms] hover:bg-blue-600 hover:text-white"
      >
        ✕
      </Link>
    </span>
  );
}

/** Sortable column header: click toggles between this key asc/desc. */
export function SortHeader({
  label,
  sortKey,
  current,
  makeHref,
}: {
  label: string;
  sortKey: string;
  current: string; // e.g. "score" or "-score"
  makeHref: (sort: string) => string;
}) {
  const activeAsc = current === sortKey;
  const activeDesc = current === `-${sortKey}`;
  const active = activeAsc || activeDesc;
  const next = activeDesc ? sortKey : `-${sortKey}`;
  return (
    <Link
      href={makeHref(next)}
      className={`inline-flex items-center gap-1 transition-colors duration-[120ms] ${
        active ? "text-neutral-900 dark:text-neutral-100" : "hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      {label}
      <span className={`text-[9px] leading-none ${active ? "" : "opacity-25"}`}>
        {activeAsc ? "▲" : "▼"}
      </span>
    </Link>
  );
}

/** Tiny 7-bar dimension sparkline for table rows. */
export function DimensionBars({ values }: { values: number[] }) {
  return (
    <span className="inline-flex h-4 items-end gap-[2px]" title="dimensions">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px] bg-blue-500/70 dark:bg-blue-400/70"
          style={{ height: `${Math.max(12, v)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Evidence styling: the claim reads first, its provenance sits quietly beneath
 * it. Source, date and confidence are meta — never the same weight as the claim.
 */
export function EvidenceLine({ claim, meta }: { claim: string; meta: string }) {
  return (
    <li className="border-l-2 border-neutral-200 py-1 pl-3 text-sm leading-relaxed text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
      {claim}
      <span className="mt-0.5 block text-xs text-neutral-400 dark:text-neutral-500">{meta}</span>
    </li>
  );
}

/**
 * Data-completeness by category (§24): coverage, kept strictly separate from
 * propensity. Covered categories are solid; gaps are the research to-do list —
 * a gap is NOT low intent. Renders the 8 coverage categories as a chip row.
 */
export function CompletenessGrid({
  byCategory,
  overall,
}: {
  byCategory: Record<string, boolean>;
  overall: number;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="tnum text-2xl font-semibold tracking-[-0.02em]">{overall}%</span>
        <span className="text-xs text-neutral-500">categories with coverage</span>
      </div>
      <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-[200ms]"
          style={{ width: `${Math.min(100, Math.max(0, overall))}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byCategory).map(([cat, covered]) => (
          <span
            key={cat}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
              covered
                ? "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300"
                : "bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${covered ? "bg-green-600" : "bg-neutral-300 dark:bg-neutral-700"}`}
            />
            {cat}
          </span>
        ))}
      </div>
    </div>
  );
}

export const FEATURE_LABELS: Record<string, string> = {
  technology_fit: "Technology fit",
  trigger_events: "Trigger events",
  strategic_initiative: "Strategic initiative",
  momentum: "Momentum",
  partner_strength: "Partner strength",
  negative_signals: "Negative signals",
  already_installed: "Target already installed",
};
