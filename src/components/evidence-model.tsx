import Link from "next/link";

/**
 * EvidenceModel (Wave 5 §2/§11) — the evidence spine.
 *
 * Intake, Sources, Provider health, Ask, Insights and Contacts were six
 * unrelated entries in a sidebar. Each was individually defensible and none of
 * them said the thing that actually matters: that evidence enters at Intake,
 * is attributed to a Source, is only worth as much as that feed's health, is
 * what Ask reads from, is what Insights learns from, and resolves to the People
 * a seller has to reach. That chain is the product's claim to being governed
 * rather than generative — and it was nowhere on screen.
 *
 *   INTAKE → SOURCES → PROVIDER HEALTH → ASK → INSIGHTS → CONTACTS
 *
 * This is navigation over rooms that already exist. It computes nothing; each
 * room hands it its own counts. No provider is called, no evidence is scored,
 * and no relationship is asserted that the schema does not already carry.
 */

export type EvidenceLevel = "intake" | "sources" | "health" | "ask" | "insights" | "contacts";

const ORDER: EvidenceLevel[] = ["intake", "sources", "health", "ask", "insights", "contacts"];

const WORD: Record<EvidenceLevel, string> = {
  intake: "Intake",
  sources: "Sources",
  health: "Feed health",
  ask: "Ask",
  insights: "Insights",
  contacts: "Contacts",
};

/** What each stage answers. One clause — this is a spine, not documentation. */
const ASKS: Record<EvidenceLevel, string> = {
  intake: "what came in",
  sources: "who it came from",
  health: "whether it can be trusted",
  ask: "what the record answers",
  insights: "what the outcomes taught us",
  contacts: "who it resolves to",
};

/** Where each stage lives. Every route exists; none is invented. */
const HREF: Record<EvidenceLevel, string> = {
  intake: "/intake",
  sources: "/sources",
  health: "/provider-health",
  ask: "/ask",
  insights: "/insights",
  contacts: "/contacts",
};

export interface EvidenceStep {
  /** A count or short figure under the label, e.g. "2 awaiting review". */
  detail?: string;
  /** Overrides the generic clause — use only when the room has a concrete subject. */
  label?: string;
}

export function EvidenceModel({
  current,
  steps,
  className = "",
}: {
  current: EvidenceLevel;
  steps?: Partial<Record<EvidenceLevel, EvidenceStep>>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Evidence model"
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
