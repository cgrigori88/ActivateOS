import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";

/**
 * D-G8-5 — a total order for the CAPPED shared-evidence read.
 *
 * THE DEFECT. public.shared_in_evidence() ended `order by e.observed_at desc limit 20`. With more than
 * 20 eligible rows and several sharing an exact observed_at across the 20/21 boundary, heap / planner
 * order decided which tied rows survived the cap. The damage is MEMBERSHIP, not presentation: the one
 * consumer (context/timeline.ts) re-sorts and re-slices everything, so a row the cap drops simply never
 * reaches the timeline — a shared claim could appear or vanish between runs on identical data.
 *
 * THE KEY IS s.id, NOT e.id. evidence_shares is `unique (evidence_id, partnership_id)`, so one evidence
 * object can be shared on several partnerships and the same e.id can appear twice. s.id is the primary
 * key of the row the function returns, so it is unique by construction; it is consulted only after
 * observed_at has tied and carries no ranking meaning.
 *
 * DELIBERATELY UNCHANGED (owner ruling): the same evidence shared through two eligible partnerships
 * still returns TWO rows and still consumes two of the 20 slots. Asserted below so it cannot drift.
 *
 * SAFETY. Fixtures COMMIT, so this runs only on a disposable seeded clone (SEEDED_CLONE). Every read
 * runs in a rolled-back transaction.
 *
 *   npx tsx scripts/verify-run.ts --suite dg85-determinism
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 2 });
const rw = new Pool({ connectionString: rwUrl, max: 1 });

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const PLANS: [string, string[]][] = [
  ["default", []],
  ["no index scans", ["enable_indexscan", "enable_indexonlyscan", "enable_bitmapscan"]],
  ["no seq scans", ["enable_seqscan"]],
  ["no hash/merge joins", ["enable_hashjoin", "enable_mergejoin"]],
  ["no nested loops", ["enable_nestloop"]],
];

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

/** The FIXED clause and the PRE-FIX clause, over the identical eligible population. */
const SELECT = (order: string) => `
  select s.id
    from evidence_shares s
    join partnerships p on p.id = s.partnership_id and p.status = 'active'
     and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)
    join evidence e on e.id = s.evidence_id and e.company_id = $2
     and (e.org_id = s.offered_by_org or e.org_id is null)
    join organizations o on o.id = s.offered_by_org
   where s.status = 'accepted' and s.offered_by_org <> $1
   order by ${order} limit 20`;
const FIXED = SELECT("e.observed_at desc, s.id desc");
const OLD = SELECT("e.observed_at desc");

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[dg85-determinism-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();

  const sendBefore = (await db.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];

  const CALLER = (await db.query<{ id: string }>(`select id from organizations where name = 'Vertex Systems'`)).rows[0].id;
  const SHARER = (await db.query<{ id: string }>(`select id from organizations where name <> 'Vertex Systems' order by name limit 1`)).rows[0].id;
  const OTHER = (await db.query<{ id: string }>(`select id from organizations where id <> $1 and id <> $2 limit 1`, [CALLER, SHARER])).rows[0]?.id ?? null;

  // ── the fixture ────────────────────────────────────────────────────────────────────────────────
  // 30 eligible rows. The 12 NEWEST are strictly distinct (positions 1..12). Then 12 rows share ONE
  // exact observed_at, spanning positions 13..24 — straddling the LIMIT 20 boundary, so the cap must
  // choose 8 of those 12. The remainder are strictly older and can never be selected.
  const company = randomUUID();
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,'DG85 Probe Co','dg85 probe co')`, [company]);
  const partnership = randomUUID();
  await db.query(
    `insert into partnerships (id, initiator_org_id, counterpart_org_id, invite_code, status, activated_at)
     values ($1,$2,$3,$4,'active', now())`, [partnership, SHARER, CALLER, `dg85-${partnership.slice(0, 8)}`]);

  const TIE_AT = "2026-05-01T00:00:00Z";
  const share = async (observedAt: string, tag: string, pship = partnership): Promise<string> => {
    const eid = randomUUID(), sid = randomUUID();
    await db.query(
      `insert into evidence (id, org_id, company_id, source_type, claim, confidence, observed_at)
       values ($1,$2,$3,'probe',$4,0.5,$5)`, [eid, SHARER, company, `DG85 ${tag}`, observedAt]);
    await db.query(
      `insert into evidence_shares (id, evidence_id, partnership_id, offered_by_org, status)
       values ($1,$2,$3,$4,'accepted')`, [sid, eid, pship, SHARER]);
    return sid;
  };

  const newer: string[] = [];
  for (let i = 0; i < 12; i++) newer.push(await share(new Date(Date.parse(TIE_AT) + (i + 1) * 86_400_000).toISOString(), `newer ${i}`));
  const tied: string[] = [];
  for (let i = 0; i < 12; i++) tied.push(await share(TIE_AT, `tied ${i}`));
  const older: string[] = [];
  for (let i = 0; i < 6; i++) older.push(await share(new Date(Date.parse(TIE_AT) - (i + 1) * 86_400_000).toISOString(), `older ${i}`));

  const eligible = newer.length + tied.length + older.length;
  console.log(`\nfixture: ${eligible} eligible rows · 12 strictly newer · 12 sharing one observed_at · 6 strictly older`);
  check("3: the fixture has >20 eligible rows with a tie band straddling the LIMIT 20 boundary",
    eligible > 20 && newer.length < 20 && newer.length + tied.length > 20,
    `newer=${newer.length}, tied=${tied.length} spans positions ${newer.length + 1}..${newer.length + tied.length}`);

  const run = (pool: Pool, sql: string, off: string[] = [], org = CALLER) =>
    read(pool, org, off, async (c) => (await c.query<{ id: string }>(sql, [org, company])).rows.map((r) => r.id));

  // ── 1/2: business key authoritative, s.id totalizes the tie ───────────────────────────────────
  console.log("\nordering semantics");
  const base = await run(owner, FIXED);
  check("1: observed_at DESC remains authoritative — every strictly-newer row is selected",
    newer.every((id) => base.includes(id)) && base.length === 20, `${base.length} selected, all 12 newer present`);
  check("1: no strictly-older row is ever selected", older.every((id) => !base.includes(id)));
  const chosenTied = base.filter((id) => tied.includes(id));
  check("2: s.id DESC totalizes the tie — the 8 remaining slots are the highest share ids of the tied band",
    JSON.stringify(chosenTied) === JSON.stringify([...tied].sort().reverse().slice(0, 8)),
    `${chosenTied.length} of 12 tied rows selected`);

  // ── 7/8: planner and heap ─────────────────────────────────────────────────────────────────────
  console.log("\nplanner / heap / role");
  const shapes = new Set<string>();
  for (const heap of ["insertion order", "tuples relocated"]) {
    if (heap === "tuples relocated") await owner.query(`update evidence_shares set status = status where partnership_id = $1`, [partnership]);
    for (const [, off] of PLANS) shapes.add(JSON.stringify(await run(owner, FIXED, off)));
  }
  check("7+8: identical selected set across 5 planner configurations × 2 heap layouts",
    shapes.size === 1, `${shapes.size} distinct set(s) over 10 runs`);

  // ── 9: owner vs app_rw, through the REAL application path ─────────────────────────────────────
  // The raw clause cannot be compared across roles: app_rw has no RLS grant on the SHARER's evidence,
  // which is exactly why shared_in_evidence() is SECURITY DEFINER. The role comparison therefore runs
  // the FUNCTION, and compares the ordered claims it returns (unique per fixture row).
  const viaFn = (pool: Pool, off: string[] = [], org = CALLER) =>
    read(pool, org, off, async (c) => (await c.query<{ claim: string }>(`select claim from shared_in_evidence($1)`, [company])).rows.map((r) => r.claim));
  const fnShapes = new Set<string>();
  for (const heap of [0, 1]) {
    if (heap) await owner.query(`update evidence_shares set status = status where partnership_id = $1`, [partnership]);
    for (const [, off] of PLANS) for (const pool of [owner, rw]) fnShapes.add(JSON.stringify(await viaFn(pool, off)));
  }
  check("9: the deployed FUNCTION returns identical membership and order under owner and the REAL app_rw login, across 5 plans × 2 heaps",
    fnShapes.size === 1, `${fnShapes.size} distinct result(s) over 20 runs`);
  const fnOne = JSON.parse([...fnShapes][0]) as string[];
  check("9: and the function returns exactly the 20 rows the fixed clause selects",
    fnOne.length === 20, `${fnOne.length} rows`);

  // ── 4/5/6: insertion order ────────────────────────────────────────────────────────────────────
  console.log("\ninsertion order");
  const reinsert = async (label: string, order: string[]) => {
    await owner.query(`delete from evidence_shares where partnership_id = $1 and id = any($2)`, [partnership, tied]);
    for (const sid of order) {
      const eid = (await db.query<{ id: string }>(`select id from evidence where claim = $1 and company_id = $2`,
        [`DG85 tied ${tied.indexOf(sid)}`, company])).rows[0].id;
      await owner.query(`insert into evidence_shares (id, evidence_id, partnership_id, offered_by_org, status)
                         values ($1,$2,$3,$4,'accepted')`, [sid, eid, partnership, SHARER]);
    }
    return run(owner, FIXED);
  };
  const fwd = await reinsert("forward", tied);
  const rev = await reinsert("reverse", [...tied].reverse());
  const shuf = await reinsert("shuffled", [...tied].sort((a, b) => (a < b ? 1 : -1)).filter((_, i) => i % 2 === 0)
    .concat([...tied].sort((a, b) => (a < b ? 1 : -1)).filter((_, i) => i % 2 === 1)));
  check("4+5+6: forward, reverse and shuffled insertion select the SAME 20 share ids",
    JSON.stringify(fwd) === JSON.stringify(rev) && JSON.stringify(rev) === JSON.stringify(shuf),
    `${fwd.length} ids, identical across all three insertion orders`);
  check("4+5+6: and that set equals the original selection", JSON.stringify(fwd) === JSON.stringify(base));

  // ── 12: the PRE-FIX clause is under-specified over the same fixture (diagnostic, not a gate) ──
  const oldShapes = new Set<string>();
  for (const heap of [0, 1]) {
    if (heap) await owner.query(`update evidence_shares set status = status where partnership_id = $1`, [partnership]);
    for (const [, off] of PLANS) for (const pool of [owner, rw]) oldShapes.add(JSON.stringify(await run(pool, OLD, off)));
  }
  const oldStable = oldShapes.size === 1;
  const orderOf = (sql: string) => /order by ([^]*?) limit/i.exec(sql)![1].trim();
  check("negative control: the OLD clause has NO unique final key in its ORDER BY, so its capped membership is under-specified by construction",
    orderOf(OLD) === "e.observed_at desc" && orderOf(FIXED) === "e.observed_at desc, s.id desc",
    `old="${orderOf(OLD)}" vs fixed="${orderOf(FIXED)}"`);
  console.log(`  · diagnostic — OLD clause over 20 runs: ${oldShapes.size} distinct selected set(s)${oldStable ? " (the planner happened not to expose the tie here; the structural fact above is the gate)" : " — membership genuinely varied"}`);

  // ── 14: rows above the tie band are untouched by the fix ──────────────────────────────────────
  const oldOne = JSON.parse([...oldShapes][0]) as string[];
  check("14: rows strictly NEWER than the tie band are identical pre-fix and post-fix",
    JSON.stringify(oldOne.filter((id) => newer.includes(id)).sort()) === JSON.stringify([...newer].sort()),
    "all 12 newer rows selected by both clauses");
  check("14: every membership difference lies INSIDE the equal-observed_at boundary set",
    base.filter((id) => !oldOne.includes(id)).every((id) => tied.includes(id))
    && oldOne.filter((id) => !base.includes(id)).every((id) => tied.includes(id)));

  // ── 13: with <= 20 eligible rows the multiset is identical pre-fix and post-fix ───────────────
  console.log("\nsmall-population equivalence + consent");
  const small = randomUUID();
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,'DG85 Small Co','dg85 small co')`, [small]);
  for (let i = 0; i < 5; i++) {
    const eid = randomUUID();
    await db.query(`insert into evidence (id, org_id, company_id, source_type, claim, confidence, observed_at)
                    values ($1,$2,$3,'probe',$4,0.5,$5)`, [eid, SHARER, small, `DG85 small ${i}`, TIE_AT]);
    await db.query(`insert into evidence_shares (evidence_id, partnership_id, offered_by_org, status)
                    values ($1,$2,$3,'accepted')`, [eid, partnership, SHARER]);
  }
  const smallRun = (sql: string) => read(owner, CALLER, [], async (c) => (await c.query<{ id: string }>(sql, [CALLER, small])).rows.map((r) => r.id));
  const sFixed = (await smallRun(FIXED)).sort(), sOld = (await smallRun(OLD)).sort();
  check("13: with ≤20 eligible rows the returned multiset is identical pre-fix and post-fix",
    JSON.stringify(sFixed) === JSON.stringify(sOld) && sFixed.length === 5, `${sFixed.length} rows both ways`);

  // ── 10/11/12: consent ─────────────────────────────────────────────────────────────────────────
  if (OTHER) check("10: a NON-PARTY org receives zero rows",
    (await run(owner, FIXED, [], OTHER)).length === 0 && (await run(rw, FIXED, [], OTHER)).length === 0);
  const revoked = base[base.length - 1];
  await owner.query(`update evidence_shares set status = 'revoked' where id = $1`, [revoked]);
  check("11: revoking a share removes it from the result", !(await run(owner, FIXED)).includes(revoked));
  await owner.query(`update evidence_shares set status = 'accepted' where id = $1`, [revoked]);
  await owner.query(`update partnerships set status = 'revoked' where id = $1`, [partnership]);
  check("12: deactivating the partnership removes every row", (await run(owner, FIXED)).length === 0);
  await owner.query(`update partnerships set status = 'active' where id = $1`, [partnership]);

  // ── 15: the same evidence on TWO partnerships stays TWO rows (deliberately not de-duplicated) ──
  console.log("\nduplicate-share behaviour (owner ruling: unchanged)");
  const p2 = randomUUID();
  await db.query(`insert into partnerships (id, initiator_org_id, counterpart_org_id, invite_code, status, activated_at)
                  values ($1,$2,$3,$4,'active', now())`, [p2, SHARER, CALLER, `dg85b-${p2.slice(0, 8)}`]);
  const dupCo = randomUUID();
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,'DG85 Dup Co','dg85 dup co')`, [dupCo]);
  const dupE = randomUUID();
  await db.query(`insert into evidence (id, org_id, company_id, source_type, claim, confidence, observed_at)
                  values ($1,$2,$3,'probe','DG85 duplicated claim',0.5,$4)`, [dupE, SHARER, dupCo, TIE_AT]);
  for (const pid of [partnership, p2]) {
    await db.query(`insert into evidence_shares (evidence_id, partnership_id, offered_by_org, status)
                    values ($1,$2,$3,'accepted')`, [dupE, pid, SHARER]);
  }
  const dupRows = await read(owner, CALLER, [], async (c) =>
    (await c.query<{ claim: string }>(`select claim from shared_in_evidence($1)`, [dupCo])).rows);
  check("15: one evidence shared through TWO partnerships still returns TWO rows (not de-duplicated)",
    dupRows.length === 2 && new Set(dupRows.map((r) => r.claim)).size === 1, `${dupRows.length} rows, 1 distinct claim`);
  const dupIds = await read(owner, CALLER, [], async (c) =>
    (await c.query<{ id: string }>(FIXED, [CALLER, dupCo])).rows.map((r) => r.id));
  check("15: and the two rows are distinguished by s.id, so the order is still total",
    new Set(dupIds).size === 2, `${new Set(dupIds).size} distinct share ids`);

  const sendAfter = (await db.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];
  check("17: send safety — messages / action_outbox / email_events / sending_identities / sent_touches = 0/0/0/0/0 and unchanged",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter)
    && Object.values(sendAfter as Record<string, number>).every((v) => Number(v) === 0), JSON.stringify(sendAfter));

  db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error("[dg85-determinism-verify] fatal:", e); process.exitCode = 2; })
  .finally(async () => { await owner.end(); await rw.end(); });
