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
}

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
  { name: "lifecycle-acceptance", cls: "SEEDED", why: "walks the canonical lifecycle acceptance path" },
  { name: "value-case", cls: "SEEDED", why: "reads canonical value cases and their bands" },
  { name: "stakeholder-intel", cls: "SEEDED", why: "reads canonical stakeholder assertions" },
  { name: "partner-intel", cls: "SEEDED", why: "reads canonical partner activation history" },
  { name: "outcome-bridge", cls: "SEEDED", why: "bridges canonical opportunities to pursuit outcomes" },
  { name: "motion-intel", cls: "SEEDED", why: "reads canonical motions and their briefs" },
  { name: "closed-loop", cls: "SEEDED", why: "walks the canonical demo loop end to end" },

  // ── EITHER: run-scoped fixtures (per-run ids), no reliance on demo content.
  { name: "append-only", cls: "EITHER", why: "run-scoped fixtures; asserts ledger immutability" },
  { name: "canonical-microloop", cls: "EITHER", why: "run-scoped fixtures" },
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
  { name: "route-persistence", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "scope", cls: "EITHER", why: "run-scoped fixtures; asserts scope predicates" },
  { name: "team-motion", cls: "EITHER", why: "run-scoped fixtures" },
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
