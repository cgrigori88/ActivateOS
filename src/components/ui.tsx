import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared primitives implementing the brand kit (docs/BRAND.md).
 *
 * Export names and prop signatures are stable — the platform lane's screens
 * consume these unchanged. Everything here is styling.
 *
 * The organising rule is **weight follows information**: a surface holding data
 * looks alive, a surface holding zeros recedes. That is what stops Sources
 * spending 2,000px of height on eighteen empty cards.
 */

/**
 * Tones give a grid of cards a shape you can read before you read it — the
 * bento pattern. Colour here is categorical, never a call to action; blue stays
 * reserved for things you click.
 */
const CARD_TONES: Record<string, string> = {
  default: "border-neutral-200 bg-white",
  indigo: "border-indigo/15 bg-indigo-wash",
  violet: "border-violet/15 bg-violet-wash",
  teal: "border-teal/15 bg-teal-wash",
  emerald: "border-emerald/15 bg-emerald-wash",
  amber: "border-amber/15 bg-amber-wash",
  rose: "border-rose/15 bg-rose-wash",
  ink: "border-transparent bg-rail text-rail-ink",
};

export type CardTone = keyof typeof CARD_TONES;

export function Card({
  children,
  className = "",
  muted = false,
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  /** Dim a panel that has nothing in it yet. */
  muted?: boolean;
  /** Categorical tint for bento grids. */
  tone?: CardTone;
}) {
  return (
    <section
      className={`rounded-card border p-5 transition-colors duration-[140ms] ${
        muted
          ? "border-neutral-200/70 bg-neutral-50/40 dark:border-neutral-800/60 dark:bg-neutral-900/30"
          : `${CARD_TONES[tone] ?? CARD_TONES.default} dark:border-neutral-800 dark:bg-neutral-900`
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-7">
      <h1 className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em]">{title}</h1>
      {subtitle && (
        <p className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </p>
      )}
    </header>
  );
}

/**
 * A scannable landmark for a panel. The Account room stacks six panels of equal
 * weight; a heading with its count gives the eye somewhere to land.
 */
export function SectionHeading({
  children,
  count,
  hint,
  tone,
}: {
  children: ReactNode;
  count?: number | string;
  hint?: string;
  /** Optional accent dot, for a bento grid where each panel owns a hue. */
  tone?: "indigo" | "violet" | "teal" | "emerald" | "amber" | "rose" | "blue";
}) {
  const dot: Record<string, string> = {
    indigo: "bg-indigo",
    violet: "bg-violet",
    teal: "bg-teal",
    emerald: "bg-emerald",
    amber: "bg-amber",
    rose: "bg-rose",
    blue: "bg-accent",
  };
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {tone && <span className={`h-2 w-2 shrink-0 rounded-full ${dot[tone]}`} />}
      {/* Titles are ink and bold. A grey uppercase micro-label reads as chrome,
          and a screen made entirely of chrome has no hierarchy at all. */}
      <h2 className="text-[15px] font-bold tracking-[-0.015em] text-neutral-900 dark:text-neutral-100">
        {children}
      </h2>
      {count !== undefined && (
        <span className="tnum rounded-full bg-neutral-900/8 px-2 py-0.5 text-[11.5px] font-bold text-neutral-600 dark:bg-neutral-100/10 dark:text-neutral-300">
          {count}
        </span>
      )}
      {hint && <span className="text-[12.5px] text-neutral-400 dark:text-neutral-500">{hint}</span>}
    </div>
  );
}

/** Caps the measure. A 120-word motion narrative at full width runs ~160 characters per line. */
export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`max-w-[72ch] text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 ${className}`}>
      {children}
    </div>
  );
}

/** Selection reads the same everywhere: accent wash, never a black pill. */
export function Tabs({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

export function Tab({
  children,
  href,
  active = false,
}: {
  children: ReactNode;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-[32px] items-center rounded-control px-3 text-[13px] font-semibold transition-colors duration-[140ms] ${
        active
          ? "bg-accent-wash text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </Link>
  );
}

/** Bands describe the data. Quiet fills, no rings — the label carries the meaning. */
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
      className={`inline-flex items-center rounded-inner px-2 py-0.5 text-[11.5px] font-semibold ${
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
  verified: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  succeeded: "bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300",
  quarantined: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  skipped: "bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600",
  running: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  disabled: "bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600",
};

/** A dot carries the state at a glance; the word confirms it — never colour alone. */
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
      className={`inline-flex items-center gap-1.5 rounded-inner px-2 py-0.5 text-[11.5px] font-semibold capitalize ${
        STATUS_STYLES[status] ?? STATUS_STYLES.completed
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
      {status}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className="tnum text-lg font-bold tracking-[-0.02em]">{value.toFixed(0)}</span>;
}

/** Zero recedes. A count of nothing should not shout as loudly as a count of 24. */
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
  const empty = Number(value) === 0;
  const attention = tone === "attention" && !empty;
  const body = (
    <div
      className={`rounded-card border px-4 py-3.5 transition-colors duration-[140ms] ${
        attention
          ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50"
          : empty
            ? "border-neutral-200/70 bg-neutral-50/40 dark:border-neutral-800/60 dark:bg-neutral-900/30"
            : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
      }`}
    >
      <div
        className={`tnum text-2xl font-bold tracking-[-0.02em] ${
          empty ? "text-neutral-300 dark:text-neutral-700" : ""
        }`}
      >
        {value}
      </div>
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
 * Count chip that doubles as a filter. `active` renders the selected state;
 * `href` toggles it. Tone rides the number rather than a bar of colour on top,
 * and a zero drops back so the row reads as "one very high" not "five numbers".
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
  const empty = Number(value) === 0;
  // The figure carries the hue and the card carries its wash, so a row of
  // chips reads as distinct measures rather than five identical boxes.
  const toneText: Record<string, string> = {
    green: "text-emerald",
    sky: "text-accent",
    amber: "text-amber",
    red: "text-rose",
    neutral: "",
  };
  const toneSkin: Record<string, string> = {
    green: "border-emerald/20 bg-emerald-wash hover:border-emerald/35",
    sky: "border-accent/20 bg-accent-wash hover:border-accent/35",
    amber: "border-amber/20 bg-amber-wash hover:border-amber/35",
    red: "border-rose/20 bg-rose-wash hover:border-rose/35",
    neutral: "border-neutral-200 bg-white hover:border-neutral-300",
  };
  const body = (
    <div
      className={`min-w-[6.5rem] rounded-input border px-3.5 py-2.5 transition-colors duration-[140ms] ${
        active
          ? "border-accent bg-accent text-white"
          : empty
            ? "border-neutral-200/70 bg-neutral-50/40 dark:border-neutral-800/60 dark:bg-neutral-900/30"
            : `${(tone && toneSkin[tone]) || toneSkin.neutral} dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700`
      }`}
    >
      <div
        className={`tnum text-[26px] font-extrabold leading-none tracking-[-0.03em] ${
          active
            ? "text-white"
            : empty
              ? "text-neutral-300 dark:text-neutral-700"
              : (tone && toneText[tone]) || ""
        }`}
      >
        {value}
      </div>
      <div
        className={`mt-1.5 text-[11px] font-semibold ${
          active
            ? "text-white/75"
            : empty
              ? "text-neutral-400 dark:text-neutral-600"
              : "text-neutral-500 dark:text-neutral-400"
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
        strokeWidth="1.7"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        spellCheck={false}
        className="w-60 rounded-input border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm transition-colors duration-[140ms] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-accent focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600"
      />
    </form>
  );
}

/** Active-filter pill with an ✕ that removes just this filter. */
export function FilterPill({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-wash py-1 pl-3 pr-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
      {label}
      <Link
        href={clearHref}
        aria-label={`Clear ${label}`}
        className="flex h-5 w-5 items-center justify-center rounded-full text-blue-500 transition-colors duration-[140ms] hover:bg-blue-600 hover:text-white"
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
      aria-sort={active ? (activeAsc ? "ascending" : "descending") : undefined}
      className={`inline-flex items-center gap-1 transition-colors duration-[140ms] ${
        active
          ? "text-neutral-900 dark:text-neutral-100"
          : "hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      {label}
      <span className={`text-[9px] leading-none ${active ? "" : "opacity-25"}`}>
        {activeAsc ? "▲" : "▼"}
      </span>
    </Link>
  );
}

/** Tiny 7-bar dimension sparkline for table rows, on the conviction ramp. */
export function DimensionBars({ values }: { values: number[] }) {
  const fill = (v: number) =>
    v >= 80 ? "bg-ramp-4" : v >= 60 ? "bg-ramp-3" : v >= 40 ? "bg-ramp-2" : v >= 20 ? "bg-ramp-1" : "bg-ramp-0";
  return (
    <span className="inline-flex h-4 items-end gap-[2px]" title="dimensions">
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-[1px] ${fill(v)}`}
          style={{ height: `${Math.max(12, v)}%` }}
        />
      ))}
    </span>
  );
}

/**
 * Evidence: the claim reads first, its provenance sits quietly beneath in mono.
 * The old form buried source and confidence in parentheses at the end of the
 * sentence, where they competed with the claim instead of supporting it.
 */
export function EvidenceLine({ claim, meta }: { claim: string; meta: string }) {
  return (
    <li className="border-l-2 border-neutral-200 py-1 pl-3 dark:border-neutral-700">
      <span className="block text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {claim}
      </span>
      <span className="mt-0.5 block font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
        {meta}
      </span>
    </li>
  );
}

/**
 * Data-completeness by category (§24): coverage, kept strictly separate from
 * propensity. Covered categories are solid; gaps are the research to-do list —
 * a gap is NOT low intent.
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
        <span className="tnum text-2xl font-bold tracking-[-0.02em]">{overall}%</span>
        <span className="text-xs text-neutral-500">categories with coverage</span>
      </div>
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-[220ms]"
          style={{ width: `${Math.min(100, Math.max(0, overall))}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byCategory).map(([cat, covered]) => (
          <span
            key={cat}
            className={`inline-flex items-center gap-1.5 rounded-inner px-2 py-1 text-xs font-medium ${
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
