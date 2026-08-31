"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RouteComparisonView, RouteCandidateView } from "@/lib/pursuits/read-models/types";
import { decideRouteAction } from "@/app/pursuits/[id]/actions";

/**
 * Governed route decision control (canonical micro-loop). The FIRST human governed commercial
 * mutation with a live audit trail — the reference for how PursuitOS decisions work. It states the
 * recommendation, lets an operator APPROVE it or OVERRIDE to another candidate (reason required),
 * and posts through `decideRouteAction` → `dispatchSkill`. Recommendation ≠ decision stays explicit;
 * nothing here recomputes or fabricates — it asks, the governed boundary decides. While the
 * decision's recompute is still draining, it says so rather than implying settled downstream state.
 */

const CATEGORIES: { value: string; label: string }[] = [
  { value: "RELATIONSHIP_KNOWLEDGE", label: "Relationship knowledge" },
  { value: "CUSTOMER_PREFERENCE", label: "Customer preference" },
  { value: "PARTNER_CAPACITY", label: "Partner capacity" },
  { value: "EXECUTIVE_DIRECTION", label: "Executive direction" },
  { value: "COMMERCIAL_TERMS", label: "Commercial terms" },
  { value: "TERRITORY", label: "Territory" },
  { value: "STRATEGIC_PRIORITY", label: "Strategic priority" },
  { value: "MODEL_ERROR", label: "Model error" },
  { value: "OTHER", label: "Other" },
];

export function RouteDecision({ view, pursuitId, canDecide }: { view: RouteComparisonView; pursuitId: string; canDecide: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "override">("idle");
  const [choice, setChoice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("OTHER");

  const rec = view.recommended;
  if (!rec) return null;
  const alternatives = view.alternatives.filter((a) => !a.disqualified);

  const submit = (candidateKey: string, decisionMode: "select" | "override", r: string | null, cat: string | null) => {
    setError(null);
    startTransition(async () => {
      const res = await decideRouteAction(pursuitId, candidateKey, decisionMode, r, cat);
      if (!res.ok) { setError(res.error ?? "Decision was not accepted."); return; }
      setMode("idle"); setChoice(null); setReason("");
      router.refresh();
    });
  };

  // ---- Decided state: state the outcome + governance + recompute honesty. ----
  if (view.decided) {
    const overridden = !view.selectionMatchesRecommendation;
    return (
      <div className="rounded-card p-3.5" style={{ background: "var(--surface-inset)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
        <div className="flex flex-wrap items-center gap-2 text-body">
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: overridden ? "var(--color-accent-attention)" : "var(--color-accent-verified)" }}>
            <span aria-hidden>✓</span> Decision recorded
          </span>
          <span className="text-neutral-500">
            {overridden ? <>overrode to <b>{view.selected?.label ?? "—"}</b> — recommendation <b>{rec.label}</b> preserved</> : <>approved the recommended route <b>{rec.label}</b></>}
          </span>
          <span className="rounded-full px-2 py-px text-micro font-semibold" style={{ background: "color-mix(in srgb, var(--color-route) 12%, transparent)", color: "var(--color-route)" }}>
            governed · {overridden ? "override_partner_route" : "select_partner_route"}
          </span>
        </div>
        {view.recomputePending ? (
          <div className="mt-2 inline-flex items-center gap-1.5 text-label text-neutral-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-timing)" }} aria-hidden />
            Propagating the decision — readiness &amp; Today are recomputing. Downstream state isn’t settled yet.
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-neutral-400">
            <span>Recompute complete · audit on the governed-action ledger.</span>
            <a href="/ops" className="font-medium hover:underline" style={{ color: "var(--color-route)" }}>View in Ops →</a>
          </div>
        )}
        {canDecide && (
          <button type="button" onClick={() => setMode("override")} disabled={pending}
            className="mt-2 text-label font-medium text-neutral-500 hover:underline">Change decision</button>
        )}
        {mode === "override" && <OverridePicker rec={rec} alternatives={alternatives} choice={choice} setChoice={setChoice} reason={reason} setReason={setReason} category={category} setCategory={setCategory} pending={pending} error={error} onCancel={() => setMode("idle")} onSubmit={() => choice && submit(choice, "override", reason, category)} />}
      </div>
    );
  }

  // ---- Undecided: the decision itself. ----
  if (!canDecide) {
    return <p className="text-body italic text-neutral-400">A decision on this route is pending — an operator can approve or override it.</p>;
  }

  return (
    <div className="rounded-card p-3.5" style={{ background: "color-mix(in srgb, var(--color-route) 5%, var(--surface-primary))", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-route) 22%, transparent)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-route)" }}>Your decision</span>
        <span className="text-body text-neutral-500">Approve the recommendation, or override it — recommendation is preserved either way.</span>
      </div>
      {mode === "idle" ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => submit(rec.key, "select", null, null)}
            className="rounded-control px-3.5 py-1.5 text-copy font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--color-route)" }}>
            {pending ? "Approving…" : `Approve ${rec.label}`}
          </button>
          {alternatives.length > 0 && (
            <button type="button" disabled={pending} onClick={() => setMode("override")}
              className="rounded-control px-3 py-1.5 text-copy font-medium text-neutral-600 dark:text-neutral-300"
              style={{ boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>Override…</button>
          )}
        </div>
      ) : (
        <OverridePicker rec={rec} alternatives={alternatives} choice={choice} setChoice={setChoice} reason={reason} setReason={setReason} category={category} setCategory={setCategory} pending={pending} error={error} onCancel={() => setMode("idle")} onSubmit={() => choice && submit(choice, "override", reason, category)} />
      )}
      {error && mode === "idle" && <p className="mt-2 text-label" style={{ color: "var(--color-accent-risk)" }}>{error}</p>}
    </div>
  );
}

function OverridePicker({ rec, alternatives, choice, setChoice, reason, setReason, category, setCategory, pending, error, onCancel, onSubmit }: {
  rec: RouteCandidateView; alternatives: RouteCandidateView[]; choice: string | null; setChoice: (v: string) => void;
  reason: string; setReason: (v: string) => void; category: string; setCategory: (v: string) => void;
  pending: boolean; error: string | null; onCancel: () => void; onSubmit: () => void;
}) {
  const options = [rec, ...alternatives];
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="space-y-1">
        <p className="text-label font-semibold uppercase tracking-[0.03em] text-neutral-500">Choose the route</p>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <button key={o.key} type="button" onClick={() => setChoice(o.key)}
              className={`rounded-full px-3 py-1 text-body font-medium transition-colors ${choice === o.key ? "text-white" : "text-neutral-600 dark:text-neutral-300"}`}
              style={choice === o.key ? { background: "var(--color-route)" } : { boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
              {o.label}{o.key === rec.key ? " · rec" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-control px-2.5 py-1.5 text-body" style={{ background: "var(--surface-primary)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why override? (required)"
          className="min-w-[220px] flex-1 rounded-control px-2.5 py-1.5 text-body" style={{ background: "var(--surface-primary)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }} />
      </div>
      {error && <p className="text-label" style={{ color: "var(--color-accent-risk)" }}>{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending || !choice || !reason.trim()} onClick={onSubmit}
          className="rounded-control px-3.5 py-1.5 text-copy font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-accent-attention)" }}>{pending ? "Recording…" : "Commit override"}</button>
        <button type="button" disabled={pending} onClick={onCancel} className="text-body font-medium text-neutral-500 hover:underline">Cancel</button>
      </div>
    </div>
  );
}
