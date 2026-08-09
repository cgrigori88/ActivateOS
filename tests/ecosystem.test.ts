import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePartnerFit,
  FIT_WEIGHTS,
  rankPartners,
  type AccountContext,
  type PartnerProfile,
} from "../src/lib/ecosystem/partner-fit";

const TARGET = "infrastructure-automation";
const account: AccountContext = { industry: "Financial Services", country: "US" };

function partner(overrides: Partial<PartnerProfile>): PartnerProfile {
  return {
    partnerId: "p1",
    name: "Acme Partners",
    capabilities: new Map([[TARGET, 0.8]]),
    industries: [],
    countries: [],
    relationshipStrength: null,
    tenureMonths: null,
    sellerStrengths: [],
    ...overrides,
  };
}

test("fit weights sum to 1", () => {
  const sum = Object.values(FIT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("capability drives fit; unrestricted coverage scores full territory", () => {
  const fit = computePartnerFit(partner({}), account, TARGET);
  // capability 0.8×35 + territory 1.0×20 = 48; no relationship, no sellers.
  assert.ok(Math.abs(fit.score - 48) < 0.01);
  const cap = fit.features.find((f) => f.feature === "capability");
  assert.ok(cap && Math.abs(cap.contribution - 28) < 0.01);
});

test("existing relationship and seller coverage lift fit", () => {
  const warm = computePartnerFit(
    partner({ relationshipStrength: 80, tenureMonths: 36, sellerStrengths: [70, 40] }),
    account,
    TARGET,
  );
  // relationship: min(1, 0.8 + 0.15) = 0.95 → 28.5; sellers: 0.7 → 10.5
  const rel = warm.features.find((f) => f.feature === "relationship");
  assert.ok(rel && Math.abs(rel.contribution - 28.5) < 0.01);
  const sel = warm.features.find((f) => f.feature === "seller_coverage");
  assert.ok(sel && Math.abs(sel.contribution - 10.5) < 0.01);
  assert.ok(warm.score > 80);
  assert.equal(warm.band, "very_high");
});

test("territory mismatch penalizes, unknown attributes stay neutral", () => {
  const wrongIndustry = computePartnerFit(
    partner({ industries: ["Healthcare"], countries: ["US"] }),
    account,
    TARGET,
  );
  // industry 0×0.6 + country 1×0.4 = 0.4 → 8 points of 20
  const terr = wrongIndustry.features.find((f) => f.feature === "territory");
  assert.ok(terr && Math.abs(terr.contribution - 8) < 0.01);

  const unknownAccount = computePartnerFit(
    partner({ industries: ["Healthcare"], countries: ["US"] }),
    { industry: null, country: null },
    TARGET,
  );
  // unknown scores 0.5 on each axis: (0.5×0.6 + 0.5×0.4) × 20 = 10
  const terr2 = unknownAccount.features.find((f) => f.feature === "territory");
  assert.ok(terr2 && Math.abs(terr2.contribution - 10) < 0.01);
});

test("rankPartners hard-gates missing capability and sorts by score", () => {
  const noCapability = partner({ partnerId: "p0", name: "NoCap", capabilities: new Map() });
  const cold = partner({ partnerId: "p2", name: "Cold", capabilities: new Map([[TARGET, 0.5]]) });
  const warm = partner({
    partnerId: "p3",
    name: "Warm",
    relationshipStrength: 90,
    sellerStrengths: [85],
  });
  const ranked = rankPartners([noCapability, cold, warm], account, TARGET);
  assert.deepEqual(
    ranked.map((r) => r.partnerName),
    ["Warm", "Cold"],
  );
});

test("every feature carries a human-readable detail", () => {
  const fit = computePartnerFit(partner({}), account, TARGET);
  for (const f of fit.features) {
    assert.ok(fit.details.get(f.feature), `missing detail for ${f.feature}`);
  }
});

test("choosePartner respects capacity and records skip reasons", async () => {
  const { choosePartner } = await import("../src/lib/ecosystem/routing");
  const fits = [
    { partnerId: "p1", partnerName: "Top", fitId: "f1", score: 90 },
    { partnerId: "p2", partnerName: "Backup", fitId: "f2", score: 60 },
  ];
  const full = choosePartner(fits, {
    active: new Map([["p1", 1]]),
    capacity: new Map([["p1", 1], ["p2", null]]),
  });
  assert.equal(full.chosen?.partnerId, "p2");
  assert.equal(full.skipped.length, 1);
  assert.match(full.skipped[0].reason, /at capacity \(1\/1/);

  const open = choosePartner(fits, { active: new Map(), capacity: new Map([["p1", 1]]) });
  assert.equal(open.chosen?.partnerId, "p1");
  assert.equal(open.skipped.length, 0);
});

test("choosePartner returns null when every partner is saturated", async () => {
  const { choosePartner } = await import("../src/lib/ecosystem/routing");
  const result = choosePartner(
    [{ partnerId: "p1", partnerName: "Only", fitId: "f1", score: 90 }],
    { active: new Map([["p1", 2]]), capacity: new Map([["p1", 2]]) },
  );
  assert.equal(result.chosen, null);
  assert.equal(result.skipped.length, 1);
});

test("chooseSeller picks strongest relationship, never invents one", async () => {
  const { chooseSeller } = await import("../src/lib/ecosystem/routing");
  const best = chooseSeller([
    { sellerId: "s1", name: "A", relationshipStrength: 40 },
    { sellerId: "s2", name: "B", relationshipStrength: 85 },
    { sellerId: "s3", name: "C", relationshipStrength: null },
  ]);
  assert.equal(best?.sellerId, "s2");
  assert.equal(
    chooseSeller([{ sellerId: "s3", name: "C", relationshipStrength: null }]),
    null,
  );
  assert.equal(chooseSeller([]), null);
});
