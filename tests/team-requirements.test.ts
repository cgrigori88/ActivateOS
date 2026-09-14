import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CANONICAL_TEAM_REQUIREMENTS,
  isEmptyRepairPlan,
  planCanonicalTeamRequirements,
  type GlobalRequirementRow,
  type RequirementRepairPlan,
} from "../src/lib/routing/team-requirements";

/** Apply a plan to an in-memory table the way establishCanonicalTeamRequirements applies it to SQL. */
function apply(rows: GlobalRequirementRow[], plan: RequirementRepairPlan, at = "2026-09-14T12:00:00Z"): GlobalRequirementRow[] {
  const removed = new Set(plan.remove);
  const next = rows.filter((r) => !removed.has(r.id)).map((r) => {
    const c = plan.correct.find((x) => x.id === r.id);
    return c ? { ...r, required: c.required } : r;
  });
  plan.insert.forEach((i, n) => next.push({ id: `new-${n}-${i.role}`, pursuitType: null, role: i.role, required: i.required, createdAt: at }));
  return next;
}

const canonicalRows = (createdAt = "2026-01-01T00:00:00Z"): GlobalRequirementRow[] =>
  CANONICAL_TEAM_REQUIREMENTS.map((r, n) => ({ id: `c${n}`, pursuitType: null, role: r.role, required: r.required, createdAt }));

const shape = (rows: GlobalRequirementRow[]) =>
  rows.map((r) => `${r.role}:${r.required}:${r.pursuitType ?? "*"}`).sort();

const CANONICAL_SHAPE = CANONICAL_TEAM_REQUIREMENTS.map((r) => `${r.role}:${r.required}:*`).sort();

test("team requirements: the canonical list is exactly migration 0075's global insert (one definition, pinned to history)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0075_route_sellers_team.sql", import.meta.url), "utf8");
  const block = sql.match(/insert into pursuit_team_requirements \(org_id, pursuit_type, role, required\) values([\s\S]*?);/);
  assert.ok(block, "0075 must still carry its bootstrap insert");
  const tuples = [...block[1].matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const parsed = tuples.map((t) => {
    const m = t.match(/^null,\s*null,\s*'([A-Z_]+)',\s*(true|false)$/);
    assert.ok(m, `0075 tuple is not a global all-types row: ${t}`);
    return { role: m[1], required: m[2] === "true" };
  });
  assert.deepEqual(parsed, CANONICAL_TEAM_REQUIREMENTS.map((r) => ({ role: r.role, required: r.required })));
});

test("team requirements: five roles, each once; account executive and partner account manager are the required pair", () => {
  assert.equal(CANONICAL_TEAM_REQUIREMENTS.length, 5);
  assert.equal(new Set(CANONICAL_TEAM_REQUIREMENTS.map((r) => r.role)).size, 5);
  assert.deepEqual(CANONICAL_TEAM_REQUIREMENTS.filter((r) => r.required).map((r) => r.role).sort(),
    ["PARTNER_ACCOUNT_MANAGER", "VENDOR_ACCOUNT_EXECUTIVE"]);
});

test("team requirements: a fresh migrated world (0075's rows) needs no repair — seeding it writes nothing", () => {
  assert.ok(isEmptyRepairPlan(planCanonicalTeamRequirements(canonicalRows())));
});

test("team requirements: an in-place reseed (table cleared) re-establishes exactly the five", () => {
  const plan = planCanonicalTeamRequirements([]);
  assert.equal(plan.insert.length, 5);
  assert.deepEqual(shape(apply([], plan)), CANONICAL_SHAPE);
});

test("team requirements: fresh and in-place converge on the same state", () => {
  const fresh = apply(canonicalRows(), planCanonicalTeamRequirements(canonicalRows()));
  const inPlace = apply([], planCanonicalTeamRequirements([]));
  assert.deepEqual(shape(fresh), shape(inPlace));
});

test("team requirements: repeated seeding is idempotent — the second plan is empty and ids do not churn", () => {
  let rows: GlobalRequirementRow[] = [];
  rows = apply(rows, planCanonicalTeamRequirements(rows));
  const ids = rows.map((r) => r.id).sort();
  for (let run = 0; run < 3; run++) {
    const plan = planCanonicalTeamRequirements(rows);
    assert.ok(isEmptyRepairPlan(plan), `run ${run + 2} planned ${JSON.stringify(plan)}`);
    rows = apply(rows, plan);
  }
  assert.deepEqual(rows.map((r) => r.id).sort(), ids);
});

test("team requirements: duplicates are removed, keeping the oldest row of each role", () => {
  const rows = [
    ...canonicalRows("2026-01-01T00:00:00Z"),
    { id: "dup-late", pursuitType: null, role: "VENDOR_ACCOUNT_EXECUTIVE", required: true, createdAt: "2026-09-14T00:00:00Z" },
    { id: "dup-late-2", pursuitType: null, role: "DISTRIBUTOR_BDM", required: false, createdAt: "2026-09-14T00:00:00Z" },
  ];
  const plan = planCanonicalTeamRequirements(rows);
  assert.deepEqual(plan.remove.sort(), ["dup-late", "dup-late-2"]);
  assert.equal(plan.insert.length, 0);
  const after = apply(rows, plan);
  assert.deepEqual(shape(after), CANONICAL_SHAPE);
  assert.ok(after.some((r) => r.id === "c0"), "the original account-executive row survives");
});

test("team requirements: arbitrary pre-existing global rows are not preserved — the canonical set is re-established", () => {
  const rows: GlobalRequirementRow[] = [
    { id: "x1", pursuitType: null, role: "VENDOR_EXECUTIVE_SPONSOR", required: true, createdAt: "2026-01-01T00:00:00Z" },
    { id: "x2", pursuitType: "MODERNIZATION", role: "VENDOR_ACCOUNT_EXECUTIVE", required: true, createdAt: "2026-01-01T00:00:00Z" },
    { id: "x3", pursuitType: null, role: "PARTNER_ACCOUNT_MANAGER", required: false, createdAt: "2026-01-01T00:00:00Z" },
  ];
  const plan = planCanonicalTeamRequirements(rows);
  assert.deepEqual(plan.remove.sort(), ["x1", "x2"]);
  assert.deepEqual(plan.correct, [{ id: "x3", required: true }]);
  assert.equal(plan.insert.length, 4);
  const after = apply(rows, plan);
  assert.deepEqual(shape(after), CANONICAL_SHAPE);
  assert.ok(isEmptyRepairPlan(planCanonicalTeamRequirements(after)));
});

test("team requirements: the canonical seed establishes them before any team is assembled, on BOTH provisioning paths", () => {
  const src = readFileSync(new URL("../scripts/demo-db.ts", import.meta.url), "utf8");
  const seedAt = src.indexOf("async function seed(");
  const establishAt = src.indexOf("establishCanonicalTeamRequirements(", seedAt);
  const assembleAt = src.indexOf("assembleTeam(db, hero", seedAt);
  assert.ok(seedAt > 0 && establishAt > seedAt && assembleAt > establishAt, "seed() must establish requirements before assembleTeam");
  // Both the local (drop/create) path and the in-place path build the world through seed().
  assert.equal([...src.matchAll(/const ids = await seed\(pool\)/g)].length, 2);
});

test("team requirements: the reset contract checks them, since the manifest counts no team table", () => {
  const src = readFileSync(new URL("../scripts/seed-demo-world.ts", import.meta.url), "utf8");
  assert.match(src, /CANONICAL_TEAM_REQUIREMENTS/);
  assert.match(src, /from pursuit_team_requirements where org_id is null/);
});
