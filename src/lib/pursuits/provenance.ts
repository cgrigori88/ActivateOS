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
