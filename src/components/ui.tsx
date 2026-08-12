import Link from "next/link";
import type { ReactNode } from "react";

/** Shared primitives implementing the design tokens (docs/DESIGN.md §3). */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * Constant back-nav: a ← link that names the screen it returns to, placed at
 * the top of any drilled-into screen. `label` is the destination's name.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
    </header>
  );
}

const BAND_STYLES: Record<string, string> = {
  very_high: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  high: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  medium: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
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
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BAND_STYLES[band] ?? BAND_STYLES.low}`}
    >
      {BAND_LABELS[band] ?? band}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  active: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  completed: "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
  abandoned: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 line-through dark:bg-neutral-800",
  // Evidence quality-gate outcomes + provider-run states (intelligence surface).
  verified: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  succeeded: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  quarantined: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  skipped: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
  running: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  rejected: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
  failed: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
  disabled: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-500",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLES[status] ?? STATUS_STYLES.completed}`}
    >
      {status}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className="tnum text-lg font-semibold">{value.toFixed(0)}</span>;
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
  const body = (
    <div
      className={`rounded-lg border px-4 py-3 ${
        tone === "attention" && Number(value) > 0
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="tnum text-2xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/**
 * Count chip that doubles as a filter (the stat-row pattern: every number
 * is clickable and filters the table below). `active` renders the selected
 * state; `href` toggles it.
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
  const toneBar: Record<string, string> = {
    green: "bg-green-600",
    sky: "bg-sky-600",
    amber: "bg-amber-500",
    red: "bg-red-600",
    neutral: "bg-neutral-400",
  };
  const body = (
    <div
      className={`relative min-w-[5.5rem] overflow-hidden rounded-lg border px-3 py-2 transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      }`}
    >
      {tone && !active && (
        <span className={`absolute inset-x-0 top-0 h-0.5 ${toneBar[tone]}`} />
      )}
      <div className="tnum text-lg font-semibold leading-tight">{value}</div>
      <div
        className={`text-[10px] font-medium uppercase tracking-wider ${
          active ? "text-neutral-300 dark:text-neutral-600" : "text-neutral-500"
        }`}
      >
        {label}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Toolbar row above a data table: filters left, actions right. */
export function Toolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
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
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
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
        className="w-56 rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
      />
    </form>
  );
}

/** Active-filter pill with an ✕ that removes just this filter. */
export function FilterPill({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      {label}
      <Link href={clearHref} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
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
  const next = activeDesc ? sortKey : `-${sortKey}`;
  return (
    <Link href={makeHref(next)} className="inline-flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200">
      {label}
      <span className={`text-[9px] leading-none ${activeAsc || activeDesc ? "" : "opacity-30"}`}>
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
          className="w-[3px] rounded-sm bg-blue-600/70 dark:bg-blue-400/70"
          style={{ height: `${Math.max(12, v)}%` }}
        />
      ))}
    </span>
  );
}

export function EvidenceLine({
  claim,
  meta,
}: {
  claim: string;
  meta: string;
}) {
  return (
    <li className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
      {claim} <span className="text-xs text-neutral-400 dark:text-neutral-500">({meta})</span>
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
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tnum text-2xl font-semibold">{overall}%</span>
        <span className="text-xs text-neutral-500">categories with coverage</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byCategory).map(([cat, covered]) => (
          <span
            key={cat}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
              covered
                ? "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300"
                : "bg-neutral-50 text-neutral-400 ring-neutral-300/40 dark:bg-neutral-900 dark:text-neutral-600"
            }`}
          >
            <span aria-hidden>{covered ? "●" : "○"}</span>
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
