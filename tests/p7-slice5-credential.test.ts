import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scopedCredential } from "../src/lib/ai/client";
import {
  INTENT_CREDENTIAL_VAR, intentCredential, intentCredentialPresent, intentModelEnabled, proposeIntent,
} from "../src/lib/experience/intent/model";
import { buildContextManifest } from "../src/lib/experience/intent/context";

/**
 * P7 SLICE 5 — CREDENTIAL ISOLATION (Stage B prerequisite).
 *
 * > Provider credentials are capability-scoped inputs, not ambient application authority. A feature
 * > may not become provider-capable merely because another feature's credential exists.
 *
 * These prove the boundary, not the model: no provider is contacted anywhere in this file. An
 * injected transport stands in for the provider purely so the suite can observe WHETHER a call would
 * have happened — it is never trusted more than a model would be.
 */

const MANIFEST = buildContextManifest([]);
const MODEL_SRC = readFileSync(new URL("../src/lib/experience/intent/model.ts", import.meta.url), "utf8");
const CLIENT_SRC = readFileSync(new URL("../src/lib/ai/client.ts", import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Run with a precise env, always restored. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

/** A stand-in provider that records whether it was reached. */
function spy() {
  const calls: { system: string; user: string; apiKey: string }[] = [];
  const transport = async (a: { system: string; user: string; credential: { apiKey: string } }) => {
    calls.push({ system: a.system, user: a.user, apiKey: a.credential.apiKey });
    return { operation: "SHOW_ME", view: "open-by-value" };
  };
  return { calls, transport: transport as never };
}

// ── the conjunction, in order ───────────────────────────────────────────────────────────────────

test("intent OFF: the provider is not reached EVEN WHEN a scoped credential is present", async () => {
  const s = spy();
  const outcome = await withEnv(
    { PURSUIT_INTENT_ENABLED: "off", [INTENT_CREDENTIAL_VAR]: "sk-test-scoped" },
    () => proposeIntent("show me open pursuits", MANIFEST, s.transport));
  assert.equal(outcome.status, "DISABLED");
  assert.equal(s.calls.length, 0, "no provider call may occur while the capability switch is off");
});

test("intent ON but NO scoped credential: fails closed, and never falls back to a global key", async () => {
  const s = spy();
  const outcome = await withEnv(
    {
      PURSUIT_INTENT_ENABLED: "on",
      [INTENT_CREDENTIAL_VAR]: undefined,
      // Both ambient credentials present. Neither may be used.
      ANTHROPIC_API_KEY: "sk-ambient-should-never-be-used",
      ANTHROPIC_AUTH_TOKEN: "sk-ambient-token-should-never-be-used",
    },
    () => proposeIntent("show me open pursuits", MANIFEST, s.transport));
  assert.equal(outcome.status, "UNAVAILABLE", "absent scoped credential is UNAVAILABLE, not a fallback");
  assert.equal(s.calls.length, 0, "no provider call may occur without the scoped credential");
});

test("intent ON with a scoped credential: the SCOPED key is what reaches the seam", async () => {
  const s = spy();
  const outcome = await withEnv(
    { PURSUIT_INTENT_ENABLED: "on", [INTENT_CREDENTIAL_VAR]: "sk-test-scoped", ANTHROPIC_API_KEY: "sk-ambient" },
    () => proposeIntent("show me open pursuits", MANIFEST, s.transport));
  assert.equal(outcome.status, "PROPOSED");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].apiKey, "sk-test-scoped", "the scoped key, never the ambient one");
});

test("a blank or whitespace scoped credential is absent, not a credential", async () => {
  for (const raw of ["", "   ", undefined]) {
    assert.equal(scopedCredential(raw), null, `${JSON.stringify(raw)} must not produce a credential`);
    const present = await withEnv({ [INTENT_CREDENTIAL_VAR]: raw }, () => intentCredentialPresent());
    assert.equal(present, false);
  }
  const present = await withEnv({ [INTENT_CREDENTIAL_VAR]: " sk-x " }, () => intentCredentialPresent());
  assert.equal(present, true, "a real value trims to a credential");
});

test("presence is reported as a boolean and nothing else leaks", async () => {
  await withEnv({ [INTENT_CREDENTIAL_VAR]: "sk-secret-value-12345" }, () => {
    const c = intentCredential();
    assert.notEqual(c, null);
    assert.equal(intentCredentialPresent(), true);
    // The accessor exposes presence; the suite never prints, hashes or measures the value.
    assert.equal(typeof intentCredentialPresent(), "boolean");
  });
});

// ── P7 reads ONLY the scoped variable ───────────────────────────────────────────────────────────

test("the P7 boundary names no ambient credential and cannot reach global discovery", () => {
  // The scoped name CONTAINS the ambient one as a substring, so remove it before looking for the
  // ambient credentials — otherwise the guard fires on the very variable it exists to require.
  const code = strip(MODEL_SRC).split(INTENT_CREDENTIAL_VAR).join("<SCOPED>");
  for (const forbidden of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "getAnthropic", "new Anthropic"]) {
    assert.ok(!code.includes(forbidden), `the P7 boundary must not reference ${forbidden}`);
  }
  // It reads exactly one environment variable, and that one is the scoped credential (plus the master).
  const envReads = [...code.matchAll(/process\.env(?:\.(\w+)|\[([^\]]+)\])/g)]
    .map((m) => m[1] ?? m[2].replace(/INTENT_CREDENTIAL_VAR/, "PURSUIT_INTENT_ANTHROPIC_API_KEY").replace(/["']/g, ""));
  assert.deepEqual([...new Set(envReads)].sort(), ["PURSUIT_INTENT_ANTHROPIC_API_KEY", "PURSUIT_INTENT_ENABLED"]);
  // …and it goes through the scoped seam, which has no fallback path.
  assert.match(code, /completeStructuredScoped\(/);
  assert.ok(!code.includes("completeStructured({"), "the unscoped helper must not be used here");
});

test("the scoped seam cannot fall back: its credential is required and unforgeable", () => {
  const code = strip(CLIENT_SRC);
  const fn = code.slice(code.indexOf("export async function completeStructuredScoped"));
  assert.match(fn, /credential: ScopedCredential;/, "the credential is required, not optional");
  assert.ok(!/credential\?:/.test(fn), "it must not be optional");
  assert.ok(!fn.includes("getAnthropic"), "it must not reach global discovery itself");
  assert.match(fn, /apiKey: opts\.credential\.apiKey/);
  // The only constructor of a ScopedCredential returns null when the variable is absent.
  assert.match(code, /export function scopedCredential\(raw: string \| undefined \| null\): ScopedCredential \| null/);
  // Existing callers are untouched: the old helpers still exist with their old shapes.
  assert.match(code, /export async function completeStructured<T extends z\.ZodType>/);
  assert.match(code, /export async function completeStructuredMeta<T extends z\.ZodType>/);
});

// ── the structural guard: nobody else may consume the scoped variable ───────────────────────────

function productionSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) productionSources(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

test("ONLY the P7 intent boundary consumes the scoped credential variable", () => {
  const root = new URL("../src", import.meta.url).pathname;
  const files = productionSources(root);
  assert.ok(files.length > 100, `the scan must actually cover the source tree (found ${files.length})`);
  const consumers = files.filter((f) => readFileSync(f, "utf8").includes(INTENT_CREDENTIAL_VAR));
  const relative = consumers.map((f) => f.slice(root.length + 1)).sort();
  assert.deepEqual(relative, ["lib/experience/intent/model.ts"],
    `only the P7 boundary may consume ${INTENT_CREDENTIAL_VAR}`);
});

test("no unrelated model surface was migrated or altered", () => {
  // The other provider call sites still use the pre-existing unscoped helpers, unchanged.
  const root = new URL("../src", import.meta.url).pathname;
  const users = productionSources(root)
    .filter((f) => /completeStructured(Meta)?\(/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(root.length + 1)).sort();
  assert.ok(users.length >= 10, `existing model surfaces must still be present (found ${users.length})`);
  assert.ok(!users.includes("lib/experience/intent/model.ts"), "P7 uses the scoped seam, not the unscoped one");
  for (const f of ["lib/interpret/interpreter.ts", "lib/agents/campaign-email.ts", "lib/intel/providers/tavily.ts"]) {
    assert.ok(users.includes(f), `${f} must still use the existing seam`);
  }
});

// ── infrastructure failure is not a product limit ───────────────────────────────────────────────

test("a provider failure is UNAVAILABLE, never UNSUPPORTED", async () => {
  const failing = (async () => { throw new Error("provider exploded"); }) as never;
  const outcome = await withEnv(
    { PURSUIT_INTENT_ENABLED: "on", [INTENT_CREDENTIAL_VAR]: "sk-test-scoped" },
    () => proposeIntent("show me open pursuits", MANIFEST, failing));
  assert.equal(outcome.status, "UNAVAILABLE");
  // And the raw provider error never travels with it.
  assert.ok(!JSON.stringify(outcome).includes("exploded"));
});

test("the route distinguishes disabled, unavailable and unsupported", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  assert.match(route, /outcome\.status === "DISABLED"/);
  assert.match(route, /outcome\.status === "UNAVAILABLE"/);
  assert.match(route, /not enabled here/);
  assert.match(route, /temporarily unavailable/);
  // The entitlement is part of the conjunction: an unentitled org never reaches the model.
  assert.match(route, /if \(fromModel && !base\.ok\) return notice/);
  const body = route.slice(route.indexOf("async function IntentView"));
  assert.ok(body.indexOf("!base.ok") < body.indexOf("proposeIntent("), "entitlement is checked before the model");
});

test("no provider error, prompt or model output reaches the recipient", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  for (const forbidden of ["systemPrompt", "intentPromptForAudit", "err.message", "String(err)"]) {
    assert.ok(!route.includes(forbidden), `the route must not reference ${forbidden}`);
  }
  // The provider's model name is READ for provenance and must never be RENDERED. Asserting that it
  // is absent from the file would now fail for a reason unrelated to the property (§16A), so assert
  // the property: it appears in no JSX expression.
  // JSX renders a value as `{expr}` immediately inside markup, so those are the forms to forbid.
  // A broader "the file must not mention meta.model" would fail for a reason unrelated to the
  // property it names (§16A) — the route legitimately READS it for provenance.
  for (const rendered of [/\{\s*modelId\s*\}/, /\{\s*outcome\.meta\.model\s*\}/, /\{\s*compiled\.intent\.provenance/]) {
    assert.ok(!rendered.test(route), `the route must not render ${rendered}`);
  }
});

// ── the gate defaults ───────────────────────────────────────────────────────────────────────────

test("the capability switch still defaults OFF and the credential does not switch it on", async () => {
  const off = await withEnv({ PURSUIT_INTENT_ENABLED: undefined, [INTENT_CREDENTIAL_VAR]: "sk-test-scoped" },
    () => intentModelEnabled());
  assert.equal(off, false, "credential presence alone confers no capability");
});

// ── provenance recording (Stage B1) ─────────────────────────────────────────────────────────────

test("the provenance record carries compiler metadata only — no utterance, id, value or secret", async () => {
  const { recordIntentProvenance } = await import("../src/lib/experience/intent/model");
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(String(args[0])); };
  try {
    recordIntentProvenance({
      proposalSchemaVersion: 1, source: "MODEL", compilerVersion: "p7-slice5-compiler@1",
      promptTemplateVersion: "p7-slice5-prompt@1", vocabularyDigest: "abcd1234abcd1234",
      contextDigest: "beef1234beef1234", modelId: "claude-haiku-4-5", operation: "SHOW_ME", view: "open-by-value",
    });
  } finally { console.log = original; }

  assert.equal(lines.length, 1, "exactly one record per compiled intent");
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, "p7.intent.compiled");
  // Every required field is present…
  for (const k of ["source", "operation", "modelId", "promptTemplateVersion", "compilerVersion",
                   "proposalSchemaVersion", "vocabularyDigest", "contextDigest"]) {
    assert.ok(record[k] !== undefined, `provenance must record ${k}`);
  }
  assert.equal(record.source, "MODEL");
  // …and nothing else is. The record's key set is closed.
  assert.deepEqual(Object.keys(record).sort(),
    ["compilerVersion", "contextDigest", "event", "modelId", "operation", "promptTemplateVersion",
     "proposalSchemaVersion", "source", "view", "vocabularyDigest"].sort());
  // Structurally: the record reads ONLY provenance fields, so a subject id, an utterance or a
  // credential cannot travel with it. Asserting on substrings would be wrong here — "proposal" is a
  // substring of the legitimate `proposalSchemaVersion` (§16A) — so assert the FIELD SET it reads.
  const src = readFileSync(new URL("../src/lib/experience/intent/model.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export function recordIntentProvenance"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  const fieldsRead = [...new Set([...body.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(fieldsRead,
    ["compilerVersion", "contextDigest", "modelId", "operation", "promptTemplateVersion",
     "proposalSchemaVersion", "source", "view", "vocabularyDigest"].sort(),
    "the record reads provenance fields and nothing else");
  // And it is handed only the provenance object — never the intent, request or proposal.
  assert.match(fn, /^export function recordIntentProvenance\(p: IntentProvenance\): void/);
});

test("the route records the ACTUAL provider model, never the tier name", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  assert.match(route, /modelId = outcome\.meta\.model/);
  assert.ok(!route.includes("INTENT_MODEL_TIER"), "the tier name is not a model identifier");
  // Provenance is recorded before execution and still never rendered.
  const body = route.slice(route.indexOf("async function IntentView"));
  assert.ok(body.indexOf("recordIntentProvenance(") < body.indexOf("runCompiledIntent("));
  assert.ok(!/\{compiled\.intent\.provenance/.test(route), "provenance must not be rendered");
});
