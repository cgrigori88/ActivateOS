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

export function TodayDecisionCard({ item, drawerBase }: { item: DecisionItem; drawerBase?: string }) {
  const hue = CLASS_HUE[item.decisionClass];
  const action = item.allowedActions[0];
  const factors = whyHere(item);
  const drawerHref = item.companyId && drawerBase !== undefined
    ? (() => { const p = new URLSearchParams(drawerBase); p.set("drawer", item.companyId!); const qs = p.toString(); return qs ? `/?${qs}` : "/"; })()
    : null;
  // The decision class was carried twice: a 3px coloured rail on the card AND a
  // tinted class chip. A thick coloured edge is decoration doing a job the chip
  // already does, and Motions signals the same thing with a dot — so the two
  // rooms now share one vocabulary. The card keeps a plain hairline.
  return (
    <div
      className="pos-lift flex items-center gap-4 rounded-card p-4"
      style={{ background: "var(--surface-primary)", boxShadow: "var(--shadow-low)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex flex-none items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hue }} aria-hidden />
        <span className="inline-block rounded-control px-2 py-1 text-center text-micro font-bold uppercase leading-tight tracking-[0.03em]" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)`, width: 92 }}>
          {CLASS_WORD[item.decisionClass]}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-copy font-bold">
          {drawerHref
            ? <Link href={drawerHref} scroll={false} className="truncate hover:underline" title="Open account intelligence">{item.accountLabel}</Link>
            : <span className="truncate">{item.accountLabel}</span>}
          <span className="truncate text-body font-medium text-neutral-500">{item.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-neutral-500">
          <span>Operational urgency <b className="capitalize text-neutral-700 dark:text-neutral-200">{item.operationalUrgency}</b></span>
          <span className="flex items-center gap-1.5">Commercial priority <BandPill band={item.commercialPriority} /></span>
          {action && <span>Governed by <b className="text-neutral-600 dark:text-neutral-300">{skillLabel(action.skill)}</b></span>}
        </div>
        <details className="mt-1.5 group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-label font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            <svg viewBox="0 0 16 16" className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 4l4 4-4 4" /></svg>
            Why is this here?
          </summary>
          <ol className="mt-1 space-y-0.5 pl-4 text-label text-neutral-500">
            {factors.map((f, i) => (
              <li key={i} className="list-decimal"><span className={i === 0 ? "font-medium text-neutral-600 dark:text-neutral-300" : ""}>{f}</span></li>
            ))}
          </ol>
        </details>
      </div>
      <Link
        href={item.deepLink}
        className="flex-none rounded-full px-4 py-2 text-body font-bold text-white transition"
        style={{ background: hue }}
      >
        {action?.label ?? "Open"} →
      </Link>
    </div>
  );
}

export function TodayQueue({ items, drawerBase }: { items: DecisionItem[]; drawerBase?: string }) {
  if (!items.length) return <p className="text-copy text-neutral-500">Nothing needs a decision right now.</p>;
  return <div className="flex flex-col gap-2.5">{items.map((it) => <TodayDecisionCard key={it.id} item={it} drawerBase={drawerBase} />)}</div>;
}
