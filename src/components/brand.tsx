/**
 * The PursuitOS mark and wordmark, from the brand handoff.
 *
 * Only the identity is taken from that kit — the mark, its construction, and
 * the wordmark's type treatment. Colour, surfaces, spacing and the rest of the
 * visual language come from docs/DESIGN.md §3, as they do everywhere else in
 * the app.
 */

/**
 * A circle carrying two voids on one axis: the large void behind is the
 * system, the small void ahead is the account it has isolated.
 *
 * Rules from the handoff: never rotate it (the bearing is fixed at 29°), never
 * colour the counters separately, never outline it. At 16px and below the
 * forward counter is dropped and the mark runs solid.
 */
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
export function Lockup({
  size = 15,
  markSize,
  className = "",
}: {
  size?: number;
  markSize?: number;
  className?: string;
}) {
  const mark = markSize ?? Math.round(size * 1.2);
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: `${mark * 0.4}px` }}>
      <Mark size={mark} className="text-accent dark:text-blue-400" />
      <span
        className="wordmark"
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
