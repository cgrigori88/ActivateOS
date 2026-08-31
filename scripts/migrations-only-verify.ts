/**
 * P0.1 regression — MIGRATIONS-ONLY routing verification.
 *
 * Proves that a database created STRICTLY from supabase/migrations/*.sql (no harness SQL, no
 * seed extras) can execute the real route recompute — including the vendor-seller ranking path,
 * whose `seller_account_relationships.last_interaction_at` read previously referenced a column
 * no migration created (drift that only surfaced when an org actually had vendor sellers).
 *
 * This is the regression that would have caught that drift: the fixture deliberately contains a
 * VENDOR seller with an account relationship so `rankSellers("vendor") → sellerRelationship()`
 * executes against the migrations-only schema. Schema drift between code and migrations fails
 * here loudly instead of in production routing.
 *
 *   npx tsx scripts/migrations-only-verify.ts        (uses 127.0.0.1:5433 postgres/postgres)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { rankSellers } from "../src/lib/routing/seller-fit";

const HOST = process.env.DEMO_PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.DEMO_PGPORT ?? 5433);
const ADMIN = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
const DB = "migrations_only_verify";
const URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DB}`;

// Supabase-compat bootstrap only (auth schema + roles + extensions) — the same preamble the real
// deployment target provides. NOT part of the product schema; contains no product tables/columns.
const BOOTSTRAP = `
create extension if not exists pgcrypto;
create extension if not exists vector;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`;

let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

async function main() {
  // Fresh DB from migrations only.
  const admin = new Pool({ connectionString: ADMIN });
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    await db.query(BOOTSTRAP);
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) await db.query(readFileSync(join(dir, f), "utf8"));
    console.log(`\n  · applied ${files.length} migrations (no harness SQL)\n`);

    // Minimal real fixture — including the previously-lethal shape: a VENDOR seller with an
    // account relationship, so the vendor-seller ranking path actually executes.
    const org = (await db.query<{ id: string }>(`insert into organizations (name) values ('MigVerify Co') returning id`)).rows[0].id;
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (slug, name) values ('virtualization','Virtualization') returning id`)).rows[0].id;
    const co = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, primary_domain) values ('Fixture Industries','fixture industries','fixture.example') returning id`)).rows[0].id;
    const vendor = (await db.query<{ id: string }>(`insert into vendors (org_id, name) values ($1,'Fixture Vendor') returning id`, [org])).rows[0].id;
    const vSeller = (await db.query<{ id: string }>(`insert into sellers (org_id, vendor_id, name) values ($1,$2,'V. Seller') returning id`, [org, vendor])).rows[0].id;
    await db.query(`insert into seller_account_relationships (seller_id, company_id, strength) values ($1,$2,70)`, [vSeller, co]);
    const partner = (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type) values ($1,'Fixture Partner','reseller') returning id`, [org])).rows[0].id;
    await db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,0.8,true)`, [partner, node]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,70,24)`, [partner, co]);
    const pursuit = (await upsertPursuit(db, { orgId: org, accountId: co, productCategoryId: node, pursuitType: "NET_NEW", useCase: "migrations-only verify", businessProblem: "verify", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;

    // The regression: vendor-seller ranking on the migrations-only schema.
    const sellers = await rankSellers(db, { orgId: org, accountId: co }, "vendor", null);
    ok("rankSellers('vendor') executes on a migrations-only schema (the drifted query path)", sellers.length === 1 && sellers[0].sellerId === vSeller);

    // The full route recompute (which embeds the same path).
    const rr = await recomputeRoute(db, pursuit, new Date(), "DEMO");
    ok("recomputeRoute completes on a migrations-only database", !!rr);
    const snap = await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id = $1 and is_current`, [pursuit]);
    ok("a current route snapshot was written", Number(snap.rows[0].n) === 1);
    const cands = await db.query<{ n: string }>(
      `select count(*)::text n from route_candidates rc join pursuit_route_snapshots s on s.id = rc.route_snapshot_id where s.pursuit_id = $1 and s.is_current`, [pursuit]);
    ok("route candidates were written (partner + direct)", Number(cands.rows[0].n) >= 2);
    // The DIRECT candidate's score is derived from the vendor-seller ranking (candidates.ts:63) —
    // its presence proves the previously-drifted path fed the recompute end to end. (Nothing in
    // product code persists route_seller_candidates; that table is read-only substrate.)
    const direct = await db.query<{ n: string }>(
      `select count(*)::text n from route_candidates rc join pursuit_route_snapshots s on s.id = rc.route_snapshot_id
        where s.pursuit_id = $1 and s.is_current and rc.route_topology = 'DIRECT'`, [pursuit]);
    ok("DIRECT candidate present (vendor-seller ranking fed the recompute)", Number(direct.rows[0].n) === 1);

    console.log(`\n  ${fail === 0 ? "✓ MIGRATIONS-ONLY ROUTING VERIFIED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error(`\n  ✗ FAILED: ${(e as Error).message}\n`);
    process.exit(1);
  } finally {
    db.release();
    await pool.end();
  }
}
main();
