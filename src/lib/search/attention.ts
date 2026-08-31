import type { ResolveContext, IntentResult } from "./registry";
import { getTodayQueue } from "@/lib/pursuits/read-models/today";
import { getMotionFunnels, aggregateConstraints } from "@/lib/motions/funnel";

/**
 * Attention intents (P2C-1 §6, first query class): "What should I focus on today?", "Where is
 * revenue blocked?", "What is waiting on me?".
 *
 * These are NOT a new read model. They are three cuts of the SAME canonical Today decision queue
 * and Motion constraint aggregate the rooms already render, so an answer here and the screen the
 * operator then opens cannot disagree. The ordering is the server-side materiality policy, not
 * recency, and not anything this file invents.
 */

export type AttentionMode = "focus" | "blocked" | "waiting";

const MODE_RE: [AttentionMode, RegExp][] = [
  ["blocked", /\b(where\s+is\s+)?(revenue|pipeline|value)\s+(is\s+)?(blocked|stuck|constrained)\b|\bwhat(?:'s| is)\s+blocking\b|\bconstrained\s+revenue\b/i],
  ["waiting", /\bwaiting\s+on\s+(me|us)\b|\bneeds?\s+my\s+(approval|decision|sign[- ]?off)\b|\bawaiting\s+my\b/i],
  ["focus", /\bwhat\s+should\s+(i|we)\s+(focus|work|start|do)\b|\bfocus\s+on\s+(today|now|first)\b|\bwhat(?:'s| is)\s+most\s+important\b|\btop\s+priorit(y|ies)\b/i],
];

/** Deterministic parse. Returns null when the utterance is not an attention question. */
export function parseAttention(q: string): { mode: AttentionMode } | null {
  for (const [mode, re] of MODE_RE) if (re.test(q)) return { mode };
  return null;
}

const usd = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

/**
 * "Which Motion has the most constrained revenue?" (P2C-1 §6, Motion class). Same aggregate as the
 * `blocked` cut above, rolled up one level: per Motion instead of per blocker family. Kept as its
 * own intent because the question asks for a RANKING OF MOTIONS, and answering it with a list of
 * constraint families would be a different answer wearing the right words.
 */
export function parseMotionConstrained(q: string): boolean {
  return /\bmotions?\b/i.test(q) && /\bconstrain\w*|blocked|stuck\b/i.test(q);
}

export async function resolveMotionConstrained(ctx: ResolveContext): Promise<IntentResult> {
  const funnels = await getMotionFunnels(ctx.db, ctx.orgId, { companyIds: ctx.companyIds });
  const ranked = funnels
    .map((f) => {
      const agg = aggregateConstraints(f);
      return { name: f.hypothesis.name, slug: f.hypothesis.slug, usd: agg.totalUsd, top: agg.rows[0] ?? null, blocked: f.cohorts.blocked + f.cohorts.nearly_ready };
    })
    .filter((r) => r.usd > 0 || r.blocked > 0)
    .sort((a, b) => b.usd - a.usd);

  return {
    hits: ranked.slice(0, 10).map((r) => ({
      group: "Constrained revenue by Motion",
      label: r.name,
      sub: `${usd(r.usd)} constrained · ${r.blocked} pursuit${r.blocked === 1 ? "" : "s"} not ready${r.top ? ` · top blocker: ${r.top.label}` : ""}`,
      href: `/motions?h=${encodeURIComponent(r.slug)}`,
    })),
    interpreted: "Motions ranked by expected value behind a gating constraint — each pursuit counted once, against its PRIMARY blocker",
    note: ranked.length === 0
      ? "No Motion has revenue behind a gating constraint in this scope."
      : `${ranked[0].name} carries the most: ${usd(ranked[0].usd)}.`,
  };
}

export async function resolveAttention(ctx: ResolveContext, mode: AttentionMode): Promise<IntentResult> {
  if (mode === "blocked") {
    // Constrained revenue = the Motions room's own aggregate: each not-ready account's PRIMARY
    // gating blocker, grouped by family, carrying expected value. Overlays (informational
    // families) are deliberately excluded — they never gated anything, so they never blocked
    // revenue either, and summing them in would overstate the number.
    const funnels = await getMotionFunnels(ctx.db, ctx.orgId, { companyIds: ctx.companyIds });
    const rows: { family: string; label: string; count: number; usd: number; motion: string }[] = [];
    let total = 0;
    for (const f of funnels) {
      const agg = aggregateConstraints(f);
      total += agg.totalUsd;
      for (const r of agg.rows) rows.push({ family: r.family, label: r.label, count: r.count, usd: r.exposureUsd, motion: f.hypothesis.name });
    }
    rows.sort((a, b) => b.usd - a.usd);
    return {
      hits: rows.slice(0, 12).map((r) => ({
        group: `Blocked · ${r.motion}`,
        label: r.label,
        sub: `${r.count} pursuit${r.count === 1 ? "" : "s"} · ${usd(r.usd)} constrained`,
        href: "/motions",
      })),
      interpreted: "Revenue behind a gating Motion constraint, by blocker family — informational overlays excluded, because they never gated anything",
      note: rows.length === 0
        ? "Nothing is behind a gating constraint in this scope."
        : `${usd(total)} of expected value sits behind a gating constraint.`,
    };
  }

  // focus / waiting — both read the canonical Today queue in its materiality order.
  const caller = { orgId: ctx.orgId, canSeeInternal: true, canSeeTransactionDetail: true };
  const view = await getTodayQueue(ctx.db, caller, { companyIds: ctx.companyIds, limit: 40 });
  const items = mode === "waiting"
    // "Waiting on me" is a decision the operator personally has to make — the queue's own
    // DECISION_REQUIRED class. An ACTION_REQUIRED item is work, not a decision, so it is not
    // folded in: the two are distinct in the read model and stay distinct in the answer.
    ? view.items.filter((i) => i.decisionClass === "DECISION_REQUIRED")
    : view.items;

  return {
    hits: items.slice(0, 12).map((i) => ({
      group: mode === "waiting" ? "Waiting on you" : `Today · ${i.decisionClass.replace(/_/g, " ").toLowerCase()}`,
      label: `${i.accountLabel} — ${i.title}`,
      sub: `${i.reason}${i.commercialPriority !== "unknown" ? ` · ${i.commercialPriority.replace(/_/g, " ")} priority` : ""}`,
      href: i.deepLink,
    })),
    interpreted: mode === "waiting"
      ? "Decisions the record is holding for you — ordered by the same materiality policy Today uses, not by recency"
      : "Today's queue in materiality order: decision class, then operational urgency, then commercial priority, then age",
    note: items.length === 0
      ? (mode === "waiting" ? "No decision is waiting on you in this scope." : "Nothing has surfaced for today in this scope.")
      : `${items.length} item${items.length === 1 ? "" : "s"}${view.total != null && view.total > items.length ? ` of ${view.total}` : ""}.`,
  };
}
