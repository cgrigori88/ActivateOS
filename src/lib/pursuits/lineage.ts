/**
 * Data lineage / synthetic isolation (Workstream A, §29). Demo/simulated rows must
 * never contaminate learning, calibration, source-predictive-value, or benchmarks.
 * The enum is extensible; learning-eligibility is an explicit allow-list, NOT a
 * "not demo" negation — safer as new classes (BACKTEST, TEST, …) appear.
 */

export type DataEnvironment =
  | "PRODUCTION"
  | "PILOT"
  | "CERTIFICATION"
  | "DEMO"
  | "TEST"
  | "SYNTHETIC"
  | "SIMULATION"
  | "BACKTEST";

export const DATA_ENVIRONMENTS: DataEnvironment[] = [
  "PRODUCTION",
  "PILOT",
  "CERTIFICATION",
  "DEMO",
  "TEST",
  "SYNTHETIC",
  "SIMULATION",
  "BACKTEST",
];

/**
 * Environments whose rows may feed model learning / calibration / benchmarks.
 *
 * **PILOT IS DELIBERATELY ABSENT, AND THAT IS THE POINT.** Pilot activity is real, but
 * "this really happened" and "this may train something" are SEPARATE DIMENSIONS. Whether pilot
 * evidence may enter a corpus is a later P8 corpus/label determination — it is not a consequence
 * of the activity being genuine, and it must never be granted by default. CERTIFICATION and DEMO
 * are never eligible under any determination.
 */
export const LEARNING_ELIGIBLE_ENVIRONMENTS: DataEnvironment[] = ["PRODUCTION"];

/**
 * Environments that record REAL-WORLD ACTIVITY, whatever their training eligibility.
 *
 * This is the provenance question — "did a person actually do this in the world?" — and it is the
 * one a pilot report, an executive rollup or an operational audit should ask. It is NOT a licence
 * to train: see LEARNING_ELIGIBLE_ENVIRONMENTS, which answers a different question and is allowed
 * to disagree with this list.
 */
export const REAL_WORLD_ENVIRONMENTS: DataEnvironment[] = ["PRODUCTION", "PILOT"];

/** A SQL fragment restricting a query to real-world provenance. Never a training filter. */
export function realWorldSql(column = "data_environment"): string {
  return `${column} in (${REAL_WORLD_ENVIRONMENTS.map((e) => `'${e}'`).join(", ")})`;
}

export function isRealWorldEvidence(env: DataEnvironment): boolean {
  return REAL_WORLD_ENVIRONMENTS.includes(env);
}

export type DataLineage =
  | "VERIFIED_PUBLIC"
  | "AUTHORIZED_FIRST_PARTY"
  | "SIMULATED"
  | "SYNTHETIC";

/**
 * A SQL fragment restricting a query to learning-eligible rows. Pass the aliased
 * column (e.g. "p.data_environment"). Use in Insights/calibration/backtest reads so
 * no query forgets. Explicit allow-list, per §29.
 */
export function learningEligibleSql(column = "data_environment"): string {
  const list = LEARNING_ELIGIBLE_ENVIRONMENTS.map((e) => `'${e}'`).join(", ");
  return `${column} in (${list})`;
}

export function isLearningEligible(env: DataEnvironment): boolean {
  return LEARNING_ELIGIBLE_ENVIRONMENTS.includes(env);
}
