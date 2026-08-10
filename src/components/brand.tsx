import type { CSSProperties, ReactNode } from "react";

/**
 * Meridian brand primitives (design_handoff_pursuitos_brand).
 *
 * Kept separate from `ui.tsx` so the marketing surface can adopt the brand
 * system without colliding with the platform lane's edits to the app
 * primitives. Values here are exact per the handoff — do not tune them.
 */

/* -------------------------------------------------------------------------
   The mark — a circle carrying two voids on one axis.
   Never rotate (bearing fixed at 29°), never colour the counters separately,
   never outline. At 16px and below the forward counter is dropped.
   ------------------------------------------------------------------------- */

export function Mark({ size = 24, className = "" }: { size?: number; className?: string }) {
  const solid = size <= 16;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      fillRule="nonzero"
      aria-hidden
      focusable="false"
    >
      {solid ? (
        <path d="M4 24 A20 20 0 1 1 44 24 A20 20 0 1 1 4 24 Z M29 26 A10 10 0 1 0 9 26 A10 10 0 1 0 29 26 Z" />
      ) : (
        <path d="M4 24 A20 20 0 1 1 44 24 A20 20 0 1 1 4 24 Z M29 26 A10 10 0 1 0 9 26 A10 10 0 1 0 29 26 Z M39 17 A4 4 0 1 0 31 17 A4 4 0 1 0 39 17 Z" />
      )}
    </svg>
  );
}

/** Wordmark tracking tightens as size grows: -0.046em @34, -0.040em @23, -0.026em @15. */
function wordmarkTracking(px: number): string {
  if (px >= 30) return "-0.046em";
  if (px >= 20) return "-0.040em";
  return "-0.026em";
}

/**
 * Primary lockup: mark + wordmark on one line, gap = 40% of the mark's height.
 * `size` is the wordmark size in px; the mark is matched to it.
 */
export function Lockup({ size = 15, markSize }: { size?: number; markSize?: number }) {
  const mark = markSize ?? Math.round(size * 1.2);
  return (
    <span className="inline-flex items-center" style={{ gap: `${mark * 0.4}px` }}>
      <Mark size={mark} />
      <span
        style={{
          fontSize: `${size}px`,
          fontWeight: 500,
          letterSpacing: wordmarkTracking(size),
          lineHeight: 1,
        }}
      >
        PursuitOS
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------
   Type primitives
   ------------------------------------------------------------------------- */

/** Bracketed mono eyebrow. Precedes almost every section heading. */
export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`pos-micro ${className}`}>[ {children} ]</p>;
}

/** Section number — the warm pair carries these. Never a fill. */
export function SectionNumber({ n }: { n: string }) {
  return (
    <span className="pos-num text-[13px]" style={{ color: "var(--pos-honey)" }}>
      {n}
    </span>
  );
}

export function SectionHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`text-[clamp(30px,4.4vw,44px)] font-medium ${className}`}
      style={{ letterSpacing: "-0.040em", lineHeight: 1.08 }}
    >
      {children}
    </h2>
  );
}

export function Lead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-[clamp(17px,1.6vw,20px)] ${className}`}
      style={{ lineHeight: 1.55, color: "var(--pos-fg-muted)" }}
    >
      {children}
    </p>
  );
}

export function Body({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[17px] ${className}`} style={{ lineHeight: 1.62, color: "var(--pos-fg-muted)" }}>
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------
   Controls — radius 8px, no glow, no shadow.
   ------------------------------------------------------------------------- */

const BUTTON_BASE =
  "pos-reaction inline-flex items-center justify-center whitespace-nowrap font-semibold";

export function ButtonPrimary({
  children,
  href,
  large = false,
}: {
  children: ReactNode;
  href: string;
  large?: boolean;
}) {
  return (
    <a
      href={href}
      className={`${BUTTON_BASE} hover:brightness-95`}
      style={{
        background: "var(--pos-accent)",
        color: "var(--pos-accent-fg)",
        fontSize: large ? "14.5px" : "14px",
        padding: large ? "13px 24px" : "12px 22px",
        borderRadius: "var(--pos-r-button)",
      }}
    >
      {children}
    </a>
  );
}

export function ButtonSecondary({
  children,
  href,
  large = false,
}: {
  children: ReactNode;
  href: string;
  large?: boolean;
}) {
  return (
    <a
      href={href}
      className={`${BUTTON_BASE} hover:bg-white/5`}
      style={{
        background: "transparent",
        color: "var(--pos-fg)",
        fontWeight: 500,
        border: "1px solid var(--pos-line-strong)",
        fontSize: large ? "14.5px" : "14px",
        padding: large ? "12px 23px" : "11px 21px",
        borderRadius: "var(--pos-r-button)",
      }}
    >
      {children}
    </a>
  );
}

/* -------------------------------------------------------------------------
   Surfaces
   ------------------------------------------------------------------------- */

export function Panel({
  children,
  className = "",
  glass = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  glass?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: glass ? "var(--pos-panel-glass)" : "var(--pos-surface)",
        border: "1px solid var(--pos-line-soft)",
        borderRadius: "var(--pos-r-panel)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Grids of panels are built as a 1px-gap grid over a --pos-line-soft
 * background, so the gaps read as hairlines rather than as borders.
 */
export function HairlineGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid gap-px ${className}`}
      style={{
        background: "var(--pos-line-soft)",
        border: "1px solid var(--pos-line-soft)",
        borderRadius: "var(--pos-r-panel)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** A cell inside a HairlineGrid — carries the ground so the gaps show through. */
export function HairlineCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={{ background: "var(--pos-canvas)" }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Data display
   ------------------------------------------------------------------------- */

/**
 * Metric. Mono, tabular, tracking -0.04em. A metric that is the system's
 * assertion takes the accent; everything else stays --pos-fg.
 */
export function Metric({
  label,
  value,
  assertion = false,
  size = 34,
}: {
  label: string;
  value: string;
  assertion?: boolean;
  size?: number;
}) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div
        className="pos-num mt-2"
        style={{
          fontSize: `${size}px`,
          lineHeight: 1,
          color: assertion ? "var(--pos-accent)" : "var(--pos-fg)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

const RAMP = [
  "var(--pos-ramp-0)",
  "var(--pos-ramp-1)",
  "var(--pos-ramp-2)",
  "var(--pos-ramp-3)",
  "var(--pos-ramp-4)",
];

/** Conviction ramp: propensity heat, 0.00 -> 1.00. */
export function rampColor(weight: number): string {
  const i = Math.min(RAMP.length - 1, Math.max(0, Math.round(weight * (RAMP.length - 1))));
  return RAMP[i];
}

/**
 * Evidence row — three columns: label, a 4px bar on --pos-raised filled from
 * the conviction ramp, and the mono score right-aligned in muted type.
 */
export function EvidenceRow({ label, weight }: { label: string; weight: number }) {
  return (
    <div className="grid items-center gap-4 py-2.5" style={{ gridTemplateColumns: "1fr 96px 42px" }}>
      <span className="text-[14px]" style={{ letterSpacing: "-0.024em" }}>
        {label}
      </span>
      <span className="h-1 w-full overflow-hidden" style={{ background: "var(--pos-raised)" }}>
        <span
          className="block h-full"
          style={{ width: `${Math.round(weight * 100)}%`, background: rampColor(weight) }}
        />
      </span>
      <span className="pos-num text-right text-[13px]" style={{ color: "var(--pos-fg-muted)" }}>
        {weight.toFixed(2)}
      </span>
    </div>
  );
}
