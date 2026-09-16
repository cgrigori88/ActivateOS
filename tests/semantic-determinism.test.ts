import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Static guards for D-G8-4 — SEMANTIC correctness, not stable ordering.
 *
 * The database twin (scripts/semantic-determinism-verify.ts) proves the meanings hold against real
 * rows. These guards protect the code shapes that make those meanings possible, and the boundary
 * conditions of the workstream itself.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Source with comments removed — guards must judge CODE, not the prose that explains it. */
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, " ").split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").replace(/\s--\s.*$/, "")).join("\n");

// ── the workstream's own boundary ────────────────────────────────────────────────────────────────

test("D-G8-4 is CODE-ONLY: no migration above the 0107 hosted level exists", () => {
  const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(migrations.length, 107, `expected 107 migrations, found ${migrations.length}`);
  assert.equal(migrations.at(-1), "0107_dg83b_settlement_opportunity_identity.sql");
  assert.ok(!migrations.some((m) => /^01(0[89]|[1-9]\d)/.test(m)), "a migration above 0107 was created");
});

// ── 4A ───────────────────────────────────────────────────────────────────────────────────────────

test("4A: PROVENANCE_STRENGTH is canonical for source-truth selection and LADDER_RANK is untouched", () => {
  assert.match(code("src/lib/facts/provenance-precedence.ts"), /import \{ PROVENANCE_STRENGTH \}/, "must consume the EXISTING table, not redefine one");
  assert.doesNotMatch(code("src/lib/facts/provenance-precedence.ts"), /LADDER_RANK/, "the value-driver ladder must not be pulled into source-truth selection");
  // The drivers ladder is still the drivers ladder.
  assert.match(src("src/lib/value/drivers.ts"), /LADDER_RANK\[a\.ladder\] - LADDER_RANK\[b\.ladder\]/);
});

test("4A: both lifecycle selectors use confidence → recency → provenance, so they cannot disagree", () => {
  for (const f of ["src/lib/lifecycle/state.ts", "src/lib/lifecycle/projection.ts"]) {
    const s = src(f);
    assert.match(s, /b\.confidence - a\.confidence/, `${f}: confidence must stay primary`);
    assert.match(s, /b\.observedLastAt\.getTime\(\) - a\.observedLastAt\.getTime\(\)/, `${f}: recency must be secondary`);
    assert.match(s, /compareProvenance\(a\.provenanceClass, b\.provenanceClass\)/, `${f}: provenance must be the tie-break`);
  }
});

test("4A: primaryLifecycleEvent stays a lifecycle-state question, not a provenance one", () => {
  const s = src("src/lib/lifecycle/state.ts");
  const fn = s.slice(s.indexOf("export function primaryLifecycleOutcome"));
  assert.doesNotMatch(fn.slice(0, 600), /compareProvenance|PROVENANCE_STRENGTH/);
  assert.match(fn, /LIFECYCLE_STATE_RANK\[a\.state\] - LIFECYCLE_STATE_RANK\[b\.state\]/);
});

// ── 4B ───────────────────────────────────────────────────────────────────────────────────────────

test("4B: the median is ungrouped, and the mode is never called a median", () => {
  const s = src("src/lib/partners/intelligence.ts");
  assert.doesNotMatch(s, /rows\.find\(\(r\) => r\.med != null\)/, "the arbitrary per-group median pick must be gone");
  assert.match(s, /percentile_cont\(0\.5\)[\s\S]{0,400}?po\.seconds_since_recommended is not null/,
    "the median query must be the ungrouped one, filtered to timestamped rows");
  assert.match(s, /Most common outcome/);
  assert.match(s, /mostCommonOutcomeTied/);
  // The only thing allowed to carry the word "Median" is the numeric days statistic.
  for (const m of s.match(/`Median [^`]*`/g) ?? []) assert.match(m, /^`Median \$\{[^}]+\}d /);
});

// ── 4C ───────────────────────────────────────────────────────────────────────────────────────────

test("4C: no identity site decides by name length, alphabet or row order", () => {
  for (const f of ["src/lib/value/intents.ts", "src/lib/agents/ask-scope.ts",
                   "src/lib/agents/mcp-tools.ts", "src/lib/interpret/entities.ts"]) {
    const s = code(f);
    assert.doesNotMatch(s, /length\((?:c\.)?(?:legal_)?name\)/i, `${f}: name length is not identity evidence`);
    assert.doesNotMatch(s, /order by legal_name limit 1/i, `${f}: alphabetical order is not identity evidence`);
  }
});

test("4C: the identity ladder is ordered id → alias → normalized → unique fuzzy, and never guesses", () => {
  const s = code("src/lib/identity/lookup.ts");
  const order = ["CANONICAL_ID", "ID_ALIAS", "NAME_ALIAS", "NORMALIZED_NAME", "UNIQUE_FUZZY"];
  const at = order.map((k) => s.indexOf(`via: "${k}"`));
  assert.ok(at.every((i) => i > 0), "every rung must exist");
  assert.deepEqual([...at].sort((a, b) => a - b), at, "the rungs must appear in ladder order");
  assert.doesNotMatch(s, /length\(/, "no length-based selection");
  assert.doesNotMatch(s, /order by/i, "resolution must not depend on any row ordering at all");
});

test("4C: ask-scope fails CLOSED on ambiguity, as its own outcome, without leaking candidates", () => {
  const s = src("src/lib/agents/ask-scope.ts");
  assert.match(s, /ambiguous\?: \{ ambiguous_account: true; reason: string \}/);
  assert.match(s, /ambiguous: \{ ambiguous_account: true/);
  // The ambiguity message carries a COUNT, never names or ids.
  for (const m of s.match(/reason: `"\$\{account\}" matches [^`]*`/g) ?? []) {
    assert.match(m, /\$\{[a-zA-Z.]*\.candidates\}/, "ambiguity must report a count");
  }
  assert.match(src("src/app/api/mcp/route.ts"), /decision\.ambiguous \?\? decision\.refusal/);
});

test("4C: in-force facts consume an explicit asOf and keep conflicting → unresolved", () => {
  const s = src("src/lib/value/drivers.ts");
  assert.match(s, /companyId: string, asOf: Date/, "the selector must take an explicit asOf");
  assert.match(s, /r\.valid_from\.getTime\(\) <= asOf\.getTime\(\)/);
  assert.match(s, /r\.valid_until\.getTime\(\) > asOf\.getTime\(\)/);
  assert.match(s, /const picked = conflicting \? null : resolveTie\(/);
  const fn = s.slice(s.indexOf("export async function loadDrivers"));
  assert.doesNotMatch(fn, /new Date\(\)/, "loadDrivers must not read the clock itself");
});

test("4C: callers capture ONE asOf at the read-model boundary", () => {
  assert.match(src("src/lib/value/case.ts"), /const at = asOf \?\? new Date\(\);/);
  assert.match(src("src/lib/opportunities/meddpicc.ts"), /const at = asOf \?\? new Date\(\);/);
});

test("4C: plan-loaders breaks an equal timing date with the existing lifecycle-state rank", () => {
  const s = src("src/lib/pursuits/read-models/plan-loaders.ts");
  assert.match(s, /LIFECYCLE_STATE_RANK\[a\.e\.state as LifecycleState\] - LIFECYCLE_STATE_RANK\[b\.e\.state as LifecycleState\]/);
});

// ── 4D ───────────────────────────────────────────────────────────────────────────────────────────

test("4D: the campaign readers are null-safe so an unresolved seed stays visible", () => {
  for (const f of ["src/app/campaigns/page.tsx", "src/app/upcoming/page.tsx", "src/app/campaigns/[id]/page.tsx"]) {
    const s = src(f);
    assert.match(s, /left join companies c on c\.id = coalesce\(ca\.company_id, m\.company_id\)/, `${f}: must LEFT JOIN`);
    assert.match(s, /Seed account not selected/, `${f}: must render the unresolved state`);
  }
});

test("4D: launching refuses while the seed is unresolved", () => {
  const s = src("src/app/campaigns/[id]/actions.ts");
  assert.match(s, /seed\[0\]\.company_id == null/);
  assert.match(s, /no seed account selected/i);
});
