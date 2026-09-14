"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decidePlanAction, requestPlanRecommendationAction } from "@/app/pursuits/[id]/actions";
import { buttonClass, fieldClass } from "@/components/ui";
import type { PursuitPlanView } from "@/lib/pursuits/read-models/pursuit-plan";

/**
 * Approve / adjust for the Pursuit plan. Follows the Route decision's shape: it
 * asks, the governed boundary decides (`decide_pursuit_plan` via `dispatchSkill`),
 * and the recommendation is preserved whatever the person chooses.
 *
 *   decide   — Approve, or Adjust… (action wording, owner, due window; reason required),
 *              or Decline (reason required).
 *   review   — the same, on the updated recommendation raised by a review.
 *   request  — ask for a recommendation (none yet, declined, or the one on record is stale).
 *
 * Nothing here sends, executes or contacts anyone. Approval can queue the next action
 * on the motion's existing work queue; that is the furthest it reaches.
 */
export function PlanControls({ mode, pursuitId, view, canDecide }: {
  mode: "decide" | "review" | "request";
  pursuitId: string;
  view: PursuitPlanView;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [text, setText] = useState(view.decision.actionText ?? "");
  const [owner, setOwner] = useState<string>(view.decision.ownerTeamMemberId ?? "UNASSIGNED");
  const [due, setDue] = useState(String(view.decision.dueInDays));
  const [reason, setReason] = useState("");

  const recId = view.decision.recommendationId;
  const stale = view.decision.stale;

  if (!canDecide) {
    if (mode === "request" || (recId && !stale)) {
      return <p className="mt-3 text-label italic text-neutral-400">An operator can approve or adjust this plan.</p>;
    }
    return null;
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "That was not accepted."); return; }
      setAdjusting(false); setReason("");
      router.refresh();
    });
  };

  const request = () => run(() => requestPlanRecommendationAction(pursuitId));

  if (mode === "request" || !recId || stale) {
    // Nothing awaiting a decision (or it no longer matches the pursuit). The one
    // thing to offer is a fresh recommendation — never a decision on a stale one.
    if (mode !== "request" && !recId && !stale) return null;
    return (
      <div className="mt-3">
        {stale && <p className="mb-1.5 text-label ink-faint">The pursuit changed since this plan was recommended.</p>}
        <button type="button" disabled={pending} onClick={request} className={buttonClass("secondary", "md")}>
          {pending ? "Working…" : view.exists ? "Get an updated recommendation" : "Recommend a plan"}
        </button>
        {error && <p className="mt-2 text-label" style={{ color: "var(--color-accent-risk)" }}>{error}</p>}
      </div>
    );
  }

  const decide = (decision: "APPROVED" | "ADJUSTED" | "REJECTED") => run(() => decidePlanAction(pursuitId, {
    planId: view.planId!, recommendationId: recId, decision, reason: decision === "APPROVED" ? null : reason,
    adjustments: decision === "ADJUSTED"
      ? {
        nextActionText: text.trim() !== (view.decision.actionText ?? "") ? text : undefined,
        ownerTeamMemberId: owner !== (view.decision.ownerTeamMemberId ?? "UNASSIGNED") ? (owner === "UNASSIGNED" ? null : owner) : undefined,
        dueInDays: Number(due) !== view.decision.dueInDays ? Number(due) : undefined,
      }
      : undefined,
  }));

  const noun = mode === "review" ? "update" : "plan";
  return (
    <div className="mt-3">
      {!adjusting ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => decide("APPROVED")} className={buttonClass("primary", "md")}>
            {pending ? "Approving…" : `Approve ${noun}`}
          </button>
          <button type="button" disabled={pending} onClick={() => setAdjusting(true)} className={buttonClass("secondary", "md")}>Adjust…</button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <label className="block text-label">
            <span className="font-semibold text-neutral-500">Next action</span>
            <input value={text} onChange={(e) => setText(e.target.value)} className={`mt-1 w-full ${fieldClass("md")}`} maxLength={240} />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-0 flex-1 text-label">
              <span className="font-semibold text-neutral-500">Owner</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`mt-1 w-full ${fieldClass("md")}`}>
                <option value="UNASSIGNED">Unassigned</option>
                {view.decision.teamOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <label className="w-28 text-label">
              <span className="font-semibold text-neutral-500">Due in (days)</span>
              <input type="number" min={1} max={60} value={due} onChange={(e) => setDue(e.target.value)} className={`mt-1 w-full ${fieldClass("md")}`} />
            </label>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (required)" className={`w-full ${fieldClass("md")}`} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || !reason.trim()} onClick={() => decide("ADJUSTED")} className={buttonClass("primary", "md")}>
              {pending ? "Recording…" : "Approve with changes"}
            </button>
            <button type="button" disabled={pending || !reason.trim()} onClick={() => decide("REJECTED")} className={buttonClass("subtle", "md")}>Decline</button>
            <button type="button" disabled={pending} onClick={() => setAdjusting(false)} className={buttonClass("subtle", "md")}>Cancel</button>
          </div>
          <p className="text-label ink-faint">The recommendation is kept either way.</p>
        </div>
      )}
      {error && <p className="mt-2 text-label" style={{ color: "var(--color-accent-risk)" }}>{error}</p>}
    </div>
  );
}
