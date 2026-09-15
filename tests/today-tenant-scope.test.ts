import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Today / Queue tenant scoping — a structural guard (2026-09-14 hardening, Slice 2B gate).
 *
 * The defect: the app connects as the table owner, which bypasses RLS (task #67), and several
 * Today and Queue queries named no org — a guest org's certified Today listed 18 of another org's
 * items. The fix names the caller's org in every query. This test fails the moment a query is
 * added to one of these read paths without an org predicate, so the defect cannot quietly return
 * while RLS is still inert. The database-level proof is `scripts/today-tenant-verify.ts`.
 *
 * A query that reaches its org THROUGH an already org-scoped parent is listed below with why.
 */

const FILES = [
  "src/lib/pursuits/read-models/today.ts",
  "src/lib/today/overview.ts",
  "src/lib/motions/queue-read.ts",
  "src/lib/accounts/intel.ts",
  "src/lib/context/divergence.ts",
  "src/lib/pursuits/read-models/attention-loaders.ts",
  "src/app/queue/actions.ts",
];

/** Queries scoped through an org-owned parent, or reading the shared catalog — each with its reason. */
const THROUGH_PARENT: { file: string; snippet: string; why: string }[] = [
  { file: "src/lib/accounts/intel.ts", snippet: "from companies where id=$1", why: "companies is the shared account catalog (no org_id)" },
  { file: "src/lib/accounts/intel.ts", snippet: "from propensity_dimensions where score_id=$1", why: "dimensions of a score already read with org_id = the caller's" },
  { file: "src/lib/accounts/intel.ts", snippet: "from pursuit_route_snapshots s", why: "snapshot of a pursuit already read with org_id = the caller's" },
  { file: "src/lib/pursuits/read-models/today.ts", snippet: "from transaction_features where org_id", why: "(has org_id)" },
];

function sqlLiterals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/`(\s*(?:select|update|insert|with)\b[\s\S]*?)`/gi)].map((m) => m[1]);
}

test("tenant: every Today / Queue query names the caller's org (or an org-scoped parent, declared)", () => {
  const unscoped: string[] = [];
  for (const file of FILES) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const sql of sqlLiterals(src)) {
      if (/\borg_id\b/.test(sql) || /initiator_org_id|counterpart_org_id/.test(sql)) continue;
      if (THROUGH_PARENT.some((a) => a.file === file && sql.includes(a.snippet))) continue;
      unscoped.push(`${file}: ${sql.replace(/\s+/g, " ").trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(unscoped, [], `queries with no org predicate:\n${unscoped.join("\n")}`);
});

test("tenant: the Today and Queue pages run no SQL of their own — only the scoped read-models", () => {
  for (const page of ["src/app/page.tsx", "src/app/queue/page.tsx"]) {
    const src = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.equal((src.match(/db\.query\(/g) ?? []).length, 0, `${page} must not query directly`);
  }
});

test("tenant: the org always comes from withTenant, never from input", () => {
  const today = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(today, /withTenant\(\(db, orgId\) => getAccountIntel\(db, drawerId, orgId\)\)/, "the drawer's company id is from the URL; its org is not");
  assert.match(today, /withTenant\(\(db, orgId\) => loadTodayOverview\(db, orgId, scopeIds\)\)/);
  assert.match(today, /getTodayExposure\(db, orgId, scopeIds\)/);
  const queue = readFileSync(new URL("../src/app/queue/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /loadQueueWorklist\(db, orgId, scopeIds\)/);
  const actions = readFileSync(new URL("../src/app/queue/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /resolveMotionAction\(db, actionId, status, orgId\)/, "a queue item is resolved only within the caller's org");
  assert.match(actions, /where id = \$1 and status = 'pending' and org_id = \$3/);
  const cadence = readFileSync(new URL("../src/lib/motions/cadence.ts", import.meta.url), "utf8");
  assert.match(cadence, /m\.id = a\.motion_id and m\.org_id = \$3/);
});

test("tenant: filtering happens in SQL before LIMIT — the ledger and activity windows cannot be crowded by foreign rows", () => {
  const today = readFileSync(new URL("../src/lib/pursuits/read-models/today.ts", import.meta.url), "utf8");
  const ledger = today.slice(today.indexOf("from change_ledger cl"), today.indexOf("limit 60"));
  assert.match(ledger, /cl\.org_id = \$3 and pu\.org_id = \$3/, "the org predicate sits before `limit 60`");
  const overview = readFileSync(new URL("../src/lib/today/overview.ts", import.meta.url), "utf8");
  const activity = overview.slice(overview.indexOf("from outcome_events e"), overview.indexOf("limit 6"));
  assert.match(activity, /e\.org_id = \$3/);
});
