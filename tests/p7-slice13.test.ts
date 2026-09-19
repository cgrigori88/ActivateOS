import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXPERIENCE_REQUEST_VERSION } from "../src/lib/experience/surface/execute-experience";
import { testFixturePrincipal, principalOrgId } from "../src/lib/experience/principal";

/**
 * P7 SLICE 13 — HEADLESS / INTERFACE-INDEPENDENT PURSUIT EXPERIENCE.
 *
 * > **P7 owns governed experience semantics independent of interface. An adapter may transport or
 * > render those semantics; it may not redefine truth, authority, metrics, selectors, state
 * > transitions or write behavior.**
 *
 * The properties worth most here are the ones about what the boundary CANNOT accept and CANNOT
 * return. Those are asserted on the types and on the module graph, because "we currently pass the
 * right thing" is not a boundary — a later caller passing the wrong thing is exactly how it would
 * stop being one.
 */

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const EXECUTOR = SRC("lib/experience/surface/execute-experience.ts");
const SCHEMA = SRC("lib/experience/surface/schema.ts");
const PAGE = SRC("app/experience/pursuits/page.tsx");
const PRINCIPAL = SRC("lib/experience/principal.ts");

// ── THE CANONICAL BOUNDARY EXISTS, AND IT IS THE ONLY ONE ───────────────────────────────────────

test("one canonical executor exists, taking a request and a branded principal as SEPARATE inputs", () => {
  const body = strip(EXECUTOR);
  assert.match(body, /export async function executeExperience\(\s*request: PursuitExperienceRequest,\s*principal: ExecutionPrincipal,?\s*\)/,
    "the request says WHAT; the principal says WHO — they are different parameters");
  assert.match(body, /Promise<SurfaceOutcome>/, "and the canonical result model is returned unchanged");
});

test("BOTH web call sites use the executor — no duplicate production orchestration remains", () => {
  const page = strip(PAGE);
  const calls = [...page.matchAll(/await executeExperience\(/g)];
  assert.equal(calls.length, 2, "SurfaceView and OpenPinView both go through the canonical executor");
  // The renderer must not assemble or compile a surface itself.
  assert.ok(!/assembleSurface\(/.test(page), "the renderer does not assemble surfaces");
  assert.ok(!/compileSurface\(/.test(page), "the renderer does not compile surfaces");
});

test("the canonical executor is the ONLY production caller of the assembler", () => {
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  });
  walk(new URL("../src", import.meta.url).pathname);
  const callers = files
    .filter((f) => /assembleSurface\s*\(/.test(strip(readFileSync(f, "utf8"))))
    .map((f) => f.slice(f.indexOf("src/"))).sort()
    .filter((f) => f !== "src/lib/experience/surface/assemble.ts");
  assert.deepEqual(callers, ["src/lib/experience/surface/execute-experience.ts"],
    "a second orchestration path appeared — it must be classified before shipping");
});

// ── AUTHORITY CANNOT ENTER THROUGH THE REQUEST ──────────────────────────────────────────────────

test("the request type cannot carry authority, context or resolved identity", () => {
  const body = strip(EXECUTOR);
  const iface = body.slice(body.indexOf("interface PursuitExperienceRequest"), body.indexOf("export const EXPERIENCE_REQUEST_VERSION"));
  const fields = [...iface.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[?:]/gm)].map((m) => m[1]);
  assert.deepEqual(fields, ["requestVersion", "spec", "contextSource", "source", "modelId", "promptTemplateVersion", "boundContextDigest"]);
  for (const forbidden of ["ExecutionPrincipal", "orgId", "userId", "role", "ContextManifest",
    "ValidatedSurfaceSpec", "CompiledIntent", "SurfaceResult", "subjectId", "sql", "query"]) {
    assert.ok(!iface.includes(forbidden), `a request must not carry ${forbidden}`);
  }
});

test("NEGATIVE CONTROL: a principal-shaped object cannot be forged", () => {
  // The brand is a module-private symbol, so plain data is not an ExecutionPrincipal — at the type
  // level AND at runtime, where the accessor is the only way to read the org.
  const forged = { orgId: "3759c35a-7cae-45de-a1d6-3f58ccf0f194", source: "web-session" } as unknown;
  process.env.P7_TEST_PRINCIPAL = "allow";
  const real = testFixturePrincipal("3759c35a-7cae-45de-a1d6-3f58ccf0f194");
  // The brand is a module-private symbol. A forged object carries none, so it is distinguishable at
  // RUNTIME as well as rejected by the type checker. (`principalOrgId` is a plain accessor and is
  // deliberately NOT asserted to throw — claiming a runtime guard that does not exist would be worse
  // than the forgery it pretends to stop.)
  assert.equal(Object.getOwnPropertySymbols(forged as object).length, 0, "a forged principal carries no brand");
  assert.equal(Object.getOwnPropertySymbols(real).length, 1, "a real principal carries exactly the brand");
  // And the only non-test minting paths derive the org from a credential, never from caller input.
  const body = strip(PRINCIPAL);
  assert.match(body, /function mint\(/);
  assert.ok(!/export function mint|export const mint/.test(body), "mint is module-private");
  assert.match(body, /export async function webSessionPrincipal\(\)/, "the web adapter resolves its own principal");
  assert.match(body, /withTenant/, "and derives the org from the authenticated session, not from a request");
});

test("the executor never falls back to ambient session authority", () => {
  const body = strip(EXECUTOR);
  assert.ok(!/principal\?\s*:/.test(body), "the principal parameter is not optional");
  assert.ok(!/withTenant\b/.test(body), "the executor resolves no org of its own");
  assert.ok(!/principalOrgId/.test(body), "it does not unwrap the principal to re-derive authority either");
});

// ── CONTEXT IS DERIVED, NEVER SUPPLIED ──────────────────────────────────────────────────────────

test("the context source is CLOSED — a plan key, or nothing", () => {
  const body = strip(EXECUTOR);
  assert.match(body, /export type ContextSource =\s*\|\s*\{ kind: "NONE" \}\s*\|\s*\{ kind: "PLAN"; planKey: ViewKey \}/);
  // §16A — "PursuitQuery" is a substring of `executePursuitQuery`, and the module's own prose names
  // it to explain why it is absent. Scan for the standalone TYPE, in stripped code only.
  const asType = /(?<!execute)\bPursuitQuery\b/.test(body);
  assert.equal(asType, false, "a caller cannot supply its own query as a context selector");
});

test("NONE yields the empty manifest; PLAN derives context through the governed query path", () => {
  const body = strip(EXECUTOR);
  assert.match(body, /if \(source\.kind === "NONE"\) return \{ ok: true, manifest: EMPTY_MANIFEST \}/);
  assert.match(body, /executePursuitQuery\(PLANS\[source\.planKey\]\.plan, principal\)/,
    "the context plan runs under the SAME principal");
  assert.match(body, /buildContextManifest\(base\.result\.rows\)/,
    "and the manifest is built from GOVERNED rows, never from a payload");
});

test("NEGATIVE CONTROL: an unregistered context plan key is refused BEFORE execution", () => {
  const body = strip(EXECUTOR);
  const resolver = body.slice(body.indexOf("export async function resolveExperienceContext"));
  const guard = resolver.indexOf("isViewKey(source.planKey)");
  const exec = resolver.indexOf("executePursuitQuery");
  assert.ok(guard > 0 && exec > guard, "the registry check precedes any governed read");
  assert.match(resolver.slice(guard, guard + 90), /return \{ ok: false, error: "INVALID" \}/);
});

test("a saved pin opens with NO context — not a reconstruction for symmetry", () => {
  const page = strip(PAGE);
  const open = page.slice(page.indexOf("function OpenPinView"));
  assert.match(open, /contextSource: \{ kind: "NONE" \}/);
  // Ownership and revalidation still happen ABOVE the executor, in Slice 12's repository.
  assert.ok(open.indexOf("loadPin(principal, id)") < open.indexOf("executeExperience"),
    "access and open-time validation precede execution");
  assert.ok(!/loadPin|createPin|renamePin|deletePin/.test(strip(EXECUTOR)),
    "the executor is not a pin repository and owns no persistence check");
});

// ── THE RESULT IS RECIPIENT-SAFE BY CONSTRUCTION ────────────────────────────────────────────────

test("SurfaceResult remains the SOLE canonical semantic result model", () => {
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  });
  walk(new URL("../src", import.meta.url).pathname);
  const rivals = files.filter((f) => /interface (APIResult|MCPResult|HeadlessSurfaceResult|TransportResult)\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(rivals, [], "a second semantic result model appeared");
  assert.match(strip(EXECUTOR), /Promise<SurfaceOutcome>/);
});

test("INVALID carries NO free-form detail — the leak is unrepresentable", () => {
  const outcome = strip(SCHEMA).slice(strip(SCHEMA).indexOf("export type SurfaceOutcome"));
  const invalid = /\|\s*\{ ok: false; error: "INVALID"([^}]*)\}/.exec(outcome);
  assert.ok(invalid, "the INVALID member exists");
  assert.equal(invalid![1].trim(), "", `INVALID must carry nothing: found "${invalid![1]}"`);
  assert.ok(!/error: "INVALID"; detail/.test(outcome), "no detail-carrying INVALID variant remains");
});

test("NEGATIVE CONTROL: an internal compile reason cannot reach the canonical output", () => {
  const body = strip(EXECUTOR);
  // The compiler's outcome carries `detail`; the executor must discard it rather than forward it.
  assert.match(body, /if \(!compiled\.ok\) return \{ ok: false, error: "INVALID" \}/);
  assert.ok(!/compiled\.detail/.test(body), "the executor never reads the compiler's detail");
  // And the type would not accept it even if someone tried.
  const outcome = strip(SCHEMA).slice(strip(SCHEMA).indexOf("export type SurfaceOutcome"));
  assert.ok(!/detail/.test(outcome.slice(0, outcome.indexOf("NO_SELECTABLE_RESULT"))),
    "no member of the recipient outcome carries a detail string");
  // Control: the INTERNAL compile outcome still has it, so diagnostics were not destroyed.
  assert.match(strip(SCHEMA), /SurfaceCompileOutcome[\s\S]*?\{ ok: false; detail: string \}/,
    "internal compile detail still exists for diagnostics");
});

test("the certified disposition set is preserved and not collapsed", () => {
  const outcome = strip(SCHEMA).slice(strip(SCHEMA).indexOf("export type SurfaceOutcome"));
  for (const member of ["CAPABILITY_DENIED", "INVALID", "NOT_AVAILABLE", "FAILED", "NO_SELECTABLE_RESULT"]) {
    assert.ok(outcome.includes(`"${member}"`), `${member} is still a distinct disposition`);
  }
  // Slice 7's rule: an internal failure is never relabelled as governed unavailability.
  const body = strip(EXECUTOR);
  assert.ok(!/error: "NOT_AVAILABLE"/.test(body), "the executor never manufactures governed unavailability");
});

// ── FRAMEWORK AND MODEL INDEPENDENCE ────────────────────────────────────────────────────────────

test("the canonical executor imports NO framework, browser or presentation dependency", () => {
  const imports = [...EXECUTOR.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  for (const i of imports) {
    assert.ok(!/^react|^next|\/navigation|\/cache|server-only|client-only/.test(i), `executor must not import ${i}`);
  }
  // §16A — the module's header explains that `src/lib` imports React nowhere, so a raw scan finds
  // the word in the prose that FORBIDS it. Scan stripped code.
  const codeOnly = strip(EXECUTOR);
  assert.ok(!/JSX|React|searchParams|FormData|document\.|window\./.test(codeOnly));
  // Control: the words DO appear in this module's prose, so the code-scoped scan is discriminating.
  assert.ok(/React/.test(EXECUTOR), "the prose mentions React, so the scoped scan means something");
});

test("the canonical executor requires NO model or provider", () => {
  assert.ok(!/proposeSurface|proposeIntent|ANTHROPIC|anthropic|intentModelEnabled/.test(EXECUTOR),
    "removing the model must not change execution semantics");
  // The model stays an upstream compiler in the adapter: prose → proposal → canonical request.
  const page = strip(PAGE);
  assert.ok(page.indexOf("proposeSurface(") < page.indexOf("await executeExperience("),
    "the model runs BEFORE the canonical request exists, never inside execution");
});

test("NEGATIVE CONTROL: page code calling the assembler directly would be CAUGHT", () => {
  const check = (src: string) => !/assembleSurface\s*\(/.test(strip(src));
  assert.equal(check(PAGE), true, "canonical code passes");
  const leaky = PAGE.replace("  const assembled = await executeExperience({",
                             "  const assembled = await assembleSurface(x);\n  const _unused = await executeExperience({");
  assert.notEqual(leaky, PAGE, "the mutation actually applied");
  assert.equal(check(leaky), false, "a renderer that assembles its own surface is caught");
});

test("NEGATIVE CONTROL: an adapter recomputing a metric instead of rendering would be CAUGHT", () => {
  // The renderer must not import metric computation or governance primitives for surface semantics.
  // SCOPED to the surface functions. `runCompiledIntent` is legitimately used by the Slice 5
  // IntentView path, which is a different certified path and not surface semantics — asserting
  // across the whole file would forbid something the product correctly does.
  const page = strip(PAGE);
  const surfaceRegion = page.slice(page.indexOf("async function SurfaceView"), page.indexOf("function SurfaceRender"))
    + page.slice(page.indexOf("async function OpenPinView"), page.indexOf("function ActionAffordance"));
  const forbidden = ["computeSum", "mayDerive", "resolveDisclosure", "runCompiledIntent", "metricKey("];
  for (const f of forbidden) assert.ok(!surfaceRegion.includes(f), `surface rendering must not use ${f}`);
  const leaky = surfaceRegion.replace("const assembled = await executeExperience({",
                                      "const v = computeSum([1]);\n  const assembled = await executeExperience({");
  assert.notEqual(leaky, surfaceRegion, "the mutation actually applied");
  assert.ok(forbidden.some((f) => leaky.includes(f)), "a surface path computing its own metric is caught");
});

// ── REQUEST VERSIONING ──────────────────────────────────────────────────────────────────────────

test("an unrecognised request version is refused deterministically", () => {
  assert.equal(EXPERIENCE_REQUEST_VERSION, 1);
  assert.match(strip(EXECUTOR), /if \(request\.requestVersion !== EXPERIENCE_REQUEST_VERSION\) return \{ ok: false, error: "INVALID" \}/,
    "a future transport can detect an incompatible contract rather than be silently remapped");
});

test("the test-fixture principal refuses without the explicit opt-in, and mints with it", () => {
  const before = process.env.P7_TEST_PRINCIPAL;
  const ORG = "3759c35a-7cae-45de-a1d6-3f58ccf0f194";
  try {
    delete process.env.P7_TEST_PRINCIPAL;
    if (process.env.NODE_ENV !== "test") {
      assert.throws(() => testFixturePrincipal(ORG), /refused outside a test run/,
        "without the opt-in it refuses — it cannot become a transport that takes an org from its caller");
    }
    process.env.P7_TEST_PRINCIPAL = "allow";
    assert.equal(principalOrgId(testFixturePrincipal(ORG)), ORG, "with the opt-in a suite can execute as its own org");
  } finally { if (before === undefined) delete process.env.P7_TEST_PRINCIPAL; else process.env.P7_TEST_PRINCIPAL = before; }
});
