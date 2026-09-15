import { Pool, type PoolClient } from "pg";

/**
 * Seeded-clone isolation for verifiers that need the canonical world's CONTENT but WRITE to it
 * (H1A — certification integrity).
 *
 * THE DEFECT. Eight SEEDED verifiers (lifecycle-query, lifecycle-acceptance, partner-intel,
 * outcome-bridge, motion-intel, canonical-microloop, route-persistence, team-motion) exercise real
 * application write paths — route selection, team invites/accepts, outcome bridging, stage
 * transitions, fact sweeps — that run on their own connections and COMMIT. Run against the
 * canonical world they changed it: the whole-world fingerprint moved on every run, and Slice 2A/2B
 * verifiers then failed against a world that was no longer the certified one.
 *
 * THE CONTRACT. Such a suite never runs against the canonical world. `verify-run.ts` gives it a
 * disposable clone (`CREATE DATABASE … TEMPLATE <canonical>`), marks the clone with the table below,
 * runs the suite, and drops the clone. The suite itself refuses to run anywhere unmarked, so invoking
 * it by hand against the canonical world fails fast instead of silently mutating it.
 *
 * Override only for a database you know is disposable: SEEDED_CLONE_GUARD=off.
 */

export const SEEDED_CLONE_MARKER = "verify_seeded_clone";

export class NotASeededClone extends Error {
  constructor() {
    super(
      "Refusing to run: this suite writes through real application paths and must run on a disposable\n" +
        "  CLONE of the canonical world, never the world itself (it would commit route, team, outcome or fact\n" +
        "  changes into it). Run it with:  npx tsx scripts/verify-run.ts --suite <name>\n" +
        "  (which clones the canonical world, runs the suite on the clone, and drops the clone).\n" +
        "  To override deliberately for a database you know is disposable: SEEDED_CLONE_GUARD=off",
    );
    this.name = "NotASeededClone";
  }
}

/** Throws unless the target carries the seeded-clone marker. Call right after opening the pool. */
export async function assertSeededClone(db: Pool | PoolClient): Promise<void> {
  if ((process.env.SEEDED_CLONE_GUARD ?? "").toLowerCase() === "off") return;
  const r = await db.query<{ t: string | null }>(`select to_regclass($1)::text t`, [`public.${SEEDED_CLONE_MARKER}`]);
  if (!r.rows[0]?.t) throw new NotASeededClone();
}

/** Mark a freshly cloned database as disposable. Never call this on the canonical world. */
export async function markSeededClone(url: string, source: string): Promise<void> {
  const p = new Pool({ connectionString: url, max: 1 });
  try {
    await p.query(`create table if not exists public.${SEEDED_CLONE_MARKER} (source text not null, created_at timestamptz not null default now())`);
    await p.query(`insert into public.${SEEDED_CLONE_MARKER} (source) values ($1)`, [source]);
  } finally { await p.end(); }
}
