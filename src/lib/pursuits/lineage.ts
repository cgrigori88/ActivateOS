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
 * Environments that record REAL-WORLD ACTIVITY, whatever their evidentiary or training standing.
 *
 * ── THE NAME IS THE POINT: THIS IS AN ENVIRONMENT TEST, NOT AN EVIDENCE TEST. ───────────────────
 *
 * It answers one narrow provenance question — "was this environment one in which people were
 * actually operating?" — and NOTHING else. An earlier name, `isRealWorldEvidence`, silently
 * collapsed two different claims, and the difference is not academic here:
 *
 *   · certification rows have historically been written as PRODUCTION (see
 *     `certification_exclusions`), so a real-world ENVIRONMENT label can be simply wrong;
 *   · a genuinely real-world observation can still be incomplete, unlabelled or otherwise
 *     ineligible as evidence for any particular question;
 *   · label and source eligibility remain independent determinations that this list cannot make.
 *
 * A provenance environment is therefore never, by itself, proof of evidentiary eligibility. Use
 * `learningCorpusSql` when the question is "may this row be learned from" — it composes the
 * allow-list WITH the exclusion manifest, which is the only combination that is safe to trust.
 */
export const REAL_WORLD_DATA_ENVIRONMENTS: DataEnvironment[] = ["PRODUCTION", "PILOT"];

/** A SQL fragment restricting a query to real-world provenance. Never a training filter. */
export function realWorldEnvironmentSql(column = "data_environment"): string {
  return `${column} in (${REAL_WORLD_DATA_ENVIRONMENTS.map((e) => `'${e}'`).join(", ")})`;
}

export function isRealWorldEnvironment(env: DataEnvironment): boolean {
  return REAL_WORLD_DATA_ENVIRONMENTS.includes(env);
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

// ---------------------------------------------------------------------------
// Legacy certification exclusion — the second half of eligibility.
// ---------------------------------------------------------------------------

/**
 * The subject kinds `certification_exclusions` can name.
 *
 * DELIBERATELY A CLOSED VOCABULARY, and deliberately not "any table". Each member is a structure
 * that (a) carries or inherits a `data_environment` and (b) was actually written by a certification
 * gate under a PRODUCTION label on the hosted Preview project. An unknown kind is refused by the
 * CHECK in migration 0119 rather than silently stored, because a manifest that accepts anything
 * cannot be audited.
 */
export type CertificationSubjectKind =
  | "governed_action_invocation"
  | "change_ledger"
  | "pursuit"
  | "pursuit_participant"
  | "context_contribution"
  | "context_grant"
  | "recompute_request"
  | "pursuit_override";

export const CERTIFICATION_SUBJECT_KINDS: CertificationSubjectKind[] = [
  "governed_action_invocation", "change_ledger", "pursuit", "pursuit_participant",
  "context_contribution", "context_grant", "recompute_request", "pursuit_override",
];

export interface SubjectColumns {
  /** The row's tenant column, e.g. `i.org_id`. */
  orgColumn: string;
  /** The row's identity column, e.g. `i.id`. */
  idColumn: string;
  /** The row's provenance column. Defaults to the conventional name. */
  envColumn?: string;
}

/** A SQL fragment that is TRUE when this row has been named in the exclusion manifest. */
export function certificationExcludedSql(kind: CertificationSubjectKind, cols: SubjectColumns): string {
  return `exists (select 1 from certification_exclusions cx
                   where cx.org_id = ${cols.orgColumn}
                     and cx.subject_kind = '${kind}'
                     and cx.subject_id = ${cols.idColumn})`;
}

/**
 * THE ONLY FILTER A CORPUS QUERY SHOULD USE.
 *
 * Eligibility is a CONJUNCTION of two independent facts, and either one alone is wrong:
 *
 *   `learningEligibleSql` alone   admits every legacy certification row, because those rows say
 *                                 PRODUCTION and saying PRODUCTION is exactly the defect.
 *   the exclusion manifest alone  admits DEMO, TEST and SIMULATION, which were never eligible.
 *
 * Composing them here means no caller has to remember the second half. The manifest names subjects
 * by EXACT ID — never by timestamp range, proximity, deployment guess or row count — so this
 * predicate is deterministic and reproducible against a frozen database.
 *
 * A row's historical `data_environment` is never rewritten to make this pass. The label stays as
 * written, and the exclusion is recorded beside it.
 */
export function learningCorpusSql(kind: CertificationSubjectKind, cols: SubjectColumns): string {
  const env = cols.envColumn ?? "data_environment";
  return `${learningEligibleSql(env)} and not ${certificationExcludedSql(kind, cols)}`;
}
