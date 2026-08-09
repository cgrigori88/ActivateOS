import { readFileSync } from "node:fs";

/**
 * Run SQL files against a Supabase project over HTTPS via the Management API.
 * Exists because some environments (including our dev sandbox) block raw
 * Postgres connections; the Management API works anywhere HTTPS works.
 *
 * Requires:
 *   SUPABASE_PROJECT_REF   e.g. sxtwrrckvlohottrdsbr
 *   SUPABASE_ACCESS_TOKEN  personal access token (sbp_...), from
 *                          Supabase Dashboard → Account → Access Tokens
 *
 * Usage: npm run db:remote -- <file.sql> [more.sql ...]
 */
async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: npm run db:remote -- <file.sql> [more.sql ...]");
    process.exit(1);
  }
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    console.error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set");
    process.exit(1);
  }

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    process.stdout.write(`applying ${file} (${sql.length} bytes)... `);
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`FAILED (${res.status}): ${body}`);
      process.exit(1);
    }
    console.log("ok");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
