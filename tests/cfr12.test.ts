import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyRoom, looksUnauthenticated, maskDeltas, normalizeLines, redact, verdictFor,
} from "../scripts/cfr12-lib";

/**
 * The instrument that certifies the product must itself be certified. These pin the CFR-1.2 rule —
 * what counts as the same evidence, what counts as a real difference, and what must never be
 * mistaken for a successful login — without a network, a deployment or a credential.
 */

const R = (lines: string[], status = 200) => ({ status, lines });

test("normalization strips markup and masks clock phrases", () => {
  const html = `<div><script>var x="ignored"</script><p>Globex</p><span>3 days ago</span><b>12:45 PM</b></div>`;
  assert.deepEqual(normalizeLines(html), ["Globex", "⌚", "⌚"]);
});

test("normalization keeps rendered text that is not clock-derived", () => {
  assert.deepEqual(normalizeLines("<p>11 ranked of 11</p>"), ["11 ranked of 11"]);
});

test("identical renders classify as IDENTICAL", () => {
  const a = R(["Today", "Globex — #1 of 11"]);
  assert.equal(classifyRoom("/", a, R([...a.lines])).kind, "IDENTICAL");
});

test("a pertinence delta moving alone is CLOCK_DERIVED", () => {
  const a = R(["Ahead of «X» because commercial signal (Δ 0.042)."]);
  const b = R(["Ahead of «X» because commercial signal (Δ 0.043)."]);
  const d = classifyRoom("/", a, b);
  assert.equal(d.kind, "CLOCK_DERIVED");
  assert.equal(d.changedLines, 1);
  assert.equal(d.nonClockLines, 0);
});

test("a delta moving WITH a word change is NON_CLOCK — the mask must not launder wording", () => {
  const a = R(["Ahead of «X» because commercial signal (Δ 0.042)."]);
  const b = R(["Ahead of «Y» because commercial signal (Δ 0.043)."]);
  const d = classifyRoom("/", a, b);
  assert.equal(d.kind, "NON_CLOCK");
  assert.equal(d.nonClockLines, 1);
});

test("reordering the same lines is NON_CLOCK, not identical", () => {
  const a = R(["first", "second"]);
  const b = R(["second", "first"]);
  assert.equal(classifyRoom("/queue", a, b).kind, "NON_CLOCK");
});

test("a changed count is NON_CLOCK", () => {
  assert.equal(classifyRoom("/", R(["11 ranked of 11"]), R(["10 ranked of 11"])).kind, "NON_CLOCK");
});

test("status and line-count changes are their own verdicts, never clock-derived", () => {
  assert.equal(classifyRoom("/joint", R(["x"], 200), R(["x"], 307)).kind, "STATUS");
  assert.equal(classifyRoom("/", R(["a", "b"]), R(["a"])).kind, "LINE_COUNT");
  assert.equal(classifyRoom("/", undefined, R(["a"])).kind, "MISSING");
});

test("CFR-1.2 passes only when every room is identical or clock-derived", () => {
  const ok = verdictFor([
    classifyRoom("/a", R(["x"]), R(["x"])),
    classifyRoom("/b", R(["(Δ 0.010)"]), R(["(Δ 0.011)"])),
  ]);
  assert.equal(ok.pass, true);
  assert.equal(ok.identical, 1);
  assert.equal(ok.clockDerived, 1);

  const bad = verdictFor([classifyRoom("/c", R(["x"]), R(["y"]))]);
  assert.equal(bad.pass, false);
  assert.equal(bad.offending.length, 1);
});

test("maskDeltas touches only the delta values", () => {
  assert.equal(maskDeltas("value $580K — 100th percentile (Δ 0.042)"), "value $580K — 100th percentile (Δ)");
  assert.equal(maskDeltas("no deltas here"), "no deltas here");
});

test("a 303 is NOT authentication — the anonymous representation is detected on its own terms", () => {
  // The exact trap: a throttled sign-in answers 303 to /login?error=… with no session.
  assert.equal(looksUnauthenticated(307, "/login", []), true);
  assert.equal(looksUnauthenticated(302, "/login?error=Too%20many%20attempts", []), true);
  assert.equal(looksUnauthenticated(200, null, ["PursuitOS", "Sign in", "Email"]), true);
  assert.equal(looksUnauthenticated(200, null, ["PursuitOS", "All ecosystems", "Today", "Queue"]), false);
  assert.equal(looksUnauthenticated(307, "/somewhere-else", []), false);
});

test("redaction removes connection strings and supplied secrets", () => {
  const out = redact("dialling postgresql://user:pw@host/db with token SUPERSECRETVALUE", ["SUPERSECRETVALUE"]);
  assert.ok(!out.includes("SUPERSECRETVALUE"));
  assert.ok(!out.includes("postgresql://"));
  assert.ok(out.includes("<redacted"));
});

test("redaction ignores values too short to be secrets, so it cannot mangle ordinary output", () => {
  assert.equal(redact("a normal line", ["ab", undefined]), "a normal line");
});
