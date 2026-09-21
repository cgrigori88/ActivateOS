/**
 * THE MOTION TEMPLATE CONTRACT v1 (thin P9).
 *
 * ── THIS IS A NARROWING, NOT A NEW CONCEPT ──────────────────────────────────────────────────────
 *
 * `play_templates` already exists, already keys on `(slug, version)`, already carries a jsonb
 * `definition`, and is already pointed at by `revenue_motions.play_template_id`. What it did NOT
 * have was a machine-evaluable eligibility rule: the one shipped template expresses triggers as
 * `TECH_INSTALLED:virtualization` and `INFRA_MODERNIZATION_INITIATIVE`, a vocabulary that appears
 * nowhere in `fact_predicates` and that nothing in the product evaluates. It is prose for a model,
 * not a rule for a computer.
 *
 * So v1 adds ONE namespaced block, `motion_v1`, alongside the existing keys. The AI motion designer
 * keeps reading what it always read; this reads only what it can actually check.
 *
 * ── EVERY CLAUSE NAMES A CANONICAL PREDICATE THAT EXISTS ────────────────────────────────────────
 *
 * The vocabulary is `fact_predicates.key` and nothing else. A rule that cannot be expressed in
 * those keys is not written as a rule — it is declared `requiresContext`, which surfaces to the
 * reader as "we cannot tell from what we hold" rather than being invented as a signal.
 *
 * ── AND NO FIELD IS HERE FOR A FUTURE PLAYBOOK ENGINE ───────────────────────────────────────────
 *
 * Every field below is consumed by the three initial motions and by the eligibility evaluator or
 * the application path. There is no DSL, no conditional engine, no executable JSON: a clause is a
 * predicate, an operator and a value, and the operators are the four the data can answer.
 */

/** The operators the canonical fact model can actually answer. */
export type ClauseOp =
  /** A live fact with this predicate exists on the account. Absence is UNKNOWN, never false. */
  | "present"
  /** A live fact whose object_value matches one of the declared values (case-insensitive). */
  | "value_in"
  /** A live DATE fact falling within N days from the evaluation instant — forward-looking. */
  | "within_days"
  /**
   * A live fact that AFFIRMATIVELY STATES ABSENCE — `polarity = -1`, optionally naming a value.
   *
   * This exists because "we hold no fact" and "we hold a fact saying no" are different answers, and
   * only the second is evidence. A motion that needs to know something is NOT present must say so
   * with this operator; it can never be satisfied by silence.
   */
  | "absent";

export interface MotionClause {
  /** A `fact_predicates.key`. Validated against the database at load time, never assumed. */
  predicate: string;
  op: ClauseOp;
  /** For `value_in`. */
  values?: string[];
  /** For `within_days`. */
  days?: number;
  /** Shown to the reader when this clause decides the outcome. Plain commercial language. */
  because: string;
}

export interface MotionPartnerContext {
  /**
   * The account appears on a partner's book at all — partner COVERAGE, and nothing more.
   *
   * ── WHAT THIS DELIBERATELY NO LONGER MEANS ────────────────────────────────────────────────────
   *
   * An earlier version read `partner_accounts.installed = false` as whitespace. It is not.
   * That column is `NOT NULL DEFAULT false`, written as `!!get("installed_products")` and upserted
   * `installed OR excluded.installed` — so `false` means "no import row ever said the product was
   * installed", which is the ABSENCE OF A STATEMENT, not a statement of absence. Reading it as
   * whitespace inferred a commercial fact from silence, which is precisely the inversion this
   * product refuses everywhere else.
   *
   * So coverage is all this asserts. Whether the product is actually absent is a separate clause
   * that must be stated with `absent`, against real evidence.
   */
  coverage?: boolean;
}

export interface MotionTemplateV1 {
  /** The commercial objective this motion pursues, in the words a seller would use. */
  objective: string;
  /** What must be true. ALL must hold for ELIGIBLE. */
  requires: MotionClause[];
  /** Any one of these makes the motion inapplicable, whatever else is true. */
  disqualifiers?: MotionClause[];
  partnerContext?: MotionPartnerContext;
  /**
   * Things this motion would ideally qualify on that THIS PRODUCT CANNOT YET OBSERVE. Declared, not
   * invented: they are shown to the reader as missing context and they never affect the verdict.
   */
  requiresContext?: string[];
  /** The goal the resulting pursuit should carry. */
  goalTemplate: string;
  /** Role slots the motion expects. Expected participation — never a person. */
  expectedRoles?: string[];
  /** Guidance for outreach drafted under this motion. Never sent by applying it. */
  campaignGuidance?: string;
  /** What later business events would be worth associating. NEVER a causal claim. */
  measurementAssociations?: string[];
}

export interface MotionTemplate {
  slug: string;
  version: number;
  name: string;
  taxonomyNodeId: string | null;
  taxonomySlug: string | null;
  motion: MotionTemplateV1;
  /** The cadence the existing `createMotionActions` instantiates. Read, never redefined here. */
  cadence: { step: number; action: string; day: number }[];
}

/** A definition carries a thin-P9 motion only when it declares one. Older templates simply do not. */
export function motionV1Of(definition: unknown): MotionTemplateV1 | null {
  const d = definition as { motion_v1?: unknown } | null;
  if (!d || typeof d !== "object" || !d.motion_v1) return null;
  const m = d.motion_v1 as MotionTemplateV1;
  if (!m.objective || !Array.isArray(m.requires) || !m.goalTemplate) return null;
  return m;
}

/** Every predicate a template names, so a loader can prove they exist before trusting the rule. */
export function predicatesOf(m: MotionTemplateV1): string[] {
  return [...new Set([...m.requires, ...(m.disqualifiers ?? [])].map((c) => c.predicate))];
}
