import assert from "node:assert/strict";
import { test } from "node:test";
import { computeFunnel } from "../src/lib/insights/funnel";
import {
  calibrateStages,
  editIntensity,
  MIN_SAMPLE,
} from "../src/lib/insights/calibration";

test("funnel counts distinct motions per step with conversion rates", () => {
  const events = [
    { event_type: "MOTION_CREATED", motion_id: "m1" },
    { event_type: "MOTION_CREATED", motion_id: "m2" },
    { event_type: "MOTION_CREATED", motion_id: "m3" },
    { event_type: "MOTION_APPROVED", motion_id: "m1" },
    { event_type: "MOTION_APPROVED", motion_id: "m2" },
    { event_type: "MOTION_ACTIVATED", motion_id: "m1" },
    { event_type: "REPLIED", motion_id: "m1" },
    { event_type: "REPLIED", motion_id: "m1" }, // duplicate: counts once
    { event_type: "OPPORTUNITY_CREATED", motion_id: "m1" },
  ];
  const funnel = computeFunnel(events);
  assert.deepEqual(
    funnel.map((s) => [s.key, s.count]),
    [
      ["motion_created", 3],
      ["motion_approved", 2],
      ["motion_activated", 1],
      ["replied", 1],
      ["opportunity", 1],
      ["won", 0],
    ],
  );
  assert.equal(funnel[0].conversion, null);
  assert.equal(funnel[1].conversion, 0.67);
  assert.equal(funnel[3].conversion, 1);
  assert.equal(funnel[5].conversion, 0);
});

test("calibration gates on minimum sample and flags divergence", () => {
  // 3 closed deals: far below MIN_SAMPLE → observed null, never divergent.
  const few = calibrateStages([
    { stagesReached: ["discovery"], won: true },
    { stagesReached: ["discovery", "qualification"], won: false },
    { stagesReached: ["discovery"], won: false },
  ]);
  const discovery = few.find((c) => c.stage === "discovery")!;
  assert.equal(discovery.observed, null);
  assert.equal(discovery.sample, 3);
  assert.equal(discovery.divergent, false);

  // 20 deals through discovery, 10 won → observed 0.5 vs declared 0.1 → divergent.
  const many = calibrateStages(
    Array.from({ length: 20 }, (_, i) => ({
      stagesReached: ["discovery" as const],
      won: i < 10,
    })),
  );
  const d = many.find((c) => c.stage === "discovery")!;
  assert.ok(d.sample >= MIN_SAMPLE);
  assert.equal(d.observed, 0.5);
  assert.equal(d.divergent, true);
});

test("edit intensity normalizes by draft length", () => {
  assert.equal(editIntensity([]), null);
  assert.equal(editIntensity([{ editDistance: 0, draftLength: 100 }]), 0);
  assert.equal(editIntensity([{ editDistance: 50, draftLength: 100 }]), 0.5);
  // Rewrites cap at 1 even when distance exceeds length.
  assert.equal(editIntensity([{ editDistance: 500, draftLength: 100 }]), 1);
});
