import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileSurface } from "../src/lib/experience/surface/compile";
import { COMPONENTS } from "../src/lib/experience/surface/registry";
import { actionCapability } from "../src/lib/experience/surface/actions";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import { surfacePromptForAudit } from "../src/lib/experience/intent/model";
import type { ValidatedComponent } from "../src/lib/experience/surface/schema";
import type { GovernedCell, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 10 — GOVERNED ACTIONS ON COMPONENT-DERIVED SUBJECTS.
 *
 * > **A component-derived identity may determine which governed subject an action affordance refers
 * > to. It may never carry action authority across the render-to-click boundary.**
 *
 * The properties that can only be proven HOSTED are named as such rather than approximated here: that
 * the deployed transport carries no plaintext canonical id, and that a foreign principal cannot reuse
 * a binding. What is provable locally is the shape of the graph, the placement of the integrity
 * material, and the absence of every path by which a subject could be redefined.
 */

const ID0 = "11111111-2222-4333-8444-555555555555";
const ID1 = "99999999-8888-4777-8666-555555555555";

const cell = (v: string): GovernedCell =>
  ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED" });
const row = (id: string, name = "Acme Corporation"): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell(name) } });
const MANIFEST = buildContextManifest([row(ID0), row(ID1, "Globex")]);

const LIST = (view = "open-by-value") => ({ component: "pursuit.list", bind: { operation: "SHOW_ME", view } });
const DEP = (from = "pursuit.list", select = "first") => ({ fromComponent: from, select });
const EXPLAIN = (s: unknown = DEP()) => ({ component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: s } });
const GOTO = (s: unknown = DEP()) => ({ component: "pursuit.destination", bind: { operation: "GO_TO", subject: s, surface: "canonical" } });
const ACT = (s: unknown = DEP()) => ({ component: "pursuit.assemble_team", bind: { subject: s } });
const spec = (components: unknown[]) => ({ specVersion: 1, layout: "stack", components });
const VERTICAL = spec([LIST(), EXPLAIN(), GOTO(), ACT()]);
const compile = (s: unknown, manifest = MANIFEST) =>
  compileSurface({ spec: s, manifest, boundContextDigest: manifest.digest, source: "HAND_AUTHORED" });

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROUTE = SRC("app/experience/pursuits/page.tsx");
const BOUNDARY = SRC("app/experience/pursuits/actions.ts");
const BINDING = SRC("app/experience/pursuits/binding.ts");
const ASSEMBLE = SRC("lib/experience/surface/assemble.ts");
const COMPILE = SRC("lib/experience/surface/compile.ts");
const act = (c: ValidatedComponent) => {
  if (c.kind !== "ACTION") throw new Error(`expected an ACTION component, got ${c.kind}`);
  return c;
};

// ── THE FIRST VERTICAL ──────────────────────────────────────────────────────────────────────────

test("the ruled first vertical validates: SHOW ME → first → EXPLAIN + GO TO + ACTION", () => {
  const r = compile(VERTICAL);
  assert.ok(r.ok, r.ok ? "" : r.detail);
  if (!r.ok) return;
  assert.deepEqual(r.validated.components.map((c) => c.component),
    ["pursuit.list", "pursuit.explanation", "pursuit.destination", "pursuit.assemble_team"]);
  const a = act(r.validated.components[3]);
  assert.equal(a.subject.kind, "DERIVED", "the action subject is component-derived");
  assert.deepEqual(a.subject.kind === "DERIVED" && a.subject.dependency, { fromComponent: "pursuit.list", select: "first" });
  // All three consumers name the SAME upstream export and the SAME certified selector.
  const deps = r.validated.components.slice(1).map((c) =>
    c.kind === "DYNAMIC" ? c.dependency : c.kind === "ACTION" && c.subject.kind === "DERIVED" ? c.subject.dependency : null);
  assert.deepEqual(deps, [
    { fromComponent: "pursuit.list", select: "first" },
    { fromComponent: "pursuit.list", select: "first" },
    { fromComponent: "pursuit.list", select: "first" },
  ]);
  // NO canonical id exists anywhere at compile time — the subject does not yet exist.
  assert.ok(!JSON.stringify(r.validated.components).includes(ID0));
  assert.ok(!JSON.stringify(VERTICAL).includes(ID0), "and the spec never carried one");
});

test("the action still exports nothing, so it cannot begin a chain", () => {
  assert.equal(COMPONENTS["pursuit.assemble_team"].exportsIdentity, false);
  const chained = compile(spec([LIST(), ACT(), EXPLAIN(DEP("pursuit.assemble_team"))]));
  assert.equal(chained.ok, false, "a second level is unrepresentable");
  if (!chained.ok) assert.match(chained.detail, /does not export identity/);
});

// ── ONLY A CERTIFIED EXPORT MAY SUPPLY AN ACTION SUBJECT ────────────────────────────────────────

test("only the certified `first` export may supply the action subject", () => {
  for (const [label, s] of [
    ["uncertified plan", spec([LIST("recently-updated"), ACT()])],
    ["unknown selector", spec([LIST(), ACT(DEP("pursuit.list", "largest"))])],
    ["numeric ordinal", spec([LIST(), ACT({ fromComponent: "pursuit.list", select: 0 })])],
    ["ANALYZE as source", spec([{ component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } }, ACT(DEP("pursuit.cohort"))])],
    ["forward reference", spec([ACT(), LIST()])],
    ["self reference", spec([LIST(), ACT(DEP("pursuit.assemble_team"))])],
    ["absent upstream", spec([ACT()])],
  ]) {
    assert.equal(compile(s as never).ok, false, `${label} must be refused`);
  }
  assert.ok(compile(VERTICAL).ok, "NEGATIVE CONTROL: the valid graph still validates");
});

test("a raw subject id is still unrepresentable in an action bind", () => {
  for (const subject of [ID0, { id: ID0 }, { fromContext: 0, id: ID0 }, { fromComponent: "pursuit.list", select: "first", id: ID0 }]) {
    assert.equal(compile(spec([LIST(), ACT(subject)])).ok, false, `${JSON.stringify(subject)} must be refused`);
  }
});

test("the zero-argument contract is unchanged — no payload position exists", () => {
  for (const bind of [
    { subject: DEP(), args: {} }, { subject: DEP(), payload: {} },
    { subject: DEP(), skillId: "send_campaign_touch" }, { subject: DEP(), content: "x" },
  ]) {
    assert.equal(compile(spec([LIST(), { component: "pursuit.assemble_team", bind }])).ok, false, JSON.stringify(bind));
  }
  const cap = actionCapability("pursuit.assemble_team")!;
  assert.equal(cap.callerArguments, "NONE");
  assert.equal(cap.skillId, "assemble_pursuit_team");
  assert.equal(cap.substrate, "DISPATCH_SKILL");
});

// ── AN ACTION WITHOUT A SUBJECT IS NOT AN ACTION ────────────────────────────────────────────────

test("no subject means NO_SELECTABLE_RESULT — never an unbound affordance", () => {
  const body = strip(ASSEMBLE);
  assert.match(body, /c\.kind === "ACTION" && c\.subject\.kind === "DERIVED"[\s\S]{0,120}NO_SELECTABLE_RESULT/);
  // And no fallback to recipient context or a remembered pursuit exists anywhere near it.
  assert.ok(!/manifest|previous|lastSelected|remember/i.test(body.slice(body.indexOf("AN ACTION WITH NO SUBJECT") > 0 ? 0 : 0)) || !/lastSelected|remember/i.test(body));
  assert.ok(!/buildContextManifest/.test(body), "the assembler never falls back to recipient context");
});

test("the exporting component runs even when the ACTION is its only consumer", () => {
  const body = strip(ASSEMBLE);
  const fn = body.slice(body.indexOf("function selectorFor"));
  assert.match(fn, /c\.kind === "ACTION" && c\.subject\.kind === "DERIVED"/, "an ACTION counts as a consumer");
  assert.ok(compile(spec([LIST(), ACT()])).ok, "and such a graph validates");
});

// ── THE INVOCATION TRANSPORT IS A CLOSURE, NOT A BOUND ARGUMENT ─────────────────────────────────

test("the affordance closes over the binding — `.bind()` is gone", () => {
  const body = strip(ROUTE);
  const fn = body.slice(body.indexOf("async function ActionAffordance"), body.indexOf("* The resolved navigation target"));
  assert.ok(fn.length > 100, "the affordance renderer was located");
  assert.match(fn, /const binding = await currentRenderBinding\(component\.subjectId\)/);
  assert.match(fn, /const invoke = async \(\) => \{\s*"use server";/, "the action is defined as a CLOSURE");
  assert.match(fn, /action=\{invoke\}/);
  assert.ok(!/\.bind\(/.test(fn), "no bound argument remains — that transport was plaintext");
  assert.ok(!/<input/.test(fn), "no caller-controlled field is rendered");
});

test("NEGATIVE CONTROL: reverting to a bound argument would be CAUGHT", () => {
  const check = (src: string) => {
    const f = strip(src);
    return /const invoke = async \(\) => \{\s*"use server";/.test(f) && !/\.bind\(null, component\.subjectId\)/.test(f);
  };
  assert.equal(check(ROUTE), true, "canonical code passes");
  const bound = ROUTE
    .replace(/const invoke = async \(\) => \{\s*\n\s*"use server";[\s\S]*?\n  \};/, "")
    .replace("action={invoke}", "action={assemblePursuitTeamFormAction.bind(null, component.subjectId)}");
  assert.notEqual(bound, ROUTE, "the mutation actually applied");
  assert.equal(check(bound), false, "a plaintext bound-argument transport is caught");
});

// ── RENDER BINDING IS INTEGRITY, NOT AUTHORITY ──────────────────────────────────────────────────

test("the binding captures subject, principal AND scope", () => {
  const body = strip(BINDING);
  assert.match(body, /subjectId: string/);
  assert.match(body, /principal: string \| null/);
  assert.match(body, /orgId: string/);
  assert.match(body, /export async function currentRenderBinding/);
  // It is derived server-side and never accepted from a caller.
  assert.match(body, /supabase\.auth\.getUser\(\)/);
  assert.match(body, /withTenant/);
  assert.ok(!/formData|searchParams|request|headers\(\)/.test(body), "nothing caller-supplied enters it");
});

test("the binding module is NOT a server-action endpoint", () => {
  // SCOPED TO CODE (§16A). The file's own doc comment EXPLAINS that it is not a "use server" file,
  // so a raw scan finds the directive in the prose that forbids it.
  const code = strip(BINDING);
  assert.ok(!/"use server"/.test(code), "exporting helpers from a use-server file would publish them");
  assert.match(code, /import "server-only"/, "and it cannot reach a client bundle");
  // NEGATIVE CONTROL: the phrase IS in the file, as the explanation — so the scoping does real work.
  assert.ok(/"use server"/.test(BINDING), "the forbidding prose exists outside the code");
});

test("the invocation COMPARES the binding, and the comparison is not authority", () => {
  const body = strip(BOUNDARY);
  assert.match(body, /const principal = await currentPrincipal\(\)/, "derived independently at click");
  assert.match(body, /binding\.orgId !== orgId \|\| binding\.principal !== principal/);
  // The comparison happens BEFORE the role check and BEFORE dispatch, and neither is skipped.
  const cmp = body.indexOf("binding.orgId !== orgId");
  const role = body.indexOf("const role = await currentRole(db)");
  const dispatch = body.indexOf("dispatchSkill(db, capability.skillId,");
  assert.ok(cmp > 0 && role > cmp && dispatch > role, "integrity, then current role, then dispatch");
  assert.ok(!/binding\.(principal|orgId)[^!=]*(role|permission|authorized)/i.test(body),
    "the binding is never consulted as permission");
});

test("NEGATIVE CONTROL: omitting the principal/scope comparison would be CAUGHT", () => {
  const check = (src: string) => /binding\.orgId !== orgId \|\| binding\.principal !== principal/.test(strip(src));
  assert.equal(check(BOUNDARY), true, "canonical code passes");
  const without = BOUNDARY.replace(/if \(binding\.orgId !== orgId[\s\S]*?\n    \}\n/, "");
  assert.notEqual(without, BOUNDARY, "the mutation actually applied");
  assert.equal(check(without), false, "a missing render-binding check is caught");
});

test("NEGATIVE CONTROL: treating the binding as authority would be CAUGHT", () => {
  const check = (src: string) => {
    const f = strip(src);
    return /const role = await currentRole\(db\)/.test(f)
      && /role !== "owner" && role !== "operator"/.test(f)
      && /dispatchSkill\(db, capability\.skillId,/.test(f);
  };
  assert.equal(check(BOUNDARY), true, "canonical code passes");
  const trusting = BOUNDARY.replace("const role = await currentRole(db);", "const role = binding.principal ? \"operator\" : null;");
  assert.notEqual(trusting, BOUNDARY, "the mutation actually applied");
  assert.equal(check(trusting), false, "deriving authority from the binding is caught");
});

// ── THE SUBJECT CANNOT BE REDEFINED, AND IS NEVER RE-DERIVED ────────────────────────────────────

test("SHOW ME is NOT re-run at click — a stale selection stays the requested subject", () => {
  const body = strip(BOUNDARY);
  for (const forbidden of ["executePursuitQuery", "PLANS", "selectIdentity", "buildContextManifest", "first"]) {
    assert.ok(!body.includes(forbidden), `the boundary must not contain ${forbidden}`);
  }
  // The dispatched subject is the one the binding carried, and nothing else.
  assert.match(body, /const pursuitId = binding\?\.subjectId/);
  assert.match(body, /dispatchSkill\(db, capability\.skillId,[\s\S]{0,200}pursuitId,/);
});

test("NEGATIVE CONTROL: re-running SHOW ME at click would be CAUGHT", () => {
  const check = (src: string) => !/executePursuitQuery|selectIdentity/.test(strip(src));
  assert.equal(check(BOUNDARY), true, "canonical code passes");
  const retarget = BOUNDARY.replace("const pursuitId = binding?.subjectId;",
    "const fresh = await executePursuitQuery(PLANS['open-by-value'].plan);\n  const pursuitId = selectIdentity(fresh.result, 'first', 'pursuit.list')?.identity.id;");
  assert.notEqual(retarget, BOUNDARY, "the mutation actually applied");
  assert.equal(check(retarget), false, "silent retargeting is caught");
});

// ── E: INTEGRITY MATERIAL IS NOT IN THE HEADLESS RESULT ─────────────────────────────────────────

test("SurfaceResult carries the Slice 9 fields and NO integrity material", () => {
  const schema = SRC("lib/experience/surface/schema.ts");
  // SCOPED TO DECLARED FIELDS, not to the prose that explains why they are the only ones. The
  // comment on `offered` says it is "not authorization" — a raw scan would fail on the word.
  const action = strip(schema).slice(strip(schema).indexOf('kind: "ACTION";', strip(schema).indexOf("SurfaceComponentResult")));
  const fields = [...action.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(fields.slice(0, 6), ["component", "title", "interpretedAs", "capability", "subjectId", "offered"]);
  for (const forbidden of ["binding", "principal", "ciphertext", "signature", "token", "nonce", "encrypted"]) {
    assert.ok(!fields.includes(forbidden), `the headless result must not carry a ${forbidden} field`);
  }
});

test("the assembler builds no binding — surface semantics and invocation integrity are separate", () => {
  const body = strip(ASSEMBLE);
  // `bindings` is Slice 8's executionDigest input and is legitimately named — the property is that
  // the assembler builds no RENDER binding and derives no principal, not that a substring is absent.
  for (const forbidden of ["currentRenderBinding", "RenderBinding", "supabase", "getUser", "authConfigured"]) {
    assert.ok(!body.includes(forbidden), `the assembler must not contain ${forbidden}`);
  }
  assert.match(body, /const bindings: \{ consumer: ComponentKey; derived: DerivedIdentityContext \}\[\]/,
    "the only `bindings` here is Slice 8's execution-identity input");
});

// ── THE MODEL BOUNDARY ──────────────────────────────────────────────────────────────────────────

test("the model may propose the graph and never learns the subject", () => {
  const prompt = surfacePromptForAudit(MANIFEST);
  assert.ok(!prompt.includes(ID0) && !prompt.includes(ID1));
  assert.match(prompt, /pursuit\.assemble_team/);
  assert.match(prompt, /fromComponent/);
  for (const forbidden of ["subjectId", "binding", "principal", "encrypted", "/pursuits/"]) {
    assert.ok(!prompt.includes(forbidden), `the prompt must not contain ${forbidden}`);
  }
});

test("no consequential path is reachable from composing, validating or assembling", () => {
  for (const [name, code] of [["assemble", ASSEMBLE], ["compile", COMPILE]] as const) {
    const body = strip(code);
    for (const forbidden of ["dispatchSkill", "startAndRun", "continueRun", "lib/runtime", "insert into", "update ", "delete from"]) {
      assert.ok(!body.includes(forbidden), `${name} must not contain ${forbidden}`);
    }
  }
});

test("no P45, schema, P5 or P6 change", () => {
  for (const [name, code] of [["boundary", BOUNDARY], ["binding", BINDING], ["assemble", ASSEMBLE]] as const) {
    for (const forbidden of ["startAndRun", "decideApproval", "lib/runtime", "control_plane", "governed_action",
                             "migration", "mayDerive", "resolveDisclosure"]) {
      assert.ok(!strip(code).includes(forbidden), `${name} must not contain ${forbidden}`);
    }
  }
});
