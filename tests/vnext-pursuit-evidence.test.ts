import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composePursuitEvidence,
  type EvidenceFactInput,
  type PursuitEvidenceInput,
} from "../src/lib/pursuits/read-models/pursuit-evidence";
import { bandOf, type Caller } from "../src/lib/pursuits/read-models/helpers";

/**
 * Pursuit Evidence (vNext Slice 1, chunk 5B-2).
 *
 * The property under test throughout: DIRECT and SUPPORTING are decided by
 * LINKAGE, never by score. A fact does not become direct evidence by ranking
 * well, and a highly pertinent account fact never quietly becomes an assertion
 * somebody made about this pursuit.
 *
 * Pure function, so no database and no clock.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const FULL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-2", canSeeInternal: false, canSeeTransactionDetail: false };

function fact(over: Partial<EvidenceFactInput> & { factId: string }): EvidenceFactInput {
  return {
    predicateKey: "strategic_initiative",
    subjectLabel: "Globex Manufacturing Inc.",
    family: "initiative",
    status: "CURRENT",
    confidence: 0.9,
    provenanceClass: "FIRST_PARTY",
    disclosure: "INTERNAL",
    freshnessPolicy: "DECAYING",
    observedLastAt: daysAgo(5),
    halfLifeDays: 180,
    derivedRelevance: "SUPPORTING_CONTEXT",
    ...over,
  };
}

function input(over: Partial<PursuitEvidenceInput> = {}): PursuitEvidenceInput {
  return { pursuitId: "p-1", accountId: "c-1", caller: FULL, accountFacts: [], now: NOW, ...over };
}

/** The shape the Globex data actually has: one linked fact, several unlinked. */
const LINKED = fact({
  factId: "linked", predicateKey: "strategic_initiative",
  linkedRelevance: "SOLUTION_FIT", linkedAt: daysAgo(4), linkedByType: "system",
  linkReason: "Fact strategic_initiative", derivedRelevance: "SOLUTION_FIT",
});
const RENEWAL = fact({
  factId: "renewal", predicateKey: "renewal_date", subjectLabel: "Globex renewal",
  family: "trigger", freshnessPolicy: "VALID_UNTIL", validUntil: new Date("2026-12-01T00:00:00Z"),
  confidence: 0.92, provenanceClass: "CUSTOMER_DECLARED", derivedRelevance: "TIMING_ANCHOR",
});

// --- 1, 6, 10: linkage decides membership -----------------------------------

test("evidence: a pursuit-linked fact lands in DIRECT with its asserted relevance", () => {
  const v = composePursuitEvidence(input({ accountFacts: [LINKED] }));
  assert.equal(v.direct.length, 1);
  assert.equal(v.direct[0].factId, "linked");
  assert.equal(v.direct[0].linkage, "EXPLICIT");
  assert.equal(v.direct[0].relevance, "SOLUTION_FIT", "the ASSERTED relevance, not a derived one");
  assert.equal(v.direct[0].linkReason, "Fact strategic_initiative");
  assert.equal(v.supporting.length, 0);
});

test("evidence: direct linkage stays distinct from inferred pertinence", () => {
  const v = composePursuitEvidence(input({ accountFacts: [LINKED, RENEWAL] }));
  assert.deepEqual(v.direct.map((d) => d.factId), ["linked"]);
  assert.deepEqual(v.supporting.map((s) => s.factId), ["renewal"]);
  // The supporting item declares its relevance as inferred, under a different key.
  assert.equal(v.supporting[0].linkage, "INFERRED");
  assert.equal(v.supporting[0].inferredRelevance, "TIMING_ANCHOR");
  assert.ok(!("relevance" in v.supporting[0]), "an inferred relevance must not masquerade as an asserted one");
});

test("evidence: no direct evidence does NOT promote supporting context into direct", () => {
  const v = composePursuitEvidence(input({ accountFacts: [RENEWAL, fact({ factId: "other" })] }));
  assert.equal(v.direct.length, 0, "an empty direct array is the honest answer");
  assert.ok(v.supporting.length > 0);
  assert.equal(v.excludedSummary.direct, 0);
});

test("evidence: a top-ranked supporting fact never becomes direct", () => {
  // The renewal date outranks everything, and is still not evidence anyone linked.
  const v = composePursuitEvidence(input({ accountFacts: [RENEWAL, LINKED] }));
  assert.equal(v.supporting[0].factId, "renewal");
  assert.ok(v.supporting[0].pertinence > 0);
  assert.ok(!v.direct.some((d) => d.factId === "renewal"), "ranking well is not linkage");
});

// --- 2 & 3: relevant in, irrelevant out --------------------------------------

test("evidence: a relevant unlinked account fact lands in SUPPORTING", () => {
  const v = composePursuitEvidence(input({ accountFacts: [RENEWAL] }));
  assert.equal(v.supporting.length, 1);
  assert.equal(v.supporting[0].factId, "renewal");
  assert.ok(v.supporting[0].pertinence >= 40, `scored ${v.supporting[0].pertinence}`);
});

test("evidence: an unrelated, weak, aged fact does not reach SUPPORTING", () => {
  const noise = fact({
    factId: "noise", predicateKey: "office_location", subjectLabel: "Head office is in Ohio",
    family: "firmographic", confidence: 0.2, provenanceClass: "INFERRED",
    observedLastAt: daysAgo(1500), halfLifeDays: 30, derivedRelevance: "BACKGROUND",
  });
  const v = composePursuitEvidence(input({ accountFacts: [noise] }));
  assert.equal(v.supporting.length, 0);
  assert.equal(v.excludedSummary.belowBand, 1, "excluded by the canonical band gate, not a bespoke rule");
});

// --- 4: rejected facts -------------------------------------------------------

test("evidence: a REJECTED account fact never becomes positive evidence", () => {
  const v = composePursuitEvidence(input({
    accountFacts: [fact({ factId: "rej", status: "REJECTED", confidence: 1, derivedRelevance: "TIMING_ANCHOR" })],
  }));
  assert.equal(v.supporting.length, 0);
  assert.equal(v.direct.length, 0);
  assert.equal(v.excludedSummary.rejected, 1);
});

test("evidence: a REJECTED fact is excluded even when it carries a pursuit link", () => {
  const v = composePursuitEvidence(input({
    accountFacts: [fact({ factId: "rej", status: "REJECTED", linkedRelevance: "PRIMARY_TRIGGER" })],
  }));
  assert.equal(v.direct.length, 0, "existing rejection semantics outrank linkage");
  assert.equal(v.excludedSummary.rejected, 1);
});

// --- 5: disclosure invariance ------------------------------------------------

test("evidence: an unauthorized fact is absent and changes nothing visible", () => {
  const visible = [
    fact({ factId: "a", disclosure: "PARTNER_SHARED", derivedRelevance: "TIMING_ANCHOR" }),
    fact({ factId: "b", disclosure: "PARTNER_SHARED", confidence: 0.6 }),
  ];
  const secret = fact({
    factId: "secret", disclosure: "TRANSACTION_CONFIDENTIAL",
    subjectLabel: "$1.84M recent category activity", confidence: 1,
    derivedRelevance: "PRIMARY_TRIGGER", observedLastAt: NOW,
  });

  const without = composePursuitEvidence(input({ caller: GUEST, accountFacts: visible }));
  const withSecret = composePursuitEvidence(input({ caller: GUEST, accountFacts: [visible[0], secret, visible[1]] }));

  assert.deepEqual(
    withSecret.supporting.map((s) => [s.factId, s.pertinence, s.inclusionReasons]),
    without.supporting.map((s) => [s.factId, s.pertinence, s.inclusionReasons]),
    "a top-ranked inaccessible fact must not move a score, a position, or a reason",
  );
  assert.equal(withSecret.excludedSummary.supporting, without.excludedSummary.supporting);
  assert.equal(withSecret.excludedSummary.unauthorized, 1);
  assert.ok(!JSON.stringify(withSecret).includes("1.84M"));
});

test("evidence: an unauthorized LINKED fact does not reach direct either", () => {
  const v = composePursuitEvidence(input({
    caller: GUEST,
    accountFacts: [fact({ factId: "x", disclosure: "RESTRICTED", linkedRelevance: "PRIMARY_TRIGGER" })],
  }));
  assert.equal(v.direct.length, 0);
  assert.equal(v.excludedSummary.unauthorized, 1);
});

// --- 7: inclusion reasons ----------------------------------------------------

test("evidence: supporting items carry structured inclusion reasons and full signals", () => {
  const v = composePursuitEvidence(input({ accountFacts: [RENEWAL] }));
  const s = v.supporting[0];
  assert.equal(s.signals.length, 5, "the whole pertinence breakdown travels");
  assert.ok(s.inclusionReasons.length >= 1);
  assert.ok(s.inclusionReasons.every((r) => typeof r === "string" && r.length > 0));
  assert.match(s.inclusionReasons.join(" | "), /timing anchor/i, "the reason names the canonical relevance");
  // The score is still exactly the sum of the contributions — nothing added here.
  assert.equal(s.pertinence, Math.round(s.signals.reduce((a, x) => a + x.contribution, 0) * 100));
  // A settled timing anchor, recently observed, under no particular task: 66.
  // It cannot reach very_high because `unresolved` contributes nothing to a
  // CURRENT fact and GENERAL applies no task bias.
  assert.equal(s.pertinence, 66);
  assert.equal(s.band, bandOf(s.pertinence));
  assert.equal(s.band, "high");
  // `freshness` (predicate-specific, from factFreshness) and the pertinence
  // `recency` signal are deliberately different measures, and both are exposed.
  assert.ok(s.freshness > 0.9, `factFreshness ${s.freshness} reflects VALID_UNTIL proximity`);
});

// --- 8: no false linkage -----------------------------------------------------

test("evidence: composing produces no linkage side effect on its inputs", () => {
  const facts = [RENEWAL, LINKED];
  const snapshot = JSON.stringify(facts);
  const v = composePursuitEvidence(input({ accountFacts: facts }));
  assert.equal(JSON.stringify(facts), snapshot, "inputs must be untouched");
  // The supporting item exposes no field that could be mistaken for a link.
  const s = v.supporting[0] as unknown as Record<string, unknown>;
  for (const forbidden of ["linkedRelevance", "linkedAt", "linkedByType", "linkReason", "relevance"]) {
    assert.ok(!(forbidden in s), `supporting must not expose ${forbidden}`);
  }
});

// --- 9: staleness is pertinence, not a bespoke cutoff ------------------------

test("evidence: a stale but still-relevant fact is judged by pertinence, not a cutoff", () => {
  const agedAnchor = fact({
    factId: "aged", predicateKey: "renewal_date", subjectLabel: "Older renewal note",
    derivedRelevance: "TIMING_ANCHOR", observedLastAt: daysAgo(400), halfLifeDays: 180, confidence: 0.9,
  });
  const v = composePursuitEvidence(input({ accountFacts: [agedAnchor] }));
  // It survives: a strong relevance carries it despite low recency. No hard
  // staleness rule exists to delete it.
  assert.equal(v.supporting.length, 1);
  const recency = v.supporting[0].signals.find((s) => s.key === "recency")!;
  assert.ok(recency.value < 0.3, "recency is genuinely degraded");
  assert.ok(v.supporting[0].pertinence >= 40, "but pertinence, not a cutoff, decides");

  // Degrade it far enough and the canonical band gate removes it — still no cutoff.
  const ancient = composePursuitEvidence(input({
    accountFacts: [fact({ ...agedAnchor, observedLastAt: daysAgo(4000), halfLifeDays: 20, derivedRelevance: "BACKGROUND", confidence: 0.1 })],
  }));
  assert.equal(ancient.supporting.length, 0);
  assert.equal(ancient.excludedSummary.belowBand, 1);
});

// --- 11: volume does not produce volume --------------------------------------

test("evidence: a fact-rich account does not yield a large supporting list", () => {
  const many = Array.from({ length: 60 }, (_, i) => fact({
    factId: `f-${i}`, subjectLabel: `Account fact ${i}`,
    confidence: 0.5, derivedRelevance: "SUPPORTING_CONTEXT", observedLastAt: daysAgo(30),
  }));
  const v = composePursuitEvidence(input({ accountFacts: many }));
  assert.ok(v.supporting.length <= 6, `returned ${v.supporting.length}`);
  assert.equal(v.excludedSummary.accountFactsConsidered, 60);
  assert.ok(v.excludedSummary.belowBand + v.excludedSummary.beyondLimit > 0,
    "the excluded remainder must be accounted for, not silently dropped");
  assert.equal(
    v.supporting.length + v.excludedSummary.belowBand + v.excludedSummary.beyondLimit,
    60,
    "every considered fact is accounted for exactly once",
  );
});

test("evidence: the presentation limit is a bound on display, not on truth", () => {
  const many = Array.from({ length: 20 }, (_, i) => fact({
    factId: `f-${i}`, derivedRelevance: "TIMING_ANCHOR", confidence: 0.9, observedLastAt: daysAgo(1),
  }));
  const capped = composePursuitEvidence(input({ accountFacts: many }));
  const uncapped = composePursuitEvidence(input({ accountFacts: many, supportingLimit: 100 }));
  assert.equal(capped.supporting.length, 6);
  assert.equal(capped.excludedSummary.beyondLimit, 14);
  assert.equal(uncapped.supporting.length, 20);
  assert.equal(uncapped.excludedSummary.beyondLimit, 0);
});

// --- 12: four-state semantics ------------------------------------------------

test("evidence: fact status and provenance survive on both arrays", () => {
  const v = composePursuitEvidence(input({
    accountFacts: [
      fact({ factId: "disputed", status: "DISPUTED", derivedRelevance: "TIMING_ANCHOR" }),
      fact({ factId: "superseded", status: "SUPERSEDED", superseded: true, derivedRelevance: "TIMING_ANCHOR" }),
      fact({ factId: "stale", status: "STALE", derivedRelevance: "TIMING_ANCHOR" }),
      { ...LINKED },
    ],
  }));
  const states = new Map(v.supporting.map((s) => [s.factId, s.status]));
  assert.equal(states.get("disputed"), "DISPUTED");
  assert.equal(states.get("superseded"), "SUPERSEDED");
  assert.equal(states.get("stale"), "STALE");
  assert.equal(v.direct[0].status, "CURRENT");
  assert.equal(v.direct[0].provenanceClass, "FIRST_PARTY");
  // A disputed fact is an open question, which pertinence already recognises.
  const disputed = v.supporting.find((s) => s.factId === "disputed")!;
  assert.equal(disputed.signals.find((s) => s.key === "unresolved")!.value, 1);
});

test("evidence: direct ordering prefers asserted relevance, then freshness", () => {
  const v = composePursuitEvidence(input({
    accountFacts: [
      fact({ factId: "bg", linkedRelevance: "BACKGROUND" }),
      fact({ factId: "anchor", linkedRelevance: "TIMING_ANCHOR", observedLastAt: daysAgo(200) }),
      fact({ factId: "anchor-fresh", linkedRelevance: "TIMING_ANCHOR", observedLastAt: daysAgo(1) }),
    ],
  }));
  assert.deepEqual(v.direct.map((d) => d.factId), ["anchor-fresh", "anchor", "bg"]);
});

test("evidence: composition is deterministic", () => {
  const i = input({ accountFacts: [LINKED, RENEWAL, fact({ factId: "z", confidence: 0.7 })] });
  assert.deepEqual(composePursuitEvidence(i), composePursuitEvidence(i));
});
