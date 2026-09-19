import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze } from "../src/lib/experience/analyze";
import { IncompleteCohort, isCompleteCohort, sealCompleteCohort } from "../src/lib/experience/cohort";
import { PLANS } from "../src/lib/experience/plans";
import type { GovernedCell, GovernedResultSet, GovernedRow, PursuitQuery } from "../src/lib/experience/types";

/**
 * D-P7-COHORT-COMPLETENESS — THE TYPE BOUNDARY, AND THE CONTROLS THAT PROVE IT BITES.
 *
 * > A presentation/cardinality limit may constrain returned rows; it may never silently constrain
 * > the aggregate's semantic member set.
 *
 * The defect was not that the wrong number came out. It was that MEMBERSHIP had two definitions —
 * the governed cohort and the page of rows a renderer receives — and the aggregate read the second.
 * So these tests do not check arithmetic; they check that the second thing can no longer be handed
 * to the aggregate at all: by type, by identity, and by validation against the candidate set.
 */

const AGG = { id: "cohort.open_pipeline_usd", version: 1 };
const OVER = "pursuit.open_pipeline_usd@1";
const PLAN: PursuitQuery = structuredClone(PLANS["open-pipeline-cohort"].plan);
const EXEC = readFileSync(new URL("../src/lib/experience/execute.ts", import.meta.url), "utf8");
const CODE = EXEC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const cell = (value: number): GovernedCell =>
  ({ visibility: "EXACT", value, provenance: OVER, existence: "AUTHORIZED" });
const suppressed = (): GovernedCell =>
  ({ visibility: "SUPPRESSED", value: null, provenance: OVER, reason: "DERIVATION_DENIED", existence: "AUTHORIZED" });
const member = (n: number, c: GovernedCell = cell(1000)): GovernedRow =>
  ({ objectRef: { class: "pursuit", id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` }, cells: { [OVER]: c } });

const seal = (rows: GovernedRow[], candidateIds = rows.map((r) => r.objectRef.id)) =>
  sealCompleteCohort({ plan: PLAN, candidateIds, members: rows, computedAt: "2026-09-19 00:00:00.000001+00" });

// ── the seal admits a completed pass, and nothing else ──────────────────────────────────────────

test("a completed governance pass over its own candidate set seals", () => {
  const rows = [member(1), member(2), member(3)];
  const cohort = seal(rows);
  assert.ok(isCompleteCohort(cohort));
  assert.equal(cohort.members.length, 3);
  const r = analyze(cohort, AGG.id, AGG.version);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.result.basis, { members: 3 });
});

test("NEGATIVE CONTROL: a SLICED cohort is refused — it is missing candidates it claims to cover", () => {
  const rows = [member(1), member(2), member(3)];
  const candidateIds = rows.map((r) => r.objectRef.id);
  assert.throws(() => seal(rows.slice(0, 2), candidateIds), IncompleteCohort);
  // …and the refusal names the shortfall rather than failing vaguely.
  try {
    seal(rows.slice(0, 2), candidateIds);
    assert.fail("a slice must not seal");
  } catch (err) {
    assert.match(String(err), /2 governed members for 3 candidates/);
  }
});

test("NEGATIVE CONTROL: a member set that swaps a candidate for another is refused", () => {
  const candidateIds = [member(1), member(2)].map((r) => r.objectRef.id);
  assert.throws(() => seal([member(1), member(9)], candidateIds), /candidate .* was never governed/);
});

test("NEGATIVE CONTROL: the same candidate governed twice is refused", () => {
  const candidateIds = [member(1), member(2)].map((r) => r.objectRef.id);
  assert.throws(() => seal([member(1), member(1)], candidateIds), /governed more than once/);
});

test("NEGATIVE CONTROL: an ordinary GovernedResultSet is not membership", () => {
  const resultSet: GovernedResultSet = {
    plan: PLAN,
    planDigest: "aaaabbbbccccdddd",
    computedAt: "2026-09-19 00:00:00.000001+00",
    rows: [member(1), member(2)],
    omissions: [],
    counts: { authorized: 2 },
  };
  assert.equal(isCompleteCohort(resultSet), false);
  // `analyze()` does not accept it at the type level; at runtime it refuses rather than aggregating.
  assert.throws(() => analyze(resultSet as never, AGG.id, AGG.version), IncompleteCohort);
});

test("NEGATIVE CONTROL: a hand-assembled member collection is not membership", () => {
  for (const forged of [
    { plan: PLAN, members: [member(1)], computedAt: "x" },
    { members: [member(1)] },
    [member(1)],
    null,
    undefined,
  ]) {
    assert.equal(isCompleteCohort(forged), false);
    assert.throws(() => analyze(forged as never, AGG.id, AGG.version), IncompleteCohort);
  }
});

test("NEGATIVE CONTROL: a sealed cohort cannot be SPREAD into a truncated one", () => {
  // Object spread copies symbol-keyed properties, so the brand alone would travel with the clone.
  // Identity does not: the copy was never sealed, and the aggregate refuses it.
  const cohort = seal([member(1), member(2), member(3)]);
  const forged = { ...cohort, members: cohort.members.slice(0, 1) };
  assert.equal(isCompleteCohort(forged), false);
  assert.throws(() => analyze(forged as never, AGG.id, AGG.version), IncompleteCohort);
});

test("the sealed membership is frozen, so it cannot be trimmed after the fact", () => {
  const cohort = seal([member(1), member(2)]);
  assert.throws(() => (cohort.members as GovernedRow[]).pop());
  assert.equal(cohort.members.length, 2);
});

// ── withhold-whole can no longer be defeated by position ────────────────────────────────────────

test("a non-disclosable member withholds the whole aggregate wherever it sits in the order", () => {
  // The hosted discovery pushed exactly such a member out of the 200-row slice with newer rows and
  // watched WITHHELD become DISCLOSED. Position is now irrelevant: membership is the whole cohort.
  const many = Array.from({ length: 250 }, (_, i) => member(i + 1));
  for (const at of [0, 199, 200, 249]) {
    const rows = [...many];
    rows[at] = member(at + 1, suppressed());
    const r = analyze(seal(rows), AGG.id, AGG.version);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.result.visibility, "WITHHELD", `a suppressed member at index ${at} must withhold`);
      assert.equal(r.result.value, null);
      assert.equal(r.result.basis, undefined, "no basis beside a withheld value");
    }
  }
});

test("basis.members counts the whole governed cohort, past any presentation limit", () => {
  const rows = Array.from({ length: 212 }, (_, i) => member(i + 1));
  const r = analyze(seal(rows), AGG.id, AGG.version);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.result.basis, { members: 212 }, "212, not the plan's limit of 200");
    assert.equal(r.result.value, 212 * 1000);
  }
  assert.equal(PLAN.limit, 200, "the fixture is only meaningful while the plan limit is smaller");
});

// ── the executor's own structure: membership is sealed BEFORE presentation ──────────────────────

test("execute.ts seals the cohort before it orders or slices anything", () => {
  const sealAt = CODE.indexOf("sealCompleteCohort(");
  const orderAt = CODE.indexOf("orderRows(rows, plan)");
  const sliceAt = CODE.indexOf("rows.slice(0, plan.limit)");
  const analyzeAt = CODE.indexOf("analyze(");
  for (const [name, at] of [["seal", sealAt], ["order", orderAt], ["slice", sliceAt], ["analyze", analyzeAt]] as const) {
    assert.ok(at > 0, `${name} must be present — this guard is vacuous otherwise`);
  }
  assert.ok(sealAt < orderAt, "the cohort is sealed before ordering");
  assert.ok(sealAt < sliceAt, "the cohort is sealed before the limit is applied");
  assert.equal([...CODE.matchAll(/sealCompleteCohort\(/g)].length, 1, "exactly one place seals membership");
});

test("the aggregate is given the cohort, never the presented rows", () => {
  assert.match(CODE, /analyze\(cohort,/);
  assert.ok(!/analyze\(\s*resultSet/.test(CODE), "the result set is not membership");
  assert.ok(!/analyze\(\s*limited/.test(CODE), "the presented page is not membership");
  // And the seal is fed the CANDIDATES, not the page: the evidence is the pre-limit set.
  assert.match(CODE, /candidateIds:\s*candidates\.map\(/);
});

test("presentation keeps its limit — this correction separates the two, it does not delete one", () => {
  assert.match(CODE, /rows:\s*limited/);
  assert.match(CODE, /counts:\s*\{\s*authorized:\s*limited\.length\s*\}/);
  assert.equal(PLANS["open-by-value"].plan.limit, 50, "presentation limits are untouched");
  assert.equal(PLAN.limit, 200);
});
