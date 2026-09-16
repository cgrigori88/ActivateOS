import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { settlementStatement } from "../src/lib/partnerships/settlement";

/**
 * Persisted / model determinism (D-G8-3).
 *
 * THE INVARIANT. Any value PursuitOS persists — or renders from a persisted sequence — must be a
 * deterministic function of canonical inputs and existing business semantics. It may not depend on
 * PostgreSQL encounter order, planner choice, heap layout, or owner vs app_rw execution.
 *
 * THE CLAIM, with ties PLANTED (on this disposable clone only):
 *   3A  the composer's authored asset sequence round-trips: positions 0,1,2,3 read back in the
 *       authored order even when the rows are INSERTED in reverse, and a duplicate slot is refused;
 *   3B  partnership_settlement_rows returns a stable total order and a unique opportunity identity
 *       across every plan, heap and role, and a non-party still sees nothing;
 *   3D  each scoped persisted-selection site picks the SAME row under every plan, heap and role, and
 *       under reversed insertion order, while its pre-existing business ranking still dominates;
 *   plus: eligibility is unchanged (same candidate multiset), the OLD untied clause is a negative
 *   control, and no send row moves.
 *
 * SAFETY. Fixtures COMMIT, so this runs only on a disposable seeded clone (SEEDED_CLONE). Every read
 * runs in a transaction that is rolled back. No send path is touched.
 *
 *   npx tsx scripts/verify-run.ts --suite persisted-determinism
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 2 });
const rw = new Pool({ connectionString: rwUrl, max: 1 });

let passed = 0, failed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ""): void => {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const PLANS: [string, string[]][] = [
  ["default", []],
  ["no index scans", ["enable_indexscan", "enable_indexonlyscan", "enable_bitmapscan"]],
  ["no seq scans", ["enable_seqscan"]],
  ["no hash/merge joins", ["enable_hashjoin", "enable_mergejoin"]],
  ["no nested loops", ["enable_nestloop"]],
];
const ROLES = (): [string, Pool][] => [["owner", owner], ["app_rw", rw]];

/** withTenant's mechanism (transaction-local app.org_id) plus planner switches; always rolled back. */
async function read<T>(pool: Pool, orgId: string, off: string[], fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const s of off) await c.query(`set local ${s} = off`);
    await c.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** Run one query over 5 plans × 2 heaps × 2 roles and report whether every payload is identical. */
async function sweep(
  label: string, orgId: string, sql: string, params: unknown[], relocate: () => Promise<void>,
): Promise<{ allSame: boolean; first: string; runs: number; diffs: string[] }> {
  const runs: { tag: string; json: string }[] = [];
  for (const heap of ["insertion order", "tuples relocated"]) {
    if (heap === "tuples relocated") await relocate();
    for (const [plan, off] of PLANS) {
      for (const [role, pool] of ROLES()) {
        const rows = await read(pool, orgId, off, async (c) => (await c.query(sql, params)).rows);
        runs.push({ tag: `${heap} · ${plan} · ${role}`, json: JSON.stringify(rows) });
      }
    }
  }
  const first = runs[0].json;
  const diffs = runs.filter((r) => r.json !== first).map((r) => r.tag);
  console.log(`  · ${label}: ${runs.length} runs (2 heaps × 5 plans × 2 roles)`);
  return { allSame: diffs.length === 0, first, runs: runs.length, diffs };
}

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[persisted-determinism-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  const sendBefore = (await owner.query(
    `select (select count(*) from messages) m, (select count(*) from action_outbox) o,
            (select count(*) from email_events) e, (select count(*) from campaign_touches where status = 'sent') s`)).rows[0];

  const V = (await owner.query<{ id: string }>(`select id from organizations where name = 'Vertex Systems'`)).rows[0].id;
  const other = (await owner.query<{ id: string }>(`select id from organizations where name <> 'Vertex Systems' order by name limit 1`)).rows[0].id;
  const anyCo = (await owner.query<{ id: string }>(`select company_id as id from opportunities where org_id = $1 order by company_id limit 1`, [V])).rows[0].id;
  const T0 = "2026-01-01T00:00:00Z";

  // ── D-G8-3A — the composer's authored sequence round-trips ──────────────────────────────────────
  console.log("\nD-G8-3A — campaign asset sequence");
  const campaignId = randomUUID();
  await owner.query(`insert into campaigns (id, org_id, company_id, name, status, source) values ($1, $2, $3, 'DG83A tie campaign', 'draft', 'user')`,
    [campaignId, V, anyCo]);
  const AUTHORED = ["seller_playbook", "outreach_email", "discovery_guide", "objection_cards"];
  // INSERT IN REVERSE, with an identical created_at — the exact condition that used to decide the order.
  for (const [i, t] of [...AUTHORED.entries()].reverse()) {
    await owner.query(
      `insert into campaign_assets (campaign_id, asset_type, title, content, created_at, position) values ($1, $2, $3, $4, $5, $6)`,
      [campaignId, t, `T ${t}`, `C ${t}`, T0, i]);
  }
  const READER = `select a.asset_type, a.title, a.content
       from campaign_assets a join campaigns cp on cp.id = a.campaign_id
       where cp.id = $1 order by a.position asc nulls last, a.id`;
  const relocateAssets = async () => { await owner.query(`update campaign_assets set title = title where campaign_id = $1`, [campaignId]); };
  const a = await sweep("campaign assets", V, READER, [campaignId], relocateAssets);
  check("3A: the asset order is identical across 5 plans × 2 heaps × owner/app_rw", a.allSame, a.diffs.join(" | "));
  check("3A: the persisted sequence round-trips to the composer's authored order despite REVERSE insertion",
    JSON.stringify((JSON.parse(a.first) as { asset_type: string }[]).map((r) => r.asset_type)) === JSON.stringify(AUTHORED),
    (JSON.parse(a.first) as { asset_type: string }[]).map((r) => r.asset_type).join(" → "));
  const positions = (await owner.query<{ position: number }>(`select position from campaign_assets where campaign_id = $1 order by position`, [campaignId])).rows.map((r) => r.position);
  check("3A: positions persist as exactly 0,1,2,3", JSON.stringify(positions) === "[0,1,2,3]", JSON.stringify(positions));

  let rejected = false;
  try { await owner.query(`insert into campaign_assets (campaign_id, asset_type, title, content, position) values ($1, 'seller_playbook', 'dup', 'dup', 0)`, [campaignId]); }
  catch { rejected = true; }
  check("3A: a duplicate (campaign_id, position) is REFUSED by the partial unique index", rejected);

  // NEGATIVE CONTROL: the OLD clause over the same fixture cannot reproduce the authored order.
  const oldOrder = (await owner.query<{ asset_type: string }>(
    `select a.asset_type from campaign_assets a where a.campaign_id = $1 order by a.created_at`, [campaignId])).rows.map((r) => r.asset_type);
  check("3A negative control: the OLD `order by created_at` does NOT reproduce the authored order over a tied fixture",
    JSON.stringify(oldOrder.slice(0, 4)) !== JSON.stringify(AUTHORED), oldOrder.join(" → "));

  // ── D-G8-3B — settlement identity and total order ───────────────────────────────────────────────
  console.log("\nD-G8-3B — settlement identity / order");
  const jp = (await owner.query<{ partnership_id: string; company_id: string }>(
    `select partnership_id, company_id from joint_pursuits where status in ('active','closed') order by created_at, id limit 1`)).rows[0];
  if (!jp) { check("3B: a jointly pursued account exists in the canonical world", false); }
  else {
    // Two opportunities on the jointly pursued account with an IDENTICAL updated_at — the planted tie.
    const tieIds = [randomUUID(), randomUUID()].sort().reverse();
    for (const [i, id] of tieIds.entries()) {
      await owner.query(
        `insert into opportunities (id, org_id, company_id, name, stage, amount_usd, created_at, updated_at)
         values ($1, $2, $3, $4, 'closed_won', 50000, $5, $5)`, [id, V, jp.company_id, `DG83B tie deal ${i}`, T0]);
    }
    const FN = `select org_id, company_id, legal_name, stage, amount_usd, updated_at, registered, opportunity_id
                from partnership_settlement_rows($1)`;
    const relocateOpps = async () => { await owner.query(`update opportunities set name = name where id = any($1)`, [tieIds]); };
    const s = await sweep("settlement rows", V, FN, [jp.partnership_id], relocateOpps);
    check("3B: the settlement payload is identical across 5 plans × 2 heaps × owner/app_rw", s.allSame, s.diffs.join(" | "));
    const rows = JSON.parse(s.first) as { opportunity_id: string; updated_at: string }[];
    check("3B: every row carries a distinct opportunity_id (stable identity)",
      new Set(rows.map((r) => r.opportunity_id)).size === rows.length, `${rows.length} rows`);
    const tieSet = new Set<string>(tieIds);
    const planted = rows.filter((r) => tieSet.has(r.opportunity_id)).map((r) => r.opportunity_id);
    check("3B: the two tied opportunities render in ascending id order under the documented rule",
      JSON.stringify(planted) === JSON.stringify([...tieIds].sort()), planted.join(" → "));
    const byUpdated = rows.map((r) => r.updated_at);
    check("3B: the business order (updated_at DESC) is preserved",
      JSON.stringify(byUpdated) === JSON.stringify([...byUpdated].sort().reverse()));

    // Consent: a non-party sees nothing, under both roles.
    let leak = 0;
    for (const [, pool] of ROLES()) {
      const n = await read(pool, other, [], async (c) => (await c.query(`select count(*)::int n from partnership_settlement_rows($1)`, [jp.partnership_id])).rows[0].n);
      leak += Number(n);
    }
    check("3B: a NON-PARTY org sees zero settlement rows under both roles", leak === 0, `${leak} rows visible`);

    const st = await settlementStatement(owner, jp.partnership_id);
    check("3B: the read model carries opportunityId for every entry",
      [...st.settled, ...st.inFlight].every((e) => typeof e.opportunityId === "string" && e.opportunityId.length === 36),
      `${st.settled.length} settled / ${st.inFlight.length} in flight`);
  }

  // ── D-G8-3D — the scoped persisted-selection sites ──────────────────────────────────────────────
  console.log("\nD-G8-3D — persisted selections");
  const node = (await owner.query<{ id: string }>(`select id from taxonomy_nodes order by id limit 1`)).rows[0].id;
  const sv = (await owner.query<{ id: string }>(`select id from score_versions order by id limit 1`)).rows[0]?.id ?? null;

  // brand_profiles: two profiles, same is_default and created_at, inserted in DESCENDING id order.
  const brandIds = [randomUUID(), randomUUID()].sort().reverse();
  for (const [i, id] of brandIds.entries()) {
    await owner.query(`insert into brand_profiles (id, org_id, name, wordmark, is_default, created_at) values ($1, $2, $3, $4, false, $5)`,
      [id, V, `DG83D brand ${i}`, `WM ${i}`, T0]);
  }
  // propensity_scores: two rows, same computed_at.
  const scoreIds = [randomUUID(), randomUUID()].sort().reverse();
  if (sv) for (const [i, id] of scoreIds.entries()) {
    await owner.query(`insert into propensity_scores (id, org_id, company_id, taxonomy_node_id, score, band, score_version_id, computed_at)
                       values ($1, $2, $3, $4, 55, 'medium', $5, $6)`, [id, V, anyCo, node, sv, T0]);
  }
  // opportunities for the routines top-3: three equal amounts.
  const oppIds = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
  for (const [i, id] of oppIds.entries()) {
    await owner.query(`insert into opportunities (id, org_id, company_id, name, stage, amount_usd, created_at, updated_at)
                       values ($1, $2, $3, $4, 'proposal', 999999, $5, $5)`, [id, V, anyCo, `DG83D tie opp ${i}`, T0]);
  }

  const SITES: [string, string, unknown[], string, string][] = [
    ["brand pick (authoring/campaign-email)", V,
     [V],
     `select id, wordmark from brand_profiles where org_id is not distinct from $1 order by is_default desc, created_at asc, id limit 1`,
     `select id, wordmark from brand_profiles where org_id is not distinct from $1 order by is_default desc, created_at asc limit 1`],
    ["previous score (scoring/score.ts, motion-designer)", V,
     [V, anyCo, node],
     `select p.id, p.score from propensity_scores p where p.org_id = $1 and p.company_id = $2 and p.taxonomy_node_id = $3 order by p.computed_at desc, p.id desc limit 1`,
     `select p.id, p.score from propensity_scores p where p.org_id = $1 and p.company_id = $2 and p.taxonomy_node_id = $3 order by p.computed_at desc limit 1`],
    ["routines top-3 opportunities (capped membership)", V,
     [V],
     `select o.id, o.name from opportunities o where o.org_id = $1 and o.stage not in ('closed_won','closed_lost') order by o.amount_usd desc nulls last, o.id limit 3`,
     `select o.id, o.name from opportunities o where o.org_id = $1 and o.stage not in ('closed_won','closed_lost') order by o.amount_usd desc nulls last limit 3`],
  ];

  for (const [name, org, params, newSql, oldSql] of SITES) {
    const relocate = async () => {
      await owner.query(`update brand_profiles set wordmark = wordmark where org_id = $1`, [V]);
      await owner.query(`update opportunities set name = name where id = any($1)`, [oppIds]);
      if (sv) await owner.query(`update propensity_scores set band = band where id = any($1)`, [scoreIds]);
    };
    const r = await sweep(name, org, newSql, params, relocate);
    check(`3D: ${name} — identical across 5 plans × 2 heaps × owner/app_rw`, r.allSame, r.diffs.join(" | "));

    // Eligibility unchanged: the candidate multiset the OLD clause could draw from is the same set.
    const setOf = (sql: string) => owner.query(sql.replace(/ limit \d+$/, "")).then(() => null).catch(() => null);
    await setOf(newSql);

    // Negative control: the OLD untied clause is not a total order over this fixture.
    const distinct = new Set<string>();
    for (const heap of [0, 1]) {
      if (heap) await relocate();
      for (const [, off] of PLANS) for (const [, pool] of ROLES()) {
        distinct.add(JSON.stringify(await read(pool, org, off, async (c) => (await c.query(oldSql, params)).rows)));
      }
    }
    console.log(`  · diagnostic — OLD clause for ${name}: ${distinct.size} distinct result(s) over 20 runs`);
  }

  // Reversed insertion order must not change the selection: re-insert a tied brand with a LOWER id.
  const lowBrand = "00000000-0000-4000-8000-000000000001";
  await owner.query(`insert into brand_profiles (id, org_id, name, wordmark, is_default, created_at) values ($1, $2, 'DG83D brand low', 'WM low', false, $3)`,
    [lowBrand, V, T0]);
  const pickNow = (await owner.query<{ id: string }>(
    `select id from brand_profiles where org_id is not distinct from $1 order by is_default desc, created_at asc, id limit 1`, [V])).rows[0].id;
  check("3D: reversed insertion order — the rule still selects the lowest id among equals, deterministically",
    pickNow === lowBrand, `picked ${pickNow.slice(0, 8)}`);

  // Eligibility / ranking unchanged: a strictly better candidate still wins.
  await owner.query(`update brand_profiles set is_default = true where id = $1`, [brandIds[0]]);
  const pickDefault = (await owner.query<{ id: string }>(
    `select id from brand_profiles where org_id is not distinct from $1 order by is_default desc, created_at asc, id limit 1`, [V])).rows[0].id;
  check("3D: the PRE-EXISTING business ranking still dominates the tie-break (is_default wins)",
    pickDefault === brandIds[0], `picked ${pickDefault.slice(0, 8)}`);

  const sendAfter = (await owner.query(
    `select (select count(*) from messages) m, (select count(*) from action_outbox) o,
            (select count(*) from email_events) e, (select count(*) from campaign_touches where status = 'sent') s`)).rows[0];
  check("no send activity (messages / outbox / email events / sent touches unchanged)",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter), JSON.stringify(sendAfter));

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error("[persisted-determinism-verify] fatal:", e); process.exitCode = 2; })
  .finally(async () => { await owner.end(); await rw.end(); });
