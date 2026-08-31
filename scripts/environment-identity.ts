/**
 * Establish or inspect a database's environment identity (migration 0102).
 *
 * This is the deliberate operator act that a demo database needs before any
 * reseed will touch it, and that production must never be given.
 *
 *   npx tsx scripts/environment-identity.ts                       # show
 *   npx tsx scripts/environment-identity.ts --set demo --label "TD SYNNEX walkthrough"
 *   npx tsx scripts/environment-identity.ts --set app   --label "Production"
 *
 * `--set app` writes is_synthetic=false, which is what makes a production
 * database *provably* refuse a reseed rather than merely being unmarked. Marking
 * production is therefore not optional bookkeeping — it is the half of the guard
 * that turns "we could not prove it is safe" into "it told us it is not".
 *
 * Runs on the owner pool: the marker is intentionally not writable through RLS.
 */
import { getOwnerPool } from "../src/db/client";
import { databaseIdentity } from "../src/lib/env/environment";
import { readDbIdentity } from "../src/lib/env/db-identity";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const pool = getOwnerPool();
  const { projectRef, host } = databaseIdentity();
  const target = projectRef ? `project ${projectRef}` : (host ?? "unknown host");

  const set = flag("--set");

  if (!set) {
    const current = await readDbIdentity(pool);
    console.log(`target       : ${target}`);
    if (!current) {
      console.log(`identity     : UNMARKED — reseed tooling will refuse this database.`);
    } else {
      console.log(`environment  : ${current.environment}`);
      console.log(`is_synthetic : ${current.isSynthetic}${current.isSynthetic ? "  (reseed permitted)" : "  (reseed REFUSED)"}`);
      console.log(`label        : ${current.label || "—"}`);
      console.log(`established  : ${current.establishedAt.toISOString()}`);
    }
    await pool.end();
    return;
  }

  if (!["app", "demo", "local"].includes(set)) {
    console.error(`--set must be app | demo | local (got "${set}")`);
    process.exit(1);
  }

  // 'app' is never synthetic — the CHECK constraint in 0102 enforces this too,
  // so a hand-written UPDATE cannot get around it either.
  const isSynthetic = set !== "app";
  const label = flag("--label") ?? "";

  const existing = await readDbIdentity(pool);
  if (existing && existing.environment !== set) {
    // Re-labelling a database is how a demo could quietly become "production",
    // or worse, how production could be re-labelled demo and then wiped. Both
    // directions require an explicit acknowledgement.
    if (!args.includes("--force")) {
      console.error(
        `REFUSED: ${target} is already marked "${existing.environment}"` +
          `${existing.label ? ` (${existing.label})` : ""}.\n` +
          `Changing a database's environment identity is not a routine edit.\n` +
          `Re-run with --force if you are certain this is the same database re-purposed.`,
      );
      process.exit(1);
    }
  }

  await pool.query(
    `insert into environment_identity (singleton, environment, is_synthetic, label)
     values (true, $1, $2, $3)
     on conflict (singleton) do update
       set environment = excluded.environment,
           is_synthetic = excluded.is_synthetic,
           label = excluded.label,
           established_at = now()`,
    [set, isSynthetic, label],
  );

  console.log(`marked ${target} as environment="${set}" is_synthetic=${isSynthetic}${label ? ` label="${label}"` : ""}`);
  if (!isSynthetic) console.log(`reseed tooling will now REFUSE this database.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
