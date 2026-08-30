/**
 * Data lineage / synthetic isolation (Workstream A, §29). Demo/simulated rows must
 * never contaminate learning, calibration, source-predictive-value, or benchmarks.
 * The enum is extensible; learning-eligibility is an explicit allow-list, NOT a
 * "not demo" negation — safer as new classes (BACKTEST, TEST, …) appear.
 */

export type DataEnvironment =
  | "PRODUCTION"
  | "DEMO"
  | "TEST"
  | "SYNTHETIC"
  | "SIMULATION"
  | "BACKTEST";

export const DATA_ENVIRONMENTS: DataEnvironment[] = [
  "PRODUCTION",
  "DEMO",
  "TEST",
  "SYNTHETIC",
  "SIMULATION",
  "BACKTEST",
];

/** Environments whose rows may feed model learning / calibration / benchmarks. */
export const LEARNING_ELIGIBLE_ENVIRONMENTS: DataEnvironment[] = ["PRODUCTION"];

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
