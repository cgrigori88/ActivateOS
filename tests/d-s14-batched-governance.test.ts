import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decideDerivation, type DerivationFacts, type DerivationGrant } from "../src/lib/pursuits/federation/derivation";

/**
 * D-S14-EXECUTION-BOUND (total-work half) — ONE DECISION, TWO FACT LOADERS.
 *
 * > Batching changes how facts are fetched, never how authority or disclosure is decided.
 *
 * The governed read acquired its facts one member at a time, so the statement graph grew with the
 * cohort. Bounding it could have been done by writing the rules again in SQL; that was rejected,
 * because two rule engines then have to be proven equivalent forever. Instead the DECISION was
 * extracted as a pure core and both loaders — the one-row `mayDerive` and the cohort loader — hand
 * it facts. These tests hold that boundary: the core decides everything, the loaders decide nothing.
 */

const SRC = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const EXECUTE = strip(SRC("lib/experience/execute.ts"));
const FACTS = strip(SRC("lib/pursuits/federation/batch-facts.ts"));
const DERIVATION = strip(SRC("lib/pursuits/federation/derivation.ts"));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const PURSUIT = "33333333-3333-4333-8333-333333333333";
const input = { inputKind: "economic_fact", sourceOrgId: SOURCE, pursuitId: PURSUIT };
const grant = (over: Partial<DerivationGrant> = {}): DerivationGrant =>
  ({ id: "g1", purpose_code: "VALUE_CASE", retention_class: "RETAINED", scope: {}, ...over });
const facts = (over: Partial<DerivationFacts> = {}): DerivationFacts =>
  ({ effectiveParticipant: true, grants: [grant()], pursuitLive: true, ...over });
const decide = (f: DerivationFacts, purpose = "VALUE_CASE", inp = input) => decideDerivation(VIEWER, inp, purpose, f);

// ── the decision core, on facts alone ───────────────────────────────────────────────────────────

test("an organization derives from its OWN information without a grant, and without facts", () => {
  const d = decide(facts({ effectiveParticipant: false, grants: [], pursuitLive: false }),
    "VALUE_CASE", { ...input, sourceOrgId: VIEWER });
  assert.equal(d.allow, true);
  if (d.allow) assert.equal(d.grantId, "self");
});

test("a crossing needs EFFECTIVE participation", () => {
  const d = decide(facts({ effectiveParticipant: false }));
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /not an effective participant/);
});

test("a crossing needs a live machine-governed grant", () => {
  const d = decide(facts({ grants: [] }));
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /no live machine-governed DATA grant/);
});

test("PURSUIT_LIFETIME authority ends with the pursuit", () => {
  const live = decide(facts({ grants: [grant({ retention_class: "PURSUIT_LIFETIME" })], pursuitLive: true }));
  assert.equal(live.allow, true);
  const dead = decide(facts({ grants: [grant({ retention_class: "PURSUIT_LIFETIME" })], pursuitLive: false }));
  assert.equal(dead.allow, false);
  if (!dead.allow) assert.match(dead.reason, /PURSUIT_LIFETIME authority ended/);
});

test("a RETAINED grant does not consult pursuit liveness at all", () => {
  const d = decide(facts({ grants: [grant({ retention_class: "RETAINED" })], pursuitLive: false }));
  assert.equal(d.allow, true);
});

test("an unknown retention class denies", () => {
  const d = decide(facts({ grants: [grant({ retention_class: "FOREVER" })] }));
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /unknown retention class FOREVER/);
});

test("scope.keys can only NARROW, and a narrowed grant that excludes this input denies", () => {
  const d = decide(facts({ grants: [grant({ scope: { keys: ["timing"] } })] }));
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /scope\.keys narrows this grant/);
  // An empty scope means the whole pursuit, and a list that includes the input still permits it.
  assert.equal(decide(facts({ grants: [grant({ scope: {} })] })).allow, true);
  assert.equal(decide(facts({ grants: [grant({ scope: { keys: ["economic_fact"] } })] })).allow, true);
});

test("an operation that is not a derivation purpose denies, however complete the grant", () => {
  const d = decide(facts(), "CO_SELL_CONTEXT_DISPLAY");
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /is not a derivation purpose/);
});

test("an input kind with no information-class mapping denies", () => {
  const d = decide(facts(), "VALUE_CASE", { ...input, inputKind: "made_up_kind" });
  assert.equal(d.allow, false);
  if (!d.allow) assert.match(d.reason, /no information-class mapping/);
});

test("CHANGE RECORDED: with several qualifying grants, a narrower one no longer denies by being first", () => {
  // The one-row loader used `limit 1` with no ordering, so which grant it saw was arbitrary — and
  // the pick can matter, because grants differ in retention and scope. The core now considers every
  // qualifying grant and allows if any permits, which is what "a live grant covers this" means.
  const narrow = grant({ id: "a-narrow", scope: { keys: ["timing"] } });
  const permitting = grant({ id: "b-permits", scope: {} });
  assert.equal(decide(facts({ grants: [narrow, permitting] })).allow, true);
  assert.equal(decide(facts({ grants: [permitting, narrow] })).allow, true);
  // …and a set in which NONE qualifies still denies, with the last reason preserved.
  const denied = decide(facts({ grants: [narrow, grant({ id: "c", scope: { keys: ["other"] } })] }));
  assert.equal(denied.allow, false);
});

// ── the boundary: loaders load, the core decides ────────────────────────────────────────────────

test("the cohort fact loader contains no rule of its own", () => {
  for (const forbidden of ["DERIVATION_PURPOSES", "RETENTION_CLASSES", "SAFE_DECLASSIFICATION",
                           "decideDerivation", "resolveDisclosure", "isSponsor ||", "allow: true"]) {
    assert.ok(!FACTS.includes(forbidden), `the fact loader must not contain ${forbidden}`);
  }
  // It reads the SAME predicates the one-row loaders read, at the same instant.
  for (const predicate of ["participation_state = 'ACTIVE'", "effective_from <= coalesce",
                           "effective_to   >  coalesce", "grant_kind = 'DATA' and status = 'accepted'",
                           "purpose_code is not null", "governed_information_classes is not null"]) {
    assert.ok(FACTS.includes(predicate), `the batched predicate must keep ${predicate}`);
    assert.ok(DERIVATION.includes(predicate) || predicate.startsWith("participation_state"),
      `the one-row predicate must keep ${predicate}`);
  }
});

test("there is exactly ONE implementation of the derivation rules", () => {
  assert.equal([...DERIVATION.matchAll(/export function decideDerivation/g)].length, 1);
  // `mayDerive` is a fact loader over that core — it decides nothing itself.
  const mayDerive = DERIVATION.slice(DERIVATION.indexOf("export async function mayDerive"));
  assert.ok(mayDerive.includes("return decideDerivation("), "mayDerive delegates to the core");
  for (const rule of ["DERIVATION_PURPOSES.has", "RETENTION_CLASSES.has", "scope.keys", "allow: true"]) {
    assert.ok(!mayDerive.includes(rule), `mayDerive must not re-implement ${rule}`);
  }
});

test("no SQL policy engine was introduced — the rules stay in one place", () => {
  for (const body of [FACTS, EXECUTE]) {
    assert.ok(!/create (or replace )?function/i.test(body));
    assert.ok(!/may_derive\(/i.test(body), "no SQL derivation function is called");
  }
});

// ── the graph is bounded: nothing per member reaches the database ───────────────────────────────

test("the per-member governance loop issues no database statement", () => {
  const loop = EXECUTE.slice(EXECUTE.indexOf("for (const row of candidates)"), EXECUTE.indexOf("rows.push("));
  assert.ok(loop.length > 100, "the loop must be found — this guard is vacuous otherwise");
  for (const forbidden of ["await", "db.query", "getPool", "mayDerive(", "buildFederationViewer("]) {
    assert.ok(!loop.includes(forbidden), `the per-member loop must not contain ${forbidden}`);
  }
});

test("each cohort loader is called once per request, outside the member loop", () => {
  // Call sites only — `loadMetricInputs` is also DEFINED in this file, and a declaration is not a
  // round trip. Counting both was this guard's own first mistake.
  for (const loader of ["loadCohortViewers", "loadMetricInputs", "loadCohortDerivationFacts"]) {
    assert.equal([...EXECUTE.matchAll(new RegExp(`await ${loader}\\(`, "g"))].length, 1,
      `${loader} must be awaited exactly once per request`);
  }
  // Per-metric loaders sit in the metric loop, which the registry closes — never in the row loop.
  const rowLoop = EXECUTE.indexOf("for (const row of candidates)");
  assert.ok(EXECUTE.indexOf("await loadCohortViewers(") < rowLoop);
  assert.ok(EXECUTE.indexOf("await loadCohortDerivationFacts(") < rowLoop);
  assert.ok(EXECUTE.indexOf("await loadMetricInputs(") < rowLoop);
});

test("pursuit liveness rides the candidate row rather than a per-member re-read", () => {
  assert.match(EXECUTE, /__live/);
  assert.match(EXECUTE, /status not in \('WON','LOST','DISQUALIFIED'\) and p\.merged_into_pursuit_id is null/);
});
