import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { PRINCIPAL_HEADER } from "../src/lib/auth/principal";

/**
 * THE STAMP IS CLIENT-ADDRESSABLE, so it is attacked here rather than assumed safe.
 *
 * `x-pursuitos-principal` is an ordinary request header name: anyone can put it on a request. What
 * makes it trustworthy downstream is that the gate REBUILDS the forwarded request and deletes the
 * header before setting its own value, so the value rendering sees is always the gate's.
 *
 * These tests run the real `proxy()` and read the forwarded headers back out of the response. Next
 * transports a middleware's request-header edits as `x-middleware-override-headers` plus one
 * `x-middleware-request-<name>` per edited header, which is exactly what the render layer receives —
 * so asserting on those is asserting on what the layout would read.
 *
 * Hosted counterpart (deployment dewua2km5, commit 9cb4f66): nine forgery variants — the header
 * itself, case variants, comma-joined duplicates, and Next's own override headers — each returned a
 * response BYTE-IDENTICAL to the unforged control on /join/<dead code> (15,714 B) and /login
 * (18,459 B), and /joint and /queue stayed 307 → /login. 36/36.
 */

const forwarded = (res: Response, name: string): string | null => res.headers.get(`x-middleware-request-${name}`);

/** Restore env after each case: these tests steer the gate by configuration. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prior = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    prior.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prior) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`https://gate.test${path}`), { headers });

test("a forged principal is overwritten by the value the gate established", async () => {
  const { proxy } = await import("../src/proxy");
  await withEnv({ BASIC_AUTH_USER: undefined, BASIC_AUTH_PASS: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, PURSUITOS_ENV: undefined }, async () => {
    // No auth configured at all: the gate's own verdict is "open". A client claiming "identity"
    // must not survive that.
    const res = await proxy(request("/queue", { [PRINCIPAL_HEADER]: "identity" }));
    assert.equal(forwarded(res, PRINCIPAL_HEADER), "open", "the client's value must be replaced by the gate's");
  });
});

test("the guest seat forwards NO principal even when the caller supplies one", async () => {
  const { proxy } = await import("../src/proxy");
  await withEnv({ BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, PURSUITOS_ENV: undefined }, async () => {
    for (const forgery of ["identity", "basic", "open"]) {
      const res = await proxy(request("/join/ABC123XYZ00", { [PRINCIPAL_HEADER]: forgery }));
      const value = forwarded(res, PRINCIPAL_HEADER);
      assert.ok(value === null || value === "", `the guest seat must forward no principal, got ${JSON.stringify(value)} for forged ${forgery}`);
    }
  });
});

test("a forged principal cannot open a gated room", async () => {
  const { proxy } = await import("../src/proxy");
  await withEnv({ BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, PURSUITOS_ENV: undefined }, async () => {
    // Basic Auth configured, no credential presented: the gate must refuse regardless of the marker.
    const res = await proxy(request("/joint", { [PRINCIPAL_HEADER]: "identity" }));
    assert.equal(res.status, 401, "a forged principal must not substitute for a credential");
    assert.equal(forwarded(res, PRINCIPAL_HEADER), null, "a refused request forwards nothing");
  });
});

test("a verified credential is what produces a principal", async () => {
  const { proxy } = await import("../src/proxy");
  await withEnv({ BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, PURSUITOS_ENV: undefined }, async () => {
    const authorization = `Basic ${Buffer.from("u:p").toString("base64")}`;
    // The forged value is ALSO present, to prove the gate's verdict wins rather than the client's.
    const res = await proxy(request("/queue", { authorization, [PRINCIPAL_HEADER]: "identity" }));
    assert.equal(forwarded(res, PRINCIPAL_HEADER), "basic", "verified Basic Auth is 'basic', never the client's claim");
  });
});

test("the surface marker is equally unforgeable", async () => {
  // Same class of defect if it were: `x-pursuitos-surface: landing` would strip the shell.
  const { proxy } = await import("../src/proxy");
  await withEnv({ BASIC_AUTH_USER: "u", BASIC_AUTH_PASS: "p", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, PURSUITOS_ENV: undefined }, async () => {
    const authorization = `Basic ${Buffer.from("u:p").toString("base64")}`;
    const res = await proxy(request("/queue", { authorization, "x-pursuitos-surface": "landing" }));
    const value = forwarded(res, "x-pursuitos-surface");
    assert.ok(value === null || value === "", `a client must not classify its own request as the public surface, got ${JSON.stringify(value)}`);
  });
});
