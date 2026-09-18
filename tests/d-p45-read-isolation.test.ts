import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { vnextCapabilities } from "../src/lib/env/vnext-flags";

/**
 * D-P45-READ — CONTROL-PLANE READ-SIDE ISOLATION.
 *
 * > **When `controlPlane` is false, P45 runtime state must not become recipient-observable through
 * > P2/P7 or other unrelated recipient-facing surfaces unless an independently governed product
 * > contract explicitly permits that disclosure.**
 *
 * The execution substrate was already gated. Its READ side was not: `pursuit_run_approvals` could
 * contribute "A governed action is waiting for approval" to recipient-facing pertinence whenever
 * `pursuit_intelligence` was on — including with the control plane switched off. This proves the
 * correction, and proves it BITES, which matters more: the table is empty in every environment this
 * suite runs in, so an assertion that merely observed "no approval reason appeared" would pass
 * without the fix and without the bug.
 */

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LOADERS = SRC("lib/pursuits/read-models/portfolio-pertinence-loaders.ts");

/** The exact shape of the corrected boundary, as the property under test. */
const gatedQuery = (src: string) => {
  const body = strip(src);
  const fn = body.slice(body.indexOf("async function loadPendingDecisions"));
  const gate = fn.indexOf("vnextCapabilities(await tenantFeatures(db, orgId)).controlPlane");
  const guard = fn.indexOf("if (controlPlane) {");
  const query = fn.indexOf("pursuit_run_approvals");
  return { gate, guard, query, ok: gate > 0 && guard > gate && query > guard };
};

// ── THE INVENTORY: is the pertinence loader really the only leak? ────────────────────────────────

test("EVERY production read of P45 runtime state is inventoried and classified", () => {
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  });
  walk(new URL("../src", import.meta.url).pathname);

  const P45_STATE = /pursuit_run_approvals|pursuit_run_steps|\bpursuit_runs\b|pendingApprovals/;
  const readers = files.filter((f) => P45_STATE.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(f.indexOf("src/"))).sort();

  // P45-NATIVE (the runtime and its own surface, both already gated) plus the ONE recipient-facing
  // consumer this correction gates. A new entry here is a new leak and must fail this suite.
  assert.deepEqual(readers, [
    // P45-NATIVE UI — gated on control_plane + governed_action at `approvals/page.tsx:26,36`.
    "src/app/approvals/page.tsx",
    // RECIPIENT-FACING NON-P45 — the one leak, gated by this correction.
    "src/lib/pursuits/read-models/portfolio-pertinence-loaders.ts",
    // P45-NATIVE RUNTIME — all behind `runtimeEnabled` (env master AND the per-org column).
    "src/lib/runtime/approvals.ts",
    "src/lib/runtime/entry.ts",
    "src/lib/runtime/runtime.ts",
  ], "an unlisted reader of P45 runtime state appeared — classify it before shipping");
  // WORKER / BACKGROUND: none. Proven by absence from the list above, which walks all of src/.
  assert.ok(!readers.some((f) => f.startsWith("src/worker/")), "no background path reads P45 state");
});

test("the P45-native surface was already gated, and is not redefined by this correction", () => {
  const page = strip(SRC("app/approvals/page.tsx"));
  assert.match(page, /vnextEnvEnabled\("control_plane"\)/, "the approvals page keeps its own gate");
  assert.match(page, /governed_action as on from org_features/, "and its per-org column check");
  // The correction touched no P45-native module.
  for (const f of ["lib/runtime/runtime.ts", "lib/runtime/approvals.ts", "app/approvals/actions.ts"] as const) {
    assert.ok(!SRC(f).includes("D-P45-READ"), `${f} must be untouched by a read-side correction`);
  }
});

// ── THE CORRECTION ──────────────────────────────────────────────────────────────────────────────

test("the P45 approval read is gated BEFORE the table is queried", () => {
  const g = gatedQuery(LOADERS);
  assert.ok(g.ok, "the gate precedes the guard, which precedes the query");
  // Declining to look is stronger than filtering afterwards: with the control plane off, a
  // recipient-facing surface does not touch a P45 table at all.
  const fn = strip(LOADERS).slice(strip(LOADERS).indexOf("async function loadPendingDecisions"));
  assert.ok(!/appr\b[\s\S]{0,200}filter|\.filter\(/.test(fn), "the reason is not merely filtered out afterwards");
});

test("NEGATIVE CONTROL: without the gate, the P45 read is reachable again", () => {
  assert.equal(gatedQuery(LOADERS).ok, true, "canonical code passes");
  // Remove the guard exactly as a regression would, and confirm the check flips.
  const ungated = LOADERS
    .replace("const controlPlane = vnextCapabilities(await tenantFeatures(db, orgId)).controlPlane;", "")
    .replace("if (controlPlane) {", "if (true) {");
  assert.notEqual(ungated, LOADERS, "the mutation actually applied");
  assert.equal(gatedQuery(ungated).ok, false, "an ungated P45 read is caught");
});

test("it delegates to the CANONICAL evaluator, not a parallel env read", () => {
  const fn = strip(LOADERS).slice(strip(LOADERS).indexOf("async function loadPendingDecisions"));
  assert.match(fn, /vnextCapabilities\(await tenantFeatures\(db, orgId\)\)\.controlPlane/);
  assert.ok(!/vnextEnvEnabled\(/.test(fn), "no parallel env read that could drift from the evaluator");
  assert.ok(!/process\.env/.test(fn), "and no raw environment access");
});

test("controlPlane is the value being gated on — and it is OFF by default", () => {
  // The evaluator's own behaviour, not a restatement of it: with no env set, controlPlane is false,
  // which is exactly the posture the hosted deployment is in.
  const before = process.env.VNEXT_CONTROL_PLANE_ENABLED;
  delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
  try {
    const off = vnextCapabilities({ experience: true } as never).controlPlane;
    assert.equal(off, false, "default OFF");
    process.env.VNEXT_CONTROL_PLANE_ENABLED = "true";
    assert.equal(vnextCapabilities({ experience: true } as never).controlPlane, true, "and it does flip");
    // It survives the no-experience early return, so the gate is not accidentally inherited.
    assert.equal(vnextCapabilities({ experience: false } as never).controlPlane, true);
  } finally {
    if (before === undefined) delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
    else process.env.VNEXT_CONTROL_PLANE_ENABLED = before;
  }
});

// ── WHAT MUST NOT HAVE CHANGED ──────────────────────────────────────────────────────────────────

test("the ORDINARY non-P45 pending-decision reasons are untouched", () => {
  const fn = strip(LOADERS).slice(strip(LOADERS).indexOf("async function loadPendingDecisions"));
  // Route and plan decisions are P3/route product semantics and have always been recipient-facing.
  assert.match(fn, /pursuit_route_snapshots[\s\S]*?A recommended route is waiting for approval/);
  assert.match(fn, /pursuit_plan_revisions[\s\S]*?A recommended plan is waiting for a decision/);
  // Neither sits inside the control-plane guard.
  const guardStart = fn.indexOf("if (controlPlane) {");
  assert.ok(fn.indexOf("pursuit_route_snapshots") < guardStart, "the route reason is outside the gate");
  assert.ok(fn.indexOf("pursuit_plan_revisions") < guardStart, "the plan reason is outside the gate");
});

test("pursuit_intelligence ALONE no longer makes P45 approval state visible", () => {
  // The two capabilities are independent in the evaluator, which is why the leak existed: a
  // deployment could have pursuit_intelligence on and controlPlane off. Proven on the evaluator.
  const before = process.env.VNEXT_CONTROL_PLANE_ENABLED;
  delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
  try {
    const caps = vnextCapabilities({ experience: true } as never);
    assert.equal(caps.controlPlane, false, "control plane off");
    // …and the loader's P45 branch is guarded on exactly that value.
    assert.ok(gatedQuery(LOADERS).ok);
  } finally {
    if (before === undefined) delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
    else process.env.VNEXT_CONTROL_PLANE_ENABLED = before;
  }
});

test("this is a READ-SIDE correction only — no write, no schema, no P45 semantics change", () => {
  const body = strip(LOADERS);
  for (const forbidden of ["insert into", "update ", "delete from", "requestApproval", "decideApproval",
                           "startRun", "resumeRun", "dispatchSkill", "setOrgFeature"]) {
    assert.ok(!body.toLowerCase().includes(forbidden.toLowerCase()), `the loader must not contain ${forbidden}`);
  }
  // No ranking or metric semantics moved: the gate wraps a reason list, nothing scored.
  const fn = body.slice(body.indexOf("async function loadPendingDecisions"));
  assert.ok(!/value|score|weight|rank/i.test(fn.slice(fn.indexOf("if (controlPlane) {"))),
    "the gated block contributes a REASON, never a score");
});

// ── THE BEHAVIOURAL PROOF, with an in-memory fixture ────────────────────────────────────────────

/**
 * A stand-in `PoolClient` that answers only what this proof needs and records every statement it was
 * asked for. The recording is the point: it lets the test assert that with the control plane off the
 * P45 table is **never queried at all**, which is a stronger property than "the reason was filtered
 * out of the answer" — and one a database fixture could not show as directly.
 */
function stubDb(subjectId: string) {
  const asked: string[] = [];
  const query = async (sql: string) => {
    asked.push(sql);
    if (/from pursuits pu/.test(sql)) {
      return { rows: [{ id: subjectId, account_label: "Fixture Co", thesis: null, use_case: null, data_environment: "DEMO" }] };
    }
    if (/pursuit_run_approvals/.test(sql)) return { rows: [{ pursuit_id: subjectId }] };
    if (/org_features/.test(sql)) return { rows: [{}] };
    return { rows: [] };
  };
  return { asked, client: { query } as never };
}

const SUBJECT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CALLER = { orgId: "11111111-2222-4333-8444-555555555555", canSeeInternal: true, canSeeTransactionDetail: true };
const REASON = /governed action is waiting for approval/i;

async function reasonsWith(controlPlane: boolean) {
  const before = process.env.VNEXT_CONTROL_PLANE_ENABLED;
  if (controlPlane) process.env.VNEXT_CONTROL_PLANE_ENABLED = "true";
  else delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
  const { asked, client } = stubDb(SUBJECT);
  try {
    const { loadPortfolioCandidates } = await import("../src/lib/pursuits/read-models/portfolio-pertinence-loaders");
    const loaded = await loadPortfolioCandidates(client, CALLER as never, new Date("2026-09-18T00:00:00Z"));
    const me = loaded.find((c) => c.pursuitId === SUBJECT);
    return { reasons: me?.pendingDecisions ?? [], askedP45: asked.some((s) => /pursuit_run_approvals/.test(s)) };
  } finally {
    if (before === undefined) delete process.env.VNEXT_CONTROL_PLANE_ENABLED;
    else process.env.VNEXT_CONTROL_PLANE_ENABLED = before;
  }
}

test("BEHAVIOURAL: with controlPlane FALSE a pending approval cannot reach recipient pertinence", async () => {
  const off = await reasonsWith(false);
  assert.ok(!off.reasons.some((r) => REASON.test(r)), `reasons were: ${off.reasons.join(" | ") || "(none)"}`);
  // The stronger property: the P45 table was not even consulted.
  assert.equal(off.askedP45, false, "no recipient-facing surface touched a P45 table with the plane off");
});

test("NEGATIVE CONTROL: the SAME fixture DOES reach pertinence with controlPlane TRUE", async () => {
  const on = await reasonsWith(true);
  assert.ok(on.reasons.some((r) => REASON.test(r)),
    `the fixture must be capable of producing the reason, or the previous test proves nothing — got: ${on.reasons.join(" | ") || "(none)"}`);
  assert.equal(on.askedP45, true, "and the table IS consulted when the plane is on");
});

test("the ordinary non-P45 reasons are identical either side of the gate", async () => {
  const strip45 = (rs: string[]) => rs.filter((r) => !REASON.test(r)).sort().join(" | ");
  const off = await reasonsWith(false);
  const on = await reasonsWith(true);
  assert.equal(strip45(off.reasons), strip45(on.reasons), "only the P45-derived reason differs");
});
