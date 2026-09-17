import { createHash } from "node:crypto";
import { Pool } from "pg";

/**
 * The canonical demo world, as a machine-readable manifest (Wave 6C §2).
 *
 * WHY THIS EXISTS. Until now "the canonical demo world" was defined by whatever
 * happened to be in the demo database, and the only way to ask what it should
 * contain was to run the verifier battery and read the failures backwards. That
 * is the wrong direction: a failing assertion tells you two worlds disagree, not
 * which one is right, and it let contamination become canon simply by being
 * present when the assertion was written.
 *
 * So the target state is declared here, derived from the world the seed recipe
 * builds and cross-checked against `audit/DEMO-ITINERARY.md`, and it is emitted
 * as stable JSON that can be diffed between rebuilds.
 *
 *   npx tsx scripts/demo-manifest.ts                 # JSON to stdout
 *   npx tsx scripts/demo-manifest.ts --digest        # the STABLE digest (time-invariant state)
 *   npx tsx scripts/demo-manifest.ts --digest=observational   # stable state + observational fields
 *
 * STABLE vs OBSERVATIONAL — READ THIS BEFORE USING A DIGEST AS A GATE.
 *
 * `days_since_activity` is `extract(day from now() - updated_at)`: it moves when the CLOCK moves,
 * with nothing written. On 2026-09-17 that produced a manifest-digest change between two hosted
 * snapshots while every table fingerprint, the world hash, the business hash and the security hash
 * were identical and the last write was three days old — elapsed time read as if it were mutation.
 *
 * So the digest is split at its source:
 *   • `stableDigest`       — time-invariant canonical state ONLY. This is the zero-mutation oracle.
 *   • `observationalDigest`— stable state PLUS clock-derived fields. Expected to move with time.
 *   • `observational`      — the clock-derived values themselves, reported so a change can be
 *                            classified rather than guessed at.
 *
 * `--digest` returns the STABLE one, because that is what every existing caller means by it.
 * The product keeps `days_since_activity`: it is useful demo data, and the certification semantics
 * were what needed fixing, not the world.
 *
 * WHAT IS AND IS NOT IN IT. Identifiers and timestamps are excluded on purpose:
 * they are freshly generated on every build, so including them would make the
 * digest differ every time and prove nothing. What is included is the material
 * that a demo is actually given on: who the cast is, what distinguishes each of
 * them, what the headline figures are, and how many rows of each kind exist.
 * Two builds that agree on all of that are the same world.
 */

const URL_ = process.env.DEMO_URL ?? process.env.DATABASE_URL
  ?? `postgresql://postgres@127.0.0.1:${process.env.DEMO_PGPORT ?? "5432"}/${process.env.DEMO_DB_NAME ?? "pursuit_demo"}`;

const pool = new Pool({ connectionString: URL_ });
const q = async <T extends object>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query<T>(sql, params)).rows;
const one = async (sql: string): Promise<number> =>
  Number((await q<{ v: string }>(sql))[0]?.v ?? 0);

async function build() {
  /**
   * The tenants. Kind matters to the demo: the guest tenant is what makes the
   * cross-tenant disclosure story showable, and the distributor is the third
   * party in the federation narrative.
   */
  const tenants = await q<{ name: string; kind: string; pursuits: number; opportunities: number; motions: number }>(
    `select o.name, o.kind,
            (select count(*)::int from pursuits p where p.org_id = o.id) pursuits,
            (select count(*)::int from opportunities x where x.org_id = o.id) opportunities,
            (select count(*)::int from revenue_motions m where m.org_id = o.id) motions
       from organizations o order by o.name`);

  /**
   * The hero cast, with the facts that distinguish each one. These are the
   * distinctions `audit/DEMO-ITINERARY.md` is written around — Stark's UNKNOWN
   * timing, Umbrella's silence, Initech's win — and they are what must survive a
   * rebuild for the itinerary to still be walkable (Wave 6C §5).
   */
  const heroes = await q<{
    account: string; pursuit_use_case: string | null; timing: number | null; priority: number | null;
    expected_value: string | null; deal: string | null; stage: string | null; amount: string | null;
    days_since_activity: number | null;
  }>(
    `select c.legal_name                                   account,
            p.use_case                                     pursuit_use_case,
            p.current_timing_score                         timing,
            p.current_priority_score                       priority,
            p.expected_value_weighted::bigint::text        expected_value,
            o.name                                         deal,
            o.stage                                        stage,
            o.amount_usd::bigint::text                     amount,
            case when o.updated_at is null then null
                 else extract(day from now() - o.updated_at)::int end days_since_activity
       from companies c
       left join pursuits p      on p.account_id = c.id
       left join opportunities o on o.company_id = c.id
      where c.legal_name = any($1)
      -- The trailing o.name is what makes this manifest a usable gate (Wave 6D).
      --
      -- Without it the sort key is (account, amount, use_case), and Acme Robotics
      -- has TWO rows that tie on all three: "Incumbent displacement" ($540K,
      -- qualification) and "Hist · Platform standardization" ($540K, closed_won),
      -- both hanging off the same pursuit. Postgres is free to return tied rows in
      -- either order, and the digest below hashes the array IN ORDER — so the same
      -- canonical world hashed to be0da833990ce436 locally and c2dc24b781993ea8 on
      -- the hosted demo, with every tenant, figure, count and hero row byte-identical.
      -- Proven by reproducing the second digest from the first by swapping exactly
      -- those two rows.
      --
      -- A gate that returns a coin-flip between two values for identical data is
      -- worse than no gate: it trains its reader to dismiss a real mismatch. The fix
      -- belongs here rather than in the expectation — neither observed digest was
      -- "right", and adopting either would have hidden the defect.
      --
      -- o.name is chosen because it is stable, semantic, and authored by the seed.
      -- Ordering on an id would also be deterministic within one database and
      -- meaningless across rebuilds, which is the property that matters here.
      order by c.legal_name, o.amount_usd desc nulls last, p.use_case, o.name`,
    [[
      "Umbrella Health Systems", "Globex Manufacturing Inc.", "Stark Industries LLC",
      "Cyberdyne Systems", "Hooli Cloud", "Acme Robotics", "Initech Financial",
      "Initech Financial (expansion)", "Wayne Enterprises", "Soylent Foods Co.", "Tyrell Corp",
    ]]);

  /**
   * The four headline figures (Wave 6C §6), each with the query that produces
   * it. They are different measures of different things and have been mistaken
   * for each other before — a goal reading $1.25M beside a roll-up reading
   * $4.92M is not a defect, but it is only defensible if the definitions are
   * written down next to the numbers.
   */
  const figures = {
    goalTargetUsd: {
      value: await one(`select coalesce(sum(target_value),0)::bigint::text v from goals where status = 'active'`),
      meaning: "the typed target on the active goal — an intention, not a measurement",
    },
    motionLevelUsd: {
      value: await one(`select coalesce(sum(estimated_value_usd),0)::bigint::text v from revenue_motions where goal_id is not null`),
      meaning: "estimated value of the motions linked to that goal — what goal progress is computed from",
    },
    opportunityLevelUsd: {
      value: await one(
        `select coalesce(sum(o.amount_usd),0)::bigint::text v from opportunities o
           join revenue_motions m on m.id = o.motion_id
          where m.goal_id is not null and o.stage not like 'closed%'`),
      meaning: "open opportunity amount beneath those motions — the deals the goal is actually carried by",
    },
    wholeBookOpenUsd: {
      value: await one(`select coalesce(sum(amount_usd),0)::bigint::text v from opportunities where stage not like 'closed%'`),
      meaning: "every open opportunity in the tenant, goal-linked or not — what Pipeline shows",
    },
  };

  /**
   * Row counts for the material tables. A shape check, not a content check.
   *
   * A missing table THROWS rather than counting zero. The first draft of this
   * file swallowed the error and reported `value_cases: 0` and
   * `stakeholder_assertions: 0` for tables that do not exist under those names —
   * a manifest that quietly says "there is none of this" when it means "I asked
   * the wrong question" is worse than no manifest, because it reads as a finding.
   */
  const counts: Record<string, number> = {};
  for (const t of [
    "organizations", "companies", "pursuits", "partners", "opportunities", "revenue_motions",
    "goals", "taxonomy_nodes", "evidence", "facts", "signals", "propensity_scores",
    "stakeholders", "opportunity_meddpicc", "ask_exchanges",
  ]) {
    counts[t] = await one(`select count(*)::text v from ${t}`);
  }

  // SPLIT AT THE SOURCE. `days_since_activity` is lifted out of each hero row into the
  // observational block, so the stable world cannot silently contain a clock reading.
  const stableHeroes = heroes.map(({ days_since_activity: _drop, ...rest }) => rest);
  const observational = {
    daysSinceActivity: heroes.map((h) => ({ account: h.account, deal: h.deal, days: h.days_since_activity })),
  };

  const stableWorld = { tenants, heroes: stableHeroes, figures, counts };
  const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
  const stableDigest = sha(stableWorld);
  const observationalDigest = sha({ ...stableWorld, observational });

  return {
    generator: "scripts/demo-manifest.ts",
    // `digest` stays the name every existing caller uses, and now means the STABLE one.
    digest: stableDigest,
    stableDigest,
    observationalDigest,
    observedAt: new Date().toISOString(),
    ...stableWorld,
    observational,
  };
}

const manifest = await build().finally(() => pool.end());
const mode = process.argv.find((a) => a.startsWith("--digest"));
console.log(
  mode === "--digest=observational" ? manifest.observationalDigest
  : mode ? manifest.stableDigest
  : JSON.stringify(manifest, null, 2),
);
