import Link from "next/link";
import type { DecisionItem, DecisionClass } from "@/lib/pursuits/read-models/types";
import { BandPill, SyntheticBadge } from "./parts";

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

export function TodayDecisionCard({ item }: { item: DecisionItem }) {
  const hue = CLASS_HUE[item.decisionClass];
  const action = item.allowedActions[0];
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
        <div className="flex items-center gap-2 text-[14.5px] font-bold">
          <span className="truncate">{item.title}</span>
          {item.synthetic && <SyntheticBadge text="demo" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-neutral-500">
          <span>Operational urgency <b className="capitalize text-neutral-700 dark:text-neutral-200">{item.operationalUrgency}</b></span>
          <span className="flex items-center gap-1.5">Commercial priority <BandPill band={item.commercialPriority} /></span>
          {action && <span>Governed by <b className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">{action.skill}</b></span>}
        </div>
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
