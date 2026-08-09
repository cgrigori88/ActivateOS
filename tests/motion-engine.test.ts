import assert from "node:assert/strict";
import { test } from "node:test";
import { ALLOWED_TRANSITIONS, canTransition } from "../src/lib/motions/lifecycle";
import { computeMotionEconomics, expectedValueUsd } from "../src/lib/motions/economics";
import { rankNextActions, type PortfolioState } from "../src/lib/portfolio/next-best";

test("lifecycle: approval gate cannot be skipped, closed states are terminal", () => {
  assert.equal(canTransition("draft", "active"), false); // no skipping approval
  assert.equal(canTransition("draft", "approved"), true);
  assert.equal(canTransition("approved", "active"), true);
  assert.equal(canTransition("active", "completed"), true);
  assert.equal(canTransition("completed", "active"), false); // terminal
  assert.equal(canTransition("abandoned", "draft"), false); // terminal
  assert.equal(ALLOWED_TRANSITIONS.completed.length, 0);
  assert.equal(ALLOWED_TRANSITIONS.abandoned.length, 0);
});

test("economics: base + per-employee scaling with cap", () => {
  const econ = { base_value_usd: 120_000, value_per_employee_usd: 35, value_cap_usd: 600_000, effort: 3 };
  assert.deepEqual(computeMotionEconomics(econ, 1800), {
    estimatedValueUsd: 183_000, // 120k + 35×1800
    effort: 3,
  });
  // Huge account hits the cap.
  assert.equal(computeMotionEconomics(econ, 100_000).estimatedValueUsd, 600_000);
  // Unknown headcount falls back to base value.
  assert.equal(computeMotionEconomics(econ, null).estimatedValueUsd, 120_000);
  // Effort clamps to 1..5.
  assert.equal(computeMotionEconomics({ base_value_usd: 1, effort: 9 }, null).effort, 5);
});

test("expected value discounts by propensity", () => {
  assert.equal(expectedValueUsd(183_000, 87), 159_210);
  assert.equal(expectedValueUsd(183_000, 0), 0);
  assert.equal(expectedValueUsd(100_000, 150), 100_000); // clamped
});

test("next-best actions rank revenue work by expected value, hygiene by weight", () => {
  const state: PortfolioState = {
    draftMotions: [
      { motionId: "m1", company: "Big", expectedValueUsd: 160_000 },
      { motionId: "m2", company: "Small", expectedValueUsd: 20_000 },
    ],
    approvedMotions: [
      { motionId: "m3", company: "Ready", expectedValueUsd: 90_000, hasCampaign: true },
      { motionId: "m4", company: "NoAssets", expectedValueUsd: 90_000, hasCampaign: false },
    ],
    pendingReviewCount: 3,
    openContradictions: [{ company: "Torn", companyId: "c1" }],
    refreshDue: [{ company: "Stale", companyId: "c2", tier: "very_high" }],
  };
  const actions = rankNextActions(state);
  // Highest expected value first.
  assert.equal(actions[0].type, "APPROVE_MOTION");
  assert.match(actions[0].title, /Big/);
  // Approved motions produce the right verb for their campaign state.
  const types = actions.map((a) => a.type);
  assert.ok(types.includes("ACTIVATE_MOTION"));
  assert.ok(types.includes("COMPOSE_CAMPAIGN"));
  // Hygiene actions present but below the big revenue actions.
  const contradictionIdx = types.indexOf("RESOLVE_CONTRADICTION");
  assert.ok(contradictionIdx > 0);
  assert.ok(actions[contradictionIdx].priority < actions[0].priority);
  // Small draft (20k) ranks below the contradiction (40k) — hygiene can win.
  const smallIdx = actions.findIndex((a) => a.title.includes("Small"));
  assert.ok(contradictionIdx < smallIdx);
});

test("next-best actions respect the limit and handle empty state", () => {
  const empty: PortfolioState = {
    draftMotions: [],
    approvedMotions: [],
    pendingReviewCount: 0,
    openContradictions: [],
    refreshDue: [],
  };
  assert.deepEqual(rankNextActions(empty), []);
  const many: PortfolioState = {
    ...empty,
    refreshDue: Array.from({ length: 20 }, (_, i) => ({
      company: `C${i}`,
      companyId: `id${i}`,
      tier: "low",
    })),
  };
  assert.equal(rankNextActions(many, 5).length, 5);
});

test("cadence: day offsets become dates, weekends shift to Monday", async () => {
  const { instantiateCadence, nextBusinessDay } = await import("../src/lib/motions/cadence");
  // 2026-08-10 is a Monday.
  const monday = new Date("2026-08-10T09:00:00Z");
  const actions = instantiateCadence(
    [
      { step: 2, action: "second", day: 3 },
      { step: 1, action: "first", day: 0 },
      { step: 3, action: "weekend", day: 5 }, // Saturday → Monday
    ],
    monday,
  );
  // Sorted by step regardless of input order.
  assert.deepEqual(actions.map((a) => a.step), [1, 2, 3]);
  assert.equal(actions[0].dueAt.toISOString().slice(0, 10), "2026-08-10");
  assert.equal(actions[1].dueAt.toISOString().slice(0, 10), "2026-08-13");
  assert.equal(actions[2].dueAt.toISOString().slice(0, 10), "2026-08-17"); // shifted off Saturday
  // Sunday shifts one day.
  assert.equal(
    nextBusinessDay(new Date("2026-08-16T09:00:00Z")).toISOString().slice(0, 10),
    "2026-08-17",
  );
  // Weekdays untouched.
  assert.equal(
    nextBusinessDay(new Date("2026-08-12T09:00:00Z")).toISOString().slice(0, 10),
    "2026-08-12",
  );
});
