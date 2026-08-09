import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAdvance,
  STAGE_PROBABILITY,
  stakeholderGaps,
  weightedPipelineValue,
} from "../src/lib/opportunities/lifecycle";

test("stage transitions: forward and one-step-back allowed, closed terminal", () => {
  assert.equal(canAdvance("discovery", "qualification"), true);
  assert.equal(canAdvance("discovery", "proposal"), true); // deals can skip
  assert.equal(canAdvance("proposal", "business_validation"), true); // one step back
  assert.equal(canAdvance("proposal", "discovery"), false); // two steps back
  assert.equal(canAdvance("discovery", "closed_lost"), true); // close from anywhere
  assert.equal(canAdvance("negotiation", "closed_won"), true);
  assert.equal(canAdvance("closed_won", "negotiation"), false); // terminal
  assert.equal(canAdvance("closed_lost", "discovery"), false);
  assert.equal(canAdvance("discovery", "discovery"), false); // no-op
});

test("weighted pipeline: open stages weighted, closed excluded", () => {
  const value = weightedPipelineValue([
    { stage: "discovery", amountUsd: 100_000 }, // ×0.10 = 10k
    { stage: "proposal", amountUsd: 200_000 }, // ×0.60 = 120k
    { stage: "closed_won", amountUsd: 999_999 }, // excluded
    { stage: "closed_lost", amountUsd: 999_999 }, // excluded
    { stage: "negotiation", amountUsd: null }, // null amount = 0
  ]);
  assert.equal(value, 130_000);
  const probs = Object.values(STAGE_PROBABILITY);
  assert.ok(probs.every((p) => p >= 0 && p <= 1));
});

test("stakeholder gaps flag missing roles and active blockers", () => {
  assert.deepEqual(stakeholderGaps([]), [
    "no economic buyer identified",
    "no champion",
    "no technical buyer",
  ]);
  const covered = stakeholderGaps([
    { role: "economic_buyer", sentiment: "neutral" },
    { role: "champion", sentiment: "positive" },
    { role: "technical_buyer", sentiment: "positive" },
  ]);
  assert.deepEqual(covered, []);
  const blocked = stakeholderGaps([
    { role: "economic_buyer", sentiment: "neutral" },
    { role: "champion", sentiment: "positive" },
    { role: "technical_buyer", sentiment: "positive" },
    { role: "blocker", sentiment: "negative" },
  ]);
  assert.deepEqual(blocked, ["active blocker"]);
  // A converted blocker is no longer a gap.
  const converted = stakeholderGaps([
    { role: "economic_buyer", sentiment: "neutral" },
    { role: "champion", sentiment: "positive" },
    { role: "technical_buyer", sentiment: "positive" },
    { role: "blocker", sentiment: "positive" },
  ]);
  assert.deepEqual(converted, []);
});
