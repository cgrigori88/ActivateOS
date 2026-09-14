import { Disclosure } from "@/components/ui";
import { humanizeText } from "./vocab";
import { PlanControls } from "./pursuit-plan-controls";
import type { MilestoneStatus, PlanDisplayState, PursuitPlanView } from "@/lib/pursuits/read-models/pursuit-plan";
import type { ContextState } from "@/lib/pursuits/read-models/pursuit-context";

/**
 * "Pursuit plan" — Goal → Plan → Motion → Action, beneath "What matters now".
 *
 * WHAT IT ANSWERS, IN READING ORDER. What are we trying to achieve (goal) · is it
 * progressing (milestones done) · what matters most right now (focus) · why · what
 * runs it (motion) · what happens next, who owns it, by when · approve or adjust.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a project board: no columns, no drag handles,
 * no Gantt, no task list on the default view. Milestones and history sit behind
 * one disclosure each. It does not repeat "What matters now" — the focus is one
 * line here, because the gap's explanation already lives above — and it does not
 * repeat the Route decision: the route appears only as the motion's "via".
 *
 * ALL COPY ARRIVES DECIDED. The view-model chose every word from declared tables
 * (U-14); this component only picks a tone for a state.
 */

const PLAN_TONE: Record<PlanDisplayState, string> = {
  NONE: "var(--color-neutral-500)",
  AWAITING_DECISION: "var(--color-accent-attention)",
  APPROVED: "var(--color-accent-verified)",
  ADJUSTED: "var(--color-accent-verified)",
  DECLINED: "var(--color-neutral-500)",
  REVIEW_NEEDED: "var(--color-accent-attention)",
};

const FOCUS_TONE: Record<ContextState, string> = {
  VERIFIED: "var(--color-accent-verified)",
  NEEDS_VALIDATION: "var(--color-accent-attention)",
  OUT_OF_DATE: "var(--color-accent-attention)",
  CONFLICTING: "var(--color-accent-risk)",
  NOT_IDENTIFIED: "var(--color-accent-risk)",
  NOT_ESTABLISHED: "var(--color-accent-intelligence)",
};

const SEGMENT_TONE: Record<MilestoneStatus, string> = {
  DONE: "var(--color-accent-verified)",
  OPEN: "var(--surface-inset)",
  BLOCKED: "var(--surface-inset)",
  NOT_ESTABLISHED: "var(--surface-inset)",
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-none items-center rounded-inner px-1.5 py-0.5 text-micro font-bold"
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="text-body font-bold uppercase tracking-[0.05em] text-neutral-400">{children}</h3>;
}

/** The status word for the panel's heading row. */
export function PlanStatusChip({ view }: { view: PursuitPlanView }) {
  if (!view.exists) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-label">
      <Chip tone={PLAN_TONE[view.status.state]}>{view.status.label}</Chip>
      {view.status.atLabel && <span className="tnum ink-faint">{view.status.atLabel}</span>}
    </span>
  );
}

export function PursuitPlanSurface({ view, pursuitId, canDecide }: { view: PursuitPlanView; pursuitId: string; canDecide: boolean }) {
  if (!view.exists) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-copy italic text-neutral-500">No plan has been recommended for this pursuit yet.</p>
        <PlanControls mode="request" pursuitId={pursuitId} view={view} canDecide={canDecide} />
      </div>
    );
  }

  const review = view.review;

  /* Focus + why | next move. Declared once so the Slice 2B frame can sit above it in the same
     child slot, rather than adding a slot of its own. */
  const focusAndNext = (
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section>
          <Label>{view.approvedPlanFrame?.focusLabel ?? "Current focus"}</Label>
          {view.focus ? (
            <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2">
              <p className="text-copy font-semibold ink">{humanizeText(view.focus.headline)}</p>
              <Chip tone={FOCUS_TONE[view.focus.state]}>{view.focus.stateLabel}</Chip>
            </div>
          ) : (
            <p className="mt-1.5 text-copy italic text-neutral-500">Nothing unresolved on this pursuit.</p>
          )}
          {view.why.length > 0 && (
            <div className="mt-3">
              <Label>Why</Label>
              <ul className="mt-1 flex flex-col gap-1">
                {view.why.map((w, i) => (
                  <li key={i} className="text-label ink">
                    {humanizeText(w.text)}
                    {w.scopeLabel && <span className="ml-1.5 text-micro font-bold uppercase tracking-[0.04em] text-neutral-400">{w.scopeLabel}</span>}
                  </li>
                ))}
              </ul>
              {view.withheldCount > 0 && (
                <p className="mt-1 text-label ink-faint">{view.withheldCount} supporting {view.withheldCount === 1 ? "detail is" : "details are"} not shared with you.</p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-card p-3.5" style={{ background: "var(--surface-inset)" }}>
          <Label>Next move</Label>
          {view.motion.line
            ? <p className="mt-1.5 text-label font-semibold ink">{humanizeText(view.motion.line)}</p>
            : null}
          {view.motion.note && <p className="mt-0.5 text-label ink-faint">{view.motion.note}</p>}
          {view.nextAction ? (
            <>
              <p className="mt-2.5 text-copy font-semibold ink">{humanizeText(view.nextAction.text)}</p>
              {view.nextAction.doneWhen && <p className="mt-0.5 text-label ink-faint">Done when: {view.nextAction.doneWhen}</p>}
              {view.nextAction.via && <p className="mt-0.5 text-label ink-faint">Path: {view.nextAction.via}</p>}
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
                <dt className="font-semibold text-neutral-500">Owner</dt>
                <dd className="ink">
                  {view.nextAction.ownerLabel}
                  {view.nextAction.ownerNote && <span className="ink-faint"> — {view.nextAction.ownerNote}</span>}
                </dd>
                <dt className="font-semibold text-neutral-500">When</dt>
                <dd className="ink">
                  {view.nextAction.dueLabel}
                  {view.nextAction.queued && <a href="/queue" className="ml-1.5 font-medium hover:underline" style={{ color: "var(--color-readiness)" }}>In the queue →</a>}
                </dd>
              </dl>
            </>
          ) : (
            <p className="mt-2 text-copy italic text-neutral-500">No next action — nothing is unresolved.</p>
          )}
          {review.state !== "REVIEW_NEEDED" && (
            <PlanControls mode={view.status.state === "DECLINED" ? "request" : "decide"} pursuitId={pursuitId} view={view} canDecide={canDecide} />
          )}
        </section>
      </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Goal + progress ------------------------------------------------------ */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Label>Goal</Label>
          {view.progress.total > 0 && <span className="tnum text-label font-semibold ink-faint">{view.progress.label}</span>}
        </div>
        {view.goal && (
          <>
            <p className="mt-1.5 text-copy font-semibold ink">{humanizeText(view.goal.objective)}</p>
            <p className="mt-0.5 text-label ink-faint">
              {[view.goal.targetLabel, view.goal.provenanceLabel].filter(Boolean).join(" · ")}
            </p>
          </>
        )}
        {view.progress.total > 0 && (
          <div className="mt-2.5 flex gap-1" aria-label={view.progress.label} role="img">
            {view.progress.segments.map((s, i) => (
              <span key={i} className="h-1 flex-1 rounded-full" style={{ background: SEGMENT_TONE[s] }} />
            ))}
          </div>
        )}
        {view.progress.reachedSinceDecision > 0 && (
          <p className="mt-1.5 text-label ink-faint">
            {view.progress.reachedSinceDecision} {view.progress.reachedSinceDecision === 1 ? "milestone" : "milestones"} reached since the plan was approved.
          </p>
        )}
      </section>

      {/* Course correction — the approved plan stays in force until a person decides */}
      {review.state === "REVIEW_NEEDED" && (
        <section className="rounded-card p-3.5"
          style={{ background: "color-mix(in srgb, var(--color-accent-attention) 7%, var(--surface-primary))", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-attention) 24%, transparent)" }}>
          <p className="text-copy font-semibold ink">This plan needs review</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {review.reasons.map((r, i) => <li key={i} className="text-label ink">{humanizeText(r)}</li>)}
          </ul>
          <p className="mt-1.5 text-label ink-faint">The approved plan stays in force until a person decides.</p>
          {review.update && !review.update.stale && review.update.nextActionText && (
            <p className="mt-1.5 text-label ink">Updated recommendation: <span className="font-semibold">{humanizeText(review.update.nextActionText)}</span></p>
          )}
          <PlanControls mode={review.update && !review.update.stale ? "review" : "request"} pursuitId={pursuitId} view={view} canDecide={canDecide} />
        </section>
      )}

      {/* Slice 2B labelling: the preserved plan, named as what it is once it needs review. It
          shares the grid's own child slot (a fragment in place of the grid), so without the
          frame the serialized tree is exactly the Slice 2A one — no extra "$undefined" (U-16). */}
      {view.approvedPlanFrame ? (
        <>
          <div className="-mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] pt-4">
            <Label>{view.approvedPlanFrame.label}</Label>
            <span className="text-label ink-faint">{view.approvedPlanFrame.note}</span>
          </div>
          {focusAndNext}
        </>
      ) : focusAndNext}

      {/* Depth, one deliberate interaction away ------------------------------------ */}
      <div className="flex flex-col gap-1.5">
        {view.milestones.length > 0 && (
          <Disclosure summary={`Milestones (${view.progress.done} of ${view.progress.total} done)`}>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {view.milestones.map((m) => (
                <li key={m.key} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0 text-label ink">
                    {m.label}
                    {m.afterLabels.length > 0 && <span className="ink-faint"> — after {m.afterLabels.join(", ").toLowerCase()}</span>}
                  </span>
                  <Chip tone={m.status === "DONE" ? "var(--color-accent-verified)" : m.status === "BLOCKED" ? "var(--color-neutral-500)" : m.status === "NOT_ESTABLISHED" ? "var(--color-accent-intelligence)" : "var(--color-accent-attention)"}>
                    {m.statusLabel}
                  </Chip>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {view.history.length > 0 && (
          <Disclosure summary={`Plan history (${view.history.length})`}>
            <ul className="divide-y divide-[var(--border-subtle)]">
              {view.history.map((h) => (
                <li key={h.id} className="py-1.5">
                  <div className="text-label font-semibold ink">{h.label}</div>
                  <div className="tnum text-label ink-faint">{[h.detail ? humanizeText(h.detail) : null, h.atLabel].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
