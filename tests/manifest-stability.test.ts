import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";

/**
 * THE MANIFEST DIGEST IS NOT A ZERO-MUTATION ORACLE ON ITS OWN.
 *
 * On 2026-09-17 a hosted gate saw `cbddf5de9433b9fd → fbde5a5aed6ac7f7` while every table
 * fingerprint, the world hash, the business hash and the security hash were identical and the last
 * write to `opportunities` was three days old. The cause was `days_since_activity =
 * extract(day from now() - updated_at)` — a clock reading inside the manifest. Elapsed time looked
 * exactly like mutation.
 *
 * `demo-manifest.ts` now splits at the source: `stableDigest` covers time-invariant canonical state,
 * `observationalDigest` adds the clock-derived fields, and the values themselves are reported so a
 * change can be CLASSIFIED rather than guessed at. These tests pin that property without a database,
 * by exercising the same composition rule the script uses.
 *
 * The product keeps `days_since_activity`. It is useful demo data; the certification semantics were
 * what needed fixing.
 */

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/** The script's composition, restated minimally: stable state, and stable state plus observation. */
const digests = (stableWorld: unknown, observational: unknown) => ({
  stableDigest: sha(stableWorld),
  observationalDigest: sha({ ...(stableWorld as object), observational }),
});

test("CONTROL: the same canonical state observed later moves the observational digest ONLY", () => {
  const stableWorld = {
    tenants: [{ name: "Acme", kind: "full" }],
    heroes: [{ account: "Acme", deal: "Expansion", stage: "qualification", amount: "540000" }],
    figures: { openPipeline: "8040000" },
    counts: { pursuits: 14, opportunities: 19 },
  };

  // Two observations of ONE unchanged world, taken a day apart.
  const earlier = digests(stableWorld, { daysSinceActivity: [{ account: "Acme", deal: "Expansion", days: 97 }] });
  const later = digests(stableWorld, { daysSinceActivity: [{ account: "Acme", deal: "Expansion", days: 98 }] });

  assert.equal(earlier.stableDigest, later.stableDigest,
    "the stable digest must not move when only the clock moved — this is the zero-mutation oracle");
  assert.notEqual(earlier.observationalDigest, later.observationalDigest,
    "the observational digest is EXPECTED to move with time; that is what makes it classifiable");
});

test("a real state change moves BOTH digests", () => {
  const before = { counts: { pursuits: 14 } };
  const after = { counts: { pursuits: 15 } };
  const obs = { daysSinceActivity: [{ account: "Acme", deal: "Expansion", days: 97 }] };
  const a = digests(before, obs), b = digests(after, obs);
  assert.notEqual(a.stableDigest, b.stableDigest, "a written row must move the stable digest");
  assert.notEqual(a.observationalDigest, b.observationalDigest);
});

test("the stable world carries no clock-derived field", () => {
  const src = readFileSync(new URL("../scripts/demo-manifest.ts", import.meta.url), "utf8");
  // `days_since_activity` is lifted OUT of the hero rows before the stable digest is taken.
  assert.match(src, /const stableHeroes = heroes\.map\(\(\{ days_since_activity: _drop, \.\.\.rest \}\) => rest\)/);
  assert.match(src, /const stableDigest = sha\(stableWorld\)/);
  assert.match(src, /const observationalDigest = sha\(\{ \.\.\.stableWorld, observational \}\)/);
  // The default `--digest` must be the STABLE one: every existing caller means "did state move?".
  assert.match(src, /mode \? manifest\.stableDigest/);
});

test("the observational values are reported, so a change can be classified rather than guessed", () => {
  const src = readFileSync(new URL("../scripts/demo-manifest.ts", import.meta.url), "utf8");
  assert.match(src, /observational = \{\s*daysSinceActivity:/);
  assert.match(src, /observedAt: new Date\(\)\.toISOString\(\)/);
});

test("the certification rule is written down where a future gate will read it", () => {
  const src = readFileSync(new URL("../scripts/demo-manifest.ts", import.meta.url), "utf8");
  assert.match(src, /STABLE vs OBSERVATIONAL — READ THIS BEFORE USING A DIGEST AS A GATE/);
  assert.match(src, /This is the zero-mutation oracle/);
});
