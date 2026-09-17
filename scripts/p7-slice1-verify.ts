import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { executePursuitQuery } from "../src/lib/experience/execute";
import { PLANS } from "../src/lib/experience/plans";
import type { PursuitQuery } from "../src/lib/experience/types";

/**
 * P7 SLICE 1 — the proofs that need a real database and a real `app_rw` session.
 *
 * WHAT THIS PROVES, and why each one is here rather than in the unit suite: validation can be tested
 * without a database, but "an undisclosable pursuit cannot enter the result set" cannot — it needs
 * RLS binding on a non-BYPASSRLS role, a second organization, a live participation window and a
 * grant that can be withdrawn. Every assertion below runs through the SAME boundary the web route
 * calls, so what is measured is the behaviour a caller would actually get.
 *
 *   npx tsx scripts/verify-run.ts --suite p7-slice1
 *
 * The suite COMMITS fixtures, so it runs on a disposable seeded clone.
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 4 });
process.env.DATABASE_URL = rwUrl;   // the boundary's withTenant runs as app_rw, exactly like the app

/**
 * THE DEPLOYMENT MASTERS THIS SUITE REQUIRES, declared by the suite rather than assumed.
 * `experienceEnabledFor` is `envEnabled(flag) && org_features[flag]` for each of four flags: the
 * masters are a deployment switch and the org row is the tenant's entitlement. A suite that set only
 * the org row would be testing half the gate and would pass for the wrong reason — so both halves
 * are set here, and check 4 then turns the ORG row off with the masters still on, which is the case
 * that matters (ruling 1).
 */
for (const v of ["PURSUITS_ENABLED", "FACTS_ENABLED", "ROUTING_ENABLED", "PURSUIT_EXPERIENCE_ENABLED"]) process.env[v] = "true";

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const NS = `P7S1-${randomUUID().slice(0, 8)}`;

interface World { a: string; b: string; c: string; pursuitA: string; pursuitB: string; company: string }

/**
 * Two organizations and a pursuit each. B participates on A's pursuit — so A's pursuit is VISIBLE to
 * B through participation, which is exactly the case where disclosure and derivation authority must
 * do the deciding rather than tenancy alone.
 */
async function plant(db: PoolClient): Promise<World> {
  const org = async (tag: string) => String((await db.query(
    `insert into organizations (name, kind) values ($1, 'full') returning id`, [`${NS} ${tag}`])).rows[0].id);
  const a = await org("A"), b = await org("B"), c = await org("C");
  for (const o of [a, b, c]) {
    await db.query(`insert into org_features (org_id, pursuits, facts, routing, pursuit_experience, federation)
                    values ($1, true, true, true, true, true)`, [o]);
  }
  const company = String((await db.query(
    `insert into companies (legal_name, normalized_name) values ($1, $2) returning id`,
    [`${NS} Co`, NS.toLowerCase()])).rows[0].id);

  const pursuit = async (orgId: string, key: string) => String((await db.query(
    `insert into pursuits (org_id, account_id, dedup_key, status, pursuit_type, use_case, compelling_event)
     values ($1, $2, $3, 'QUALIFIED', 'EXPANSION', $4, $5) returning id`,
    [orgId, company, key, `${NS} use case`, `${NS} COMPELLING EVENT`])).rows[0].id);
  const pursuitA = await pursuit(a, `${NS}-A`), pursuitB = await pursuit(b, `${NS}-B`);

  for (const [p, sponsor] of [[pursuitA, a], [pursuitB, b]] as const) {
    await db.query(`insert into pursuit_participants (org_id, pursuit_id, sponsor_org_id, role_key, participation_state)
                    values ($1, $2, $3, 'VENDOR', 'ACTIVE')`, [sponsor, p, sponsor]);
  }
  // B is an ACTIVE participant on A's pursuit, inside its window.
  await db.query(`insert into pursuit_participants (org_id, pursuit_id, sponsor_org_id, role_key, participation_state, effective_from)
                  values ($1, $2, $3, 'DISTRIBUTOR', 'ACTIVE', now() - interval '1 hour')`, [b, pursuitA, a]);

  // Open opportunities: the metric's inputs.
  for (const [p, orgId, amount] of [[pursuitA, a, 500000], [pursuitA, a, 250000], [pursuitB, b, 100000]] as const) {
    await db.query(`insert into opportunities (org_id, company_id, pursuit_id, name, stage, amount_usd)
                    values ($1, $2, $3, $4, 'qualification', $5)`, [orgId, company, p, `${NS} opp`, amount]);
  }
  return { a, b, c, pursuitA, pursuitB, company };
}

/**
 * Run a plan AS a given organization. A script has no web session, so it uses the boundary's
 * explicit-org entry point — the same `withTenantOrg` path the MCP surface uses when the org comes
 * from an API key rather than a cookie. The org is planted by this suite, never taken from input.
 */
const asOrg = (orgId: string, p: PursuitQuery) => executePursuitQuery(p, { orgId });

async function main(): Promise<void> {
  await assertSeededClone(owner);
  const db = await owner.connect();
  const w = await plant(db);
  db.release();   // inserts above auto-commit; the suite runs on a disposable clone

  console.log(`\n── P7 Slice 1 · fixtures ${NS}`);

  const onlyPursuits = (rows: { objectRef: { id: string } }[]) => rows.map((r) => r.objectRef.id);
  const plan = (over: Partial<PursuitQuery> = {}): PursuitQuery => ({ ...structuredClone(PLANS["open-by-value"].plan), ...over });

  // ── 1. The boundary refuses an invalid plan BEFORE any database work ──
  const invalid = await executePursuitQuery({ ...plan(), metrics: [{ id: "made.up", version: 1 }] });
  check("1: an unregistered metric is rejected by the boundary, not by the database",
    invalid.ok === false && invalid.error === "INVALID_PLAN", invalid.ok === false ? invalid.detail : "");

  const badField = await executePursuitQuery({ ...plan(), projection: ["pursuit.id", "pursuit.current_priority_score"] });
  check("2: an unregistered field is rejected", badField.ok === false && badField.error === "INVALID_PLAN");

  const historical = await executePursuitQuery({ ...plan(), asOf: "2026-01-01" as unknown as null });
  check("3: a historical asOf is rejected — Slice 1 has no historical semantics", historical.ok === false);

  // ── 2. Tenant entitlement denies even with the environment master ON ──
  const db2 = await owner.connect();
  await db2.query(`update org_features set pursuit_experience = false where org_id = $1`, [w.b]);
  const denied = await asOrg(w.b, plan());
  check("4: org entitlement false denies despite the env master being on",
    denied.ok === false && denied.error === "CAPABILITY_DENIED", denied.ok === false ? denied.detail : "");
  await db2.query(`update org_features set pursuit_experience = true where org_id = $1`, [w.b]);
  db2.release();

  // ── 3. Tenancy: A sees its own pursuit; C sees neither ──
  const asA = await asOrg(w.a, plan());
  check("5: the owning org sees its own pursuit", asA.ok && onlyPursuits(asA.result.rows).includes(w.pursuitA));
  const asC = await asOrg(w.c, plan());
  check("6: an unrelated org sees neither pursuit — absence is indistinguishable from non-existence",
    asC.ok && !onlyPursuits(asC.result.rows).includes(w.pursuitA) && !onlyPursuits(asC.result.rows).includes(w.pursuitB));

  // ── 4. The metric: derivation authority is NECESSARY BUT NOT SUFFICIENT ──
  const aMetric = asA.ok ? asA.result.rows.find((r) => r.objectRef.id === w.pursuitA)?.cells["pursuit.open_pipeline_usd@1"] : undefined;
  check("7: the owner's metric computes from its own inputs", aMetric?.visibility === "EXACT" && aMetric?.value === 750000,
    String(aMetric?.value));

  const asB = await asOrg(w.b, plan());
  const bOnA = asB.ok ? asB.result.rows.find((r) => r.objectRef.id === w.pursuitA) : undefined;
  check("8: a participant sees the foreign pursuit at all (participation, not ownership)", Boolean(bOnA));
  check("9: with NO machine-governed grant, the participant's metric is withheld — mayDerive is necessary",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.visibility === "SUPPRESSED",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.reason);
  check("10: a withheld metric carries NO value, no zero and no partial sum",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.value === null);

  // ── 5. A governed field is resolved by the ladder, not by ownership alone ──
  check("11: PURSUIT_INTERNAL field on a foreign pursuit is not disclosed to a participant",
    bOnA?.cells["pursuit.compelling_event"] === undefined ||
    bOnA.cells["pursuit.compelling_event"].visibility === "SUPPRESSED");

  // ── 6. The response bytes must not carry a withheld value ──
  const serialized = JSON.stringify(asB.ok ? asB.result : {});
  check("12: no withheld value appears in the response bytes", !serialized.includes("COMPELLING EVENT"));

  // ── 7. Determinism ──
  const again = await asOrg(w.a, plan());
  check("13: the same plan twice produces the identical governed result",
    asA.ok && again.ok && JSON.stringify(stripInstant(asA.result)) === JSON.stringify(stripInstant(again.result)));

  // ── 8. The result is regenerable from the plan alone ──
  check("14: the result echoes the validated plan, so the surface is re-derivable",
    asA.ok && JSON.stringify(asA.result.plan) === JSON.stringify(plan()));

  // ── 9. No P7-local write occurred ──
  const db3 = await owner.connect();
  const { rows: counts } = await db3.query<{ n: string }>(
    `select (select count(*) from pursuits where dedup_key like $1 || '%')::text as n`, [NS]);
  check("15: the run wrote nothing of its own — the fixture count is unchanged", counts[0].n === "2", counts[0].n);
  db3.release();

  console.log(`\nP7 Slice 1: ${passed} passed, ${failed} failed`);
  if (failures.length) for (const f of failures) console.log(`   FAILED: ${f}`);
  await owner.end();
  process.exit(failed === 0 ? 0 : 1);
}

const stripInstant = (r: { computedAt: string }) => ({ ...r, computedAt: "<instant>" });

main().catch((e) => { console.error("p7-slice1 fatal:", e instanceof Error ? e.message : String(e)); process.exit(2); });
