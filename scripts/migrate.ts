import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";

/** Apply supabase/migrations/*.sql in order, tracking applied files. */
async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const { rowCount } = await client.query(
        "select 1 from schema_migrations where filename = $1",
        [file],
      );
      if (rowCount) continue;
      console.log(`applying ${file}`);
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("migrations up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
