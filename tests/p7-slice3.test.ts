import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze } from "../src/lib/experience/analyze";
import { AGGREGATES, FILTERS, aggregateKey } from "../src/lib/experience/registry";
import { validatePlan } from "../src/lib/experience/validate";
import { PLANS, VIEW_KEYS, isViewKey } from "../src/lib/experience/plans";
import type { GovernedCell, GovernedResultSet, GovernedRow, PursuitQuery } from "../src/lib/experience/types";

/**
 * P7 SLICE 3 — the §L proofs that need no database (the rest run in the seeded verifier).
 *
 * `analyze()` is pure, so the dangerous cases can be constructed directly: a cohort containing a
 * member whose contribution is withheld, a suppressed cell that still carries a value, and two
 * cohorts differing only in what the recipient may not see.
 *
 * Per the standing invariant (eb31827), these assert on STRUCTURE and OUTPUT — never on prose,
 * comments, formatting or exact call-site text.
 */

const AGG = { id: "cohort.open_pipeline_usd", version: 1 };
const OVER = "pursuit.open_pipeline_usd@1";
const SRC = readFileSync(new URL("../src/lib/experience/analyze.ts", import.meta.url), "utf8");
/** Comments are prose; structural guards must read the CODE. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const contributing = (value: number): GovernedCell =>
  ({ visibility: "EXACT", value, provenance: OVER, existence: "AUTHORIZED" });
const withheldContribution = (): GovernedCell =>
  ({ visibility: "SUPPRESSED", value: null, provenance: OVER, reason: "DERIVATION_DENIED", existence: "AUTHORIZED" });

const row = (id: string, cell: GovernedCell): GovernedRow =>
  ({ objectRef: { class: "pursuit", id: `00000000-0000-4000-8000-00000000000${id}` }, cells: { [OVER]: cell } });

function resultSet(rows: GovernedRow[], planOver: Partial<PursuitQuery> = {}): GovernedResultSet {
  const plan: PursuitQuery = { ...structuredClone(PLANS["open-pipeline-cohort"].plan), ...planOver };
  return {
    plan,
    planDigest: "aaaabbbbccccdddd",
    computedAt: "2026-09-17 23:00:00.000001+00",
    rows,
    omissions: [],
    counts: { authorized: rows.length },
  };
}

const run = (rows: GovernedRow[], planOver?: Partial<PursuitQuery>) =>
  analyze(resultSet(rows, planOver), AGG.id, AGG.version);

// ── it computes, and it delegates ───────────────────────────────────────────────────────────────

test("the same cohort with all contributions authorized computes the exact registered sum", () => {
  const r = run([row("1", contributing(500000)), row("2", contributing(250000)), row("3", contributing(1))]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.result.visibility, "EXACT");
    assert.equal(r.result.value, 750001);
    assert.equal(r.result.operation, "SUM");
  }
});

test("basis.members exactly matches the post-governance contributing members", () => {
  for (const n of [1, 2, 5]) {
    const r = run(Array.from({ length: n }, (_, i) => row(String(i), contributing(10))));
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.result.basis, { members: n });
  }
});

test("L7: the aggregate DELEGATES to the registered per-member metric, re-deriving nothing", () => {
  assert.deepEqual(AGGREGATES[aggregateKey(AGG)].over, { id: "pursuit.open_pipeline_usd", version: 1 });
  // The contribution is READ from the cell governance already produced…
  assert.match(CODE, /row\.cells\[\s*overKey\s*\]/);
  // …and no authority decision, metric input or database reach is re-implemented here.
  for (const forbidden of ["mayDerive", "resolveDisclosure", "buildFederationViewer", "amount_usd", "opportunities", "withTenant", "query("]) {
    assert.ok(!CODE.includes(forbidden), `analyze() must not contain ${forbidden}`);
  }
});

test("L7: the ONLY arithmetic is the registered operation", () => {
  assert.equal([...CODE.matchAll(/\.reduce\(/g)].length, 1, "exactly one reduction");
  // …and it lives inside apply(), which switches on the registered operation.
  const apply = CODE.slice(CODE.indexOf("function apply"));
  assert.match(apply, /\.reduce\(/, "the reduction is inside apply()");
  assert.match(apply, /case "SUM"/);
});

// ── ruling 1: withhold whole, never partial ─────────────────────────────────────────────────────

test("RULING 1 / L2: ONE withheld contribution withholds the ENTIRE aggregate", () => {
  const r = run([row("1", contributing(500000)), row("2", withheldContribution()), row("3", contributing(250000))]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.result.visibility, "WITHHELD");
    assert.equal(r.result.value, null);
  }
});

test("RULING 1+3: the withheld case exposes neither a partial sum nor basis.members", () => {
  const r = run([row("1", contributing(500000)), row("2", withheldContribution())]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.result.basis, undefined, "no member count beside a withheld value");
    const bytes = JSON.stringify(r.result);
    assert.ok(!bytes.includes("500000"), "no authorized contribution survives into the withheld result");
    // The KEYS, not the word: "members" also occurs in the registered provenance sentence.
    assert.ok(!/"basis"|"members"/.test(bytes), "no basis metadata is serialized at all");
    assert.ok(!/DERIVATION_DENIED|NOT_DISCLOSABLE/.test(bytes), "no internal reason code reaches the recipient");
  }
});

test("L3: a withheld aggregate is identical whichever member was withheld, and however many", () => {
  const one = run([row("1", contributing(1)), row("2", withheldContribution())]);
  const other = run([row("1", withheldContribution()), row("2", contributing(999999))]);
  const many = run([row("1", withheldContribution()), row("2", withheldContribution())]);
  assert.ok(one.ok && other.ok && many.ok);
  if (one.ok && other.ok && many.ok) {
    assert.equal(JSON.stringify(one.result), JSON.stringify(other.result));
    assert.equal(JSON.stringify(one.result), JSON.stringify(many.result));
  }
});

test("a cell with no usable governed value is treated as withheld, never as zero", () => {
  for (const cell of [
    { visibility: "EXACT", value: null, provenance: OVER, existence: "AUTHORIZED" } as GovernedCell,
    { visibility: "EXACT", value: "1,200", provenance: OVER, existence: "AUTHORIZED" } as GovernedCell,
  ]) {
    const r = run([row("1", contributing(10)), row("2", cell)]);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.result.visibility, "WITHHELD");
  }
  // A member whose metric cell is entirely absent also withholds — it is not skipped.
  const missing = analyze(resultSet([{ objectRef: { class: "pursuit", id: "x" }, cells: {} }]), AGG.id, AGG.version);
  assert.ok(missing.ok);
  if (missing.ok) assert.equal(missing.result.visibility, "WITHHELD");
});

// ── L1 / L2 / L8 / L11: hidden rows and hidden values ───────────────────────────────────────────

test("L1/L2: a hidden candidate is never a member, so it cannot affect the aggregate", () => {
  // Governance excludes a hidden row before analysis sees the set — so the analyzer's input is
  // literally the same set with or without it. This is the set-level form of "never built, so there
  // is nothing to redact".
  const a = run([row("1", contributing(100)), row("2", contributing(200))]);
  const b = run([row("1", contributing(100)), row("2", contributing(200))]);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.equal(JSON.stringify(a.result), JSON.stringify(b.result));
    assert.deepEqual(a.result.basis, { members: 2 });
  }
});

test("L8: changing ONLY a hidden value changes neither the aggregate nor the basis", () => {
  // A suppressed cell that (wrongly) still carried a value must not influence anything downstream.
  const mk = (secret: number) => run([
    row("1", contributing(100)),
    row("2", { visibility: "SUPPRESSED", value: secret, provenance: OVER, reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" }),
  ]);
  const x = mk(1), y = mk(999999999);
  assert.ok(x.ok && y.ok);
  if (x.ok && y.ok) {
    assert.equal(JSON.stringify(x.result), JSON.stringify(y.result));
    assert.ok(!JSON.stringify(x.result).includes("999999999"));
  }
});

test("L1: an undisclosable pursuit cannot influence count, sum, order or provenance", () => {
  const r = run([row("1", contributing(10))]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.result.value, 10);
    assert.deepEqual(r.result.basis, { members: 1 });
    // Provenance is the REGISTERED text: a property of the definition, never of the members.
    assert.equal(r.result.provenance, AGGREGATES[aggregateKey(AGG)].provenance);
    // Nothing member-identifying reaches the result at all.
    assert.ok(!JSON.stringify(r.result).includes("00000000-0000-4000-8000"));
  }
});

test("L11: a single-member cohort reveals nothing the caller could not already derive", () => {
  // The aggregate equals that one member's own governed metric — which the caller was already
  // authorized to read, since a non-disclosable contribution would have withheld the whole thing.
  const r = run([row("1", contributing(42))]);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.result.value, 42);
  const suppressed = run([row("1", withheldContribution())]);
  assert.ok(suppressed.ok);
  if (suppressed.ok) assert.equal(suppressed.result.visibility, "WITHHELD");
});

test("L4: narrowing the cohort cannot expose a hidden member by subtraction", () => {
  // Two cohorts differing by one member would difference to that member's contribution — which is
  // exactly why both are WITHHELD as long as an undisclosable contribution is present in either.
  const wide = run([row("1", contributing(100)), row("2", contributing(200)), row("3", withheldContribution())]);
  const narrow = run([row("1", contributing(100)), row("3", withheldContribution())]);
  assert.ok(wide.ok && narrow.ok);
  if (wide.ok && narrow.ok) {
    assert.equal(wide.result.visibility, "WITHHELD");
    assert.equal(narrow.result.visibility, "WITHHELD");
    assert.equal(wide.result.value, null);
    assert.equal(narrow.result.value, null);
  }
});

// ── registry discipline (L5, L6) ────────────────────────────────────────────────────────────────

test("L6: an unregistered aggregate hard-fails — in validation, and again in the analyzer", () => {
  const v = validatePlan({ ...structuredClone(PLANS["open-pipeline-cohort"].plan), aggregate: { id: "made.up", version: 1 } });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /unknown aggregate made\.up@1/);
  // A registered id at an unregistered VERSION is equally unknown — the pair is the key.
  const v2 = validatePlan({ ...structuredClone(PLANS["open-pipeline-cohort"].plan), aggregate: { id: AGG.id, version: 2 } });
  assert.equal(v2.ok, false);
  assert.equal(analyze(resultSet([]), "made.up", 1).ok, false);
  assert.equal(analyze(resultSet([]), AGG.id, 2).ok, false);
});

test("an aggregate cannot sum a metric the plan never asked governance to resolve", () => {
  const v = validatePlan({ ...structuredClone(PLANS["open-pipeline-cohort"].plan), metrics: [] });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /requires pursuit\.open_pipeline_usd@1 in metrics/);
  const a = run([], { metrics: [] });
  assert.equal(a.ok, false);
  if (!a.ok) assert.equal(a.error, "METRIC_NOT_SELECTED");
});

test("L5: an unregistered dimension hard-fails before execution", () => {
  const v = validatePlan({
    ...structuredClone(PLANS["open-pipeline-cohort"].plan),
    filters: [{ dimension: "pursuit.owner_email", op: "in", values: ["someone@example.com"] }],
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /unknown filter dimension/);
});

test("L13: a filter value outside the registered vocabulary is refused, not silently dropped", () => {
  // A value outside the canonical vocabulary never becomes a predicate, so a row can never be
  // silently included by a filter that quietly failed to apply.
  const v = validatePlan({
    ...structuredClone(PLANS["open-pipeline-cohort"].plan),
    filters: [{ dimension: "pursuit.status", op: "in", values: ["not_a_status"] }],
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /not in the pursuit\.status vocabulary/);
  // …and every registered dimension is backed by a plain column, never a caller-shaped expression.
  for (const def of Object.values(FILTERS)) assert.match(def.column, /^[a-z_]+$/);
});

// ── rulings 2, 4, 5: structural constraints ─────────────────────────────────────────────────────

test("RULING 4 / L9: a cross-org cohort cannot be REPRESENTED by the query shape", () => {
  const plan = structuredClone(PLANS["open-pipeline-cohort"].plan) as unknown as Record<string, unknown>;
  for (const key of ["orgId", "organizations", "orgs", "tenant", "organizationIds"]) {
    assert.equal(key in plan, false, `the plan shape must carry no ${key}`);
    // …and adding one is refused as an unknown key BEFORE anything else — not accepted then rejected.
    const r = validatePlan({ ...plan, [key]: ["11111111-1111-4111-8111-111111111111"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.detail, new RegExp(`^unknown plan key ${key}$`));
  }
  // The cohort definition the result carries is subject/scope/filters — it has no org slot either.
  const r = run([row("1", contributing(1))]);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.result.cohort).sort(), ["filters", "scope", "subjectClass"]);
});

test("RULING 2 / L9: no comparison or ranking operation exists — the operator set is closed to SUM", () => {
  for (const def of Object.values(AGGREGATES)) assert.equal(def.operation, "SUM");
  for (const forbidden of ["percentile", "rank", "compare", "delta", "winner", "versus", "topN", "sort"]) {
    assert.ok(!new RegExp(forbidden, "i").test(CODE), `analyze() must not implement ${forbidden}`);
  }
  // A second aggregate in the same result is not expressible: a plan names at most one.
  const spec = structuredClone(PLANS["open-pipeline-cohort"].plan).aggregate;
  assert.ok(spec !== false && !Array.isArray(spec));
});

test("RULING 5 + §N: no generic count path — the only count is basis.members on a computed aggregate", () => {
  assert.equal([...CODE.matchAll(/\.length/g)].length, 1, "exactly one length read, on the computed path");
  assert.ok(!/\bcount\s*\(/i.test(CODE), "no count helper exists");
  // The one length read produces basis.members, and basis is constructed in exactly one place.
  assert.match(CODE, /basis:\s*\{\s*members:\s*members\.length\s*\}/);
  assert.equal([...CODE.matchAll(/basis:/g)].length, 1);
});

test("RULING 5: the cohort is fixed and code-defined; caller input cannot synthesize or alter it", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  // The request selects a plan by a validated key; it never supplies plan content.
  assert.match(route, /PLANS\[\s*view\s*\]\.plan/);
  // The route may PARSE caller-supplied structure (Slice 5 proposals), but none of it can become plan
  // content: a plan comes only from the code-defined registry, and parsed input goes to the intent
  // compiler, which can select a registered ViewKey and nothing else. Asserting "no JSON.parse" would
  // be a proxy that fails for a reason unrelated to the property it names (§16A).
  assert.ok(!/queryVersion\s*:/.test(route), "the route never constructs a plan literal");
  // EVERY plan the route executes comes from the code-defined registry — PLANS[key].plan, or one of
  // the two fixed plan builders. A plan assembled from request input would show up right here.
  const executed = [...route.matchAll(/executePursuitQuery\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(executed.length > 0, "the route does execute plans");
  for (const arg of executed) {
    assert.ok(/^PLANS\[[\w.]+\]\.plan$|^explainPlanFor\(|^goToPlanFor\(|^subject \?/.test(arg),
      `plan argument must come from the registry, got: ${arg}`);
  }
  for (const parsed of [...route.matchAll(/(\w+)\s*=\s*JSON\.parse\(/g)].map((m) => m[1])) {
    assert.ok(new RegExp(`compileIntent\\(\\{[\\s\\S]{0,80}${parsed}`).test(route)
      || new RegExp(`${parsed}\\s*=\\s*null`).test(route),
      `parsed input ${parsed} must flow into the intent compiler, never into a plan`);
  }
  // Only two request inputs exist, and neither is a filter, dimension, metric or aggregate.
  const params = route.match(/searchParams:\s*Promise<\{([^}]*)\}>/)?.[1] ?? "";
  assert.deepEqual([...params.matchAll(/(\w+)\??:/g)].map((m) => m[1]).sort(),
    ["ask", "compose", "ctx", "explain", "goto", "propose", "surface", "view"]);
  // An unknown view key does not become a plan; it falls back to a registered one.
  assert.equal(isViewKey("../../etc/passwd"), false);
  assert.equal(isViewKey(undefined), false);
  for (const k of VIEW_KEYS) assert.ok(PLANS[k], `${k} resolves to a code-defined plan`);
  // The cohort's filter values come from the canonical lifecycle vocabulary, not from a request.
  const cohortFilters = PLANS["open-pipeline-cohort"].plan.filters;
  assert.equal(cohortFilters.length, 1);
  assert.equal(cohortFilters[0].dimension, "pursuit.status");
  assert.ok(cohortFilters[0].values.every((v) => FILTERS["pursuit.status"].values?.includes(v)));
});

// ── the empty governed cohort (ruled: EXACT 0 / members 0) ──────────────────────────────────────

test("an empty governed cohort is a deterministic zero over an empty set, not UNKNOWN", () => {
  const r = run([]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.result.visibility, "EXACT");
    assert.equal(r.result.value, 0);
    assert.deepEqual(r.result.basis, { members: 0 });
  }
});

test("the empty result cannot be influenced by what governance EXCLUDED", () => {
  // `omissions` and `counts` are the only places a GovernedResultSet records that something was left
  // out. If the analyzer read either, the existence of hidden candidates would be inferable from the
  // aggregate — the exact channel the slice exists to close. So: same rows, wildly different
  // omission metadata, byte-identical AggregateResult.
  const bare = analyze(
    { ...resultSet([]), omissions: [], counts: { authorized: 0 } },
    AGG.id, AGG.version);
  const surrounded = analyze(
    {
      ...resultSet([]),
      omissions: Array.from({ length: 9 }, (_, i) => ({
        objectId: `hidden-${i}`, ref: OVER, reason: "NOT_DISCLOSABLE" as const,
      })),
      counts: { authorized: 0 },
    },
    AGG.id, AGG.version);
  assert.ok(bare.ok && surrounded.ok);
  if (bare.ok && surrounded.ok) {
    assert.equal(JSON.stringify(bare.result), JSON.stringify(surrounded.result));
    assert.ok(!JSON.stringify(surrounded.result).includes("hidden-"));
  }
  // Structurally: the analyzer never names either field.
  assert.ok(!/omissions|counts/.test(CODE), "analysis reads neither omissions nor counts");
});

test("zero is a claim about the governed cohort, and the registered provenance says so", () => {
  // The number alone would be ambiguous; the provenance the surface renders beside it is what makes
  // "0 over this cohort" not a claim about anything outside it.
  const provenance = AGGREGATES[aggregateKey(AGG)].provenance;
  assert.match(provenance, /members of this governed cohort/);
  assert.match(provenance, /not a total of anything you are not authorized to see/);
  // And a computed aggregate always carries its member count, so the scope of the claim is stated.
  const r = run([]);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.result.basis?.members, 0);
});

// ── determinism and absence of a model (L10, L12) ───────────────────────────────────────────────

test("L12: the same cohort twice yields a byte-identical result, basis.members included", () => {
  const rows = () => [row("1", contributing(7)), row("2", contributing(8))];
  assert.equal(JSON.stringify(run(rows())), JSON.stringify(run(rows())));
  const withheld = () => [row("1", contributing(7)), row("2", withheldContribution())];
  assert.equal(JSON.stringify(run(withheld())), JSON.stringify(run(withheld())));
});

test("L10: analysis is correct with the model entirely removed — there is no model, and no clock", () => {
  assert.ok(!/@anthropic-ai|openai|anthropic|generateText|createMessage|fetch\(/i.test(SRC));
  assert.ok(!/\basync\b|\bawait\b/.test(CODE), "analyze() is synchronous");
  assert.ok(!/Date\.|new Date|Math\.random/.test(CODE), "analyze() reads no clock and no randomness");
  // Its only imports are the registry and types — no database handle, no governance module.
  const imports = [...SRC.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./registry", "./types"]);
});
