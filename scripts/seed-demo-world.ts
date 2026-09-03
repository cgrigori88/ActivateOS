import { execFileSync } from "node:child_process";

/**
 * Build the canonical synthetic demo world (Wave 6B §8).
 *
 * WHY THIS EXISTS. The SEEDED verifier class reads "the canonical PursuitOS
 * synthetic demo world", and until now that world had no written recipe. It was
 * a sequence of nine scripts that had to be run in a particular order, known
 * only by having done it before. `demo-db.ts` alone builds the base tenant and
 * the hero pursuits; run the SEEDED suites against that and five of them die on
 * `Cannot read properties of undefined` because the narratives they read have
 * not been layered on yet. That is indistinguishable, from the outside, from a
 * code defect — and during Wave 6B it briefly was mistaken for one.
 *
 * The order matters and is not arbitrary:
 *   1. demo-db              base tenants, accounts, hero pursuits, routes
 *   2. demo-enrich          breadth — coherent synthetic commercial data
 *   3. demo-stories         the four deep hero narratives
 *   4. demo-value-story     value cases and their confidential economics
 *   5. demo-lifecycle-story lifecycle/renewal derivations
 *   6. demo-stakeholder-story  buying-role assertions, through the GOVERNED path
 *   7. demo-intel-story     the intelligence-wave narrative
 *   8. demo-ask-story       Ask exchanges over the world the above built
 *   9. demo-goal            one goal whose progress is computed, not typed
 *  10. demo-meddpicc        MEDDPICC on the existing opportunities
 *
 * Steps 2-10 are additive and idempotent by construction; step 1 rebuilds.
 *
 *   npx tsx scripts/seed-demo-world.ts                    # full rebuild
 *   npx tsx scripts/seed-demo-world.ts --layers-only      # skip the rebuild
 *
 * DEMO_PGPORT / DATABASE_URL select the target, exactly as the individual
 * scripts already do. This orchestrates them; it owns no data of its own.
 */

interface Step { script: string; label: string; base?: boolean }

const STEPS: Step[] = [
  { script: "demo-db.ts", label: "base world (tenants, accounts, hero pursuits, routes)", base: true },
  { script: "demo-enrich.ts", label: "breadth enrichment" },
  { script: "demo-stories.ts", label: "four deep hero narratives" },
  { script: "demo-value-story.ts", label: "value cases + confidential economics" },
  { script: "demo-lifecycle-story.ts", label: "lifecycle / renewal derivations" },
  { script: "demo-stakeholder-story.ts", label: "stakeholder assertions (governed path)" },
  { script: "demo-intel-story.ts", label: "intelligence narrative" },
  { script: "demo-ask-story.ts", label: "Ask exchanges" },
  { script: "demo-goal.ts", label: "computed goal" },
  { script: "demo-meddpicc.ts", label: "MEDDPICC enrichment" },
];

const layersOnly = process.argv.includes("--layers-only");
let failed = 0;

for (const s of STEPS) {
  if (layersOnly && s.base) { console.log(`skip  ${s.script.padEnd(28)} (--layers-only)`); continue; }
  process.stdout.write(`run   ${s.script.padEnd(28)} ${s.label} … `);
  try {
    execFileSync("npx", ["tsx", `scripts/${s.script}`], { encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] });
    console.log("ok");
  } catch (e) {
    failed++;
    const err = e as { stdout?: string; stderr?: string };
    const line = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.match(/error:.*|Error:.*|fatal:.*/i)?.[0] ?? "failed";
    console.log(`FAILED — ${line.replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

console.log(failed === 0 ? "\ndemo world built." : `\ndemo world built with ${failed} failing step(s).`);
process.exit(failed === 0 ? 0 : 1);
