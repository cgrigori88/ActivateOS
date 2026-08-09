import assert from "node:assert/strict";
import { test } from "node:test";
import {
  band,
  computeScore,
  decay,
  type EdgeMap,
  type ScorableSignal,
} from "../src/lib/scoring/compute";
import { matchProductToNode } from "../src/lib/agents/taxonomy-mapper";

const NOW = new Date("2026-08-08T00:00:00Z");

function sig(overrides: Partial<ScorableSignal>): ScorableSignal {
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
    ...overrides,
  };
}

const edges: EdgeMap = new Map([
  ["virtualization", { weight: 0.65, edgeType: "adjacent" }],
  ["kubernetes", { weight: 0.7, edgeType: "adjacent" }],
  ["operating-systems", { weight: 0.55, edgeType: "adjacent" }],
]);

test("decay halves at one half-life and is 1 at zero age", () => {
  assert.equal(decay(NOW, 90, NOW), 1);
  const halfLifeAgo = new Date(NOW.getTime() - 90 * 86_400_000);
  assert.ok(Math.abs(decay(halfLifeAgo, 90, NOW) - 0.5) < 1e-9);
});

test("band thresholds", () => {
  assert.equal(band(85), "very_high");
  assert.equal(band(60), "high");
  assert.equal(band(45), "medium");
  assert.equal(band(10), "low");
});

test("technology fit weights adjacency edges and records evidence", () => {
  const result = computeScore([sig({})], "infrastructure-automation", edges, NOW);
  const fit = result.features.find((f) => f.feature === "technology_fit");
  assert.ok(fit);
  // 0.8 conf × 0.65 edge = 0.52 raw → × 0.35 weight × 100 = 18.2 points
  assert.ok(Math.abs(fit.contribution - 18.2) < 0.01);
  assert.deepEqual(fit.evidenceIds, ["e1"]);
  assert.ok(Math.abs(result.score - 18.2) < 0.01);
});

test("installed target technology penalizes instead of boosting", () => {
  const result = computeScore(
    [sig({ nodeSlug: "infrastructure-automation" })],
    "infrastructure-automation",
    edges,
    NOW,
  );
  const penalty = result.features.find((f) => f.feature === "already_installed");
  assert.ok(penalty && penalty.contribution < 0);
  assert.equal(result.features.find((f) => f.feature === "technology_fit"), undefined);
});

test("negative signals subtract points", () => {
  const positive = computeScore(
    [sig({}), sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", nodeSlug: null, evidenceId: "e2" })],
    "infrastructure-automation",
    edges,
    NOW,
  );
  const withNegative = computeScore(
    [
      sig({}),
      sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", nodeSlug: null, evidenceId: "e2" }),
      sig({ family: "negative", direction: -1, signalType: "LAYOFFS", nodeSlug: null, evidenceId: "e3" }),
    ],
    "infrastructure-automation",
    edges,
    NOW,
  );
  assert.ok(withNegative.score < positive.score);
  const neg = withNegative.features.find((f) => f.feature === "negative_signals");
  assert.ok(neg && neg.contribution < 0);
});

test("feature raw values are capped at 1 before weighting", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    sig({ family: "trigger", signalType: "CONTRACT_EXPIRING", nodeSlug: null, magnitude: 1, confidence: 1, evidenceId: `e${i}` }),
  );
  const result = computeScore(many, "infrastructure-automation", edges, NOW);
  const trigger = result.features.find((f) => f.feature === "trigger_events");
  assert.ok(trigger);
  assert.ok(Math.abs(trigger.contribution - 25) < 1e-9); // 0.25 × 100, capped
});

test("stale signals contribute less than fresh ones", () => {
  const fresh = computeScore(
    [sig({ family: "momentum", signalType: "HIRING_TECH_SKILL", nodeSlug: null, halfLifeDays: 90 })],
    "infrastructure-automation",
    edges,
    NOW,
  );
  const stale = computeScore(
    [
      sig({
        family: "momentum",
        signalType: "HIRING_TECH_SKILL",
        nodeSlug: null,
        halfLifeDays: 90,
        observedAt: new Date(NOW.getTime() - 180 * 86_400_000),
      }),
    ],
    "infrastructure-automation",
    edges,
    NOW,
  );
  assert.ok(stale.score < fresh.score);
});

test("score clamps to [0, 100]", () => {
  const onlyNegative = computeScore(
    [sig({ family: "negative", direction: -1, signalType: "LAYOFFS", nodeSlug: null })],
    "infrastructure-automation",
    edges,
    NOW,
  );
  assert.equal(onlyNegative.score, 0);
  assert.equal(onlyNegative.band, "low");
});

test("product map matches known products case-insensitively", () => {
  const map = {
    patterns: [
      { match: ["vmware", "vsphere"], node: "virtualization" },
      { match: ["kubernetes", "openshift"], node: "kubernetes" },
    ],
  };
  assert.equal(matchProductToNode("VMware vSphere 8", map), "virtualization");
  assert.equal(matchProductToNode("Red Hat OpenShift", map), "kubernetes");
  assert.equal(matchProductToNode("Unknown Product", map), null);
});

test("validateCitations enforces known ids and minimum count", async () => {
  const { validateCitations } = await import("../src/lib/agents/motion-designer");
  const available = new Set(["e1", "e2", "e3"]);
  assert.equal(validateCitations(["e1", "e2"], available).ok, true);
  assert.equal(validateCitations(["e1"], available).ok, false);
  assert.equal(validateCitations(["e1", "bogus"], available).ok, false);
});

test("computeMotionDiff captures only real edits", async () => {
  const { computeMotionDiff } = await import("../src/lib/motions/approve");
  const original = { thesis: "old thesis", cta: "workshop", trigger_summary: "t", primary_persona: "a", secondary_persona: "b" };
  const diff = computeMotionDiff(original, { thesis: "new thesis", cta: "workshop" });
  assert.deepEqual(Object.keys(diff), ["thesis"]);
  assert.equal(diff.thesis.from, "old thesis");
  assert.equal(diff.thesis.to, "new thesis");
  assert.deepEqual(computeMotionDiff(original, {}), {});
});
