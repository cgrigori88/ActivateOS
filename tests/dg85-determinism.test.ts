import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Static guards for D-G8-5 — the capped shared-evidence read.
 *
 * Scoped deliberately to THIS migration and THIS function. There is no assertion about how many
 * migrations the repository holds and none about what may exist above 0108: a future 0109+ is
 * legitimate and must not fail these tests. The database twin is
 * scripts/dg85-determinism-verify.ts.
 */

const FILE = "supabase/migrations/0108_dg85_shared_in_evidence_determinism.sql";
const sql = () => readFileSync(join(process.cwd(), FILE), "utf8");
/** Judge CODE, not the prose that explains it — the header quotes the old clause to rule it out. */
const code = () => sql().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("D-G8-5: migration 0108 exists and targets shared_in_evidence", () => {
  assert.ok(existsSync(join(process.cwd(), FILE)), `${FILE} is missing`);
  assert.match(code(), /create or replace function public\.shared_in_evidence\(p_company uuid\)/);
});

test("D-G8-5: the ORDER BY gains s.id DESC and keeps LIMIT 20", () => {
  const order = /order by ([^;]*?) limit 20;/i.exec(code());
  assert.ok(order, "the capped ORDER BY was not found");
  assert.equal(order[1].trim(), "e.observed_at desc, s.id desc");
  assert.match(code(), /limit 20;/, "the cap must remain 20");
});

test("D-G8-5: the returned shape and signature are unchanged", () => {
  assert.match(code(), /returns table \(claim text, source_type text, observed_at timestamptz, org_name text\)/);
});

test("D-G8-5: CREATE OR REPLACE only — the function is never dropped, and no CASCADE", () => {
  assert.doesNotMatch(code(), /drop function/i, "0108 must not drop the function");
  assert.doesNotMatch(code(), /cascade/i, "no CASCADE");
});

test("D-G8-5: SECURITY DEFINER, STABLE and the hardened search_path are restated", () => {
  assert.match(code(), /language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp/);
});

test("D-G8-5: the consent and filter clauses are carried over unchanged", () => {
  const c = code();
  for (const clause of [
    /caller uuid := public\.app_current_org\(\)/,
    /if caller is null then return; end if;/,
    /p\.status = 'active'/,
    /\(p\.initiator_org_id = caller or p\.counterpart_org_id = caller\)/,
    /e\.company_id = p_company/,
    /\(e\.org_id = s\.offered_by_org or e\.org_id is null\)/,
    /s\.status = 'accepted' and s\.offered_by_org <> caller/,
  ]) assert.match(c, clause, `consent/filter clause missing: ${clause}`);
});

test("D-G8-5: a ROLLBACK block exists and says plainly that reverting reintroduces the defect", () => {
  const s = sql();
  assert.match(s, /-- ROLLBACK:/);
  assert.match(s, /reintroduces the D-G8-5 nondeterminism/i);
  assert.match(s, /not an acceptable steady\s*\n?--\s*state|NOT an acceptable steady state/i);
});

test("D-G8-5 adds no application-code requirement: the sole caller still selects the same four columns", () => {
  const caller = readFileSync(join(process.cwd(), "src/lib/partnerships/evidence-shares.ts"), "utf8");
  assert.match(caller, /select claim, source_type, observed_at, org_name from shared_in_evidence\(\$1\)/);
});
