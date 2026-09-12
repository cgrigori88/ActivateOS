import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeMissingContext,
  KIND_WEIGHT,
  type MissingContextInput,
} from "../src/lib/pursuits/read-models/missing-context";
import type { ContextHealthView } from "../src/lib/pursuits/read-models/context-health";
import type { StakeholderCoverage } from "../src/lib/stakeholders/coverage";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import type { WhyNowView } from "../src/lib/pursuits/read-models/types";

/**
 * Missing Context (vNext Slice 1, chunk 3).
 *
 * The properties worth pinning: four existing gap computations collapse into one
 * ranked answer without any of them being re-derived here; MISSING, STALE,
 * CONFLICTING, UNVERIFIED and NOT_ESTABLISHED stay distinguishable rather than
 * flattening into "missing"; an unevaluated source is reported as unevaluated
 * rather than as "no gaps"; and information the caller is not entitled to see is
 * never reported to them as a hole in their own knowledge.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const FULL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-2", canSeeInternal: false, canSeeTransactionDetail: false };

function base(over: Partial<MissingContextInput> = {}): MissingContextInput {
  return { pursuitId: "p-1", caller: FULL, now: NOW, ...over };
}

function coverage(over: Partial<StakeholderCoverage> = {}): StakeholderCoverage {
  return {
    established: true, notEstablishedReason: null,
    pursuitId: "p-1", companyId: "c-1", expectedValue: 1840000,
    opportunityIds: ["o-1"], history: [],
    roles: [
      { role: "economic_buyer", state: "MISSING", person: null, source: null, assertedAt: null, candidates: [], whyItMatters: "Nobody can sign without them", verifyingEvidence: "A meeting with the budget holder" },
      { role: "champion", state: "VERIFIED", person: { contactId: "ct-1", name: "R. Lee", title: "Dir. Infra", sentiment: "positive" }, source: "crm", assertedAt: "2026-09-01T00:00:00Z", candidates: [], whyItMatters: "", verifyingEvidence: "" },
      { role: "technical_buyer", state: "INFERRED", person: null, source: null, assertedAt: null, candidates: [], whyItMatters: "Owns the technical verdict", verifyingEvidence: "Confirm on a technical call" },
    ],
    others: [], activeBlocker: null, warmPaths: [], missingRoles: ["economic_buyer"],
    ...over,
  } as StakeholderCoverage;
}

function whyNow(over: Partial<WhyNowView> = {}): WhyNowView {
  return {
    present: true,
    businessTrigger: null, technologyCondition: null, timingAnchor: null,
    signalConvergence: null, routeRelevance: null,
    contradictions: [], unknowns: [], renderedSummary: null, asOf: null, lifecycle: [],
    ...over,
  };
}

function health(over: Partial<ContextHealthView> = {}): ContextHealthView {
  return {
    pursuitId: "p-1", overall: 70, band: "high", conclusion: "VERIFIED",
    dimensions: [], concerns: [], trust: [], factsConsidered: 3, factsExcluded: 0,
    coverage: { byCategory: {} as never, overall: 100, gaps: [] },
    computedAt: NOW.toISOString(),
    ...over,
  };
}

// --- the headline behaviour -------------------------------------------------

test("missing context: multiple existing gap sources collapse into one ranked result", () => {
  const v = composeMissingContext(base({
    stakeholderCoverage: coverage(),
    meddpicc: {
      metrics: { status: "unknown", notes: null, source: "human" },
      economic_buyer: { status: "gap", notes: null, source: "human" },
      decision_criteria: { status: "strong", notes: null, source: "human" },
      decision_process: { status: "strong", notes: null, source: "human" },
      paper_process: { status: "strong", notes: null, source: "human" },
      identified_pain: { status: "strong", notes: null, source: "human" },
      champion: { status: "strong", notes: null, source: "human" },
      competition: { status: "weak", notes: null, source: "human" },
    },
    whyNow: whyNow({ unknowns: ["No verified timing anchor"] }),
    valueCase: { state: "INCOMPLETE", missingDrivers: ["downtime_cost"] },
    contextHealth: health(),
  }));

  const sources = new Set(v.gaps.map((g) => g.source));
  assert.ok(sources.has("STAKEHOLDER_COVERAGE"));
  assert.ok(sources.has("MEDDPICC"));
  assert.ok(sources.has("WHY_NOW"));
  assert.ok(sources.has("VALUE_CASE"));
  assert.ok(v.gaps.length >= 5);
  // Ranked descending, deterministically.
  for (let i = 1; i < v.gaps.length; i++) assert.ok(v.gaps[i - 1].rank >= v.gaps[i].rank);
  assert.equal(v.top, v.gaps[0]);
});

test("missing context: a blocking role outranks an ordinary qualification unknown", () => {
  const v = composeMissingContext(base({
    stakeholderCoverage: coverage(),
    meddpicc: {
      metrics: { status: "unknown", notes: null, source: "human" },
      economic_buyer: { status: "strong", notes: null, source: "human" },
      decision_criteria: { status: "strong", notes: null, source: "human" },
      decision_process: { status: "strong", notes: null, source: "human" },
      paper_process: { status: "strong", notes: null, source: "human" },
      identified_pain: { status: "strong", notes: null, source: "human" },
      champion: { status: "strong", notes: null, source: "human" },
      competition: { status: "strong", notes: null, source: "human" },
    },
  }));
  assert.equal(v.top!.key, "stakeholder:economic_buyer");
  assert.ok(v.top!.rankReasons.some((r) => /blocks the decision/.test(r)), "the arithmetic must be visible");
  const metrics = v.gaps.find((g) => g.key === "meddpicc:metrics")!;
  assert.ok(v.top!.rank > metrics.rank);
});

test("missing context: ranking is deterministic and reproducible", () => {
  const i = base({ stakeholderCoverage: coverage(), whyNow: whyNow({ unknowns: ["a", "b"] }) });
  assert.deepEqual(composeMissingContext(i), composeMissingContext(i));
});

// --- the five kinds stay distinguishable ------------------------------------

test("missing context: conflicting outranks missing, which outranks stale", () => {
  assert.ok(KIND_WEIGHT.CONFLICTING > KIND_WEIGHT.MISSING);
  assert.ok(KIND_WEIGHT.MISSING > KIND_WEIGHT.STALE);
  assert.ok(KIND_WEIGHT.STALE > KIND_WEIGHT.UNVERIFIED);
  assert.ok(KIND_WEIGHT.UNVERIFIED > KIND_WEIGHT.NOT_ESTABLISHED);
});

test("missing context: stale is not reported as missing", () => {
  const v = composeMissingContext(base({
    contextHealth: health({
      concerns: [{ kind: "STALE_FACT", dimension: "freshness", text: "Renewal date has aged out", refType: "fact", refId: "f-1", weight: 1 }],
    }),
  }));
  const g = v.gaps.find((x) => x.source === "CONTEXT_HEALTH")!;
  assert.equal(g.kind, "STALE");
  assert.equal(v.byKind.STALE, 1);
  assert.equal(v.byKind.MISSING, 0);
});

test("missing context: a disputed fact is reported as conflicting", () => {
  const v = composeMissingContext(base({
    contextHealth: health({
      concerns: [{ kind: "DISPUTED_FACT", dimension: "consistency", text: "Two sources disagree on the renewal date", refType: "fact", refId: "f-2", weight: 1 }],
    }),
  }));
  assert.equal(v.gaps[0].kind, "CONFLICTING");
});

test("missing context: an inferred role is UNVERIFIED, not MISSING", () => {
  const v = composeMissingContext(base({ stakeholderCoverage: coverage() }));
  const tech = v.gaps.find((g) => g.key === "stakeholder:technical_buyer")!;
  assert.equal(tech.kind, "UNVERIFIED");
  const eb = v.gaps.find((g) => g.key === "stakeholder:economic_buyer")!;
  assert.equal(eb.kind, "MISSING");
  // A verified role is not a gap at all.
  assert.equal(v.gaps.find((g) => g.key === "stakeholder:champion"), undefined);
});

test("missing context: a pre-opportunity pursuit reads NOT_ESTABLISHED, not missing", () => {
  const v = composeMissingContext(base({
    stakeholderCoverage: coverage({ established: false, notEstablishedReason: "No linked opportunity yet", roles: [] }),
  }));
  const g = v.gaps.find((x) => x.source === "STAKEHOLDER_COVERAGE")!;
  assert.equal(g.kind, "NOT_ESTABLISHED");
  assert.equal(g.text, "No linked opportunity yet");
  assert.equal(v.byKind.MISSING, 0, "not-yet-answerable must not be reported as a failure to do the work");
});

// --- the no-gap state -------------------------------------------------------

test("missing context: nothing unresolved returns an empty, honest result", () => {
  const v = composeMissingContext(base({
    stakeholderCoverage: coverage({
      roles: [{ role: "economic_buyer", state: "VERIFIED", person: null, source: "crm", assertedAt: null, candidates: [], whyItMatters: "", verifyingEvidence: "" }],
      missingRoles: [],
    }),
    whyNow: whyNow(),
    valueCase: { state: "STRONG", missingDrivers: [] },
    contextHealth: health(),
    meddpicc: {
      metrics: { status: "strong", notes: null, source: "human" },
      economic_buyer: { status: "strong", notes: null, source: "human" },
      decision_criteria: { status: "strong", notes: null, source: "human" },
      decision_process: { status: "strong", notes: null, source: "human" },
      paper_process: { status: "strong", notes: null, source: "human" },
      identified_pain: { status: "strong", notes: null, source: "human" },
      champion: { status: "strong", notes: null, source: "human" },
      competition: { status: "strong", notes: null, source: "human" },
    },
  }));
  assert.deepEqual(v.gaps, []);
  assert.equal(v.top, null);
  assert.deepEqual(v.notEvaluated, []);
  assert.equal(v.withheldCount, 0);
});

test("missing context: an unevaluated source is reported, never read as 'no gaps'", () => {
  const v = composeMissingContext(base());   // nothing supplied at all
  assert.deepEqual(v.gaps, []);
  const sources = v.notEvaluated.map((n) => n.source).sort();
  assert.deepEqual(sources, ["CONTEXT_HEALTH", "MEDDPICC", "STAKEHOLDER_COVERAGE", "VALUE_CASE", "WHY_NOW"]);
});

test("missing context: null means evaluated-and-absent, distinct from not evaluated", () => {
  const v = composeMissingContext(base({ meddpicc: null }));
  const m = v.notEvaluated.find((n) => n.source === "MEDDPICC")!;
  assert.equal(m.reason, "No linked opportunity to qualify");
  assert.notEqual(m.reason, "Qualification was not evaluated");
});

// --- entitlement ------------------------------------------------------------

test("missing context: data the caller may not see is withheld, not reported as their gap", () => {
  const v = composeMissingContext(base({
    caller: GUEST,
    stakeholderCoverage: coverage(),
    valueCase: { state: "INCOMPLETE", missingDrivers: ["downtime_cost", "licence_saving"] },
  }));
  assert.equal(v.gaps.filter((g) => g.source === "STAKEHOLDER_COVERAGE").length, 0,
    "a partner's not seeing the sponsor's stakeholder map is a boundary, not a hole in their knowledge");
  assert.equal(v.gaps.filter((g) => g.source === "VALUE_CASE").length, 0);
  // The count is disclosed; the content is not.
  assert.equal(v.withheldCount, 4);   // 2 non-verified roles + 2 economic drivers
  const serialized = JSON.stringify(v);
  assert.ok(!serialized.includes("downtime_cost"), "withheld content must be absent from the payload");
  assert.ok(!serialized.includes("economic_buyer"), "withheld content must be absent from the payload");
});

test("missing context: a full-tenant caller sees the same data as real gaps", () => {
  const v = composeMissingContext(base({
    stakeholderCoverage: coverage(),
    valueCase: { state: "INCOMPLETE", missingDrivers: ["downtime_cost"] },
  }));
  assert.equal(v.withheldCount, 0);
  assert.ok(v.gaps.some((g) => g.refId === "economic_buyer"));
  assert.ok(v.gaps.some((g) => g.refId === "downtime_cost"));
});

// --- health concerns are capped so they cannot drown the deal gaps ----------

test("missing context: health concerns are capped worst-first, full list stays on the source", () => {
  const concerns: ContextHealthView["concerns"] = Array.from({ length: 8 }, (_, i) => ({
    kind: "MISSING_COVERAGE", dimension: "coverage",
    text: `No category-${i} context researched yet`, refType: "coverage_category", refId: `cat-${i}`, weight: 0.6,
  }));
  const v = composeMissingContext(base({ contextHealth: health({ concerns }), maxHealthConcerns: 3 }));
  assert.equal(v.gaps.filter((g) => g.source === "CONTEXT_HEALTH").length, 3);
  assert.equal(v.gaps.find((g) => g.source === "CONTEXT_HEALTH")!.refId, "cat-0", "worst-first order is inherited");
});

test("missing context: every gap keeps its source, reason and ref", () => {
  const v = composeMissingContext(base({ stakeholderCoverage: coverage() }));
  for (const g of v.gaps) {
    assert.ok(g.source, "a gap without a source cannot be traced");
    assert.ok(g.text.length > 0);
    assert.ok(g.refType.length > 0);
    assert.ok(g.rankReasons.length >= 2, "the ranking arithmetic must be inspectable");
  }
  const eb = v.gaps.find((g) => g.refId === "economic_buyer")!;
  assert.equal(eb.whyItMatters, "Nobody can sign without them");
  assert.equal(eb.howToResolve, "A meeting with the budget holder");
});
