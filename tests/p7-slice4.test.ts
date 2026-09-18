import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { navigate, validateGoToRequest } from "../src/lib/experience/navigate";
import { resolveGoTo } from "../src/lib/experience/execute";
import { DESTINATIONS, destinationKey, pathFor } from "../src/lib/experience/registry";
import { goToPlanFor } from "../src/lib/experience/plans";
import type { GovernedCell, GovernedRow, GoToRequest } from "../src/lib/experience/types";

/**
 * P7 SLICE 4 — the GO TO proofs that need no database.
 *
 * `navigate()` is pure, so the dangerous inputs can be constructed directly: a row whose label cell
 * was suppressed, a row missing a required ref, and two rows differing only in what the recipient may
 * not see. Per §16A these assert on structure and output; per §16B, where evidence must be read from
 * outside (the build manifest), its absence is a FAILURE and never a silently satisfied assertion.
 */

const ID = "11111111-2222-4333-8444-555555555555";
const DEF = DESTINATIONS[destinationKey("pursuit", "canonical")];
const SRC = readFileSync(new URL("../src/lib/experience/navigate.ts", import.meta.url), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const request = (): GoToRequest => ({ requestVersion: 1, ref: { class: "pursuit", id: ID }, surface: "canonical" });
const cell = (over: Partial<GovernedCell> = {}): GovernedCell =>
  ({ visibility: "EXACT", value: "Acme Corporation", provenance: "pursuit.account_name", existence: "AUTHORIZED", ...over });
const row = (cells: Record<string, GovernedCell>): GovernedRow => ({ objectRef: { class: "pursuit", id: ID }, cells });
const governedRow = (label: GovernedCell = cell()): GovernedRow =>
  row({ "pursuit.id": { visibility: "EXACT", value: ID, provenance: "pursuit.id", existence: "AUTHORIZED" }, "pursuit.account_name": label });

// ── the request type cannot express a route (ruling 1) ──────────────────────────────────────────

test("arbitrary URLs, pathnames, fragments and route parameters are UNREPRESENTABLE", () => {
  for (const key of ["path", "pathname", "url", "href", "route", "target", "params", "query", "fragment", "hash", "redirect", "orgId", "organization", "scope", "label"]) {
    const r = validateGoToRequest({ ...request(), [key]: "/anything" });
    assert.equal(r.ok, false, `${key} must be rejected outright`);
    if (!r.ok) assert.match(r.detail, new RegExp(`^unknown request key ${key}$`));
  }
  // …and the same inside `ref`, which is the only nested object in the shape.
  for (const key of ["path", "url", "org", "orgId", "slug"]) {
    const r = validateGoToRequest({ ...request(), ref: { class: "pursuit", id: ID, [key]: "x" } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.detail, new RegExp(`^unknown ref key ${key}$`));
  }
});

test("a pathname smuggled through ref.id is not an id and never becomes one", () => {
  for (const id of [
    "/pursuits/11111111-2222-4333-8444-555555555555",
    "../../etc/passwd",
    "https://evil.example.com",
    "11111111-2222-4333-8444-555555555555#team",
    "11111111-2222-4333-8444-555555555555?x=1",
    "11111111-2222-4333-8444-555555555555/../../admin",
    "not-a-uuid", "", "%2e%2e%2f",
  ]) {
    const r = validateGoToRequest({ ...request(), ref: { class: "pursuit", id } });
    assert.equal(r.ok, false, `${id} must not validate`);
    if (!r.ok) assert.equal(r.detail, "ref.id must be a canonical uuid");
  }
});

test("the caller cannot select another organization — there is no field for one", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.request).sort(), ["ref", "requestVersion", "surface"]);
  // The plan GO TO runs carries no organization either (the Slice 3 rule, unchanged).
  const plan = goToPlanFor(ID) as unknown as Record<string, unknown>;
  for (const key of ["orgId", "organizations", "tenant"]) assert.equal(key in plan, false);
});

test("an unknown object class or surface hard-fails at registry validation", () => {
  const unknownClass = validateGoToRequest({ ...request(), ref: { class: "company", id: ID } });
  assert.equal(unknownClass.ok, false);
  if (!unknownClass.ok) assert.match(unknownClass.detail, /unknown destination company@canonical/);
  for (const surface of ["detail", "review", "canonical#team", "CANONICAL", ""]) {
    const r = validateGoToRequest({ ...request(), surface });
    assert.equal(r.ok, false, `${surface} must not validate`);
    if (!r.ok) assert.match(r.detail, /^unknown surface/);
  }
  assert.equal(validateGoToRequest({ ...request(), requestVersion: 2 }).ok, false);
});

// ── malformed input fails BEFORE any database work ──────────────────────────────────────────────

test("a malformed id fails before query construction — proven by reaching no database at all", async () => {
  // These tests run with no DATABASE_URL. If validation did not refuse first, resolveGoTo would call
  // executePursuitQuery, which would attempt a connection and fail with something else entirely.
  const outcome = await resolveGoTo({ requestVersion: 1, ref: { class: "pursuit", id: "'; drop table pursuits; --" }, surface: "canonical" });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error, "INVALID_REQUEST");
    if (outcome.error === "INVALID_REQUEST") assert.equal(outcome.detail, "ref.id must be a canonical uuid");
  }
  // Structurally: validation is the first statement, and the governed read is reached only after it.
  const exec = readFileSync(new URL("../src/lib/experience/execute.ts", import.meta.url), "utf8");
  const body = exec.slice(exec.indexOf("export async function resolveGoTo"));
  assert.ok(body.indexOf("validateGoToRequest") < body.indexOf("executePursuitQuery"),
    "the request is validated before the governed read");
});

// ── a target is formed only from a governed row ─────────────────────────────────────────────────

test("a governed row yields a deterministic target whose path carries only the canonical id", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  const out = navigate(governedRow(), r.request, r.destination);
  assert.ok(out.ok);
  if (out.ok) {
    assert.equal(out.target.path, `/pursuits/${ID}`);
    assert.equal(out.target.surface, "canonical");
    assert.deepEqual(out.target.ref, { class: "pursuit", id: ID });
    // The path contains the id and nothing else that varies — no slug, no fragment, no query.
    assert.equal(out.target.path.replace(ID, ":id"), DEF.pathTemplate);
    assert.ok(!/[#?]/.test(out.target.path), "no fragment and no query string");
  }
});

test("the identifier put into the path comes from the GOVERNED ROW, not from the caller", () => {
  assert.match(CODE, /pathFor\(def,\s*row\.objectRef\.id\)/);
  // …and the single path-forming function refuses anything that is not a canonical id.
  assert.throws(() => pathFor(DEF, "../admin"), /canonical id/);
  assert.throws(() => pathFor(DEF, ""), /canonical id/);
});

test("the same reference and the same governed row yield a byte-identical target", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(
    JSON.stringify(navigate(governedRow(), r.request, r.destination)),
    JSON.stringify(navigate(governedRow(), r.request, r.destination)));
});

// ── the label is governed (ruling 4) ────────────────────────────────────────────────────────────

test("a suppressed label produces the class-generic fallback and leaks nothing", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  const suppressed = navigate(
    governedRow({ visibility: "SUPPRESSED", value: null, provenance: "pursuit.account_name", reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" }),
    r.request, r.destination);
  assert.ok(suppressed.ok);
  if (suppressed.ok) {
    assert.equal(suppressed.target.label, "Pursuit");
    assert.equal(suppressed.target.label, DEF.fallbackLabel);
    assert.ok(!/NOT_DISCLOSABLE/.test(JSON.stringify(suppressed)), "no reason code reaches the target");
  }
});

test("changing ONLY hidden label data changes no recipient-visible navigation byte", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  // A suppressed cell that (wrongly) still carried a value must not influence the target.
  const mk = (secret: string) => navigate(
    governedRow({ visibility: "SUPPRESSED", value: secret, provenance: "pursuit.account_name", reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" }),
    r.request, r.destination);
  const a = mk("Acme Corporation"), b = mk("Initech Holdings");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(!JSON.stringify(a).includes("Acme") && !JSON.stringify(a).includes("Initech"));
});

test("a label whose EXISTENCE is unauthorized is not used, and is not acknowledged", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  const out = navigate(governedRow(cell({ existence: "UNAUTHORIZED" })), r.request, r.destination);
  assert.ok(out.ok);
  if (out.ok) {
    assert.equal(out.target.label, "Pursuit");
    assert.ok(!JSON.stringify(out).includes("Acme"));
  }
});

test("no second read is performed to obtain a label — the label comes from the row or is the fallback", () => {
  assert.equal([...CODE.matchAll(/row\.cells\[/g)].length, 2, "the row is read for requires and for the label, nowhere else");
  for (const forbidden of ["query(", "withTenant", "executePursuitQuery", "await ", "async "]) {
    assert.ok(!CODE.includes(forbidden), `navigate() must not contain ${forbidden}`);
  }
});

// ── the two absences, never conflated (rulings 2 and 7) ─────────────────────────────────────────

test("UNAVAILABLE_TARGET is produced only when a required ref is unusable, and carries nothing", () => {
  const r = validateGoToRequest(request());
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const broken of [
    row({}),                                                                    // required ref absent
    row({ "pursuit.id": { visibility: "EXACT", value: ID, provenance: "pursuit.id", existence: "UNAUTHORIZED" } }),
  ]) {
    const out = navigate(broken, r.request, r.destination);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.error, "UNAVAILABLE_TARGET");
      // No hidden path, no hidden label, no alternate route, no org metadata, no diagnostic reason.
      assert.deepEqual(Object.keys(out).sort(), ["error", "ok"]);
      assert.ok(!JSON.stringify(out).includes("/pursuits/"), "no path is disclosed");
      assert.ok(!JSON.stringify(out).includes(ID));
    }
  }
});

test("NOT_AVAILABLE and UNAVAILABLE_TARGET are distinct states, and neither carries a reason", () => {
  const notAvailable = { ok: false as const, error: "NOT_AVAILABLE" as const };
  assert.notEqual(JSON.stringify(notAvailable), JSON.stringify({ ok: false, error: "UNAVAILABLE_TARGET" }));
  // NOT_AVAILABLE is a bare value: the unauthorized/nonexistent distinction has no field to live in.
  assert.deepEqual(Object.keys(notAvailable).sort(), ["error", "ok"]);
  const exec = readFileSync(new URL("../src/lib/experience/execute.ts", import.meta.url), "utf8");
  const body = exec.slice(exec.indexOf("export async function resolveGoTo"), exec.indexOf("async function loadCandidates"));
  // Every non-row outcome collapses to the same value — capability denial included.
  assert.equal([...body.matchAll(/error: "NOT_AVAILABLE"/g)].length, 2);
  assert.ok(!/FORBIDDEN|NOT_FOUND|UNAUTHORIZED_OBJECT/.test(body), "no second failure taxonomy exists");
});

// ── the transport (ruling 3) ────────────────────────────────────────────────────────────────────

test("no redirect is issued, and the transport re-checks nothing", () => {
  const route = readFileSync(new URL("../src/app/experience/pursuits/page.tsx", import.meta.url), "utf8");
  assert.ok(!/\bredirect\s*\(/.test(route), "the route issues no redirect");
  assert.ok(!/permanentRedirect|RedirectType|Response\.redirect/.test(route));
  // The goto branch calls the resolver and renders its outcome; it computes no authority of its own.
  assert.match(route, /resolveGoTo\(\{\s*requestVersion: 1/);
  for (const forbidden of ["mayDerive", "resolveDisclosure", "buildFederationViewer", "withTenant", "can_see_pursuit"]) {
    assert.ok(!route.includes(forbidden), `the transport must not contain ${forbidden}`);
  }
  // The route's request inputs are exactly three, and none of them is a route, path or organization.
  const params = route.match(/searchParams:\s*Promise<\{([^}]*)\}>/)?.[1] ?? "";
  assert.deepEqual([...params.matchAll(/(\w+)\??:/g)].map((m) => m[1]).sort(),
    ["ask", "ctx", "explain", "goto", "propose", "view"]);
});

test("the resolver holds no database handle and no model — it imports the registry and types only", () => {
  const imports = [...SRC.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./registry", "./types"]);
  assert.ok(!/@anthropic-ai|openai|anthropic|generateText|createMessage|fetch\(/i.test(SRC));
  assert.ok(!/Date\.|new Date|Math\.random/.test(CODE), "no clock and no randomness");
});

// ── the registry maps to real routes, proven structurally (ruling 6) ────────────────────────────

test("every registered pathTemplate corresponds to a real App Router destination", () => {
  // Structured build metadata, not a grep over source. Per §16B, a missing manifest is a FAILURE:
  // an assertion that cannot read its evidence must not be able to pass.
  const manifest = new URL("../.next/app-path-routes-manifest.json", import.meta.url);
  assert.ok(existsSync(manifest), "build manifest missing — run `npm run build` before this suite");
  const routes = new Set<string>(Object.values(JSON.parse(readFileSync(manifest, "utf8")) as Record<string, string>));
  assert.ok(routes.size > 0, "the manifest must list routes");
  assert.ok(routes.has("/experience/pursuits"), "sanity: the known P7 route is present in the manifest");
  for (const def of Object.values(DESTINATIONS)) {
    const dynamic = def.pathTemplate.replace(":id", "[id]");
    assert.ok(routes.has(dynamic), `${def.class}@${def.surface} → ${dynamic} is not a real route`);
  }
});

test("the registry is the only mapping, and every destination declares its governed inputs", () => {
  for (const [key, def] of Object.entries(DESTINATIONS)) {
    assert.equal(key, destinationKey(def.class, def.surface));
    assert.ok(def.pathTemplate.includes(":id"), "the id is the only substitution");
    assert.equal(def.pathTemplate.match(/:[a-z]+/g)?.length, 1, "no second substitution exists");
    assert.ok(def.requires.length > 0, "a destination declares what it needs from the governed row");
    assert.ok(def.fallbackLabel.length > 0);
  }
  assert.deepEqual(Object.keys(DESTINATIONS), ["pursuit@canonical"], "Slice 4 registers exactly one destination");
});
