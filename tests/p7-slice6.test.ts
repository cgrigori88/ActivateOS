import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ValidatedComponent } from "../src/lib/experience/surface/schema";
import { compileSurface, SURFACE_COMPILER_VERSION } from "../src/lib/experience/surface/compile";
import { COMPONENTS, LAYOUTS, MAX_COMPONENTS, componentRegistryDigest } from "../src/lib/experience/surface/registry";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import { AGGREGATES, FIELDS, METRICS } from "../src/lib/experience/registry";
import { PLANS } from "../src/lib/experience/plans";
import { surfacePromptForAudit } from "../src/lib/experience/intent/model";
import type { GovernedCell, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 6 — the Dynamic Surfaces proofs, ALL on hand-authored specs.
 *
 * No model and no database appear here: `compileSurface` is pure, so the dangerous specs can be
 * constructed directly. The whole-spec atomicity property is the one to watch — a spec that fails
 * anywhere must produce ZERO compiled components, which is checkable because compilation is the
 * thing that precedes execution.
 */

/**
 * Slice 8 made a validated node a union of STATIC and DYNAMIC. Every spec in this suite is directly
 * bound, so this ASSERTS that rather than casting it away — if a node ever became dynamic here, the
 * test would fail loudly instead of reading an absent field as undefined (§16B).
 */
const stat = (c: ValidatedComponent) => {
  if (c.kind !== "STATIC") throw new Error(`expected a directly-bound component, got ${c.kind}`);
  return c;
};

const ID0 = "11111111-2222-4333-8444-555555555555";
const SRC = readFileSync(new URL("../src/lib/experience/surface/compile.ts", import.meta.url), "utf8");
const ASSEMBLE_SRC = readFileSync(new URL("../src/lib/experience/surface/assemble.ts", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const cell = (v: string): GovernedCell => ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED" });
const row = (id: string): GovernedRow => ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell("Acme Corporation") } });
const MANIFEST = buildContextManifest([row(ID0)]);

const LIST = { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" } };
const COHORT = { component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } };
const spec = (over: Record<string, unknown> = {}) =>
  ({ specVersion: 1, layout: "stack", components: [LIST, COHORT], ...over });

const compile = (s: unknown, source: "HAND_AUTHORED" | "MODEL" = "HAND_AUTHORED", digest = MANIFEST.digest) =>
  compileSurface({ spec: s, manifest: MANIFEST, boundContextDigest: digest, source });

// ── the first vertical compiles ─────────────────────────────────────────────────────────────────

test("the ruled first vertical compiles: SHOW ME open pursuits + ANALYZE open pipeline", () => {
  const r = compile(spec());
  assert.ok(r.ok, r.ok ? "" : r.detail);
  if (r.ok) {
    assert.equal(r.validated.components.length, 2);
    assert.deepEqual(r.validated.components.map((c) => c.component), ["pursuit.list", "pursuit.cohort"]);
    // Titles and labels are REGISTRY-owned; nothing in the spec can author them.
    assert.equal(r.validated.components[0].title, COMPONENTS["pursuit.list"].title);
    assert.equal(r.validated.components[1].title, COMPONENTS["pursuit.cohort"].title);
    assert.equal(stat(r.validated.components[0]).intent.interpretedAs, "Show: Open pursuits by open pipeline");
    assert.equal(stat(r.validated.components[1]).intent.interpretedAs, "Analyze: Open pipeline across open pursuits");
  }
});

/**
 * SUPERSEDED IN PART BY SLICE 7 (ruling D), deliberately and in one direction only.
 *
 * This test originally asserted a TWO-component registry and that no EXPLAIN or GO TO component
 * existed — the Slice 6 first vertical. Slice 7 adds exactly those two, so that clause is now false
 * by ruling rather than by drift. What it was actually protecting is kept and strengthened: the
 * registry is CLOSED, each component binds exactly ONE certified operation, and no operation is
 * registered twice — so a component still cannot quietly become a different one.
 */
test("the registry is closed, and each component binds exactly one certified operation", () => {
  assert.deepEqual(Object.keys(COMPONENTS).sort(),
    ["pursuit.cohort", "pursuit.destination", "pursuit.explanation", "pursuit.list"]);
  assert.equal(COMPONENTS["pursuit.list"].operation, "SHOW_ME");
  assert.equal(COMPONENTS["pursuit.cohort"].operation, "ANALYZE");
  assert.equal(COMPONENTS["pursuit.explanation"].operation, "EXPLAIN");
  assert.equal(COMPONENTS["pursuit.destination"].operation, "GO_TO");
  // Every entry's key matches its own registry slot — no aliasing, no second name for one component.
  for (const [k, def] of Object.entries(COMPONENTS)) assert.equal(def.key, k);
  // One component per operation: no operation is reachable through two different component names.
  const ops = Object.values(COMPONENTS).map((c) => c.operation);
  assert.equal(new Set(ops).size, ops.length, "no operation is registered twice");
  // There is no generic component, and no component without a registry-owned title.
  for (const def of Object.values(COMPONENTS)) assert.ok(def.title.length > 0);
  assert.deepEqual([...LAYOUTS], ["stack", "grid"]);
});

// ── the model cannot invent anything (threat proofs 1–7) ────────────────────────────────────────

test("an unknown component type hard-fails", () => {
  for (const component of ["pursuit.everything", "admin.panel", "pursuit.list ", "PURSUIT.LIST", "", "__proto__"]) {
    const r = compile(spec({ components: [{ component, bind: { operation: "SHOW_ME", view: "open-by-value" } }] }));
    assert.equal(r.ok, false, `${component} must be refused`);
    if (!r.ok) assert.match(r.detail, /^unknown component/);
  }
});

test("a component cannot bind an operation other than its registered one", () => {
  const r = compile(spec({ components: [{ component: "pursuit.cohort", bind: { operation: "SHOW_ME", view: "open-by-value" } }] }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /binds ANALYZE, not SHOW_ME/);
});

test("the spec cannot author a field, metric, aggregate, filter or cohort", () => {
  const before = [Object.keys(METRICS).length, Object.keys(AGGREGATES).length, Object.keys(FIELDS).length];
  for (const bad of [
    spec({ metrics: [{ id: "pursuit.win_rate", version: 1 }] }),
    spec({ filters: [{ dimension: "pursuit.status", op: "=", values: ["QUALIFIED"] }] }),
    spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", filters: [] } }] }),
    spec({ components: [{ component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort", aggregate: { id: "cohort.invented", version: 1 } } }] }),
    spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" }, config: { filter: "all orgs" } }] }),
  ]) {
    assert.equal(compile(bad).ok, false, `${JSON.stringify(bad).slice(0, 70)} must be refused`);
  }
  assert.deepEqual([Object.keys(METRICS).length, Object.keys(AGGREGATES).length, Object.keys(FIELDS).length], before);
});

test("the spec cannot select an organization or principal", () => {
  for (const key of ["orgId", "organization", "tenant", "principal", "scope", "as"]) {
    assert.equal(compile(spec({ [key]: "x" })).ok, false, `${key} must be refused`);
    assert.equal(compile(spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", [key]: "x" } }] })).ok, false);
  }
});

test("the spec cannot insert a UUID, path, URL or fragment", () => {
  for (const bad of [
    spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", id: ID0 } }] }),
    spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: ID0 } }] }),
    spec({ components: [{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" }, href: "/admin" }] }),
    spec({ href: "https://evil.example.com" }),
    spec({ layout: "stack#team" }),
  ]) {
    assert.equal(compile(bad).ok, false);
  }
});

test("query semantics cannot be smuggled through layout or configuration", () => {
  for (const layout of ["stack?filter=all", "grid;drop table pursuits", { kind: "stack", filter: "x" }, ["stack"], "", "STACK"]) {
    const r = compile(spec({ layout }));
    assert.equal(r.ok, false, `${JSON.stringify(layout)} must be refused`);
    if (!r.ok) assert.match(r.detail, /^unknown layout/);
  }
  // Layout is not an input to compilation of a bind: the two valid layouts compile identical components.
  const a = compile(spec({ layout: "stack" })), b = compile(spec({ layout: "grid" }));
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.deepEqual(a.validated.components.map((c) => stat(c).intent.request), b.validated.components.map((c) => stat(c).intent.request));
  }
});

// ── cardinality and duplicates (ruling 4) ───────────────────────────────────────────────────────

test("a fifth component hard-fails", () => {
  const five = [LIST, COHORT, { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "recently-updated" } },
                { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-pipeline-cohort" } },
                { component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } }];
  assert.equal(five.length, MAX_COMPONENTS + 1);
  const r = compile(spec({ components: five }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /at most 4 components/);
  // An empty surface is equally refused: a surface with nothing on it is not a composition.
  assert.equal(compile(spec({ components: [] })).ok, false);
});

test("an exact semantic duplicate hard-fails, and identity is NOT raw JSON equality", () => {
  assert.equal(compile(spec({ components: [LIST, LIST] })).ok, false);
  // Same meaning, different key order — still a duplicate. Identity is computed from the COMPILED
  // request, which the compiler itself constructs, so the raw spec's key order cannot survive into it.
  // (At this bind arity that construction IS the normalization; `canonical()` additionally covers the
  // nested shapes a later slice's GO_TO/EXPLAIN binds will carry.)
  const reordered = { bind: { view: "open-by-value", operation: "SHOW_ME" }, component: "pursuit.list" };
  assert.notEqual(JSON.stringify(LIST), JSON.stringify(reordered), "the two specs differ as bytes");
  const r = compile(spec({ components: [LIST, reordered] }));
  assert.equal(r.ok, false, "byte-different but semantically identical components are duplicates");
  if (!r.ok) assert.match(r.detail, /duplicate component/);
  // Structurally: identity derives from the compiled request, never from the raw component.
  const code = strip(SRC);
  // Slice 8 renamed the local (`identity` → `identityKey`) when nodes became a union; the PROPERTY is
  // unchanged and is what is asserted: a directly-bound node's identity is the COMPILED request,
  // canonically normalized — never the raw spec bytes.
  assert.match(code, /identityKey = JSON\.stringify\(\[def\.key, canonical\(intent\.intent\.request\)\]\)/);
  assert.ok(!/JSON\.stringify\(c\.bind\)|JSON\.stringify\(raw\)/.test(code), "identity is not raw spec bytes");
  // RULING 4: a repeated component TYPE is refused in Slice 6 even when the binds genuinely differ —
  // "a future slice may allow repeated component types with genuinely different canonical binds".
  const different = compile(spec({ components: [LIST, { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "recently-updated" } }] }));
  assert.equal(different.ok, false, "a repeated component type is a later slice's capability");
  if (!different.ok) assert.match(different.detail, /repeated component type pursuit\.list/);
  // The first vertical is therefore exactly the two ruled components, and at most one of each.
  assert.ok(compile(spec()).ok);
});

// ── whole-spec atomicity (ruling 3, threat proof 12) ────────────────────────────────────────────

test("ONE invalid component means ZERO compiled components — no partial surface exists", () => {
  const r = compile(spec({ components: [LIST, COHORT, { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "everything" } }] }));
  assert.equal(r.ok, false, "the whole spec is rejected");
  // There is no partial value to leak: a failed compile returns a detail and nothing else.
  if (!r.ok) assert.deepEqual(Object.keys(r).sort(), ["detail", "ok"]);
});

test("validation is TOTAL and precedes execution — the compiler cannot execute anything", () => {
  const code = strip(SRC);
  for (const forbidden of ["runCompiledIntent", "executePursuitQuery", "resolveGoTo", "withTenant", "query(", "await ", "async "]) {
    assert.ok(!code.includes(forbidden), `the surface compiler must not contain ${forbidden}`);
  }
  // And the assembler only ever runs an ALREADY-validated spec: its input type says so.
  assert.match(ASSEMBLE_SRC, /validated: ValidatedSurfaceSpec/);
  const body = ASSEMBLE_SRC.slice(ASSEMBLE_SRC.indexOf("export async function assembleSurface"));
  // EVIDENCE BEFORE ORDERING (\u00a716B). `indexOf` returns -1 when absent, and -1 < anything \u2014 so an
  // ordering assertion alone is SATISFIED BY A MISSING GATE. Prove both positions exist first.
  const gateAt = body.indexOf("dynamicSurfacesEnabled");
  const execAt = body.indexOf("runCompiledIntent");
  assert.ok(gateAt >= 0, "the capability gate is present in assembleSurface");
  assert.ok(execAt >= 0, "the execution call is present in assembleSurface");
  assert.ok(gateAt < execAt, "the capability gate precedes execution");
  // …and it denies rather than falling through: the denial is the function's first outcome.
  assert.match(body, /if \(!\(await dynamicSurfacesEnabled\(principal\)\)\) return \{ ok: false, error: "CAPABILITY_DENIED" \};/);
});

test("a rejected spec produces no partial SurfaceResult, whatever the cause", () => {
  for (const bad of [null, undefined, 0, "spec", [], { specVersion: 2, layout: "stack", components: [LIST] },
                     spec({ specVersion: "1" }), spec({ components: "all" }), { layout: "stack", components: [LIST] }]) {
    const r = compile(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    if (!r.ok) assert.ok(!("validated" in r), "no validated spec accompanies a rejection");
  }
});

// ── independence and determinism (threat proofs 8, 9, 13, 14) ───────────────────────────────────

test("component order changes presentation order but NOT execution semantics", () => {
  const forward = compile(spec({ components: [LIST, COHORT] }));
  const reverse = compile(spec({ components: [COHORT, LIST] }));
  assert.ok(forward.ok && reverse.ok);
  if (forward.ok && reverse.ok) {
    // Presentation order differs…
    assert.deepEqual(forward.validated.components.map((c) => c.component), ["pursuit.list", "pursuit.cohort"]);
    assert.deepEqual(reverse.validated.components.map((c) => c.component), ["pursuit.cohort", "pursuit.list"]);
    // …while each component's compiled execution is identical whichever position it holds.
    const byKey = (v: typeof forward.validated) => Object.fromEntries(v.components.map((c) => [c.component, JSON.stringify(stat(c).intent.request)]));
    assert.deepEqual(byKey(forward.validated), byKey(reverse.validated));
  }
});

test("no component consumes another's output — the assembler threads nothing between them", () => {
  const code = strip(ASSEMBLE_SRC);
  // Each iteration uses only its own component; there is no accumulator feeding the next one.
  assert.match(code, /for \(const c of validated\.components\)/);
  assert.ok(!/components\[i\s*-\s*1\]|previous|prior|accumulat/i.test(code), "no component reads another's result");
  // The loop body pushes exactly one entry built from `c` alone.
  const loop = code.slice(code.indexOf("for (const c of validated.components)"), code.indexOf("return { ok: true"));
  assert.equal([...loop.matchAll(/runCompiledIntent\(/g)].length, 1);
  assert.ok(!loop.includes("components["), "the loop never indexes the growing result");
});

test("the same validated spec yields the same execution graph and the same digest", () => {
  const a = compile(spec()), b = compile(spec());
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.deepEqual(a.validated.components.map((c) => stat(c).intent.request), b.validated.components.map((c) => stat(c).intent.request));
    assert.equal(a.validated.provenance.surfaceSpecDigest, b.validated.provenance.surfaceSpecDigest);
  }
  // A different composition is a different digest — the digest tracks the SPEC, not the data.
  const other = compile(spec({ components: [LIST] }));
  assert.ok(other.ok);
  if (a.ok && other.ok) assert.notEqual(a.validated.provenance.surfaceSpecDigest, other.validated.provenance.surfaceSpecDigest);
});

test("hand-authored and model-authored identical specs compile to identical execution", () => {
  const hand = compile(spec(), "HAND_AUTHORED");
  const model = compile(spec(), "MODEL");
  assert.ok(hand.ok && model.ok);
  if (hand.ok && model.ok) {
    assert.deepEqual(hand.validated.components.map((c) => stat(c).intent.request), model.validated.components.map((c) => stat(c).intent.request));
    assert.equal(hand.validated.provenance.surfaceSpecDigest, model.validated.provenance.surfaceSpecDigest);
    // Only PROVENANCE differs, and a hand-authored spec fabricates no provider.
    assert.equal(hand.validated.provenance.source, "HAND_AUTHORED");
    assert.equal(model.validated.provenance.source, "MODEL");
    assert.equal(hand.validated.provenance.modelId, null);
  }
});

// ── provenance (ruling 6) ───────────────────────────────────────────────────────────────────────

test("provenance is compiler-owned, complete, and cannot be supplied by the spec", () => {
  for (const key of ["provenance", "surfaceSpecDigest", "compilerVersion", "source", "modelId"]) {
    assert.equal(compile(spec({ [key]: "forged" })).ok, false, `${key} must be refused`);
  }
  const r = compile(spec());
  assert.ok(r.ok);
  if (r.ok) {
    const p = r.validated.provenance;
    assert.equal(p.compilerVersion, SURFACE_COMPILER_VERSION);
    assert.equal(p.componentRegistryDigest, componentRegistryDigest());
    assert.equal(p.specVersion, 1);
    for (const k of ["surfaceSpecDigest", "vocabularyDigest", "contextDigest"]) {
      assert.match(String(p[k as keyof typeof p]), /^[0-9a-f]{16}$/, `${k} is a digest`);
    }
  }
});

test("the surface spec digest is NOT rendered", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  // NOT a bare "provenance" scan: the metric's and aggregate's REGISTERED provenance sentences are
  // rendered by design and were certified in Slices 1\u20133. The property here is that the SURFACE
  // COMPILER's provenance \u2014 a different thing that happens to share the word (\u00a716A) \u2014 never reaches
  // the recipient.
  for (const rendered of [/\{\s*[\w.]*surfaceSpecDigest/, /\{\s*[\w.]*componentRegistryDigest/,
                          /\{\s*[\w.]*vocabularyDigest/, /\{\s*[\w.]*contextDigest/,
                          /\{\s*[\w.]*compilerVersion/, /\{\s*result\.provenance/]) {
    assert.ok(!rendered.test(route), `the route must not render ${rendered}`);
  }
});

// ── gating (ruling 1 and 8) ─────────────────────────────────────────────────────────────────────

test("the capability gate DELEGATES to the canonical helper — no parallel dependency list", () => {
  const code = strip(ASSEMBLE_SRC);
  assert.match(code, /vnextCapabilities\(await tenantFeatures\(db, orgId\)\)\.dynamicSurfaces/);
  // The dependency chain is NOT restated here: no env var name and no flag key appears.
  for (const forbidden of ["VNEXT_", "pursuit_intelligence", "pursuit_state", "pursuit_memory", "dynamic_surfaces",
                           "vnextEnvEnabled", "org_features", "pursuit_experience"]) {
    assert.ok(!code.includes(forbidden), `the gate must not restate ${forbidden}`);
  }
});

test("RULING 8: ?compose= is model-gated; ?surface= is not, and neither bypasses the other's gate", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  const body = route.slice(route.indexOf("async function SurfaceView"), route.indexOf("function SurfaceRender"));
  // The model master is checked before the credential is read and before any provider call.
  assert.ok(body.indexOf("intentModelEnabled()") < body.indexOf("proposeSurface("), "the master is checked first");
  assert.match(body, /const fromModel = typeof surface !== "string" && typeof compose === "string"/);
  // Both inputs converge on ONE validator and ONE assembler.
  assert.equal([...body.matchAll(/compileSurface\(/g)].length, 1);
  assert.equal([...body.matchAll(/assembleSurface\(/g)].length, 1);
  // One rejection for every compile failure: no per-component detail reaches the recipient.
  assert.match(body, /That surface could not be composed\./);
  assert.ok(!/compiled\.detail/.test(body), "the rejection detail is never rendered");
});

test("exactly ONE module in the P7 tree may reach a provider — Slice 6 added none", () => {
  // Scoped to P7's own tree (\u00a716D): `lib/ai/client.ts` DEFINES the client and `lib/interpret/` is the
  // pre-existing interpreter tier, neither of which Slice 6 introduced or is responsible for. The
  // property Slice 6 owns is that composition added no new provider-reaching module of its own.
  const root = new URL("../src/lib/experience", import.meta.url).pathname;
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e)) files.push(p);
    }
  })(root);
  const reaching = files.filter((f) => /@\/lib\/ai\/client|completeStructuredScoped|new Anthropic/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(root.length + 1)).sort();
  assert.deepEqual(reaching, ["intent/model.ts"], "the provider boundary is still one module");
  // …and the surface modules specifically reach no provider.
  for (const f of ["surface/compile.ts", "surface/assemble.ts", "surface/registry.ts", "surface/schema.ts"]) {
    const src = readFileSync(new URL(`../src/lib/experience/${f}`, import.meta.url), "utf8");
    assert.ok(!/ai\/client|anthropic|completeStructured/i.test(src), `${f} must not reach a provider`);
  }
});

// ── the surface prompt carries no data (ruling 10) ──────────────────────────────────────────────

test("the surface prompt carries no identifier, no governed value and no result", () => {
  const prompt = surfacePromptForAudit(MANIFEST);
  assert.ok(prompt.length > 200, "the prompt exists and was assembled");
  assert.ok(!prompt.includes(ID0), "no canonical identifier reaches the model");
  for (const forbidden of ["amount_usd", "open_pipeline_usd@1", "org_id", "SELECT", "750000", "QUALIFIED"]) {
    assert.ok(!prompt.includes(forbidden), `the prompt must not contain ${forbidden}`);
  }
  // It names the closed vocabularies, and the views come from the registry rather than prose.
  for (const view of Object.keys(PLANS)) assert.ok(prompt.includes(view), `${view} is offered from the registry`);
  assert.match(prompt, /pursuit\.list/);
  assert.match(prompt, /pursuit\.cohort/);
});
