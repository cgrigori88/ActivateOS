import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileSurface } from "../src/lib/experience/surface/compile";
import { COMPONENTS } from "../src/lib/experience/surface/registry";
import { ACTION_CAPABILITIES, actionCapability, mayOffer } from "../src/lib/experience/surface/actions";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import { SKILL_REGISTRY } from "../src/lib/pursuits/federation/skills";
import { surfacePromptForAudit } from "../src/lib/experience/intent/model";
import type { ValidatedComponent } from "../src/lib/experience/surface/schema";
import type { GovernedCell, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 9 — GOVERNED ACTION SURFACES.
 *
 * > **A Dynamic Surface may present a governed action affordance. It may not execute, authorize or
 * > approve the action. Every consequential action remains a P5 operation under current authority.**
 *
 * The single most important property here is NEGATIVE and structural: no path from composing,
 * validating, assembling or rendering a surface can reach a dispatcher. That is asserted on the
 * import graph rather than on behaviour, because a behavioural test can only prove that a dispatch
 * did not happen in the cases it thought to try.
 */

const ID0 = "11111111-2222-4333-8444-555555555555";
const ID1 = "99999999-8888-4777-8666-555555555555";

const cell = (v: string): GovernedCell =>
  ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED" });
const row = (id: string, name = "Acme Corporation"): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell(name) } });
const MANIFEST = buildContextManifest([row(ID0), row(ID1, "Globex")]);

const ACT = (over: Record<string, unknown> = {}) =>
  ({ component: "pursuit.assemble_team", bind: { subject: { fromContext: 0 }, ...over } });
const EXPLAIN = { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 0 } } };
const GOTO = { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" } };
const spec = (components: unknown[]) => ({ specVersion: 1, layout: "stack", components });
const VERTICAL = spec([EXPLAIN, GOTO, ACT()]);
const compile = (s: unknown, manifest = MANIFEST) =>
  compileSurface({ spec: s, manifest, boundContextDigest: manifest.digest, source: "HAND_AUTHORED" });

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ACTIONS = SRC("lib/experience/surface/actions.ts");
const ASSEMBLE = SRC("lib/experience/surface/assemble.ts");
const COMPILE = SRC("lib/experience/surface/compile.ts");
const ROUTE = SRC("app/experience/pursuits/page.tsx");
const BOUNDARY = SRC("app/experience/pursuits/actions.ts");
const act = (c: ValidatedComponent) => {
  if (c.kind !== "ACTION") throw new Error(`expected an ACTION component, got ${c.kind}`);
  return c;
};

// ── THE FIRST VERTICAL ──────────────────────────────────────────────────────────────────────────

test("the ruled first vertical validates: EXPLAIN + GO TO + one ACTION on one context subject", () => {
  const r = compile(VERTICAL);
  assert.ok(r.ok, r.ok ? "" : r.detail);
  if (!r.ok) return;
  assert.deepEqual(r.validated.components.map((c) => c.component),
    ["pursuit.explanation", "pursuit.destination", "pursuit.assemble_team"]);
  const a = act(r.validated.components[2]);
  // Slice 10 made the action subject a union; a Slice 9 spec is still CONTEXT-bound, asserted.
  assert.equal(a.subject.kind, "CONTEXT");
  assert.equal(a.subject.kind === "CONTEXT" && a.subject.id, ID0, "the action binds the SAME pre-existing context subject");
  assert.equal(a.capability.skillId, "assemble_pursuit_team");
  assert.equal(a.capability.version, 1);
  assert.equal(a.title, COMPONENTS["pursuit.assemble_team"].title, "registry-owned title");
});

test("the action component is declared ACTION and binds no intent operation", () => {
  assert.equal(COMPONENTS["pursuit.assemble_team"].kind, "ACTION");
  assert.equal(COMPONENTS["pursuit.assemble_team"].operation, null);
  // Every other component remains READ and unchanged.
  for (const k of ["pursuit.list", "pursuit.cohort", "pursuit.explanation", "pursuit.destination"] as const) {
    assert.equal(COMPONENTS[k].kind, "READ");
  }
});

// ── THE CAPABILITY IS FIXED AND CLOSED ──────────────────────────────────────────────────────────

test("the action registry is CLOSED and names exactly one real, certified skill", () => {
  assert.deepEqual(Object.keys(ACTION_CAPABILITIES), ["pursuit.assemble_team"]);
  const cap = actionCapability("pursuit.assemble_team")!;
  // The skill it names EXISTS in the certified P5 registry, at that version — not merely a string.
  const skill = SKILL_REGISTRY.find((s) => s.skillId === cap.skillId && s.version === cap.version);
  assert.ok(skill, "the named capability resolves to a registered P5 skill");
  assert.equal(skill!.effectClass, "INTERNAL_WRITE", "no external or cross-tenant effect");
  assert.equal(skill!.requiredPermission, cap.requiredPermission, "the mirrored permission matches the skill's own");
  // The substrate is an explicit part of the contract, never inferred.
  assert.equal(cap.substrate, "DISPATCH_SKILL");
  assert.equal(cap.approval, "NONE");
  assert.equal(cap.callerArguments, "NONE");
  assert.equal(cap.explicitInvocation, true);
  assert.equal(cap.subjectClass, "pursuit");
});

test("an arbitrary skill id is structurally unrepresentable in a spec", () => {
  for (const bind of [
    { subject: { fromContext: 0 }, skillId: "send_campaign_touch" },
    { subject: { fromContext: 0 }, capability: "approve_motion" },
    { subject: { fromContext: 0 }, skill: "assemble_pursuit_team", version: 1 },
    { subject: { fromContext: 0 }, substrate: "P45" },
  ]) {
    const r = compile(spec([{ component: "pursuit.assemble_team", bind }]));
    assert.equal(r.ok, false, `must be refused: ${JSON.stringify(bind)}`);
    if (!r.ok) assert.match(r.detail, /unknown action bind key/);
  }
  assert.ok(compile(spec([ACT()])).ok, "the one legal shape still validates");
});

test("an arbitrary payload is structurally unrepresentable — there is no position for one", () => {
  for (const bind of [
    { subject: { fromContext: 0 }, args: { memberId: "x" } },
    { subject: { fromContext: 0 }, payload: {} },
    { subject: { fromContext: 0 }, body: "hello" },
    { subject: { fromContext: 0 }, edits: { subject: "URGENT" } },
    { subject: { fromContext: 0 }, note: "do it now" },
  ]) {
    const r = compile(spec([{ component: "pursuit.assemble_team", bind }]));
    assert.equal(r.ok, false, `must be refused: ${JSON.stringify(bind)}`);
  }
  // Nor inside the subject, which is a closed ContextRef and nothing else.
  for (const subject of [{ fromContext: 0, args: {} }, { fromContext: 0, id: ID0 }, ID0, { fromComponent: "pursuit.list", select: "largest" }]) {
    const r = compile(spec([{ component: "pursuit.assemble_team", bind: { subject } }]));
    assert.equal(r.ok, false, `subject ${JSON.stringify(subject)} must be refused`);
  }
});

/**
 * SUPERSEDED BY SLICE 10, deliberately and in one direction only. This asserted that a
 * component-derived action subject was REFUSED — true while that capability was deferred. Slice 10
 * authorizes it, so what is kept is the property that still holds: the derived subject must come from
 * a CERTIFIED export, and the action still exports nothing itself, so it cannot begin a chain.
 */
test("a component-derived action subject is admitted, but only from a certified export", () => {
  assert.equal(COMPONENTS["pursuit.assemble_team"].acceptsComponentIdentity, true);
  assert.equal(COMPONENTS["pursuit.assemble_team"].exportsIdentity, false, "it cannot begin a chain");
  const ok = compile(spec([
    { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" } },
    { component: "pursuit.assemble_team", bind: { subject: { fromComponent: "pursuit.list", select: "first" } } },
  ]));
  assert.ok(ok.ok, ok.ok ? "" : ok.detail);
  // An UNCERTIFIED upstream plan still cannot supply an action subject.
  const uncertified = compile(spec([
    { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "recently-updated" } },
    { component: "pursuit.assemble_team", bind: { subject: { fromComponent: "pursuit.list", select: "first" } } },
  ]));
  assert.equal(uncertified.ok, false);
  if (!uncertified.ok) assert.match(uncertified.detail, /not certified to export identity/);
});

test("the action subject resolves through the certified resolver, with its refusals intact", () => {
  for (const fromContext of [2, -1, 1.5, "0", null, {}]) {
    assert.equal(compile(spec([ACT({ subject: { fromContext } })])).ok, false, `${String(fromContext)} must refuse`);
  }
  // A stale bound digest refuses too.
  const stale = compileSurface({ spec: spec([ACT()]), manifest: MANIFEST, boundContextDigest: "0".repeat(16), source: "HAND_AUTHORED" });
  assert.equal(stale.ok, false);
  // An empty context has no subject to act on.
  assert.equal(compile(spec([ACT()]), buildContextManifest([])).ok, false);
});

// ── RENDERING IS NOT INVOKING ───────────────────────────────────────────────────────────────────

test("NO surface module can reach a dispatcher or the P45 runtime — STRUCTURAL", () => {
  for (const [name, code] of [["actions.ts", ACTIONS], ["assemble.ts", ASSEMBLE], ["compile.ts", COMPILE]] as const) {
    const body = strip(code);
    for (const forbidden of ["dispatchSkill", "startAndRun", "continueRun", "resumeRun", "decideApproval",
                             "lib/runtime", "governed_action_invocations", "insert into", "update ", "delete from"]) {
      assert.ok(!body.includes(forbidden), `${name} must not contain ${forbidden}`);
    }
  }
});

test("the ACTION component executes NOTHING during assembly", () => {
  const body = strip(ASSEMBLE);
  // The action branch returns before any execution, and pushes a null result.
  assert.match(body, /if \(c\.kind === "ACTION"\) \{\s*results\.push\(null\);\s*continue;/);
  // The only execution call is the read path's, and it is unreachable for an action.
  assert.equal((body.match(/runCompiledIntent\(/g) ?? []).length, 1);
  const actionBranch = body.indexOf('c.kind === "ACTION"');
  const execute = body.indexOf("runCompiledIntent(intent, principal)");
  assert.ok(actionBranch > 0 && execute > 0 && actionBranch < execute, "the action branch precedes execution");
});

test("the action capability module is a DECLARATION — it reaches nothing at all", () => {
  const body = strip(ACTIONS);
  for (const forbidden of ["withTenant", "query(", "pool", "PoolClient", "await", "dispatchSkill", "lib/runtime", "fetch("]) {
    assert.ok(!body.includes(forbidden), `actions.ts must not contain ${forbidden}`);
  }
});

test("render eligibility is DISCLOSURE, and fails closed without a role", () => {
  const cap = actionCapability("pursuit.assemble_team")!;
  assert.equal(mayOffer(cap, "owner"), true);
  assert.equal(mayOffer(cap, "operator"), true);
  assert.equal(mayOffer(cap, "viewer"), false, "a viewer is not offered an operator action");
  assert.equal(mayOffer(cap, null), false, "no resolved role offers nothing");
  assert.equal(mayOffer(cap, "nonsense"), false, "an unknown role offers nothing");
  // It is a pure comparison: it consults no actor, grant, precheck or dispatcher.
  const body = strip(ACTIONS);
  const fn = body.slice(body.indexOf("export function mayOffer"));
  assert.ok(!/governed_actor|grant|precheck|authorize|dispatch/i.test(fn), "it does not reproduce the pipeline");
});

test("NEGATIVE CONTROL: invoking dispatch during render would be CAUGHT", () => {
  const check = (src: string) => !/dispatchSkill/.test(strip(src));
  assert.equal(check(ASSEMBLE), true, "canonical code passes");
  const leaky = ASSEMBLE.replace("const outcome = await runCompiledIntent(intent, principal);",
    "await dispatchSkill(db, 'assemble_pursuit_team', actor, {});\n    const outcome = await runCompiledIntent(intent, principal);");
  assert.notEqual(leaky, ASSEMBLE, "the mutation actually applied");
  assert.equal(check(leaky), false, "a dispatch during assembly is caught");
});

// ── THE INVOCATION BOUNDARY ─────────────────────────────────────────────────────────────────────

test("the skill is FIXED server-side — the boundary takes no skill parameter", () => {
  const body = strip(BOUNDARY);
  assert.match(body, /export async function assemblePursuitTeamFromSurface\(\s*binding: RenderBinding,?\s*\)/);
  assert.ok(!/skillId:\s*\w*skill\w*\b|function \w+\([^)]*skillId/i.test(body), "no caller-supplied skill id");
  assert.match(body, /ACTION_CAPABILITIES\["pursuit\.assemble_team"\]/, "the capability comes from the registry");
  assert.match(body, /dispatchSkill\(db, capability\.skillId,/, "and is what is dispatched");
  // No caller arguments are passed to the handler.
  assert.ok(!/args:\s*\{/.test(body), "no args are constructed or forwarded");
});

test("the boundary re-derives principal, org and role — nothing from render time is trusted", () => {
  const body = strip(BOUNDARY);
  assert.match(body, /"use server"/);
  assert.match(body, /withTenant\(async \(db, orgId\)/, "the org comes from the session, never the caller");
  assert.match(body, /const role = await currentRole\(db\)/, "the role is resolved again, server-side");
  assert.match(body, /role !== "owner" && role !== "operator"/, "and refused before dispatch");
  // Nothing render-time is accepted as input: the ONLY parameter is the subject.
  assert.ok(!/offered|authorized|allowed|capabilityToken|signature|token/i.test(body));
});

test("the boundary creates NO P45 state", () => {
  const body = strip(BOUNDARY);
  for (const forbidden of ["startAndRun", "continueRun", "startRun", "resumeRun", "decide(", "approval",
                           "lib/runtime", "control_plane", "governed_action"]) {
    assert.ok(!body.includes(forbidden), `the boundary must not touch ${forbidden}`);
  }
});

test("idempotency and correlation come from the existing dispatchSkill contract", () => {
  const body = strip(BOUNDARY);
  assert.match(body, /correlationId: randomUUID\(\)|const correlationId = randomUUID\(\)/);
  assert.match(body, /idempotencyKey: `surface-assemble-team:\$\{pursuitId\}:\$\{correlationId\}`/);
  // The existing pursuit page uses the same per-submission pattern — this is reuse, not a new scheme.
  const existing = strip(SRC("app/pursuits/[id]/actions.ts"));
  assert.match(existing, /idempotencyKey: `[^`]*\$\{correlationId\}`/, "the pattern being reused exists");
});

// ── THE RENDERER DECIDES NOTHING ────────────────────────────────────────────────────────────────

test("the renderer makes no authority decision and posts only the subject", () => {
  const body = strip(ROUTE);
  const fn = body.slice(body.indexOf("function ActionAffordance"), body.indexOf("* The resolved navigation target"));
  assert.ok(fn.length > 100, "the affordance renderer was located");
  // It reads `offered` and renders; it computes no permission of its own.
  assert.ok(!/currentRole|mayOffer|ROLE_RANK|dispatchSkill|requiredPermission/.test(fn));
  // The form binds the subject server-side; there is no skill, args or payload input.
  assert.match(fn, /action=\{invoke\}/, "the form uses the CLOSURE, not a bound argument");
  assert.ok(!/\.bind\(null, component\.subjectId\)/.test(fn), "the plaintext bound-argument transport is gone");
  assert.ok(!/<input/.test(fn), "no caller-controlled form field exists at all");
});

test("a component that is not offered renders operation-level language only", () => {
  const body = strip(ROUTE);
  const fn = body.slice(body.indexOf("function ActionAffordance"), body.indexOf("* The resolved navigation target"));
  assert.match(fn, /This action isn&apos;t available to you\./);
  // The not-offered branch RETURNS before anything about the object is used — it names the viewer's
  // own ability and cannot name the pursuit, because it never reaches a field that holds one.
  const branch = fn.slice(fn.indexOf("if (!component.offered)"), fn.indexOf("const binding ="));
  assert.ok(branch.length > 40, "the not-offered branch was located");
  assert.ok(!/subjectId|capability|interpretedAs/.test(branch), "it uses no object-derived value");
});

// ── PROVENANCE AND THE READ PATH ────────────────────────────────────────────────────────────────

test("an action node contributes its CAPABILITY and SUBJECT to the surface digest", () => {
  const a = compile(spec([ACT()]));
  const b = compile(spec([ACT({ subject: { fromContext: 1 } })]));
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.validated.provenance.surfaceSpecDigest, b.validated.provenance.surfaceSpecDigest,
    "a different subject is a different execution identity");
  // And the resolved id is not serialized into provenance.
  assert.ok(!JSON.stringify(a.validated.provenance).includes(ID0));
});

test("a read-only surface is unchanged by Slice 9", () => {
  const readOnly = compile(spec([EXPLAIN, GOTO]));
  assert.ok(readOnly.ok);
  if (!readOnly.ok) return;
  assert.ok(readOnly.validated.components.every((c) => c.kind !== "ACTION"));
  assert.equal(readOnly.validated.provenance.executionDigest, null);
});

test("no schema, environment, P5 or P6 change", () => {
  for (const [name, code] of [["actions.ts", ACTIONS], ["assemble.ts", ASSEMBLE], ["compile.ts", COMPILE], ["boundary", BOUNDARY]] as const) {
    for (const forbidden of ["migration", "mayDerive", "resolveDisclosure", "buildFederationViewer",
                             "VNEXT_CONTROL_PLANE_ENABLED", "setOrgFeature", "org_features"]) {
      assert.ok(!strip(code).includes(forbidden), `${name} must not contain ${forbidden}`);
    }
  }
});

// ── CONTROLS ON THE CHECKERS THEMSELVES ─────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: a caller-provided skill id would be CAUGHT", () => {
  const check = (src: string) => {
    const body = strip(src);
    return /export async function assemblePursuitTeamFromSurface\(\s*binding: RenderBinding,?\s*\)/.test(body)
      && /ACTION_CAPABILITIES\["pursuit\.assemble_team"\]/.test(body)
      && /dispatchSkill\(db, capability\.skillId,/.test(body);
  };
  assert.equal(check(BOUNDARY), true, "canonical code passes");

  const generic = BOUNDARY
    .replace("assemblePursuitTeamFromSurface(\n  binding: RenderBinding,\n)", "assemblePursuitTeamFromSurface(\n  binding: RenderBinding, skillId: string,\n)")
    .replace("dispatchSkill(db, capability.skillId,", "dispatchSkill(db, skillId,");
  assert.notEqual(generic, BOUNDARY, "the mutation actually applied");
  assert.equal(check(generic), false, "a generic skill-dispatch endpoint is caught");
});

test("NEGATIVE CONTROL: trusting render-time permission on click would be CAUGHT", () => {
  const check = (src: string) => {
    const body = strip(src);
    return /const role = await currentRole\(db\)/.test(body)
      && /role !== "owner" && role !== "operator"/.test(body)
      && !/offered|preAuthorized|allowed/i.test(body);
  };
  assert.equal(check(BOUNDARY), true, "canonical code passes");

  const trusting = BOUNDARY
    .replace("const role = await currentRole(db);", "const role = offered ? \"operator\" : await currentRole(db);");
  assert.notEqual(trusting, BOUNDARY, "the mutation actually applied");
  assert.equal(check(trusting), false, "accepting a render-time decision is caught");
});

test("NEGATIVE CONTROL: bypassing dispatchSkill would be CAUGHT", () => {
  // The boundary's ONLY consequential call is the dispatcher. A bespoke write instead of it — the
  // exact shape the 'single mutation authority' rule exists to prevent — must be caught.
  const check = (src: string) => {
    const body = strip(src);
    return /dispatchSkill\(db, capability\.skillId,/.test(body)
      && !/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(body)
      && !/assembleTeam\(/.test(body);
  };
  assert.equal(check(BOUNDARY), true, "canonical code passes");

  const bespoke = BOUNDARY.replace(/const dispatch = await dispatchSkill\([\s\S]*?\}\);/,
    "const dispatch = { status: \"EXECUTED\" }; await assembleTeam(db, pursuitId, env);");
  assert.notEqual(bespoke, BOUNDARY, "the mutation actually applied");
  assert.equal(check(bespoke), false, "a bespoke write that skips the dispatcher is caught");
});

test("NEGATIVE CONTROL: entering the P45 runtime would be CAUGHT", () => {
  const check = (src: string) => !/startAndRun|continueRun|lib\/runtime|decideApproval/.test(strip(src));
  assert.equal(check(BOUNDARY), true, "canonical code passes");
  assert.equal(check(ASSEMBLE), true, "and so does the assembler");

  const runtime = BOUNDARY.replace("const dispatch = await dispatchSkill(",
    "await startAndRun({ orgId } as never);\n    const dispatch = await dispatchSkill(");
  assert.notEqual(runtime, BOUNDARY, "the mutation actually applied");
  assert.equal(check(runtime), false, "substituting the second consequential substrate is caught");
});

// ── THE MODEL BOUNDARY ──────────────────────────────────────────────────────────────────────────

test("the model may PROPOSE the action component, and can author nothing about it", () => {
  const model = strip(SRC("lib/experience/intent/model.ts"));
  // It is offerable...
  assert.match(model, /"pursuit\.assemble_team"/);
  // ...and its bind is a CLOSED, STRICT object of exactly one key: the subject.
  assert.match(model, /z\.object\(\{ subject: z\.object\(\{ fromContext: z\.number\(\)\.int\(\) \}\) \}\)\.strict\(\)/);
  // SCOPED TO THE SCHEMA (§16A). A whole-file scan trips on the PROMPT RULE that forbids these —
  // it has to say "no recipient, no schedule" in order to refuse them — and on an unrelated
  // transport signature. What the model may EMIT is decided by the schema, so that is what is read.
  const schema = model.slice(model.indexOf("const surfaceSchema"), model.indexOf("function surfacePrompt"));
  assert.ok(schema.length > 200, "the surface schema was located");
  for (const forbidden of ["skillId", "payload", "args", "body", "content", "recipient", "schedule", "capability"]) {
    assert.ok(!schema.includes(forbidden), `the model schema must not offer ${forbidden}`);
  }
  // NEGATIVE CONTROL: the words DO appear in the file, as the rule that forbids them — so the
  // scoping is doing real work rather than agreeing with a scan that would have passed anyway.
  assert.ok(/recipient/.test(model) && /schedule/.test(model), "the forbidding prose exists outside the schema");
});

test("the prompt tells the model that including the action does not perform it", () => {
  const prompt = surfacePromptForAudit(MANIFEST);
  assert.match(prompt, /pursuit\.assemble_team/);
  assert.match(prompt, /including it never performs it/);
  assert.match(prompt, /You cannot run, send, approve or schedule anything/);
  // And the prompt still carries no identifier or governed value.
  assert.ok(!prompt.includes(ID0) && !prompt.includes(ID1));
});
