import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GOVERNED_MCP_TOOLS, serializeOpenPipeline } from "../src/lib/agents/mcp-governed";
import { MCP_TOOLS } from "../src/lib/agents/mcp-tools";
import type { SurfaceOutcome } from "../src/lib/experience/surface/schema";
import { MIN_STATEMENT_TIMEOUT_MS, MAX_STATEMENT_TIMEOUT_MS, statementTimeoutOf } from "../src/lib/db/execution-policy";

/**
 * P7 SLICE 14 — GOVERNED EXTERNAL READ ADAPTER (MCP).
 *
 * > **An external adapter may authenticate a caller, resolve that caller into PursuitOS's trusted
 * > execution context, submit a closed governed experience request, and serialize the canonical
 * > result. It may not become a second semantic or authorization layer.**
 *
 * > **P7 is authoritative for concepts P7 owns. Other certified domains may remain authoritative for
 * > concepts P7 does not own. Interface choice may not select between competing definitions of the
 * > same concept.**
 */

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const GOVERNED = SRC("lib/agents/mcp-governed.ts");
const LEGACY = SRC("lib/agents/mcp-tools.ts");
const ROUTE = SRC("app/api/mcp/route.ts");
const PRINCIPAL = SRC("lib/experience/principal.ts");

// ── ONE AUTHORITATIVE ANSWER PER CONCEPT ────────────────────────────────────────────────────────

test("pipeline_summary is the GOVERNED tool; the opportunity implementation was renamed", () => {
  assert.deepEqual(GOVERNED_MCP_TOOLS.map((t) => t.name), ["pipeline_summary"]);
  const legacy = MCP_TOOLS.map((t) => t.name);
  assert.ok(!legacy.includes("pipeline_summary"), "the legacy tool no longer claims that name");
  assert.ok(legacy.includes("opportunity_pipeline_summary"), "it is explicitly opportunity-scoped");
});

test("no two advertised tools claim the same business concept", () => {
  const all = [...GOVERNED_MCP_TOOLS.map((t) => t.name), ...MCP_TOOLS.map((t) => t.name)];
  assert.equal(new Set(all).size, all.length, `duplicate tool name: ${all}`);
  // And the two pipeline tools say what they are, in their own descriptions.
  const canonical = GOVERNED_MCP_TOOLS.find((t) => t.name === "pipeline_summary")!;
  assert.match(canonical.description, /canonical open pipeline/i);
  assert.match(canonical.description, /opportunity_pipeline_summary/, "it points at the other concept");
  const opportunity = MCP_TOOLS.find((t) => t.name === "opportunity_pipeline_summary")!;
  assert.match(opportunity.description, /DISTINCT from/i);
  assert.match(opportunity.description, /pipeline_summary/, "and back at the canonical one");
});

test("account_brief states that its opportunity block is not the canonical metric", () => {
  const brief = MCP_TOOLS.find((t) => t.name === "account_brief")!;
  assert.match(brief.description, /not the PursuitOS canonical open-pipeline metric/i);
});

// ── THE GOVERNED HANDLER CANNOT BECOME A SECOND SEMANTIC LAYER ──────────────────────────────────

test("a governed tool receives NO database handle — SQL is unreachable by signature", () => {
  const body = strip(GOVERNED);
  assert.match(body, /run\(orgId: string, policy\?: ExecutionPolicy\): Promise<unknown>/,
    "the type takes an organization and a RESOURCE policy — no data, no scope, no plan");
  assert.ok(!/Pool|PoolClient/.test(body), "no pool type appears at all");
  assert.ok(!/\.query\(|select |from [a-z_]+ where/i.test(body), "and no query is expressible");
});

test("the governed module reaches canonical truth only through executeExperience", () => {
  const body = strip(GOVERNED);
  assert.match(body, /await executeExperience\(/);
  assert.match(body, /apiCredentialPrincipal\(orgId\)/, "with a branded API-credential principal");
  for (const forbidden of ["dispatchSkill", "runtime/", "P45", "getPool", "withTenant", "loadStageWeights"]) {
    assert.ok(!body.includes(forbidden), `the governed handler must not reach ${forbidden}`);
  }
});

test("the request is FIXED — a caller supplies no spec, plan, context, metric or org", () => {
  const body = strip(GOVERNED);
  const tool = GOVERNED_MCP_TOOLS[0];
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {}, additionalProperties: false },
    "the tool accepts no arguments at all");
  assert.match(body, /contextSource: \{ kind: "NONE" \}/);
  assert.ok(!/SurfaceSpec|PursuitExperienceRequest as|planKey:\s*args|args\./.test(body),
    "no caller input reaches the canonical request");
});

test("no stage weighting or opportunity array leaks into the canonical tool's OUTPUT", () => {
  // §16A — the tool's DESCRIPTION legitimately names the stage-weighted concept in order to point
  // callers at it. Scan the code that actually emits fields, not the prose that disambiguates them.
  const body = strip(GOVERNED);
  const emitting = body.slice(body.indexOf("export function serializeOpenPipeline"));
  for (const legacyShape of ["weightedUsd", "opportunities", "stageWeight", "amount_usd"]) {
    assert.ok(!emitting.includes(legacyShape), `${legacyShape} has no P7 source and must not be emitted`);
  }
  // Control: the description DOES name the other concept, so the scoped scan is discriminating.
  assert.match(GOVERNED_MCP_TOOLS[0].description, /stage-weighted/,
    "the canonical tool points at the opportunity concept rather than pretending it does not exist");
});

// ── SERIALIZATION IS PRESENTATION, NOT COMPUTATION ─────────────────────────────────────────────

const agg = (visibility: string, value: number | null) => ({
  ok: true as const,
  result: {
    layout: "stack" as const,
    provenance: { specVersion: 1 as const, surfaceSpecDigest: "d", componentRegistryDigest: "r",
      vocabularyDigest: "v", contextDigest: "c", compilerVersion: "p7", executionDigest: null,
      source: "HAND_AUTHORED" as const, modelId: null, promptTemplateVersion: null },
    components: [{
      kind: "READ" as const, component: "pursuit.cohort" as const, title: "Cohort total",
      interpretedAs: "Analyze: Open pipeline across open pursuits", view: "open-pipeline-cohort",
      outcome: { kind: "RESULT" as const, outcome: { ok: true as const, result: null as never,
        aggregate: { aggregate: { id: "cohort.open_pipeline_usd", version: 1 },
          over: { id: "pursuit.open_pipeline_usd", version: 1 }, operation: "SUM",
          cohort: {} as never, visibility, value, provenance: "…" } } },
    }],
  },
}) as unknown as SurfaceOutcome;

test("a DISCLOSED aggregate serializes its exact canonical value", () => {
  const out = serializeOpenPipeline(agg("EXACT", 6_250_000)) as Record<string, unknown>;
  assert.equal(out.status, "DISCLOSED");
  assert.equal(out.value, 6_250_000, "the canonical value, unrecomputed");
  assert.equal(out.concept, "pursuit_open_pipeline");
  assert.equal(out.metric, "cohort.open_pipeline_usd@1");
});

test("a WITHHELD aggregate carries its state and NO number", () => {
  const out = serializeOpenPipeline(agg("WITHHELD", null)) as Record<string, unknown>;
  assert.equal(out.status, "WITHHELD");
  assert.ok(!("value" in out), "no value key at all — not 0, not null, not an empty string");
  assert.ok(!("currency" in out), "and nothing that implies a magnitude");
  // NEGATIVE CONTROL: a model reading this must not be able to infer zero.
  assert.ok(!JSON.stringify(out).includes(": 0"), "withholding is never encoded as zero");
});

test("canonical dispositions survive serialization, distinctly", () => {
  const of = (error: string) => (serializeOpenPipeline({ ok: false, error } as SurfaceOutcome) as Record<string, unknown>).status;
  assert.equal(of("CAPABILITY_DENIED"), "CAPABILITY_NOT_ENABLED");
  assert.equal(of("NOT_AVAILABLE"), "NOT_AVAILABLE");
  assert.equal(of("NO_SELECTABLE_RESULT"), "NO_SELECTABLE_RESULT");
  assert.equal(of("INVALID"), "INVALID_REQUEST");
  assert.equal(of("FAILED"), "FAILED");
  assert.equal(new Set(["CAPABILITY_NOT_ENABLED", "NOT_AVAILABLE", "NO_SELECTABLE_RESULT", "INVALID_REQUEST", "FAILED"]).size, 5,
    "five distinct outcomes, none collapsed into another");
});

test("the serializer computes nothing", () => {
  const body = strip(GOVERNED);
  const fn = body.slice(body.indexOf("export function serializeOpenPipeline"), body.indexOf("function dispositionOf"));
  for (const forbidden of ["query", "reduce", "+ ", "* ", "Math.", "fetch("]) {
    assert.ok(!fn.includes(forbidden), `the serializer must not ${forbidden}`);
  }
});

// ── READ / ACTION SEPARATION, ENFORCED BEFORE DISPATCH ─────────────────────────────────────────

test("both write tools declare operator scope", () => {
  const writes = MCP_TOOLS.filter((t) => t.write);
  assert.deepEqual(writes.map((t) => t.name).sort(), ["draft_touch", "request_warm_intro"]);
  assert.ok(writes.every((t) => t.scope === "operator"), writes.map((t) => [t.name, t.scope]).join());
});

test("scope is enforced at the transport BEFORE dispatchSkill", () => {
  const body = strip(ROUTE);
  const guard = body.indexOf("if (!scopeAllows(key.scope, toolScope(tool)))");
  const dispatch = body.indexOf("dispatchSkill(");
  assert.ok(guard > 0, "the route refuses out-of-scope tools itself");
  assert.ok(guard < dispatch, "and does so before any dispatch is attempted");
  assert.match(body, /const scopeAllows = \(keyScope: string, need: "read" \| "operator"\)/);
});

test("tools/list is scope-filtered", () => {
  const body = strip(ROUTE);
  assert.match(body, /case "tools\/list":\s*return rpcResult\(id, \{ tools: visibleTools\(key\.scope\) \}\)/);
  assert.match(body, /filter\(\(t\) => scopeAllows\(keyScope, toolScope\(t\)\)\)/);
  // NEGATIVE CONTROL: the unfiltered listing would be caught.
  assert.ok(!/tools: MCP_TOOLS\.map/.test(body), "the old unfiltered listing is gone");
});

test("an out-of-scope call is refused identically to an unknown tool", () => {
  const body = strip(ROUTE);
  const region = body.slice(body.indexOf("if (!scopeAllows(key.scope, toolScope(tool)))"));
  assert.match(region.slice(0, 120), /Unknown tool/,
    "refusing differently from the listing would itself disclose that the tool exists");
});

test("dispatchSkill's own role check is untouched — defense in depth", () => {
  const skills = strip(SRC("lib/pursuits/federation/skills.ts"));
  assert.match(skills, /ROLE_RANK\[actor\.role \?\? "any"\] < ROLE_RANK\[def\.requiredPermission\]/);
});

// ── IDENTITY ───────────────────────────────────────────────────────────────────────────────────

test("the API-credential principal is org-bound and invents no human identity", () => {
  const body = strip(PRINCIPAL);
  assert.match(body, /export function apiCredentialPrincipal\(orgId: string\): ExecutionPrincipal/);
  assert.match(body, /mint\(orgId, "api-credential"\)/);
  const fn = body.slice(body.indexOf("export function apiCredentialPrincipal"));
  assert.ok(!/userId|user_id|principalUserId/.test(fn.slice(0, 200)), "no user is synthesized");
  // The org comes from the key record, never from the request.
  const route = strip(ROUTE);
  assert.match(route, /const orgId = key\.orgId/, "the organization comes from the credential");
  assert.ok(!/params\?\.orgId|args\.orgId|args\.role/.test(route), "never from caller input");
});

test("an organization-level rate bound exists beside the per-key one", () => {
  const body = strip(ROUTE);
  assert.match(body, /rateLimited\(`mcp-key:\$\{key\.keyId\}`/, "the per-key bound is preserved");
  assert.match(body, /rateLimited\(`mcp-org:\$\{key\.orgId\}`/, "and an org bound was added");
});

// ── D-S14-EXECUTION-BOUND · THE RESOURCE BOUND IS PART OF THE CERTIFIED GRAPH ───────────────────

/**
 * The measured graph for ONE external `pipeline_summary` call:
 *
 *   1 auth statement + 4 (capability transaction) + 6 + 3 × rows (governed transaction)
 *     = 11 + 3 × rows, with rows ≤ 50 by the registered plan's limit
 *     = 162 statements maximum, plus one cold substrate posture read.
 *
 * This block proves the graph is POLICY-AWARE, not that it is fast. Every stage below is classified
 * explicitly — DB-bearing stages must carry the policy, DB-free stages must be provably DB-free —
 * so a later change that adds an unbounded database path here fails the suite rather than quietly
 * widening the ceiling.
 */

const POLICY = SRC("lib/db/execution-policy.ts");
const TENANT = SRC("lib/db/tenant.ts");
const POSTURE = SRC("lib/env/db-posture.ts");
const EXECUTE = SRC("lib/experience/execute.ts");
const ASSEMBLE = SRC("lib/experience/surface/assemble.ts");
const EXECUTOR = SRC("lib/experience/surface/execute-experience.ts");
const INTENT_RUN = SRC("lib/experience/intent/run.ts");

/** Split a call's arguments at DEPTH ZERO, so a nested call or object never looks like a boundary. */
function callArgs(source: string, callee: string, from = 0): string[] | null {
  const at = source.indexOf(`${callee}(`, from);
  if (at < 0) return null;
  let i = at + callee.length, depth = 0, start = i + 1;
  const args: string[] = [];
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) { args.push(source.slice(start, i).trim()); return args.filter(Boolean); }
    } else if (ch === "," && depth === 1) { args.push(source.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

/** Every call to `callee` in `source`, as depth-zero argument lists. */
function allCalls(source: string, callee: string): string[][] {
  const out: string[][] = [];
  for (let i = 0; ; ) {
    const at = source.indexOf(`${callee}(`, i);
    if (at < 0) return out;
    // Skip the DEFINITION — we are inventorying call sites, not the declaration.
    const before = source.slice(Math.max(0, at - 30), at);
    if (/function\s+$/.test(before)) { i = at + 1; continue; }
    const args = callArgs(source, callee, at);
    if (args) out.push(args);
    i = at + 1;
  }
}

test("INVENTORY · every DB-bearing stage of the external graph accepts the execution policy", () => {
  const dbBearing: [string, string, string][] = [
    ["api-key resolution",        strip(LEGACY),    "export async function resolveKey"],
    ["substrate certification",   strip(POSTURE),   "export async function assertCanonicalSubstrate"],
    ["capability transaction",    strip(ASSEMBLE),  "export async function dynamicSurfacesEnabled"],
    ["surface assembly",          strip(ASSEMBLE),  "export async function assembleSurface"],
    ["canonical executor",        strip(EXECUTOR),  "export async function executeExperience"],
    ["context resolution",        strip(EXECUTOR),  "export async function resolveExperienceContext"],
    ["compiled-intent execution", strip(INTENT_RUN),"export async function runCompiledIntent"],
    ["governed query",            strip(EXECUTE),   "export async function executePursuitQuery"],
    ["navigation resolution",     strip(EXECUTE),   "export async function resolveGoTo"],
    ["tenant transaction (org)",  strip(TENANT),    "export async function withTenantOrg"],
    ["tenant transaction (web)",  strip(TENANT),    "export async function withTenant<"],
  ];
  assert.equal(dbBearing.length, 11, "the DB-bearing inventory is fixed — adding a stage is a decision");
  for (const [label, body, decl] of dbBearing) {
    const at = body.indexOf(decl);
    assert.ok(at > 0, `${label}: declaration not found — the inventory is stale, not passing`);
    const signature = body.slice(at, body.indexOf("{", body.indexOf(")", at)));
    assert.match(signature, /policy\??: ExecutionPolicy/, `${label} does not accept the execution policy`);
  }
});

test("INVENTORY · every tenant/bounded transaction on the external path is PASSED the policy", () => {
  // The sweep that actually bites: a new `withTenantOrg(...)` added to any of these modules without
  // threading the policy fails here, because the call site is read, not the file.
  const swept: [string, string][] = [
    ["execute.ts", strip(EXECUTE)], ["assemble.ts", strip(ASSEMBLE)],
    ["execute-experience.ts", strip(EXECUTOR)], ["mcp-tools.ts", strip(LEGACY)],
    ["db-posture.ts", strip(POSTURE)],
  ];
  let seen = 0;
  for (const [file, body] of swept) {
    for (const callee of ["withTenantOrg", "withTenant", "withStatementBound"]) {
      for (const args of allCalls(body, callee)) {
        seen++;
        const last = args[args.length - 1];
        assert.ok(/policy|ms|EXECUTION|POLICY/.test(args.join("|")),
          `${file}: ${callee}(${args.join(", ")}) runs database work with no execution policy`);
        assert.ok(last !== undefined);
      }
    }
  }
  // ANTI-VACUITY: if the extractor silently matched nothing, every assertion above passed by
  // looking at zero call sites. It must find the ones we know exist.
  assert.ok(seen >= 6, `the call-site sweep found only ${seen} transactions — it is not reading the code`);
});

test("INVENTORY · the transport elects the policy; nothing else in the graph invents one", () => {
  const route = strip(ROUTE);
  assert.match(route, /const EXTERNAL_READ_POLICY: ExecutionPolicy = \{ statementTimeoutMs: 500 \}/);
  assert.deepEqual(callArgs(route, "governed.run"), ["orgId", "EXTERNAL_READ_POLICY"]);
  assert.deepEqual(callArgs(route, "resolveKey"), ["getPool()", "bearer", "EXTERNAL_READ_POLICY"]);
  // No OTHER module may mint a timeout — that would be a second, invisible ceiling.
  for (const [file, body] of [["execute.ts", EXECUTE], ["assemble.ts", ASSEMBLE],
                              ["execute-experience.ts", EXECUTOR], ["mcp-governed.ts", GOVERNED]] as const) {
    assert.ok(!/statementTimeoutMs\s*:/.test(strip(body)), `${file} invents its own bound`);
  }
});

test("INVENTORY · the DB-FREE stages are DB-free, stated rather than assumed", () => {
  // Classifying these explicitly is the other half of the inventory: a stage that silently GAINED a
  // database call would otherwise simply not appear in the DB-bearing list and pass by omission.
  const governed = strip(GOVERNED);
  assert.ok(!/getPool|withTenant|\.query\(|Pool/.test(governed), "the governed adapter reaches no database");
  const serializer = governed.slice(governed.indexOf("export function serializeOpenPipeline"),
                                    governed.indexOf("function dispositionOf"));
  assert.ok(!/await/.test(serializer), "serialization is synchronous — it cannot perform IO at all");
  // Rate limiting, bearer extraction and scope checks are in-memory by construction.
  const limiter = strip(SRC("lib/security/rate-limit.ts"));
  assert.ok(!/\.query\(|getPool|Pool/.test(limiter), "the rate limiter touches no database");
});

test("INVENTORY · the governed loaders are bounded by INHERITANCE, and provably so", () => {
  // Every loader takes the transaction's client, so it inherits that transaction's
  // statement_timeout; what must be proven is that none of them opens a connection of its own,
  // which would escape the bound entirely. The set of loaders changed when per-row acquisition
  // became bounded set loading (D-S14-EXECUTION-BOUND) — the inheritance requirement did not.
  const body = strip(EXECUTE);
  for (const loader of ["loadCandidates", "loadCohortViewers", "loadCohortDerivationFacts",
                        "loadMetricInputs", "resolveScope"]) {
    const args = callArgs(body, loader);
    assert.ok(args && args[0] === "db", `${loader} must receive the transaction's client, got ${args?.[0]}`);
  }
  // The per-member decision is now DB-free by signature: it takes facts, not a client.
  const decide = callArgs(body, "governMetric");
  assert.ok(decide && decide[0] !== "db", "the per-member metric decision must not take a database client");
  for (const file of ["lib/pursuits/federation/batch-facts.ts"]) {
    assert.ok(!/getPool\(\)/.test(strip(SRC(file))), `${file} never acquires a connection of its own`);
  }
  assert.ok(!/getPool\(\)/.test(body), "the governed query never acquires a connection outside its transaction");
});

// ── THE POLICY IS RESOURCE METADATA, NEVER SEMANTICS ───────────────────────────────────────────

test("the policy cannot enter the canonical request, the spec, the manifest or provenance", () => {
  const executor = strip(EXECUTOR);
  const request = executor.slice(executor.indexOf("interface PursuitExperienceRequest"),
                                 executor.indexOf("}", executor.indexOf("interface PursuitExperienceRequest")));
  assert.ok(!/policy|timeout|Timeout/i.test(request), "PursuitExperienceRequest carries no resource policy");
  // It is a SEPARATE parameter from the request — not a field inside it.
  assert.match(executor, /request: PursuitExperienceRequest,\s*principal: ExecutionPrincipal,\s*policy\?: ExecutionPolicy,/);
  // And no recipient-facing serialization mentions it.
  const emitted = strip(GOVERNED);
  assert.ok(!/500|timeout/i.test(emitted.slice(emitted.indexOf("export function serializeOpenPipeline"))),
    "no bound, and no evidence one exists, reaches a recipient");
});

test("the MCP tool exposes no timeout argument — a caller cannot choose its own bound", () => {
  assert.deepEqual(GOVERNED_MCP_TOOLS[0].inputSchema,
    { type: "object", properties: {}, additionalProperties: false });
  const route = strip(ROUTE);
  assert.ok(!/args\.(timeout|statementTimeoutMs|policy)|params\?\.(timeout|policy)/.test(route),
    "no caller input reaches the execution policy");
});

test("an absent policy changes nothing — existing web callers keep their behavior", () => {
  const tenant = strip(TENANT);
  const apply = tenant.slice(tenant.indexOf("async function applyStatementBound"));
  assert.match(apply.slice(0, 260), /if \(ms === null\) return;/,
    "no policy means no statement is issued at all, not a default that silently differs");
  // Every propagating signature makes it OPTIONAL.
  for (const [file, body] of [["execute.ts", EXECUTE], ["assemble.ts", ASSEMBLE],
                              ["execute-experience.ts", EXECUTOR], ["run.ts", INTENT_RUN]] as const) {
    const required = /policy: ExecutionPolicy[,)]/.exec(strip(body));
    assert.equal(required, null, `${file} makes the policy required, breaking existing callers`);
  }
});

// ── THE BOUND ITSELF ───────────────────────────────────────────────────────────────────────────

test("the bound is clamped — a zero or NaN cannot silently DISABLE the timeout", () => {
  assert.equal(statementTimeoutOf(undefined), null, "no policy → no bound, explicitly");
  assert.equal(statementTimeoutOf({}), null);
  assert.equal(statementTimeoutOf({ statementTimeoutMs: 500 }), 500);
  // In PostgreSQL, statement_timeout = 0 means NO TIMEOUT. Passing 0 must not disarm the bound.
  assert.equal(statementTimeoutOf({ statementTimeoutMs: 0 }), MIN_STATEMENT_TIMEOUT_MS);
  assert.equal(statementTimeoutOf({ statementTimeoutMs: -1 }), MIN_STATEMENT_TIMEOUT_MS);
  assert.equal(statementTimeoutOf({ statementTimeoutMs: NaN }), null);
  assert.equal(statementTimeoutOf({ statementTimeoutMs: 10 ** 9 }), MAX_STATEMENT_TIMEOUT_MS);
});

test("the bounded primitive uses ONE client, a transaction, and a bound PARAMETER", () => {
  const body = strip(POLICY);
  const fn = body.slice(body.indexOf("export async function withStatementBound"));
  assert.match(fn, /const db = await pool\.connect\(\)/, "exactly one client is checked out");
  assert.match(fn, /await db\.query\("begin"\)/);
  assert.match(fn, /select set_config\('statement_timeout', \$1, true\)`, \[String\(ms\)\]/,
    "transaction-local, and the value is a bound parameter");
  assert.match(fn, /await db\.query\("commit"\)/);
  assert.match(fn, /await db\.query\("rollback"\)/);
  assert.match(fn, /finally \{[\s\S]*db\.release\(\)/, "always released");
  // NEGATIVE CONTROLS — the forms that would be wrong.
  assert.ok(!/pool\.query\(/.test(fn), "never pool.query: two statements could land on two connections");
  assert.ok(!/SET\s+statement_timeout|set statement_timeout/i.test(fn), "no session-global SET");
  assert.ok(!/\$\{ms\}|\$\{timeoutMs\}/.test(fn), "no SQL interpolation of the timeout");
  assert.ok(!/Promise\.race|setTimeout|AbortController/.test(body), "no fake client-side deadline");
});

test("no ambient state — the policy is threaded explicitly, everywhere", () => {
  // §16A — scan STRIPPED code. execution-policy.ts names AsyncLocalStorage in prose precisely to
  // record that it was considered and rejected; matching that would fail the file for documenting
  // the ruling it obeys.
  for (const [file, body] of [["execution-policy.ts", POLICY], ["tenant.ts", TENANT],
                              ["execute.ts", EXECUTE], ["assemble.ts", ASSEMBLE],
                              ["execute-experience.ts", EXECUTOR], ["mcp-governed.ts", GOVERNED],
                              ["route.ts", ROUTE], ["db-posture.ts", POSTURE]] as const) {
    assert.ok(!/AsyncLocalStorage|async_hooks/.test(strip(body)), `${file} propagates the policy ambiently`);
  }
  // CONTROL: the prose DOES name it, so the scoped scan above is discriminating rather than vacuous.
  assert.match(POLICY, /AsyncLocalStorage/, "the rejected alternative is still recorded in prose");
});

test("a statement timeout is classified internally and NEVER shaped into a governed outcome", () => {
  const body = strip(POLICY);
  assert.match(body, /export const PG_QUERY_CANCELED = "57014"/);
  assert.match(body, /export function isStatementTimeout/);
  // The recipient mapping is unchanged: there is no path from a timeout to a governed disposition.
  const governed = strip(GOVERNED);
  const disp = governed.slice(governed.indexOf("function dispositionOf"));
  assert.ok(!/57014|timeout|canceled|cancelled/i.test(disp),
    "a cancelled statement must not become WITHHELD, NOT_AVAILABLE, INVALID or a zero");
  // It reaches the caller as the transport's generic failure, with no message.
  const route = strip(ROUTE);
  assert.match(route, /JSON\.stringify\(\{ status: "FAILED" \}, null, 2\)/);
});

test("the certified pool is never blessed by a FAILED or timed-out posture read", () => {
  const body = strip(POSTURE);
  const fn = body.slice(body.indexOf("export async function assertCanonicalSubstrate"));
  const add = fn.indexOf("certifiedPools.add");
  const guard = fn.indexOf("throw new IllegalExecutionSubstrate");
  assert.ok(add > 0 && guard > 0 && guard < add, "every refusal path throws before the pool is cached");
  // The fast path still exists and still comes first.
  assert.ok(fn.indexOf("certifiedPools.has") < fn.indexOf("statementTimeoutOf"),
    "an already-certified pool issues no statement, bounded or otherwise");
  // And the posture requirements themselves are untouched.
  assert.match(fn, /p\.role !== CANONICAL_APP_ROLE \|\| p\.bypassRls \|\| p\.superuser \|\| !p\.tenantEnforcement/);
});

test("credential resolution is bounded, and a malformed bearer still costs no database work", () => {
  const body = strip(LEGACY);
  const fn = body.slice(body.indexOf("export async function resolveKey"), body.indexOf("export interface McpToolDef"));
  const prefix = fn.indexOf('bearer.startsWith("pos_")');
  const bound = fn.indexOf("withStatementBound");
  assert.ok(prefix > 0 && bound > prefix, "the shape check precedes any connection being taken");
  assert.match(fn, /withStatementBound\(pool as Pool, ms/);
  assert.match(fn, /resolve_api_key\(\$1\)/, "the bearer remains a bound parameter, hashed");
  assert.ok(!/policy\.statementTimeoutMs\s*=|bearer.*timeout/i.test(fn), "the credential cannot set its own bound");
});
