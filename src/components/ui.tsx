import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Shared primitives implementing the design tokens (docs/DESIGN.md §3). */

/**
 * Canonical button class (design-pass DRIFT-2 fix). Before this, 160+ buttons
 * each hand-wrote padding/height/text-size/color, so no two primary buttons
 * matched — the root of the "broken button row heights / uneven padding"
 * drift. One place now owns the geometry and the token-backed color per
 * variant; every button that uses it is the same height for a given size.
 *
 *  - primary  the dominant dark-ink CTA (Add member, Save, Generate…)
 *  - accent   the brand-blue CTA reserved for the primary next step
 *  - danger   destructive fills (Suppress, Erase) on the negative token
 *  - ghost    outlined/secondary (Decline, Cancel)
 *  - subtle   text-only inline action (remove / revoke / edit links)
 *
 * Sizes: md (default, matches the px-4 py-1.5 text-sm CTA) and sm (px-3 py-1
 * text-xs, for table-row and toolbar actions). `subtle` ignores size padding.
 */
export type ButtonVariant = "primary" | "accent" | "danger" | "ghost" | "subtle";
export type ButtonSize = "sm" | "md";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-[var(--dur-react)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "rounded-md bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200",
  accent: "rounded-md bg-accent text-white hover:bg-accent-strong",
  danger: "rounded-md bg-rose text-white hover:brightness-110",
  ghost:
    "rounded-md text-neutral-700 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 " +
    "dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-900",
  subtle: "font-medium text-accent hover:underline dark:text-blue-300",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-xs",
  md: "px-4 py-1.5 text-sm",
};

/** The class string for a button/CTA, so `<Link>` CTAs can match `<button>`. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  if (variant === "subtle") return `${BTN_BASE} ${BTN_VARIANT.subtle}`;
  return `${BTN_BASE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${buttonClass(variant, size)} ${className}`} {...props}>
      {children}
    </button>
  );
}

/**
 * Tones give a grid of cards a shape you can read before you read it. Colour
 * here is categorical, never a call to action — the accent stays reserved for
 * things you click. Each tone is a wash that fades toward the bottom edge, so a
 * surface reads as lit from above like the glass layers do.
 */
const CARD_TONES: Record<string, string> = {
  default: "",
  indigo: "from-indigo/10 dark:from-indigo/20",
  violet: "from-violet/10 dark:from-violet/20",
  teal: "from-teal/10 dark:from-teal/20",
  emerald: "from-emerald/10 dark:from-emerald/20",
  amber: "from-amber/10 dark:from-amber/20",
  rose: "from-rose/10 dark:from-rose/20",
  neutral: "",
};

export type Tone = "indigo" | "violet" | "teal" | "emerald" | "amber" | "rose" | "blue" | "neutral";

export function Card({
  children,
  className = "",
  tone,
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  /** Categorical tint for bento grids. */
  tone?: Tone;
  /** Dim a panel that has nothing in it yet. */
  muted?: boolean;
}) {
  const tint = tone ? CARD_TONES[tone] ?? "" : "";
  return (
    <section
      className={`pos-card glass rounded-card p-5 ${
        muted ? "opacity-70 shadow-none" : ""
      } ${tint ? `bg-gradient-to-b ${tint} to-transparent` : ""} ${className}`}
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
    <Link href={href} className="pos-backlink">
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}

/** Summary stat tile used across screens. Optionally linkable. */
export function Bento({
  label,
  value,
  subs,
  href,
}: {
  label: string;
  value: string | number;
  subs?: (string | false | null | undefined)[];
  href?: string;
}) {
  const sub = (subs ?? []).filter(Boolean) as string[];
  const empty = Number(value) === 0;
  const inner = (
    <>
      <div
        className={`pos-bento-fig tnum text-display font-extrabold leading-none tracking-[-0.03em] ${
          empty ? "text-neutral-300 dark:text-neutral-700" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-neutral-500">{label}</div>
      {sub.length > 0 && (
        <div className="mt-1 text-label text-neutral-400 dark:text-neutral-500">{sub.join(" · ")}</div>
      )}
    </>
  );
  /* flex-1 with a basis so a row is even whether the page laid it out with grid
     or with flex-wrap — some screens use each. */
  const cls = `pos-bento flex-1 basis-[132px] rounded-card p-4 ${
    empty ? "border border-dashed border-neutral-200 dark:border-neutral-800" : "glass"
  }`;
  const attrs = { "data-empty": empty ? "true" : undefined };
  return href ? (
    <Link href={href} {...attrs} className={`pos-lift block ${cls}`}>
      {inner}
    </Link>
  ) : (
    <div {...attrs} className={cls}>
      {inner}
    </div>
  );
}

/** Horizontal labeled bar chart — pure CSS, theme-safe, no dependencies. */
/* A labelled bar chart is categorical — each row is a different thing, not a
   sample of one thing — so the bars take the categorical order. */
const CAT_BG = ["bg-cat-1", "bg-cat-2", "bg-cat-3", "bg-cat-4", "bg-cat-5", "bg-cat-6", "bg-cat-7"];

export function MiniBar({ rows, unit }: { rows: { label: string; value: number; href?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const label = r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label;
        return (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-32 shrink-0 truncate text-[12px] text-neutral-500">{label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-900/[0.06] dark:bg-white/10">
              <div
                className={`h-full rounded-full ${CAT_BG[i % CAT_BG.length]} transition-[width] duration-[220ms]`}
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
            <span className="tnum w-14 text-right text-[12px] font-semibold text-neutral-600 dark:text-neutral-300">{r.value.toLocaleString()}{unit ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Next-step banner (#79, PLATFORM-REVIEW-2 §III.C): a terminal action pulls
 * the operator into the next room instead of leaving them to find it. Green
 * is the "it worked" ground; the CTA is the only button in the strip.
 */
export function NextStep({ message, href, cta }: { message: string; href: string; cta: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-green-300 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950">
      <span className="text-sm text-green-800 dark:text-green-300">{message}</span>
      <Link
        href={href}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-body font-bold text-white shadow-[var(--shadow-float)] transition-colors duration-[140ms] hover:bg-blue-800"
      >
        {cta}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-7">
      <h1 className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em]">{title}</h1>
      {subtitle && (
        <p className="mt-2 max-w-[78ch] text-title leading-relaxed text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </p>
      )}
    </header>
  );
}

const BAND_STYLES: Record<string, string> = {
  very_high: "bg-emerald/12 text-emerald dark:text-emerald-300",
  high: "bg-accent/12 text-accent dark:text-blue-300",
  medium: "bg-amber/14 text-amber dark:text-amber-300",
  low: "bg-neutral-500/12 text-neutral-500 dark:text-neutral-400",
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
      /* The table tints its row off this attribute — see globals.css. */
      data-band={band}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${BAND_STYLES[band] ?? BAND_STYLES.low}`}
    >
      {BAND_LABELS[band] ?? band}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber/14 text-amber dark:text-amber-300",
  approved: "bg-emerald/12 text-emerald dark:text-emerald-300",
  active: "bg-accent/12 text-accent dark:text-blue-300",
  completed: "bg-neutral-500/12 text-neutral-500 dark:text-neutral-400",
  abandoned: "bg-neutral-500/10 text-neutral-500 line-through dark:text-neutral-500",
  // Evidence quality-gate outcomes + provider-run states (intelligence surface).
  verified: "bg-emerald/12 text-emerald dark:text-emerald-300",
  succeeded: "bg-emerald/12 text-emerald dark:text-emerald-300",
  quarantined: "bg-amber/14 text-amber dark:text-amber-300",
  skipped: "bg-neutral-500/10 text-neutral-400 dark:text-neutral-600",
  running: "bg-accent/12 text-accent dark:text-blue-300",
  rejected: "bg-rose/12 text-rose dark:text-rose-300",
  failed: "bg-rose/12 text-rose dark:text-rose-300",
  disabled: "bg-neutral-500/10 text-neutral-400 dark:text-neutral-600",
};

/* A dot carries the state at a glance; the word confirms it — never colour
   alone, which also keeps it readable in greyscale. */
const STATUS_DOTS: Record<string, string> = {
  draft: "bg-amber",
  approved: "bg-emerald",
  active: "bg-accent",
  verified: "bg-emerald",
  succeeded: "bg-emerald",
  quarantined: "bg-amber",
  running: "bg-accent",
  rejected: "bg-rose",
  failed: "bg-rose",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.completed}`}
    >
      {STATUS_DOTS[status] && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOTS[status]}`} />
      )}
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
  const empty = Number(value) === 0;
  /* The pos-bento hooks live on the OUTER element (the Link when clickable):
     nested inside it, :nth-child saw one child per link and every tile
     resolved to the same position — which is why positional colour never
     showed on stat rows. (Ported from design PR #7.) */
  const cls = `pos-bento rounded-card p-4 ${
    tone === "attention" && !empty
      ? "border border-amber/30 bg-amber/10"
      : empty
        ? "border border-dashed border-neutral-200 dark:border-neutral-800"
        : "glass"
  }`;
  const inner = (
    <>
      <div
        className={`pos-bento-fig tnum text-display font-extrabold leading-none tracking-[-0.03em] ${
          empty ? "text-neutral-300 dark:text-neutral-700" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-neutral-500 dark:text-neutral-400">{label}</div>
    </>
  );
  const attrs = { "data-empty": empty ? "true" : undefined };
  return href ? (
    <Link href={href} {...attrs} className={`pos-lift block ${cls}`}>
      {inner}
    </Link>
  ) : (
    <div {...attrs} className={cls}>
      {inner}
    </div>
  );
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
  const empty = Number(value) === 0;
  /* The figure carries the hue. `data-tone` opts the tile out of the positional
     colouring in globals.css, and `data-active` out of both that and the tint —
     the selected chip sits on a solid accent fill, and a blue figure on a blue
     ground is invisible. */
  const figure: Record<string, string> = {
    green: "text-emerald",
    sky: "text-accent",
    amber: "text-amber",
    /* Left as default ink the inert band became the loudest number in the row,
       which reads backwards. */
    neutral: "text-neutral-500",
    red: "text-rose",
  };
  const cls = `pos-bento min-w-[6.5rem] rounded-card px-4 py-3 ${
    active
      ? "border border-accent bg-accent text-white shadow-[var(--shadow-float)]"
      : empty
        ? "border border-dashed border-neutral-200 dark:border-neutral-800"
        : "glass"
  }`;
  const inner = (
    <>
      <div
        className={`pos-bento-fig tnum text-display font-extrabold leading-none tracking-[-0.03em] ${
          active
            ? "text-white"
            : empty
              ? "text-neutral-300 dark:text-neutral-700"
              : (tone && figure[tone]) || ""
        }`}
      >
        {value}
      </div>
      <div
        className={`mt-1.5 text-[11.5px] font-semibold ${
          active ? "text-white/75" : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {label}
      </div>
    </>
  );
  const attrs = {
    "data-tone": tone,
    "data-empty": empty ? "true" : undefined,
    "data-active": active ? "true" : undefined,
  };
  return href ? (
    <Link href={href} {...attrs} className={`pos-lift block ${cls}`}>
      {inner}
    </Link>
  ) : (
    <div {...attrs} className={cls}>
      {inner}
    </div>
  );
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
        className="w-60 rounded-full border border-neutral-300/70 bg-white/70 py-2 pl-9 pr-4 text-sm backdrop-blur transition-colors duration-[140ms] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-accent focus:outline-none dark:border-white/15 dark:bg-white/[0.06]"
      />
    </form>
  );
}

/** Active-filter pill with an ✕ that removes just this filter. */
export function FilterPill({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 py-1 pl-3 pr-1.5 text-xs font-semibold text-accent dark:text-blue-300">
      {label}
      <Link
        href={clearHref}
        aria-label={`Clear ${label}`}
        className="flex h-5 w-5 items-center justify-center rounded-full text-accent/70 transition-colors duration-[140ms] hover:bg-accent hover:text-white dark:text-blue-300/70"
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
    <span className="inline-flex h-5 items-end gap-[3px]" title="dimension contributions">
      {values.map((v, i) => (
        <span
          key={i}
          className={`w-[4px] rounded-[1.5px] ${CAT_BG[i % CAT_BG.length]}`}
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
    <li className="border-l-2 border-neutral-200 py-1 pl-3 dark:border-neutral-700">
      <span className="block text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{claim}</span>
      <span className="mt-0.5 block font-mono text-label text-neutral-400 dark:text-neutral-500">{meta}</span>
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
