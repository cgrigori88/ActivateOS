import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTEXT_STATE_LABEL,
  composePursuitContext,
  type PursuitContextInput,
} from "../src/lib/pursuits/read-models/pursuit-context";
import type { ContextHealthView } from "../src/lib/pursuits/read-models/context-health";
import type { MissingContextView } from "../src/lib/pursuits/read-models/missing-context";
import type { PursuitMemoryView } from "../src/lib/pursuits/read-models/memory";
import type { PursuitEvidenceView } from "../src/lib/pursuits/read-models/pursuit-evidence";
import type { WhyNowView } from "../src/lib/pursuits/read-models/types";

/**
 * Pursuit Brief view-model (vNext Slice 1, chunk 6A).
 *
 * The properties that decide whether one surface can honestly replace three:
 * every section degrades to a stated absence rather than a confident
 * placeholder; the five-state vocabulary reaches the copy intact; direct and
 * supporting evidence stay distinguishable in what a user reads; and the Globex
 * nuance — the account holds timing the pursuit has not validated — is said
 * accurately rather than as either half of the truth.
 *
 * Pure function, so no database, no clock, no rendering.
 */

const NOW = new Date("2026-09-12T00:00:00Z");
const iso = (d: string) => new Date(d).toISOString();

function evidence(over: Partial<PursuitEvidenceView> = {}): PursuitEvidenceView {
  return {
    pursuitId: "p-1", accountId: "c-1", direct: [], supporting: [],
    excludedSummary: { accountFactsConsidered: 0, direct: 0, supporting: 0, rejected: 0, unauthorized: 0, belowBand: 0, beyondLimit: 0 },
    decisionContext: "GENERAL", computedAt: NOW.toISOString(),
    ...over,
  };
}

const directFact = (over: Partial<PursuitEvidenceView["direct"][number]> = {}): PursuitEvidenceView["direct"][number] => ({
  factId: "d-1", predicateKey: "strategic_initiative", label: "Modernisation programme underway",
  family: "initiative", status: "CURRENT", confidence: 0.89, provenanceClass: "FIRST_PARTY",
  disclosure: "INTERNAL", freshness: 1, observedLastAt: iso("2026-09-10"),
  linkage: "EXPLICIT", relevance: "SOLUTION_FIT", linkedAt: iso("2026-09-10"),
  linkedByType: "system", linkReason: "Fact strategic_initiative",
  ...over,
});

const supportingFact = (over: Partial<PursuitEvidenceView["supporting"][number]> = {}): PursuitEvidenceView["supporting"][number] => ({
  factId: "s-1", predicateKey: "renewal_date", label: "Globex renewal", family: "trigger",
  status: "CURRENT", confidence: 0.92, provenanceClass: "CUSTOMER_DECLARED",
  disclosure: "INTERNAL", freshness: 0.98, observedLastAt: iso("2026-09-10"),
  linkage: "INFERRED", inferredRelevance: "TIMING_ANCHOR", pertinence: 67, band: "high",
  signals: [], inclusionReasons: ["Would bear on this pursuit as timing anchor — inferred, not linked"],
  ...over,
});

function health(over: Partial<ContextHealthView> = {}): ContextHealthView {
  return {
    pursuitId: "p-1", overall: 68, band: "high", conclusion: "NEEDS_VALIDATION",
    dimensions: [], concerns: [], trust: [], factsConsidered: 1, factsExcluded: 0,
    coverage: { byCategory: {} as never, overall: 60, gaps: [] },
    computedAt: NOW.toISOString(), ...over,
  };
}

function missing(over: Partial<MissingContextView> = {}): MissingContextView {
  return {
    pursuitId: "p-1", gaps: [], top: null,
    byKind: { MISSING: 0, STALE: 0, CONFLICTING: 0, UNVERIFIED: 0, NOT_ESTABLISHED: 0 },
    withheldCount: 0, notEvaluated: [], computedAt: NOW.toISOString(), ...over,
  };
}

const gap = (over: Partial<MissingContextView["gaps"][number]> = {}): MissingContextView["gaps"][number] => ({
  key: "stakeholder:economic_buyer", source: "STAKEHOLDER_COVERAGE", kind: "MISSING",
  text: "No economic buyer identified", whyItMatters: "Nobody can sign without them",
  howToResolve: "Meet the budget holder", refType: "stakeholder_role", refId: "economic_buyer",
  rank: 80, rankReasons: ["missing (+30)", "stakeholder coverage (+30)", "blocks the decision (+20)"],
  ...over,
});

function memory(over: Partial<PursuitMemoryView> = {}): PursuitMemoryView {
  return {
    pursuitId: "p-1", entries: [], totalAvailable: 0, firstOccurredAt: null, lastOccurredAt: null,
    order: "oldest", byMateriality: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    hasAutomatedEntries: false, hasLateRecords: false, ...over,
  };
}

const change = (over: Partial<PursuitMemoryView["entries"][number]> = {}): PursuitMemoryView["entries"][number] => ({
  id: "e-1", changeType: "ROUTE_RECOMMENDATION_CHANGED", entityType: "pursuit", entityId: "p-1",
  reason: "Recommended route changed to partner-led", materiality: "HIGH",
  occurredAt: iso("2026-09-10"), recordedAt: iso("2026-09-10"), recordLagHours: 0, recordedLate: false,
  actor: { type: "SYSTEM", id: null, automated: true }, trigger: { type: "FACT_PROMOTED", id: null },
  provenance: { modelVersion: null, agentRunId: null, modelAttributed: false },
  synthetic: true, beforeState: null, afterState: null, stateWithheld: false, episodeIndex: 0,
  ...over,
});

const whyNowView = (over: Partial<WhyNowView> = {}): WhyNowView => ({
  present: true, businessTrigger: null, technologyCondition: null, timingAnchor: null,
  signalConvergence: null, routeRelevance: null, contradictions: [], unknowns: [],
  renderedSummary: null, asOf: null, lifecycle: [], ...over,
});

function input(over: Partial<PursuitContextInput> = {}): PursuitContextInput {
  return {
    pursuitId: "p-1", accountLabel: "Globex Manufacturing Inc.",
    whyNow: null, evidence: null, memory: null, missingContext: null, contextHealth: null,
    now: NOW, ...over,
  };
}

// --- strong evidence, weak gap ----------------------------------------------

test("brief: strong evidence and a weak gap reads confidently and still names the gap", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({
      businessTrigger: { kind: "trigger", label: "Trigger", present: true, detail: "Licence renewal forces a platform decision", commercialImplication: null, refType: "fact", refId: "f-9" },
    }),
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),
    contextHealth: health({ conclusion: "VERIFIED", overall: 82, band: "very_high" }),
    missingContext: missing({ gaps: [gap({ kind: "UNVERIFIED", text: "Technical buyer is not verified", rank: 48 })] }),
  }));
  assert.equal(v.whyThisMatters.confidence, "WELL_EVIDENCED");
  assert.equal(v.whyThisMatters.clauses[0].text, "Licence renewal forces a platform decision.",
    "canonical wording, terminated as a sentence");
  assert.equal(v.whatWeKnow.confirmed.length, 1);
  assert.equal(v.needsAttention.primary!.state, "NEEDS_VALIDATION");
});

// --- weak direct, strong supporting -----------------------------------------

test("brief: one linked fact and rich account context still produces a useful picture", () => {
  const v = composePursuitContext(input({
    evidence: evidence({
      direct: [directFact()],
      supporting: [
        supportingFact({ factId: "s-1", label: "Globex renewal" }),
        supportingFact({ factId: "s-2", label: "Time-and-motion study", predicateKey: "productivity_impact", inferredRelevance: "SUPPORTING_CONTEXT", pertinence: 52, band: "moderate" }),
        supportingFact({ factId: "s-3", label: "CFO Q3 review", predicateKey: "avoided_cost", inferredRelevance: "SUPPORTING_CONTEXT", pertinence: 51, band: "moderate" }),
        supportingFact({ factId: "s-4", label: "Vendor spend estimate", predicateKey: "infrastructure_cost", inferredRelevance: "SUPPORTING_CONTEXT", pertinence: 47, band: "moderate" }),
      ],
    }),
    contextHealth: health(),
  }));
  // Density budget: four evidence lines by default, the rest counted.
  assert.equal(v.whatWeKnow.confirmed.length + v.whatWeKnow.accountContext.length, 4);
  assert.equal(v.whatWeKnow.confirmed.length, 1);
  assert.equal(v.whatWeKnow.accountContext.length, 3);
  assert.equal(v.whatWeKnow.hiddenCount, 1);
});

test("brief: account context is never crowded out entirely by linked evidence", () => {
  const v = composePursuitContext(input({
    evidence: evidence({
      direct: [directFact({ factId: "d-1" }), directFact({ factId: "d-2" }), directFact({ factId: "d-3" }), directFact({ factId: "d-4" }), directFact({ factId: "d-5" })],
      supporting: [supportingFact()],
    }),
    contextHealth: health(),
  }));
  assert.ok(v.whatWeKnow.accountContext.length >= 1, "on a well-linked pursuit the account still gets a voice");
  assert.ok(v.whatWeKnow.hiddenCount > 0);
});

// --- no direct evidence ------------------------------------------------------

test("brief: no linked evidence does not present account context as confirmed", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [], supporting: [supportingFact()] }),
    contextHealth: health(),
  }));
  assert.equal(v.whatWeKnow.confirmed.length, 0);
  assert.equal(v.whatWeKnow.accountContext.length, 1);
  assert.equal(v.whatWeKnow.accountContext[0].origin, "ACCOUNT");
  assert.ok(v.whatWeKnow.accountContext.every((l) => l.origin !== "PURSUIT"));
});

// --- the four/five-state vocabulary -----------------------------------------

test("brief: every gap kind renders as its own phrase — nothing collapses to 'missing'", () => {
  const kinds = [
    ["MISSING", "NOT_IDENTIFIED", "Not identified yet"],
    ["NOT_ESTABLISHED", "NOT_ESTABLISHED", "Not yet established"],
    ["UNVERIFIED", "NEEDS_VALIDATION", "Needs validation"],
    ["STALE", "OUT_OF_DATE", "Out of date"],
    ["CONFLICTING", "CONFLICTING", "Sources disagree"],
  ] as const;
  const labels = new Set<string>();
  for (const [kind, state, label] of kinds) {
    const v = composePursuitContext(input({
      missingContext: missing({ gaps: [gap({ kind, source: "STAKEHOLDER_COVERAGE" })] }),
      contextHealth: health(),
    }));
    assert.equal(v.needsAttention.primary!.state, state, `${kind} must read as ${state}`);
    assert.equal(CONTEXT_STATE_LABEL[state], label);
    labels.add(label);
  }
  assert.equal(labels.size, 5, "five distinct phrasings, none reused");
  assert.ok(![...labels].some((l) => /^missing/i.test(l)), "no state may render as 'Missing …'");
});

test("brief: fact states are distinguishable too", () => {
  const v = composePursuitContext(input({
    evidence: evidence({
      direct: [
        directFact({ factId: "ok" }),
        directFact({ factId: "disputed", status: "DISPUTED" }),
        directFact({ factId: "stale", status: "STALE" }),
        directFact({ factId: "weak", provenanceClass: "INFERRED" }),
      ],
    }),
    contextHealth: health(),
    // Raised past the default density budget: this test is about state mapping,
    // not about how many lines the default view shows.
    evidenceBudget: 8,
  }));
  const byId = new Map(v.whatWeKnow.confirmed.map((l) => [l.factId, l.state]));
  assert.equal(byId.get("ok"), "VERIFIED");
  assert.equal(byId.get("disputed"), "CONFLICTING");
  assert.equal(byId.get("stale"), "OUT_OF_DATE");
  assert.equal(byId.get("weak"), "NEEDS_VALIDATION");
});

// --- the Globex nuance -------------------------------------------------------

test("brief: account timing does NOT become a claim that pursuit timing is known", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),  // renewal_date, TIMING_ANCHOR
    missingContext: missing({ gaps: [gap({ key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING", text: "No verified timing anchor", rank: 72, whyItMatters: null, howToResolve: null })] }),
    contextHealth: health(),
  }));
  const a = v.needsAttention.primary!;
  // Not "not identified" — the account holds something. Not "verified" either.
  assert.equal(a.state, "NEEDS_VALIDATION");
  assert.equal(a.headline, "No verified timing anchor", "the canonical text is not rewritten");
  assert.ok(a.accountSignal, "the account signal must be stated, not implied");
  assert.match(a.accountSignal!.text, /not yet confirmed for this pursuit/);
  assert.equal(a.accountSignal!.refId, "s-1");
});

test("brief: with no account timing, a timing gap stays 'not identified'", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()] }),
    missingContext: missing({ gaps: [gap({ key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING", text: "No verified timing anchor", rank: 72 })] }),
    contextHealth: health(),
  }));
  assert.equal(v.needsAttention.primary!.state, "NOT_IDENTIFIED");
  assert.equal(v.needsAttention.primary!.accountSignal, null);
});

// --- degraded and conflicting context ---------------------------------------

test("brief: stale context reduces confidence and says why", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ businessTrigger: { kind: "t", label: "T", present: true, detail: "Renewal on the clock", commercialImplication: null } }),
    evidence: evidence({ direct: [directFact({ status: "STALE", freshness: 0.05 })] }),
    contextHealth: health({
      conclusion: "STALE", overall: 38, band: "low",
      concerns: [{ kind: "STALE_FACT", dimension: "freshness", text: "Renewal date has aged past its useful window", refType: "fact", refId: "d-1", weight: 1 }],
    }),
  }));
  assert.equal(v.whyThisMatters.confidence, "THIN");
  assert.equal(v.whyThisMatters.confidenceReason, "Renewal date has aged past its useful window.");
  assert.equal(v.whatWeKnow.confirmed[0].state, "OUT_OF_DATE");
});

test("brief: conflicting context reads as disagreement, not absence", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ businessTrigger: { kind: "t", label: "T", present: true, detail: "Trigger", commercialImplication: null } }),
    contextHealth: health({ conclusion: "CONFLICTING", overall: 44 }),
    missingContext: missing({ gaps: [gap({ kind: "CONFLICTING", source: "WHY_NOW", text: "Two sources disagree on the renewal date" })] }),
  }));
  assert.equal(v.whyThisMatters.confidence, "THIN");
  assert.equal(v.needsAttention.primary!.state, "CONFLICTING");
  assert.equal(CONTEXT_STATE_LABEL[v.needsAttention.primary!.state], "Sources disagree");
});

// --- changes -----------------------------------------------------------------

test("brief: what changed is newest-first by business time and bounded", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "oldest",
      entries: [
        change({ id: "a", occurredAt: iso("2026-09-01"), reason: "Pursuit detected" }),
        change({ id: "b", occurredAt: iso("2026-09-05"), reason: "Team assembled" }),
        change({ id: "c", occurredAt: iso("2026-09-08"), reason: "Route changed" }),
        change({ id: "d", occurredAt: iso("2026-09-10"), reason: "Override recorded", actor: { type: "USER", id: "u-1", automated: false } }),
      ],
      totalAvailable: 4,
    }),
    contextHealth: health(),
  }));
  assert.deepEqual(v.whatChanged.entries.map((e) => e.id), ["d", "c", "b"]);
  assert.equal(v.whatChanged.hiddenCount, 1);
  assert.equal(v.whatChanged.entries[0].byPerson, true, "a human change is distinguishable");
  assert.equal(v.whatChanged.entries[1].byPerson, false);
});

test("brief: no meaningful recent changes says so rather than rendering an empty list", () => {
  const v = composePursuitContext(input({ memory: memory(), contextHealth: health() }));
  assert.deepEqual(v.whatChanged.entries, []);
  assert.deepEqual(v.whatChanged.earlier, []);
  assert.equal(v.whatChanged.hiddenCount, 0);
});

/**
 * GATE C blocker regression.
 *
 * Chunk 6B shipped an "Earlier history (7 more)" disclosure that revealed only a
 * sentence pointing at the activity record — a panel this very surface had
 * absorbed. Seven of the Globex pursuit's ten ledger events, the partner-override
 * chronology among them, were reachable nowhere on the page.
 *
 * The property that broke is not "the disclosure has a child"; it is that the
 * default head plus the disclosed tail together account for EVERY memory entry,
 * exactly once. That is what these assertions pin.
 */
test("context: every memory entry is reachable — head + earlier accounts for all of them", () => {
  // The real Globex ledger shape: 10 rows, mixed materiality, newest four are
  // MEDIUM stakeholder assertions that displace three HIGH events from the head.
  const rows = [
    change({ id: "l10", occurredAt: iso("2026-09-12T03:32:55Z"), changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM", reason: "influencer — inferred" }),
    change({ id: "l09", occurredAt: iso("2026-09-12T03:32:55Z"), changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM", reason: "champion — inferred" }),
    change({ id: "l08", occurredAt: iso("2026-09-12T03:32:55Z"), changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM", reason: "technical buyer — verified", actor: { type: "USER", id: "u-1", automated: false } }),
    change({ id: "l07", occurredAt: iso("2026-09-12T03:32:55Z"), changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM", reason: "champion — verified (supersedes champion — inferred)", actor: { type: "USER", id: "u-1", automated: false } }),
    change({ id: "l06", occurredAt: iso("2026-09-12T03:32:51Z"), changeType: "PARTNER_OVERRIDE", materiality: "HIGH", reason: "Route override (EXECUTIVE_DIRECTION): exec relationship", actor: { type: "USER", id: "u-1", automated: false } }),
    change({ id: "l05", occurredAt: iso("2026-09-12T03:32:51Z"), changeType: "OVERRIDE_RECORDED", materiality: "MEDIUM", reason: "exec relationship", actor: { type: "USER", id: "u-1", automated: false } }),
    change({ id: "l04", occurredAt: iso("2026-09-12T03:32:51Z"), changeType: "TEAM_CHANGED", materiality: "MEDIUM", reason: "Team assembled (5 roles)" }),
    change({ id: "l03", occurredAt: iso("2026-09-12T03:32:51Z"), changeType: "ROUTE_RECOMMENDATION_CHANGED", materiality: "HIGH", reason: "Recommended route → PARTNER_LED (partner)" }),
    change({ id: "l02", occurredAt: iso("2026-09-12T03:32:51Z"), changeType: "FACT_LINKED_TO_PURSUIT", materiality: "LOW", reason: "Linked fact (SOLUTION_FIT)" }),
    change({ id: "l01", occurredAt: iso("2026-09-12T03:32:50Z"), changeType: "PURSUIT_CREATED", materiality: "HIGH", reason: "Pursuit detected (SYSTEM_DETECTED)" }),
  ];
  const v = composePursuitContext(input({
    memory: memory({ order: "newest", entries: rows, totalAvailable: rows.length }),
    contextHealth: health(),
  }));

  const head = v.whatChanged.entries.map((e) => e.id);
  const tail = v.whatChanged.earlier.map((e) => e.id);

  // 1 · The head stays concise.
  assert.equal(head.length, 3, "default history stays short");

  // 2 · The disclosure's count is real, and matches what it will render.
  assert.equal(v.whatChanged.hiddenCount, 7);
  assert.equal(v.whatChanged.earlier.length, 7, "the count and the content agree");

  // 3 · Together they account for every entry, exactly once. This is the blocker.
  assert.deepEqual([...head, ...tail], rows.map((r) => r.id), "all 10 reachable, in order");
  assert.equal(new Set([...head, ...tail]).size, rows.length, "no entry duplicated");

  // 4 · The partner-override chronology is specifically reachable — it is the
  //     demo's section-2 beat, and it was the thing that went missing.
  const override = v.whatChanged.earlier.find((e) => e.id === "l06");
  assert.ok(override, "PARTNER_OVERRIDE must be reachable");
  assert.equal(override!.canonicalReason, "Route override (EXECUTIVE_DIRECTION): exec relationship",
    "the ledger's own reason is preserved verbatim under the rendered title");
  assert.equal(override!.text, "Route overridden by a person", "and stated in product language");
  assert.equal(override!.byPerson, true, "actor semantics preserved in the tail");
  assert.equal(override!.materiality, "HIGH", "materiality preserved in the tail");

  // 5 · Memory is not materiality-filtered (D-006). The LOW linkage event, which
  //     `getPursuitTimeline` deliberately drops, must still be present here.
  assert.ok([...head, ...tail].includes("l02"), "a LOW-materiality event is still remembered");
});

test("context: earlier history is empty when everything already fits", () => {
  const v = composePursuitContext(input({
    memory: memory({ order: "newest", entries: [change({ id: "a" }), change({ id: "b" })], totalAvailable: 2 }),
    contextHealth: health(),
  }));
  assert.deepEqual(v.whatChanged.entries.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(v.whatChanged.earlier, [], "no disclosure when there is nothing behind it");
  assert.equal(v.whatChanged.hiddenCount, 0);
});

test("context: earlier history honours business-time order when memory reads oldest-first", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "oldest",
      entries: [
        change({ id: "a", occurredAt: iso("2026-09-01") }),
        change({ id: "b", occurredAt: iso("2026-09-05") }),
        change({ id: "c", occurredAt: iso("2026-09-08") }),
        change({ id: "d", occurredAt: iso("2026-09-10") }),
        change({ id: "e", occurredAt: iso("2026-09-11") }),
      ],
      totalAvailable: 5,
    }),
    contextHealth: health(),
  }));
  assert.deepEqual(v.whatChanged.entries.map((e) => e.id), ["e", "d", "c"], "newest first");
  assert.deepEqual(v.whatChanged.earlier.map((e) => e.id), ["b", "a"], "tail continues newest-first");
});

// --- absent inputs -----------------------------------------------------------

test("brief: unavailable inputs degrade honestly, with no invented content", () => {
  const v = composePursuitContext(input());
  assert.deepEqual(v.whyThisMatters.clauses, []);
  assert.equal(v.whyThisMatters.confidence, "NOT_ESTABLISHED");
  assert.equal(v.whyThisMatters.confidenceReason, null);
  assert.deepEqual(v.whatWeKnow.confirmed, []);
  assert.deepEqual(v.whatWeKnow.accountContext, []);
  assert.deepEqual(v.whatChanged.entries, []);
  assert.equal(v.needsAttention.primary, null);
  assert.equal(v.needsAttention.otherCount, 0);
});

test("brief: evidence without a why-now falls back to canonical evidence text, not prose", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact({ label: "Modernisation programme underway" })] }),
    contextHealth: health({ conclusion: "INFERRED" }),
  }));
  assert.equal(v.whyThisMatters.clauses.length, 1);
  assert.equal(v.whyThisMatters.clauses[0].text, "Modernisation programme underway.");
  assert.equal(v.whyThisMatters.clauses[0].refType, "fact");
  assert.equal(v.whyThisMatters.confidence, "PARTLY_EVIDENCED");
});

// --- disclosure --------------------------------------------------------------

test("brief: a disclosure-limited caller's evidence view produces a smaller brief, not a leaky one", () => {
  // The evidence layer already filtered; the brief must not reintroduce anything.
  const full = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact(), supportingFact({ factId: "s-2", label: "$1.84M category activity" })] }),
    contextHealth: health(),
  }));
  const limited = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()], excludedSummary: { accountFactsConsidered: 3, direct: 1, supporting: 1, rejected: 0, unauthorized: 1, belowBand: 0, beyondLimit: 0 } }),
    contextHealth: health(),
  }));
  assert.ok(limited.whatWeKnow.accountContext.length < full.whatWeKnow.accountContext.length);
  assert.ok(!JSON.stringify(limited).includes("1.84M"));
});

// --- integrity ---------------------------------------------------------------

test("brief: deterministic and non-mutating", () => {
  const ev = evidence({ direct: [directFact()], supporting: [supportingFact()] });
  const mem = memory({ entries: [change()], totalAvailable: 1, order: "oldest" });
  const i = input({ evidence: ev, memory: mem, contextHealth: health(), missingContext: missing({ gaps: [gap()] }) });
  const snapshot = JSON.stringify({ ev, mem });

  const a = composePursuitContext(i);
  const b = composePursuitContext(i);
  assert.deepEqual(a, b, "same inputs, same output");
  assert.equal(JSON.stringify({ ev, mem }), snapshot, "inputs untouched");
});

test("brief: no architecture vocabulary reaches the composed copy", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),
    memory: memory({ entries: [change()], totalAvailable: 1 }),
    missingContext: missing({ gaps: [gap({ source: "WHY_NOW", kind: "MISSING", text: "No verified timing anchor" })] }),
    contextHealth: health(),
  }));
  // The view-model's own strings — not upstream canonical text, which is the
  // domain's to word — must avoid internal vocabulary.
  const composed = [
    ...Object.values(CONTEXT_STATE_LABEL),
    v.needsAttention.primary?.accountSignal?.text ?? "",
  ].join(" | ");
  for (const banned of ["pursuit_facts", "pertinence", "inferred, not linked", "context health engine", "read-model"]) {
    assert.ok(!composed.toLowerCase().includes(banned), `"${banned}" must not reach a user`);
  }
});

test("context: the timing note surfaces even when timing is not the top gap", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),  // account renewal_date
    missingContext: missing({
      gaps: [
        gap({ rank: 80 }),  // economic buyer outranks timing, as on Globex
        gap({ key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING", text: "No verified timing anchor", rank: 72 }),
      ],
    }),
    contextHealth: health(),
  }));
  assert.equal(v.needsAttention.primary!.headline, "No economic buyer identified");
  assert.equal(v.needsAttention.primary!.accountSignal, null, "the primary is not a timing gap");
  assert.ok(v.needsAttention.timingNote, "but the timing nuance must still be said");
  assert.match(v.needsAttention.timingNote!.text, /not yet confirmed for this pursuit/);
});

test("context: no timing note when the account holds no timing", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()] }),
    missingContext: missing({ gaps: [gap({ key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING", text: "No verified timing anchor" })] }),
    contextHealth: health(),
  }));
  assert.equal(v.needsAttention.timingNote, null);
});

test("context: no timing note when the pursuit has no timing question", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),
    missingContext: missing({ gaps: [gap()] }),
    contextHealth: health(),
  }));
  assert.equal(v.needsAttention.timingNote, null, "nothing to caveat if timing is not in question");
});

// =============================================================================
// GATE C refinement — deterministic product copy, scope-aware state, and a
// "needs attention" drawer that actually opens.
// =============================================================================

// --- why it matters: copy ----------------------------------------------------

test("copy: signal convergence is counted with the right plural, not '1 independent families'", () => {
  const one = composePursuitContext(input({
    whyNow: whyNowView({ signalConvergence: { kind: "signal_convergence", label: "Signal Convergence", present: true, detail: "1 independent families", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(one.whyThisMatters.clauses[0].text, "Corroborated by one independent signal family.");

  const many = composePursuitContext(input({
    whyNow: whyNowView({ signalConvergence: { kind: "signal_convergence", label: "Signal Convergence", present: true, detail: "3 independent families", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(many.whyThisMatters.clauses[0].text, "Corroborated by 3 independent signal families.");

  const none = composePursuitContext(input({
    whyNow: whyNowView({ signalConvergence: { kind: "signal_convergence", label: "Signal Convergence", present: true, detail: "0 independent families", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(none.whyThisMatters.clauses[0].text, "No independent corroboration yet.");
});

test("copy: an unparseable convergence detail falls back to canonical text, not to silence", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ signalConvergence: { kind: "signal_convergence", label: "Signal Convergence", present: true, detail: "several families", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(v.whyThisMatters.clauses[0].text, "Several families.", "degrades to the source string");
});

test("copy: route relevance reads as a sentence, not a semicolon-joined label list", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ routeRelevance: { kind: "route_relevance", label: "Route Relevance", present: true, detail: "Relevant delivery capability; Existing customer relationship", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(
    v.whyThisMatters.clauses[0].text,
    "Relevant delivery capability and existing customer relationship.",
  );
});

test("copy: a single route-relevance label needs no conjunction", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ routeRelevance: { kind: "route_relevance", label: "Route Relevance", present: true, detail: "Relevant delivery capability", commercialImplication: null } }),
    contextHealth: health(),
  }));
  assert.equal(v.whyThisMatters.clauses[0].text, "Relevant delivery capability.");
});

test("copy: a missing-coverage concern reads as a research task", () => {
  const v = composePursuitContext(input({
    whyNow: whyNowView({ businessTrigger: { kind: "trigger", label: "T", present: true, detail: "A window exists", commercialImplication: null } }),
    contextHealth: health({
      concerns: [{ kind: "MISSING_COVERAGE", dimension: "coverage", text: "No identity context researched yet", refType: "coverage_category", refId: "identity", weight: 0.6 }],
    }),
  }));
  assert.equal(v.whyThisMatters.confidenceReason, "Identity context still needs research.");
});

// --- what changed: copy ------------------------------------------------------

test("copy: stakeholder assertions read as events, with the canonical state preserved", () => {
  const rows = [
    change({
      id: "c1", changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM",
      reason: "champion — verified (supersedes champion — inferred)",
      actor: { type: "USER", id: "u-1", automated: false },
      afterState: { role: "champion", assertion_state: "verified" },
      beforeState: { role: "champion", assertion_state: "inferred" },
    }),
    change({
      id: "c2", changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM",
      reason: "technical buyer — verified",
      actor: { type: "USER", id: "u-1", automated: false },
      afterState: { role: "technical_buyer", assertion_state: "verified" },
    }),
    change({
      id: "c3", changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM",
      reason: "influencer — inferred",
      afterState: { role: "influencer", assertion_state: "inferred" },
    }),
  ];
  const v = composePursuitContext(input({
    memory: memory({ order: "newest", entries: rows, totalAvailable: 3 }),
    contextHealth: health(),
  }));
  const [a, b, c] = v.whatChanged.entries;

  assert.equal(a.text, "Champion confirmed");
  assert.equal(a.meta, "Previously inferred · Sep 10", "a confirmation that replaced a machine reading says so");
  assert.equal(b.text, "Technical buyer confirmed");
  assert.equal(b.meta, "Sep 10", "nothing to qualify");
  assert.equal(c.text, "Influencer identified");
  assert.equal(c.meta, "Needs validation · Sep 10", "an inferred role must not read as confirmed");

  // The audit string is preserved underneath every rendered line.
  assert.equal(a.canonicalReason, "champion — verified (supersedes champion — inferred)");
  assert.equal(c.canonicalReason, "influencer — inferred");
});

test("copy: a route override is attributed to a person and keeps its category", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "newest",
      entries: [change({
        id: "o1", changeType: "PARTNER_OVERRIDE", materiality: "HIGH",
        reason: "Route override (EXECUTIVE_DIRECTION): exec relationship",
        actor: { type: "USER", id: "u-1", automated: false },
        afterState: { category: "EXECUTIVE_DIRECTION", selectedPartnerId: "p-9" },
      })],
      totalAvailable: 1,
    }),
    contextHealth: health(),
  }));
  assert.equal(v.whatChanged.entries[0].text, "Route overridden by a person");
  assert.equal(v.whatChanged.entries[0].meta, "Executive direction · Sep 10");
  assert.equal(v.whatChanged.entries[0].byPerson, true);
});

test("copy: a withheld state payload degrades to the canonical reason, never to a guess", () => {
  // What `buildPursuitMemory` hands a caller without internal visibility.
  const v = composePursuitContext(input({
    memory: memory({
      order: "newest",
      entries: [change({
        id: "g1", changeType: "STAKEHOLDER_ROLE_ASSERTED", materiality: "MEDIUM",
        reason: "champion — verified", afterState: null, beforeState: null, stateWithheld: true,
      })],
      totalAvailable: 1,
    }),
    contextHealth: health(),
  }));
  assert.equal(v.whatChanged.entries[0].text, "Champion — verified",
    "the audit string, tidied — no role or state invented from nothing");
  assert.equal(v.whatChanged.entries[0].canonicalReason, "champion — verified");
});

test("copy: an unmapped change type keeps its canonical reason", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "newest",
      entries: [change({ id: "t1", changeType: "TEAM_CHANGED", reason: "Team assembled (5 roles)" })],
      totalAvailable: 1,
    }),
    contextHealth: health(),
  }));
  assert.equal(v.whatChanged.entries[0].text, "Team assembled (5 roles)");
});

test("copy: dates carry the year only once it stops being obvious", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "newest",
      entries: [
        change({ id: "n1", occurredAt: iso("2026-09-10") }),
        change({ id: "n2", occurredAt: iso("2025-11-27") }),
      ],
      totalAvailable: 2,
    }),
    contextHealth: health(),
  }));
  assert.equal(v.whatChanged.entries[0].meta, "Sep 10", "same year as `now`");
  assert.equal(v.whatChanged.entries[1].meta, "Nov 27, 2025", "an older year is stated");
});

// --- direct vs supporting: scope-aware state --------------------------------

test("state: a supporting account fact is never labelled simply 'Verified'", () => {
  const v = composePursuitContext(input({
    evidence: evidence({ direct: [directFact()], supporting: [supportingFact()] }),
    contextHealth: health(),
  }));
  const direct = v.whatWeKnow.confirmed[0];
  const account = v.whatWeKnow.accountContext[0];

  // Same underlying state; different scope; different words.
  assert.equal(direct.state, "VERIFIED");
  assert.equal(direct.stateLabel, "Verified");
  assert.equal(account.state, "VERIFIED", "the canonical state is NOT altered");
  assert.equal(account.stateLabel, "Verified on account",
    "a chip on an account row must not read as verified for the pursuit");
  assert.equal(account.origin, "ACCOUNT");
});

test("state: degraded account states are not given a redundant scope suffix", () => {
  const v = composePursuitContext(input({
    evidence: evidence({
      supporting: [
        supportingFact({ factId: "s-a", status: "DISPUTED" }),
        supportingFact({ factId: "s-b", provenanceClass: "INFERRED" }),
        supportingFact({ factId: "s-c", freshness: 0.02 }),
      ],
    }),
    contextHealth: health(),
  }));
  const labels = v.whatWeKnow.accountContext.map((l) => l.stateLabel);
  assert.deepEqual(labels, ["Sources disagree", "Needs validation", "Out of date"],
    "these already say the claim is not to be relied on");
});

// --- needs attention: a drawer that opens ------------------------------------

test("attention: one primary is visible and the rest are carried, ranked, for disclosure", () => {
  const gaps = [
    gap({ key: "g1", text: "No economic buyer identified", rank: 80, kind: "MISSING" }),
    gap({ key: "g2", source: "WHY_NOW", text: "No verified timing anchor", rank: 72, kind: "MISSING" }),
    gap({ key: "g3", source: "MEDDPICC", text: "Decision process not established", rank: 62, kind: "NOT_ESTABLISHED" }),
    gap({ key: "g4", source: "MEDDPICC", text: "Paper process is unverified", rank: 58, kind: "UNVERIFIED" }),
    gap({ key: "g5", source: "VALUE_CASE", text: "Value drivers disagree", rank: 50, kind: "CONFLICTING" }),
    gap({ key: "g6", source: "CONTEXT_HEALTH", text: "Renewal date has aged", rank: 40, kind: "STALE" }),
  ];
  const v = composePursuitContext(input({ missingContext: missing({ gaps }), contextHealth: health() }));

  assert.equal(v.needsAttention.primary!.headline, "No economic buyer identified");
  assert.equal(v.needsAttention.otherCount, 5);
  assert.equal(v.needsAttention.others.length, 5, "the count and the content agree");
  assert.deepEqual(
    v.needsAttention.others.map((o) => o.headline),
    gaps.slice(1).map((g) => g.text),
    "Missing Context's ranking is preserved, not re-sorted",
  );

  // Every state survives into the drawer. Flattening these to "missing" is the
  // specific failure the five-state vocabulary exists to prevent.
  assert.deepEqual(
    v.needsAttention.others.map((o) => o.stateLabel),
    ["Not identified yet", "Not yet established", "Needs validation", "Sources disagree", "Out of date"],
  );
});

test("attention: no drawer when the primary is the only open item", () => {
  const v = composePursuitContext(input({ missingContext: missing({ gaps: [gap()] }), contextHealth: health() }));
  assert.equal(v.needsAttention.otherCount, 0);
  assert.deepEqual(v.needsAttention.others, []);
});

test("attention: the primary carries its own chosen label", () => {
  const v = composePursuitContext(input({
    missingContext: missing({ gaps: [gap({ kind: "CONFLICTING", text: "Value drivers disagree" })] }),
    contextHealth: health(),
  }));
  assert.equal(v.needsAttention.primary!.stateLabel, "Sources disagree");
});

test("copy: override rationale and fact linkage read as events, not as payloads", () => {
  const v = composePursuitContext(input({
    memory: memory({
      order: "newest",
      entries: [
        change({
          id: "r1", changeType: "OVERRIDE_RECORDED", materiality: "MEDIUM", reason: "exec relationship",
          actor: { type: "USER", id: "u-1", automated: false },
        }),
        change({
          id: "r2", changeType: "FACT_LINKED_TO_PURSUIT", materiality: "LOW", reason: "Linked fact (SOLUTION_FIT)",
          afterState: { factId: "f-1", relevance: "SOLUTION_FIT" },
        }),
      ],
      totalAvailable: 2,
    }),
    contextHealth: health(),
  }));
  assert.equal(v.whatChanged.entries[0].text, "Override rationale recorded");
  assert.equal(v.whatChanged.entries[0].meta, "exec relationship · Sep 10");
  assert.equal(v.whatChanged.entries[1].text, "Evidence linked to this pursuit");
  assert.equal(v.whatChanged.entries[1].meta, "Solution fit · Sep 10");
  // Still traceable to the ledger.
  assert.equal(v.whatChanged.entries[1].canonicalReason, "Linked fact (SOLUTION_FIT)");
});
