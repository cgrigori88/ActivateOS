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

/**
 * The canonical hero cast (Wave 6C §5). These are the accounts the demo
 * itinerary is written around; each must exist EXACTLY ONCE after a clean
 * build. Anything else with a run-id suffix is test pollution, not canon.
 */
const HERO_ACCOUNTS = [
  "Umbrella Health Systems", "Globex Manufacturing Inc.", "Stark Industries LLC",
  "Cyberdyne Systems", "Hooli Cloud", "Acme Robotics", "Initech Financial",
  "Wayne Enterprises", "Soylent Foods Co.", "Tyrell Corp",
];

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

/**
 * Verify the built world (Wave 6C §10). A reset that does not check what it
 * produced is a reset you cannot trust twice. Two things are asserted, and they
 * are the two that actually went wrong historically:
 *
 *   · every hero account exists EXACTLY ONCE — the layer scripts are additive,
 *     and run over a world that already had them they made second copies;
 *   · NO run-id-suffixed companies or organizations survive — those are
 *     verifier fixtures that leaked in, and they are not canon merely because
 *     they were there (§4).
 */
async function verify(): Promise<number> {
  const { Pool } = await import("pg");
  const url = process.env.DEMO_URL ?? process.env.DATABASE_URL
    ?? `postgresql://postgres@127.0.0.1:${process.env.DEMO_PGPORT ?? "5432"}/${process.env.DEMO_DB_NAME ?? "pursuit_demo"}`;
  const pool = new Pool({ connectionString: url });
  let bad = 0;
  try {
    console.log("\nverifying the canonical world:");
    for (const name of HERO_ACCOUNTS) {
      const n = Number((await pool.query<{ n: string }>(
        `select count(*)::text n from companies where legal_name = $1`, [name])).rows[0].n);
      if (n === 1) { console.log(`  ok    ${name}`); }
      else { bad++; console.log(`  FAIL  ${name} — expected exactly 1, found ${n}`); }
    }
    // Run-id suffixes are 5-8 lowercase alphanumerics appended to a name by a
    // verifier fixture ("Globex cgvous", "E3A Globex b8yunv", "Tenant A x7f2q").
    const pollution = await pool.query<{ kind: string; name: string }>(
      `select 'company' kind, legal_name name from companies
        where legal_name ~ '[a-z0-9]{5,8}$' and legal_name !~ '(Inc\\.|LLC|Corp|Systems|Cloud|Robotics|Financial|Enterprises|Co\\.)$'
       union all
       select 'organization', name from organizations
        where name ~ '^(Tenant |E3[A-Z]? |G[0-9] |OR[0-9] )'`);
    if (pollution.rows.length === 0) console.log("  ok    no verifier-fixture pollution");
    else {
      bad++;
      console.log(`  FAIL  ${pollution.rows.length} polluted rows, e.g. ${pollution.rows.slice(0, 5).map((r) => `${r.kind} "${r.name}"`).join(", ")}`);
    }

    /**
     * No duplicated commercial records. Checking the ten hero names by hand
     * caught the accounts and missed the deals hanging off them: five
     * opportunities were doubled on a clean build, and because the goal's
     * roll-up sums them, the demo's headline number moved from $3.67M to $6.55M
     * with no deal authored. A demo world whose figures drift on rebuild cannot
     * be shown twice, so the reset contract asserts identity generally rather
     * than name by name.
     */
    for (const [label, sql] of [
      ["opportunities", `select name || ' @ ' || company_id::text k, count(*) n from opportunities group by 1 having count(*) > 1`],
      // Same deal under two names: the breadth layer and the narrative layer
      // both authored Stark's $1.45M, one as "Hybrid cloud landing zone" and one
      // as "Sovereign landing zone". Identical names are caught above; identical
      // AMOUNTS on one account, both open, is what that mistake looks like.
      ["same-amount open deals on one account",
       `select company_id::text || ' @ ' || amount_usd::text k, count(*) n from opportunities
         where stage not like 'closed%' and amount_usd is not null group by 1 having count(*) > 1`],
      ["revenue motions", `select company_id::text || '/' || coalesce(taxonomy_node_id::text,'-') k, count(*) n from revenue_motions group by 1 having count(*) > 1`],
      ["pursuits", `select account_id::text || '/' || use_case k, count(*) n from pursuits group by 1 having count(*) > 1`],
      // The breadth and narrative layers describe the same hero accounts, so
      // every per-account artefact they both write can double. Evidence counts
      // are shown in the Evidence and Trust rooms; scores are read latest-first
      // and so hid their own duplication until it was looked for.
      ["evidence claims", `select company_id::text || ' :: ' || claim k, count(*) n from evidence group by 1 having count(*) > 1`],
      ["propensity scores", `select company_id::text || '/' || score_version_id::text k, count(*) n from propensity_scores group by 1 having count(*) > 1`],
    ] as const) {
      const { rows } = await pool.query<{ k: string; n: string }>(sql);
      if (rows.length === 0) console.log(`  ok    no duplicated ${label}`);
      else {
        bad++;
        console.log(`  FAIL  ${rows.length} duplicated ${label}, e.g. ${rows.slice(0, 3).map((r) => `${r.k} ×${r.n}`).join(", ")}`);
      }
    }
  } finally { await pool.end(); }
  return bad;
}

const badChecks = await verify();
const ok = failed === 0 && badChecks === 0;
console.log(ok
  ? "\ncanonical demo world built and verified."
  : `\ncanonical demo world NOT clean — ${failed} failing step(s), ${badChecks} failing check(s).`);
process.exit(ok ? 0 : 1);
