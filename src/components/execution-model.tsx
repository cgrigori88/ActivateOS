import Link from "next/link";

/**
 * ExecutionModel (Wave 4 §2/§8) — the execution spine.
 *
 * Queue, Skills, Routines, Campaigns and Review were five utilities in a
 * sidebar. Nothing on any of them said that the Skill governs how the queued
 * work is performed, that the Routine decides when it recurs, that the Campaign
 * is one governed way it reaches the market, or that Review is where a human
 * still has to say yes. The capability was all there; the relationship was not
 * on screen anywhere.
 *
 * This strip states the model where the reader is standing:
 *
 *   DECISION → QUEUE → SKILL → ROUTINE → EXECUTION → REVIEW → OUTCOME
 *
 * It is navigation over rooms that already exist. It creates no automation
 * platform, no runtime and no approval model, and it computes nothing — each
 * room hands it its own counts.
 *
 * §2 is the reason this component exists at all: recommendation, decision,
 * action and outcome are four different things, and a product that shows them
 * as one "status" cannot be trusted with authority. The spine keeps them
 * visibly separate stages rather than degrees of the same progress bar.
 */

export type ExecLevel = "decision" | "queue" | "skill" | "routine" | "execution" | "review" | "outcome";

const ORDER: ExecLevel[] = ["decision", "queue", "skill", "routine", "execution", "review", "outcome"];

const WORD: Record<ExecLevel, string> = {
  decision: "Decision",
  queue: "Queue",
  skill: "Skill",
  routine: "Routine",
  execution: "Execution",
  review: "Review",
  outcome: "Outcome",
};

/** What each stage answers. One clause — this is a spine, not documentation. */
const ASKS: Record<ExecLevel, string> = {
  decision: "what was concluded",
  queue: "what needs doing now",
  skill: "how we do this kind of work",
  routine: "when it repeats",
  execution: "how it reaches the market",
  review: "where a human must agree",
  outcome: "what actually happened",
};

/** Where each stage lives. Every route exists; none is invented. */
const HREF: Record<ExecLevel, string> = {
  decision: "/pursuits",
  queue: "/queue",
  skill: "/skills",
  routine: "/routines",
  execution: "/campaigns",
  review: "/review",
  outcome: "/insights",
};

export interface ExecStep {
  /** A count or short figure under the label, e.g. "4 open". */
  detail?: string;
  /** Overrides the generic word — use only when the room has a concrete subject. */
  label?: string;
}

export function ExecutionModel({
  current,
  steps,
  className = "",
}: {
  current: ExecLevel;
  steps?: Partial<Record<ExecLevel, ExecStep>>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Execution model"
      className={`mb-5 flex flex-wrap items-stretch gap-0.5 rounded-card p-1.5 ${className}`}
      style={{ background: "var(--surface-inset)" }}
    >
      {ORDER.map((level, i) => {
        const step = steps?.[level];
        const here = level === current;
        const body = (
          <>
            <div className="flex items-baseline gap-1">
              <span
                className={`text-micro font-bold uppercase tracking-[0.05em] ${here ? "" : "ink-faint"}`}
                style={here ? { color: "var(--color-priority)" } : undefined}
              >
                {WORD[level]}
              </span>
              {here && <span aria-hidden className="h-1 w-1 rounded-full" style={{ background: "var(--color-priority)" }} />}
            </div>
            <div className={`truncate text-label ${here ? "font-semibold ink" : "ink-muted"}`}>
              {step?.label ?? ASKS[level]}
            </div>
            {step?.detail && <div className="truncate text-micro ink-faint">{step.detail}</div>}
          </>
        );
        return (
          <div key={level} className="flex min-w-0 flex-1 items-center">
            {i > 0 && <span aria-hidden className="flex-none pr-0.5 text-micro ink-faint">→</span>}
            {here ? (
              <div
                className="min-w-0 flex-1 rounded-control px-2 py-1.5"
                style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-low)" }}
                aria-current="page"
              >
                {body}
              </div>
            ) : (
              <Link
                href={HREF[level]}
                className="min-w-0 flex-1 rounded-control px-2 py-1.5 transition-colors hover:bg-[var(--surface-primary)]"
              >
                {body}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
