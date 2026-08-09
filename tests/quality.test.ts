import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimFingerprint,
  claimSupportedByExcerpt,
  claimWellFormed,
  datePlausible,
  runDeterministicChecks,
} from "../src/lib/quality/checks";
import { computeConfidence, VERIFY_THRESHOLD } from "../src/lib/quality/confidence";
import { auditSampleRate, TRUST_CEILING, TRUST_FLOOR, updateTrust } from "../src/lib/quality/trust";

test("claimSupportedByExcerpt passes when claim content appears in excerpt", () => {
  const r = claimSupportedByExcerpt(
    "Company announced infrastructure modernization initiative",
    "Today the company announced a major infrastructure modernization initiative for 2026.",
  );
  assert.equal(r.passed, true);
});

test("claimSupportedByExcerpt hard-fails on unrelated excerpt", () => {
  const r = claimSupportedByExcerpt(
    "Company is hiring fourteen Kubernetes engineers",
    "Quarterly dividend declared payable to shareholders of record.",
  );
  assert.equal(r.passed, false);
  assert.equal(r.severity, "hard");
});

test("claimSupportedByExcerpt soft-fails without an excerpt", () => {
  const r = claimSupportedByExcerpt("Some claim about a company", null);
  assert.equal(r.passed, false);
  assert.equal(r.severity, "soft");
});

test("claimWellFormed rejects trivial and bloated claims", () => {
  assert.equal(claimWellFormed("too short").passed, false);
  assert.equal(claimWellFormed("A reasonable, specific claim about hiring.").passed, true);
  assert.equal(claimWellFormed("x".repeat(700)).passed, false);
});

test("datePlausible rejects future and ancient observations", () => {
  const now = new Date("2026-08-08T00:00:00Z");
  assert.equal(datePlausible(new Date("2026-08-01"), now).passed, true);
  assert.equal(datePlausible(new Date("2027-01-01"), now).passed, false);
  assert.equal(datePlausible(new Date("2010-01-01"), now).passed, false);
});

test("runDeterministicChecks flags unresolved entities as hard failure", () => {
  const checks = runDeterministicChecks({
    claim: "Customer-reported installed product: VMware vSphere",
    rawExcerpt: "Customer-reported installed product: VMware vSphere",
    observedAt: new Date(),
    extractionConfidence: 0.9,
    companyId: null,
  });
  const entity = checks.find((c) => c.check === "entity_resolved");
  assert.equal(entity?.passed, false);
  assert.equal(entity?.severity, "hard");
});

test("claimFingerprint is order-insensitive and company-scoped", () => {
  const a = claimFingerprint("c1", "hiring Kubernetes engineers rapidly");
  const b = claimFingerprint("c1", "Rapidly hiring engineers: Kubernetes!");
  const c = claimFingerprint("c2", "hiring Kubernetes engineers rapidly");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("computeConfidence combines extraction, trust, and corroboration", () => {
  const base = computeConfidence({
    extractionConfidence: 0.9,
    sourceTrust: 0.85,
    corroborations: 0,
    contradictions: 0,
  });
  assert.ok(Math.abs(base - 0.765) < 1e-9);
  assert.ok(base >= VERIFY_THRESHOLD);

  const corroborated = computeConfidence({
    extractionConfidence: 0.9,
    sourceTrust: 0.85,
    corroborations: 2,
    contradictions: 0,
  });
  assert.ok(corroborated > base);

  const contradicted = computeConfidence({
    extractionConfidence: 0.9,
    sourceTrust: 0.85,
    corroborations: 0,
    contradictions: 1,
  });
  assert.ok(contradicted < base / 1.9);
});

test("affirming cross-check lets a perfect new-source extraction clear the bar", () => {
  // New source (trust 0.5), perfect extraction, strongly affirming checker.
  const withCheck = computeConfidence({
    extractionConfidence: 1,
    sourceTrust: 0.5,
    corroborations: 0,
    contradictions: 0,
    crossCheckConfidence: 0.99,
  });
  assert.ok(withCheck >= VERIFY_THRESHOLD);

  // Without the cross-check the same item stays quarantined (trust must be earned).
  const withoutCheck = computeConfidence({
    extractionConfidence: 1,
    sourceTrust: 0.5,
    corroborations: 0,
    contradictions: 0,
  });
  assert.ok(withoutCheck < VERIFY_THRESHOLD);

  // A weaker extraction doesn't sneak through even with an affirming checker.
  const weaker = computeConfidence({
    extractionConfidence: 0.85,
    sourceTrust: 0.5,
    corroborations: 0,
    contradictions: 0,
    crossCheckConfidence: 0.9,
  });
  assert.ok(weaker < VERIFY_THRESHOLD);
});

test("computeConfidence caps corroboration boost and clamps to [0,1]", () => {
  const many = computeConfidence({
    extractionConfidence: 1,
    sourceTrust: 0.99,
    corroborations: 50,
    contradictions: 0,
  });
  assert.ok(many <= 1);
});

test("updateTrust moves in small bounded steps within [floor, ceiling]", () => {
  const up = updateTrust(0.5, true);
  assert.ok(up > 0.5 && up <= 0.55);
  const down = updateTrust(0.5, false);
  assert.ok(down < 0.5 && down >= 0.45);
  assert.equal(updateTrust(TRUST_FLOOR, false), TRUST_FLOOR);
  assert.equal(updateTrust(TRUST_CEILING, true), TRUST_CEILING);
});

test("auditSampleRate decays with trust between 2% and 50%", () => {
  assert.ok(auditSampleRate(0.2) > auditSampleRate(0.5));
  assert.ok(auditSampleRate(0.5) > auditSampleRate(0.9));
  assert.ok(auditSampleRate(0.99) >= 0.02);
  assert.ok(auditSampleRate(0.05) <= 0.5);
  assert.ok(Math.abs(auditSampleRate(0.9) - 0.026) < 0.001);
});

test("a new source's items are heavily sampled, a proven source barely", () => {
  const newSource = auditSampleRate(0.5); // default trust
  const proven = auditSampleRate(0.95);
  assert.ok(newSource > 0.15);
  assert.ok(proven < 0.03);
});

test("computeSourceIntel: predictive value with Laplace smoothing", async () => {
  const { computeSourceIntel } = await import("../src/lib/quality/source-intel");
  const intel = computeSourceIntel([
    { sourceType: "press", evidenceId: "e1", band: "very_high" },
    { sourceType: "press", evidenceId: "e2", band: "very_high" },
    { sourceType: "press", evidenceId: "e3", band: "low" },
    { sourceType: "web_search", evidenceId: "e4", band: "low" },
  ]);
  const press = intel.get("press")!;
  assert.equal(press.scoredEvidence, 3);
  assert.equal(press.highBandEvidence, 2);
  assert.equal(press.predictiveValue, 0.429); // (2+1)/(3+4), rounded to 3 decimals
  const web = intel.get("web_search")!;
  assert.equal(web.predictiveValue, (0 + 1) / (1 + 4)); // 0.2 — low but not zero
});

test("computeSourceIntel: same evidence in two features counts once", async () => {
  const { computeSourceIntel } = await import("../src/lib/quality/source-intel");
  const intel = computeSourceIntel([
    { sourceType: "press", evidenceId: "e1", band: "high" },
    { sourceType: "press", evidenceId: "e1", band: "high" },
  ]);
  assert.equal(intel.get("press")!.scoredEvidence, 1);
  assert.equal(intel.get("press")!.highBandEvidence, 1);
});
