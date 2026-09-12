import type { ReactNode } from "react";
import { Disclosure } from "@/components/ui";
import { humanizeText } from "./vocab";
import {
  CONTEXT_CONFIDENCE_LABEL,
  type ContextAttentionBrief,
  type ContextChangeLine,
  type ContextEvidenceLine,
  type ContextState,
  type PursuitContextView,
} from "@/lib/pursuits/read-models/pursuit-context";

/**
 * "What matters now" — one surface in place of Why Now, Facts and What Changed.
 *
 * NAMED "context" IN CODE, not "brief": `read-models/brief.ts` already owns
 * `PursuitBrief` — the disclosure-aware exportable document behind the Brief
 * button on this same page. Two different things called a brief in one route is
 * a maintenance trap. The rendered headings carry the product meaning.
 *
 * READING ORDER, AND WHY IT IS SHAPED THIS WAY. Why it matters → what we know →
 * what needs attention → what changed. At desktop widths the middle two sit
 * side by side, because the evidence and the open questions are read against
 * each other: "here is what we have, here is what we are missing" is one
 * thought, and stacking them made the panel a 1,068px column beside a 475px
 * neighbour — 593px of dead space in the most valuable part of the page. The
 * narrative was right; the geometry was wrong (GATE C N-6).
 *
 * At narrow widths the grid collapses and the same semantic order stacks. There
 * is no separate mobile composition to keep in sync.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a dashboard. No gauge grid, no score wall, no
 * badge on every line, no card inside a card, no second CTA. The architecture
 * underneath is substantially more complex than what it replaces; the surface
 * has to be simpler, or the slice has failed (D-003).
 *
 * Context health does not get a panel. It appears as ONE confidence word beside
 * the first heading, and only when it is explainable — the reason comes from the
 * top canonical concern, so "why partly evidenced?" has a real answer.
 *
 * ALL COPY ARRIVES ALREADY DECIDED. This component selects no phrasing from a
 * state and assembles no sentence: `composePursuitContext` did that from
 * declared tables, and every string here is either that text or a label that
 * came with it (`stateLabel`, `meta`). Keeping the choosing out of the component
 * is what stops the state vocabulary collapsing in a later style pass (U-14).
 * `humanizeText` is the one exception, and it only title-cases embedded enum
 * tokens — it never chooses a word.
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

/** The chip renders the label it was given. It does not derive one from state. */
function StateChip({ state, label }: { state: ContextState; label: string }) {
  return (
    <span
      className="inline-flex flex-none items-center rounded-inner px-1.5 py-0.5 text-micro font-bold"
      style={{ color: STATE_TONE[state], background: `color-mix(in srgb, ${STATE_TONE[state]} 12%, transparent)` }}
    >
      {label}
    </span>
  );
}

function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">{children}</h3>
      {aside}
    </div>
  );
}

/** One remembered event. Shared by the default head and the earlier-history tail. */
function ChangeRow({ line }: { line: ContextChangeLine }) {
  return (
    <li className="py-2">
      <div className="text-copy font-semibold ink">{humanizeText(line.text)}</div>
      {line.meta && <div className="tnum mt-0.5 text-label ink-faint">{humanizeText(line.meta)}</div>}
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
      <StateChip state={line.state} label={line.stateLabel} />
    </li>
  );
}

/**
 * The group headings are the direct/supporting distinction in product language.
 * "Confirmed for this pursuit" says somebody linked it; "Relevant account
 * context" says it belongs to the account and bears on this pursuit without
 * anyone having said so. The account rows' chips carry the scope too — a bare
 * "Verified" on a supporting row reads as verified FOR the pursuit to anyone
 * skimming chips rather than headings (D-020).
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

function OtherAttentionRow({ item }: { item: ContextAttentionBrief }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span className="min-w-0 text-label ink">{humanizeText(item.headline)}</span>
      <StateChip state={item.state} label={item.stateLabel} />
    </li>
  );
}

export function PursuitContextNarrative({
  context,
  lifecycleSlot,
}: {
  context: PursuitContextView;
  /**
   * The account's lifecycle timing, supplied by the route. Rendered here, under
   * the timing caveat it belongs to, rather than at the foot of the panel: the
   * row shows a verified renewal date, and the sentence explaining that the date
   * is the ACCOUNT's and not yet confirmed for this pursuit has to sit next to
   * it or the two read as a contradiction (GATE C §4).
   */
  lifecycleSlot?: ReactNode;
}) {
  const { whyThisMatters: why, whatWeKnow: known, whatChanged: changed, needsAttention: attention } = context;
  const hasEvidence = known.confirmed.length > 0 || known.accountContext.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* A · Why it matters — full width, one short rationale ---------------- */}
      <section>
        <SectionHeading
          aside={<span className="text-label font-semibold ink-faint">{CONTEXT_CONFIDENCE_LABEL[why.confidence]}</span>}
        >
          Why it matters
        </SectionHeading>
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

      {/* B|C · What we know beside what needs attention ---------------------- */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* B · What we know ------------------------------------------------- */}
        <section id="evidence" className="scroll-mt-16">
          <SectionHeading>What we know</SectionHeading>
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

        {/* C · Needs attention — ONE primary, the rest behind a real door ---- */}
        <section>
          <SectionHeading>Needs attention</SectionHeading>
          {attention.primary ? (
            <div className="mt-1.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-copy font-semibold ink">{humanizeText(attention.primary.headline)}</p>
                <StateChip state={attention.primary.state} label={attention.primary.stateLabel} />
              </div>
              {attention.primary.detail && (
                <p className="mt-1 text-label ink-faint">{attention.primary.detail}</p>
              )}
              {attention.primary.resolution && (
                <p className="mt-1 text-label ink-faint">Next: {attention.primary.resolution}</p>
              )}
              {/* `primary.accountSignal` is deliberately NOT printed here: it
                  carries the same sentence as the section-level timing note
                  below, which fires on the condition rather than on ranking
                  position (U-15). Its job on the primary is to soften the
                  STATE, which it has already done upstream. */}
            </div>
          ) : (
            <p className="mt-1.5 text-copy italic text-neutral-500">Nothing unresolved on this pursuit.</p>
          )}

          {attention.others.length > 0 && (
            <Disclosure
              summary={`${attention.others.length} other ${attention.others.length === 1 ? "item" : "items"}`}
              className="mt-2"
            >
              <ul className="divide-y divide-[var(--border-subtle)]">
                {attention.others.map((o) => <OtherAttentionRow key={`${o.refType}-${o.refId}-${o.headline}`} item={o} />)}
              </ul>
            </Disclosure>
          )}

          {/* Fires whether or not timing is the top gap. The account holding a
              renewal date while the pursuit has none is precisely the claim a
              reader could otherwise get wrong in either direction. */}
          {attention.timingNote && (
            <p className="mt-2 text-label ink-faint">{attention.timingNote.text}</p>
          )}

          {lifecycleSlot && (
            <div className="mt-2.5 border-t border-neutral-200/70 pt-2.5 dark:border-neutral-800">
              <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">
                Account lifecycle timing
              </span>
              <div className="mt-1">{lifecycleSlot}</div>
            </div>
          )}
        </section>
      </div>

      {/* D · What changed — full width, chronological ------------------------ */}
      <section id="activity" className="scroll-mt-16">
        <SectionHeading>What changed</SectionHeading>
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
    </div>
  );
}
