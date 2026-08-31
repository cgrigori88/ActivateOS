import type { LifecycleEvent, LifecycleState } from "@/lib/lifecycle/state";
import { STATE_LABEL, PREDICATE_LABEL } from "@/lib/lifecycle/state";

/**
 * Lifecycle intelligence on the Pursuit (P2A §6/§9). Compact by default — the first view says
 * "Renewal: conflicting", not a forensic evidence ledger. Progressive disclosure opens the
 * sources, provenance, observed/valid dates, supersession, contradiction and decay.
 *
 * The honesty rules are visual as well as semantic: an INFERRED WINDOW renders as a RANGE and
 * never as a day, a CONFLICTING date shows every competing value and picks none, and UNKNOWN is
 * displayed rather than hidden.
 */

const STATE_HUE: Record<LifecycleState, string> = {
  VERIFIED_DATE: "var(--color-accent-verified)",
  INFERRED_WINDOW: "var(--color-timing)",
  STALE_DATE: "var(--color-neutral-500, #737373)",
  CONFLICTING_DATE: "var(--color-accent-risk)",
  UNKNOWN: "var(--color-neutral-500, #737373)",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function StateChip({ state }: { state: LifecycleState }) {
  const hue = STATE_HUE[state];
  return (
    <span className="rounded-full px-2 py-px text-micro font-bold"
      style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)` }}>
      {STATE_LABEL[state]}
    </span>
  );
}

/** The one-line "when", rendered honestly per state. */
function When({ e }: { e: LifecycleEvent }) {
  if (e.state === "CONFLICTING_DATE") {
    return (
      <span className="text-body">
        {e.competing.map((c, i) => (
          <span key={c.factId}>
            {i > 0 && <span className="text-neutral-400"> vs </span>}
            <b>{day(c.date)}</b>
          </span>
        ))}
      </span>
    );
  }
  if (e.state === "INFERRED_WINDOW") {
    // A window is a window. Never collapsed to a day.
    return (
      <span className="text-body">
        <b>{day(e.window?.from ?? null)} → {day(e.window?.to ?? null)}</b>
        {e.daysUntil != null && <span className="text-neutral-500"> · opens in ~{e.daysUntil}d</span>}
      </span>
    );
  }
  return (
    <span className="text-body">
      <b>{day(e.date)}</b>
      {e.daysUntil != null && (
        <span className="text-neutral-500"> · {e.daysUntil >= 0 ? `in ${e.daysUntil}d` : `${Math.abs(e.daysUntil)}d ago`}</span>
      )}
    </span>
  );
}

export function LifecycleBento({ events }: { events: LifecycleEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-body text-neutral-500">
        Lifecycle timing <b>UNKNOWN</b> — no renewal, contract or support-lifecycle evidence on this account.
        A customer-confirmed date or a first-party contract record would establish it.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {events.map((e) => (
        <details key={e.predicateKey} className="rounded-card">
          {/* Compact first view: label · state · when. Two-second read. */}
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 rounded-card px-2 py-1.5 hover:bg-neutral-900/[0.03] dark:hover:bg-white/[0.05]">
            <span className="text-body font-semibold">{e.label}</span>
            <StateChip state={e.state} />
            <When e={e} />
          </summary>
          {/* Progressive disclosure: the evidence ledger, only on demand. */}
          <div className="space-y-1 px-2 pb-2 pt-1 text-body text-neutral-500">
            <p><b className="text-neutral-700 dark:text-neutral-200">Why:</b> {e.because}</p>
            {e.whatWouldChangeIt && (
              <p><b className="text-neutral-700 dark:text-neutral-200">What changes it:</b> {e.whatWouldChangeIt}</p>
            )}
            {e.competing.length > 0 && (
              <div>
                <b className="text-neutral-700 dark:text-neutral-200">Competing sources:</b>
                <ul className="mt-0.5 space-y-0.5">
                  {e.competing.map((c) => (
                    <li key={c.factId}>
                      {day(c.date)} — {PREDICATE_LABEL[c.predicateKey] ?? c.predicateKey.replace(/_/g, " ")}
                      {", "}{c.provenanceClass.replace(/_/g, " ").toLowerCase()}
                      {c.sourceLabel && <span className="text-neutral-400"> · {c.sourceLabel}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="space-y-0.5">
              {e.facts.map((f) => (
                <li key={f.factId} className="tnum">
                  {f.provenanceClass.replace(/_/g, " ").toLowerCase()} · status {f.status.toLowerCase()}
                  {" · observed "}{f.observedLastAt.toISOString().slice(0, 10)}
                  {f.validUntil && <> · valid until {f.validUntil.toISOString().slice(0, 10)}</>}
                  {f.halfLifeDays != null && <> · half-life {f.halfLifeDays}d</>}
                  {f.supersededBy && <span className="text-neutral-400"> · superseded</span>}
                  {f.contradictionOpen && <span style={{ color: "var(--color-accent-risk)" }}> · contradiction open</span>}
                </li>
              ))}
            </ul>
            <p className="text-label text-neutral-400">
              {e.evidenceCount} cited source{e.evidenceCount === 1 ? "" : "s"} · derived from canonical facts; no date is inferred beyond its evidence.
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
