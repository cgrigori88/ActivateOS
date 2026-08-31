/**
 * The reseed guard.
 *
 * §8 of the topology brief: "Build guardrails that make accidental
 * cross-environment reseeding difficult or impossible."
 *
 * The threat is mundane and therefore likely: an operator who ran a production
 * task ten minutes ago still has DATABASE_URL exported, then runs the demo
 * reseed. Nothing about that command looks wrong. The environment variable
 * cannot save them — it IS the mistake.
 *
 * So the question is asked of the database being written to, not of the process
 * asking to write. `environment_identity` (migration 0102) holds one row saying
 * what that database is. Production answers "app / not synthetic" and the guard
 * refuses.
 *
 * Fail-closed at every branch: no table, no row, wrong answer, or an error
 * reading it all mean REFUSE. The only path through is an explicit,
 * affirmatively-marked synthetic database.
 */

import type { Pool, PoolClient } from "pg";
import { databaseIdentity } from "./environment";

export type DbIdentity = {
  environment: "app" | "demo" | "local";
  isSynthetic: boolean;
  label: string;
  establishedAt: Date;
};

/** Reads the marker. Returns null when the database has no identity — which is a refusal, not a default. */
export async function readDbIdentity(db: Pool | PoolClient): Promise<DbIdentity | null> {
  try {
    const { rows } = await db.query<{
      environment: DbIdentity["environment"];
      is_synthetic: boolean;
      label: string;
      established_at: Date;
    }>(`select environment, is_synthetic, label, established_at from environment_identity limit 1`);
    if (!rows.length) return null;
    return {
      environment: rows[0].environment,
      isSynthetic: rows[0].is_synthetic,
      label: rows[0].label,
      establishedAt: rows[0].established_at,
    };
  } catch {
    // Table absent (pre-0102), unreadable, or the connection is broken. Every
    // one of those means we cannot prove this database is safe to destroy.
    return null;
  }
}

/**
 * A non-secret description of the database on the other end of THIS connection.
 * Falls back to the configured identity, then to a neutral phrase — a guard that
 * throws while composing its own error message helps nobody.
 */
async function describeConnection(db: Pool | PoolClient): Promise<string> {
  try {
    const { rows } = await db.query<{ db: string; addr: string | null; usr: string }>(
      `select current_database() as db, inet_server_addr()::text as addr, current_user as usr`,
    );
    const r = rows[0];
    // current_user is included because on Supabase the pooled username carries
    // the project ref (postgres.<ref>), which identifies the project exactly.
    return `database "${r.db}" as "${r.usr}"${r.addr ? ` on ${r.addr}` : ""}`;
  } catch {
    const { projectRef, host } = databaseIdentity();
    if (projectRef) return `project ${projectRef}`;
    if (host) return `host ${host}`;
    return "the configured database";
  }
}

export class CrossEnvironmentWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossEnvironmentWriteError";
  }
}

/**
 * Throws unless the connected database is affirmatively marked synthetic.
 *
 * Call this at the TOP of anything that destroys or wholesale-rewrites data —
 * before the first DELETE, not after a partial truncate. `operation` is quoted
 * back in the error so the message names what was about to happen.
 */
export async function assertSyntheticDatabase(db: Pool | PoolClient, operation: string): Promise<DbIdentity> {
  // Names the actual target, so an operator who misfired can see WHICH database
  // they nearly wrote to. Asked of the CONNECTION, not of process.env: the demo
  // scripts connect via DEMO_URL while databaseIdentity() reads DATABASE_URL, so
  // trusting the environment here would print the name of a database this call
  // never touched — the single most misleading thing this message could do.
  const target = await describeConnection(db);

  const identity = await readDbIdentity(db);

  if (!identity) {
    throw new CrossEnvironmentWriteError(
      `REFUSED: ${operation} against ${target}.\n` +
        `This database has no environment_identity row, so it cannot be proven synthetic.\n` +
        `If it really is a demo database, mark it first:\n` +
        `  npx tsx scripts/environment-identity.ts --set demo --label "<what this is>"\n` +
        `If you did not expect to be pointed at ${target}, check DATABASE_URL.`,
    );
  }

  if (!identity.isSynthetic) {
    throw new CrossEnvironmentWriteError(
      `REFUSED: ${operation} against ${target}.\n` +
        `That database is marked environment="${identity.environment}" with is_synthetic=false` +
        `${identity.label ? ` (${identity.label})` : ""}.\n` +
        `It holds real data. Nothing was written.`,
    );
  }

  return identity;
}
