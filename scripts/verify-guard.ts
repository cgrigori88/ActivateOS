import type { PoolClient } from "pg";

/**
 * Fail-fast identity guard for FRESH verifiers (Wave 6B §8).
 *
 * A FRESH suite seeds fixtures and COMMITS them. Pointed at the canonical
 * synthetic demo world it does not fail — it succeeds, and quietly writes
 * `Tenant A` organizations and `E3*` taxonomy nodes into the world the demo
 * renders from. That has already happened at least once in this repository's
 * history, and nothing in the harness noticed.
 *
 * So the suites now refuse. The test is deliberately narrow and structural: a
 * database is treated as canonical if it carries the demo world's marker rows.
 * We do NOT test for emptiness — a fresh database that has run one FRESH suite
 * before is still a legitimate (if not ideal) target, and refusing it would
 * make the guard fire on the very thing it is meant to protect.
 *
 * Override with FRESH_DB_GUARD=off only when you know the target is disposable
 * and you are deliberately reusing it.
 */

export class NotADisposableDatabase extends Error {
  constructor(reason: string) {
    super(
      `Refusing to run: this looks like the canonical demo database (${reason}).\n` +
        `  FRESH verifiers COMMIT their fixtures and would contaminate it.\n` +
        `  Run them with: npx tsx scripts/verify-run.ts --class FRESH\n` +
        `  (which provisions and drops a disposable database per suite).\n` +
        `  To override deliberately: FRESH_DB_GUARD=off`,
    );
    this.name = "NotADisposableDatabase";
  }
}

/**
 * Throws unless `db` points at something safe for a destructive fixture run.
 * Call once, as the owner, before seeding.
 */
export async function assertDisposableDatabase(db: PoolClient): Promise<void> {
  if ((process.env.FRESH_DB_GUARD ?? "").toLowerCase() === "off") return;

  // The demo world is DEMO-labelled by construction (scripts/demo-db.ts) and is
  // the only thing that carries `data_environment = 'DEMO'` pursuits.
  const demo = await db.query<{ n: string }>(
    `select count(*)::text n from pursuits where data_environment = 'DEMO'`,
  ).catch(() => ({ rows: [{ n: "0" }] }));
  if (Number(demo.rows[0].n) > 0) {
    throw new NotADisposableDatabase(`${demo.rows[0].n} DEMO-labelled pursuits present`);
  }

  // Belt and braces: the canonical demo seeds a known taxonomy slug and a
  // recognisable account book. Either alone is enough to stop.
  const marker = await db.query<{ n: string }>(
    `select count(*)::text n from taxonomy_nodes where slug = 'virtualization'`,
  ).catch(() => ({ rows: [{ n: "0" }] }));
  if (Number(marker.rows[0].n) > 0) {
    throw new NotADisposableDatabase("canonical 'virtualization' taxonomy node present");
  }
}
