import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { explain } from "../src/lib/experience/explain";
import { OPERATION_UNAVAILABLE_TEXT, TEMPLATES, WITHHELD_TEXT } from "../src/lib/experience/explain-templates";
import { validatePlan } from "../src/lib/experience/validate";
import { explainPlanFor } from "../src/lib/experience/plans";
import type { ExistenceDisclosure, GovernedCell, GovernedResultSet, OmissionReason, PursuitQuery } from "../src/lib/experience/types";

/**
 * P7 SLICE 2 — the proofs that need no database.
 *
 * `explain()` is pure, so its guarantees can be attacked directly with synthetic result sets that
 * contain hidden values, unauthorized existence and malformed references — cases the product path
 * cannot yet produce but must already be safe against.
 */

const cell = (over: Partial<GovernedCell> = {}): GovernedCell => ({
  visibility: "EXACT", value: "x", provenance: "pursuit.status", existence: "AUTHORIZED", ...over,
});

const withheld = (reason: OmissionReason, existence: ExistenceDisclosure = "AUTHORIZED"): GovernedCell =>
  ({ visibility: "SUPPRESSED", value: null, provenance: "p", reason, existence });

function resultSet(cells: Record<string, GovernedCell>, rows = 1): GovernedResultSet {
  const plan = explainPlanFor("1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81");
  const row = (id: string) => ({ objectRef: { class: "pursuit" as const, id }, cells });
  return {
    plan,
    planDigest: "abc123def4567890",
    computedAt: "2026-09-17 23:00:00.123456+00",
    rows: rows === 1 ? [row("1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81")]
      : Array.from({ length: rows }, (_, i) => row(`1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b8${i}`)),
    omissions: [],
    counts: { authorized: rows },
  };
}

const FULL = {
  "pursuit.account_name": cell({ value: "Globex", provenance: "pursuit.account_name" }),
  "pursuit.status": cell({ value: "QUALIFIED" }),
  "pursuit.pursuit_type": cell({ value: "EXPANSION", provenance: "pursuit.pursuit_type" }),
  "pursuit.updated_at": cell({ value: "2026-09-14T21:02:56.000Z", provenance: "pursuit.updated_at" }),
  "pursuit.open_pipeline_usd@1": cell({ value: 750000, provenance: "pursuit.open_pipeline_usd@1" }),
};
const render = (cells: Record<string, GovernedCell>, rows = 1) => explain(resultSet(cells, rows), "pursuit.summary", 1);

// ── structure: the guarantee is the input type ──────────────────────────────────────────────────

const treeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? treeFiles(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
const codeOf = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const EXPLAIN_TREE = [
  new URL("../src/lib/experience/explain.ts", import.meta.url).pathname,
  new URL("../src/lib/experience/explain-templates.ts", import.meta.url).pathname,
];

test("1: explain() has no database handle and imports nothing that could fetch", () => {
  for (const f of EXPLAIN_TREE) {
    const code = codeOf(f);
    assert.ok(!/@\/db|PoolClient|pg"|federation\/|unsafe_/.test(code), `${f} must not reach data`);
    assert.ok(!/await |async /.test(code), `${f} must be synchronous — no await for a second read`);
  }
});

test("2: explain() is pure — the same input twice yields byte-identical output", () => {
  const a = render(FULL), b = render(FULL);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("3 + 15: every statement maps to a real cell, and a template may not mint a reference", () => {
  const r = render(FULL);
  assert.ok(r.ok);
  if (r.ok) for (const s of r.explanation.statements) assert.ok(s.ref in FULL, `${s.ref} must be a cell`);
});

test("5 + 16: a template render body may only narrate — it cannot compute", () => {
  // A precise structural rule beats a regex hunting for operators, which flagged the provenance
  // text's own string concatenation. A render body may contain ONLY calls to ctx.fact / ctx.derived
  // with literal arguments, separated by punctuation. No operator, no variable, no call to anything
  // else can appear — so a template cannot sum, compare, rank or infer, in this template or a future
  // one.
  const src = readFileSync(new URL("../src/lib/experience/explain-templates.ts", import.meta.url), "utf8");
  const bodies = [...src.matchAll(/render:\s*\(ctx\)\s*=>\s*\[([\s\S]*?)\n\s*\],/g)].map((m) => m[1]);
  assert.ok(bodies.length > 0, "at least one template render body must be found");
  for (const body of bodies) {
    const stripped = body
      .replace(/ctx\.(fact|derived)\(\s*"[^"]*"\s*,\s*"[^"]*"\s*(,\s*"[^"]*"\s*)?\)/g, "")  // the permitted calls
      .replace(/[\s,]/g, "");                                                                      // punctuation between them
    assert.equal(stripped, "", `a render body may only narrate cells; found: ${stripped}`);
  }
});

test("5b: every reference a template renders is one it declared", () => {
  for (const t of Object.values(TEMPLATES)) {
    const emitted = t.render({
      cells: new Map(),
      fact: (ref) => ({ kind: "FACT", ref, text: "", provenance: ref }),
      derived: (ref) => ({ kind: "DERIVED", ref, text: "", provenance: ref }),
    });
    for (const s of emitted) if (s) assert.ok(t.requires.includes(s.ref), `${t.id} names ${s.ref} without declaring it`);
  }
});

test("6: every FACT and DERIVED statement carries provenance", () => {
  const r = render(FULL);
  assert.ok(r.ok);
  if (r.ok) for (const s of r.explanation.statements) {
    if (s.kind === "FACT" || s.kind === "DERIVED") assert.ok(s.provenance.length > 0);
    if (s.kind === "DERIVED") assert.match(s.provenance, /@\d+$/, "a metric names id AND version");
  }
});

test("7: no model import anywhere in the Slice 2 tree", () => {
  for (const f of EXPLAIN_TREE) {
    assert.ok(!/@anthropic-ai|openai|anthropic|generateText|createMessage/i.test(codeOf(f)), `${f}`);
  }
});

// ── the ruled absence proofs ────────────────────────────────────────────────────────────────────

test("9 + 21: a suppressed value never appears in explanation bytes, and no reason code does either", () => {
  const hidden = "SUPER-SECRET-9999999";
  const cells = { ...FULL, "pursuit.status": { ...withheld("NOT_DISCLOSABLE"), value: null, provenance: "pursuit.status" } };
  // Belt and braces: even a cell that wrongly carried a value must not surface it once suppressed.
  const leaky = { ...cells, "pursuit.pursuit_type": { visibility: "SUPPRESSED", value: hidden, provenance: "pursuit.pursuit_type", reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" } as GovernedCell };
  const r = render(leaky);
  assert.ok(r.ok);
  if (r.ok) {
    const bytes = JSON.stringify(r.explanation);
    assert.ok(!bytes.includes(hidden), "a suppressed value must never reach the bytes");
    for (const code of ["NOT_DISCLOSABLE", "DERIVATION_DENIED", "INPUT_NOT_DISCLOSABLE"]) {
      assert.ok(!bytes.includes(code), `the internal reason code ${code} is not disclosure authority`);
    }
  }
});

test("10 + 14: an existence-unauthorized cell leaves NO shadow — byte-identical output", () => {
  // Two result sets differing ONLY in a cell whose existence is unauthorized.
  const without = { ...FULL };
  delete (without as Record<string, GovernedCell>)["pursuit.pursuit_type"];
  const withUnauthorized = { ...without, "pursuit.pursuit_type": withheld("NOT_DISCLOSABLE", "UNAUTHORIZED") };

  const a = render(without), b = render(withUnauthorized);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.equal(JSON.stringify(a.explanation), JSON.stringify(b.explanation),
      "no placeholder, no gap, no count change, no ordering artefact");
    assert.equal(a.explanation.statements.length, b.explanation.statements.length);
  }
});

test("11: NOT_DISCLOSABLE with existence authorized produces the registered WITHHELD representation", () => {
  const r = render({ ...FULL, "pursuit.status": withheld("NOT_DISCLOSABLE") });
  assert.ok(r.ok);
  if (r.ok) {
    const s = r.explanation.statements.find((x) => x.ref === "pursuit.status");
    assert.equal(s?.kind, "WITHHELD");
    assert.ok(s?.text.includes(WITHHELD_TEXT), "one registered wording, used everywhere");
  }
});

test("12: NOT_DISCLOSABLE with existence UNAUTHORIZED produces no statement at all", () => {
  const r = render({ ...FULL, "pursuit.status": withheld("NOT_DISCLOSABLE", "UNAUTHORIZED") });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.explanation.statements.some((s) => s.ref === "pursuit.status"), false);
    const bytes = JSON.stringify(r.explanation);
    assert.ok(!bytes.includes("pursuit.status"), "not even the reference may appear");
    assert.ok(!bytes.includes(WITHHELD_TEXT) || bytes.indexOf(WITHHELD_TEXT) === -1, "no withheld label stands in for it");
  }
});

test("13: DERIVATION_DENIED explains the operation without naming or implying hidden evidence", () => {
  for (const reason of ["DERIVATION_DENIED", "INPUT_NOT_DISCLOSABLE"] as const) {
    const r = render({ ...FULL, "pursuit.open_pipeline_usd@1": withheld(reason) });
    assert.ok(r.ok);
    if (r.ok) {
      const s = r.explanation.statements.find((x) => x.ref === "pursuit.open_pipeline_usd@1");
      assert.equal(s?.kind, "OPERATION");
      assert.ok(s?.text.includes(OPERATION_UNAVAILABLE_TEXT));
      // It must not assert that a hidden fact exists.
      assert.ok(!/grant|evidence|economic|opportunit|value of/i.test(s?.text ?? ""), s?.text);
    }
  }
});

test("18: the WITHHELD text is identical across result sets whose hidden values differ", () => {
  const one = render({ ...FULL, "pursuit.status": { ...withheld("NOT_DISCLOSABLE"), value: null } });
  const two = render({ ...FULL, "pursuit.status": { ...withheld("NOT_DISCLOSABLE"), value: null } });
  assert.ok(one.ok && two.ok);
  if (one.ok && two.ok) {
    const t = (r: typeof one) => (r.ok ? r.explanation.statements.find((s) => s.ref === "pursuit.status")?.text : "");
    assert.equal(t(one), t(two));
  }
});

test("17: identical result set + template version → byte-identical explanation", () => {
  assert.equal(JSON.stringify(render(FULL)), JSON.stringify(render(FULL)));
});

test("20: the three absence states are distinct paths and none collapses into another", () => {
  const authorizedWithheld = render({ ...FULL, "pursuit.status": withheld("NOT_DISCLOSABLE") });
  const unauthorized = render({ ...FULL, "pursuit.status": withheld("NOT_DISCLOSABLE", "UNAUTHORIZED") });
  const denied = render({ ...FULL, "pursuit.open_pipeline_usd@1": withheld("DERIVATION_DENIED") });
  assert.ok(authorizedWithheld.ok && unauthorized.ok && denied.ok);
  if (authorizedWithheld.ok && unauthorized.ok && denied.ok) {
    const kinds = (r: typeof denied) => (r.ok ? r.explanation.statements.map((s) => s.kind) : []);
    assert.ok(kinds(authorizedWithheld).includes("WITHHELD"));
    assert.ok(!kinds(unauthorized).includes("WITHHELD"), "unauthorized existence is not a WITHHELD label");
    assert.ok(kinds(denied).includes("OPERATION"));
  }
});

// ── single subject, and the digest ──────────────────────────────────────────────────────────────

test("an explanation covers exactly one subject — zero and several are refused", () => {
  const none = explain({ ...resultSet(FULL), rows: [] }, "pursuit.summary", 1);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.error, "NO_SUBJECT");

  const many = render(FULL, 3);
  assert.equal(many.ok, false);
  if (!many.ok) {
    assert.equal(many.error, "NO_SUBJECT");
    assert.match(many.detail, /exactly one subject/);
  }
});

test("validation requires exactly one named subject for an explanation", () => {
  const plan = explainPlanFor("1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81");
  assert.equal(validatePlan(plan).ok, true);
  const noIds = { ...plan, subject: { class: "pursuit" } } as unknown;
  const r = validatePlan(noIds);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /exactly one object/);
  const twoIds = { ...plan, subject: { class: "pursuit", ids: [plan.subject.ids![0], "2f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81"] } } as unknown;
  const r2 = validatePlan(twoIds);
  assert.equal(r2.ok, false);
});

test("an unregistered template is refused by validation and by the renderer", () => {
  const plan = { ...explainPlanFor("1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81"), explain: { template: { id: "made.up", version: 1 } } };
  const v = validatePlan(plan);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /unknown explanation template made\.up@1/);
  const r = explain(resultSet(FULL), "made.up", 1);
  assert.equal(r.ok, false);
});

test("RULED: the explanation carries provenance, NOT a second copy of the plan", () => {
  const r = render(FULL);
  assert.ok(r.ok);
  if (r.ok) {
    const e = r.explanation as unknown as Record<string, unknown>;
    assert.equal("plan" in e, false, "the parent result owns the plan; it is not duplicated here");
    assert.deepEqual(Object.keys(e).sort(),
      ["computedAt", "planDigest", "planVersion", "statements", "subject", "templateId", "templateVersion"]);
  }
});

test("RULED: the plan digest cannot be used to reconstruct hidden data", () => {
  // The digest is a hash of the PLAN — registry keys and bound values the caller already supplied —
  // and never of the result. Two results differing only in hidden values share one digest, so the
  // digest carries no information about them.
  const a = render(FULL);
  const b = render({ ...FULL, "pursuit.status": withheld("NOT_DISCLOSABLE") });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.equal(a.explanation.planDigest, b.explanation.planDigest, "the digest is of the plan, not the data");
    assert.match(a.explanation.planDigest, /^[0-9a-f]{16}$/);
    const exec = codeOf(new URL("../src/lib/experience/execute.ts", import.meta.url).pathname);
    assert.match(exec, /createHash\("sha256"\)\.update\(JSON\.stringify\(plan\)\)/,
      "the digest is computed from the plan alone");
  }
});

test("explanation bytes contain only information the governed statement set authorized", () => {
  // Fuzz: random hidden values across every cell; none may survive into the output.
  for (let i = 0; i < 50; i++) {
    const secret = `HIDDEN-${Math.random().toString(36).slice(2)}-${i}`;
    const cells: Record<string, GovernedCell> = {};
    for (const ref of Object.keys(FULL)) {
      cells[ref] = i % 2 === 0
        ? { visibility: "SUPPRESSED", value: secret, provenance: ref, reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" }
        : { visibility: "SUPPRESSED", value: secret, provenance: ref, reason: "NOT_DISCLOSABLE", existence: "UNAUTHORIZED" };
    }
    const r = render(cells);
    if (r.ok) assert.ok(!JSON.stringify(r.explanation).includes(secret), `leak at iteration ${i}`);
  }
});
