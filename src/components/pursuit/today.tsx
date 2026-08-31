import Link from "next/link";
import type { DecisionItem, DecisionClass } from "@/lib/pursuits/read-models/types";
import { BandPill } from "./parts";
import { skillLabel } from "./vocab";

/**
 * Today decision queue (Workstream D.5 §20). The operating queue: what needs my
 * attention that can materially change revenue, ordered by materiality (the read
 * model already sorts) — not a wall of KPIs, not arrival order. Operational
 * urgency and commercial priority are shown as distinct fields (§12).
 */

const CLASS_HUE: Record<DecisionClass, string> = {
  DECISION_REQUIRED: "var(--color-priority)",
  RISK: "var(--color-accent-risk)",
  ACTION_REQUIRED: "var(--color-route)",
  MATERIAL_CHANGE: "var(--color-accent-violet)",
  OPPORTUNITY: "var(--color-accent-verified)",
  FYI: "var(--color-neutral-500)",
};
const CLASS_WORD: Record<DecisionClass, string> = {
  DECISION_REQUIRED: "Decision required", RISK: "Risk", ACTION_REQUIRED: "Action required",
  MATERIAL_CHANGE: "Material change", OPPORTUNITY: "Opportunity", FYI: "FYI",
};

/**
 * Materiality explainability (R3): render — from EXISTING canonical factors only, in the exact
 * order the server-side materiality policy ranks them (class → operational urgency → commercial
 * priority → age) — why this item sits where it does. No new score, no new primitive.
 */
function whyHere(item: DecisionItem): string[] {
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(item.at).getTime()) / 86_400_000));
  const band = item.commercialPriority.replace(/_/g, " ");
  return [
    `Class: ${CLASS_WORD[item.decisionClass]} — the primary rank`,
    `Operational urgency: ${item.operationalUrgency}`,
    `Commercial priority: ${band}`,
    `Unresolved ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"}`} — older decisions break ties upward`,
  ];
}

export function TodayDecisionCard({ item }: { item: DecisionItem }) {
  const hue = CLASS_HUE[item.decisionClass];
  const action = item.allowedActions[0];
  const factors = whyHere(item);
  return (
    <div
      className="pos-lift flex items-center gap-4 rounded-card p-4"
      style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-low)", borderLeft: `3px solid ${hue}` }}
    >
      <div className="flex-none">
        <span className="inline-block rounded-md px-2 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.03em]" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)`, width: 92 }}>
          {CLASS_WORD[item.decisionClass]}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[14.5px] font-bold">
          <span className="truncate">{item.accountLabel}</span>
          <span className="truncate text-[12.5px] font-medium text-neutral-500">{item.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-neutral-500">
          <span>Operational urgency <b className="capitalize text-neutral-700 dark:text-neutral-200">{item.operationalUrgency}</b></span>
          <span className="flex items-center gap-1.5">Commercial priority <BandPill band={item.commercialPriority} /></span>
          {action && <span>Governed by <b className="text-neutral-600 dark:text-neutral-300">{skillLabel(action.skill)}</b></span>}
        </div>
        <details className="mt-1.5 group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            <svg viewBox="0 0 16 16" className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 4l4 4-4 4" /></svg>
            Why is this here?
          </summary>
          <ol className="mt-1 space-y-0.5 pl-4 text-[11px] text-neutral-500">
            {factors.map((f, i) => (
              <li key={i} className="list-decimal"><span className={i === 0 ? "font-medium text-neutral-600 dark:text-neutral-300" : ""}>{f}</span></li>
            ))}
          </ol>
        </details>
      </div>
      <Link
        href={item.deepLink}
        className="flex-none rounded-full px-4 py-2 text-[12.5px] font-bold text-white transition"
        style={{ background: hue }}
      >
        {action?.label ?? "Open"} →
      </Link>
    </div>
  );
}

export function TodayQueue({ items }: { items: DecisionItem[] }) {
  if (!items.length) return <p className="text-[13px] text-neutral-500">Nothing needs a decision right now.</p>;
  return <div className="flex flex-col gap-2.5">{items.map((it) => <TodayDecisionCard key={it.id} item={it} />)}</div>;
}
