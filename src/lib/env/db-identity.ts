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

/**
 * The three distinguishable outcomes of asking a database what it is.
 *
 * `unreadable` exists because collapsing it into `absent` produces a confident
 * lie: a wrong password would report "this database has no identity", which
 * reads as a fact about the database when it is actually a fact about the
 * connection. Both still refuse — but an operator who is told the truth fixes
 * their connection string in seconds, and one who is told the marker is missing
 * goes looking for it in the wrong place.
 */
export type IdentityRead =
  | { status: "found"; identity: DbIdentity }
  | { status: "absent" }
  | { status: "unreadable"; reason: string };

export async function readDbIdentity(db: Pool | PoolClient): Promise<IdentityRead> {
  try {
    const { rows } = await db.query<{
      environment: DbIdentity["environment"];
      is_synthetic: boolean;
      label: string;
      established_at: Date;
    }>(`select environment, is_synthetic, label, established_at from environment_identity limit 1`);
    if (!rows.length) return { status: "absent" };
    return {
      status: "found",
      identity: {
        environment: rows[0].environment,
        isSynthetic: rows[0].is_synthetic,
        label: rows[0].label,
        establishedAt: rows[0].established_at,
      },
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // 42P01 = undefined_table: reached the database, but 0102 has not been
    // applied. That IS a fact about the database, so it counts as absent.
    if (err.code === "42P01") return { status: "absent" };
    return { status: "unreadable", reason: err.message ?? String(e) };
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

  const read = await readDbIdentity(db);

  if (read.status === "unreadable") {
    throw new CrossEnvironmentWriteError(
      `REFUSED: ${operation} against ${target}.\n` +
        `Could not read this database's identity, so nothing about it can be trusted:\n` +
        `  ${read.reason}\n` +
        `This is a CONNECTION problem, not a missing marker — check DATABASE_URL, and in\n` +
        `particular that the password placeholder was actually replaced.`,
    );
  }

  if (read.status === "absent") {
    throw new CrossEnvironmentWriteError(
      `REFUSED: ${operation} against ${target}.\n` +
        `This database has no environment_identity row, so it cannot be proven synthetic.\n` +
        `If it really is a demo database, mark it first:\n` +
        `  npx tsx scripts/environment-identity.ts --set demo --label "<what this is>"\n` +
        `If you did not expect to be pointed at ${target}, check DATABASE_URL.`,
    );
  }

  const identity = read.identity;
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
