import Link from "next/link";
import type { DecisionItem, DecisionClass } from "@/lib/pursuits/read-models/types";
import { BandPill } from "./parts";
import { skillLabel } from "./vocab";
import { buttonClass } from "@/components/ui";

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
  const governed = item.allowedActions[0];
  return [
    `Class: ${CLASS_WORD[item.decisionClass]} — the primary rank`,
    `Operational urgency: ${item.operationalUrgency}`,
    `Commercial priority: ${band}`,
    `Unresolved ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"}`} — older decisions break ties upward`,
    ...(governed ? [`Acting on it runs the governed skill: ${skillLabel(governed.skill)}`] : []),
    ...(item.reason ? [item.reason] : []),
  ];
}

export function TodayDecisionCard({
  item,
  drawerBase,
  showReason = true,
  showUrgency = true,
}: {
  item: DecisionItem;
  drawerBase?: string;
  /** False when this reason repeats across the queue — see TodayQueue. */
  showReason?: boolean;
  /** False when every visible row shares this urgency — see TodayQueue. */
  showUrgency?: boolean;
}) {
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
        {/* Wave 2 §17: the chip was a fixed 92px box, which is narrower than the
            longest label it has to carry — so "Decision required", the most common
            class in the queue, broke onto two lines on every single row. A minimum
            keeps the column aligned; nowrap keeps the label a label. */}
        <span className="inline-block whitespace-nowrap rounded-control px-2 py-1 text-center text-micro font-bold uppercase leading-tight tracking-[0.03em]" style={{ color: hue, background: `color-mix(in srgb, ${hue} 12%, transparent)`, minWidth: 92 }}>
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
        {/* WHY NOW — the one thing a reader cannot reconstruct from the rest of
            the row, and which this card never rendered at all. Shown only when
            it is specific to this item; see TodayQueue. */}
        {showReason && item.reason && <p className="mt-1 line-clamp-2 text-body text-neutral-500">{item.reason}</p>}
        {/* Status, not a label sentence. Every row previously carried
            "Operational urgency · Commercial priority · Governed by" spelled out
            in full, so six rows repeated the same three field names eighteen
            times and the values had to be read out of them. The band pill is
            self-describing; urgency earns a chip only when it is elevated,
            because "normal" on every row is not information. What runs when you
            act moved into the disclosure below, beside the other ranking facts. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-label">
          <BandPill band={item.commercialPriority} />
          {showUrgency && (item.operationalUrgency === "critical" || item.operationalUrgency === "high") && (
            <span className="rounded-full px-2 py-px text-micro font-bold uppercase tracking-[0.04em]"
              style={{ color: "var(--color-accent-attention)", background: "color-mix(in srgb, var(--color-accent-attention) 12%, transparent)" }}>
              {item.operationalUrgency} urgency
            </span>
          )}
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
      {/* One CTA grammar. This was filled with the row's class hue, so the same
          control was blue, red, violet or green depending on which kind of item
          it sat on — four colours for one action. The class is already stated by
          the chip on the left. */}
      <Link href={item.deepLink} className={`flex-none ${buttonClass("primary", "md")}`}>
        {action?.label ?? "Open"} →
      </Link>
    </div>
  );
}

export function TodayQueue({ items, drawerBase }: { items: DecisionItem[]; drawerBase?: string }) {
  if (!items.length) return <p className="text-copy text-neutral-500">Nothing needs a decision right now.</p>;

  /*
   * A reason that appears on every row is not a reason — it is the decision
   * class restated once per card. Six route approvals all read "Recommended
   * route is awaiting your approval", which the class chip, the title and the
   * CTA had each already said. So the QUEUE decides: a reason earns its line
   * only where it distinguishes this item from its neighbours, which is exactly
   * when it carries a finding (a stalled deal, a contradiction, a date) rather
   * than a restatement.
   *
   * This is a display rule, not a filter. Nothing is dropped from the queue, the
   * ordering is untouched, and the full reason stays in "Why is this here?".
   */
  const seen = new Map<string, number>();
  for (const it of items) if (it.reason) seen.set(it.reason, (seen.get(it.reason) ?? 0) + 1);
  const repeated = (r: string | null | undefined) => !!r && (seen.get(r) ?? 0) > items.length / 2;

  /*
   * Wave 2 §14 — the same rule, applied to the elevated-urgency chip.
   *
   * On the demo queue every visible row carried "HIGH URGENCY", so the chip
   * appeared four times and discriminated between exactly none of them. A field
   * whose value is constant across everything you can see is a property of the
   * QUEUE, not of any row in it — and repeating it per row spends the reader's
   * most valuable glance on the one thing that cannot help them choose.
   *
   * So it is stated once, above, and dropped from the rows. Nothing is hidden:
   * the same word, the same source field, one place instead of N. The moment the
   * queue is mixed the chips come back, because then they do discriminate.
   */
  const urgencies = new Set(items.map((it) => it.operationalUrgency));
  const shared = urgencies.size === 1 && items.length > 1 ? [...urgencies][0] : null;
  const sharedElevated = shared === "critical" || shared === "high" ? shared : null;

  return (
    <div className="flex flex-col gap-2.5">
      {sharedElevated && (
        <p className="text-label ink-faint">
          All {items.length} carry <b style={{ color: "var(--color-accent-attention)" }}>{sharedElevated} operational urgency</b> — ordered below by commercial materiality.
        </p>
      )}
      {items.map((it) => (
        <TodayDecisionCard key={it.id} item={it} drawerBase={drawerBase} showReason={!repeated(it.reason)} showUrgency={!sharedElevated} />
      ))}
    </div>
  );
}
