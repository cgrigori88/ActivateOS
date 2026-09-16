/**
 * Allowlist for scripts/ordering-scan.ts — part of the scanner CONFIG, versioned with it.
 *
 * The scanner is deliberately mechanical: it cannot tell "membership under a cap" from "display-only", nor
 * that a column carries a unique constraint it cannot see. So every match it raises must end in one of two
 * places — FIXED in the product, or listed HERE with a reason. That is what makes a reported zero mean
 * something: the zero is relative to this file, and this file is reviewable.
 *
 * RULES FOR ADDING AN ENTRY. Each needs a reason that is checkable by someone else, and must be one of:
 *   - UNIQUE-BY-SCHEMA: the terminal ORDER BY column carries a unique constraint or is the group key, with
 *     the migration cited. (The scanner only recognises id-shaped names.)
 *   - ORDER-IRRELEVANT: the result is consumed as a set, a sum, a count or a keyed lookup, never by position.
 *   - CLASSIFIED: recorded under another defect class (D-G8-2B display-only, D-G8-3 persisted,
 *     D-G8-4 semantic, D-G8-5 migration-gated) and tracked there.
 *
 * NEVER add an entry merely to reach zero. An unexplained tie is a defect, not an exception.
 */

export interface Allow {
  /** Repo-relative path, exactly as it appears in the frozen closure manifest. */
  file: string;
  /** Substring of the flagged clause that identifies the site. */
  match: string;
  /** Why this is not a defect. Must be checkable by a reviewer. */
  reason: string;
}

export const ALLOWLIST: Allow[] = [
  {
    file: "src/app/pipeline/page.tsx",
    match: "taken_on desc",
    reason: "UNIQUE-BY-SCHEMA: pipeline_snapshots PRIMARY KEY (org_id, taken_on) — supabase/migrations/0050. "
      + "org_id is fixed by the predicate, so taken_on alone is unique. Also D-P1's table: not to be touched here.",
  },
  {
    file: "src/app/trust/page.tsx",
    match: "count(*) desc, model",
    reason: "UNIQUE-BY-SCHEMA: `model` is the GROUP BY key of this aggregate, so it is unique per returned "
      + "row and the order is already total. Flagged only because the scanner recognises id-shaped names.",
  },
  {
    file: "src/lib/pursuits/read-models/detail.ts",
    match: "rsc.rank",
    reason: "UNIQUE-BY-SCHEMA: route_seller_candidates.rank is assigned uniquely per (org_id, pursuit_id), "
      + "and the query fixes pursuit_id, so rank alone is a total order over the returned rows.",
  },
  {
    file: "src/lib/facts/predicates.ts",
    match: "predicate_key, version desc",
    reason: "UNIQUE-BY-SCHEMA: (predicate_key, version) identifies one row, so the DISTINCT ON pick is "
      + "already determined; no further key exists to add.",
  },
  {
    file: "src/lib/search/query.ts",
    match: "contribution desc nulls last, feature",
    reason: "UNIQUE-BY-SCHEMA: score_features PRIMARY KEY (score_id, feature); the query fixes score_id "
      + "(`where score_id = $1`), so `feature` completes the key and the order is total.",
  },
  {
    file: "src/lib/value/intents.ts",
    match: "(capped, no ORDER BY)",
    reason: "ORDER-IRRELEVANT: `select 1 from pursuits … limit 1` is an existence probe — its result is read "
      + "only as `rows.length > 0`, to tell 'outside scope' from 'does not exist'. It returns a constant, "
      + "never a row, so no ordering is observable.",
  },
  {
    file: "src/lib/opportunities/autopsy.ts",
    match: "count(*) desc, source_type",
    reason: "UNIQUE-BY-SCHEMA: `source_type` is the GROUP BY key of this aggregate, so it is unique per "
      + "returned row and the order is already total (same shape as trust/page.tsx).",
  },
  {
    file: "src/lib/pursuits/federation/skills.ts",
    match: "b.version - a.version",
    reason: "ORDER-IRRELEVANT: this sorts the in-memory SKILL_REGISTRY, not a query result. `version` is "
      + "unique per skillId in the code registry, so the highest-version pick cannot tie.",
  },
  {
    file: "src/lib/motions/funnel.ts",
    match: "pr.strength desc",
    reason: "ORDER-IRRELEVANT: array_agg over relationship STRENGTH VALUES, read positionally to rank the "
      + "values themselves; tied entries are identical numbers, so their order is unobservable.",
  },
];
