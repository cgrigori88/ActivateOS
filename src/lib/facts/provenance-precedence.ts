/**
 * Canonical provenance precedence for SOURCE-TRUTH selection (D-G8-4A).
 *
 * WHY THIS EXISTS. Two orderings over `facts.provenance_class` already lived in the codebase and
 * they disagree:
 *
 *   PROVENANCE_STRENGTH (context-health)  FIRST_PARTY 1.0 > CUSTOMER_DECLARED .95 >
 *                                         THIRD_PARTY_VERIFIED .85 > HUMAN_ASSERTED = SECOND_PARTY .70 >
 *                                         THIRD_PARTY_UNVERIFIED .45 > INFERRED .30
 *   LADDER_RANK (value/drivers)           THIRD_PARTY_VERIFIED ranks ABOVE CUSTOMER_DECLARED, and
 *                                         SECOND_PARTY above HUMAN_ASSERTED
 *
 * OWNER RULING (D-G8-4A): **PROVENANCE_STRENGTH is canonical for lifecycle / source-truth selection.**
 * LADDER_RANK is NOT replaced — it keeps serving value-driver semantics, where that ladder is
 * deliberately part of the product model. The two answer different questions and are not merged.
 *
 * The ruling therefore binds: CUSTOMER_DECLARED > THIRD_PARTY_VERIFIED, and
 * THIRD_PARTY_UNVERIFIED > INFERRED.
 *
 * HUMAN_ASSERTED and SECOND_PARTY are EQUAL under this table, and deliberately so — they are not
 * ordered against each other by any existing product semantics. When they are the last thing
 * separating two candidates, the answer is UNRESOLVED, never an invented tie-break. Callers use
 * `resolveByProvenance`, which says so explicitly rather than returning an arbitrary row.
 */

import { PROVENANCE_STRENGTH } from "@/lib/pursuits/read-models/context-health";

/** Unknown/unlisted classes sit at the unverified rung rather than winning by accident. */
export const UNKNOWN_PROVENANCE_STRENGTH = 0.45;

export function provenanceStrength(cls: string | null | undefined): number {
  if (!cls) return UNKNOWN_PROVENANCE_STRENGTH;
  return (PROVENANCE_STRENGTH as Record<string, number>)[cls] ?? UNKNOWN_PROVENANCE_STRENGTH;
}

/** Descending precedence: the stronger provenance sorts first. 0 means "equal, not comparable". */
export function compareProvenance(a: string | null | undefined, b: string | null | undefined): number {
  return provenanceStrength(b) - provenanceStrength(a);
}

export type Resolution<T> =
  | { kind: "RESOLVED"; value: T }
  | { kind: "NONE" }
  /** Two or more candidates the existing semantics cannot separate AND which differ in output. */
  | { kind: "UNRESOLVED"; tied: T[] };

/**
 * Pick the single candidate the ordering selects, or say it cannot be decided.
 *
 * `compare` must encode the EXISTING business semantics in priority order. Whatever survives at the
 * top as a tie is then judged by `sameOutput`: candidates that would produce an identical result are
 * collapsed (a tie that changes nothing is not a disagreement), and candidates that would produce
 * different results are returned as UNRESOLVED. No id, name, length or row-order fallback exists
 * here, which is the whole point.
 */
export function resolveTie<T>(
  candidates: readonly T[],
  compare: (a: T, b: T) => number,
  sameOutput: (a: T, b: T) => boolean,
): Resolution<T> {
  if (candidates.length === 0) return { kind: "NONE" };
  const sorted = [...candidates].sort(compare);
  const top = sorted.filter((c) => compare(sorted[0], c) === 0 && compare(c, sorted[0]) === 0);
  if (top.length === 1) return { kind: "RESOLVED", value: top[0] };
  const collapses = top.every((c) => sameOutput(top[0], c));
  return collapses ? { kind: "RESOLVED", value: top[0] } : { kind: "UNRESOLVED", tied: top };
}
