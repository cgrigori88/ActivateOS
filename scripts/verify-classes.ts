/**
 * The verifier environment contract (Wave 6B §8).
 *
 * WHAT WAS WRONG. The battery silently mixed two incompatible database
 * assumptions and named neither of them. Some suites seed their own fixtures,
 * COMMIT them, and use hard-coded values on uniquely-constrained columns — they
 * need a disposable database and are not idempotent. Others read the canonical
 * synthetic demo world and fail on a bare migrated database. Running the whole
 * battery against one database therefore could not be green, ever, and the only
 * symptom anyone saw was a NOT NULL violation on `taxonomy_nodes.slug` — the
 * first constraint the fixtures happened to hit.
 *
 * Worse than the noise: a developer pointing the fresh-database suites at the
 * demo database writes committed fixture rows into the demo world. That is how
 * the stray `Tenant A` orgs and `E3*` taxonomy nodes got into it.
 *
 * This file is the single source of truth for which suite needs what. It is
 * data, not policy — `scripts/verify-run.ts` executes it, and `verify-guard.ts`
 * enforces it at the point of connection.
 */

export type VerifyClass = "FRESH" | "SEEDED" | "EITHER" | "DEPLOYMENT_ONLY";

export interface SuiteSpec {
  /** Script basename without `-verify.ts`. */
  name: string;
  cls: VerifyClass;
  /** Why it is in this class — read by the runner's `--explain`. */
  why: string;
  /**
   * Deployment master switches this suite requires (Wave 6C §3).
   *
   * Feature flags here are TWO-layer — an environment master switch AND a
   * per-org `org_features` row — and they COMPOSE: `outcomeLearning` is
   * `experience && outcome_learning`, and `experience` is
   * `pursuits && facts && routing && pursuit_experience` (tenant-flags.ts:61-64).
   * So a suite exercising the outcome bridge needs FIVE switches, not one.
   *
   * These are declared PER SUITE and never globally, because they are not
   * interchangeable: `routes-verify` asserts that `routingEnabled()` is false
   * by default, so setting ROUTING_ENABLED for everything would break it for
   * a reason that has nothing to do with routing.
   */
  env?: Record<string, string>;
}

/** The full experience chain plus outcome learning — see SuiteSpec.env. */
const OUTCOME_LEARNING_ENV: Record<string, string> = {
  PURSUITS_ENABLED: "true",
  FACTS_ENABLED: "true",
  ROUTING_ENABLED: "true",
  PURSUIT_EXPERIENCE_ENABLED: "true",
  OUTCOME_LEARNING_ENABLED: "true",
};

export const SUITES: SuiteSpec[] = [
  // ── FRESH: seeds and COMMITS its own fixtures; not idempotent; destructive
  //    if pointed at a persistent world.
  { name: "pursuit", cls: "FRESH", why: "commits two-tenant fixtures; asserts on their exact ids" },
  { name: "routes", cls: "FRESH", why: "commits partner/seller/alias fixtures; entity resolution asserts a unique match" },
  { name: "experience", cls: "FRESH", why: "commits two-tenant fixtures and asserts disclosure over them" },
  { name: "facts", cls: "FRESH", why: "commits evidence/signal fixtures; asserts verification-state transitions" },
  { name: "governance", cls: "FRESH", why: "commits cross-tenant grant fixtures; asserts action authority" },

  // ── SEEDED: reads the canonical synthetic demo world; nothing to read on a
  //    bare migrated database.
  { name: "interpret", cls: "SEEDED", why: "resolves Ask intents against canonical demo accounts" },
  { name: "lifecycle-query", cls: "SEEDED", why: "queries the canonical lifecycle projections" },
  { name: "lifecycle-acceptance", cls: "SEEDED", why: "walks the canonical lifecycle acceptance path", env: OUTCOME_LEARNING_ENV },
  { name: "value-case", cls: "SEEDED", why: "reads canonical value cases and their bands" },
  { name: "stakeholder-intel", cls: "SEEDED", why: "reads canonical stakeholder assertions" },
  { name: "partner-intel", cls: "SEEDED", why: "reads canonical partner activation history" },
  { name: "outcome-bridge", cls: "SEEDED", why: "bridges canonical opportunities to pursuit outcomes", env: OUTCOME_LEARNING_ENV },
  { name: "motion-intel", cls: "SEEDED", why: "reads canonical motions and their briefs" },

  // These five were labelled EITHER and are not: each opens with an unqualified
  // `select ... limit 1` over a table it never wrote — `organizations`,
  // `change_ledger`, `pursuits`, `revenue_motions` — and then asserts against
  // whatever came back. On a disposable database that row does not exist and the
  // suite dies before its first assertion (Wave 6C §3). Two consequences worth
  // naming rather than hiding: they belong to SEEDED, and their "whatever is
  // first" reads are why accreted fixtures could change their verdicts without
  // anyone touching them. Tightening those reads is real work and is NOT done
  // here — Wave 6C classifies; it does not rewrite suites to be green.
  { name: "append-only", cls: "SEEDED", why: "reads the first existing ledger/override/invocation row; nothing to read on a bare database" },
  { name: "canonical-microloop", cls: "SEEDED", why: "reads a canonical pursuit with >=2 signals and a second existing org" },
  { name: "route-persistence", cls: "SEEDED", why: "reads a canonical pursuit with >=2 signals and its recorded route history" },
  { name: "scope", cls: "SEEDED", why: "reads the oldest existing organization; fails with 'no org' on a bare database" },
  { name: "team-motion", cls: "SEEDED", why: "reads a canonical routed pursuit and an existing draft motion" },

  // ── EITHER: run-scoped fixtures (per-run ids), no reliance on demo content.
  //    Because they need nothing from the demo world, they are given a disposable
  //    database — see verify-run.ts. Writing them into the canonical world was
  //    how it accreted state nobody had authored (Wave 6C §4).
  {
    name: "closed-loop",
    cls: "EITHER",
    why: "run-scoped fixtures; walks the whole loop over a world it builds itself",
  },
  { name: "contributions", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "disclosure", cls: "EITHER", why: "run-scoped fixtures; asserts the disclosure ladder" },
  { name: "entity-resolution", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "federation", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "governed-mutation", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "isolation", cls: "EITHER", why: "run-scoped fixtures; asserts tenant isolation" },
  { name: "observability", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "ops", cls: "EITHER", why: "reads process/registry state only" },
  { name: "outbox", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "outcomes", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "recompute", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "recompute-recovery", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "tenant-flags", cls: "EITHER", why: "run-scoped fixtures" },

  // ── DEPLOYMENT_ONLY: needs an environment this container cannot provide.
  {
    name: "migrations-only",
    cls: "DEPLOYMENT_ONLY",
    why: "asserts that a database built by migrations ALONE (no bootstrap, no seed) is complete — it must connect to a separately provisioned migrations-only instance, by design",
  },
];

export function suitesFor(cls: VerifyClass | "ALL"): SuiteSpec[] {
  return cls === "ALL" ? SUITES : SUITES.filter((s) => s.cls === cls);
}

export function specFor(name: string): SuiteSpec | undefined {
  return SUITES.find((s) => s.name === name);
}
