import { Disclosure } from "@/components/ui";
import { humanizeText } from "./vocab";
import {
  CONTEXT_CONFIDENCE_LABEL,
  CONTEXT_STATE_LABEL,
  type ContextChangeLine,
  type ContextEvidenceLine,
  type ContextState,
  type PursuitContextView,
} from "@/lib/pursuits/read-models/pursuit-context";

/**
 * Pursuit Context narrative (vNext Slice 1, chunk 6A) — one surface in place of three.
 *
 * NAMED "context", not "brief", deliberately: `read-models/brief.ts` already owns
 * `PursuitBrief` — the disclosure-aware exportable document behind the Brief
 * button on this same page. Two different things called a Pursuit Brief in one
 * route is a maintenance trap, so this one keeps the name the Slice 1 plan gave
 * it. The rendered headings carry the meaning; the symbol names stay distinct.
 *
 * It replaces the Why Now, Facts and What Changed panels with a single reading
 * order: why this matters → what we know → what changed → what needs attention.
 * The three panels each held a fragment of one story and made the reader
 * assemble it; this tells it once.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a dashboard. No gauge grid, no score wall, no
 * badge on every line, no second CTA competing with the first. The architecture
 * underneath this is substantially more complex than what it replaces; the
 * surface has to be simpler, or the slice has failed (D-003).
 *
 * Context health does not get a panel of its own. It appears as ONE confidence
 * word beside the heading, and only when it is explainable — the reason comes
 * from the top canonical concern, so a reader who asks "why partly evidenced?"
 * gets a real answer rather than a tooltip about a scoring model.
 *
 * All copy arrives already decided. This component selects no phrasing from a
 * state and invents no sentence: `composePursuitContext` did that from canonical
 * tables, and everything here is either that text or a label from
 * `CONTEXT_STATE_LABEL`. Keeping the choosing out of the component is what stops
 * the four-state vocabulary quietly collapsing during a later style pass.
 */

/** Tone per state. Absent and degraded read differently — that is the point. */
const STATE_TONE: Record<ContextState, string> = {
  VERIFIED: "var(--color-accent-verified)",
  NEEDS_VALIDATION: "var(--color-accent-attention)",
  OUT_OF_DATE: "var(--color-accent-attention)",
  CONFLICTING: "var(--color-accent-risk)",
  NOT_IDENTIFIED: "var(--color-accent-risk)",
  NOT_ESTABLISHED: "var(--color-accent-intelligence)",
};

function StateChip({ state }: { state: ContextState }) {
  return (
    <span
      className="inline-flex flex-none items-center rounded-inner px-1.5 py-0.5 text-micro font-bold"
      style={{ color: STATE_TONE[state], background: `color-mix(in srgb, ${STATE_TONE[state]} 12%, transparent)` }}
    >
      {CONTEXT_STATE_LABEL[state]}
    </span>
  );
}

/** One remembered event. Shared by the default head and the earlier-history tail. */
function ChangeRow({ line }: { line: ContextChangeLine }) {
  return (
    <li className="py-2">
      <div className="text-copy font-semibold ink">{humanizeText(line.text)}</div>
      <div className="tnum mt-0.5 text-label ink-faint">
        {new Date(line.at).toLocaleDateString()}
        {line.byPerson && " · changed by a person"}
      </div>
    </li>
  );
}

function EvidenceRow({ line }: { line: ContextEvidenceLine }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-copy font-semibold ink">{humanizeText(line.label)}</div>
        <div className="mt-0.5 text-label ink-faint">
          {humanizeText(line.predicateKey.replace(/_/g, " "))} · {line.note}
        </div>
      </div>
      <StateChip state={line.state} />
    </li>
  );
}

/**
 * The group headings are the whole direct/supporting distinction, in product
 * language. "Confirmed for this pursuit" says somebody linked it; "Relevant
 * account context" says it belongs to the account and bears on this pursuit
 * without anyone having said so. Neither uses the words `pursuit_facts`,
 * `inferred` or `pertinence` (D-012, D-020).
 */
function EvidenceGroup({ heading, lines }: { heading: string; lines: ContextEvidenceLine[] }) {
  if (!lines.length) return null;
  return (
    <div>
      <h4 className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">{heading}</h4>
      <ul className="mt-0.5 divide-y divide-[var(--border-subtle)]">
        {lines.map((l) => <EvidenceRow key={l.factId} line={l} />)}
      </ul>
    </div>
  );
}

export function PursuitContextNarrative({ context }: { context: PursuitContextView }) {
  const { whyThisMatters: why, whatWeKnow: known, whatChanged: changed, needsAttention: attention } = context;
  const hasEvidence = known.confirmed.length > 0 || known.accountContext.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* A · Why this matters ------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">Why this matters</h3>
          <span className="text-label font-semibold ink-faint">{CONTEXT_CONFIDENCE_LABEL[why.confidence]}</span>
        </div>
        {why.clauses.length ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {why.clauses.map((c, i) => (
              <li key={`${c.refType}-${c.refId ?? i}`} className="text-copy ink">{humanizeText(c.text)}</li>
            ))}
          </ul>
        ) : (
          // Honest low-confidence state. Never a confident-sounding placeholder.
          <p className="mt-1.5 text-copy italic text-neutral-500">
            Not enough verified context yet to say why this pursuit is live.
          </p>
        )}
        {why.confidenceReason && (
          <p className="mt-1 text-label ink-faint">{humanizeText(why.confidenceReason)}</p>
        )}
      </section>

      {/* B · What we know ---------------------------------------------------- */}
      <section id="evidence" className="scroll-mt-16">
        <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">What we know</h3>
        {hasEvidence ? (
          <div className="mt-1.5 flex flex-col gap-3">
            <EvidenceGroup heading="Confirmed for this pursuit" lines={known.confirmed} />
            <EvidenceGroup heading="Relevant account context" lines={known.accountContext} />
            {known.hiddenCount > 0 && (
              <p className="text-label ink-faint">
                {known.hiddenCount} more {known.hiddenCount === 1 ? "item" : "items"} of supporting context available.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-copy italic text-neutral-500">No evidence gathered for this pursuit yet.</p>
        )}
      </section>

      {/* C · What changed ---------------------------------------------------- */}
      <section id="activity" className="scroll-mt-16">
        <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">What changed</h3>
        {changed.entries.length ? (
          <>
            <ul className="mt-1.5 divide-y divide-[var(--border-subtle)]">
              {changed.entries.map((e) => <ChangeRow key={e.id} line={e} />)}
            </ul>
            {changed.earlier.length > 0 && (
              // Renders the remaining memory entries. It previously revealed a
              // sentence pointing at an activity record this surface had
              // absorbed, so the older half of the history — including the
              // partner-override chronology — was reachable nowhere.
              <Disclosure summary={`Earlier history (${changed.earlier.length})`} className="mt-1.5">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {changed.earlier.map((e) => <ChangeRow key={e.id} line={e} />)}
                </ul>
              </Disclosure>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-copy italic text-neutral-500">Nothing has changed on this pursuit yet.</p>
        )}
      </section>

      {/* D · Needs attention -------------------------------------------------- */}
      <section>
        <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">Needs attention</h3>
        {attention.primary ? (
          <div className="mt-1.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-copy font-semibold ink">{humanizeText(attention.primary.headline)}</p>
              <StateChip state={attention.primary.state} />
            </div>
            {attention.primary.accountSignal && (
              // The Globex nuance, made explicit: the account holds timing, the
              // pursuit has not validated it. Saying either half alone is false.
              <p className="mt-1 text-label ink-faint">{attention.primary.accountSignal.text}</p>
            )}
            {attention.primary.detail && (
              <p className="mt-1 text-label ink-faint">{attention.primary.detail}</p>
            )}
            {attention.primary.resolution && (
              <p className="mt-1 text-label ink-faint">Resolve by: {attention.primary.resolution}</p>
            )}
            {attention.otherCount > 0 && (
              <p className="mt-1.5 text-label ink-faint">
                {attention.otherCount} other unresolved {attention.otherCount === 1 ? "item" : "items"}.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-copy italic text-neutral-500">Nothing unresolved on this pursuit.</p>
        )}
        {/* Shown whether or not timing is the top gap. The account holding a
            renewal date while the pursuit has none is precisely the claim a
            reader could otherwise get wrong in either direction. */}
        {attention.timingNote && (
          <p className="mt-2 text-label ink-faint">{attention.timingNote.text}</p>
        )}
      </section>
    </div>
  );
}
