import type { GovernedRow, PursuitQuery } from "./types";

/**
 * D-P7-COHORT-COMPLETENESS — THE COMPLETE GOVERNED COHORT, AND WHY IT IS ITS OWN TYPE.
 *
 * > **A presentation/cardinality limit may constrain returned rows; it may never silently constrain
 * > the aggregate's semantic member set.**
 *
 * Slice 3 defined the cohort as `{subjectClass, scope, filters}` — the question — and ruled that an
 * aggregate is computed only when EVERY member of that cohort has a disclosable contribution. The
 * implementation then handed `analyze()` the *presentation* rows: candidates were governed in full,
 * ordered by `updated_at`, sliced to `plan.limit`, and the slice became the membership. Three things
 * followed, all measured before this correction:
 *
 *   - a 212-member governed cohort reported `basis.members: 200`;
 *   - omissions outside the slice vanished from the result entirely;
 *   - a member whose contribution governance had refused could be pushed out of the slice by newer,
 *     unrelated, fully-disclosable rows — and the same semantic request then returned **DISCLOSED**
 *     where it had returned **WITHHELD**, with nothing about that member changed.
 *
 * The last one is the reason this is a type and not a comment. Withhold-whole is a governance rule;
 * a rule that a row count can defeat is not a rule. So membership becomes something that only a
 * completed governance pass can produce:
 *
 *   - the brand is a MODULE-PRIVATE symbol, so `{ plan, members }` neither type-checks nor exists —
 *     the same device `ExecutionPrincipal` uses to stop a transport from asserting authority;
 *   - and the seal VALIDATES rather than merely stamping: it refuses unless the governed members are
 *     exactly the candidate set, one member per candidate. A slice cannot be relabelled as complete,
 *     because a slice is missing candidates it claims to cover.
 *
 * `analyze()` accepts nothing else. There is no overload that takes a `GovernedResultSet`, so the
 * defect this file exists to close cannot be reintroduced by a caller reaching for the nearest
 * argument to hand.
 */

/** The brand. Module-private, so completeness cannot be asserted from outside this file. */
const COMPLETE_COHORT = Symbol("p7.complete-governed-cohort");

/**
 * The objects this module actually sealed.
 *
 * The brand alone is a TYPE-level boundary, and it is not enough at runtime: object spread copies
 * symbol-keyed properties, so `{ ...cohort, members: page }` would carry the brand while carrying a
 * different membership. Identity cannot be copied that way — a clone is a different object and is
 * simply not in this set. (`db-posture.ts` certifies pools with the same device.)
 */
const SEALED = new WeakSet<object>();

/**
 * The full post-governance membership of one plan's cohort — every candidate that survived
 * discovery, scope and governance, in candidate order, with no limit applied.
 *
 * It is NOT a result set: it carries no `omissions`, no `counts`, no ordering guarantee and nothing
 * presentational. Those belong to what a renderer receives, and keeping them out is what stops the
 * two ideas from drifting back together.
 */
export interface CompleteGovernedCohort {
  readonly [COMPLETE_COHORT]: true;
  /** The plan whose cohort this is — the aggregate reads its definition and its metrics from here. */
  readonly plan: PursuitQuery;
  /** Every governed member. Frozen, and a copy: ordering the presentation rows cannot mutate it. */
  readonly members: readonly GovernedRow[];
  /** The database transaction instant this membership was established at (D-P6-1). */
  readonly computedAt: string;
}

/**
 * An internal failure, never a governed outcome.
 *
 * Failing to construct a complete cohort is a programming fault, not a disclosure decision: it is
 * not WITHHELD (governance refused nothing), not NOT_AVAILABLE (nothing about the recipient or the
 * data says so), and not a zero. It throws, so it surfaces as the existing safe FAILED behaviour at
 * the boundary rather than as a number a consumer could act on.
 */
export class IncompleteCohort extends Error {
  constructor(detail: string) {
    super(`refusing to treat an incomplete membership as a governed cohort: ${detail}`);
    this.name = "IncompleteCohort";
  }
}

/**
 * Seal a completed governance pass as the cohort.
 *
 * `candidateIds` is the evidence: the ids the canonical loader returned for this plan, before any
 * ordering or limit. The seal proves the governance loop visited all of them exactly once — that is
 * what makes this object mean "complete" rather than merely "branded".
 */
export function sealCompleteCohort(args: {
  plan: PursuitQuery;
  candidateIds: readonly string[];
  members: readonly GovernedRow[];
  computedAt: string;
}): CompleteGovernedCohort {
  const { plan, candidateIds, members, computedAt } = args;
  if (members.length !== candidateIds.length) {
    throw new IncompleteCohort(`${members.length} governed members for ${candidateIds.length} candidates`);
  }
  const governed = new Set(members.map((m) => m.objectRef.id));
  if (governed.size !== members.length) {
    throw new IncompleteCohort("the same candidate was governed more than once");
  }
  for (const id of candidateIds) {
    if (!governed.has(id)) throw new IncompleteCohort(`candidate ${id} was never governed`);
  }
  const sealed = Object.freeze({
    [COMPLETE_COHORT]: true as const,
    plan,
    members: Object.freeze([...members]),
    computedAt,
  });
  SEALED.add(sealed);
  return sealed;
}

/**
 * Is this the real thing? Identity, not shape: an object this module sealed and has not been cloned,
 * re-spread or hand-assembled from. The brand keeps the TYPE unconstructible; this keeps the VALUE
 * unforgeable.
 */
export function isCompleteCohort(value: unknown): value is CompleteGovernedCohort {
  return typeof value === "object" && value !== null && SEALED.has(value as object)
    && (value as Record<symbol, unknown>)[COMPLETE_COHORT] === true;
}
