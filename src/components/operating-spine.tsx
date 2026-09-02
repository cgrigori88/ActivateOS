import Link from "next/link";

/**
 * OperatingSpine (Wave 6 §6) — one strip, three vocabularies.
 *
 * WHAT WAS WRONG. Waves 3, 4 and 5 each introduced a spine, and each one was a
 * near-copy of the last: three components, 370 lines, one presentation written
 * three times. Worse, that presentation had grown into a teaching banner. Every
 * node stacked three lines — the word, the clause explaining what the word
 * means, and a count — so a strip of six nodes stood ~64px tall on every one of
 * fifteen rooms, and at 1280px the clauses truncated into fragments
 * ("what the outcomes tau…") that taught nothing and still cost the space.
 *
 * WHAT IT DOES NOW. The clause is the one thing a reader only needs for the
 * room they are standing in, so that is the only place it renders. Every other
 * node is its name, plus its own count when the room supplied one. The strip
 * reads as navigation with context attached, which is what it is.
 *
 * What is deliberately kept, because §6 requires it:
 *   · current position — raised surface, priority ink, a dot, aria-current
 *   · adjacent context — every node still named, never collapsed or elided
 *   · conceptual flow — the arrows, and the fixed left-to-right order
 *
 * This computes nothing and asserts no relationship. Each room passes its own
 * counts; a step with no href renders as text rather than a link that lies.
 */

export interface SpineStep {
  /** Where this step goes. Omit to fall back to the spine's default route. */
  href?: string;
  /** The concrete thing at this node ("$5M Virtualization Co-Sell") — overrides the generic word. */
  label?: string;
  /** One short figure or count, e.g. "5 motions". */
  detail?: string;
}

export interface SpineNode {
  key: string;
  /** The node's name. Short — this is a spine, not a legend. */
  word: string;
  /** One clause, shown only on the current node. */
  asks: string;
  /** Default route for this node. */
  href: string;
}

export function OperatingSpine({
  label,
  nodes,
  current,
  steps,
  className = "",
}: {
  /** aria-label for the nav — names which spine this is. */
  label: string;
  nodes: SpineNode[];
  current: string;
  steps?: Record<string, SpineStep | undefined>;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`mb-4 flex flex-wrap items-center gap-x-0.5 gap-y-1 rounded-card px-1.5 py-1 ${className}`}
      style={{ background: "var(--surface-inset)" }}
    >
      {nodes.map((n, i) => {
        const step = steps?.[n.key];
        const here = n.key === current;
        const href = step?.href ?? n.href;
        const name = step?.label ?? n.word;
        const body = (
          <span className="flex min-w-0 items-baseline gap-1.5">
            {here && (
              <span aria-hidden className="h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-priority)" }} />
            )}
            <span
              className={`shrink-0 text-micro font-bold uppercase tracking-[0.05em] ${here ? "" : "ink-muted"}`}
              style={here ? { color: "var(--color-priority)" } : undefined}
            >
              {name}
            </span>
            {/* The clause earns its space only where the reader is standing. */}
            {here && <span className="truncate text-label ink-soft">{n.asks}</span>}
            {step?.detail && <span className="truncate text-label ink-faint">{step.detail}</span>}
          </span>
        );
        return (
          <span key={n.key} className="flex min-w-0 items-center">
            {i > 0 && <span aria-hidden className="flex-none px-1 text-micro ink-faint">→</span>}
            {here ? (
              <span
                className="min-w-0 rounded-control px-2 py-1"
                style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-low)" }}
                aria-current="page"
              >
                {body}
              </span>
            ) : (
              <Link
                href={href}
                title={n.asks}
                className="min-w-0 rounded-control px-2 py-1 transition-colors hover:bg-[var(--surface-primary)]"
              >
                {body}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
