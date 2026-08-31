import Link from "next/link";

/**
 * The shared constraint presentation language (UX normalization pass). ONE way to state a
 * canonical commercial constraint anywhere in PursuitOS — Today, Pursuit Detail, Motion
 * Intelligence, Pipeline, Queue, Partner Intelligence, the Brief:
 *
 *   BLOCKED BY   the canonical constraint, in words
 *   WHY          the evidence-grounded explanation (never invented)
 *   EXPOSURE     the commercial value it holds (when known)
 *   CHANGES IT   the governed action or destination, where one exists
 *
 * Pure presentation over existing canonical truth — no stored constraint table, no score. Severity
 * follows the canonical vocabulary: HARD (disqualifying), SOFT (actionable), UNKNOWN (honestly
 * unknown — rendered neutral, never as an alarm).
 */

export interface ConstraintView {
  blockedBy: string;
  why?: string | null;
  exposureUsd?: number | null;
  severity: "HARD" | "SOFT" | "UNKNOWN";
  action?: { label: string; deepLink: string } | null;
}

export const severityHue = (s: ConstraintView["severity"]) =>
  s === "HARD" ? "var(--color-accent-risk)" : s === "UNKNOWN" ? "var(--color-neutral-500, #737373)" : "var(--color-accent-attention)";

export const usd = (n: number | null | undefined) =>
  n == null || n === 0 ? null : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

/** One constraint as a single readable line: dot · blocked-by (· why) (· exposure) (· action). */
export function ConstraintLine({ c, dense }: { c: ConstraintView; dense?: boolean }) {
  return (
    <span className={`flex items-start gap-1.5 ${dense ? "text-[12px]" : "text-[12.5px]"}`}>
      <span aria-hidden className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: severityHue(c.severity) }} />
      <span className="min-w-0">
        <span className={c.severity === "UNKNOWN" ? "text-neutral-500" : "font-medium"}>{c.blockedBy}</span>
        {c.why && <span className="text-neutral-500"> — {c.why}</span>}
        {usd(c.exposureUsd) && <span className="tnum text-neutral-400"> · {usd(c.exposureUsd)}</span>}
        {c.action && (
          <Link href={c.action.deepLink} className="ml-1.5 font-medium hover:underline" style={{ color: "var(--color-route)" }}>
            {c.action.label} →
          </Link>
        )}
      </span>
    </span>
  );
}

/** An aggregate row: "Participant acceptance · 3 pursuits · $1.2M" — clickable into the detail. */
export function ConstraintAggregateRow({ label, count, exposureUsd, severity, href }: {
  label: string; count: number; exposureUsd: number; severity: ConstraintView["severity"]; href: string;
}) {
  return (
    <Link href={href} scroll={false}
      className="flex items-baseline justify-between gap-3 rounded-control px-2.5 py-1.5 hover:bg-neutral-900/[0.04] dark:hover:bg-white/[0.06]">
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: severityHue(severity) }} />
        <span className="truncate text-[13px] font-medium">{label}</span>
      </span>
      <span className="tnum shrink-0 text-[12.5px] text-neutral-500">
        {count} pursuit{count === 1 ? "" : "s"}{usd(exposureUsd) && <> · <b className="text-neutral-700 dark:text-neutral-200">{usd(exposureUsd)}</b></>}
      </span>
    </Link>
  );
}
