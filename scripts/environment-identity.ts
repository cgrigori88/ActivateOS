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
    if (current.status === "unreadable") {
      // Reporting this as UNMARKED would be a confident lie: it describes the
      // connection, not the database. The most common cause by far is a
      // DATABASE_URL whose password placeholder was never substituted.
      console.log(`identity     : CANNOT READ — this is a connection problem, not a missing marker.`);
      console.log(`error        : ${current.reason}`);
      console.log(`check        : DATABASE_URL — host, port, and that the password was actually filled in.`);
      process.exitCode = 1;
    } else if (current.status === "absent") {
      console.log(`identity     : UNMARKED — reached the database, but it carries no identity row.`);
      console.log(`             : reseed tooling will refuse it until it is marked.`);
    } else {
      const id = current.identity;
      console.log(`environment  : ${id.environment}`);
      console.log(`is_synthetic : ${id.isSynthetic}${id.isSynthetic ? "  (reseed permitted)" : "  (reseed REFUSED)"}`);
      console.log(`label        : ${id.label || "—"}`);
      console.log(`established  : ${id.establishedAt.toISOString()}`);
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
  if (existing.status === "unreadable") {
    // Never write a marker into a database we could not read. That is how a
    // typo'd connection string ends up stamping an identity onto whatever it
    // actually reached.
    console.error(
      `REFUSED: could not read ${target} to check its current identity:\n  ${existing.reason}\n` +
        `Fix the connection before marking anything — check that DATABASE_URL's password was filled in.`,
    );
    process.exit(1);
  }
  if (existing.status === "found" && existing.identity.environment !== set) {
    // Re-labelling a database is how a demo could quietly become "production",
    // or worse, how production could be re-labelled demo and then wiped. Both
    // directions require an explicit acknowledgement.
    if (!args.includes("--force")) {
      console.error(
        `REFUSED: ${target} is already marked "${existing.identity.environment}"` +
          `${existing.identity.label ? ` (${existing.identity.label})` : ""}.\n` +
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
