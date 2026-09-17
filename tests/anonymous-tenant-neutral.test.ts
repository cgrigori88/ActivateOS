import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PRINCIPAL_HEADER, hasAuthenticatedPrincipal } from "../src/lib/auth/principal";
import { tenantNeutralShellScope } from "../src/lib/scope/server";

/**
 * THE INVARIANT: an unauthenticated request must not acquire an organization merely because no
 * authenticated organization exists.
 *
 * It was violated in presentation, not in data access: with no session `resolve_user_org(null)`
 * falls back to the OLDEST organization, so the root layout ran its tenant queries and
 * `getShellScope()` derived scope options from that org. On the routes the gate lets through
 * without a principal — `/join`, `/join/<code>`, `/login` — those props were serialized into the
 * RSC payload of an anonymous response: partner and seller names with row ids, and `isOwner: true`.
 * `Shell` renders those routes bare, so none of it was on screen; all of it was in the bytes.
 *
 * Behaviour on the wire is proven hosted. These tests pin the decisions that produce it, and the
 * structure that must not regress — the defect was never in a predicate, it was in a call site.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** Compare code, not prose: a comment mentioning a call is not a call. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── the predicate ───────────────────────────────────────────────────────────────────────────────

test("only the values the gate sets count as an authenticated principal", () => {
  for (const p of ["open", "basic", "identity"]) assert.equal(hasAuthenticatedPrincipal(p), true, p);
});

test("anything else is no principal — absent, empty, unknown or client-supplied", () => {
  for (const v of [null, undefined, "", " ", "guest", "anonymous", "identity ", "Identity", "IDENTITY",
    "true", "1", "owner", "admin", "basic,identity", "open;identity"]) {
    assert.equal(hasAuthenticatedPrincipal(v as string | null | undefined), false, JSON.stringify(v));
  }
});

// ── the neutral value ───────────────────────────────────────────────────────────────────────────

test("the tenant-neutral shell scope names no organization, partner, seller or pursuit", () => {
  const { options, active } = tenantNeutralShellScope();
  assert.equal(options.length, 1);
  assert.deepEqual(options[0], { kind: "ALL", id: null, label: "All (my authorized set)", group: "" });
  assert.equal(options.every((o) => o.id === null), true, "no row id may appear in an anonymous option");
  assert.equal(active.scope.kind, "ALL");
  assert.deepEqual(active.facts, []);
  // Serialized form carries no identifier at all — this is what reaches the payload.
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(JSON.stringify({ options, active })), false);
});

test("the neutral scope is a fresh object, never a shared mutable default", () => {
  const a = tenantNeutralShellScope();
  a.options.push({ kind: "PARTNER", id: "11111111-1111-1111-1111-111111111111", label: "X", group: "Partner" });
  assert.equal(tenantNeutralShellScope().options.length, 1, "a caller must not be able to poison the next render");
});

// ── the gate states the principal, and a client cannot forge one ────────────────────────────────

test("the gate deletes any inbound principal header before setting its own", () => {
  const src = code("src/proxy.ts");
  const del = src.indexOf(`fwd.delete(PRINCIPAL_HEADER)`);
  const set = src.indexOf(`fwd.set(PRINCIPAL_HEADER`);
  assert.ok(del > -1, "the forwarded request must drop a client-supplied principal");
  assert.ok(set > -1, "the gate must set the principal it verified");
  assert.ok(del < set, "the delete must precede the set, or a spoofed value could survive");
});

test("the gate names a principal only where it verified a credential", () => {
  const src = code("src/proxy.ts");
  assert.ok(/if \(!basicConfigured && !identityConfigured\) return pass\("open"\)/.test(src), "local dev is 'open'");
  assert.ok(/if \(await basicAuthValid\(req\)\) return pass\("basic"\)/.test(src), "verified Basic Auth is 'basic'");
  assert.ok(/pass\(signedIn \? "identity" : null\)/.test(src), "a Supabase user is 'identity'; /login without one gets none");
  // The guest seat passes WITHOUT a principal: the invite code authorizes its flow, not a tenant.
  assert.ok(/if \(isGuestSeatPath\(req\.nextUrl\.pathname\)\) return pass\(\);/.test(src), "the guest seat must pass with no principal");
});

// ── presentation refuses to read a tenant without one ───────────────────────────────────────────

test("the layout derives 'anonymous' from the gate's header and defaults to anonymous", () => {
  const src = code("src/app/layout.tsx");
  assert.ok(/let anonymous = true;/.test(src), "the default must be anonymous, so a missing header costs chrome, not a leak");
  assert.ok(/anonymous = !hasAuthenticatedPrincipal\(h\.get\(PRINCIPAL_HEADER\)\)/.test(src));
});

test("every tenant read in the layout is behind the anonymous guard", () => {
  const src = code("src/app/layout.tsx");
  const guard = src.indexOf("if (!anonymous) {");
  const withTenantCall = src.indexOf("await withTenant(");
  assert.ok(guard > -1 && withTenantCall > guard, "withTenant must sit inside the guard");
  // The scope query is the other tenant read, and it must not run for an anonymous caller.
  assert.ok(/anonymous \? tenantNeutralShellScope\(\) : await getShellScope\(\)/.test(src),
    "getShellScope must not be called when there is no principal");
  assert.ok(/let isOwner = !authConfigured\(\) && !anonymous;/.test(src),
    "owner state must not survive an anonymous render");
});

test("the shell still treats the sign-in and guest-seat surfaces as bare", () => {
  // Not the fix, but the reason the leak was invisible: if these stop being bare the payload
  // question changes, and this test should be read again.
  const src = code("src/components/shell.tsx");
  assert.ok(/bareRoots = \["\/login", "\/join"\]/.test(src));
});

// ── the first hotfix must stay fixed ────────────────────────────────────────────────────────────

test("the joint-pursuit room is still gated (9b9eefd must not regress)", () => {
  const src = code("src/proxy.ts");
  assert.ok(src.includes("isGuestSeatPath(req.nextUrl.pathname)"));
  assert.ok(!/startsWith\(\s*["']\/join["']\s*\)/.test(src), 'no raw startsWith("/join") may return at the gate');
});
