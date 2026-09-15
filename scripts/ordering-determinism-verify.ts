import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { accountDivergences } from "../src/lib/context/divergence";
import { renewalProjection } from "../src/lib/lifecycle/projection";
import { loadTodayOverview } from "../src/lib/today/overview";

/**
 * Ordering determinism under any query plan and either runtime role (D-G5-1, found at H1B Gate 5).
 *
 * THE DEFECT. Two read paths returned TIED rows in whatever order the plan produced:
 *   - Today's "stage vs engagement" divergence rule (`limit 5`, no ORDER BY at all), so a capped Today
 *     showed a different deal when the order moved;
 *   - the renewal projection's list attribution (`distinct on (company) … order by company, created_at`)
 *     where one account sits on two lists created in the same statement (identical created_at), so the
 *     "on <list>" label on /pipeline could name either list.
 * On hosted, moving the runtime from the owner to app_rw changed the plans (RLS adds predicates), and
 * the order changed with them. Same data, same tenant, same code — different screen.
 *
 * THE CLAIM. After the fix, with ties PLANTED (on this disposable clone only):
 *   1. eligibility is unchanged — the qualifying set is exactly the one the old predicate selects;
 *   2. the capped result is exactly the documented key order (updated_at, id; created_at, name, id);
 *   3. the complete ordered payload is IDENTICAL across five planner configurations, two heap layouts
 *      and both roles (the owner, and the REAL app_rw login with the tenant context withTenant sets);
 *   4. negative control: the OLD SQL returns a different capped result over the same fixtures.
 *
 * SAFETY. Fixtures COMMIT, so the suite runs only on a disposable seeded clone (SEEDED_CLONE). Every read
 * runs in a transaction that is rolled back. No send path is touched.
 *
 *   npx tsx scripts/verify-run.ts --suite ordering-determinism
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo"; // local-only login, set by scripts/demo-db.ts
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 2 });
const rw = new Pool({ connectionString: rwUrl, max: 1 });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Planner configurations: each forces a different access path / join strategy. */
const PLANS: [string, string[]][] = [
  ["default", []],
  ["no index scans", ["enable_indexscan", "enable_indexonlyscan", "enable_bitmapscan"]],
  ["no seq scans", ["enable_seqscan"]],
  ["no hash/merge joins", ["enable_hashjoin", "enable_mergejoin"]],
  ["no nested loops", ["enable_nestloop"]],
];
const ROLES: [string, Pool][] = [["owner", owner], ["app_rw", rw]];

/** withTenant's mechanism (transaction-local app.org_id) plus planner switches; always rolled back. */
async function read<T>(pool: Pool, orgId: string, off: string[], fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const s of off) await c.query(`set local ${s} = off`);
    await c.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

// The rule's predicate, verbatim from divergence.ts. OLD = the pre-fix text (limit, no ORDER BY).
const STAGE_PREDICATE = `from opportunities o join companies c on c.id = o.company_id
     where o.stage in ('proposal', 'negotiation') and ($1::uuid is null or o.org_id = $1)
       and not exists (select 1 from engagement_scores es
                       where es.company_id = o.company_id and es.org_id = $1
                         and es.last_engaged_at > now() - interval '30 days')
       and not exists (select 1 from meeting_notes mn
                       where mn.company_id = o.company_id and mn.org_id = $1
                         and mn.met_at > (now() - interval '30 days')::date)`;
const OLD_STAGE_SQL = `select o.name ${STAGE_PREDICATE} limit 5`;

const namesOf = (divs: { kind: string; text: string }[], kind: string, re: RegExp) =>
  divs.filter((d) => d.kind === kind).map((d) => re.exec(d.text)?.[1] ?? "?");
const STAGE_RE = /^"(.+?)" sits at /, STALE_RE = /^"(.+?)" is open in the pipeline/;

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[ordering-determinism-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const V = (await owner.query<{ id: string }>(`select id from organizations where name = 'Vertex Systems'`)).rows[0].id;
  const sendBefore = (await owner.query(`select (select count(*) from messages) m, (select count(*) from action_outbox) o, (select count(*) from email_events) e`)).rows[0];

  const who = await read(rw, V, [], async (c) => (await c.query<{ u: string; b: boolean }>(
    `select current_user u, (select rolbypassrls from pg_roles where rolname = current_user) b`)).rows[0]);
  check("the second role is the REAL app_rw login, bound by RLS", who.u === "app_rw" && who.b === false, `${who.u} bypassrls=${who.b}`);

  // ── 1. Today / divergence ────────────────────────────────────────────────────────────────────────
  console.log("\nToday — 'stage vs engagement' (and the sibling capped rules)");
  const canonicalStage = await read(owner, V, [], (c) => accountDivergences(c, V, 12));
  const eligibleBefore = (await owner.query<{ name: string }>(`select o.name ${STAGE_PREDICATE}`, [V])).rows.map((r) => r.name).sort();
  check("canonical: every qualifying deal is shown (the fix changes order, never membership)",
    JSON.stringify(namesOf(canonicalStage, "stage_vs_engagement", STAGE_RE).sort()) === JSON.stringify(eligibleBefore),
    `${eligibleBefore.length} qualifying`);

  // Seven qualifying deals with IDENTICAL updated_at (older than every canonical one, so they take all
  // five capped slots), inserted in DESCENDING id order so heap order is the reverse of the key order.
  const T0 = "2026-01-01T00:00:00Z";
  const oppIds = Array.from({ length: 7 }, () => randomUUID()).sort().reverse();
  const nameById = new Map<string, string>();
  for (const [i, id] of oppIds.entries()) {
    const co = randomUUID();
    await owner.query(`insert into companies (id, legal_name, normalized_name) values ($1, $2, $3)`, [co, `DG51 Tie Co ${i}`, `dg51 tie co ${i}`]);
    await owner.query(
      `insert into opportunities (id, org_id, company_id, name, stage, amount_usd, created_at, updated_at)
       values ($1, $2, $3, $4, 'proposal', 100000, $5, $5)`, [id, V, co, `DG51 tie deal ${i}`, T0]);
    nameById.set(id, `DG51 tie deal ${i}`);
  }
  const expectedCapped = [...oppIds].sort().slice(0, 5).map((id) => nameById.get(id)!);
  const eligibleAfter = (await owner.query<{ name: string }>(`select o.name ${STAGE_PREDICATE}`, [V])).rows.map((r) => r.name).sort();
  check("fixtures: LIMIT is active (more qualifying deals than the cap of 5)", eligibleAfter.length > 5, `${eligibleAfter.length} qualifying`);
  check("eligibility unchanged: qualifying set = canonical set + exactly the 7 fixtures",
    JSON.stringify(eligibleAfter) === JSON.stringify([...eligibleBefore, ...nameById.values()].sort()));

  const divRuns: { label: string; json: string; stage: string[]; stale: string[] }[] = [];
  const todayRuns: { label: string; json: string }[] = [];
  const oldRuns: string[][] = [];
  for (const heap of ["heap: insertion order", "heap: tuples relocated"]) {
    if (heap.endsWith("relocated")) {
      // A real UPDATE writes new tuple versions (no trigger on opportunities; updated_at is untouched),
      // so sequential scans now meet half the fixtures in a different physical position.
      await owner.query(`update opportunities set next_step = next_step where id = any($1)`, [oppIds.filter((_, i) => i % 2 === 0)]);
      const ts = (await owner.query<{ n: string }>(`select count(distinct updated_at)::text n from opportunities where id = any($1)`, [oppIds])).rows[0].n;
      check("relocation kept every fixture's updated_at identical (the tie is still a tie)", ts === "1");
    }
    for (const [plan, off] of PLANS) {
      oldRuns.push((await read(owner, V, off, (c) => c.query<{ name: string }>(OLD_STAGE_SQL, [V]))).rows.map((r) => r.name));
      for (const [role, pool] of ROLES) {
        const divs = await read(pool, V, off, (c) => accountDivergences(c, V, 12));
        const label = `${heap} · ${plan} · ${role}`;
        divRuns.push({ label, json: JSON.stringify(divs), stage: namesOf(divs, "stage_vs_engagement", STAGE_RE), stale: namesOf(divs, "stale_deal", STALE_RE) });
        todayRuns.push({ label, json: JSON.stringify(await read(pool, V, off, (c) => loadTodayOverview(c, V, null))) });
      }
    }
  }
  const r0 = divRuns[0];
  check("capped 'stage vs engagement' = the five lowest ids among the tied deals, in id order",
    JSON.stringify(r0.stage) === JSON.stringify(expectedCapped), JSON.stringify(r0.stage));
  check("capped 'stale deal' (same tie) = the same five, in id order (tie-breaker appended to its existing updated_at order)",
    JSON.stringify(r0.stale) === JSON.stringify(expectedCapped));
  const divDiff = divRuns.filter((r) => r.json !== r0.json).map((r) => r.label);
  check(`divergences: complete ordered payload identical across ${divRuns.length} runs (5 plans × 2 heaps × owner/app_rw)`,
    divDiff.length === 0, divDiff.length ? `differs: ${divDiff.join(" | ")}` : "");
  const todayDiff = todayRuns.filter((r) => r.json !== todayRuns[0].json).map((r) => r.label);
  check(`Today overview (loadTodayOverview): complete ordered payload identical across ${todayRuns.length} runs`,
    todayDiff.length === 0, todayDiff.length ? `differs: ${todayDiff.join(" | ")}` : "");
  const oldWrong = oldRuns.filter((o) => JSON.stringify(o) !== JSON.stringify(expectedCapped)).length;
  const oldShapes = new Set(oldRuns.map((o) => JSON.stringify(o))).size;
  check("negative control: the OLD SQL (limit 5, no ORDER BY) does not return the key-ordered capped result",
    oldWrong > 0, `${oldWrong}/${oldRuns.length} old runs differ from the key order · ${oldShapes} distinct old result(s)`);

  // ── 2. Pipeline / renewal projection list attribution ──────────────────────────────────────────────
  console.log("\nPipeline — renewal list attribution");
  const opts = { days: 120, limit: 12 };
  const baseRows = await read(owner, V, [], (c) => renewalProjection(c, V, opts));
  const target = baseRows.find((r) => r.listName);
  check("canonical: a renewal row with list attribution exists", !!target, target ? target.legalName : "none");
  if (!target) throw new Error("no attributed renewal row to test");
  const lists = (await owner.query<{ id: string; name: string; created_at: Date }>(
    `select ap.id, ap.name, ap.created_at from population_members pm join account_populations ap on ap.id = pm.population_id
      where ap.org_id = $1 and ap.status = 'approved' and pm.company_id = $2 order by ap.created_at, ap.name, ap.id`, [V, target.companyId])).rows;
  const canonicalTie = lists.filter((l) => l.created_at.getTime() === lists[0].created_at.getTime()).length;
  check("canonical: the label is the first list by (created_at, name, id)", target.listName === lists[0].name,
    `${target.legalName}: "${target.listName}" · ${lists.length} lists, ${canonicalTie} share the earliest created_at`);

  // Two more lists at the SAME created_at, both sorting first by name; the alphabetically first one gets the
  // LARGER id, so the result shows name — not id — decides, and id only guarantees uniqueness after it.
  const listIds = [randomUUID(), randomUUID()].sort().reverse();
  const fx = [[listIds[0], "0 DG51 tie list A"], [listIds[1], "0 DG51 tie list B"]] as const;
  for (const [id, name] of fx) {
    await owner.query(
      `insert into account_populations (id, org_id, name, category, status, created_by, created_at) values ($1, $2, $3, 'target', 'approved', 'dg51-fixture', $4)`,
      [id, V, name, lists[0].created_at]);
    await owner.query(`insert into population_members (population_id, company_id) values ($1, $2)`, [id, target.companyId]);
  }
  const shape = (rows: typeof baseRows) => JSON.stringify(rows.map((r) => ({ ...r, listName: null })));
  const projRuns: { label: string; json: string; label_: string | null; scopedLabel: string | null; shape: string }[] = [];
  for (const heap of ["heap: insertion order", "heap: tuples relocated"]) {
    if (heap.endsWith("relocated")) await owner.query(`update account_populations set category = category where id = any($1)`, [[...listIds, ...lists.map((l) => l.id)]]);
    for (const [plan, off] of PLANS) for (const [role, pool] of ROLES) {
      const rows = await read(pool, V, off, (c) => renewalProjection(c, V, opts));
      const scoped = await read(pool, V, off, (c) => renewalProjection(c, V, { ...opts, approvedListsOnly: true }));
      projRuns.push({
        label: `${heap} · ${plan} · ${role}`, json: JSON.stringify([rows, scoped]), shape: shape(rows),
        label_: rows.find((r) => r.companyId === target.companyId)?.listName ?? null,
        scopedLabel: scoped.find((r) => r.companyId === target.companyId)?.listName ?? null,
      });
    }
  }
  check("tied lists: the label is the first by name (created_at equal), on the unscoped path",
    projRuns.every((r) => r.label_ === "0 DG51 tie list A"), JSON.stringify([...new Set(projRuns.map((r) => r.label_))]));
  check("tied lists: the same label on the approved-lists-only path (the other distinct-on query)",
    projRuns.every((r) => r.scopedLabel === "0 DG51 tie list A"), JSON.stringify([...new Set(projRuns.map((r) => r.scopedLabel))]));
  check("eligibility unchanged: the renewal rows (everything but the label) equal the pre-fixture rows",
    projRuns.every((r) => r.shape === shape(baseRows)), `${baseRows.length} rows`);
  const projDiff = projRuns.filter((r) => r.json !== projRuns[0].json).map((r) => r.label);
  check(`renewal projection: complete ordered payload identical across ${projRuns.length} runs (5 plans × 2 heaps × owner/app_rw)`,
    projDiff.length === 0, projDiff.length ? `differs: ${projDiff.join(" | ")}` : "");

  // ── 3. Pipeline / stakeholder list order (D-G8-1) ────────────────────────────────────────────────
  // The query is read from the page itself, so this checks the text that actually renders. The rule is
  // (opportunity, displayed label = coalesce(name, email), contact_id): stakeholders' primary key is
  // (opportunity_id, contact_id), so the order is total. "OLD" is the same text with no ORDER BY.
  console.log("\nPipeline — stakeholder list order (D-G8-1)");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pageSrc = readFileSync(join(process.cwd(), "src", "app", "pipeline", "page.tsx"), "utf8");
  const NEW_ST = [...pageSrc.matchAll(/`([^`]*from stakeholders s join contacts ct[^`]*)`/g)][0]?.[1];
  if (!NEW_ST) throw new Error("the /pipeline stakeholder query was not found in page.tsx");
  const OLD_ST = NEW_ST.replace(/\s+order by[\s\S]*$/i, "");
  check("the rendered /pipeline stakeholder query carries an explicit ORDER BY", NEW_ST !== OLD_ST);
  const allOpps = (await owner.query<{ id: string }>(`select id from opportunities where org_id = $1`, [V])).rows.map((r) => r.id);
  const stOpp = (await owner.query<{ id: string }>(
    `select id from opportunities where org_id = $1 and stage not in ('closed_won', 'closed_lost') order by amount_usd desc nulls last, id limit 1`, [V])).rows[0].id;
  const pairs = async (sql: string) => (await read(owner, V, [], (c) => c.query<{ opportunity_id: string; contact_id: string }>(sql, [allOpps, V])))
    .rows.map((r) => `${r.opportunity_id}:${r.contact_id}`).sort();
  const eligibleStBefore = await pairs(OLD_ST);

  // Five stakeholders on one open deal with IDENTICAL role / sentiment / assertion state. Two share a label (so
  // contact_id must decide), one has no name (its email is the label the card shows). Inserted in DESCENDING
  // contact-id order, with labels chosen so insertion, id and label order all disagree.
  const cids = Array.from({ length: 5 }, () => randomUUID()).sort().reverse();
  const stNames = ["DG81 Tie Delta", "DG81 Tie Alpha", "DG81 Tie Charlie", "DG81 Tie Alpha", null];
  for (const [i, id] of cids.entries()) {
    await owner.query(`insert into contacts (id, org_id, email, name, source) values ($1, $2, $3, $4, 'dg81-fixture')`, [id, V, `dg81-tie-${i}@example.invalid`, stNames[i]]);
    await owner.query(`insert into stakeholders (opportunity_id, contact_id, role, sentiment) values ($1, $2, 'influencer', 'unknown')`, [stOpp, id]);
  }
  // The documented rule, applied by Postgres itself (same collation as the page query) to that deal alone.
  const expectedSt = (await owner.query<{ contact_id: string }>(
    `select s.contact_id from stakeholders s join contacts ct on ct.id = s.contact_id where s.opportunity_id = $1
      order by coalesce(ct.name, ct.email), s.contact_id`, [stOpp])).rows.map((r) => r.contact_id);
  const eligibleStAfter = await pairs(OLD_ST);
  check("eligibility unchanged: qualifying stakeholders = canonical set + exactly the 5 fixtures",
    JSON.stringify(eligibleStAfter) === JSON.stringify([...eligibleStBefore, ...cids.map((c) => `${stOpp}:${c}`)].sort()),
    `${eligibleStAfter.length} qualifying`);
  check("the new query selects exactly the rows the old one did (no filter / join / scope change)",
    JSON.stringify(await pairs(NEW_ST)) === JSON.stringify(eligibleStAfter));

  const stRuns: { label: string; json: string; deal: string[] }[] = [];
  const oldStRuns: string[][] = [];
  for (const heap of ["heap: insertion order", "heap: tuples relocated"]) {
    // role and assertion_state untouched, so the governed-assertion guard allows this no-op relocation.
    if (heap.endsWith("relocated")) await owner.query(`update stakeholders set sentiment = sentiment where opportunity_id = $1 and contact_id = any($2)`, [stOpp, cids.filter((_, i) => i % 2 === 0)]);
    for (const [plan, off] of PLANS) {
      oldStRuns.push((await read(owner, V, off, (c) => c.query<{ opportunity_id: string; contact_id: string }>(OLD_ST, [allOpps, V]))).rows
        .filter((r) => r.opportunity_id === stOpp).map((r) => r.contact_id));
      for (const [role, pool] of ROLES) {
        const rows = (await read(pool, V, off, (c) => c.query(NEW_ST, [allOpps, V]))).rows;
        stRuns.push({ label: `${heap} · ${plan} · ${role}`, json: JSON.stringify(rows), deal: rows.filter((r) => r.opportunity_id === stOpp).map((r) => r.contact_id) });
      }
    }
  }
  check("the deal's stakeholders render in the documented order (label, then contact_id — ties included)",
    JSON.stringify(stRuns[0].deal) === JSON.stringify(expectedSt), `${stRuns[0].deal.length} stakeholders`);
  const stDiff = stRuns.filter((r) => r.json !== stRuns[0].json).map((r) => r.label);
  check(`stakeholder query: complete ordered payload identical across ${stRuns.length} runs (5 plans × 2 heaps × owner/app_rw)`,
    stDiff.length === 0, stDiff.length ? `differs: ${stDiff.join(" | ")}` : "");
  const oldStWrong = oldStRuns.filter((o) => JSON.stringify(o) !== JSON.stringify(expectedSt)).length;
  check("negative control: the OLD stakeholder query (no ORDER BY) does not return the documented order",
    oldStWrong > 0, `${oldStWrong}/${oldStRuns.length} old runs differ · ${new Set(oldStRuns.map((o) => JSON.stringify(o))).size} distinct old order(s)`);

  const sendAfter = (await owner.query(`select (select count(*) from messages) m, (select count(*) from action_outbox) o, (select count(*) from email_events) e`)).rows[0];
  check("no send activity (messages / outbox / email events unchanged)", JSON.stringify(sendBefore) === JSON.stringify(sendAfter));

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error("[ordering-determinism-verify] fatal:", e); process.exitCode = 2; })
  .finally(async () => { await owner.end(); await rw.end(); });
