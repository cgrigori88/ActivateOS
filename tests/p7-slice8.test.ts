import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileSurface, COMPILE_SENTINEL_ID } from "../src/lib/experience/surface/compile";
import { COMPONENTS } from "../src/lib/experience/surface/registry";
import {
  asResolutionContext, executionDigest, mayExportIdentity, selectIdentity,
} from "../src/lib/experience/surface/identity";
import { buildContextManifest, toPrompt } from "../src/lib/experience/intent/context";
import { compileIntent } from "../src/lib/experience/intent/compile";
import { PLANS, SELECTOR_KEYS, VIEW_KEYS } from "../src/lib/experience/plans";
import { surfacePromptForAudit } from "../src/lib/experience/intent/model";
import type { ValidatedComponent } from "../src/lib/experience/surface/schema";
import type { GovernedCell, GovernedResultSet, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 8 — GOVERNED COMPONENT-TO-COMPONENT BINDING.
 *
 * > **A component may consume an explicitly exported governed identity handle from another certified
 * > component. It may not consume raw rows, hidden fields, rendered text or arbitrary result values.**
 *
 * Two properties are separable and are tested separately. GRAPH VALIDATION is pure and happens before
 * anything runs, so every illegal graph is constructed directly against `compileSurface`. IDENTITY
 * DERIVATION is pure too — `selectIdentity` takes a governed result set — so the dangerous selections
 * are constructed directly rather than simulated against a database.
 */

const ID0 = "11111111-2222-4333-8444-555555555555";
const ID1 = "99999999-8888-4777-8666-555555555555";

const cell = (v: string | number, over: Partial<GovernedCell> = {}): GovernedCell =>
  ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED", ...over });
const row = (id: string, name = "Acme Corporation"): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell(name) } });

const MANIFEST = buildContextManifest([row(ID0), row(ID1, "Globex")]);

const LIST = { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" } };
const COHORT = { component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } };
const dep = (from = "pursuit.list", select = "first") => ({ fromComponent: from, select });
const EXPLAIN_OF = (d = dep()) => ({ component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: d } });
const GOTO_OF = (d = dep()) => ({ component: "pursuit.destination", bind: { operation: "GO_TO", subject: d, surface: "canonical" } });

const spec = (components: unknown[]) => ({ specVersion: 1, layout: "stack", components });
const VERTICAL = spec([LIST, EXPLAIN_OF(), GOTO_OF()]);
const compile = (s: unknown) =>
  compileSurface({ spec: s, manifest: MANIFEST, boundContextDigest: MANIFEST.digest, source: "HAND_AUTHORED" });

const resultSet = (rows: GovernedRow[]): GovernedResultSet => ({
  plan: PLANS["open-by-value"].plan, planDigest: "deadbeefdeadbeef",
  computedAt: "2026-09-18T00:00:00.000Z", rows, omissions: [], counts: { authorized: rows.length },
});

const COMPILE = readFileSync(new URL("../src/lib/experience/surface/compile.ts", import.meta.url), "utf8");
const ASSEMBLE = readFileSync(new URL("../src/lib/experience/surface/assemble.ts", import.meta.url), "utf8");
const IDENTITY = readFileSync(new URL("../src/lib/experience/surface/identity.ts", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stat = (c: ValidatedComponent) => {
  if (c.kind !== "STATIC") throw new Error(`expected a directly-bound component, got ${c.kind}`);
  return c;
};
const dyn = (c: ValidatedComponent) => {
  if (c.kind !== "DYNAMIC") throw new Error(`expected a derived component, got ${c.kind}`);
  return c;
};

// ── THE FIRST VERTICAL ──────────────────────────────────────────────────────────────────────────

test("the ruled first vertical validates: SHOW ME → EXPLAIN + GO TO, one dependency level", () => {
  const r = compile(VERTICAL);
  assert.ok(r.ok, r.ok ? "" : r.detail);
  if (!r.ok) return;
  assert.deepEqual(r.validated.components.map((c) => c.component),
    ["pursuit.list", "pursuit.explanation", "pursuit.destination"]);
  // The upstream node is directly bound; both consumers are derived and name the SAME source.
  assert.equal(stat(r.validated.components[0]).intent.operation, "SHOW_ME");
  for (const i of [1, 2]) {
    const d = dyn(r.validated.components[i]);
    assert.deepEqual(d.dependency, { fromComponent: "pursuit.list", select: "first" });
  }
  // NOTHING is resolved yet: no identity exists at compile time, so none can have leaked into a node.
  const serialized = JSON.stringify(r.validated.components);
  assert.ok(!serialized.includes(ID0) && !serialized.includes(ID1));
  assert.ok(!serialized.includes(COMPILE_SENTINEL_ID), "the dry-run sentinel never survives validation");
});

test("EXPLAIN and GO TO are SIBLINGS — neither depends on the other", () => {
  const r = compile(VERTICAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const i of [1, 2]) {
    assert.equal(dyn(r.validated.components[i]).dependency.fromComponent, "pursuit.list");
  }
  // A consumer cannot be depended upon, so a sibling edge is unrepresentable rather than unused.
  const sibling = compile(spec([LIST, EXPLAIN_OF(), GOTO_OF(dep("pursuit.explanation"))]));
  assert.equal(sibling.ok, false);
  if (!sibling.ok) assert.match(sibling.detail, /does not export identity/);
});

// ── GRAPH VALIDATION HAPPENS BEFORE EXECUTION ───────────────────────────────────────────────────

test("the whole graph is validated before anything executes — the compiler cannot execute", () => {
  const body = strip(COMPILE);
  for (const forbidden of ["executePursuitQuery", "resolveGoTo", "runCompiledIntent", "withTenant", "await "]) {
    assert.ok(!body.includes(forbidden), `the compiler must not contain ${forbidden}`);
  }
  // It is synchronous, so there is no point at which a read could interleave with validation.
  assert.ok(!/async function compileSurface/.test(body));
});

test("an illegal graph refuses with ZERO components validated", () => {
  const illegal: [string, unknown[]][] = [
    ["unknown dependency target", [LIST, EXPLAIN_OF(dep("pursuit.nothing"))]],
    ["self reference", [LIST, { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: dep("pursuit.explanation") } }]],
    ["forward reference (would be a cycle)", [EXPLAIN_OF(), LIST]],
    ["dependency on an absent component", [EXPLAIN_OF(), GOTO_OF()]],
    ["ANALYZE as an identity source", [COHORT, EXPLAIN_OF(dep("pursuit.cohort"))]],
    ["unknown selector", [LIST, EXPLAIN_OF(dep("pursuit.list", "largest"))]],
    ["unknown dependency key", [LIST, { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromComponent: "pursuit.list", select: "first", where: "x" } } }]],
  ];
  for (const [label, components] of illegal) {
    const r = compile(spec(components));
    assert.equal(r.ok, false, `${label} must be refused`);
  }
  // NEGATIVE CONTROL: the shape those deviate from validates, so the refusals are discriminating.
  assert.ok(compile(VERTICAL).ok);
});

test("depth is bounded STRUCTURALLY — a second level cannot be expressed", () => {
  // Only `pursuit.list` exports identity, and it accepts none; no consumer exports. So a chain
  // requires a component that both consumes and exports, and the registry contains none.
  const exporters = Object.values(COMPONENTS).filter((c) => c.exportsIdentity);
  const consumers = Object.values(COMPONENTS).filter((c) => c.acceptsComponentIdentity);
  assert.deepEqual(exporters.map((c) => c.key), ["pursuit.list"]);
  assert.ok(consumers.every((c) => !c.exportsIdentity), "no component both consumes and exports identity");
  assert.ok(exporters.every((c) => !c.acceptsComponentIdentity), "no exporter consumes identity");
});

test("ANALYZE exports nothing, and the flag is what validation reads", () => {
  assert.equal(COMPONENTS["pursuit.cohort"].exportsIdentity, false);
  const r = compile(spec([COHORT, EXPLAIN_OF(dep("pursuit.cohort"))]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /pursuit\.cohort does not export identity/);
  assert.match(strip(COMPILE), /COMPONENTS\[from\]\.exportsIdentity/, "the flag is consulted, not the name");
});

// ── THE SELECTOR ────────────────────────────────────────────────────────────────────────────────

test("`first` is the ONLY representable selector — ordinals are refused", () => {
  assert.deepEqual([...SELECTOR_KEYS], ["first"]);
  for (const select of [0, 1, "0", "1", "ordinal", "last", "largest", "best", null, true, {}, ["first"]]) {
    const r = compile(spec([LIST, EXPLAIN_OF({ fromComponent: "pursuit.list", select } as never)]));
    assert.equal(r.ok, false, `select=${JSON.stringify(select)} must be refused`);
  }
  assert.ok(compile(spec([LIST, EXPLAIN_OF()])).ok, "the one registered selector still validates");
});

test("identity export is a PER-PLAN capability that defaults OFF", () => {
  assert.ok(mayExportIdentity("open-by-value", "first"), "the certified plan may export");
  for (const view of VIEW_KEYS.filter((v) => v !== "open-by-value")) {
    assert.equal(mayExportIdentity(view, "first"), false, `${view} must not export by default`);
    assert.equal(PLANS[view].identityExport, undefined, `${view} declares no export`);
  }
  // Being a SHOW_ME plan is not enough: `recently-updated` is also a list, and is still refused.
  const r = compile(spec([
    { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "recently-updated" } },
    EXPLAIN_OF(),
  ]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /not certified to export identity/);
});

test("NEGATIVE CONTROL: enabling export on an uncertified plan is what the refusal turns on", () => {
  const certified = compile(spec([LIST, EXPLAIN_OF()]));
  const uncertified = compile(spec([
    { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "recently-updated" } }, EXPLAIN_OF(),
  ]));
  assert.ok(certified.ok && !uncertified.ok, "the per-plan capability is load-bearing, not decorative");
});

test("selection reads NO cell — a hidden or suppressed value cannot promote a row", () => {
  const body = strip(IDENTITY);
  const fn = body.slice(body.indexOf("export function selectIdentity"), body.indexOf("export function asResolutionContext"));
  assert.ok(fn.length > 100, "selectIdentity was located");
  assert.ok(!/\.cells\b|visibility|SUPPRESSED|value/.test(fn), "the selector inspects no cell or value");
  assert.match(fn, /result\.rows\[0\]/, "it takes element zero of the already-ordered governed rows");

  // And behaviourally: whatever the cells say, `first` is row zero of what governance produced.
  const withheld = row(ID0);
  withheld.cells["pursuit.open_pipeline_usd@1"] = cell(0, { visibility: "SUPPRESSED", value: null, reason: "DERIVATION_DENIED" });
  const rich = row(ID1, "Globex");
  rich.cells["pursuit.open_pipeline_usd@1"] = cell(9_999_999);
  const picked = selectIdentity(resultSet([withheld, rich]), "first", "pursuit.list");
  assert.equal(picked?.identity.id, ID0, "the ordered result decides, not the values");
});

test("zero governed rows yields NOTHING — never a fallback, default or nearest row", () => {
  assert.equal(selectIdentity(resultSet([]), "first", "pursuit.list"), null);
  // SCOPED to the selector (§16D). A whole-file scan would trip on `def.fallbackLabel` — the
  // certified Slice 4 LABEL rule, which is not an identity fallback and must keep working.
  const body = strip(IDENTITY);
  const fn = body.slice(body.indexOf("export function selectIdentity"), body.indexOf("export function asResolutionContext"));
  assert.ok(fn.length > 100, "selectIdentity was located");
  for (const substitution of ["??", "||", "default", "nearest", "fallback", "rows[1]", "find("]) {
    assert.ok(!fn.includes(substitution), `the selector must not contain ${substitution}`);
  }
  assert.match(fn, /if \(!row\) return null/, "an absent row returns nothing, and nothing else");
  // NEGATIVE CONTROL: the label rule the scan would have caught is still present, and still certified.
  assert.match(body, /def\.fallbackLabel/, "the Slice 4 label fallback is intact and out of scope here");
});

// ── THE HANDLE CARRIES IDENTITY, NOT ROWS ───────────────────────────────────────────────────────

test("the exported handle carries identity capability and NO row data", () => {
  const r = row(ID0);
  r.cells["pursuit.open_pipeline_usd@1"] = cell(1_120_000);
  r.cells["pursuit.status"] = cell("QUALIFIED");
  const derived = selectIdentity(resultSet([r]), "first", "pursuit.list");
  assert.ok(derived);
  if (!derived) return;
  assert.deepEqual(Object.keys(derived).sort(),
    ["digest", "identity", "origin", "selector", "sourceComponent", "sourceResultDigest"]);
  assert.deepEqual(Object.keys(derived.identity).sort(), ["class", "id", "label"]);
  const serialized = JSON.stringify(derived);
  for (const leaked of ["1120000", "QUALIFIED", "cells", "open_pipeline", "counts", "omissions", "plan"]) {
    assert.ok(!serialized.includes(leaked), `the handle must not carry ${leaked}`);
  }
});

test("NEGATIVE CONTROL: the row DOES hold what the handle omits", () => {
  // Without this, the previous test could pass because the fixture never had the data.
  const r = row(ID0);
  r.cells["pursuit.open_pipeline_usd@1"] = cell(1_120_000);
  assert.ok(JSON.stringify(r).includes("1120000"), "the upstream row carries the value the handle drops");
});

// ── THE STRUCTURAL GUARD: DERIVED IDENTITY CANNOT REACH A PROVIDER ──────────────────────────────

test("derived identity CANNOT be described to a provider — structural, then runtime", () => {
  const derived = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list");
  assert.ok(derived);
  if (!derived) return;
  // STRUCTURAL: it has no `slots`, so it is not assignable to `toPrompt` — this would not compile
  // without the cast, which is exactly the guard. RUNTIME: it refuses anyway, so an untyped caller
  // arriving through JSON cannot get past it either.
  assert.throws(() => toPrompt(derived as never), /only recipient context may be described/);
  assert.throws(() => toPrompt({ ...MANIFEST, origin: "DERIVED" } as never), /only recipient context/);
  // NEGATIVE CONTROL: the recipient manifest passes, so the guard discriminates.
  assert.equal(toPrompt(MANIFEST).count, 2);
});

test("the recipient manifest is never mutated, extended or merged into", () => {
  const before = JSON.stringify(MANIFEST);
  const derived = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list");
  asResolutionContext(derived!);
  compile(VERTICAL);
  assert.equal(JSON.stringify(MANIFEST), before, "the recipient manifest is unchanged");
  assert.equal(MANIFEST.origin, "RECIPIENT");
  // The adapter produces a RESOLUTION context, not a manifest: no slots, so nothing to render.
  const adapted = asResolutionContext(derived!) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(adapted).sort(), ["digest", "ids"]);
});

test("the derived context resolves through the ONE certified resolver, with its refusals intact", () => {
  const derived = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list")!;
  const ctx = asResolutionContext(derived);
  const ok = compileIntent({ proposal: { operation: "EXPLAIN", subject: { fromContext: 0 } }, manifest: ctx, boundContextDigest: derived.digest, source: "HAND_AUTHORED" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.intent.request, { subjectId: ID0 });
  // One slot, so the resolver's own refusals still apply unchanged.
  for (const [label, index, digest] of [["out of range", 1, derived.digest], ["negative", -1, derived.digest], ["stale digest", 0, "nope"]] as const) {
    const r = compileIntent({ proposal: { operation: "EXPLAIN", subject: { fromContext: index } }, manifest: ctx, boundContextDigest: digest, source: "HAND_AUTHORED" });
    assert.equal(r.ok, false, `${label} must refuse`);
  }
  // There is exactly ONE resolution algorithm: the derived module implements none of its own.
  assert.ok(!/function resolve|indexOf|ids\[/.test(strip(IDENTITY).replace(/asResolutionContext[\s\S]*?\n}/, "")));
});

// ── EXECUTION IDENTITY AND REPLAY ───────────────────────────────────────────────────────────────

test("executionDigest changes when the selected canonical identity changes", () => {
  const a = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list")!;
  const b = selectIdentity(resultSet([row(ID1, "Acme Corporation")]), "first", "pursuit.list")!;
  // Same visible label, different canonical object.
  assert.equal(a.identity.label, b.identity.label);
  assert.notEqual(a.digest, b.digest);
  assert.notEqual(
    executionDigest([{ consumer: "pursuit.explanation", derived: a }]),
    executionDigest([{ consumer: "pursuit.explanation", derived: b }]),
  );
});

test("executionDigest is stable under equivalent execution, and null without a dynamic edge", () => {
  const a = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list")!;
  const again = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list")!;
  assert.equal(
    executionDigest([{ consumer: "pursuit.explanation", derived: a }]),
    executionDigest([{ consumer: "pursuit.explanation", derived: again }]),
  );
  assert.equal(executionDigest([]), null, "a surface with no dynamic edge keeps Slice 7 provenance");
  // It is domain-separated and fixed-width — a digest, not a serialized identity.
  assert.match(executionDigest([{ consumer: "pursuit.explanation", derived: a }])!, /^[0-9a-f]{16}$/);
  assert.match(strip(IDENTITY), /"p7s8\.execution"/, "the digest input is domain-separated");
});

test("a Slice 7 surface with no edges keeps its digest behaviour unchanged", () => {
  const s7 = compile(spec([LIST, COHORT]));
  assert.ok(s7.ok);
  if (!s7.ok) return;
  assert.equal(s7.validated.provenance.executionDigest, null);
  // The spec digest still hashes the COMPILED requests for directly-bound nodes.
  assert.match(s7.validated.provenance.surfaceSpecDigest, /^[0-9a-f]{16}$/);
  assert.match(strip(COMPILE), /c\.kind === "STATIC"\s*\n?\s*\? \[c\.component, canonical\(c\.intent\.request\)\]/);
});

test("the resolved identity is never serialized into provenance", () => {
  const r = compile(VERTICAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = JSON.stringify(r.validated.provenance);
  assert.ok(!p.includes(ID0) && !p.includes(ID1) && !p.includes(COMPILE_SENTINEL_ID));
});

// ── UPSTREAM VISIBILITY IS NOT DOWNSTREAM AUTHORIZATION ─────────────────────────────────────────

test("the handle carries no authorization decision for a downstream component to trust", () => {
  const derived = selectIdentity(resultSet([row(ID0)]), "first", "pursuit.list")!;
  const serialized = JSON.stringify(derived).toLowerCase();
  for (const cached of ["authorized", "allowed", "permitted", "cansee", "granted", "principal", "visib"]) {
    assert.ok(!serialized.includes(cached), `the handle must not carry ${cached}`);
  }
});

test("every downstream component re-runs its own certified governance", () => {
  const body = strip(ASSEMBLE);
  // Each node — derived or not — reaches execution through the same single call.
  const calls = body.match(/runCompiledIntent\(/g) ?? [];
  assert.equal(calls.length, 1, "one execution path for every component");
  assert.match(body, /runCompiledIntent\(intent, principal[,)]/, "under the CURRENT principal");
  // Nothing skips execution because an upstream row was visible.
  assert.ok(!/skip|alreadyAuthorized|trusted/i.test(body));
});

test("governance loss after upstream execution still yields no partial surface", () => {
  const body = strip(ASSEMBLE);
  // The atomic decision is still taken once, over the whole executed set, before the only success.
  const guard = body.indexOf("surfaceDisposition(executed)");
  const success = body.indexOf("return { ok: true");
  assert.ok(guard > 0 && success > 0 && guard < success);
  const returns = body.match(/return \{ ok: false[^}]*\}/g) ?? [];
  assert.ok(returns.every((r) => /^return \{ ok: false, error: [A-Za-z_."]+ \}$/.test(r)), "every failure stays bare");
});

// ── THE THREE OUTCOMES STAY DISTINCT ────────────────────────────────────────────────────────────

test("NO_SELECTABLE_RESULT is its own outcome, never NOT_AVAILABLE or FAILED", () => {
  const schema = readFileSync(new URL("../src/lib/experience/surface/schema.ts", import.meta.url), "utf8");
  for (const variant of ["NO_SELECTABLE_RESULT", "NOT_AVAILABLE", "FAILED"]) {
    assert.match(schema, new RegExp(`\\{ ok: false; error: "${variant}" \\}`), `${variant} is a bare variant`);
  }
  const body = strip(ASSEMBLE);
  // The empty-upstream branch returns the composition outcome, not a governance one.
  assert.match(body, /if \(!derived\) return \{ ok: false, error: "NO_SELECTABLE_RESULT" \}/);
  // NEGATIVE CONTROL: it is not spelled as the governed absence anywhere.
  assert.ok(!/derived\) return \{ ok: false, error: "NOT_AVAILABLE"/.test(body));
  // And the route gives it its own sentence.
  const route = strip(readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8"));
  assert.match(route, /NO_SELECTABLE_RESULT"\) return notice\("There is nothing here to build that on\."\)/);
  assert.ok(!/NO_SELECTABLE_RESULT[^)]*component/.test(route), "it names no component");
});

// ── THE MODEL BOUNDARY ──────────────────────────────────────────────────────────────────────────

test("the model never receives rows, a derived identity, or a result", () => {
  const prompt = surfacePromptForAudit(MANIFEST);
  assert.ok(!prompt.includes(ID0) && !prompt.includes(ID1));
  for (const forbidden of ["subjectId", "fromContextId", "1120000", "planDigest", "executionDigest", "/pursuits/"]) {
    assert.ok(!prompt.includes(forbidden), `the prompt must not contain ${forbidden}`);
  }
  // It offers the dependency shape and exactly one selector.
  assert.match(prompt, /fromComponent/);
  assert.match(prompt, /"first"/);
  // WHAT THE MODEL MAY EMIT is decided by the schema, not by prose — and a prose scan would trip on
  // the rule that FORBIDS value-based selection, which says "largest" in order to refuse it (§16A).
  const model = strip(readFileSync(new URL("../src/lib/experience/intent/model.ts", import.meta.url), "utf8"));
  assert.match(model, /select: z\.enum\(\["first"\]\)/, "one selector value is representable");
  assert.ok(!/z\.enum\(\["first",/.test(model), "and only one");
  // The dependency subject is a closed union of exactly the two permitted shapes.
  assert.match(model, /z\.object\(\{ fromComponent: z\.string\(\), select: z\.enum\(\["first"\]\) \}\)/);
});

test("there is no second model call after upstream execution", () => {
  const body = strip(ASSEMBLE);
  for (const forbidden of ["proposeIntent", "proposeSurface", "completeStructured", "ai/client", "anthropic"]) {
    assert.ok(!body.includes(forbidden), `the assembler must not contain ${forbidden}`);
  }
  assert.ok(!strip(IDENTITY).includes("anthropic"));
});

test("a hand-authored graph and a model-authored one validate identically", () => {
  const hand = compile(VERTICAL);
  const model = compileSurface({ spec: VERTICAL, manifest: MANIFEST, boundContextDigest: MANIFEST.digest, source: "MODEL", modelId: "claude-x", promptTemplateVersion: "p@1" });
  assert.ok(hand.ok && model.ok);
  if (!hand.ok || !model.ok) return;
  assert.equal(hand.validated.provenance.surfaceSpecDigest, model.validated.provenance.surfaceSpecDigest);
  assert.deepEqual(
    hand.validated.components.map((c) => [c.component, c.kind]),
    model.validated.components.map((c) => [c.component, c.kind]),
  );
  assert.equal(hand.validated.provenance.modelId, null);
  assert.equal(model.validated.provenance.modelId, "claude-x");
});

// ── NO PERSISTENCE, NO WRITES ───────────────────────────────────────────────────────────────────

test("nothing about a derived identity is persisted", () => {
  for (const src of [IDENTITY, ASSEMBLE, COMPILE]) {
    const body = strip(src).toLowerCase();
    for (const forbidden of ["insert ", "update ", "delete ", "upsert", "cache", "localstorage", "globalthis"]) {
      assert.ok(!body.includes(forbidden), `must not contain ${forbidden}`);
    }
  }
  // The export map is a local, rebuilt per execution — there is no module-level state to outlive one.
  assert.match(strip(ASSEMBLE), /const exported = new Map/);
  assert.ok(!/^const exported|^let exported/m.test(strip(ASSEMBLE)));
});

test("no P5, P6 or schema change", () => {
  for (const src of [IDENTITY, ASSEMBLE, COMPILE]) {
    for (const forbidden of ["mayDerive", "resolveDisclosure", "buildFederationViewer", "migration"]) {
      assert.ok(!strip(src).includes(forbidden), `must not contain ${forbidden}`);
    }
  }
});

// ── SELECTION CONSUMES THE GOVERNED ARTIFACT, NOT A BROADER QUERY ───────────────────────────────

test("selection consumes the GOVERNED result the component produced — never a fresh, wider read", () => {
  // Structural: the identity module holds no database handle and issues no query, so it could not
  // widen a candidate set even if something asked it to.
  const body = strip(IDENTITY);
  for (const forbidden of ["withTenant", "query(", "pool", "executePursuitQuery", "PoolClient", "await"]) {
    assert.ok(!body.includes(forbidden), `identity.ts must not contain ${forbidden}`);
  }
  // And the assembler hands it the component's OWN governed outcome, guarded on that outcome being ok.
  const asm = strip(ASSEMBLE);
  assert.match(asm, /outcome\.kind === "RESULT" && outcome\.outcome\.ok/);
  assert.match(asm, /selectIdentity\(outcome\.outcome\.result, selector, c\.component\)/);
  assert.ok(!/selectIdentity\([^)]*candidates|selectIdentity\([^)]*rows\b/.test(asm));
});

test("NEGATIVE CONTROL: selecting from a pre-governance set would be CAUGHT, not missed", () => {
  const asm = strip(ASSEMBLE);
  const check = (src: string) =>
    /selectIdentity\(outcome\.outcome\.result, selector, c\.component\)/.test(src)
    && /outcome\.kind === "RESULT" && outcome\.outcome\.ok/.test(src);
  assert.equal(check(asm), true, "canonical code passes");

  const wider = asm.replace("selectIdentity(outcome.outcome.result, selector, c.component)",
    "selectIdentity(await loadCandidates(db, plan, null), selector, c.component)");
  assert.notEqual(wider, asm, "the mutation actually applied");
  assert.equal(check(wider), false, "a broader candidate source is caught");

  const ungoverned = asm.replace('outcome.kind === "RESULT" && outcome.outcome.ok', "true");
  assert.notEqual(ungoverned, asm, "the mutation actually applied");
  assert.equal(check(ungoverned), false, "dropping the governed-result guard is caught");
});

// ── THE HANDLE CANNOT SHORT-CIRCUIT DOWNSTREAM GOVERNANCE ───────────────────────────────────────

test("NEGATIVE CONTROL: a handle that skipped downstream execution would be CAUGHT", () => {
  const asm = strip(ASSEMBLE);
  // Exactly one execution call, reached by every node, under the current principal.
  const check = (src: string) =>
    (src.match(/runCompiledIntent\(/g) ?? []).length === 1
    && /runCompiledIntent\(intent, principal(, policy)?\)/.test(src)
    && !/if \(derived\) (continue|return)/.test(src);
  assert.equal(check(asm), true, "canonical code passes");

  const CALL = "const outcome = await runCompiledIntent(intent, principal, policy);";
  const shortCircuit = asm.replace(CALL, `if (derived) continue;\n    ${CALL}`);
  assert.notEqual(shortCircuit, asm, "the mutation actually applied");
  assert.equal(check(shortCircuit), false, "trusting the handle instead of re-running governance is caught");
});

test("the derived identity is never exposed as a handle to the recipient", () => {
  const route = strip(readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8"));
  // The renderer knows nothing about identity derivation: it cannot select, resolve or repair.
  for (const forbidden of ["selectIdentity", "DerivedIdentityContext", "asResolutionContext", "fromComponent",
                           "sourceResultDigest", "executionDigest", "dependency"]) {
    assert.ok(!route.includes(forbidden), `the route must not reference ${forbidden}`);
  }
  // A dynamic component carries no view and no bind into the result — only its governed outcome.
  const r = compile(VERTICAL);
  assert.ok(r.ok);
  if (!r.ok) return;
  const serialized = JSON.stringify(r.validated.components.filter((c) => c.kind === "DYNAMIC"));
  assert.ok(!serialized.includes(ID0) && !serialized.includes(ID1));
});
