import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GOVERNED_MCP_TOOLS, serializeOpenPipeline } from "../src/lib/agents/mcp-governed";
import { MCP_TOOLS } from "../src/lib/agents/mcp-tools";
import type { SurfaceOutcome } from "../src/lib/experience/surface/schema";

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
  assert.match(body, /run\(orgId: string\): Promise<unknown>/, "the type takes only an organization");
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
