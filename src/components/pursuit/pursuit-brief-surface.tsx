import { Disclosure } from "@/components/ui";
import { humanizeText } from "./vocab";
import {
  BRIEF_CONFIDENCE_LABEL,
  BRIEF_STATE_LABEL,
  type BriefEvidenceLine,
  type BriefState,
  type PursuitBriefView,
} from "@/lib/pursuits/read-models/pursuit-brief";

/**
 * Pursuit Brief (vNext Slice 1, chunk 6A) — one surface in place of three.
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
 * state and invents no sentence: `buildPursuitBrief` did that from canonical
 * tables, and everything here is either that text or a label from
 * `BRIEF_STATE_LABEL`. Keeping the choosing out of the component is what stops
 * the four-state vocabulary quietly collapsing during a later style pass.
 */

/** Tone per state. Absent and degraded read differently — that is the point. */
const STATE_TONE: Record<BriefState, string> = {
  VERIFIED: "var(--color-accent-verified)",
  NEEDS_VALIDATION: "var(--color-accent-attention)",
  OUT_OF_DATE: "var(--color-accent-attention)",
  CONFLICTING: "var(--color-accent-risk)",
  NOT_IDENTIFIED: "var(--color-accent-risk)",
  NOT_ESTABLISHED: "var(--color-accent-intelligence)",
};

function StateChip({ state }: { state: BriefState }) {
  return (
    <span
      className="inline-flex flex-none items-center rounded-inner px-1.5 py-0.5 text-micro font-bold"
      style={{ color: STATE_TONE[state], background: `color-mix(in srgb, ${STATE_TONE[state]} 12%, transparent)` }}
    >
      {BRIEF_STATE_LABEL[state]}
    </span>
  );
}

function EvidenceRow({ line }: { line: BriefEvidenceLine }) {
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
function EvidenceGroup({ heading, lines }: { heading: string; lines: BriefEvidenceLine[] }) {
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

export function PursuitBrief({ brief }: { brief: PursuitBriefView }) {
  const { whyThisMatters: why, whatWeKnow: known, whatChanged: changed, needsAttention: attention } = brief;
  const hasEvidence = known.confirmed.length > 0 || known.accountContext.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* A · Why this matters ------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">Why this matters</h3>
          <span className="text-label font-semibold ink-faint">{BRIEF_CONFIDENCE_LABEL[why.confidence]}</span>
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
              {changed.entries.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="text-copy font-semibold ink">{humanizeText(e.text)}</div>
                  <div className="tnum mt-0.5 text-label ink-faint">
                    {new Date(e.at).toLocaleDateString()}
                    {e.byPerson && " · changed by a person"}
                  </div>
                </li>
              ))}
            </ul>
            {changed.hiddenCount > 0 && (
              <Disclosure summary={`Earlier history (${changed.hiddenCount} more)`} className="mt-1.5">
                <p className="text-label ink-faint">
                  The full history for this pursuit continues below in the activity record.
                </p>
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
      </section>
    </div>
  );
}
