import Link from "next/link";

/**
 * OperatingModel (Wave 3 §2/§6) — the spine.
 *
 * Goals, Motions, Pursuits and Pipeline are four levels of ONE commercial
 * system, and the product presented them as four unrelated application modules
 * in a sidebar. A reader had no way to learn, from the interface, that the
 * motions on one screen are the thing producing the opportunities on another,
 * or that both exist to move the number on a third.
 *
 * This strip states the model in the place a reader is standing:
 *
 *   GOAL → MOTION → PURSUITS → PIPELINE
 *
 * It is navigation over relationships that ALREADY EXIST in the domain
 * (`revenue_motions.goal_id`, `opportunities.motion_id`). Nothing here invents a
 * relationship or computes a new number — each step is handed its own label and
 * href by the room that knows them, and a step with no real destination renders
 * as plain text rather than a link that lies.
 *
 * §7: the four words are fixed. This is where the product's vocabulary for its
 * own operating model is defined, so the same concept cannot be called a target
 * here and an objective there.
 */

export type ModelLevel = "goal" | "motion" | "pursuit" | "pipeline";

const ORDER: ModelLevel[] = ["goal", "motion", "pursuit", "pipeline"];

const WORD: Record<ModelLevel, string> = {
  goal: "Goal",
  motion: "Motion",
  pursuit: "Pursuits",
  pipeline: "Pipeline",
};

/** What each level answers. Kept to one clause — this is a spine, not a legend. */
const ASKS: Record<ModelLevel, string> = {
  goal: "what we are trying to achieve",
  motion: "the play we are running",
  pursuit: "where it lands on accounts",
  pipeline: "the revenue it produces",
};

export interface ModelStep {
  /** Where this step goes. Omit when no real relationship exists — it then reads as plain text. */
  href?: string;
  /** The concrete thing at this level ("$5M Virtualization Co-Sell"), or omit for the generic word. */
  label?: string;
  /** One short figure or count shown under the label, e.g. "5 motions". */
  detail?: string;
}

export function OperatingModel({
  current,
  steps,
  className = "",
}: {
  current: ModelLevel;
  /** Per-level overrides. A level absent from this map still renders, unlinked. */
  steps?: Partial<Record<ModelLevel, ModelStep>>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Operating model"
      className={`mb-5 flex flex-wrap items-stretch gap-1 rounded-card p-1.5 ${className}`}
      style={{ background: "var(--surface-inset)" }}
    >
      {ORDER.map((level, i) => {
        const step = steps?.[level];
        const here = level === current;
        const body = (
          <>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-micro font-bold uppercase tracking-[0.06em] ${here ? "" : "ink-faint"}`}
                style={here ? { color: "var(--color-priority)" } : undefined}
              >
                {WORD[level]}
              </span>
              {here && (
                <span aria-hidden className="h-1 w-1 rounded-full" style={{ background: "var(--color-priority)" }} />
              )}
            </div>
            <div className={`truncate text-body ${here ? "font-semibold ink" : "ink-muted"}`}>
              {step?.label ?? ASKS[level]}
            </div>
            {step?.detail && <div className="truncate text-label ink-faint">{step.detail}</div>}
          </>
        );
        return (
          <div key={level} className="flex min-w-0 flex-1 items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="flex-none px-0.5 text-label ink-faint">
                →
              </span>
            )}
            {step?.href && !here ? (
              <Link
                href={step.href}
                className="min-w-0 flex-1 rounded-control px-2.5 py-1.5 transition-colors hover:bg-[var(--surface-primary)]"
              >
                {body}
              </Link>
            ) : (
              <div
                className="min-w-0 flex-1 rounded-control px-2.5 py-1.5"
                style={here ? { background: "var(--surface-primary)", boxShadow: "var(--shadow-low)" } : undefined}
                aria-current={here ? "page" : undefined}
              >
                {body}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
