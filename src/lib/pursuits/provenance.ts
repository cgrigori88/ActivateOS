import type { PoolClient } from "pg";
import { DATA_ENVIRONMENTS, type DataEnvironment } from "./lineage";

/**
 * TRUSTED PROVENANCE RESOLUTION — the one place a write learns what kind of data it is producing.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *
 * Provenance is OBSERVED, never assumed. There are exactly two legitimate sources:
 *
 *   SUBJECT-SCOPED   the write belongs to a canonical row that already carries `data_environment`
 *                    (a pursuit, today). Read it server-side, under the caller's org.
 *   CREDENTIAL-SCOPED the write arrives over a credential, which is the only thing an external
 *                    caller cannot choose. See `resolveKey` and migration 0120.
 *
 * And exactly one illegitimate source, which this module exists to abolish: `?? "PRODUCTION"`. A
 * server that invents provenance when it does not know it will invent the most damaging possible
 * value, because PRODUCTION is the sole learning-eligible environment. That is not hypothetical —
 * it produced 18 mislabelled invocations and two mislabelled ledger rows on a hosted project whose
 * every pursuit is DEMO.
 *
 * ── WHY THIS RETURNS `null` RATHER THAN A DEFAULT ───────────────────────────────────────────────
 *
 * "I do not know" is a real answer and the caller must handle it, by refusing. Five server actions
 * had each copy-pasted the same query with the same `?? "PRODUCTION"` tail, which is how a default
 * spreads: once written it looks like the house style. One function, one answer, no tail.
 */

/** The subject's own environment, or null when there is no such subject in this org. */
export async function pursuitEnvironment(
  db: PoolClient, orgId: string, pursuitId: string,
): Promise<DataEnvironment | null> {
  const { rows } = await db.query<{ data_environment: string }>(
    `select data_environment from pursuits where id = $1 and org_id = $2`, [pursuitId, orgId]);
  return asDataEnvironment(rows[0]?.data_environment);
}

/** The environment of the pursuit an opportunity belongs to, or null when it belongs to none. */
export async function opportunityEnvironment(
  db: PoolClient, orgId: string, opportunityId: string,
): Promise<DataEnvironment | null> {
  const { rows } = await db.query<{ data_environment: string | null }>(
    `select pu.data_environment
       from opportunities o
       join pursuits pu on pu.id = o.pursuit_id and pu.org_id = o.org_id
      where o.id = $1 and o.org_id = $2`, [opportunityId, orgId]);
  return asDataEnvironment(rows[0]?.data_environment ?? undefined);
}

/**
 * Narrow a stored string to the vocabulary, or null.
 *
 * A value outside `DATA_ENVIRONMENTS` is NOT coerced to anything — it is unknown, and unknown is
 * refused upstream. Casting it would let an unrecognised label pass as whatever the cast claimed.
 */
export function asDataEnvironment(value: string | null | undefined): DataEnvironment | null {
  if (!value) return null;
  return (DATA_ENVIRONMENTS as string[]).includes(value) ? (value as DataEnvironment) : null;
}

/** The refusal a surface shows when a write cannot establish where its data comes from. */
export const PROVENANCE_UNRESOLVED =
  "That action could not be recorded: its data provenance could not be established.";

// ---------------------------------------------------------------------------
// Canonical subject origin provenance, from intake creation lineage.
// ---------------------------------------------------------------------------

/**
 * TWO DIFFERENT QUESTIONS THAT MUST NEVER BE COLLAPSED.
 *
 *   BATCH / EFFECT PROVENANCE — "in what environment did this import happen?"
 *     `import_batches.data_environment`, copied onto each `import_batch_effects` row. It is a fact
 *     about an ACTIVITY, and it stays true forever.
 *
 *   SUBJECT ORIGIN PROVENANCE — "what kind of thing is this row?"
 *     A fact about the SUBJECT, fixed at the moment it came into existence.
 *
 * They legitimately disagree. A PILOT batch that matches a DEMO opportunity has PILOT effect
 * provenance and leaves the subject DEMO, and both statements are true at once.
 *
 * ── ORIGIN IS THE CREATION EVENT. IT IS NOT THE LATEST TOUCH. ───────────────────────────────────
 *
 * "Whichever batch touched it most recently" is the natural implementation and it is wrong: it would
 * let a later CERTIFICATION batch that merely referenced an opportunity relabel it, and it would let
 * a PILOT batch promote a DEMO subject by matching it. So this reads ONLY effects that record a
 * creation, and a subject with no creation event has NO origin provenance — not PRODUCTION, and not
 * the environment of whatever happened to it afterwards.
 *
 * ── MORE THAN ONE CREATION EVENT IS AN INVARIANT DEFECT, NOT A TIE TO BREAK ─────────────────────
 *
 * A canonical subject comes into existence once. If two creation effects name the same subject, the
 * lineage is wrong, and choosing between them by timestamp would bury that — so this REFUSES and
 * says so. Two such cases were found and fixed while writing it (`partner_accounts` re-recording
 * CREATED on re-import because the upsert had just set the column the test read, and
 * `population_member` effects keyed on the population rather than on a member identity).
 */
export type OriginProvenance =
  | { status: "ESTABLISHED"; environment: DataEnvironment; batchId: string }
  /** No creation event: the subject was not created by intake, or predates the lineage. */
  | { status: "UNESTABLISHED" }
  /** The lineage says the subject was created more than once. Refused, never resolved. */
  | { status: "AMBIGUOUS"; creations: number };

/** The subject kinds intake creation lineage can speak about. */
export type OriginSubjectKind =
  | "contact" | "opportunity" | "crm_snapshot" | "evidence" | "partner_account" | "account_population";

export async function subjectOriginProvenance(
  db: PoolClient, orgId: string, kind: OriginSubjectKind, subjectId: string,
): Promise<OriginProvenance> {
  // ORG-SCOPED, ALWAYS. `import_batch_effects` is org-scoped under FORCEd RLS, and the predicate is
  // restated here on top of it: another tenant's lineage can neither supply provenance to this org
  // nor be discovered through this call.
  const { rows } = await db.query<{ data_environment: string | null; batch_id: string }>(
    `select e.data_environment, e.batch_id
       from import_batch_effects e
      where e.org_id = $1 and e.subject_kind = $2 and e.subject_id = $3
        and e.effect = 'CREATED_REVERSIBLE'`,
    [orgId, kind, subjectId]);
  if (rows.length === 0) return { status: "UNESTABLISHED" };
  if (rows.length > 1) return { status: "AMBIGUOUS", creations: rows.length };
  const env = asDataEnvironment(rows[0].data_environment);
  // A creation event whose batch itself had no provenance establishes nothing. It is not an error,
  // and it is certainly not PRODUCTION.
  return env ? { status: "ESTABLISHED", environment: env, batchId: rows[0].batch_id } : { status: "UNESTABLISHED" };
}

/**
 * The environment of an opportunity, for a write that has to label itself.
 *
 * ORDER MATTERS, AND IT IS NOT A FALLBACK CHAIN OF CONVENIENCE.
 *
 *   1. THE PURSUIT, where one exists. A pursuit is the canonical commercial subject and carries its
 *      own `data_environment`; this is the path Slice 1 established and it is unchanged.
 *   2. INTAKE CREATION LINEAGE, where the opportunity was created by an import and has no pursuit.
 *      This is the gap Slice 1 named and deferred: such an opportunity had no trustworthy
 *      provenance, so its lifecycle events were skipped entirely.
 *   3. NOTHING. Not PRODUCTION. A caller that cannot establish provenance declines to write the
 *      evidentiary row, exactly as it did before — refusing to label is honest; labelling it as the
 *      one learning-eligible environment is not.
 */
export async function opportunityOriginEnvironment(
  db: PoolClient, orgId: string, opportunityId: string, pursuitId: string | null,
): Promise<DataEnvironment | null> {
  if (pursuitId) {
    const fromPursuit = await pursuitEnvironment(db, orgId, pursuitId);
    if (fromPursuit) return fromPursuit;
  }
  const origin = await subjectOriginProvenance(db, orgId, "opportunity", opportunityId);
  return origin.status === "ESTABLISHED" ? origin.environment : null;
}
