import type { PursuitDetailView, ScoreReason } from "./types";
import type { PursuitOutcomeSummary } from "./outcome-summary";

/**
 * Disclosure-aware Pursuit Brief (Phase F1). A calm, executive restatement of the ALREADY-AUTHORIZED
 * detail view — a presentation, never a new query and never invented content. Every line is bound to
 * something the read model already produced (thesis, why-now, facts, the route's disclosure-filtered
 * reasons, team, outcome). The sponsor↔partner "wow" rides the split the server already made: a line
 * carrying a confidential figure that the shareable projection dropped is marked `confidential`, so
 * the Partner rendering genuinely withholds it rather than hiding it in the browser.
 *
 * INVARIANTS: nothing here fabricates a claim; an absent input yields an honest empty note, not a
 * guess; confidential figures are never promoted into partner-safe sections.
 */

export interface BriefLine {
  text: string;
  /** Sponsor-only — withheld from the Partner rendering (a confidential figure the shareable payload dropped). */
  confidential?: boolean;
  /** A caution line (what not to claim / contested evidence) — styled as a guardrail. */
  caution?: boolean;
  ref?: string | null;
}
export interface BriefSection { key: string; title: string; lines: BriefLine[]; emptyNote?: string }
export interface PursuitBrief { headline: string; subhead: string; sections: BriefSection[] }

/** A reason line carries a confidential FIGURE (currency / magnitude) — the specifics the shareable payload strips. */
function isConfidentialFigure(text: string): boolean {
  return /\$\s?\d|\b\d[\d,.]*\s?(?:M|K|bn|B)\b/.test(text);
}
const clean = (t: string) => t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
const money = (n: number | null, cur: string | null) => (n == null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", notation: "compact", maximumFractionDigits: 1 }).format(n));

export function buildPursuitBrief(d: PursuitDetailView, outcome?: PursuitOutcomeSummary | null): PursuitBrief {
  const r = d.route;
  const rec = r.recommended ?? r.selected ?? null;
  const shareable: ScoreReason[] = rec?.reasonsShareable ?? [];
  const internal: ScoreReason[] = rec?.reasonsInternal ?? [];
  const shareText = new Set(shareable.map((s) => clean(s.text)));

  // WHAT IS HAPPENING — the thesis + where it stands. The expected value is a confidential figure.
  const happening: BriefLine[] = [{ text: d.thesis }];
  happening.push({ text: `${d.accountLabel} · ${clean(d.lifecycle)}${d.solution ? ` · ${d.solution}` : ""}` });
  const ev = money(d.expectedValue, d.currency);
  if (ev) happening.push({ text: `Expected value ${ev}.`, confidential: true });

  // WHY NOW — structured trigger components (present ones only; unknowns feed WHAT TO ASK).
  const whyNow: BriefLine[] = [];
  for (const c of [d.whyNow.businessTrigger, d.whyNow.technologyCondition, d.whyNow.timingAnchor, d.whyNow.signalConvergence]) {
    if (c?.present) whyNow.push({ text: `${c.label}: ${c.detail ?? "present"}${c.commercialImplication ? ` — ${c.commercialImplication}` : ""}`, ref: c.refId ?? null });
  }

  // WHO MATTERS — the confirmed/proposed team; a waiting or missing role is flagged.
  const who: BriefLine[] = d.team.members.map((m) => ({
    text: `${clean(m.role)}${m.partnerLabel ? ` — ${m.partnerLabel}` : m.personLabel ? ` — ${m.personLabel}` : ""} · ${clean(m.status).toLowerCase()}${m.waiting ? " (awaiting acceptance)" : ""}`,
  }));

  // ROUTE — the recommendation and whether a human has decided (recommendation ≠ decision).
  const route: BriefLine[] = [];
  if (rec) {
    route.push({ text: r.decided
      ? (r.selectionMatchesRecommendation ? `Selected the recommended route: ${rec.label}.` : `Human decision: routing via ${r.selected?.label ?? "the selected partner"} — recommendation (${rec.label}) preserved.`)
      : `Recommended route: ${rec.label} — awaiting a governed decision.` });
    if (r.overrideReason) route.push({ text: `Override reason: ${r.overrideReason}` });
  }

  // WHAT WE KNOW — internal reasons (sponsor sees all; the confidential figures are marked so the
  // partner rendering drops exactly them) plus trusted facts.
  const know: BriefLine[] = internal.map((s) => ({ text: clean(s.text), confidential: isConfidentialFigure(s.text) && !shareText.has(clean(s.text)), ref: s.refId ?? null }));
  for (const f of d.facts.slice(0, 4)) know.push({ text: f.proposition, ref: f.id });

  // WHAT THEY CAN KNOW — the disclosure-safe projection (identical in both renderings; it IS the
  // answer to "what may the partner receive").
  const canKnow: BriefLine[] = shareable.map((s) => ({ text: clean(s.text), ref: s.refId ?? null }));

  // WHAT TO SAY — partner-safe talking points: positive shareable reasons + the thesis.
  const toSay: BriefLine[] = [{ text: d.thesis }, ...shareable.filter((s) => s.polarity >= 0).map((s) => ({ text: clean(s.text) }))];

  // WHAT TO ASK — the open questions (the read model's unknowns; asking is not claiming).
  const toAsk: BriefLine[] = d.whyNow.unknowns.map((u) => ({ text: clean(u) }));

  // WHAT NOT TO CLAIM — the guardrail. Confidential figures that must not reach the partner, and
  // contested evidence that must not be asserted as settled.
  const notClaim: BriefLine[] = [];
  for (const s of internal) if (isConfidentialFigure(s.text) && !shareText.has(clean(s.text))) notClaim.push({ text: `Do not share the confidential figure: ${clean(s.text)}.`, confidential: true, caution: true });
  if (ev) notClaim.push({ text: `Do not disclose expected value (${ev}) to the partner.`, confidential: true, caution: true });
  for (const c of d.whyNow.contradictions) notClaim.push({ text: `Contested — do not assert as settled: ${clean(c.text)}.`, caution: true });

  // WHAT NEXT — the governed next steps: the route decision, waiting-on team, held roles, outcome.
  const next: BriefLine[] = [];
  if (rec && !r.decided) next.push({ text: `Make the governed route decision (approve ${rec.label} or override).` });
  for (const m of d.team.members.filter((m) => m.waiting)) next.push({ text: `Waiting on ${m.partnerLabel ?? clean(m.role)} to accept.` });
  for (const role of d.team.missingRequiredRoles) next.push({ text: `Confirm and staff the required role: ${clean(role)}.` });
  if (outcome?.latest) next.push({ text: `Outcome recorded: ${clean(outcome.latest.label)}${outcome.attribution ? ` · attribution ${outcome.attribution.effectiveClass}` : ""}.` });
  for (const p of d.pendingDecisions.slice(0, 3)) next.push({ text: p.title });

  const sections: BriefSection[] = [
    { key: "happening", title: "What is happening", lines: happening },
    { key: "why", title: "Why now", lines: whyNow, emptyNote: "No structured Why Now yet — do not manufacture urgency." },
    { key: "who", title: "Who matters", lines: who, emptyNote: "No team proposed yet." },
    { key: "route", title: "Route", lines: route, emptyNote: "No route recommended yet." },
    { key: "know", title: "What we know", lines: know, emptyNote: "No internal evidence lines available." },
    { key: "canknow", title: "What they can know", lines: canKnow, emptyNote: "Nothing is cleared to share with the partner yet." },
    { key: "say", title: "What to say", lines: toSay },
    { key: "ask", title: "What to ask", lines: toAsk, emptyNote: "No open questions flagged." },
    { key: "notclaim", title: "What not to claim", lines: notClaim, emptyNote: "No confidential figures or contested claims to guard." },
    { key: "next", title: "What next", lines: next, emptyNote: "No open next step." },
  ];

  return {
    headline: d.thesis,
    subhead: `${d.accountLabel} · ${clean(d.lifecycle)} — a disclosure-aware brief assembled from this pursuit's evidence`,
    sections,
  };
}
