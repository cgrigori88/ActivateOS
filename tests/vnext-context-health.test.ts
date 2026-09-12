import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeContextHealth,
  RELEVANCE_WEIGHT,
  type ContextFactInput,
  type ContextHealthInput,
} from "../src/lib/pursuits/read-models/context-health";

/**
 * Pursuit Context Health (vNext Slice 1, chunk 1).
 *
 * The properties worth pinning are the ones that make the read-model honest:
 * an absent measurement never becomes a zero, every band keeps a ref-carrying
 * reason, a stale pursuit and a conflicted pursuit reach different conclusions
 * even at similar overall scores, and relevance weighting actually bites — a
 * stale TIMING_ANCHOR must hurt more than a stale BACKGROUND fact.
 *
 * Pure function, so no database and no clock: `now` is injected everywhere.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function fact(over: Partial<ContextFactInput> = {}): ContextFactInput {
  return {
    factId: over.factId ?? "f-1",
    predicateKey: "uses_technology",
    label: "Runs legacy hypervisor",
    relevance: "PRIMARY_TRIGGER",
    status: "CURRENT",
    confidence: 0.9,
    provenanceClass: "FIRST_PARTY",
    freshnessPolicy: "DECAYING",
    observedLastAt: daysAgo(5),
    halfLifeDays: 180,
    ...over,
  };
}

function input(over: Partial<ContextHealthInput> = {}): ContextHealthInput {
  return {
    pursuitId: "p-1",
    facts: [fact()],
    completeness: {
      providersRun: new Set(["pdl_company", "sec_edgar", "greenhouse", "dns", "github", "partner_transactions", "installed_base", "pdl_people"]),
      familiesPresent: new Set<string>(),
    },
    now: NOW,
    ...over,
  };
}

// --- positive: healthy context ---------------------------------------------

test("context health: fresh, well-covered, well-evidenced context reads VERIFIED", () => {
  const v = computeContextHealth(input());
  assert.equal(v.conclusion, "VERIFIED");
  assert.ok(v.overall != null && v.overall >= 60, `overall ${v.overall} should be healthy`);
  assert.equal(v.band, v.overall != null && v.overall >= 80 ? "very_high" : "high");
  assert.equal(v.factsConsidered, 1);
  assert.deepEqual(v.coverage.gaps, []);
  assert.ok(v.trust.includes("VERIFIED"));
  assert.ok(v.trust.includes("FIRST_PARTY"));
});

test("context health: every dimension keeps an inspectable reason", () => {
  const v = computeContextHealth(input());
  for (const d of v.dimensions) {
    assert.ok(d.why.length > 0, `${d.key} must explain itself`);
    assert.ok(d.definition.length > 0, `${d.key} must carry its definition`);
  }
  // Negative reasons must be traceable to a specific record.
  const stale = computeContextHealth(input({ facts: [fact({ observedLastAt: daysAgo(4000) })] }));
  const freshDim = stale.dimensions.find((d) => d.key === "freshness")!;
  const negative = freshDim.why.find((w) => w.polarity === -1)!;
  assert.equal(negative.refType, "fact");
  assert.equal(negative.refId, "f-1");
});

// --- negative: the four ways context degrades -------------------------------

test("context health: aged-out context reads STALE, not merely low", () => {
  const v = computeContextHealth(input({ facts: [fact({ observedLastAt: daysAgo(4000), halfLifeDays: 30 })] }));
  assert.equal(v.conclusion, "STALE");
  assert.ok(v.trust.includes("STALE"));
  assert.ok(v.concerns.some((c) => c.kind === "STALE_FACT" && c.refId === "f-1"));
});

test("context health: incomplete research reads NEEDS_VALIDATION and names the categories", () => {
  const v = computeContextHealth(input({
    completeness: { providersRun: new Set(["pdl_company"]), familiesPresent: new Set<string>() },
  }));
  assert.equal(v.conclusion, "NEEDS_VALIDATION");
  const missing = v.concerns.filter((c) => c.kind === "MISSING_COVERAGE");
  assert.ok(missing.length >= 5, "most categories are unresearched here");
  assert.ok(missing.every((c) => c.refType === "coverage_category" && c.refId));
});

test("context health: disputed context reads CONFLICTING and outranks staleness", () => {
  const v = computeContextHealth(input({
    // Both problems present at once; disagreement must win the conclusion.
    facts: [fact({ status: "DISPUTED", observedLastAt: daysAgo(4000), halfLifeDays: 30 })],
  }));
  assert.equal(v.conclusion, "CONFLICTING");
  assert.ok(v.trust.includes("DISPUTED"));
});

test("context health: an unresolved contradiction count alone can make it CONFLICTING", () => {
  const v = computeContextHealth(input({ openContradictions: 2 }));
  assert.equal(v.conclusion, "CONFLICTING");
  const c = v.concerns.find((x) => x.kind === "OPEN_CONTRADICTION")!;
  assert.equal(c.refType, "pursuit");
  assert.match(c.text, /2 unresolved contradictions/);
});

test("context health: superseded facts drag currency and are named", () => {
  const v = computeContextHealth(input({ facts: [fact({ status: "SUPERSEDED", superseded: true })] }));
  const currency = v.dimensions.find((d) => d.key === "currency")!;
  assert.equal(currency.value, 0);
  assert.ok(v.trust.includes("SUPERSEDED"));
  assert.ok(v.concerns.some((c) => c.kind === "SUPERSEDED_FACT"));
});

test("context health: weak provenance is reported even when confidence is high", () => {
  const v = computeContextHealth(input({ facts: [fact({ provenanceClass: "INFERRED", confidence: 0.95 })] }));
  assert.ok(v.concerns.some((c) => c.kind === "WEAK_PROVENANCE"), "a confident inference is still an inference");
  const corrob = v.dimensions.find((d) => d.key === "corroboration")!;
  assert.ok(corrob.value != null && corrob.value < 40);
});

// --- the honesty properties -------------------------------------------------

test("context health: no linked facts is NOT_ESTABLISHED with a null overall, never zero", () => {
  const v = computeContextHealth(input({ facts: [] }));
  assert.equal(v.conclusion, "NOT_ESTABLISHED");
  assert.equal(v.overall, null, "unknown must not be reported as 0");
  assert.equal(v.band, "unknown");
  assert.equal(v.factsConsidered, 0);
  // Coverage still measurable: it reflects research effort, not belief.
  assert.ok(v.dimensions.find((d) => d.key === "coverage")!.known);
  for (const key of ["freshness", "corroboration", "consistency", "currency"] as const) {
    const d = v.dimensions.find((x) => x.key === key)!;
    assert.equal(d.value, null);
    assert.equal(d.band, "unknown");
    assert.equal(d.known, false);
  }
});

test("context health: REJECTED facts are excluded, not scored as bad", () => {
  const withRejected = computeContextHealth(input({ facts: [fact(), fact({ factId: "f-2", status: "REJECTED", confidence: 0 })] }));
  const without = computeContextHealth(input());
  assert.equal(withRejected.factsConsidered, 1);
  assert.equal(withRejected.factsExcluded, 1);
  assert.equal(withRejected.overall, without.overall, "declining to believe a claim is the process working");
});

test("context health: relevance weighting bites — a stale timing anchor hurts more than stale background", () => {
  const staleAnchor = computeContextHealth(input({
    facts: [fact({ factId: "a", relevance: "TIMING_ANCHOR", observedLastAt: daysAgo(4000), halfLifeDays: 30 }), fact({ factId: "b", relevance: "BACKGROUND" })],
  }));
  const staleBackground = computeContextHealth(input({
    facts: [fact({ factId: "a", relevance: "TIMING_ANCHOR" }), fact({ factId: "b", relevance: "BACKGROUND", observedLastAt: daysAgo(4000), halfLifeDays: 30 })],
  }));
  const f1 = staleAnchor.dimensions.find((d) => d.key === "freshness")!.value!;
  const f2 = staleBackground.dimensions.find((d) => d.key === "freshness")!.value!;
  assert.ok(f1 < f2, `stale anchor (${f1}) must score worse than stale background (${f2})`);
  assert.ok(RELEVANCE_WEIGHT.TIMING_ANCHOR > RELEVANCE_WEIGHT.BACKGROUND);
});

test("context health: requiredCategories narrows coverage to what this pursuit depends on", () => {
  const onlyTiming = computeContextHealth(input({
    completeness: { providersRun: new Set(["installed_base"]), familiesPresent: new Set<string>() },
    requiredCategories: ["timing"],
  }));
  assert.equal(onlyTiming.dimensions.find((d) => d.key === "coverage")!.value, 100,
    "hiring coverage is irrelevant to a pursuit that does not depend on it");
  assert.equal(onlyTiming.concerns.filter((c) => c.kind === "MISSING_COVERAGE").length, 0);
});

test("context health: concerns are ranked worst-first and it is deterministic", () => {
  const i = input({
    facts: [
      fact({ factId: "bg", relevance: "BACKGROUND", observedLastAt: daysAgo(4000), halfLifeDays: 30 }),
      fact({ factId: "anchor", relevance: "TIMING_ANCHOR", observedLastAt: daysAgo(4000), halfLifeDays: 30 }),
    ],
  });
  const v = computeContextHealth(i);
  const staleConcerns = v.concerns.filter((c) => c.kind === "STALE_FACT");
  assert.equal(staleConcerns[0].refId, "anchor", "the biggest drag must come first");
  // Same inputs, same output — no clock of its own, no randomness.
  assert.deepEqual(computeContextHealth(i), v);
});
