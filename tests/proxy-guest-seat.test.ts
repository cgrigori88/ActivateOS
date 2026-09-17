import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isGuestSeatPath } from "../src/proxy";

/**
 * The guest-seat exemption is the ONE authenticated-gate hole in the proxy, so it is the one place
 * a prefix test must be segment-exact. It was `startsWith("/join")`, which also exempted `/joint` —
 * the joint-pursuit room — and an unauthenticated caller rendered the oldest organization's partner
 * names, joint pursuits, settlement panel and row ids (`resolve_user_org(null)` falls back to the
 * oldest org). These tests pin both halves: the invite family stays public, everything that merely
 * starts with those characters stays gated.
 */

test("the /join invite family stays guest-accessible", () => {
  assert.equal(isGuestSeatPath("/join"), true);
  assert.equal(isGuestSeatPath("/join/"), true);
  assert.equal(isGuestSeatPath("/join/ABC123XYZ"), true);
  assert.equal(isGuestSeatPath("/join/1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81"), true);
  assert.equal(isGuestSeatPath("/join/code/extra"), true);
});

test("the joint-pursuit room requires application authentication", () => {
  assert.equal(isGuestSeatPath("/joint"), false);
  assert.equal(isGuestSeatPath("/joint/"), false);
  assert.equal(isGuestSeatPath("/joint/1f0b2e4c-9a77-4a1e-b0a2-9d4f3c7e5b81"), false);
  assert.equal(isGuestSeatPath("/joint/anything/deeper"), false);
});

test("no unrelated path inherits the exemption on a prefix", () => {
  for (const p of ["/joinery", "/joins", "/join-us", "/joint-ventures", "/", "/queue", "/partners", "/login"]) {
    assert.equal(isGuestSeatPath(p), false, `${p} must not be treated as a guest seat`);
  }
});

test("the exemption is anchored at the start of the path", () => {
  // A path that contains the family elsewhere is not the family.
  assert.equal(isGuestSeatPath("/pursuits/join/abc"), false);
  assert.equal(isGuestSeatPath("/a/join"), false);
});

test("the proxy gate calls the segment-exact predicate, not a raw prefix test", () => {
  // Structural guard: the defect was a `startsWith("/join")` at the gate. If anyone reintroduces a
  // raw prefix test for this family, this fails even though the predicate above still passes.
  const src = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("isGuestSeatPath(req.nextUrl.pathname)"), "the gate must use isGuestSeatPath");
  assert.ok(!/startsWith\(\s*["']\/join["']\s*\)/.test(code), 'no raw startsWith("/join") may remain in the gate');
});
