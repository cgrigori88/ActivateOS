import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeDimensions,
  convergenceIndex,
  corroborationScore,
  detectContradictions,
  evidenceSplit,
  refreshIntervalDays,
  type SignalWithSource,
} from "../src/lib/scoring/dimensions";

const NOW = new Date("2026-08-08T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function sig(overrides: Partial<SignalWithSource>): SignalWithSource {
  return {
    signalType: "TECH_INSTALLED",
    family: "technology",
    nodeSlug: "virtualization",
    direction: 1,
    magnitude: 1,
    confidence: 0.8,
    observedAt: NOW,
    halfLifeDays: 720,
    evidenceId: "e1",
    sourceType: "website",
    ...overrides,
  };
}

test("corroboration: single source, single family scores zero", () => {
  const signals = [sig({}), sig({ evidenceId: "e2" })];
  assert.equal(corroborationScore(signals), 0);
});

test("corroboration: grows with distinct sources and families, capped at 1", () => {
  const twoSources = [sig({}), sig({ sourceType: "sec_filing", evidenceId: "e2" })];
  assert.ok(Math.abs(corroborationScore(twoSources) - 0.2) < 1e-9);

  const twoBoth = [
    sig({}),
    sig({ sourceType: "sec_filing", family: "trigger", signalType: "CONTRACT_EXPIRING", evidenceId: "e2" }),
  ];
  assert.ok(Math.abs(corroborationScore(twoBoth) - 0.35) < 1e-9);

  // 4+ sources and 4+ families max out both terms: 0.6 + 0.45 → clamped to 1.
  const families = ["technology", "trigger", "momentum", "initiative"] as const;
  const maxed = families.flatMap((f, i) => [
    sig({ family: f, sourceType: `src${i}`, evidenceId: `e${i}` }),
    sig({ family: f, sourceType: `src${i + 4}`, evidenceId: `e${i + 4}` }),
  ]);
  assert.equal(corroborationScore(maxed), 1);
});

test("corroboration: negative signals do not corroborate", () => {
  const signals = [
    sig({}),
    sig({ direction: -1, sourceType: "press", family: "negative", signalType: "LAYOFFS", evidenceId: "e2" }),
  ];
  assert.equal(corroborationScore(signals), 0);
});

test("convergence: requires at least two families inside the window", () => {
  assert.equal(convergenceIndex([]), 0);
  assert.equal(convergenceIndex([sig({}), sig({ evidenceId: "e2" })]), 0);
});

test("convergence: clustered families score, scattered history dilutes", () => {
  const clustered = [
    sig({}),
    sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", observedAt: daysAgo(30), evidenceId: "e2" }),
  ];
  assert.equal(convergenceIndex(clustered), 1);

  // A third family far outside the 90-day window dilutes the ratio to 2/3.
  const scattered = [
    ...clustered,
    sig({ family: "momentum", signalType: "HIRING_TECH_SKILL", observedAt: daysAgo(200), evidenceId: "e3" }),
  ];
  assert.ok(Math.abs(convergenceIndex(scattered) - 2 / 3) < 1e-9);
});

test("convergence: window anchors to the freshest signal, not now", () => {
  // Both signals are old, but within 90 days of each other → still converged.
  const oldButClustered = [
    sig({ observedAt: daysAgo(400) }),
    sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", observedAt: daysAgo(460), evidenceId: "e2" }),
  ];
  assert.equal(convergenceIndex(oldButClustered), 1);
});

test("contradictions: opposing directions on the same node are flagged", () => {
  const a = sig({ nodeSlug: "infrastructure-automation" });
  const b = sig({
    nodeSlug: "infrastructure-automation",
    direction: -1,
    family: "negative",
    signalType: "PROJECT_DELAYED",
    evidenceId: "e2",
  });
  const pairs = detectContradictions([a, b]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].basis, "opposing_direction_same_node");
  assert.equal(pairs[0].a, a);
  assert.equal(pairs[0].b, b);
});

test("contradictions: different nodes or missing nodes do not pair", () => {
  const pairs = detectContradictions([
    sig({ nodeSlug: "virtualization" }),
    sig({ nodeSlug: "kubernetes", direction: -1, evidenceId: "e2" }),
    sig({ nodeSlug: null, direction: -1, evidenceId: "e3" }),
  ]);
  assert.equal(pairs.length, 0);
});

test("computeDimensions: returns all seven dimensions in [0,100]", () => {
  const edgeWeights = new Map([["virtualization", 0.65]]);
  const signals = [
    sig({}),
    sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", nodeSlug: null, sourceType: "sec_filing", evidenceId: "e2" }),
    sig({ family: "initiative", signalType: "INFRA_MODERNIZATION", nodeSlug: null, sourceType: "press", evidenceId: "e3" }),
  ];
  const dims = computeDimensions(signals, "infrastructure-automation", edgeWeights, 62.5, NOW);
  const keys = Object.keys(dims);
  assert.deepEqual(keys.sort(), [
    "convergence", "corroboration", "evidence_confidence", "purchase_need",
    "purchase_propensity", "solution_fit", "timing",
  ]);
  for (const v of Object.values(dims)) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
  }
  assert.equal(dims.purchase_propensity, 63); // rounds the composite
  assert.ok(dims.solution_fit > 0); // adjacency edge counted
  assert.ok(dims.purchase_need > 0); // initiative + trigger present
  assert.ok(dims.timing > 0);
});

test("computeDimensions: installed target tech does not count as solution fit", () => {
  const edgeWeights = new Map([["infrastructure-automation", 1]]);
  const dims = computeDimensions(
    [sig({ nodeSlug: "infrastructure-automation" })],
    "infrastructure-automation",
    edgeWeights,
    0,
    NOW,
  );
  assert.equal(dims.solution_fit, 0);
});

test("evidenceSplit separates positive and negative contributions", () => {
  const split = evidenceSplit([
    { contribution: 18.2 },
    { contribution: 25 },
    { contribution: -12.5 },
  ]);
  assert.equal(split.positive, 43.2);
  assert.equal(split.negative, -12.5);
  assert.deepEqual(evidenceSplit([]), { positive: 0, negative: 0 });
});

test("refresh cadence follows the band", () => {
  assert.equal(refreshIntervalDays("very_high"), 7);
  assert.equal(refreshIntervalDays("high"), 7);
  assert.equal(refreshIntervalDays("medium"), 21);
  assert.equal(refreshIntervalDays("low"), 45);
});
