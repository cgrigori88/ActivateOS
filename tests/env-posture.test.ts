import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePosture, probeDatabasePosture } from "../src/lib/env/db-posture";
import { databaseIdentity } from "../src/lib/env/environment";

const REF = "mejokqxriwyawfhawuxu";

test("databaseIdentity parses the role and project ref from a pooled owner login", () => {
  const id = databaseIdentity(`postgresql://postgres.${REF}:s3cret-pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`);
  assert.deepEqual(id, { projectRef: REF, host: "aws-0-ca-central-1.pooler.supabase.com", role: "postgres" });
});

test("databaseIdentity parses app_rw.<ref> after the H1B cutover (it used to report the ref as unknown)", () => {
  const id = databaseIdentity(`postgresql://app_rw.${REF}:s3cret-pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`);
  assert.equal(id.projectRef, REF);
  assert.equal(id.role, "app_rw");
});

test("databaseIdentity reads a direct host's ref, a local role, and never returns the password", () => {
  assert.deepEqual(databaseIdentity(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`), { projectRef: REF, host: `db.${REF}.supabase.co`, role: "postgres" });
  const local = databaseIdentity("postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo");
  assert.deepEqual(local, { projectRef: null, host: "127.0.0.1", role: "app_rw" });
  assert.ok(!JSON.stringify(local).includes("demo@"));
  assert.deepEqual(databaseIdentity(undefined), { projectRef: null, host: null, role: null });
  assert.deepEqual(databaseIdentity("not a url"), { projectRef: null, host: null, role: null });
});

test("derivePosture: the owner (BYPASSRLS) is NOT tenant-enforcing; app_rw is", () => {
  assert.deepEqual(derivePosture({ role: "postgres", rolsuper: false, rolbypassrls: true, row_security: "on" }),
    { status: "live", role: "postgres", superuser: false, bypassRls: true, tenantEnforcement: false });
  assert.deepEqual(derivePosture({ role: "app_rw", rolsuper: false, rolbypassrls: false, row_security: "on" }),
    { status: "live", role: "app_rw", superuser: false, bypassRls: false, tenantEnforcement: true });
});

test("derivePosture: a superuser, or row_security off, is not the enforcing posture", () => {
  assert.equal(derivePosture({ role: "x", rolsuper: true, rolbypassrls: false, row_security: "on" }).tenantEnforcement, false);
  assert.equal(derivePosture({ role: "app_rw", rolsuper: false, rolbypassrls: false, row_security: "off" }).tenantEnforcement, false);
});

test("probeDatabasePosture never throws and never hangs: an error or a timeout reports unavailable", async () => {
  const failing = { query: () => Promise.reject(new Error("connection refused")) } as never;
  assert.deepEqual(await probeDatabasePosture(failing), { status: "unavailable" });
  const hanging = { query: () => new Promise(() => {}) } as never;
  const t0 = Date.now();
  assert.deepEqual(await probeDatabasePosture(hanging, 50), { status: "unavailable" });
  assert.ok(Date.now() - t0 < 1000);
  const ok = { query: () => Promise.resolve({ rows: [{ role: "app_rw", rolsuper: false, rolbypassrls: false, row_security: "on" }] }) } as never;
  assert.deepEqual(await probeDatabasePosture(ok), { status: "live", role: "app_rw", superuser: false, bypassRls: false, tenantEnforcement: true });
});
