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
 * Sizes: md (default, matches the px-4 py-1.5 text-copy CTA) and sm (px-3 py-1
 * text-body, for table-row and toolbar actions). `subtle` ignores size padding.
 */
/**
 * The button contract (Wave 1 §5).
 *
 * The variants are named for the ROLE an action plays on its surface, not for
 * the colour it happens to wear, because naming by colour is how a codebase
 * ends up with green "Approve", black "Save" and blue "Ask" all claiming to be
 * the dominant action on the same screen. That is what the audit found: 161
 * page-authored buttons, eleven of them green because their verb sounded
 * positive.
 *
 *   primary      the ONE dominant action here — brand accent
 *   secondary    a real alternative — neutral, bordered
 *   ghost        low emphasis, no chrome until hovered
 *   destructive  deletes, revokes, rejects, erases
 *   subtle       a link wearing a button's affordance; ignores size padding
 *
 * Green is a RESULT (a won deal, a verified fact), never a call to action.
 * `accent` and `danger` remain as aliases so existing call sites keep working.
 */
export type ButtonVariant =
  | "primary" | "secondary" | "ghost" | "destructive" | "subtle"
  | "accent"   // deprecated alias for primary
  | "danger";  // deprecated alias for destructive
export type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium " +
  "rounded-control transition-colors duration-[var(--dur-react)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50";

/* Fixed heights, so a row of buttons is a row of equal rectangles regardless of
   which variants or labels it contains. Padding alone never guaranteed that. */
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-label",
  md: "h-9 px-3.5 text-body",
  lg: "h-10 px-4 text-copy",
};

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong active:bg-accent-strong",
  secondary:
    "bg-[var(--surface-primary)] text-[var(--ink)] ring-1 ring-inset ring-[var(--border-subtle)] " +
    "hover:bg-[var(--surface-inset)]",
  ghost: "text-[var(--ink-soft)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]",
  destructive: "bg-rose text-white hover:brightness-110 active:brightness-95",
  subtle: "font-medium text-accent hover:underline dark:text-blue-300",
  accent: "bg-accent text-white hover:bg-accent-strong active:bg-accent-strong",
  danger: "bg-rose text-white hover:brightness-110 active:brightness-95",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  if (variant === "subtle") return `${BTN_BASE} ${BTN_VARIANT.subtle}`;
  return `${BTN_BASE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]}`;
}

/**
 * The form-control contract (Wave 1 §9).
 *
 * The audit found 48 inputs across 26 recipes, 27 selects across 12 and 9
 * textareas across 3 — all variations on one idea, differing by a border shade
 * here and a padding step there. They now share a height, a radius, a border, a
 * focus ring and a placeholder colour, so a form reads as a form rather than as
 * a collection of separately-styled boxes.
 *
 * Heights match the button scale exactly: a search field beside a button must
 * not sit two pixels proud of it.
 */
const FIELD_BASE =
  "rounded-control border bg-[var(--surface-primary)] text-[var(--ink)] " +
  "border-[var(--border-subtle)] placeholder:text-[var(--ink-faint)] " +
  "transition-colors duration-[var(--dur-react)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--surface-inset)]";

export type FieldSize = "sm" | "md";

/** `multiline` drops the fixed height — a textarea sizes to its rows — while every other part of the contract holds. */
export function fieldClass(size: FieldSize = "md", opts: { multiline?: boolean; invalid?: boolean } = {}): string {
  const height = opts.multiline ? "py-2 leading-relaxed" : size === "sm" ? "h-7" : "h-9";
  const pad = size === "sm" ? "px-2 text-label" : "px-2.5 text-body";
  // An invalid field says so in its border AND keeps its error text — colour
  // alone is not an accessible way to say "this is wrong".
  const invalid = opts.invalid ? " border-rose focus-visible:ring-rose/50 focus-visible:border-rose" : "";
  return `${FIELD_BASE} ${height} ${pad}${invalid}`;
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
 * Card tints (§7). Colour on a surface communicates what KIND of thing it is,
 * and only where that reading is load-bearing.
 *
 * This map previously offered seven decorative hues — indigo, violet, teal,
 * emerald, amber, rose — as "a shape you can read before you read it". Four of
 * them were never used, and two values that pages DID pass (`sky`, `green`)
 * were absent from the map entirely, so those cards silently rendered untinted
 * while their author believed otherwise. A palette nobody can predict is not a
 * system.
 *
 * What survives is what the pages actually meant, mapped onto the same semantic
 * tokens the metrics use, so there is one palette in the product rather than
 * two. The unused decorative hues are gone: they existed to make a grid look
 * varied, which is the rainbow this pass removes.
 */
const CARD_TONES: Record<string, string> = {
  default: "",
  neutral: "",
  /** AI-proposed / synthetic — the violet the token vocabulary already reserves. */
  violet: "from-[color-mix(in_srgb,var(--color-accent-violet)_10%,transparent)] dark:from-[color-mix(in_srgb,var(--color-accent-violet)_18%,transparent)]",
  /** Pending / needs attention. */
  amber: "from-[color-mix(in_srgb,var(--intent-warning)_10%,transparent)] dark:from-[color-mix(in_srgb,var(--intent-warning)_18%,transparent)]",
  /** Informational emphasis — the value `sky` used to pass and never receive. */
  sky: "from-[color-mix(in_srgb,var(--intent-info)_10%,transparent)] dark:from-[color-mix(in_srgb,var(--intent-info)_18%,transparent)]",
  /** Verified / positive — likewise `green`. */
  green: "from-[color-mix(in_srgb,var(--intent-positive)_10%,transparent)] dark:from-[color-mix(in_srgb,var(--intent-positive)_18%,transparent)]",
};

export type Tone = "violet" | "amber" | "sky" | "green" | "neutral";

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

/**
 * The five things a metric can mean (§2/§7). `neutral` is the default and the
 * common case — most numbers are just numbers. A metric earns a hue only when
 * its VALUE carries state the operator should react to, never to tell it apart
 * from the tile beside it.
 */
export type Intent = "positive" | "risk" | "warning" | "info" | "neutral";

/**
 * Metric — the ONE top-level summary tile for every room (§2).
 *
 * Container height, radius, padding, label position, figure size, secondary
 * annotation, border and shadow are settled here so Today, Pipeline, Partners
 * and Motions cannot drift into four KPI styles again. Nine call sites had
 * copy-pasted this component's internals verbatim (`pos-bento-fig tnum
 * text-display font-extrabold leading-none tracking-[-0.03em]`) and one had
 * invented its own `text-display font-semibold`; both are now this.
 *
 * `Bento` remains exported as the historical name so sixteen pages keep working.
 */
export function Metric({
  label,
  value,
  subs,
  href,
  intent,
  tone,
}: {
  label: string;
  value: string | number;
  subs?: (string | false | null | undefined)[];
  href?: string;
  /** What this number MEANS. Omit for the common case. */
  intent?: Intent;
  /** Legacy categorical tint, retained for the Pipeline filter chips. */
  tone?: string;
}) {
  const sub = (subs ?? []).filter(Boolean) as string[];
  const empty = Number(value) === 0;
  const inner = (
    <>
      <div className="pos-bento-fig pos-metric-fig">
        {value}
      </div>
      {/* Label sits BELOW the figure in every room. The figure is what the eye
          lands on; the label tells it what it just read. */}
      <div className="mt-1.5 text-body font-semibold ink-muted">{label}</div>
      {sub.length > 0 && <div className="mt-1 text-label ink-faint">{sub.join(" · ")}</div>}
    </>
  );
  /* flex-1 with a basis so a row is even whether the page laid it out with grid
     or with flex-wrap — some screens use each. */
  const cls = `pos-bento flex flex-1 basis-[148px] flex-col rounded-card p-4 ${
    empty ? "border border-dashed border-neutral-200 dark:border-neutral-800" : "glass"
  }`;
  const attrs = {
    "data-empty": empty ? "true" : undefined,
    "data-intent": intent,
    "data-tone": tone,
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

/** Historical name for {@link Metric}. Kept so existing call sites are untouched. */
export const Bento = Metric;

/**
 * SummaryBand — the standardized metric row (§1, §2).
 *
 * Every room's summary sits in one of these, so tile width, gutter and row
 * height are a property of the system rather than of whichever page was written
 * last. Pages previously used `flex flex-wrap gap-2`, `grid grid-cols-4 gap-3`
 * and `grid gap-2 sm:grid-cols-5` for the same job.
 */
export function SummaryBand({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pos-summary ${className}`}>{children}</div>;
}

/**
 * The page has exactly TWO heading levels below the PageHeader.
 *
 * `SectionHeading` is a real section — a thing with a name the reader would say
 * out loud ("Renewal radar", "Decisions that move revenue"). It gets title-size
 * ink and an optional one-clause hint.
 *
 * `BlockLabel` is the minor label over a list or a stat block ("At a glance",
 * "Recent activity"). It is chrome: small, uppercase, quiet.
 *
 * Both existed already, but only by accident. The label treatment was written
 * inline 96 times across 21 files with FOUR different bottom margins — no
 * margin, `mb-1`, `mb-2`, `mb-3` — so blocks that were visually identical sat
 * at four different distances from their own content. That is the kind of
 * inconsistency nobody can name and everybody feels.
 */
export function BlockLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`mb-2 text-copy font-semibold uppercase tracking-wide ink-faint ${className}`}>
      {children}
    </h2>
  );
}

/** A real section: title-size, with an optional one-clause hint and actions. */
export function SectionHeading({
  children,
  hint,
  actions,
}: {
  children: ReactNode;
  /** One short clause. Long explanation belongs behind disclosure, not here. */
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-title font-bold tracking-[-0.015em] ink">{children}</h2>
        {hint && <p className="mt-0.5 text-body ink-faint">{hint}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * Disclosure — the one progressive-detail control (§4, §5).
 *
 * Explanatory copy that teaches the product rather than helping the current
 * decision goes in here. Uncertainty never does: an UNKNOWN, a conflict or a
 * missing input stays on the surface where it can be seen without a click.
 */
export function Disclosure({
  summary,
  children,
  className = "",
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group ${className}`}>
      <summary className="cursor-pointer list-none text-body ink-muted underline-offset-2 hover:underline">
        {summary}
        <span className="ml-1 ink-faint group-open:hidden" aria-hidden>▸</span>
        <span className="ml-1 hidden ink-faint group-open:inline" aria-hidden>▾</span>
      </summary>
      <div className="mt-2 text-body leading-relaxed ink-soft">{children}</div>
    </details>
  );
}

/** Horizontal labeled bar chart — pure CSS, theme-safe, no dependencies. */
/*
 * Two readings, and they are NOT the same chart (§7).
 *
 * `categorical` (the default) is a set of different things — partners, sources,
 * families — and each bar takes its own hue because the hue is the identity.
 *
 * `ordered` is ONE measure sampled along a sequence: funnel stages, a horizon,
 * a ladder. Giving those bars seven hues says the stages are unrelated kinds,
 * which is false and is what made the Pipeline stage chart read as a rainbow.
 * An ordered series takes a single hue and lets LENGTH carry the comparison,
 * which is the only variable that actually differs.
 */
const CAT_BG = ["bg-cat-1", "bg-cat-2", "bg-cat-3", "bg-cat-4", "bg-cat-5", "bg-cat-6", "bg-cat-7"];

export function MiniBar({
  rows,
  unit,
  series = "categorical",
}: {
  rows: { label: string; value: number; href?: string }[];
  unit?: string;
  series?: "categorical" | "ordered";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const label = r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label;
        return (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-32 shrink-0 truncate text-body text-neutral-500">{label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-neutral-900/[0.06] dark:bg-white/10">
              <div
                className={`h-full rounded-full transition-[width] duration-[220ms] ${
                  series === "ordered" ? "bg-accent" : CAT_BG[i % CAT_BG.length]
                }`}
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
            <span className="tnum w-14 text-right text-body font-semibold text-neutral-600 dark:text-neutral-300">{r.value.toLocaleString()}{unit ?? ""}</span>
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
      <span className="text-copy text-green-800 dark:text-green-300">{message}</span>
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

/**
 * PageHeader — page title plus ONE concise purpose line (§1).
 *
 * The measure is capped at 62ch rather than 78: a purpose line is a sentence
 * that orients, not a paragraph that teaches. Anything longer than one line at
 * this measure is explaining the product, and §4 puts that behind disclosure.
 */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-hero font-extrabold leading-[1.1] tracking-[-0.03em] ink">{title}</h1>
      {subtitle && (
        <p className="mt-1.5 max-w-[62ch] text-copy leading-relaxed ink-muted">{subtitle}</p>
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-label font-bold ${BAND_STYLES[band] ?? BAND_STYLES.low}`}
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label font-bold capitalize ${STATUS_STYLES[status] ?? STATUS_STYLES.completed}`}
    >
      {STATUS_DOTS[status] && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOTS[status]}`} />
      )}
      {status}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className="tnum text-section font-semibold">{value.toFixed(0)}</span>;
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
        className="pos-bento-fig pos-metric-fig"
      >
        {value}
      </div>
      <div className="mt-1.5 text-body font-semibold ink-muted">{label}</div>
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
        className={`pos-bento-fig pos-metric-fig ${
          active ? "text-white" : (tone && figure[tone]) || ""
        }`}
      >
        {value}
      </div>
      <div
        className={`mt-1.5 text-label font-semibold ${
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
        className="w-60 rounded-full border border-neutral-300/70 bg-white/70 py-2 pl-9 pr-4 text-copy backdrop-blur transition-colors duration-[140ms] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-accent focus:outline-none dark:border-white/15 dark:bg-white/[0.06]"
      />
    </form>
  );
}

/** Active-filter pill with an ✕ that removes just this filter. */
export function FilterPill({ label, clearHref }: { label: string; clearHref: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 py-1 pl-3 pr-1.5 text-body font-semibold text-accent dark:text-blue-300">
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
      <span className={`text-micro leading-none ${activeAsc || activeDesc ? "" : "opacity-30"}`}>
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
      <span className="block text-copy leading-relaxed text-neutral-700 dark:text-neutral-300">{claim}</span>
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
        <span className="tnum text-section font-semibold ink">{overall}%</span>
        <span className="text-body text-neutral-500">categories with coverage</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(byCategory).map(([cat, covered]) => (
          <span
            key={cat}
            className={`inline-flex items-center gap-1 rounded-control px-2 py-1 text-body font-medium ring-1 ring-inset ${
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

/* ────────────────────────────────────────────────────────────────────────────
   Badge (§10) and the state vocabulary (§12).
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * One badge geometry, six semantic tones. The audit found equivalent states
 * wearing full-colour fills, hairline borders, bare dots and plain coloured
 * text depending on which page rendered them — so "verified" looked like a
 * different KIND of thing on two screens that both meant verified.
 *
 * Geometry never varies. Only the tone does, and tone is chosen by meaning.
 */
export type BadgeTone = "neutral" | "positive" | "warning" | "risk" | "info" | "provenance";

const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 " +
  "text-label font-semibold uppercase tracking-[0.04em] whitespace-nowrap";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-[var(--surface-inset)] text-[var(--ink-muted)]",
  positive: "bg-[color-mix(in_srgb,var(--intent-positive)_14%,transparent)] text-[var(--intent-positive)]",
  warning: "bg-[color-mix(in_srgb,var(--intent-warning)_14%,transparent)] text-[var(--intent-warning)]",
  risk: "bg-[color-mix(in_srgb,var(--intent-risk)_14%,transparent)] text-[var(--intent-risk)]",
  info: "bg-[color-mix(in_srgb,var(--intent-info)_14%,transparent)] text-[var(--intent-info)]",
  // Provenance is deliberately its own tone: "inferred" is not a warning and
  // not a success, it is a statement about where a fact came from.
  provenance: "bg-[color-mix(in_srgb,var(--color-accent-intelligence)_12%,transparent)] text-[var(--color-accent-intelligence)]",
};

export function badgeClass(tone: BadgeTone = "neutral"): string {
  return `${BADGE_BASE} ${BADGE_TONE[tone]}`;
}

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={badgeClass(tone)}>{children}</span>;
}

/**
 * The five absences (§12), which the product must never collapse into one grey
 * dash. PursuitOS's central invariant is that
 *
 *     UNKNOWN ≠ zero ≠ false ≠ unavailable
 *
 * and a UI that renders all of them as "—" destroys exactly the distinction the
 * fact graph exists to preserve. Each has its own word and its own weight:
 *
 *   zero         a known measurement that happens to be 0 — rendered as a NUMBER
 *   unknown      nobody has established this yet — the honest gap
 *   unavailable  the capability cannot answer right now
 *   disabled     the capability exists and is switched off
 *   empty        a collection with no members
 *
 * `zero` is not in this component on purpose: a known zero is a value, so it is
 * rendered by the normal value path (formatMoney gives "$0"), never here.
 */
/**
 * Assurance — one guarantee, stated as a mechanism (Trust center).
 *
 * Distinct from `Metric`, which answers "how much". This answers "how is that
 * prevented", and its value is a short mechanism rather than a figure. Trust
 * opened on four counters, three of which read 0 in a young tenant — which
 * makes an architecture that IS enforced look like an architecture nobody uses.
 * A guarantee does not become weaker because no one has exercised it yet.
 *
 * `note` is the live figure where one exists, so the mechanism and the evidence
 * for it sit together instead of in separate halves of the page.
 *
 * Carries no width of its own — the page owns the grid, so a set of six lays out
 * as two rows of three rather than as five and an orphan.
 */
export function Assurance({
  label,
  mechanism,
  note,
}: {
  label: string;
  mechanism: string;
  note?: string;
}) {
  return (
    <div
      className="flex flex-col rounded-card p-3.5"
      style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-low)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "var(--color-accent-verified)" }}
        />
        <span className="text-micro font-bold uppercase tracking-[0.05em] ink-faint">{label}</span>
      </div>
      <div className="mt-1.5 text-copy font-semibold leading-snug ink">{mechanism}</div>
      {note && <div className="mt-1 text-label ink-faint">{note}</div>}
    </div>
  );
}

export type AbsenceKind = "unknown" | "unavailable" | "disabled" | "empty";

const ABSENCE_LABEL: Record<AbsenceKind, string> = {
  unknown: "Not established",
  unavailable: "Unavailable",
  disabled: "Off",
  empty: "None yet",
};

export function Absence({ kind, detail, className = "" }: { kind: AbsenceKind; detail?: string; className?: string }) {
  // Unknown carries a dotted underline: it is a gap someone could close, and it
  // should not read like a system limitation. The other three are plain, quiet
  // statements of fact.
  const emphasis =
    kind === "unknown"
      ? "underline decoration-dotted decoration-[var(--ink-faint)] underline-offset-2"
      : "";
  return (
    <span className={`text-body text-[var(--ink-muted)] ${emphasis} ${className}`} title={detail}>
      {ABSENCE_LABEL[kind]}
    </span>
  );
}
