import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ValidatedComponent } from "../src/lib/experience/surface/schema";
import { compileSurface } from "../src/lib/experience/surface/compile";
import { COMPONENTS, CONTEXT_BOUND_OPERATIONS, isContextBound } from "../src/lib/experience/surface/registry";
import { componentDisposition, surfaceDisposition, type ExecutedComponent } from "../src/lib/experience/surface/availability";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import { surfacePromptForAudit } from "../src/lib/experience/intent/model";
import { PLANS } from "../src/lib/experience/plans";
import type { IntentExecution } from "../src/lib/experience/intent/run";
import type { ContextManifest, IntentOperation, ProposalSource } from "../src/lib/experience/intent/schema";
import type { Explanation, GovernedCell, GovernedResultSet, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 7 — CONTEXT-BOUND DYNAMIC SURFACES.
 *
 * > **A generated surface may bind to an already-governed context object. It may not discover,
 * > manufacture or inherit an object from another component's result.**
 *
 * Two properties are under test and they are different. COMPILE-time binding is proved against
 * `compileSurface`, which is pure. EXECUTION-time atomicity is proved against `surfaceAvailability`,
 * which is also pure — the assembler's decision was deliberately extracted so the dangerous states
 * (target revoked between manifest and execution) can be constructed directly rather than simulated
 * with a database that would have to be sabotaged to produce them.
 *
 * Every assertion here reads a value the code actually produced. Nothing asserts against source text
 * except where the property IS structural — that a shape is unrepresentable, or that a module reaches
 * no provider — and those are marked.
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
const ID1 = "99999999-8888-4777-8666-555555555555";

const cell = (v: string): GovernedCell =>
  ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED" });
const row = (id: string, name = "Acme Corporation"): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell(name) } });

const MANIFEST = buildContextManifest([row(ID0), row(ID1, "Globex")]);

const EXPLAIN = { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 0 } } };
const GOTO = { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" } };

const spec = (over: Record<string, unknown> = {}) =>
  ({ specVersion: 1, layout: "stack", components: [EXPLAIN, GOTO], ...over });

const compile = (
  s: unknown,
  opts: { manifest?: ContextManifest; digest?: string; source?: ProposalSource } = {},
) => {
  const manifest = opts.manifest ?? MANIFEST;
  return compileSurface({
    spec: s,
    manifest,
    boundContextDigest: opts.digest ?? manifest.digest,
    source: opts.source ?? "HAND_AUTHORED",
  });
};

// ── fixtures for the EXECUTED side ──────────────────────────────────────────────────────────────

const resultSet = (): GovernedResultSet => ({
  plan: PLANS["open-by-value"].plan,
  planDigest: "deadbeefdeadbeef",
  computedAt: "2026-09-18T00:00:00.000Z",
  rows: [row(ID0)],
  omissions: [],
  counts: { authorized: 1 },
});

const explanation = (statements: Explanation["statements"]): Explanation => ({
  subject: { class: "pursuit", id: ID0 },
  templateId: "pursuit.explain", templateVersion: 1, planVersion: 1,
  planDigest: "deadbeefdeadbeef", computedAt: "2026-09-18T00:00:00.000Z", statements,
});

/** EXPLAIN that produced a governed explanation. */
const explainOk = (statements: Explanation["statements"] = [
  { kind: "FACT", ref: "pursuit.account_name", text: "Account is Acme Corporation.", provenance: "pursuit.account_name" },
]): IntentExecution => ({ kind: "RESULT", outcome: { ok: true, result: resultSet(), explanation: explanation(statements) } });

/** EXPLAIN whose governed execution succeeded but disclosed NO subject. */
const explainNoSubject = (): IntentExecution =>
  ({ kind: "RESULT", outcome: { ok: true, result: { ...resultSet(), rows: [], counts: { authorized: 0 } } } });

const goToOk = (): IntentExecution => ({
  kind: "NAVIGATION",
  outcome: { ok: true, target: { ref: { class: "pursuit", id: ID0 }, surface: "canonical", path: `/pursuits/${ID0}`, label: "Acme Corporation" } },
});
const goToNotAvailable = (): IntentExecution => ({ kind: "NAVIGATION", outcome: { ok: false, error: "NOT_AVAILABLE" } });
const goToUnavailableTarget = (): IntentExecution => ({ kind: "NAVIGATION", outcome: { ok: false, error: "UNAVAILABLE_TARGET" } });

const showMeOk = (): IntentExecution => ({ kind: "RESULT", outcome: { ok: true, result: resultSet() } });

const ROUTE = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
const ASSEMBLE = readFileSync(new URL("../src/lib/experience/surface/assemble.ts", import.meta.url), "utf8");
const AVAILABILITY = readFileSync(new URL("../src/lib/experience/surface/availability.ts", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── THE FIRST VERTICAL ──────────────────────────────────────────────────────────────────────────

test("the ruled first vertical compiles: EXPLAIN and GO TO bound INDEPENDENTLY to the SAME slot", () => {
  const r = compile(spec());
  assert.ok(r.ok, r.ok ? "" : r.detail);
  if (!r.ok) return;
  assert.equal(r.validated.components.length, 2);
  assert.deepEqual(r.validated.components.map((c) => c.component), ["pursuit.explanation", "pursuit.destination"]);

  // BOTH resolved the SAME canonical object — that is the property this slice exists to prove.
  const explain = stat(r.validated.components[0]).intent.request as { subjectId: string };
  const goto = stat(r.validated.components[1]).intent.request as { ref: { id: string } };
  assert.equal(explain.subjectId, ID0);
  assert.equal(goto.ref.id, ID0);
  assert.equal(explain.subjectId, goto.ref.id, "one slot, two independent bindings");

  // Titles and recipient-facing wording are REGISTRY-owned, and name the CLASS, never the object.
  assert.equal(r.validated.components[0].title, COMPONENTS["pursuit.explanation"].title);
  assert.equal(r.validated.components[1].title, COMPONENTS["pursuit.destination"].title);
  for (const c of r.validated.components) {
    assert.equal(stat(c).intent.interpretedAs.includes("this pursuit"), true);
    assert.ok(!stat(c).intent.interpretedAs.includes(ID0), "the operation statement never names the object");
    assert.ok(!stat(c).intent.interpretedAs.includes("Acme"), "nor its label");
  }
});

test("each component binds only its own registered operation — explanation cannot become navigation", () => {
  const swapped = compile(spec({ components: [{ component: "pursuit.explanation", bind: GOTO.bind }] }));
  assert.equal(swapped.ok, false);
  if (!swapped.ok) assert.match(swapped.detail, /binds EXPLAIN, not GO_TO/);
  const other = compile(spec({ components: [{ component: "pursuit.destination", bind: EXPLAIN.bind }] }));
  assert.equal(other.ok, false);
  if (!other.ok) assert.match(other.detail, /binds GO_TO, not EXPLAIN/);
});

test("the two components are DIFFERENT types, so the Slice 6 one-per-type rule still admits both", () => {
  assert.ok(compile(spec()).ok);
  // TWO GUARDS, and they are distinct. Two explanations of the SAME slot are an exact semantic
  // duplicate, caught by canonical identity — the compiled requests are byte-equal after resolution.
  const twice = compile(spec({ components: [EXPLAIN, { ...EXPLAIN }] }));
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.match(twice.detail, /duplicate component pursuit\.explanation/);
  // Two explanations of DIFFERENT slots are NOT semantic duplicates — their compiled requests differ.
  // They are refused by the narrower Slice 6 one-per-type rule, which a later slice may relax.
  const twoSlots = compile(spec({ components: [EXPLAIN, { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 1 } } }] }));
  assert.equal(twoSlots.ok, false);
  if (!twoSlots.ok) assert.match(twoSlots.detail, /repeated component type pursuit\.explanation/);
});

// ── A RAW IDENTIFIER IS UNREPRESENTABLE ─────────────────────────────────────────────────────────

test("a raw UUID cannot substitute for a context slot, in any position", () => {
  const attempts: unknown[] = [
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: ID0 } },
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { id: ID0 } } },
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { subjectId: ID0 } } },
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 0 }, subjectId: ID0 } },
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subjectId: ID0 } },
    { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0, id: ID0 }, surface: "canonical" } },
    { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical", path: `/pursuits/${ID0}` } },
    { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface: `/pursuits/${ID0}` } },
  ];
  for (const c of attempts) {
    const r = compile(spec({ components: [c] }));
    assert.equal(r.ok, false, `must be refused: ${JSON.stringify(c)}`);
  }
});

test("a resolved id reached the compiled request ONLY by resolution, never by being supplied", () => {
  // The spec bytes contain no identifier at all; the compiled request does. That gap is the proof.
  assert.ok(!JSON.stringify(spec()).includes(ID0), "the submitted spec names no object");
  const r = compile(spec());
  assert.ok(r.ok);
  if (r.ok) assert.ok(JSON.stringify(r.validated.components.map((c) => stat(c).intent.request)).includes(ID0));
});

// ── SLOT REFERENCES REFUSE BEFORE EXECUTION ─────────────────────────────────────────────────────

test("out-of-range, negative and non-integer slots refuse at COMPILE time — nothing executes", () => {
  for (const fromContext of [2, 99, -1, -0.5, 1.5, NaN, Infinity, "0", null, true, {}, []]) {
    const r = compile(spec({ components: [{ component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext } } }] }));
    assert.equal(r.ok, false, `fromContext=${String(fromContext)} must be refused`);
  }
  // In range still works, so the refusals above are discriminating rather than blanket.
  assert.ok(compile(spec({ components: [{ component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 1 } } }] })).ok);
});

test("a STALE boundContextDigest refuses before execution, and refuses the WHOLE surface", () => {
  const r = compile(spec(), { digest: "0000000000000000" });
  assert.equal(r.ok, false, "a spec bound to a different manifest must not resolve");
  // The same spec against its own manifest compiles — the refusal is the digest, not the spec.
  assert.ok(compile(spec()).ok);
});

test("NEGATIVE CONTROL: bypassing the digest binding would let a stale spec resolve", () => {
  // Proves the previous test bites. Passing the manifest's OWN digest is exactly what the binding
  // check would degrade to if it were removed, and it flips the outcome.
  const bound = compile(spec(), { digest: MANIFEST.digest });
  const stale = compile(spec(), { digest: "0000000000000000" });
  assert.ok(bound.ok && !stale.ok, "the digest is load-bearing, not decorative");
});

// ── MANIFEST REORDER / IDENTITY REPLACEMENT ─────────────────────────────────────────────────────

test("reordering the manifest changes its digest, so a bound spec cannot be silently retargeted", () => {
  const reordered = buildContextManifest([row(ID1, "Globex"), row(ID0)]);
  assert.notEqual(reordered.digest, MANIFEST.digest);
  // The spec bound to the ORIGINAL manifest refuses against the reordered one.
  const r = compile(spec(), { manifest: reordered, digest: MANIFEST.digest });
  assert.equal(r.ok, false, "a spec cannot be replayed against a reordered manifest");

  // Re-binding to the reordered manifest resolves the OTHER object — visibly, not silently.
  const rebound = compile(spec(), { manifest: reordered });
  assert.ok(rebound.ok);
  if (rebound.ok) assert.equal((stat(rebound.validated.components[0]).intent.request as { subjectId: string }).subjectId, ID1);
});

test("IDENTICAL visible labels but DIFFERENT canonical identities produce different execution identity", () => {
  // The labels are byte-identical; only the hidden ids differ. This is the §N replay requirement.
  const a = buildContextManifest([row(ID0, "Acme Corporation")]);
  const b = buildContextManifest([row(ID1, "Acme Corporation")]);
  assert.deepEqual(a.slots, b.slots, "the recipient sees the same labels in both");
  assert.notEqual(a.digest, b.digest, "contextDigest distinguishes them");

  const one = compile(spec({ components: [EXPLAIN] }), { manifest: a });
  const two = compile(spec({ components: [EXPLAIN] }), { manifest: b });
  assert.ok(one.ok && two.ok);
  if (!one.ok || !two.ok) return;
  // RULING A: surfaceSpecDigest is a POST-COMPILATION execution-identity digest, so it differs too.
  assert.notEqual(one.validated.provenance.surfaceSpecDigest, two.validated.provenance.surfaceSpecDigest);
  assert.notEqual(one.validated.provenance.contextDigest, two.validated.provenance.contextDigest);
});

test("RULING A: the asymmetry is real — SHOW_ME/ANALYZE stay identity-INDEPENDENT", () => {
  const a = buildContextManifest([row(ID0)]);
  const b = buildContextManifest([row(ID1)]);
  const list = { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" } };
  const one = compile(spec({ components: [list] }), { manifest: a });
  const two = compile(spec({ components: [list] }), { manifest: b });
  assert.ok(one.ok && two.ok);
  if (!one.ok || !two.ok) return;
  // No object is bound, so execution identity is the same; the PAIR still distinguishes the replay.
  assert.equal(one.validated.provenance.surfaceSpecDigest, two.validated.provenance.surfaceSpecDigest);
  assert.notEqual(one.validated.provenance.contextDigest, two.validated.provenance.contextDigest);
});

test("replay identity is the PAIR, and both halves are stamped separately", () => {
  const r = compile(spec());
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = r.validated.provenance;
  assert.equal(typeof p.surfaceSpecDigest, "string");
  assert.equal(p.contextDigest, MANIFEST.digest, "the context digest binds the ordered manifest");
  assert.notEqual(p.surfaceSpecDigest, p.contextDigest, "two independent halves, not one value twice");
  // Recompiling the same spec against the same manifest reproduces both.
  const again = compile(spec());
  assert.ok(again.ok);
  if (again.ok) {
    assert.equal(again.validated.provenance.surfaceSpecDigest, p.surfaceSpecDigest);
    assert.equal(again.validated.provenance.contextDigest, p.contextDigest);
  }
});

// ── THE DISCLOSURE CONSTRAINT ON RULING A ───────────────────────────────────────────────────────

test("RULING A: no raw resolved identifier is serialized into provenance, though a digest used one", () => {
  const r = compile(spec());
  assert.ok(r.ok);
  if (!r.ok) return;
  const provenance = JSON.stringify(r.validated.provenance);
  assert.ok(!provenance.includes(ID0), "the resolved id does not appear in provenance");
  assert.ok(!provenance.includes(ID1));
  assert.ok(!provenance.includes("Acme"), "nor any governed label");
  // Digests are fixed-width hex, so they cannot be carrying an id in disguise.
  assert.match(r.validated.provenance.surfaceSpecDigest, /^[0-9a-f]{16}$/);
  assert.match(r.validated.provenance.contextDigest, /^[0-9a-f]{16}$/);
});

test("the route renders no surface provenance — SCOPED to the region that renders (§16D)", () => {
  const body = strip(ROUTE);

  // These never appear anywhere in the route, in any position.
  for (const field of ["surfaceSpecDigest", "contextDigest", "vocabularyDigest", "componentRegistryDigest", "compilerVersion"]) {
    assert.ok(!body.includes(field), `the route must not mention ${field}`);
  }

  // `promptTemplateVersion` DOES appear — as a compile INPUT the transport supplies, never as output.
  // Asserting its absence file-wide would be false; asserting its POSITION is the real property.
  const mentions = body.split("\n").filter((l) => l.includes("promptTemplateVersion"));
  assert.ok(mentions.length > 0, "the input exists, so this assertion is not vacuous");
  for (const line of mentions) {
    assert.match(line.trim(), /^promptTemplateVersion: fromModel \? [A-Z_]+ : null,$/, "input position only");
  }

  // THE RENDERING REGION owns the property, so it is asserted there: the surface renderer never
  // touches provenance at all. (`provenance` elsewhere in the file is the certified Slice 1–3
  // registry provenance of metrics, aggregates and explanation statements.)
  const render = body.slice(body.indexOf("function SurfaceRender"), body.indexOf("function Navigation"));
  assert.ok(render.length > 200, "the SurfaceRender body was located");
  assert.ok(!render.includes("provenance"), "the surface renderer reads no provenance");
  assert.ok(!/result\.provenance/.test(body), "nothing reads provenance off a SurfaceResult");
});

// ── WHOLE-SURFACE ATOMICITY (ruling B) ──────────────────────────────────────────────────────────

const executed = (...pairs: [string, IntentExecution][]): ExecutedComponent[] =>
  pairs.map(([operation, execution]) => ({ operation: operation as ExecutedComponent["operation"], execution }));

test("a healthy first vertical is AVAILABLE", () => {
  assert.equal(surfaceDisposition(executed(["EXPLAIN", explainOk()], ["GO_TO", goToOk()])), "AVAILABLE");
});

test("governance lost after manifest creation fails the WHOLE surface — NO SIBLING SURVIVES", () => {
  // EXPLAIN succeeded. GO TO did not. The surface is unavailable, and the healthy sibling does not
  // carry it: this is the exact partial-surface state the slice exists to make impossible.
  assert.equal(surfaceDisposition(executed(["EXPLAIN", explainOk()], ["GO_TO", goToNotAvailable()])), "NOT_AVAILABLE");
  // And symmetrically, with the failure in the other position.
  assert.equal(surfaceDisposition(executed(["EXPLAIN", explainNoSubject()], ["GO_TO", goToOk()])), "NOT_AVAILABLE");
  // Order is irrelevant: a failure anywhere in the set decides the set.
  assert.equal(surfaceDisposition(executed(["GO_TO", goToNotAvailable()], ["EXPLAIN", explainOk()])), "NOT_AVAILABLE");
});

test("a majority of healthy components cannot outvote one unavailable target", () => {
  assert.equal(surfaceDisposition(executed(
    ["SHOW_ME", showMeOk()], ["ANALYZE", showMeOk()], ["EXPLAIN", explainOk()], ["GO_TO", goToNotAvailable()],
  )), "NOT_AVAILABLE");
});

test("RULING B: UNAVAILABLE_TARGET collapses to whole-surface unavailable inside a surface", () => {
  // Standalone, Slice 4 distinguishes this from NOT_AVAILABLE and says so. Composed, it does not:
  // an intentional information reduction, and the two produce the SAME value here.
  assert.equal(surfaceDisposition(executed(["GO_TO", goToUnavailableTarget()])), "NOT_AVAILABLE");
  assert.equal(
    surfaceDisposition(executed(["GO_TO", goToUnavailableTarget()])),
    surfaceDisposition(executed(["GO_TO", goToNotAvailable()])),
    "the two causes are indistinguishable in a composed surface",
  );
});

test("every GOVERNED cause produces the SAME value — no governed cause is distinguishable", () => {
  const governed: IntentExecution[] = [
    goToNotAvailable(),        // unauthorized OR nonexistent — already one value at the boundary
    goToUnavailableTarget(),   // existence authorized, no usable destination
    explainNoSubject(),        // the governed read admitted no row to explain
  ];
  const values = new Set(governed.map((c, i) =>
    surfaceDisposition(executed([i === 2 ? "EXPLAIN" : "GO_TO", c]))));
  assert.deepEqual([...values], ["NOT_AVAILABLE"], "one value for every governed cause");
});

/**
 * THE CLARIFICATION, MADE EXECUTABLE.
 *
 * > `NOT_AVAILABLE` is the recipient-safe collapse of GOVERNED object availability, not generic
 * > error masking.
 *
 * This test previously asserted the OPPOSITE — that a malformed request, a lost entitlement and an
 * invalid plan all collapsed into governed `NOT_AVAILABLE` too. They must not: an application defect
 * wearing a disclosure word is both a false statement about governance and a lost bug.
 */
test("an APPLICATION failure is never relabelled as governed unavailability", () => {
  const defects: [string, IntentExecution][] = [
    ["GO_TO", { kind: "NAVIGATION", outcome: { ok: false, error: "INVALID_REQUEST", detail: "x" } }],
    ["EXPLAIN", { kind: "RESULT", outcome: { ok: false, error: "INVALID_PLAN", detail: "x" } }],
    // The subject WAS authorized, and an explanation still did not come back: a template defect.
    ["EXPLAIN", { kind: "RESULT", outcome: { ok: true, result: resultSet(), explanationError: "unknown explanation template" } }],
  ];
  for (const [op, execution] of defects) {
    assert.equal(componentDisposition(op as IntentOperation, execution), "FAILED", `${op} defect must be FAILED`);
    assert.equal(surfaceDisposition(executed([op, execution])), "FAILED");
  }
  // The entitlement conjunction keeps its OWN meaning: organization-wide, identical for every
  // object, and therefore not a statement about any object.
  const denied: IntentExecution = { kind: "RESULT", outcome: { ok: false, error: "CAPABILITY_DENIED", detail: "x" } };
  assert.equal(componentDisposition("EXPLAIN", denied), "CAPABILITY_DENIED");
  assert.equal(surfaceDisposition(executed(["EXPLAIN", denied])), "CAPABILITY_DENIED");
});

test("precedence is DEFECT-FIRST, so a bug cannot hide behind a governed absence", () => {
  const defect: IntentExecution = { kind: "NAVIGATION", outcome: { ok: false, error: "INVALID_REQUEST", detail: "x" } };
  // A governed absence and a defect in the same surface: the DEFECT decides, in either order.
  assert.equal(surfaceDisposition(executed(["EXPLAIN", explainNoSubject()], ["GO_TO", defect])), "FAILED");
  assert.equal(surfaceDisposition(executed(["GO_TO", defect], ["EXPLAIN", explainNoSubject()])), "FAILED");
  // NEGATIVE CONTROL: without the defect the same set is governed-unavailable, so the ordering above
  // is doing real work rather than agreeing with what would have been returned anyway.
  assert.equal(surfaceDisposition(executed(["EXPLAIN", explainNoSubject()], ["GO_TO", goToOk()])), "NOT_AVAILABLE");
});

test("the four dispositions are distinct — none is an alias for another", () => {
  const seen = new Set([
    surfaceDisposition(executed(["EXPLAIN", explainOk()], ["GO_TO", goToOk()])),
    surfaceDisposition(executed(["GO_TO", goToNotAvailable()])),
    surfaceDisposition(executed(["EXPLAIN", { kind: "RESULT", outcome: { ok: false, error: "CAPABILITY_DENIED", detail: "x" } }])),
    surfaceDisposition(executed(["EXPLAIN", { kind: "RESULT", outcome: { ok: false, error: "INVALID_PLAN", detail: "x" } }])),
  ]);
  assert.deepEqual([...seen].sort(), ["AVAILABLE", "CAPABILITY_DENIED", "FAILED", "NOT_AVAILABLE"]);
});

test("RULING B: an AVAILABLE target whose VALUES are withheld still renders — governance working", () => {
  // A WITHHELD statement is Slice 2 behaving correctly inside a valid component. It is NOT a failure,
  // and treating it as one would hide legitimate governed output behind an availability error.
  const withheld = explainOk([
    { kind: "WITHHELD", ref: "pursuit.amount_usd", text: "This value isn't available to you." },
    { kind: "OPERATION", ref: "pursuit.explain", text: "Some statements were withheld." },
  ]);
  assert.equal(componentDisposition("EXPLAIN", withheld), "AVAILABLE");
  assert.equal(surfaceDisposition(executed(["EXPLAIN", withheld], ["GO_TO", goToOk()])), "AVAILABLE");
});

test("an EXPLAIN with no authorized subject is NOT_AVAILABLE, not an empty success", () => {
  assert.equal(componentDisposition("EXPLAIN", explainNoSubject()), "NOT_AVAILABLE");
});

test("SHOW_ME and ANALYZE bind no object, so an empty authorized set is a governed ANSWER", () => {
  const empty: IntentExecution = { kind: "RESULT", outcome: { ok: true, result: { ...resultSet(), rows: [], counts: { authorized: 0 } } } };
  assert.equal(componentDisposition("SHOW_ME", empty), "AVAILABLE");
  assert.equal(componentDisposition("ANALYZE", empty), "AVAILABLE");
  assert.equal(surfaceDisposition(executed(["SHOW_ME", empty])), "AVAILABLE");
});

test("the atomic rule is keyed on the OPERATION, and every context-bound operation is covered", () => {
  assert.deepEqual([...CONTEXT_BOUND_OPERATIONS].sort(), ["EXPLAIN", "GO_TO"]);
  assert.ok(isContextBound("EXPLAIN") && isContextBound("GO_TO"));
  assert.ok(!isContextBound("SHOW_ME") && !isContextBound("ANALYZE"));
  // Every registered component whose compiled request carries an object reference is classified.
  const r = compile(spec());
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const c of r.validated.components) {
    const carriesObject = JSON.stringify(stat(c).intent.request).includes(ID0);
    assert.equal(carriesObject, isContextBound(c.operation), `${c.component} classification must match its request`);
  }
});

test("NEGATIVE CONTROL: classifying GO_TO as unbound would let a failed sibling survive", () => {
  // Proves the rule bites. `surfaceAvailability` skips components it thinks are unbound, so a wrong
  // classification is exactly how a partial surface would reappear.
  const set = executed(["EXPLAIN", explainOk()], ["GO_TO", goToNotAvailable()]);
  assert.equal(surfaceDisposition(set), "NOT_AVAILABLE");
  const misclassified = set.map((e) => ({ ...e, operation: "SHOW_ME" as const }));
  assert.equal(surfaceDisposition(misclassified), "AVAILABLE", "the control reaches the opposite state");
});

// ── THE OUTCOME CANNOT DESCRIBE THE FAILURE ─────────────────────────────────────────────────────

/** Every `{ ok: false, ... }` the assembler can return carries EXACTLY `ok` and `error`. */
const bareFailures = (src: string) => {
  const returns = src.match(/return \{ ok: false[^}]*\}/g) ?? [];
  return returns.length > 0 && returns.every((r) => /^return \{ ok: false, error: [A-Za-z_."]+ \}$/.test(r));
};

test("every whole-surface failure is BARE — no component, reason, index or count — STRUCTURAL", () => {
  const body = strip(ASSEMBLE);
  assert.ok(bareFailures(body), "every failure return carries only ok and error");
  // The schema has no field to put one in, for either failure the atomic rule can produce.
  const schema = readFileSync(new URL("../src/lib/experience/surface/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /\{ ok: false; error: "NOT_AVAILABLE" \}/, "the governed variant is bare");
  assert.match(schema, /\{ ok: false; error: "FAILED" \}/, "the application variant is bare");
  // `INVALID` is the Slice 6 COMPILE-time rejection and does carry a detail; prove it is not one of
  // the values the assembler can return, so no execution-time detail can reach a recipient this way.
  assert.ok(!/"INVALID"/.test(body), "the assembler cannot return the detail-carrying variant");
});

test("the assembler has exactly ONE success return, and it is guarded by the atomic decision", () => {
  const body = strip(ASSEMBLE);
  const successes = body.match(/return\s*\{\s*ok:\s*true/g) ?? [];
  assert.equal(successes.length, 1, "one way to succeed");
  const guard = body.indexOf("surfaceDisposition(executed)");
  const success = body.indexOf("return { ok: true");
  assert.ok(guard > 0, "the atomic decision is present");
  assert.ok(success > 0, "the success return is present");
  assert.ok(guard < success, "the decision precedes the only success return");
});

test("the availability module is a CLASSIFIER — it reaches no database, principal or provider", () => {
  const body = strip(AVAILABILITY);
  for (const forbidden of ["withTenant", "principal", "pool", "query(", "ai/client", "anthropic", "completeStructured", "executePursuitQuery", "resolveGoTo"]) {
    assert.ok(!body.includes(forbidden), `availability.ts must not reference ${forbidden}`);
  }
});

// ── THE TRANSPORT INVARIANT ─────────────────────────────────────────────────────────────────────

test("no component markup can exist before the atomic decision — STRUCTURAL", () => {
  const body = strip(ROUTE);
  const view = body.slice(body.indexOf("async function SurfaceView"), body.indexOf("function SurfaceRender"));
  assert.ok(view.length > 100, "the SurfaceView body was located");
  // The renderer is reached from exactly one place, and only after the outcome was checked.
  const decision = view.indexOf("assembled.ok");
  const render = view.indexOf("<SurfaceRender");
  assert.ok(decision > 0 && render > 0, "both the check and the render are present");
  assert.ok(decision < render, "the outcome is settled before the renderer is named");
  // No streaming boundary inside the surface path: React receives a finalized value or nothing.
  for (const streaming of ["Suspense", "use client", "ReadableStream", "renderToPipeableStream", "after("]) {
    assert.ok(!body.includes(streaming), `the surface path must not use ${streaming}`);
  }
});

test("each disposition gets ONE fixed sentence, and none names a component", () => {
  const body = strip(ROUTE);
  const view = body.slice(body.indexOf("async function SurfaceView"), body.indexOf("function SurfaceRender"));
  // Governed absence and application failure say DIFFERENT things, by ruling; neither says more.
  assert.match(view, /assembled\.error === "NOT_AVAILABLE"\) return notice\("That surface is not available\."\)/);
  assert.match(view, /assembled\.error === "FAILED"\) return notice\("That surface could not be completed\."\)/);
  // Every notice argument in the surface path is a STRING LITERAL — never an interpolated value.
  const notices = view.match(/notice\([^)]*\)/g) ?? [];
  assert.ok(notices.length >= 4, "the notices were located");
  for (const n of notices) assert.match(n, /^notice\("[^"$`]*"\)$/, `${n} must be a fixed sentence`);
  assert.ok(!/compiled\.detail|assembled\.detail/.test(view));
  for (const leak of ["pursuit.explanation", "pursuit.destination", "EXPLAIN", "GO_TO"]) {
    assert.ok(!view.includes(leak), `the surface transport must not name ${leak}`);
  }
});

test("NEGATIVE CONTROL: the failure notice differs from the capability notice", () => {
  // If both said the same thing, the previous test would pass while proving nothing about atomicity.
  const body = strip(ROUTE);
  assert.ok(body.includes("That surface is not available."));
  assert.ok(body.includes("Surfaces are not enabled here."));
  assert.notEqual("That surface is not available.", "Surfaces are not enabled here.");
});

// ── COMPONENT-TO-COMPONENT BINDING IS UNREPRESENTABLE ───────────────────────────────────────────

test("no component-result reference is structurally representable, in bind or in the component", () => {
  const references: Record<string, unknown>[] = [
    { operation: "EXPLAIN", subject: { fromComponent: 0 } },
    { operation: "EXPLAIN", subject: { fromResult: 0 } },
    { operation: "EXPLAIN", subject: { fromContext: 0, fromComponent: 1 } },
    { operation: "EXPLAIN", subject: { row: 0 } },
    { operation: "EXPLAIN", subject: { fromContext: 0 }, fromComponent: 0 },
    { operation: "EXPLAIN", subject: { fromContext: 0 }, source: "pursuit.list" },
    { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical", label: "Acme Corporation" },
    { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical", from: "pursuit.list" },
  ];
  for (const bind of references) {
    const r = compile(spec({ components: [{ component: "pursuit.explanation", bind }] }));
    assert.equal(r.ok, false, `must be refused: ${JSON.stringify(bind)}`);
  }
  // At the component level too — there is no key beside `component` and `bind`.
  for (const extra of ["from", "input", "uses", "after", "context", "rows"]) {
    const r = compile(spec({ components: [{ ...EXPLAIN, [extra]: 0 }] }));
    assert.equal(r.ok, false, `component key ${extra} must be refused`);
    if (!r.ok) assert.match(r.detail, /unknown component key/);
  }
});

test("NEGATIVE CONTROL: the valid shape those attempts deviate from does compile", () => {
  // Without this, every assertion above could be passing for the wrong reason.
  assert.ok(compile(spec({ components: [EXPLAIN] })).ok);
});

/**
 * SUPERSEDED IN PART BY SLICE 8, deliberately and in one direction only.
 *
 * This originally asserted that NOTHING is threaded between components. Slice 8 threads exactly one
 * thing — a `DerivedIdentityContext` — along an edge the compiler validated. What the test was
 * actually protecting is kept and made sharper: no component may receive another's RESULT, ROW or
 * PAYLOAD, and the assembler may not build or mutate recipient context.
 */
test("only IDENTITY flows between components — never a result, row or payload", () => {
  const body = strip(ASSEMBLE);
  // The recipient's context is not built, extended or resolved against here.
  assert.ok(!/buildContextManifest/.test(body), "the assembler builds no recipient context");
  // A downstream component's compiler input is the NARROW ADAPTER, never a result or a row.
  assert.match(body, /manifest: asResolutionContext\(derived\)/);
  assert.ok(!/manifest:\s*(outcome|result|rows)/.test(body), "no result is ever passed as context");
  // No component's cells are read anywhere in the assembler.
  assert.ok(!/\.cells\b/.test(body), "the assembler never reads a governed cell");
  // Execution still takes a COMPILED intent only; there is no path from an outcome back into a bind.
  assert.match(body, /runCompiledIntent\(intent, principal\)/);
});

test("an empty manifest makes context-bound components uncomposable — not silently empty", () => {
  const r = compile(spec(), { manifest: buildContextManifest([]) });
  assert.equal(r.ok, false, "a surface cannot name a slot that does not exist");
  if (!r.ok) assert.match(r.detail, /did not compile/);
});

// ── THE MODEL BOUNDARY ──────────────────────────────────────────────────────────────────────────

test("the surface prompt offers the two new components and NO identifier or result", () => {
  const prompt = surfacePromptForAudit(MANIFEST);
  assert.ok(!prompt.includes(ID0) && !prompt.includes(ID1), "no canonical identifier reaches the model");
  for (const forbidden of ["subjectId", "amount_usd", "org_id", "SELECT", "/pursuits/", "planDigest"]) {
    assert.ok(!prompt.includes(forbidden), `the prompt must not contain ${forbidden}`);
  }
  assert.match(prompt, /pursuit\.explanation/);
  assert.match(prompt, /pursuit\.destination/);
  // It offers the slots as INDEXED LABELS only — the Slice 5 representation, unchanged.
  assert.match(prompt, /fromContext/);
  assert.match(prompt, /\[0\] Acme Corporation/);
  assert.match(prompt, /\[1\] Globex/);
});

test("still exactly ONE module in the P7 tree reaches a provider — Slice 7 added none", () => {
  for (const f of ["surface/compile.ts", "surface/assemble.ts", "surface/registry.ts", "surface/schema.ts", "surface/availability.ts"]) {
    const src = readFileSync(new URL(`../src/lib/experience/${f}`, import.meta.url), "utf8");
    assert.ok(!/ai\/client|anthropic|completeStructured/i.test(src), `${f} must not reach a provider`);
  }
});

test("hand-authored and model-authored identical specs compile to identical execution", () => {
  const hand = compile(spec(), { source: "HAND_AUTHORED" });
  const model = compileSurface({ spec: spec(), manifest: MANIFEST, boundContextDigest: MANIFEST.digest, source: "MODEL", modelId: "claude-x", promptTemplateVersion: "p@1" });
  assert.ok(hand.ok && model.ok);
  if (!hand.ok || !model.ok) return;
  // The EXECUTION is identical; only provenance records which path produced it.
  assert.deepEqual(
    hand.validated.components.map((c) => [c.component, c.operation, stat(c).intent.request, stat(c).intent.interpretedAs]),
    model.validated.components.map((c) => [c.component, c.operation, stat(c).intent.request, stat(c).intent.interpretedAs]),
  );
  assert.equal(hand.validated.provenance.surfaceSpecDigest, model.validated.provenance.surfaceSpecDigest);
  assert.equal(hand.validated.provenance.source, "HAND_AUTHORED");
  assert.equal(model.validated.provenance.source, "MODEL");
  // A hand-authored spec records no model that never ran.
  assert.equal(hand.validated.provenance.modelId, null);
  assert.equal(model.validated.provenance.modelId, "claude-x");
});

// ── THE CERTIFIED BOUNDARIES ARE THE ONLY ONES ──────────────────────────────────────────────────

test("EXPLAIN and GO TO execute through the Slice 2 and Slice 4 boundaries, unchanged", () => {
  const run = strip(readFileSync(new URL("../src/lib/experience/intent/run.ts", import.meta.url), "utf8"));
  assert.match(run, /executePursuitQuery\(explainPlanFor\(subjectId\), principal\)/);
  assert.match(run, /resolveGoTo\(intent\.request, principal\)/);
  // No plan is authored and no path is formed in the execution path Slice 7 uses.
  assert.ok(!/JSON\.parse|`\/pursuits\//.test(run));
});

test("GO TO destinations come only from the registry — the spec cannot name a route", () => {
  for (const surface of ["admin", "canonical/../admin", "/pursuits/x", "CANONICAL", ""]) {
    const r = compile(spec({ components: [{ component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface } }] }));
    assert.equal(r.ok, false, `surface=${surface} must be refused`);
  }
  assert.ok(compile(spec({ components: [GOTO] })).ok, "the one registered surface still compiles");
});

test("no write, schema, P5 or P6 change — Slice 7 touched no governance module", () => {
  for (const f of ["surface/availability.ts", "surface/assemble.ts", "surface/compile.ts", "surface/registry.ts"]) {
    const src = readFileSync(new URL(`../src/lib/experience/${f}`, import.meta.url), "utf8");
    for (const forbidden of ["insert ", "update ", "delete ", "mayDerive", "resolveDisclosure", "buildFederationViewer"]) {
      assert.ok(!src.toLowerCase().includes(forbidden.toLowerCase()), `${f} must not contain ${forbidden}`);
    }
  }
});

// ── MANIFEST POSSESSION IS NOT AUTHORIZATION ────────────────────────────────────────────────────

test("manifest membership is identity binding, NOT durable authorization", () => {
  // The spec COMPILES — the slot exists and resolves. That is the whole of what a manifest confers.
  const r = compile(spec());
  assert.ok(r.ok, "manifest membership lets the spec compile");
  if (!r.ok) return;

  // The very same components, executed later against governance that has moved, are unavailable.
  // Compile success did not carry forward, and could not: it is not an input to this decision.
  const sameComponents = executed(
    ["EXPLAIN", explainOk()],
    ["GO_TO", goToNotAvailable()],
  );
  assert.equal(surfaceDisposition(sameComponents), "NOT_AVAILABLE",
    "valid at compile time does not imply authorized at execution time");

  // STRUCTURAL: the validated spec carries no cached authorization decision for it to have trusted.
  const serialized = JSON.stringify(r.validated);
  for (const cached of ["authorized", "allowed", "permitted", "canSee", "granted", "principal"]) {
    assert.ok(!serialized.toLowerCase().includes(cached.toLowerCase()),
      `the validated spec must not cache ${cached}`);
  }
});

test("NEGATIVE CONTROL: the availability decision does not consult the compiled spec at all", () => {
  // `surfaceAvailability` takes ONLY operations and already-governed executions. If it could read
  // the validated spec, "it compiled, so it is fine" would be expressible. Its signature refuses.
  const body = strip(AVAILABILITY);
  assert.ok(!/ValidatedSurfaceSpec|validated|SurfaceSpec/.test(body),
    "the decision cannot see the spec it is deciding about");
  // And it bites: identical executions decide identically regardless of which spec produced them.
  const set = executed(["EXPLAIN", explainOk()], ["GO_TO", goToNotAvailable()]);
  assert.equal(surfaceDisposition(set), surfaceDisposition([...set].reverse()));
});

// ── A CONTROL ON THE CHECKER ITSELF ─────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: a component-specific failure reason would be CAUGHT, not missed", () => {
  // The structural test above asserts the failure return carries nothing. A structural assertion is
  // worthless if it would also pass against the defect it exists to catch — so the defect is
  // constructed here, in memory, and the SAME check is re-run against it.
  const body = strip(ASSEMBLE);
  assert.equal(bareFailures(body), true, "canonical code passes");

  const leaky = body.replace("return { ok: false, error: disposition }", "return { ok: false, error: disposition, detail: c.component }");
  assert.notEqual(leaky, body, "the mutation actually applied");
  assert.equal(bareFailures(leaky), false, "a leaked component key is caught");

  const second = body.replace("return { ok: true", 'return { ok: false, error: "NOT_AVAILABLE", reason: "goto" };\n  return { ok: true');
  assert.notEqual(second, body, "the mutation actually applied");
  assert.equal(bareFailures(second), false, "a second, more informative failure path is caught");
});
