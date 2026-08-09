import pg from "pg";

let pool: pg.Pool | null = null;

/** Shared connection pool. DATABASE_URL points at Supabase (or local Postgres in dev). */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new pg.Pool({ connectionString, max: 5 });
  }
  return pool;
}
