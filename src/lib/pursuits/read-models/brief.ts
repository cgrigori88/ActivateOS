import type { PursuitDetailView, ScoreReason } from "./types";
import type { PursuitOutcomeSummary } from "./outcome-summary";
import { bounds as vBounds, qualityLine as vQuality, usd as vUsd } from "@/lib/value/case";
import { toPartnerValueCase as partnerProjection, SPONSOR_CONFIDENTIAL_NOTE } from "@/lib/value/projection";
import { formatMoney } from "@/lib/format/money";

/** Value formatters, imported once so the Brief speaks the same economics language as every surface. */
const valueFmt = { bounds: vBounds, qualityLine: vQuality, usd: vUsd };

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
// Wave 1 §2: was a second `Intl` compact formatter with its own rounding
// policy. The brief quotes figures that also appear on the Pursuit room, so a
// disagreement here reads as two systems reporting different numbers.
// `null` (rather than an em dash) is preserved — callers omit the line entirely
// when the amount is UNKNOWN, which is not the same as showing a placeholder.
const money = (n: number | null, cur: string | null) => (n == null ? null : formatMoney(n, { currency: cur }));

export function buildPursuitBrief(
  d: PursuitDetailView, outcome?: PursuitOutcomeSummary | null,
  motion?: { hypothesis: string; status: string } | null,
): PursuitBrief {
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
  // Motion context (P1A) — the commercial hypothesis this pursuit serves. Internal strategy:
  // confidential by default, withheld from the partner rendering.
  if (motion) happening.push({ text: `Serving hypothesis: ${motion.hypothesis} (motion ${motion.status}).`, confidential: true });

  // WHY NOW — structured trigger components (present ones only; unknowns feed WHAT TO ASK).
  const whyNow: BriefLine[] = [];
  for (const c of [d.whyNow.businessTrigger, d.whyNow.technologyCondition, d.whyNow.timingAnchor, d.whyNow.signalConvergence]) {
    if (c?.present) whyNow.push({ text: `${c.label}: ${c.detail ?? "present"}${c.commercialImplication ? ` — ${c.commercialImplication}` : ""}`, ref: c.refId ?? null });
  }
  // Lifecycle Intelligence (P2A): WHY NOW inherits the state AND its uncertainty. A window is never
  // narrowed to a day, and a conflict is stated as a conflict rather than resolved by picking.
  for (const e of d.whyNow.lifecycle) {
    if (e.state === "UNKNOWN") continue;
    const when = e.state === "CONFLICTING_DATE"
      ? e.competing.map((c) => c.date?.slice(0, 10) ?? "—").join(" vs ")
      : e.date ? e.date.slice(0, 10)
      : e.window ? `${e.window.from?.slice(0, 10) ?? "—"} → ${e.window.to?.slice(0, 10) ?? "—"}`
      : "—";
    whyNow.push({
      text: `${e.label}: ${when} — ${e.state.replace(/_/g, " ").toLowerCase()}${e.daysUntil != null && e.state !== "CONFLICTING_DATE" ? ` (${e.daysUntil}d)` : ""}. ${e.because}`,
    });
  }

  // WHO MATTERS — the confirmed/proposed team; a waiting or missing role is flagged. Stakeholder
  // Intelligence (P1C) adds the BUYING side from the same canonical projection the detail renders:
  // names + roles + assertion states. Buying-side identity is confidential BY DEFAULT — every
  // person-bearing line is withheld from the partner rendering.
  const who: BriefLine[] = d.team.members.map((m) => ({
    text: `${clean(m.role)}${m.partnerLabel ? ` — ${m.partnerLabel}` : m.personLabel ? ` — ${m.personLabel}` : ""} · ${clean(m.status).toLowerCase()}${m.waiting ? " (awaiting acceptance)" : ""}`,
  }));
  const cov = d.stakeholders;
  if (cov?.established) {
    for (const r of cov.roles) {
      if (r.person) who.push({ text: `${clean(r.role)} — ${r.person.name ?? "unnamed"} · ${r.state.toLowerCase()}${r.source ? ` (${r.source})` : ""}`, confidential: true });
      else who.push({ text: `${clean(r.role)} — not identified.`, confidential: true });
    }
  } else if (cov) {
    who.push({ text: "Buying-side stakeholder coverage not established yet (no linked opportunity).", confidential: true });
  }

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
  // Stakeholder coverage gaps drive their own questions ("Who owns final economic approval?").
  const toAsk: BriefLine[] = d.whyNow.unknowns.map((u) => ({ text: clean(u) }));
  if (cov?.established) for (const q of cov.gapQuestions) toAsk.push({ text: q });

  // WHAT NOT TO CLAIM — the guardrail. Confidential figures that must not reach the partner, and
  // contested evidence that must not be asserted as settled.
  const notClaim: BriefLine[] = [];
  for (const s of internal) if (isConfidentialFigure(s.text) && !shareText.has(clean(s.text))) notClaim.push({ text: `Do not share the confidential figure: ${clean(s.text)}.`, confidential: true, caution: true });
  if (ev) notClaim.push({ text: `Do not disclose expected value (${ev}) to the partner.`, confidential: true, caution: true });
  for (const c of d.whyNow.contradictions) notClaim.push({ text: `Contested — do not assert as settled: ${clean(c.text)}.`, caution: true });
  // Lifecycle uncertainty is a claims guardrail: an inferred window or a conflicting date must
  // never be spoken as a confirmed date (P2A — avoid fake exactness).
  for (const e of d.whyNow.lifecycle) {
    if (e.state === "INFERRED_WINDOW") {
      notClaim.push({ text: `The ${e.label.toLowerCase()} is an inferred window, not a confirmed date — do not state a specific day.`, caution: true });
    } else if (e.state === "CONFLICTING_DATE") {
      notClaim.push({ text: `The ${e.label.toLowerCase()} is contradicted across sources — do not assert either date until it is verified.`, caution: true });
    } else if (e.state === "STALE_DATE") {
      notClaim.push({ text: `The ${e.label.toLowerCase()} on record is past its validity — do not present it as current.`, caution: true });
    }
  }
  // Unverified buying authority must never be presented as settled (P1C §9).
  if (cov?.established) {
    for (const r of cov.roles) {
      if (r.state === "VERIFIED") continue;
      notClaim.push({
        text: r.state === "MISSING"
          ? `${clean(r.role)} has not been identified — do not claim buying-side coverage there.`
          : `${clean(r.role)} has not been verified (${r.state.toLowerCase()}) — do not present it as confirmed authority.`,
        caution: true, confidential: true,
      });
    }
  }

  // ── BUSINESS VALUE (P2B §13) ────────────────────────────────────────────────────────────────
  // The defensible range and what supports it. A case that is not defensible says so; the Brief
  // never generates value messaging the evidence does not carry.
  const value: BriefLine[] = [];
  const vc = d.valueCase;
  if (vc && vc.state !== "NOT_ESTABLISHED") {
    const { bounds: vbounds, qualityLine: vquality, usd: vusd } = valueFmt;
    // DERIVED-VALUE DISCLOSURE (§16). The internal modeled range may be composed from
    // sponsor-confidential drivers, and a partner who can see the total plus the disclosed parts
    // could subtract to recover a withheld one. So the internal total is marked confidential
    // whenever ANY contributing driver is withheld, and the partner-safe line is RECOMPUTED from
    // the disclosable drivers alone — never the internal total with rows hidden.
    const anyWithheld = vc.drivers.some((dr) => !dr.partnerSafe);
    if (vc.defensible && vc.modeledImpact) {
      value.push({ text: `Modeled customer impact ${vbounds(vc.modeledImpact)} — ${vc.because}`, confidential: anyWithheld });
    } else {
      value.push({ text: `Value case not yet defensible — ${vc.because}`, caution: true });
    }
    if (anyWithheld) {
      const partnerView = partnerProjection(vc);
      value.push(partnerView.modeledImpact
        ? { text: `Partner-safe modeled impact ${vbounds(partnerView.modeledImpact)}, recomputed from disclosed inputs only.` }
        : { text: partnerView.withheldReason ?? "No modeled range can be shared with the partner." });
      value.push({ text: SPONSOR_CONFIDENTIAL_NOTE });
    }
    if (vc.baseline) {
      value.push({ text: `At stake today: ${vbounds(vc.baseline)} recurring current-state cost. This is context, not impact.`, confidential: true });
    }
    if (vc.changeCost) value.push({ text: `Cost to change: ${vbounds(vc.changeCost)}.` });
    value.push({ text: `Evidence quality: ${vquality(vc.quality)}.` });
    // The three economic truths, never merged into one number.
    if (vc.dealAmount != null) {
      value.push({ text: `Deal amount ${vusd(vc.dealAmount)} is OUR revenue, not the customer's impact — the two are different figures and must not be conflated.` });
    }

    // WHAT WE KNOW gains the evidenced economics only.
    for (const dr of vc.drivers) {
      if (dr.conflicting) continue;
      if (dr.ladder !== "VERIFIED" && dr.ladder !== "CUSTOMER_CONFIRMED") continue;
      const b = dr.value;
      if (!b) continue;
      know.push({
        text: `${dr.label}: ${b.low === b.high ? vusd(b.low) : `${vusd(b.low)}–${vusd(b.high)}`} (${dr.ladder === "VERIFIED" ? "verified" : "customer-confirmed"}).`,
        confidential: dr.values.some((v) => v.disclosureClass !== "PARTNER_SHARED"),
      });
    }

    // WHAT NOT TO CLAIM gains the assumptions, the conflicts and the unknowns.
    for (const dr of vc.drivers) {
      if (dr.conflicting) {
        notClaim.push({
          text: `${dr.label} is contradicted across sources (${dr.values.map((v) => (v.low === v.high ? vusd(v.low) : `${vusd(v.low)}–${vusd(v.high)}`)).join(" vs ")}) — do not quote either figure as settled.`,
          caution: true,
        });
      } else if (dr.ladder === "ASSUMED") {
        notClaim.push({ text: `${dr.label} is a working assumption, not a customer-confirmed figure — do not present it as their number.`, caution: true });
      } else if (dr.ladder === "INFERRED") {
        notClaim.push({ text: `${dr.label} is inferred — do not attribute it to the customer.`, caution: true });
      }
      if (dr.values.some((v) => v.disclosureClass !== "PARTNER_SHARED")) {
        notClaim.push({ text: `Do not share the sponsor-confidential economics behind ${dr.label.toLowerCase()}.`, confidential: true, caution: true });
      }
    }
    if (!vc.defensible) {
      notClaim.push({ text: `Do not state a modeled value for this pursuit — no defensible range exists yet.`, caution: true });
    }

    // WHAT TO ASK gains the highest-value missing economic inputs, in sensitivity order.
    for (const sIt of vc.sensitivity.slice(0, 3)) {
      toAsk.push({
        text: sIt.narrowsRangeBy != null && sIt.narrowsRangeBy > 0
          ? `${sIt.label}: ${sIt.ask} Verifying it narrows the modeled range by ${vusd(sIt.narrowsRangeBy)}.`
          : `${sIt.label}: ${sIt.ask}`,
      });
    }
  } else if (vc) {
    value.push({ text: "No economic facts on this account — what is at stake has not been established.", caution: true });
  }

  // WHAT NEXT — the governed next steps: the route decision, waiting-on team, held roles, outcome.
  const next: BriefLine[] = [];
  if (rec && !r.decided) next.push({ text: `Make the governed route decision (approve ${rec.label} or override).` });
  // Stakeholder gap as a next step (P1C §9) — with the best KNOWN path, or an honest UNKNOWN.
  if (cov?.established) {
    const gap = cov.roles.find((x) => x.role === "economic_buyer" && x.state !== "VERIFIED");
    if (gap) {
      const path = cov.warmPaths.find((p) => p.tier === "PERSON_VERIFIED") ?? cov.warmPaths.find((p) => p.tier === "SELLER_ACCOUNT");
      next.push({ text: `Verify the economic buyer${path?.via ? ` — best known path via ${path.via}` : " — best known path UNKNOWN"}.`, confidential: true });
    }
  }
  for (const m of d.team.members.filter((m) => m.waiting)) next.push({ text: `Waiting on ${m.partnerLabel ?? clean(m.role)} to accept.` });
  for (const role of d.team.missingRequiredRoles) next.push({ text: `Confirm and staff the required role: ${clean(role)}.` });
  if (outcome?.latest) next.push({ text: `Outcome recorded: ${clean(outcome.latest.label)}${outcome.attribution ? ` · attribution ${outcome.attribution.effectiveClass}` : ""}.` });
  for (const p of d.pendingDecisions.slice(0, 3)) next.push({ text: p.title });

  const sections: BriefSection[] = [
    { key: "happening", title: "What is happening", lines: happening },
    { key: "why", title: "Why now", lines: whyNow, emptyNote: "No structured Why Now yet — do not manufacture urgency." },
    { key: "who", title: "Who matters", lines: who, emptyNote: "No team proposed yet." },
    { key: "route", title: "Route", lines: route, emptyNote: "No route recommended yet." },
    { key: "value", title: "Business value", lines: value, emptyNote: "No economic facts yet — do not manufacture a value story." },
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
