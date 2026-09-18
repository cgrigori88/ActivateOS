import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileIntent, COMPILER_VERSION } from "../src/lib/experience/intent/compile";
import { buildContextManifest, EMPTY_MANIFEST, resolveContextRef, toPrompt } from "../src/lib/experience/intent/context";
import { CLARIFICATION_QUESTIONS, compilerVocabulary, vocabularyDigest } from "../src/lib/experience/intent/vocabulary";
import { intentModelEnabled, intentPromptForAudit, PROMPT_TEMPLATE_VERSION } from "../src/lib/experience/intent/model";
import { AGGREGATES, DESTINATIONS, FIELDS, METRICS } from "../src/lib/experience/registry";
import { PLANS, VIEW_KEYS } from "../src/lib/experience/plans";
import type { GovernedCell, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 5 — the compiler proofs, ALL on hand-authored proposals (ruling 5).
 *
 * There is no model in this file. That is the point: the deterministic path cannot tell whether a
 * model, a form or a fixture produced a proposal, so "removing the LLM changes nothing" is the
 * signature of the code rather than a claim about it. A live model can never turn this suite green
 * or red.
 */

const ID0 = "11111111-2222-4333-8444-555555555555";
const ID1 = "22222222-3333-4444-8555-666666666666";
const COMPILE_SRC = readFileSync(new URL("../src/lib/experience/intent/compile.ts", import.meta.url), "utf8");
const CONTEXT_SRC = readFileSync(new URL("../src/lib/experience/intent/context.ts", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const cell = (value: string | null, over: Partial<GovernedCell> = {}): GovernedCell =>
  ({ visibility: "EXACT", value, provenance: "pursuit.account_name", existence: "AUTHORIZED", ...over });
const row = (id: string, account: GovernedCell = cell("Acme Corporation")): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": account } });

const MANIFEST = buildContextManifest([row(ID0), row(ID1, cell("Initech Holdings"))]);
const compile = (proposal: unknown, manifest = MANIFEST, digest = manifest.digest,
                 source: "HAND_AUTHORED" | "MODEL" = "HAND_AUTHORED",
                 modelId: string | null = null, promptTemplateVersion: string | null = null) =>
  compileIntent({ proposal, manifest, boundContextDigest: digest, source, modelId, promptTemplateVersion });

// ── what the model can say at all ───────────────────────────────────────────────────────────────

test("the model cannot emit an organization, a principal, a URL, a path or a raw id", () => {
  for (const extra of [
    { orgId: "22222222-3333-4444-8555-666666666666" }, { organization: "Acme" }, { principal: "owner" },
    { path: "/admin" }, { url: "https://evil.example.com" }, { route: "/pursuits" },
    { id: ID0 }, { subjectId: ID0 }, { pursuitId: ID0 },
    { filters: [{ dimension: "pursuit.status" }] }, { metrics: ["x"] }, { asOf: "2026-01-01" },
    { plan: { queryVersion: 1 } }, { limit: 999 }, { scope: { kind: "ALL" } },
  ]) {
    const r = compile({ operation: "SHOW_ME", view: "open-by-value", ...extra });
    assert.equal(r.ok, false, `${Object.keys(extra)[0]} must be refused`);
    if (!r.ok) assert.equal(r.state, "UNSUPPORTED");
  }
});

test("a UUID in the subject position is not an identifier — only a context reference is", () => {
  for (const subject of [ID0, { id: ID0 }, { fromContext: ID0 }, { fromContext: 0, id: ID0 }, { uuid: ID0 }]) {
    const r = compile({ operation: "EXPLAIN", subject });
    assert.equal(r.ok, false, `${JSON.stringify(subject)} must be refused`);
  }
  // …and the compiled request's id came from the MANIFEST, never from the proposal.
  const ok = compile({ operation: "EXPLAIN", subject: { fromContext: 1 } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.intent.request, { subjectId: ID1 });
});

test("malformed structured output executes nothing and is not repaired", () => {
  for (const bad of [null, undefined, 0, "SHOW_ME", [], [{ operation: "SHOW_ME" }], { }, { operation: "show_me" },
                     { operation: "DELETE" }, { operation: "WRITE", view: "open-by-value" }, { operation: 1 }]) {
    const r = compile(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must not compile`);
    if (!r.ok) assert.equal(r.state, "UNSUPPORTED");
  }
});

// ── the ViewKey rule (ruling 1) ─────────────────────────────────────────────────────────────────

test("an unknown ViewKey is refused, never approximated with a broader or different view", () => {
  for (const view of ["everything", "all-pursuits", "open-by-value ", "OPEN-BY-VALUE", "", "../open-by-value"]) {
    const r = compile({ operation: "SHOW_ME", view });
    assert.equal(r.ok, false, `${view} must be refused`);
    if (!r.ok) assert.equal(r.state, "UNSUPPORTED");
  }
  // The compiler contains no similarity, fallback or default-view machinery.
  const code = strip(COMPILE_SRC);
  for (const forbidden of ["closest", "similar", "levenshtein", "startsWith(", "includes(view", "?? \"open", "default:"]) {
    assert.ok(!code.includes(forbidden), `the compiler must not contain ${forbidden}`);
  }
});

test("every registered ViewKey compiles, and SHOW_ME runs exactly that fixed plan", () => {
  for (const view of VIEW_KEYS) {
    const r = compile({ operation: "SHOW_ME", view });
    assert.ok(r.ok, `${view} must compile`);
    if (r.ok) assert.deepEqual(r.intent.request, { view });
  }
});

test("ANALYZE is available only where a registered aggregate already exists", () => {
  for (const view of VIEW_KEYS) {
    const hasAggregate = PLANS[view].plan.aggregate !== false;
    const r = compile({ operation: "ANALYZE", view });
    assert.equal(r.ok, hasAggregate, `${view}: analyzable=${hasAggregate}`);
  }
});

test("the model cannot create a metric, an aggregate, a field or a cohort", () => {
  // The proposal shape has no slot for a definition: the only lever is a key that must already exist.
  const before = [Object.keys(METRICS).length, Object.keys(AGGREGATES).length, Object.keys(FIELDS).length];
  for (const p of [
    { operation: "ANALYZE", view: "open-pipeline-cohort", aggregate: { id: "cohort.invented", version: 1 } },
    { operation: "SHOW_ME", view: "open-by-value", metric: { id: "pursuit.win_rate", version: 1 } },
    { operation: "SHOW_ME", view: { key: "custom", filters: [] } },
  ]) {
    assert.equal(compile(p).ok, false);
  }
  assert.deepEqual([Object.keys(METRICS).length, Object.keys(AGGREGATES).length, Object.keys(FIELDS).length], before);
});

// ── the context manifest (ruling 2) ─────────────────────────────────────────────────────────────

test("an out-of-range or non-integer context reference is refused before anything executes", () => {
  for (const fromContext of [2, 99, -1, 1.5, "0", null, NaN, Infinity]) {
    const r = compile({ operation: "EXPLAIN", subject: { fromContext } });
    assert.equal(r.ok, false, `${String(fromContext)} must be refused`);
  }
});

test("a stale or mismatched context digest cannot retarget a reference", () => {
  const other = buildContextManifest([row(ID1), row(ID0)]);   // same ids, different ORDER
  assert.notEqual(other.digest, MANIFEST.digest, "reordering changes the digest");
  // A proposal bound to the old digest must not resolve against the new manifest.
  const r = compile({ operation: "EXPLAIN", subject: { fromContext: 0 } }, other, MANIFEST.digest);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.state, "UNSUPPORTED");
  // Bound correctly, index 0 of the reordered manifest is the OTHER pursuit — order is load-bearing.
  const correct = compile({ operation: "EXPLAIN", subject: { fromContext: 0 } }, other, other.digest);
  assert.ok(correct.ok);
  if (correct.ok) assert.deepEqual(correct.intent.request, { subjectId: ID1 });
});

test("substituting an id while keeping labels and order still changes the digest", () => {
  const swapped = buildContextManifest([row("33333333-4444-4555-8666-777777777777"), row(ID1, cell("Initech Holdings"))]);
  assert.notEqual(swapped.digest, MANIFEST.digest);
  assert.equal(resolveContextRef(MANIFEST, swapped.digest, 0), null);
});

test("an empty context asks rather than searching — Slice 5 has no lookup", () => {
  const r = compile({ operation: "EXPLAIN", subject: { fromContext: 0 } }, EMPTY_MANIFEST, EMPTY_MANIFEST.digest);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.state, "NEEDS_CLARIFICATION");
    if (r.state === "NEEDS_CLARIFICATION") assert.equal(r.missing, "subject");
  }
  // Neither the compiler nor the manifest builder performs a read of any kind.
  for (const src of [strip(COMPILE_SRC), strip(CONTEXT_SRC)]) {
    for (const forbidden of ["query(", "withTenant", "executePursuitQuery", "resolveGoTo", "fetch(", "await ", "async "]) {
      assert.ok(!src.includes(forbidden), `must not contain ${forbidden}`);
    }
  }
});

test("the manifest's ids never reach the prompt shape", () => {
  const shown = JSON.stringify(toPrompt(MANIFEST));
  assert.ok(!shown.includes(ID0) && !shown.includes(ID1), "no identifier is shown to the model");
  assert.match(shown, /Acme Corporation/, "labels — which are already disclosed — are shown");
  const prompt = intentPromptForAudit(MANIFEST);
  assert.ok(!prompt.includes(ID0) && !prompt.includes(ID1));
});

test("a suppressed label becomes the class-generic fallback in the manifest", () => {
  const m = buildContextManifest([row(ID0, cell("Acme Corporation", { visibility: "SUPPRESSED", value: null }))]);
  assert.equal(m.slots[0].label, DESTINATIONS["pursuit@canonical"].fallbackLabel);
  assert.ok(!JSON.stringify(toPrompt(m)).includes("Acme"));
});

// ── clarification and unsupported are non-executing (ruling 7) ──────────────────────────────────

test("NEEDS_CLARIFICATION executes nothing and its key is closed vocabulary", () => {
  for (const missing of ["view", "subject", "operation"]) {
    const r = compile({ operation: "NEEDS_CLARIFICATION", missing });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.state, "NEEDS_CLARIFICATION");
  }
  for (const missing of ["Which pursuit did you mean, Acme or Initech?", "", "org", 1, null]) {
    const r = compile({ operation: "NEEDS_CLARIFICATION", missing });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.state, "UNSUPPORTED", "model prose is not a clarification key");
  }
});

test("the registered clarification questions enumerate no object and imply no alternative", () => {
  for (const [key, text] of Object.entries(CLARIFICATION_QUESTIONS)) {
    assert.ok(text.length > 0, `${key} has a question`);
    assert.ok(!/Acme|Initech|\bor\b.*\bor\b/.test(text) || key === "operation",
      `${key} must not enumerate instances`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(text), "no identifier appears in a question");
  }
});

test("UNSUPPORTED executes nothing", () => {
  const r = compile({ operation: "UNSUPPORTED" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.state, "UNSUPPORTED");
});

// ── provenance is compiler-stamped (ruling 4) ───────────────────────────────────────────────────

test("provenance cannot be forged from ModelProposal fields", () => {
  const forged = compile({
    operation: "SHOW_ME", view: "open-by-value",
    provenance: { compilerVersion: "evil@9", modelId: "forged" },
  });
  assert.equal(forged.ok, false, "an unknown key is refused outright");

  const real = compile({ operation: "SHOW_ME", view: "open-by-value" });
  assert.ok(real.ok);
  if (real.ok) {
    assert.equal(real.intent.provenance.compilerVersion, COMPILER_VERSION);
    assert.equal(real.intent.provenance.source, "HAND_AUTHORED");
    assert.equal(real.intent.provenance.modelId, null, "no model is recorded for a hand-authored proposal");
    assert.equal(real.intent.provenance.promptTemplateVersion, null);
    assert.equal(real.intent.provenance.contextDigest, MANIFEST.digest);
    assert.equal(real.intent.provenance.vocabularyDigest, vocabularyDigest());
    assert.equal(real.intent.provenance.proposalSchemaVersion, 1);
  }
});

test("a caller cannot supply provenance, and a hand-authored proposal fabricates no model", () => {
  for (const key of ["source", "provenance", "compilerVersion", "modelId", "promptTemplateVersion", "vocabularyDigest", "contextDigest"]) {
    const r = compile({ operation: "SHOW_ME", view: "open-by-value", [key]: "forged" });
    assert.equal(r.ok, false, `${key} must be refused by the closed schema`);
  }
  // Stage A: source is stamped hand-authored, and no provider is invented.
  const hand = compile({ operation: "SHOW_ME", view: "open-by-value" });
  assert.ok(hand.ok);
  if (hand.ok) {
    assert.equal(hand.intent.provenance.source, "HAND_AUTHORED");
    assert.equal(hand.intent.provenance.modelId, null);
    assert.equal(hand.intent.provenance.promptTemplateVersion, null);
  }
  // Even if a caller passes model fields alongside a hand-authored source, they are not recorded.
  const lying = compile({ operation: "SHOW_ME", view: "open-by-value" }, MANIFEST, MANIFEST.digest,
    "HAND_AUTHORED", "claude-opus-5", "fake@9");
  assert.ok(lying.ok);
  if (lying.ok) {
    assert.equal(lying.intent.provenance.modelId, null, "a model that never ran is not provenance");
    assert.equal(lying.intent.provenance.promptTemplateVersion, null);
  }
  // A genuine model proposal does record them.
  const model = compile({ operation: "SHOW_ME", view: "open-by-value" }, MANIFEST, MANIFEST.digest,
    "MODEL", "claude-haiku-4-5", PROMPT_TEMPLATE_VERSION);
  assert.ok(model.ok);
  if (model.ok) {
    assert.equal(model.intent.provenance.source, "MODEL");
    assert.equal(model.intent.provenance.modelId, "claude-haiku-4-5");
  }
});

test("source is PROVENANCE, never authority — both sources compile to the identical request", () => {
  const hand = compile({ operation: "ANALYZE", view: "open-pipeline-cohort" });
  const model = compile({ operation: "ANALYZE", view: "open-pipeline-cohort" }, MANIFEST, MANIFEST.digest,
    "MODEL", "claude-haiku-4-5", PROMPT_TEMPLATE_VERSION);
  assert.ok(hand.ok && model.ok);
  if (hand.ok && model.ok) {
    assert.deepEqual(hand.intent.request, model.intent.request);
    assert.equal(hand.intent.operation, model.intent.operation);
    assert.equal(hand.intent.interpretedAs, model.intent.interpretedAs);
  }
});

test("the route's model-off branch returns a registered notice, not a guessed proposal", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  const body = route.slice(route.indexOf("async function IntentView"), route.indexOf("async function SurfaceView"));
  // The master check lives in `proposeIntent`, which returns DISABLED before reading the credential;
  // the route's job is to map that to the registered notice WITHOUT falling through to compilation.
  const model = readFileSync(new URL("../src/lib/experience/intent/model.ts", import.meta.url), "utf8");
  const fn = model.slice(model.indexOf("export async function proposeIntent"));
  const masterAt = fn.indexOf("intentModelEnabled()");
  const credentialAt = fn.indexOf("intentCredential()");
  assert.ok(masterAt >= 0 && credentialAt >= 0, "both the master and the credential are read");
  assert.ok(masterAt < credentialAt, "the master is evaluated before the credential is read");
  const disabledAt = body.indexOf('outcome.status === "DISABLED"');
  const compileAt = body.indexOf("compileIntent(");
  assert.ok(disabledAt >= 0 && compileAt >= 0, "both branches are present in the route");
  assert.ok(disabledAt < compileAt, "a disabled model returns before compilation");
  // `?propose=` is not gated by it: deterministic compilation is not what the master gates.
  assert.match(body, /const fromModel = typeof propose !== "string" && typeof ask === "string"/);
});

test("no governance path reads provenance", () => {
  for (const f of ["execute.ts", "navigate.ts", "analyze.ts", "explain.ts", "validate.ts", "registry.ts"]) {
    const src = readFileSync(new URL(`../src/lib/experience/${f}`, import.meta.url), "utf8");
    assert.ok(!/provenance\.(compilerVersion|modelId|vocabularyDigest|contextDigest)/.test(src), `${f} reads intent provenance`);
  }
});

// ── determinism and removability (ruling 5) ─────────────────────────────────────────────────────

test("identical compiled intents are identical regardless of how the proposal was worded", () => {
  // Two different model outputs that validate to the same canonical request.
  const a = compile({ operation: "SHOW_ME", view: "open-by-value" });
  const b = compile({ view: "open-by-value", operation: "SHOW_ME" });   // key order differs
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(JSON.stringify(a.intent), JSON.stringify(b.intent));
});

test("the same proposal compiles identically every time", () => {
  const p = { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" };
  assert.equal(JSON.stringify(compile(p)), JSON.stringify(compile(p)));
});

test("a compiled GO_TO is exactly the already-certified Slice 4 request shape", () => {
  const r = compile({ operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.intent.request, { requestVersion: 1, ref: { class: "pursuit", id: ID0 }, surface: "canonical" });
  // An unregistered surface is refused; the model cannot invent one.
  for (const surface of ["detail", "review", "canonical#team", ""]) {
    assert.equal(compile({ operation: "GO_TO", subject: { fromContext: 0 }, surface }).ok, false);
  }
});

test("the execution path takes a CompiledIntent and cannot know a model existed", () => {
  const run = readFileSync(new URL("../src/lib/experience/intent/run.ts", import.meta.url), "utf8");
  for (const forbidden of ["proposeIntent", "ModelProposal", "anthropic", "completeStructured", "intentModelEnabled"]) {
    assert.ok(!run.includes(forbidden), `run.ts must not reference ${forbidden}`);
  }
  // It delegates to boundaries certified in earlier slices, and defines no execution of its own.
  assert.match(run, /executePursuitQuery\(PLANS\[view\]\.plan/);
  assert.match(run, /resolveGoTo\(intent\.request/);
  assert.ok(!/\bselect\b|withTenant|mayDerive/.test(run));
});

// ── the prompt carries no governed data (§G) ────────────────────────────────────────────────────

test("no hidden canonical data is required for intent compilation", () => {
  const prompt = intentPromptForAudit(MANIFEST);
  // Everything in the prompt is either a registry key/label or an already-disclosed context label.
  const vocabulary = compilerVocabulary();
  const permitted = new Set<string>([
    ...vocabulary.views.map((v) => v.key), ...vocabulary.views.map((v) => v.label),
    ...vocabulary.surfaces, ...vocabulary.operations, ...vocabulary.clarifications,
    ...MANIFEST.slots.map((s) => s.label),
  ]);
  assert.ok(permitted.size > 0);
  for (const forbidden of ["amount_usd", "open_pipeline_usd@1", "org_id", "opportunities", "SELECT", "750000"]) {
    assert.ok(!prompt.includes(forbidden), `the prompt must not contain ${forbidden}`);
  }
  // A governed cell VALUE that is not a context label must never appear.
  assert.ok(!prompt.includes("QUALIFIED"), "no row value reaches the prompt");
});

test("the vocabulary is derived from the registries and cannot drift", () => {
  const v = compilerVocabulary();
  assert.deepEqual(v.views.map((x) => x.key).sort(), [...VIEW_KEYS].sort());
  assert.deepEqual(v.fields.map((x) => x.ref).sort(), Object.keys(FIELDS).sort());
  assert.deepEqual(v.metrics.map((x) => x.key).sort(), Object.keys(METRICS).sort());
  assert.deepEqual(v.aggregates.map((x) => x.key).sort(), Object.keys(AGGREGATES).sort());
  // It carries no data — only keys and labels.
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(JSON.stringify(v)), "no identifier in the vocabulary");
});

// ── prompt injection (ruling 8) ─────────────────────────────────────────────────────────────────

test("prompt injection cannot introduce a field, metric, filter, cohort, route or action", () => {
  // Whatever an injected utterance persuades a model to emit, it still lands here. These are the
  // shapes an injection would aim for, and none of them compile.
  for (const p of [
    { operation: "SHOW_ME", view: "open-by-value", filters: [{ dimension: "pursuit.account", op: "=", values: [ID0] }] },
    { operation: "SHOW_ME", view: "all-organizations" },
    { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical", path: "/admin" },
    { operation: "EXPORT", view: "open-by-value" },
    { operation: "DELETE", subject: { fromContext: 0 } },
    { operation: "SHOW_ME", view: "open-by-value", asOf: "2020-01-01" },
    { operation: "ANALYZE", view: "open-by-value" },                       // no aggregate on that view
    { operation: "SHOW_ME", view: "open-by-value", orgId: ID1 },
  ]) {
    const r = compile(p);
    assert.equal(r.ok, false, `${JSON.stringify(p).slice(0, 60)} must not compile`);
  }
});

test("the injected-utterance risk is bounded to a DIFFERENT PERMITTED read, and it is visible", () => {
  // The worst case: a hijacked proposal picks another registered view. It still compiles to a
  // governed operation for this same principal — and the surface states which one ran.
  const hijacked = compile({ operation: "SHOW_ME", view: "recently-updated" });
  assert.ok(hijacked.ok);
  if (hijacked.ok) {
    assert.equal(hijacked.intent.interpretedAs, `Show: ${PLANS["recently-updated"].label}`);
    // The disclosure names the canonical operation, and comes from the registry — not from prose.
    assert.ok(hijacked.intent.interpretedAs.includes(PLANS["recently-updated"].label));
  }
});

test("the operation shown to the user matches the operation actually executed", () => {
  for (const [proposal, expectedOp] of [
    [{ operation: "SHOW_ME", view: "open-by-value" }, "SHOW_ME"],
    [{ operation: "ANALYZE", view: "open-pipeline-cohort" }, "ANALYZE"],
    [{ operation: "EXPLAIN", subject: { fromContext: 0 } }, "EXPLAIN"],
    [{ operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" }, "GO_TO"],
  ] as const) {
    const r = compile(proposal);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.intent.operation, expectedOp);
      assert.equal(r.intent.provenance.operation, expectedOp);
      const verb = { SHOW_ME: "Show", ANALYZE: "Analyze", EXPLAIN: "Explain", GO_TO: "Go to" }[expectedOp];
      assert.ok(r.intent.interpretedAs.startsWith(`${verb}:`), r.intent.interpretedAs);
      // It names the view or the class — never an object instance.
      assert.ok(!r.intent.interpretedAs.includes(ID0) && !r.intent.interpretedAs.includes("Acme"));
    }
  }
});

// ── gating (ruling 6) ───────────────────────────────────────────────────────────────────────────

test("the intent master defaults OFF and gates only the model call", () => {
  const original = process.env.PURSUIT_INTENT_ENABLED;
  try {
    delete process.env.PURSUIT_INTENT_ENABLED;
    assert.equal(intentModelEnabled(), false, "default is OFF");
    process.env.PURSUIT_INTENT_ENABLED = "false";
    assert.equal(intentModelEnabled(), false);
    process.env.PURSUIT_INTENT_ENABLED = "true";
    assert.equal(intentModelEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.PURSUIT_INTENT_ENABLED; else process.env.PURSUIT_INTENT_ENABLED = original;
  }
  // With the master off the compiler is untouched: the deterministic grammar does not depend on it.
  assert.ok(!strip(COMPILE_SRC).includes("PURSUIT_INTENT_ENABLED"));
  assert.ok(!strip(COMPILE_SRC).includes("intentModelEnabled"));
  // It is not coupled to dynamic_surfaces.
  const model = readFileSync(new URL("../src/lib/experience/intent/model.ts", import.meta.url), "utf8");
  assert.ok(!/dynamic_surfaces|DYNAMIC_SURFACES/.test(model));
});

test("exactly one module may call a model, and it is not in the execution path", () => {
  const dir = new URL("../src/lib/experience/intent/", import.meta.url);
  for (const f of ["compile.ts", "context.ts", "run.ts", "schema.ts", "vocabulary.ts"]) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/@\/lib\/ai\/client|anthropic|completeStructured/i.test(src), `${f} must not reach a model`);
  }
  const model = readFileSync(new URL("model.ts", dir), "utf8");
  assert.match(model, /completeStructured/);
});
