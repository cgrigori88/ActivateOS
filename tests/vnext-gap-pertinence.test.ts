import assert from "node:assert/strict";
import { test } from "node:test";
import { rankPertinence, type PertinenceCandidate } from "../src/lib/pursuits/read-models/pertinence";
import { composeMissingContext } from "../src/lib/pursuits/read-models/missing-context";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import type { StakeholderCoverage } from "../src/lib/stakeholders/coverage";
import type { WhyNowView } from "../src/lib/pursuits/read-models/types";

/**
 * Gap semantics in pertinence (vNext Slice 1, chunk 5B-1).
 *
 * The defect these pin: converting a ranked `ContextGap` into a
 * `PertinenceCandidate` used to discard the gap's upstream rank and source, so
 * every MISSING gap tied on linkage and the carefully ranked order the gap layer
 * produced — economic buyer 80, timing anchor 72 — was thrown away. The timing
 * task could not see a timing gap at all.
 *
 * Pure functions, so no database. The loader's end of the carry is asserted in
 * `scripts/vnext-context-verify.ts`, where the loader actually lives.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const FULL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-2", canSeeInternal: false, canSeeTransactionDetail: false };

/** A gap candidate shaped exactly as the loader now builds one. */
function gap(over: Partial<PertinenceCandidate> & { id: string }): PertinenceCandidate {
  return {
    kind: "GAP",
    label: "unresolved thing",
    disclosure: "INTERNAL",
    at: null,
    gapKind: "MISSING",
    unresolved: true,
    refType: "pursuit",
    refId: "p-1",
    ...over,
  };
}

const rank = (candidates: PertinenceCandidate[], decisionContext: Parameters<typeof rankPertinence>[0]["decisionContext"] = "GENERAL") =>
  rankPertinence({ pursuitId: "p-1", caller: FULL, candidates, decisionContext, now: NOW });

// --- 2. high-priority gaps are no longer flattened ---------------------------

test("gap semantics: a blocking stakeholder gap outranks a generic coverage gap", () => {
  const v = rank([
    gap({ id: "coverage", label: "No hiring context researched yet", gapRank: 44, gapSource: "CONTEXT_HEALTH", refType: "coverage_category", refId: "hiring" }),
    gap({ id: "buyer", label: "No economic buyer identified", gapRank: 80, gapSource: "STAKEHOLDER_COVERAGE", refType: "stakeholder_role", refId: "economic_buyer" }),
    gap({ id: "timing", label: "No verified timing anchor", gapRank: 72, gapSource: "WHY_NOW" }),
  ]);
  assert.deepEqual(v.items.map((i) => i.id), ["buyer", "timing", "coverage"],
    "the upstream ranking must survive into pertinence");
  // The exact arithmetic, so a future change to the weights is visible.
  assert.deepEqual(v.items.map((i) => i.score), [69, 67, 58]);
});

test("gap semantics: without the upstream rank they WOULD tie — this is the defect", () => {
  // Same three gaps, same kind, rank stripped: the pre-fix behaviour.
  const v = rank([
    gap({ id: "coverage", gapSource: "CONTEXT_HEALTH" }),
    gap({ id: "buyer", gapSource: "STAKEHOLDER_COVERAGE" }),
    gap({ id: "timing", gapSource: "WHY_NOW" }),
  ]);
  assert.equal(new Set(v.items.map((i) => i.score)).size, 1,
    "kind-only linkage collapses three differently-important gaps into one score");
  assert.equal(v.items[0].score, 69);
});

test("gap semantics: the fallback still applies when no rank travelled", () => {
  const withRank = rank([gap({ id: "a", gapKind: "CONFLICTING", gapRank: 90 })]).items[0];
  const without = rank([gap({ id: "a", gapKind: "CONFLICTING" })]).items[0];
  assert.equal(withRank.score, 72);
  assert.equal(without.score, 75, "LINKAGE_BY_GAP.CONFLICTING = 1.0 is the fallback");
  assert.match(without.signals.find((s) => s.key === "linkage")!.reason, /Unresolved conflicting on this pursuit/);
});

// --- 3 & 4. VALIDATE_TIMING ---------------------------------------------------

test("gap semantics: VALIDATE_TIMING elevates a WHY_NOW timing gap", () => {
  const candidates = [
    gap({ id: "buyer", label: "No economic buyer identified", gapRank: 80, gapSource: "STAKEHOLDER_COVERAGE", refType: "stakeholder_role", refId: "economic_buyer" }),
    gap({ id: "timing", label: "No verified timing anchor", gapRank: 72, gapSource: "WHY_NOW" }),
  ];
  const general = rank(candidates, "GENERAL");
  const timing = rank(candidates, "VALIDATE_TIMING");

  assert.equal(general.items[0].id, "buyer", "without a timing task the bigger gap leads");
  assert.equal(timing.items[0].id, "timing", "with a timing task the timing gap leads");
  assert.equal(timing.items.find((i) => i.id === "timing")!.score, 79);
  assert.match(
    timing.items[0].signals.find((s) => s.key === "taskFit")!.reason,
    /why now context blocks validate timing/,
    "the reason must name why it moved",
  );
});

test("gap semantics: a non-timing task gives the timing gap no such boost", () => {
  const candidates = [gap({ id: "timing", gapRank: 72, gapSource: "WHY_NOW" })];
  for (const ctx of ["SELECT_ROUTE", "ENGAGE_STAKEHOLDER", "BUILD_VALUE_CASE"] as const) {
    const v = rank(candidates, ctx);
    assert.equal(v.items[0].signals.find((s) => s.key === "taskFit")!.value, 0.5, `${ctx} must stay neutral`);
    assert.equal(v.items[0].score, 67);
  }
});

// --- 5. ASSESS_RISK -----------------------------------------------------------

test("gap semantics: ASSESS_RISK recognises context-health and conflict gaps", () => {
  const stale = gap({ id: "stale", label: "Renewal date has aged out", gapKind: "STALE", gapRank: 39, gapSource: "CONTEXT_HEALTH", refType: "fact", refId: "f-1" });
  const conflict = gap({ id: "conflict", label: "Two sources disagree", gapKind: "CONFLICTING", gapRank: 54, gapSource: "CONTEXT_HEALTH", refType: "fact", refId: "f-2" });
  const qualification = gap({ id: "qual", label: "Paper process is unknown", gapRank: 56, gapSource: "MEDDPICC", refType: "meddpicc_element", refId: "paper_process" });

  const risk = rank([stale, conflict, qualification], "ASSESS_RISK");
  assert.equal(risk.items.find((i) => i.id === "stale")!.signals.find((s) => s.key === "taskFit")!.value, 1,
    "staleness is risk to what we believe");
  assert.equal(risk.items.find((i) => i.id === "conflict")!.signals.find((s) => s.key === "taskFit")!.value, 1);
  assert.equal(risk.items.find((i) => i.id === "qual")!.signals.find((s) => s.key === "taskFit")!.value, 0.5,
    "a qualification gap is not a risk signal");
  // Despite ranking lower upstream, the stale gap overtakes the qualification gap
  // for this task — which is the whole point of task-relative ranking.
  assert.ok(risk.items.findIndex((i) => i.id === "conflict") < risk.items.findIndex((i) => i.id === "qual"));
});

test("gap semantics: QUALIFY still prefers qualification gaps", () => {
  const v = rank([
    gap({ id: "qual", gapRank: 56, gapSource: "MEDDPICC", refType: "meddpicc_element", refId: "paper_process" }),
    gap({ id: "timing", gapRank: 72, gapSource: "WHY_NOW" }),
  ], "QUALIFY");
  assert.equal(v.items[0].id, "qual", "the lower-ranked gap wins on its own task");
});

// --- 6. authorization invariance ---------------------------------------------

test("gap semantics: an inaccessible HIGH-PRIORITY gap changes nothing visible", () => {
  const visible = [
    gap({ id: "a", label: "Shared gap", disclosure: "PARTNER_SHARED", gapRank: 44, gapSource: "CONTEXT_HEALTH" }),
    gap({ id: "b", label: "Another shared gap", disclosure: "PARTNER_SHARED", gapRank: 30, gapSource: "CONTEXT_HEALTH" }),
  ];
  const base = rankPertinence({ pursuitId: "p-1", caller: GUEST, candidates: visible, now: NOW });
  const withSecret = rankPertinence({
    pursuitId: "p-1", caller: GUEST, now: NOW,
    // The highest-priority gap in the set, and entirely invisible to this caller.
    candidates: [visible[0], gap({ id: "secret", label: "$1.84M exposure unquantified", disclosure: "TRANSACTION_CONFIDENTIAL", gapRank: 100, gapSource: "VALUE_CASE" }), visible[1]],
  });
  assert.deepEqual(
    withSecret.items.map((i) => [i.id, i.score]),
    base.items.map((i) => [i.id, i.score]),
    "a top-ranked inaccessible gap must not move a single visible score or position",
  );
  assert.equal(withSecret.considered, base.considered);
  assert.equal(withSecret.withheldCount, 1);
  assert.ok(!JSON.stringify(withSecret).includes("1.84M"));
});

test("gap semantics: the same holds under a task that would have boosted it", () => {
  const visible = [gap({ id: "a", disclosure: "PARTNER_SHARED", gapRank: 44, gapSource: "CONTEXT_HEALTH" })];
  const base = rankPertinence({ pursuitId: "p-1", caller: GUEST, candidates: visible, decisionContext: "VALIDATE_TIMING", now: NOW });
  const withSecret = rankPertinence({
    pursuitId: "p-1", caller: GUEST, decisionContext: "VALIDATE_TIMING", now: NOW,
    candidates: [...visible, gap({ id: "secret", disclosure: "RESTRICTED", gapRank: 95, gapSource: "WHY_NOW" })],
  });
  assert.deepEqual(withSecret.items.map((i) => [i.id, i.score]), base.items.map((i) => [i.id, i.score]));
});

// --- 7. explainability --------------------------------------------------------

test("gap semantics: the linkage reason names the upstream rank and source", () => {
  const v = rank([gap({ id: "buyer", gapRank: 80, gapSource: "STAKEHOLDER_COVERAGE" })]);
  const linkage = v.items[0].signals.find((s) => s.key === "linkage")!;
  assert.equal(linkage.value, 0.8);
  assert.match(linkage.reason, /upstream rank 80\/100/);
  assert.match(linkage.reason, /stakeholder coverage/);
  // Still exactly the sum of contributions — nothing hidden was added.
  assert.equal(v.items[0].score, Math.round(v.items[0].signals.reduce((a, s) => a + s.contribution, 0) * 100));
});

test("gap semantics: upstream importance is not counted twice", () => {
  // Gap kind enters the upstream rank via KIND_WEIGHT. If linkage ALSO applied
  // LINKAGE_BY_GAP on top, two gaps with identical rank but different kind would
  // score differently. They must not.
  const conflicting = rank([gap({ id: "x", gapKind: "CONFLICTING", gapRank: 60, gapSource: "WHY_NOW" })]).items[0];
  const missing = rank([gap({ id: "x", gapKind: "MISSING", gapRank: 60, gapSource: "WHY_NOW" })]).items[0];
  assert.equal(conflicting.score, missing.score,
    "identical upstream rank must produce identical linkage regardless of kind");
});

// --- 8. no regression for facts and events -----------------------------------

test("gap semantics: fact and event linkage is untouched", () => {
  const v = rank([
    { id: "f", kind: "FACT", label: "Runs legacy hypervisor", disclosure: "INTERNAL", at: NOW, relevance: "PRIMARY_TRIGGER", confidence: 0.9, refType: "fact", refId: "f-1" },
    { id: "e", kind: "EVENT", label: "Route recommendation changed", disclosure: "INTERNAL", at: NOW, materiality: "CRITICAL", refType: "change", refId: "e-1" },
  ]);
  const f = v.items.find((i) => i.id === "f")!;
  const e = v.items.find((i) => i.id === "e")!;
  assert.equal(f.signals.find((s) => s.key === "linkage")!.value, 1.0);
  assert.match(f.signals.find((s) => s.key === "linkage")!.reason, /Linked to this pursuit as primary trigger/);
  assert.equal(e.signals.find((s) => s.key === "linkage")!.value, 1.0);
  assert.match(e.signals.find((s) => s.key === "linkage")!.reason, /critical materiality change/);
});

// --- 9. the four-state vocabulary survives the round trip ---------------------

test("gap semantics: composeMissingContext → candidate preserves kind, rank and source", () => {
  const coverage = {
    established: true, notEstablishedReason: null, pursuitId: "p-1", companyId: "c-1",
    expectedValue: null, opportunityIds: ["o-1"], history: [],
    roles: [
      { role: "economic_buyer", state: "MISSING", person: null, source: null, assertedAt: null, candidates: [], whyItMatters: "Nobody can sign without them", verifyingEvidence: "Meet the budget holder" },
      { role: "technical_buyer", state: "INFERRED", person: null, source: null, assertedAt: null, candidates: [], whyItMatters: "Owns the technical verdict", verifyingEvidence: "" },
    ],
    others: [], activeBlocker: null, warmPaths: [], missingRoles: ["economic_buyer"],
  } as unknown as StakeholderCoverage;

  const whyNow: WhyNowView = {
    present: true, businessTrigger: null, technologyCondition: null, timingAnchor: null,
    signalConvergence: null, routeRelevance: null, contradictions: [],
    unknowns: ["No verified timing anchor"], renderedSummary: null, asOf: null, lifecycle: [],
  };

  const mc = composeMissingContext({ pursuitId: "p-1", caller: FULL, now: NOW, stakeholderCoverage: coverage, whyNow });

  // The four states are distinct upstream …
  const byKey = new Map(mc.gaps.map((g) => [g.key, g]));
  assert.equal(byKey.get("stakeholder:economic_buyer")!.kind, "MISSING");
  assert.equal(byKey.get("stakeholder:technical_buyer")!.kind, "UNVERIFIED");

  // … and survive the projection the loader performs.
  const candidates: PertinenceCandidate[] = mc.gaps.map((g) => gap({
    id: `gap:${g.key}`, label: g.text, gapKind: g.kind, gapRank: g.rank,
    gapSource: g.source, whyItMatters: g.whyItMatters, refType: g.refType, refId: g.refId,
  }));
  assert.equal(candidates.find((c) => c.id === "gap:stakeholder:economic_buyer")!.gapRank, byKey.get("stakeholder:economic_buyer")!.rank);
  assert.equal(candidates.find((c) => c.id === "gap:stakeholder:technical_buyer")!.gapKind, "UNVERIFIED");
  assert.equal(candidates.find((c) => c.id === "gap:stakeholder:economic_buyer")!.whyItMatters, "Nobody can sign without them");

  // And the ranked result honours the upstream order.
  const ranked = rank(candidates);
  assert.equal(ranked.items[0].id, "gap:stakeholder:economic_buyer",
    "the blocking MISSING role outranks the UNVERIFIED one, as upstream decided");
  const unverified = ranked.items.find((i) => i.id === "gap:stakeholder:technical_buyer")!;
  assert.ok(ranked.items[0].score > unverified.score, "UNVERIFIED must not be flattened into MISSING");
});
