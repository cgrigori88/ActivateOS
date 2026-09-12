import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canDisclose,
  rankPertinence,
  SIGNAL_WEIGHT,
  type PertinenceCandidate,
  type PertinenceInput,
} from "../src/lib/pursuits/read-models/pertinence";
import { bandOf, type Caller } from "../src/lib/pursuits/read-models/helpers";
import type { DisclosureClass } from "../src/lib/pursuits/read-models/types";

/**
 * Pursuit Pertinence (vNext Slice 1, chunk 4).
 *
 * The properties worth pinning: strongly pursuit-linked items outrank loosely
 * related ones; stale and settled items sink; the task the caller is performing
 * actually changes the answer; every position is explainable from exposed
 * arithmetic; and — the one that matters most — a restricted item contributes
 * nothing at all, not even by displacing a visible neighbour.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const FULL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-2", canSeeInternal: false, canSeeTransactionDetail: false };

function fact(over: Partial<PertinenceCandidate> = {}): PertinenceCandidate {
  return {
    id: over.id ?? "f-1", kind: "FACT", label: "Runs legacy hypervisor",
    disclosure: "INTERNAL", at: daysAgo(5), relevance: "PRIMARY_TRIGGER",
    confidence: 0.9, refType: "fact", refId: over.id ?? "f-1",
    ...over,
  };
}

function input(over: Partial<PertinenceInput> = {}): PertinenceInput {
  return { pursuitId: "p-1", caller: FULL, candidates: [], now: NOW, ...over };
}

// --- linkage ----------------------------------------------------------------

test("pertinence: strongly pursuit-linked information outranks unrelated context", () => {
  const v = rankPertinence(input({
    candidates: [
      fact({ id: "background", relevance: "BACKGROUND", label: "Head office is in Ohio" }),
      fact({ id: "trigger", relevance: "PRIMARY_TRIGGER", label: "Hypervisor licence renews in Q1" }),
    ],
  }));
  assert.deepEqual(v.items.map((i) => i.id), ["trigger", "background"]);
  assert.ok(v.items[0].score > v.items[1].score);
});

test("pertinence: a critical change outranks a low-materiality one", () => {
  const v = rankPertinence(input({
    candidates: [
      { id: "low", kind: "EVENT", label: "Fact linked", disclosure: "INTERNAL", at: daysAgo(1), materiality: "LOW", refType: "change", refId: "e-1" },
      { id: "crit", kind: "EVENT", label: "Route recommendation changed", disclosure: "INTERNAL", at: daysAgo(1), materiality: "CRITICAL", refType: "change", refId: "e-2" },
    ],
  }));
  assert.deepEqual(v.items.map((i) => i.id), ["crit", "low"]);
});

// --- recency ----------------------------------------------------------------

test("pertinence: stale items are de-emphasised but not erased", () => {
  const v = rankPertinence(input({
    candidates: [fact({ id: "old", at: daysAgo(720) }), fact({ id: "new", at: daysAgo(1) })],
  }));
  assert.deepEqual(v.items.map((i) => i.id), ["new", "old"]);
  const old = v.items.find((i) => i.id === "old")!;
  assert.ok(old.score > 0, "an old primary trigger is still worth surfacing");
  assert.ok(old.signals.find((s) => s.key === "recency")!.value < 0.05);
  assert.match(old.signals.find((s) => s.key === "recency")!.reason, /720 days old/);
});

test("pertinence: an item with no date is neutral on recency, not penalised as ancient", () => {
  const v = rankPertinence(input({ candidates: [fact({ at: null })] }));
  const recency = v.items[0].signals.find((s) => s.key === "recency")!;
  assert.equal(recency.value, 0.5);
  assert.equal(recency.reason, "No date recorded");
});

// --- unresolved -------------------------------------------------------------

test("pertinence: an open question outranks a settled fact, all else equal", () => {
  const v = rankPertinence(input({
    candidates: [
      fact({ id: "settled", relevance: "SUPPORTING_CONTEXT", confidence: 0.5 }),
      { id: "gap", kind: "GAP", label: "No economic buyer identified", disclosure: "INTERNAL", at: daysAgo(5), gapKind: "MISSING", refType: "stakeholder_role", refId: "economic_buyer" },
    ],
  }));
  assert.equal(v.items[0].id, "gap");
  assert.equal(v.items[0].signals.find((s) => s.key === "unresolved")!.value, 1);
  assert.equal(v.items[1].signals.find((s) => s.key === "unresolved")!.value, 0);
});

// --- task context -----------------------------------------------------------

test("pertinence: the decision in progress changes the answer", () => {
  const candidates = [
    fact({ id: "timing", relevance: "TIMING_ANCHOR", label: "Renewal date", confidence: 0.6 }),
    fact({ id: "route", relevance: "PARTNER_ROUTE", label: "CDW holds the account", confidence: 0.6 }),
  ];
  const timing = rankPertinence(input({ candidates, decisionContext: "VALIDATE_TIMING" }));
  const route = rankPertinence(input({ candidates, decisionContext: "SELECT_ROUTE" }));
  assert.equal(timing.items[0].id, "timing");
  assert.equal(route.items[0].id, "route");
  assert.match(timing.items[0].signals.find((s) => s.key === "taskFit")!.reason, /validate timing/);
});

test("pertinence: GENERAL applies no task bias", () => {
  const v = rankPertinence(input({ candidates: [fact({ relevance: "PARTNER_ROUTE" })], decisionContext: "GENERAL" }));
  const taskFit = v.items[0].signals.find((s) => s.key === "taskFit")!;
  assert.equal(taskFit.value, 0.5);
  assert.equal(taskFit.reason, "No specific decision in progress");
});

test("pertinence: an off-task item is neutral, not zeroed", () => {
  const v = rankPertinence(input({
    candidates: [fact({ relevance: "BACKGROUND" })], decisionContext: "VALIDATE_TIMING",
  }));
  assert.equal(v.items[0].signals.find((s) => s.key === "taskFit")!.value, 0.5,
    "a pursuit's context still matters whatever you happen to be doing");
});

// --- disclosure: the property that must not break ---------------------------

test("pertinence: canDisclose honours the canonical disclosure vocabulary", () => {
  const cases: [DisclosureClass, boolean, boolean][] = [
    // class, visible to full tenant, visible to guest
    ["PUBLIC", true, true],
    ["PARTNER_SHARED", true, true],
    ["INTERNAL", true, false],
    ["TRANSACTION_CONFIDENTIAL", true, false],
    ["PII", true, false],
    ["RESTRICTED", true, false],
  ];
  for (const [cls, full, guest] of cases) {
    assert.equal(canDisclose(FULL, cls), full, `${cls} for a full tenant`);
    assert.equal(canDisclose(GUEST, cls), guest, `${cls} for a guest`);
  }
});

test("pertinence: an unknown disclosure class fails closed", () => {
  assert.equal(canDisclose(FULL, "SOMETHING_NEW" as DisclosureClass), false);
});

test("pertinence: unauthorized context never appears in the result", () => {
  const v = rankPertinence(input({
    caller: GUEST,
    candidates: [
      fact({ id: "shared", disclosure: "PARTNER_SHARED", label: "Category modernisation underway" }),
      fact({ id: "secret", disclosure: "TRANSACTION_CONFIDENTIAL", label: "$1.84M recent category activity" }),
      fact({ id: "pii", disclosure: "PII", label: "CTO mobile number" }),
    ],
  }));
  assert.deepEqual(v.items.map((i) => i.id), ["shared"]);
  assert.equal(v.withheldCount, 2);
  assert.equal(v.considered, 1);
  const serialized = JSON.stringify(v);
  assert.ok(!serialized.includes("1.84M"), "withheld content must be absent from the payload");
  assert.ok(!serialized.includes("mobile"), "withheld content must be absent from the payload");
});

test("pertinence: a restricted item cannot influence the ranking of visible ones", () => {
  const visible = [
    fact({ id: "a", disclosure: "PARTNER_SHARED", relevance: "SUPPORTING_CONTEXT" }),
    fact({ id: "b", disclosure: "PARTNER_SHARED", relevance: "BACKGROUND" }),
  ];
  const withoutSecret = rankPertinence(input({ caller: GUEST, candidates: visible }));
  const withSecret = rankPertinence(input({
    caller: GUEST,
    // A restricted item that would otherwise rank top, inserted between them.
    candidates: [visible[0], fact({ id: "secret", disclosure: "RESTRICTED", relevance: "PRIMARY_TRIGGER" }), visible[1]],
  }));
  assert.deepEqual(
    withSecret.items.map((i) => ({ id: i.id, score: i.score })),
    withoutSecret.items.map((i) => ({ id: i.id, score: i.score })),
    "its existence must not be inferable from the ordering or the scores",
  );
  assert.equal(withSecret.withheldCount, 1);
});

// --- explainability ---------------------------------------------------------

test("pertinence: every item exposes the full arithmetic behind its position", () => {
  const v = rankPertinence(input({ candidates: [fact()], decisionContext: "QUALIFY" }));
  const item = v.items[0];
  assert.equal(item.signals.length, Object.keys(SIGNAL_WEIGHT).length);
  for (const s of item.signals) {
    assert.ok(s.value >= 0 && s.value <= 1, `${s.key} must be 0..1`);
    assert.equal(s.weight, SIGNAL_WEIGHT[s.key]);
    assert.ok(Math.abs(s.contribution - s.value * s.weight) < 1e-9, "contribution must be value × weight");
    assert.ok(s.reason.length > 0, `${s.key} must state why`);
  }
  // The score is exactly the sum of the contributions — nothing is added on top.
  const sum = Math.round(item.signals.reduce((a, s) => a + s.contribution, 0) * 100);
  assert.equal(item.score, sum);
  // A settled primary trigger, on-task and recent, scores in the high band: it
  // cannot reach very_high because `unresolved` contributes nothing to it.
  assert.equal(item.score, 78);
  assert.equal(item.band, bandOf(item.score));
  assert.equal(item.band, "high");
  assert.equal(item.topReasons.length, 2);
  assert.equal(item.topReasons[0], "Linked to this pursuit as primary trigger");
});

test("pertinence: weights sum to 1, so the score is a true 0..100", () => {
  const total = Object.values(SIGNAL_WEIGHT).reduce((a, w) => a + w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

// --- determinism and windowing ----------------------------------------------

test("pertinence: ties break deterministically and results are reproducible", () => {
  const candidates = [fact({ id: "z" }), fact({ id: "a" }), fact({ id: "m" })];
  const first = rankPertinence(input({ candidates, limit: 2 }));
  const again = rankPertinence(input({ candidates: [...candidates].reverse(), limit: 2 }));
  assert.deepEqual(first.items.map((i) => i.id), ["a", "m"]);
  assert.deepEqual(again.items.map((i) => i.id), first.items.map((i) => i.id));
});

test("pertinence: limit windows the list while `considered` reports the true total", () => {
  const v = rankPertinence(input({ candidates: [fact({ id: "a" }), fact({ id: "b" }), fact({ id: "c" })], limit: 1 }));
  assert.equal(v.items.length, 1);
  assert.equal(v.considered, 3);
});

test("pertinence: no candidates returns an empty result, not an error", () => {
  const v = rankPertinence(input());
  assert.deepEqual(v.items, []);
  assert.equal(v.considered, 0);
  assert.equal(v.withheldCount, 0);
  assert.equal(v.decisionContext, "GENERAL");
});

test("pertinence: facts, events and gaps compete on one ranking", () => {
  const v = rankPertinence(input({
    candidates: [
      fact({ id: "f", relevance: "SUPPORTING_CONTEXT" }),
      { id: "e", kind: "EVENT", label: "Stage advanced", disclosure: "INTERNAL", at: daysAgo(2), materiality: "HIGH", refType: "change", refId: "c-1" },
      { id: "g", kind: "GAP", label: "Timing anchor unverified", disclosure: "INTERNAL", at: daysAgo(2), gapKind: "CONFLICTING", refType: "pursuit", refId: "p-1" },
    ],
  }));
  assert.equal(v.items.length, 3);
  assert.equal(new Set(v.items.map((i) => i.kind)).size, 3, "what to look at next does not respect entity boundaries");
  assert.equal(v.items[0].id, "g", "an unresolved disagreement leads");
});
