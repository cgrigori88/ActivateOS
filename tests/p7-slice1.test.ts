import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { validatePlan } from "../src/lib/experience/validate";
import { computeSum } from "../src/lib/experience/execute";
import { FIELDS, METRICS, MAX_LIMIT, metricKey } from "../src/lib/experience/registry";
import { PLANS, VIEW_KEYS } from "../src/lib/experience/plans";
import type { PursuitQuery } from "../src/lib/experience/types";

/**
 * P7 SLICE 1 — the proofs that need no database.
 *
 * The rule these enforce: a plan that does not validate is never executed, so an invented metric or
 * an unregistered field cannot cause so much as a query. The governance proofs (RLS, mayDerive,
 * disclosure, tenant entitlement) live in scripts/p7-slice1-verify.ts, where a real database and a
 * real app_rw session exist.
 */

const base = (): PursuitQuery => structuredClone(PLANS["open-by-value"].plan);
const ok = (p: unknown) => validatePlan(p);
const rejects = (p: unknown, match: RegExp) => {
  const r = validatePlan(p);
  assert.equal(r.ok, false, "expected the plan to be rejected");
  if (!r.ok) assert.match(r.detail, match);
};

// ── the closed vocabulary ───────────────────────────────────────────────────────────────────────

test("every shipped view plan validates", () => {
  for (const k of VIEW_KEYS) assert.equal(ok(PLANS[k].plan).ok, true, `${k} must validate`);
});

test("an unregistered metric hard-fails, and the pair (id, version) is the key", () => {
  rejects({ ...base(), metrics: [{ id: "made.up.metric", version: 1 }] }, /unknown metric made\.up\.metric@1/);
  // The SAME id at an unreleased version is equally unknown — versions are not interchangeable.
  rejects({ ...base(), metrics: [{ id: "pursuit.open_pipeline_usd", version: 2 }], ordering: [] },
    /unknown metric pursuit\.open_pipeline_usd@2/);
});

test("an unregistered field, filter dimension, operator or object class hard-fails", () => {
  rejects({ ...base(), projection: ["pursuit.id", "pursuit.secret_score"] }, /unknown field pursuit\.secret_score/);
  rejects({ ...base(), filters: [{ dimension: "pursuit.owner_email", op: "=", values: ["x"] }] }, /unknown filter dimension/);
  rejects({ ...base(), filters: [{ dimension: "pursuit.status", op: "like", values: ["%x%"] }] }, /operator like is not allowed/);
  rejects({ ...base(), subject: { class: "invoice" } }, /unknown object class invoice/);
});

test("the excluded score and valuation columns are not reachable — they are not in the registry", () => {
  for (const excluded of [
    "pursuit.current_priority_score", "pursuit.current_purchase_propensity_score",
    "pursuit.expected_value_weighted", "pursuit.expected_value_high", "pursuit.pertinence",
  ]) {
    assert.equal(excluded in FIELDS, false, `${excluded} must not be registered`);
    rejects({ ...base(), projection: ["pursuit.id", excluded] }, /unknown field/);
  }
});

test("no P2 pertinence value is reachable from Slice 1 in any form", () => {
  // Assert on what is REGISTERED — keys, columns, metric ids — not on prose. The metric's provenance
  // text legitimately says it is "not a pertinence signal", and a regex over prose would read that
  // denial as a mention. Structure is the contract; wording is not.
  const surfaces = [
    ...Object.keys(FIELDS),
    ...Object.values(FIELDS).map((f) => `${f.column} ${f.expression ?? ""}`),
    ...Object.values(METRICS).flatMap((m) => [m.id, m.label, m.inputs.relation, m.inputs.valueColumn, ...m.informationClasses]),
  ].join(" ");
  assert.ok(!/pertinen/i.test(surfaces), "no registered key, column or metric may be a pertinence value");
  assert.ok(!/propensity|priority_score|probability|_score\b/i.test(surfaces), "no scoring output may be registered");
});

test("unknown plan keys are rejected rather than ignored", () => {
  rejects({ ...base(), rawSql: "select 1" }, /unknown plan key rawSql/);
  rejects({ ...base(), table: "pursuits" }, /unknown plan key table/);
});

// ── Slice 1 boundaries that are enforced by validation ───────────────────────────────────────────

test("asOf must be null and explain must be false", () => {
  rejects({ ...base(), asOf: "2026-01-01T00:00:00Z" }, /asOf must be null/);
  rejects({ ...base(), explain: true }, /explain must be false/);
});

test("limit is bounded", () => {
  rejects({ ...base(), limit: 0 }, /limit must be an integer/);
  rejects({ ...base(), limit: MAX_LIMIT + 1 }, /limit must be an integer/);
  assert.equal(ok({ ...base(), limit: MAX_LIMIT }).ok, true);
});

test("a scope kind outside the existing scope model is rejected", () => {
  rejects({ ...base(), scope: { kind: "EVERYTHING", id: null } }, /unknown scope kind EVERYTHING/);
});

test("subject ids must be canonical uuids — never a fragment of SQL", () => {
  rejects({ ...base(), subject: { class: "pursuit", ids: ["1 or 1=1"] } }, /canonical uuids/);
  rejects({ ...base(), filters: [{ dimension: "pursuit.account", op: "=", values: ["'; drop table pursuits; --"] }] },
    /requires canonical uuids/);
});

test("ordering by a metric requires that metric to be selected", () => {
  rejects({ ...base(), metrics: [], ordering: [{ ref: "metric:pursuit.open_pipeline_usd@1", dir: "desc" }] },
    /requires that metric in metrics/);
  rejects({ ...base(), ordering: [{ ref: "pursuit.secret", dir: "desc" }] }, /unknown ordering key/);
});

test("a row must be identifiable", () => {
  rejects({ ...base(), projection: ["pursuit.status"] }, /must include pursuit\.id/);
});

// ── structural guards: what may not exist in the P7 tree ────────────────────────────────────────

const treeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? treeFiles(full) : full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });

const P7_TREE = [
  ...treeFiles(new URL("../src/lib/experience", import.meta.url).pathname),
  ...treeFiles(new URL("../src/app/experience", import.meta.url).pathname),
];
const codeOf = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * NARROWED BY SLICE 12, in the same shape Slice 5 used for the model and Slice 9 for the dispatcher —
 * and strengthened in the way that matters.
 *
 * Through Slice 11 this said P7 performs NO SQL mutation anywhere, which was true because P7 owned no
 * durable state. Slice 12 gives it exactly one table of its own — saved surface DEFINITIONS — so the
 * blanket form is no longer honest. What replaces it is narrower, not looser:
 *
 *   • P7 may mutate EXACTLY ONE table, and only from EXACTLY ONE named module;
 *   • every other P7 file still performs no SQL mutation at all;
 *   • no P7 file may mutate canonical business state, in any slice.
 *
 * The original assertion would have been satisfied by any arrangement with no writes. This one also
 * pins WHERE the single write path is, so moving it somewhere less visible fails certification.
 */
test("P7 MUTATES EXACTLY ONE TABLE, FROM EXACTLY ONE MODULE — and no canonical business state", () => {
  const MUTATOR = "src/lib/experience/surface/pin-repository.ts";
  const MUTATES = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;
  const mutating = P7_TREE.filter((f) => MUTATES.test(codeOf(f)))
    .map((f) => f.slice(f.indexOf("src/"))).sort();
  assert.deepEqual(mutating, [MUTATOR],
    "exactly one P7 module may mutate, and every other must be read-only");

  // That module writes to its OWN table and nothing else — canonical business state is untouchable.
  const body = codeOf(P7_TREE.find((f) => f.endsWith("pin-repository.ts"))!);
  const targets = [...body.matchAll(/(?:insert\s+into|update|delete\s+from)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual([...new Set(targets)], ["pinned_surface_definitions"], targets.join(", "));
  for (const canonical of ["pursuits", "opportunities", "companies", "organizations", "org_features",
                           "change_ledger", "pipeline_snapshots", "governed_action_invocations"]) {
    assert.ok(!new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+${canonical}\\b`, "i").test(body),
      `P7 must never mutate ${canonical}`);
  }
});

/**
 * NARROWED BY SLICE 9, in the same shape Slice 5 used for the model — and strengthened, not relaxed.
 *
 * The original clause said NO P7 module may reach an action path, which was true while P7 was
 * read-only. Slice 9 introduces exactly one human invocation boundary, so the property becomes the
 * one that actually matters: the action boundary is EXACTLY ONE NAMED FILE, and the surface that
 * renders an affordance can reach no dispatcher at all.
 *
 * That is stronger than the original in the way that counts, because it also pins WHICH file — the
 * old assertion would have been satisfied by any arrangement with no dispatcher, including one that
 * moved a dispatch somewhere less visible later.
 */
test("EXACTLY ONE P7 module may reach a consequential path, and it is the named invocation boundary", () => {
  const BOUNDARY = "src/app/experience/pursuits/actions.ts";
  const CONSEQUENTIAL = /dispatchSkill|startAndRun|continueRun|startRun|resumeRun|decideApproval|setOrgFeature|proposeGrant|acceptGrant/;
  const reaching = P7_TREE.filter((f) => CONSEQUENTIAL.test(codeOf(f)))
    .map((f) => f.slice(f.indexOf("src/"))).sort();
  assert.deepEqual(reaching, [BOUNDARY],
    "exactly one P7 module may reach a consequential path, and every other must be read-only");
});

test("RENDERING IS NOT INVOKING: the whole surface/assembly path reaches no dispatcher", () => {
  // Every module the surface uses to VALIDATE, ASSEMBLE or RENDER a result. If any of these could
  // reach a dispatcher, "rendering an action is not invoking an action" would be a convention.
  const SURFACE = P7_TREE.filter((f) => f.includes("/lib/experience/"));
  assert.ok(SURFACE.length > 10, "the surface tree was located");
  for (const f of SURFACE) {
    assert.ok(!/dispatchSkill|startAndRun|continueRun|resumeRun|decideApproval/.test(codeOf(f)),
      `${f} must not reach a consequential path`);
  }
  // And the P45 runtime is not reachable from the surface tree at all — the second substrate cannot
  // be entered by accident because both are "actions".
  for (const f of SURFACE) {
    assert.ok(!/@\/lib\/runtime|lib\/runtime\//.test(codeOf(f)), `${f} must not reach the P45 runtime`);
  }
});

test("no P7 module reaches a raw unsafe_ reader", () => {
  for (const f of P7_TREE) assert.ok(!/unsafe_/.test(codeOf(f)), `${f} must not touch a raw reader`);
});

test("NO MODEL: the deterministic tree contains exactly ONE quarantined model boundary", () => {
  // Slice 5 introduced a single module whose entire purpose is to be the only place a provider call
  // can originate. The property is not "no file mentions a model" — it is that the model boundary is
  // exactly one named file, and every other P7 module is deterministic end to end.
  const QUARANTINED = "src/lib/experience/intent/model.ts";
  const reaching = P7_TREE.filter((f) =>
    /@anthropic-ai|openai|anthropic|\bllm\b|generateText|createMessage|completeStructured/i.test(codeOf(f)));
  const relative = reaching.map((f) => f.slice(f.indexOf("src/"))).sort();
  assert.deepEqual(relative, [QUARANTINED],
    "exactly one P7 module may reach a model, and every other must be deterministic end to end");
  // …and the execution path is on the deterministic side of that quarantine.
  for (const f of ["execute.ts", "validate.ts", "analyze.ts", "explain.ts", "navigate.ts", "registry.ts", "plans.ts"]) {
    const code = codeOf(new URL(`../src/lib/experience/${f}`, import.meta.url).pathname);
    assert.ok(!/@anthropic-ai|anthropic|completeStructured/i.test(code), `${f} must contain no model call`);
  }
});

test("the web route carries transport concerns only — no governance or metric semantics", () => {
  const route = codeOf(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url).pathname);
  for (const forbidden of ["resolveDisclosure", "mayDerive", "buildFederationViewer", "withTenant", "resolveScope", "amount_usd", "reduce("]) {
    assert.ok(!route.includes(forbidden), `the route must not contain ${forbidden}`);
  }
  assert.ok(route.includes("executePursuitQuery"), "the route must call the shared boundary");
  assert.ok(route.includes("pursuitExperienceEnabled"), "the route must apply the environment master");
});

test("the boundary applies BOTH capability layers and the governance primitives", () => {
  const exec = codeOf(new URL("../src/lib/experience/execute.ts", import.meta.url).pathname);
  // The viewer and the derivation facts are now loaded for the whole cohort in bounded sets
  // (D-S14-EXECUTION-BOUND); the DECISIONS are the same two primitives, applied per member.
  for (const required of ["withTenant", "experienceEnabledFor", "resolveScope",
                          "loadCohortViewers", "loadCohortDerivationFacts", "decideDerivation", "resolveDisclosure"]) {
    assert.ok(exec.includes(required), `the boundary must apply ${required}`);
  }
  // Governance precedes computation: the derivation decision must resolve before the summation.
  assert.ok(exec.indexOf("decideDerivation(") < exec.indexOf("computeSum("), "derivation authority must be resolved before computation");
  // And the boundary decides nothing on its own: the rules live where they always did.
  const derivation = codeOf(new URL("../src/lib/pursuits/federation/derivation.ts", import.meta.url).pathname);
  assert.ok(derivation.includes("export function decideDerivation"), "the decision core is in the federation module");
  const facts = codeOf(new URL("../src/lib/pursuits/federation/batch-facts.ts", import.meta.url).pathname);
  for (const forbidden of ["decideDerivation", "resolveDisclosure", "DERIVATION_PURPOSES", "RETENTION_CLASSES"]) {
    assert.ok(!facts.includes(forbidden), `the fact loader must not decide: it names ${forbidden}`);
  }
});

test("no SQL identifier originates in a plan — column names live only in the registry", () => {
  const exec = codeOf(new URL("../src/lib/experience/execute.ts", import.meta.url).pathname);
  // Every interpolation into a statement must come from a registry def, never from plan input.
  const interpolations = [...exec.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  for (const i of interpolations) {
    assert.ok(/def\.|columns\.join|where\.join|params\.length|selected/.test(i),
      `interpolation \${${i}} must derive from the registry or bound-parameter bookkeeping`);
  }
});

test("the transaction instant comes from SQL, never a JavaScript Date", () => {
  const exec = codeOf(new URL("../src/lib/experience/execute.ts", import.meta.url).pathname);
  assert.ok(exec.includes("transaction_timestamp()"), "the instant must be read in SQL");
  assert.ok(!/new Date\(/.test(exec), "no JavaScript Date may participate (D-P6-1)");
});

// ── the metric's arithmetic ─────────────────────────────────────────────────────────────────────

test("the metric sums only what it is given", () => {
  assert.equal(computeSum([]), 0);
  assert.equal(computeSum([100, 250.5]), 350.5);
  assert.equal(computeSum([Number.NaN, 5]), 5);
});

test("the metric definition declares its governance inputs", () => {
  const def = METRICS[metricKey({ id: "pursuit.open_pipeline_usd", version: 1 })];
  assert.equal(def.determinism, "DETERMINISTIC");
  assert.deepEqual([...def.informationClasses], ["economic_value"]);
  assert.equal(def.deriveInputKind, "economic_fact");
  assert.equal(def.derivePurpose, "VALUE_CASE");
  assert.match(def.provenance, /Not a forecast, not a probability, not a pertinence signal/);
});

// ── the organization comes from a credential, never from caller input ───────────────────────────

test("an execution principal cannot be forged from plain data", async () => {
  const { testFixturePrincipal } = await import("../src/lib/experience/principal");
  const prior = process.env.P7_TEST_PRINCIPAL;
  process.env.P7_TEST_PRINCIPAL = "allow";
  const real = testFixturePrincipal("11111111-1111-1111-1111-111111111111");
  assert.equal(typeof real, "object");
  // The brand is a module-private symbol: a hand-built object has no own symbol keys, so it can
  // never be the same type, and nothing outside principal.ts can produce one.
  const forged = { orgId: "22222222-2222-2222-2222-222222222222", source: "web-session" };
  assert.equal(Object.getOwnPropertySymbols(forged).length, 0);
  assert.ok(Object.getOwnPropertySymbols(real).length > 0, "a real principal carries the private brand");
  process.env.P7_TEST_PRINCIPAL = prior;
});

test("the test-only principal factory is refused outside a test run", async () => {
  const { testFixturePrincipal } = await import("../src/lib/experience/principal");
  // NODE_ENV is typed read-only; a test that simulates a deployment has to write it anyway.
  const env = process.env as Record<string, string | undefined>;
  const priorEnv = env.NODE_ENV, priorOptIn = env.P7_TEST_PRINCIPAL;
  env.NODE_ENV = "production";          // simulate a deployment: neither marker set
  delete env.P7_TEST_PRINCIPAL;
  assert.throws(() => testFixturePrincipal("11111111-1111-1111-1111-111111111111"), /refused outside a test run/);
  if (priorEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = priorEnv;
  if (priorOptIn !== undefined) env.P7_TEST_PRINCIPAL = priorOptIn;
});

test("a principal requires a canonical organization id", async () => {
  const { testFixturePrincipal } = await import("../src/lib/experience/principal");
  const prior = process.env.P7_TEST_PRINCIPAL;
  process.env.P7_TEST_PRINCIPAL = "allow";
  assert.throws(() => testFixturePrincipal("../../etc/passwd"), /canonical organization id/);
  assert.throws(() => testFixturePrincipal("' or 1=1 --"), /canonical organization id/);
  process.env.P7_TEST_PRINCIPAL = prior;
});

test("no production transport can select an organization", () => {
  // The route must pass NO principal: its org comes from the session, inside withTenant.
  const route = codeOf(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url).pathname);

  // The intent is "the route passes NO principal", not "the route contains one exact string" —
  // pinning the literal call text made a legitimate Slice 2 change look like a violation. Walk the
  // argument list instead and require a single top-level argument.
  const at = route.indexOf("executePursuitQuery(");
  assert.ok(at > -1, "the route must call the shared boundary");
  let depth = 0, topLevelCommas = 0;
  for (let i = at + "executePursuitQuery(".length; i < route.length; i++) {
    const ch = route[i];
    if (ch === "(") depth++;
    else if (ch === ")") { if (depth === 0) break; depth--; }
    else if (ch === "," && depth === 0) topLevelCommas++;
  }
  assert.equal(topLevelCommas, 0, "the route must pass the plan and nothing else — no principal argument");
  assert.ok(!/orgId|ExecutionPrincipal|testFixturePrincipal/.test(route), "the route must not name an organization at all");

  // Nothing under src/app may import the test-only factory.
  const appFiles = treeFiles(new URL("../src/app", import.meta.url).pathname);
  for (const f of appFiles) {
    assert.ok(!/testFixturePrincipal/.test(readFileSync(f, "utf8")), `${f} must not import the test-only principal factory`);
  }

  // A plan cannot carry an organization: it is not a plan key, so validation rejects it.
  const r = validatePlan({ ...base(), orgId: "22222222-2222-2222-2222-222222222222" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /unknown plan key orgId/);
});

// ── the vocabularies are the canonical ones, not P7's ──────────────────────────────────────────

test("the filter vocabularies are IMPORTED from the canonical modules, not restated", async () => {
  const { PURSUIT_STATUSES } = await import("../src/lib/pursuits/lifecycle");
  const { PURSUIT_TYPES } = await import("../src/lib/pursuits/model");
  const { FILTERS } = await import("../src/lib/experience/registry");
  assert.deepEqual([...(FILTERS["pursuit.status"].values ?? [])], [...PURSUIT_STATUSES]);
  assert.deepEqual([...(FILTERS["pursuit.pursuit_type"].values ?? [])], [...PURSUIT_TYPES]);
  // …and the registry must not carry its own copy of either list.
  const registrySrc = readFileSync(new URL("../src/lib/experience/registry.ts", import.meta.url).pathname, "utf8");
  assert.ok(!/"READY_TO_ACTIVATE"/.test(registrySrc), "statuses must be imported, never restated");
  assert.ok(!/"COMPETITIVE_DISPLACEMENT"/.test(registrySrc), "pursuit types must be imported, never restated");
});

// ── the cross-object field stays inside the governed projection ─────────────────────────────────

test("account_name is a governed projection field with a stated provenance, not a join escape", () => {
  const def = FIELDS["pursuit.account_name"];
  assert.equal(def.audience, "PARTICIPANT_SHARED", "it is disclosed through the ladder like any other field");
  assert.match(def.expression ?? "", /^\(select c\.legal_name from companies c where c\.id = p\.account_id\)$/,
    "exactly one scalar subselect, keyed on the row's own account_id");
  // It reads ONE column of ONE row, keyed by the pursuit's own foreign key: it cannot enumerate
  // companies, cannot filter on them, and cannot widen the row set. A join would have made the
  // result set depend on companies visibility; a scalar subselect keeps the loader single-table.
  const exec = codeOf(new URL("../src/lib/experience/execute.ts", import.meta.url).pathname);
  // A SQL join, not JavaScript's Array.prototype.join — the naive word match hits `columns.join(", ")`.
  assert.ok(!/(?<!\.)\bjoin\s+[a-z_]+/i.test(exec), "the loader stays single-table");
  assert.ok(!/from companies/i.test(exec), "no company access path exists outside the registry expression");
});
