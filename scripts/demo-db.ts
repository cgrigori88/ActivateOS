/**
 * Reproducible PursuitOS demo database (Workstream D.5 §A).
 *
 * Builds a full, real-schema local tenant the authenticated app can boot against:
 *   1. a fresh database,
 *   2. a Supabase-compatibility bootstrap (auth schema + stub auth.uid(),
 *      the `authenticated` role, extensions) so the REAL migrations apply
 *      unchanged — this is the actual product schema, not a reduced harness,
 *   3. all supabase/migrations/*.sql in order,
 *   4. the WS-D demo seed: a vendor tenant (created first, so the sole-org
 *      fallback resolves to it), a guest partner tenant, and the Globex hero
 *      Pursuit with facts, route, human override, team and a RESTRICTED reason.
 *
 * The demo is DEMO-labelled data; app_rw is given a login here for the local
 * boot only. Run:  npx tsx scripts/demo-db.ts
 * Boot the app:    DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo \
 *                  NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
 *                  PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 \
 *                  PURSUIT_EXPERIENCE_ENABLED=1 next dev -p 3100
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { promoteFromSignal } from "../src/lib/facts/promotion";
import { linkFactToPursuits } from "../src/lib/facts/pursuit-link";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { selectPartnerRoute } from "../src/lib/routing/override";
import { assembleTeam } from "../src/lib/routing/team";
import { ingestFeatures } from "../src/lib/transactions/features";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { proposeGrant, acceptGrant } from "../src/lib/pursuits/federation/grants";
import { recordContribution } from "../src/lib/pursuits/federation/contributions";
import { seedGovernedSkills } from "../src/lib/pursuits/federation/skills";
import { recordOutcome } from "../src/lib/pursuits/federation/outcomes";
import { setOrgFeature } from "../src/lib/pursuits/tenant-flags";
import { populatePartnerRouteRelevance } from "../src/lib/routing/route-why-now";

const HOST = process.env.DEMO_PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.DEMO_PGPORT ?? 5433);
const ADMIN = process.env.DEMO_ADMIN_URL ?? `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
const DB = process.env.DEMO_DB_NAME ?? "pursuit_demo";
const DEMO_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/${DB}`;

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

async function withClient<T>(url: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); await pool.end(); }
}

async function runMigrations(url: string) {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await withClient(url, async (c) => {
    for (const f of files) {
      try {
        await c.query("begin");
        await c.query(readFileSync(join(dir, f), "utf8"));
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => {});
        console.error(`\n[demo-db] migration FAILED: ${f}\n${(e as Error).message}`);
        throw e;
      }
    }
    console.log(`[demo-db] applied ${files.length} migrations`);
  });
}

async function seed(pool: Pool) {
  const asOwner = async <T>(fn: (db: PoolClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
    catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  };
  const asOrg = async <T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
    catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  };

  const s = await asOwner(async (db) => {
    // Vendor tenant is DETERMINISTICALLY earliest (staggered created_at) so the
    // sole-org fallback (resolve_user_org: earliest org) always resolves to the
    // internal operator — never a tie the guest could win.
    const vendor = (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ('Vertex Systems','full', now() - interval '1 hour') returning id`)).rows[0].id;
    const partnerOrg = (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ('Meridian Technology Partners','guest', now()) returning id`)).rows[0].id;
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ('Virtualization','virtualization') returning id`)).rows[0].id;
    const co = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Technology','US') returning id`, [n])).rows[0].id;
    const globex = await co("Globex Manufacturing Inc."); const initech = await co("Initech Financial");
    const partner = async (o: string, n: string) => (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type, capacity) values ($1,$2,'reseller',10) returning id`, [o, n])).rows[0].id;
    const cdw = await partner(vendor, "CDW"); const wwt = await partner(vendor, "WWT");
    for (const p of [cdw, wwt]) await db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,0.85,true)`, [p, node]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,64,24)`, [cdw, globex]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,72,30)`, [wwt, globex]);
    const seller = async (p: string, n: string) => { const id = (await db.query<{ id: string }>(`insert into sellers (org_id, partner_id, name) values ($1,$2,$3) returning id`, [vendor, p, n])).rows[0].id; await db.query(`insert into seller_account_relationships (seller_id, company_id, strength) values ($1,$2,65)`, [id, globex]); return id; };
    await seller(cdw, "CDW Rep"); await seller(wwt, "WWT Rep");
    return { vendor, partnerOrg, node, globex, initech, cdw, wwt };
  });

  const hero = (await asOrg(s.vendor, (db) => upsertPursuit(db, { orgId: s.vendor, accountId: s.globex, productCategoryId: s.node, pursuitType: "MODERNIZATION", useCase: "virtualization exit", businessProblem: "Exit legacy virtualization before renewal", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" }))).id;
  const second = (await asOrg(s.vendor, (db) => upsertPursuit(db, { orgId: s.vendor, accountId: s.globex, productCategoryId: s.node, pursuitType: "EXPANSION", useCase: "ai platform", businessProblem: "AI platform expansion", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" }))).id;
  const foreign = (await asOrg(s.partnerOrg, (db) => upsertPursuit(db, { orgId: s.partnerOrg, accountId: s.initech, pursuitType: "NET_NEW", useCase: "greenfield", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" }))).id;

  await asOrg(s.vendor, async (db) => {
    await db.query(`update pursuits set current_priority_score=72, current_purchase_propensity_score=68, current_evidence_confidence_score=61, current_timing_score=55, expected_value_weighted=1250000, expected_value_currency='USD', data_environment='DEMO' where id=$1`, [hero]);
    const ev = await db.query<{ id: string }>(`insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at, status, computed_confidence, first_party) values ($1,$2,'crm','Globex has a cloud modernization initiative.',0.85,now(),'verified',0.85,true) returning id`, [s.vendor, s.globex]);
    const sig = await db.query<{ id: string }>(`insert into signals (org_id, company_id, signal_type, taxonomy_node_id, direction, magnitude, confidence, observed_at, half_life_days, evidence_id, value) values ($1,$2,'STRATEGIC_INITIATIVE',$3,1,0.8,0.8,now(),180,$4,'{"text":"cloud modernization"}') returning id`, [s.vendor, s.globex, s.node, ev.rows[0].id]);
    const promo = await promoteFromSignal(db, s.vendor, sig.rows[0].id, "DEMO");
    let factId: string | null = null;
    if (promo?.outcome === "PROMOTED" && promo.factId) { factId = promo.factId; await linkFactToPursuits(db, promo.factId); }
    await db.query(`update pursuits set why_now = $2 where id=$1`, [hero, JSON.stringify({ version: 1, as_of: new Date().toISOString(), business_trigger: factId ? { fact_id: factId, predicate: "strategic_initiative", label: "Globex" } : null, timing_anchor: null, signal_convergence: { independent_family_count: 1 }, contradictory_evidence: [] })]);
    await ingestFeatures(db, s.vendor, null, "DERIVED", s.globex, s.node, s.cdw, [{ featureKey: "category_adjacency", featureValue: 0.95, confidence: 0.85, dataClassification: "TRANSACTION_CONFIDENTIAL" }], "DEMO", true);
    await recomputeRoute(db, hero, new Date(), "DEMO");
    await recomputeRoute(db, second, new Date(), "DEMO");
    await populatePartnerRouteRelevance(db, hero);
    await assembleTeam(db, hero, "DEMO");
    const rc = await db.query<{ id: string }>(`select rc.id from route_candidates rc join pursuit_route_snapshots sn on sn.id=rc.route_snapshot_id where sn.pursuit_id=$1 and sn.is_current and rc.is_recommended`, [hero]);
    if (rc.rows[0]) await db.query(`insert into route_candidate_reasons (candidate_id, org_id, reason_code, polarity, detail, disclosure_class) values ($1,$2,'RAW_SPEND',1,'TD spend $1,840,000 in category',$3)`, [rc.rows[0].id, s.vendor, "RESTRICTED"]);
  });
  // Human override: select WWT over recommended CDW (records the override + change event).
  await asOrg(s.vendor, (db) => selectPartnerRoute(db, hero, { partnerId: s.wwt, actorId: crypto.randomUUID(), reason: "exec relationship", category: "EXECUTIVE_DIRECTION" }));

  // Federation fixture (E3-H, §2.14) — the ONE canonical hero pursuit gains a distributor
  // participant, a purpose-limited DATA grant, a FEDERATED context contribution, and a
  // material outcome. All DEMO / is_simulated; the restricted figure stays vendor-internal.
  // Renders only when FEDERATION_ENABLED=1; the demo DB stays inert otherwise.
  const distributor = (await asOrg(s.vendor, (db) => db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ('TD SYNNEX (demo)','full', now() + interval '2 hours') returning id`))).rows[0].id;
  await withClient(DEMO_URL, (c) => c.query(`grant connect on database ${DB} to app_rw`).then(() => {})).catch(() => {});
  await asOrg(s.vendor, (db) => seedGovernedSkills(db));
  const partId = await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: hero, orgId: s.vendor, roleKey: "VENDOR", sponsorOrgId: s.vendor, state: "ACTIVE" }).then(() =>
    addParticipant(db, { pursuitId: hero, orgId: distributor, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor })));
  await asOrg(distributor, (db) => acceptParticipation(db, partId));
  const grant = await asOrg(distributor, (db) => proposeGrant(db, { pursuitId: hero, fromOrgId: distributor, toOrgId: s.vendor, grantKind: "DATA", purpose: "co-sell context sharing", informationClasses: ["transaction_adjacency"] }));
  await asOrg(s.vendor, (db) => acceptGrant(db, grant));
  await asOrg(distributor, (db) => recordContribution(db, { pursuitId: hero, sourceOrgId: distributor, mode: "FEDERATED", dataCategory: "transaction_adjacency", semanticMeaning: "Distributor transaction adjacency strongly supports the recommended route", disclosureClass: "PARTICIPANT_SHARED", sensitivityClass: "CONFIDENTIAL", purpose: "co-sell", consentGrantId: grant, isSimulated: true }));
  await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: hero, label: "MEETING_BOOKED", occurredAt: new Date(), dataEnvironment: "DEMO", isSimulated: true }));

  // R1-G2/G8 — enable the pursuit experience + federation per-tenant for every demo org
  // (vendor sponsor, distributor participant, guest outsider) so the R1-G8 pilot can view
  // the SAME canonical pursuit through the authenticated app from each viewpoint. The
  // gates are env-master AND per-org.
  for (const org of [s.vendor, distributor, s.partnerOrg]) {
    await asOrg(org, async (db) => {
      for (const flag of ["pursuits", "facts", "routing", "pursuit_experience", "federation", "governed_action"] as const) {
        await setOrgFeature(db, org, flag, true, { reason: "demo/pilot tenant" });
      }
    });
  }
  // The vendor SPONSOR also gets outcome_learning ON — it is the org that records commercial
  // outcomes, so the Phase B closed learning half (outcome → honest attribution → recompute) and
  // the disclosure-aware Brief's outcome line are demonstrable without a manual DB tweak. Kept to
  // the sponsor; the participant/guest tenants stay OFF.
  await asOrg(s.vendor, (db) => setOrgFeature(db, s.vendor, "outcome_learning", true, { reason: "demo sponsor — closed learning loop" }));

  return { vendor: s.vendor, partnerOrg: s.partnerOrg, hero, second, foreign };
}

/**
 * Two provisioning modes, because a hosted demo project is not a local one.
 *
 *   LOCAL (default)  — DROP DATABASE / CREATE DATABASE on the container Postgres.
 *                      Fast, total, and only possible where we own the cluster.
 *   IN-PLACE         — DEMO_TARGET_URL set (a hosted Supabase demo project).
 *                      No cluster-level DDL is available there, so the database
 *                      must already exist and be migrated; we assert it is
 *                      synthetic and seed into it.
 *
 * The mode is chosen by whether DEMO_TARGET_URL is set, never inferred from the
 * shape of a hostname — an inference is exactly what would eventually be wrong.
 */
const TARGET_URL = process.env.DEMO_TARGET_URL;
const IN_PLACE = Boolean(TARGET_URL);
const EFFECTIVE_URL = TARGET_URL ?? DEMO_URL;

/** True only for a cluster we own outright and may drop databases on. */
function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "/var/run/postgresql";
}

async function main() {
  if (IN_PLACE) {
    // Hosted demo project. The database is not ours to recreate, so the guard
    // is the only thing standing between this seed and whatever DEMO_TARGET_URL
    // actually points at. Ask the database itself before writing a single row.
    const redacted = EFFECTIVE_URL.replace(/:[^:@/]*@/, ":***@");
    console.log(`[demo-db] IN-PLACE seed → ${redacted}`);
    const probe = new Pool({ connectionString: EFFECTIVE_URL, max: 1 });
    let identity;
    try {
      identity = await assertSyntheticDatabase(probe, "in-place demo provisioning");
    } finally {
      await probe.end();
    }
    console.log(`[demo-db] target confirmed synthetic: environment="${identity.environment}"${identity.label ? ` (${identity.label})` : ""}`);

    // Schema must already be present — migrating is a separate, reviewable step.
    // Seeding a database whose schema we silently created would hide a migration
    // failure behind a seed failure.
    //
    // If the tracker already accounts for every file on disk, the schema is at
    // parity and re-running the DDL buys nothing. It is not free either: it
    // replays 102 files over a connection pooler, and it leans on every one of
    // them being perfectly idempotent — a much stronger assumption than "they
    // applied cleanly once", and not one worth testing during a demo setup.
    const tracker = new Pool({ connectionString: EFFECTIVE_URL, max: 1 });
    let applied = 0;
    try {
      const { rows } = await tracker.query<{ n: string }>("select count(*)::text as n from schema_migrations");
      applied = Number(rows[0].n);
    } catch {
      applied = 0; // no tracker at all — the database has not been migrated
    } finally {
      await tracker.end();
    }
    const onDisk = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).length;

    if (applied >= onDisk) {
      console.log(`[demo-db] schema at parity (${applied}/${onDisk} migrations tracked) — skipping DDL`);
    } else {
      throw new Error(
        `REFUSED: the target has ${applied} of ${onDisk} migrations applied.\n` +
          `Seeding a partially-migrated database produces failures that look like seed bugs.\n` +
          `Migrate it first:  DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/migrate.ts`,
      );
    }

    const pool = new Pool({ connectionString: EFFECTIVE_URL });
    const ids = await seed(pool);
    await pool.end();
    console.log(`[demo-db] seeded in place:\n  vendor(sole)=${ids.vendor}\n  guest=${ids.partnerOrg}\n  HERO=${ids.hero}`);
    return;
  }

  // LOCAL: destructive, and deliberately restricted to a cluster we own. A
  // DEMO_PGHOST pointing anywhere else is a mistake, not a feature.
  if (!isLoopback(HOST)) {
    throw new Error(
      `REFUSED: demo-db drops and recreates database "${DB}", which is only ever safe on a local cluster.\n` +
        `DEMO_PGHOST is "${HOST}". To seed a hosted demo project, set DEMO_TARGET_URL instead — that path\n` +
        `asserts the target is marked synthetic and never issues DROP DATABASE.`,
    );
  }

  console.log(`[demo-db] building ${DB} @ ${HOST}:${PORT}`);
  await withClient(ADMIN, async (c) => {
    await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [DB]).catch(() => {});
    await c.query(`drop database if exists ${DB}`);
    await c.query(`create database ${DB}`);
  });
  await withClient(DEMO_URL, (c) => c.query(BOOTSTRAP).then(() => console.log("[demo-db] bootstrap applied")));
  await runMigrations(DEMO_URL);
  await withClient(DEMO_URL, (c) => c.query(`alter role app_rw login password 'demo'; grant connect on database ${DB} to app_rw;`).then(() => {}));

  // Mark the freshly built local database as synthetic so the story scripts that
  // run after this one are permitted to write to it. A demo database that the
  // guard refuses would be a guard nobody could use.
  await withClient(DEMO_URL, (c) =>
    c.query(
      `insert into environment_identity (singleton, environment, is_synthetic, label)
       values (true, 'demo', true, $1)
       on conflict (singleton) do update set environment='demo', is_synthetic=true, label=excluded.label`,
      [`local demo database ${DB}`],
    ).then(() => {}),
  );

  const pool = new Pool({ connectionString: DEMO_URL });
  const ids = await seed(pool);
  await pool.end();
  console.log(`[demo-db] seeded:\n  vendor(sole)=${ids.vendor}\n  guest=${ids.partnerOrg}\n  HERO=${ids.hero}\n  second=${ids.second}\n  foreign(cross-tenant)=${ids.foreign}`);
  console.log(`[demo-db] boot: DATABASE_URL=postgresql://app_rw:demo@${HOST}:${PORT}/${DB} (Supabase env empty, flags on)`);
}
main().catch((e) => { console.error("[demo-db] fatal:", e); process.exit(1); });
