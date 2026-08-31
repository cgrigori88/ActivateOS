import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPursuitBrief } from "../src/lib/pursuits/read-models/brief";
import type { PursuitDetailView } from "../src/lib/pursuits/read-models/types";

/**
 * Disclosure-aware Pursuit Brief (F1) — the invariants that make it safe: evidence-bound (no
 * invented content), and the Sponsor⇄Partner split genuinely withholds confidential figures rather
 * than restyling them. buildPursuitBrief is pure, so this runs without a database.
 */

const band = { key: "x", label: "X", value: 70, band: "high" as const, known: true, definition: "", why: [] };
function fixture(over: Partial<PursuitDetailView> = {}): PursuitDetailView {
  const rec = {
    key: "cand-cdw", label: "CDW", topology: "PARTNER_LED", rank: 1, disqualified: false,
    routeScore: band, partnerActivation: band, suitability: band, readiness: band, confidence: band,
    dimensions: {},
    reasonsShareable: [{ text: "Partner has strong footprint in the account", polarity: 1 as const }],
    reasonsInternal: [
      { text: "Partner has strong footprint in the account", polarity: 1 as const },
      { text: "Internal deal desk floor is $2.4M", polarity: 1 as const },
    ],
    disqualifiers: [], synthetic: false,
  };
  return {
    pursuitId: "p1", accountId: "a1", accountLabel: "Globex", thesis: "Globex is re-platforming to cloud data.",
    solution: "Data platform", lifecycle: "ROUTING", expectedValue: 2_400_000, currency: "USD", lastMaterialChange: null,
    decisionBand: [],
    whyNow: { present: true, businessTrigger: { kind: "business_trigger", label: "Business trigger", present: true, detail: "New CIO mandate", commercialImplication: "Budget unlocked" },
      technologyCondition: null, timingAnchor: null, signalConvergence: null, routeRelevance: null,
      contradictions: [{ text: "Vendor incumbency unclear", supporting: 1, contradicting: 1 }],
      unknowns: ["Budget authority not confirmed"], renderedSummary: null, asOf: null },
    route: { path: [], recommended: rec, selected: null, selectionMatchesRecommendation: false, overrideReason: null, overrideCategory: null,
      alternatives: [], changeEvents: [], dimensionKeys: [], decided: false, selectedKey: null, recomputePending: false },
    team: { members: [{ id: "m1", role: "PARTNER_ACCOUNT_MANAGER", side: "PARTNER", personLabel: null, partnerLabel: "CDW", status: "INVITED", fit: null, missing: false, required: true, nextGovernedAction: "accept", waiting: true }],
      activationReadiness: band, missingRequiredRoles: ["VENDOR_ACCOUNT_EXECUTIVE"], gapActions: [], sellerAlternatives: [] },
    timeline: { events: [] }, facts: [{ id: "f1", proposition: "Globex signed a cloud MSA in Q2", state: "ACCEPTED", trust: [], confidence: null }],
    pendingDecisions: [], freshness: [], synthetic: false, demoBanner: null, stakeholders: null,
    ...over,
  };
}

test("brief has all ten canonical sections", () => {
  const b = buildPursuitBrief(fixture());
  const keys = b.sections.map((s) => s.key);
  assert.deepEqual(keys, ["happening", "why", "who", "route", "know", "canknow", "say", "ask", "notclaim", "next"]);
});

test("confidential figures are marked and the partner rendering withholds them", () => {
  const b = buildPursuitBrief(fixture());
  const know = b.sections.find((s) => s.key === "know")!;
  const confidential = know.lines.filter((l) => l.confidential);
  assert.ok(confidential.some((l) => /\$2\.4M/.test(l.text)), "internal $ figure is flagged confidential");
  // The partner rendering (what a partner may receive) must not contain the confidential figure text.
  const partnerKnow = know.lines.filter((l) => !l.confidential).map((l) => l.text).join(" | ");
  assert.ok(!/\$2\.4M/.test(partnerKnow), "confidential figure absent from partner-safe lines");
  // Expected value is confidential in "what is happening".
  const happening = b.sections.find((s) => s.key === "happening")!;
  assert.ok(happening.lines.some((l) => l.confidential && /2\.4M/.test(l.text)));
});

test("what-they-can-know carries only the shareable projection", () => {
  const b = buildPursuitBrief(fixture());
  const canKnow = b.sections.find((s) => s.key === "canknow")!;
  assert.equal(canKnow.lines.length, 1);
  assert.ok(/footprint/.test(canKnow.lines[0].text));
  assert.ok(canKnow.lines.every((l) => !l.confidential));
});

test("what-not-to-claim guards the confidential figure and contested evidence", () => {
  const b = buildPursuitBrief(fixture());
  const notClaim = b.sections.find((s) => s.key === "notclaim")!;
  assert.ok(notClaim.lines.some((l) => l.caution && /2\.4M|expected value/i.test(l.text)));
  assert.ok(notClaim.lines.some((l) => /Contested/.test(l.text)));
  // Every guardrail line about a figure is itself confidential (never rendered to a partner).
  assert.ok(notClaim.lines.filter((l) => /figure|expected value/i.test(l.text)).every((l) => l.confidential));
});

test("what-next surfaces the governed decision and the waiting-on participant", () => {
  const b = buildPursuitBrief(fixture());
  const next = b.sections.find((s) => s.key === "next")!;
  assert.ok(next.lines.some((l) => /governed route decision/i.test(l.text)));
  assert.ok(next.lines.some((l) => /Waiting on CDW/i.test(l.text)));
  assert.ok(next.lines.some((l) => /VENDOR ACCOUNT EXECUTIVE/i.test(l.text)));
});

test("evidence-bound: empty inputs yield honest empty notes, never invented content", () => {
  const empty = fixture({
    whyNow: { present: false, businessTrigger: null, technologyCondition: null, timingAnchor: null, signalConvergence: null, routeRelevance: null, contradictions: [], unknowns: [], renderedSummary: null, asOf: null },
    route: { path: [], recommended: null, selected: null, selectionMatchesRecommendation: true, overrideReason: null, overrideCategory: null, alternatives: [], changeEvents: [], dimensionKeys: [], decided: false, selectedKey: null, recomputePending: false },
    facts: [], expectedValue: null,
  });
  const b = buildPursuitBrief(empty);
  const why = b.sections.find((s) => s.key === "why")!;
  assert.equal(why.lines.length, 0);
  assert.ok(why.emptyNote && /do not manufacture/i.test(why.emptyNote));
  const canKnow = b.sections.find((s) => s.key === "canknow")!;
  assert.equal(canKnow.lines.length, 0);
});
