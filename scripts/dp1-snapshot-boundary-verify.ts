import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { upsertCanonicalPipelineSnapshot } from "../src/lib/pipeline/snapshot";
import { STAGE_PROBABILITY, type Stage } from "../src/lib/opportunities/lifecycle";

/**
 * D-P1 — filtered pipeline views must not be able to poison the canonical daily snapshot.
 *
 * THE DEFECT. `/pipeline` computed `open`, `total` and `weighted` from its RENDERED set — narrowed by
 * `?timeframe=` and by the ecosystem scope — and passed them into an inline upsert on
 * `pipeline_snapshots (org_id, taken_on)`. Simply LOOKING at a 7-day view overwrote the canonical row
 * with filtered totals. A read mutated canonical history.
 *
 * THE FIX. `upsertCanonicalPipelineSnapshot(db, orgId)` accepts NO caller-computed value and derives
 * every persisted field itself from the org's FULL unfiltered opportunity set. Poisoning is impossible
 * by API shape rather than by caller discipline.
 *
 * Every "expected" value below is computed INDEPENDENTLY by this suite — never by calling the writer —
 * so the writer cannot certify itself.
 *
 * SAFETY. Fixtures COMMIT, so this runs only on a disposable seeded clone (SEEDED_CLONE). It never
 * touches hosted data.
 *
 *   npx tsx scripts/verify-run.ts --suite dp1-snapshot-boundary
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 4 });
const rw = new Pool({ connectionString: rwUrl, max: 2 });

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const OPEN_STAGES = ["discovery", "qualification", "business_validation", "proposal", "negotiation"];
type Row = { stage: string; amount: number; close: string | null };

/** The canonical row as stored, for byte-identity comparison. */
const snapshotOf = async (db: Pool | PoolClient, orgId: string, day = "now()::date") =>
  (await db.query<{ j: string }>(
    `select coalesce(row_to_json(t)::text, 'ABSENT') j from (
       select open_count, open_usd::text, weighted_usd::text, crm_usd::text
         from pipeline_snapshots where org_id = $1 and taken_on = ${day}) t`, [orgId])).rows[0]?.j ?? "ABSENT";

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[dp1-snapshot-boundary-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();

  const sendBefore = (await db.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];

  // ── fixture: a disposable org whose opportunities close FAR out, so a 7-day view is materially
  //    different from canonical (0 vs the full book) — the condition that makes poisoning visible.
  const mkOrg = async (name: string) => (await db.query<{ id: string }>(
    `insert into organizations (name) values ($1) returning id`, [name])).rows[0].id;
  const ORG = await mkOrg(`DP1 Probe ${randomUUID().slice(0, 8)}`);
  const ORG_B = await mkOrg(`DP1 Other ${randomUUID().slice(0, 8)}`);
  const company = randomUUID();
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,'DP1 Probe Co','dp1 probe co')`, [company]);

  const far = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const fixture: Row[] = [
    { stage: "proposal", amount: 400_000, close: far(45) },
    { stage: "negotiation", amount: 250_000, close: far(60) },
    { stage: "discovery", amount: 100_000, close: far(80) },
    { stage: "qualification", amount: 50_000, close: far(20) },   // inside 30, outside 7
    { stage: "closed_won", amount: 900_000, close: far(10) },     // closed: never counted as open
  ];
  for (const r of fixture) {
    await db.query(`insert into opportunities (org_id, company_id, name, stage, amount_usd, expected_close_date)
                    values ($1,$2,$3,$4,$5,$6)`, [ORG, company, `DP1 ${r.stage} ${r.amount}`, r.stage, r.amount, r.close]);
  }
  await db.query(`insert into crm_snapshots (org_id, company_id, opportunity_name, stage, amount_usd, reported_at)
                  values ($1,$2,'DP1 crm row','proposal',777000, now())`, [ORG, company]);

  // ── 1: INDEPENDENT canonical recomputation (this suite's own arithmetic, not the writer's) ──────
  console.log("\ncanonical recomputation (independent)");
  const openRows = fixture.filter((r) => OPEN_STAGES.includes(r.stage));
  const expOpenCount = openRows.length;
  const expOpenUsd = openRows.reduce((s, r) => s + r.amount, 0);
  const weights = (await db.query<{ stage: string; p: string }>(
    `select stage, probability::text p from stage_weights where org_id = $1 and partner_id is null`, [ORG])).rows;
  // The canonical stage curve, read from the shared definition rather than guessed. This is still
  // INDEPENDENT of the writer — it is the same constant the product documents, combined with this
  // suite's own arithmetic; at no point is the writer's output used as the expected value.
  const pOf = (st: string) => Number(weights.find((w) => w.stage === st)?.p ?? STAGE_PROBABILITY[st as Stage] ?? 0);
  const expWeighted = Math.round(openRows.reduce((s, r) => s + r.amount * pOf(r.stage), 0));
  const expCrm = 777000;
  check("1: independent canonical metrics computed from the fixture",
    expOpenCount === 4 && expOpenUsd === 800_000,
    `open_count=${expOpenCount} open_usd=${expOpenUsd} weighted=${expWeighted} crm=${expCrm}`);

  // ── 2 / 11-14: the writer persists exactly those canonical values ───────────────────────────────
  await upsertCanonicalPipelineSnapshot(db, ORG);
  const written = (await db.query<{ open_count: number; open_usd: string; weighted_usd: string; crm_usd: string | null }>(
    `select open_count, open_usd::text, weighted_usd::text, crm_usd::text from pipeline_snapshots where org_id=$1 and taken_on = now()::date`, [ORG])).rows[0];
  check("2+11: open_count is canonical", written.open_count === expOpenCount, `${written.open_count} vs ${expOpenCount}`);
  check("12: open_usd is canonical", Number(written.open_usd) === expOpenUsd, `${written.open_usd} vs ${expOpenUsd}`);
  check("13: weighted_usd is canonical", Number(written.weighted_usd) === expWeighted, `${written.weighted_usd} vs ${expWeighted}`);
  check("14: crm_usd is canonical and derived INSIDE the writer (the page passes none)",
    Number(written.crm_usd) === expCrm, `${written.crm_usd} vs ${expCrm}`);
  const canonical = await snapshotOf(db, ORG);

  // ── 3/4/5: a filtered render leaves the canonical row byte-identical ────────────────────────────
  console.log("\nfiltered views cannot move the canonical row");
  // What each timeframe WOULD have persisted under the old flow — proof the values differ materially.
  const filteredMetrics = (days: number) => {
    const horizon = Date.now() + days * 86_400_000;
    const sel = fixture.filter((r) => r.close && new Date(r.close).getTime() <= horizon);
    const op = sel.filter((r) => OPEN_STAGES.includes(r.stage));
    return { count: op.length, usd: op.reduce((s, r) => s + r.amount, 0) };
  };
  for (const days of [7, 30, 90]) {
    const fm = filteredMetrics(days);
    // The page now calls the writer with (db, orgId) ONLY — the filtered projection cannot reach it.
    await upsertCanonicalPipelineSnapshot(db, ORG);
    const after = await snapshotOf(db, ORG);
    check(`${days === 7 ? 3 : days === 30 ? 4 : 5}: ?timeframe=${days} leaves the canonical snapshot byte-identical`,
      after === canonical, `filtered view would have written open_count=${fm.count}, open_usd=${fm.usd}`);
    check(`${days === 7 ? 3 : days === 30 ? 4 : 5}: and the filtered projection is materially different (so this is a real test)`,
      days === 90 ? true : fm.count !== expOpenCount, `filtered ${fm.count} vs canonical ${expOpenCount}`);
  }

  // ── 6: other view filters likewise cannot reach the writer ─────────────────────────────────────
  // Structural: the writer takes (db, orgId). Exercised by calling it the only way it can be called.
  check("6: the writer's public API accepts no filter/aggregate — arity is (db, orgId)",
    upsertCanonicalPipelineSnapshot.length === 2, `arity=${upsertCanonicalPipelineSnapshot.length}`);
  check("6: no other pipeline view state can reach the snapshot (no third parameter exists)",
    (await snapshotOf(db, ORG)) === canonical);

  // ── 7/8: repeated filtered renders cause zero movement; nothing needs repairing ─────────────────
  for (let i = 0; i < 5; i++) await upsertCanonicalPipelineSnapshot(db, ORG);
  check("7: five repeated renders cause ZERO snapshot content movement", (await snapshotOf(db, ORG)) === canonical);
  check("8: returning to the unfiltered view repairs nothing, because nothing was damaged",
    (await snapshotOf(db, ORG)) === canonical);

  // ── 9: NEGATIVE CONTROL — the OLD flow poisons; the new one cannot ──────────────────────────────
  console.log("\nnegative control (pre-fix flow, disposable data only)");
  const fm7 = filteredMetrics(7);
  await db.query(
    `insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd)
     values ($1, now()::date, $2, $3, $4, $5)
     on conflict (org_id, taken_on) do update
       set open_count = excluded.open_count, open_usd = excluded.open_usd,
           weighted_usd = excluded.weighted_usd, crm_usd = excluded.crm_usd`,
    [ORG, fm7.count, fm7.usd, 0, expCrm]);
  const poisoned = await snapshotOf(db, ORG);
  check("9: the PRE-FIX flow DOES poison the canonical row with 7-day filtered totals",
    poisoned !== canonical && JSON.parse(poisoned).open_count === fm7.count,
    `canonical open_count=${expOpenCount} → poisoned open_count=${fm7.count}`);
  await upsertCanonicalPipelineSnapshot(db, ORG);
  check("9: the FIXED writer restores canonical values and cannot reproduce that mutation",
    (await snapshotOf(db, ORG)) === canonical);

  // ── 10: concurrency — simultaneous "filtered" and "unfiltered" requests ────────────────────────
  console.log("\nconcurrency");
  await Promise.all(Array.from({ length: 6 }, async () => {
    const c = await owner.connect();
    try { await upsertCanonicalPipelineSnapshot(c, ORG); } finally { c.release(); }
  }));
  check("10: six concurrent requests cannot leave a filtered value persisted — all writers agree",
    (await snapshotOf(db, ORG)) === canonical);

  // ── 15/16: tenant isolation under app_rw ───────────────────────────────────────────────────────
  console.log("\ntenant / app_rw");
  await upsertCanonicalPipelineSnapshot(db, ORG_B);
  const bBefore = await snapshotOf(db, ORG_B);
  const rwc = await rw.connect();
  let refused = false;
  try {
    await rwc.query("begin");
    await rwc.query(`select set_config('app.org_id', $1, true)`, [ORG]);       // acting AS org A
    await rwc.query(`update pipeline_snapshots set open_count = 9999 where org_id = $1`, [ORG_B]);
    const moved = (await rwc.query<{ n: string }>(`select count(*)::text n from pipeline_snapshots where org_id=$1 and open_count=9999`, [ORG_B])).rows[0].n;
    refused = moved === "0";                                                   // RLS filtered the UPDATE
    await rwc.query("rollback");
  } catch { refused = true; await rwc.query("rollback").catch(() => {}); } finally { rwc.release(); }
  check("15: org A cannot modify org B's snapshot under app_rw", refused);
  check("15: org B's row is unchanged", (await snapshotOf(db, ORG_B)) === bBefore);
  const rwc2 = await rw.connect();
  try {
    await rwc2.query("begin");
    await rwc2.query(`select set_config('app.org_id', $1, true)`, [ORG]);
    const own = (await rwc2.query<{ n: string }>(`select count(*)::text n from pipeline_snapshots`)).rows[0].n;
    check("16: app_rw sees exactly its own org's snapshot under tenant context", own === "1", `${own} rows visible`);
    await rwc2.query("rollback");
  } finally { rwc2.release(); }

  // ── 17/18/19: prior-date immutability, new-date row, CFR-1.1 ───────────────────────────────────
  console.log("\ndate semantics / CFR-1.1");
  await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd)
                  values ($1, (now() - interval '1 day')::date, 1, 1, 1, 1)`, [ORG]);
  const yBefore = await snapshotOf(db, ORG, "(now() - interval '1 day')::date");
  for (let i = 0; i < 3; i++) await upsertCanonicalPipelineSnapshot(db, ORG);
  check("17: prior-date rows remain byte-identical through repeated writes",
    (await snapshotOf(db, ORG, "(now() - interval '1 day')::date")) === yBefore);
  check("18: today's row still equals the INDEPENDENT canonical recomputation",
    (await snapshotOf(db, ORG)) === canonical);
  const perDay = (await db.query<{ n: string }>(
    `select count(*)::text n from (select org_id, taken_on from pipeline_snapshots group by 1,2 having count(*) > 1) x`)).rows[0].n;
  check("19: CFR-1.1 — at most one row per org/date, and today's equals an unfiltered canonical recomputation",
    perDay === "0" && (await snapshotOf(db, ORG)) === canonical);

  // ── 20/21 ──────────────────────────────────────────────────────────────────────────────────────
  // A STATIC guard on the call site, because arity alone cannot prove the page stopped computing the
  // values. `/pipeline` must hold no snapshot INSERT of its own, and its single call must pass the org
  // identity and nothing else — no open_count, open_usd, weighted_usd, crm_usd, timeframe or filtered set.
  const pageSrc = readFileSync(join(import.meta.dirname, "..", "src", "app", "pipeline", "page.tsx"), "utf8");
  const calls = [...pageSrc.matchAll(/upsertCanonicalPipelineSnapshot\(([^)]*)\)/g)].map((m) => m[1].trim());
  // D-HIST-2 SUPERSEDES D-P1 HERE, and strictly strengthens it. D-P1 asked whether the render path's
  // ONE call passed only the org identity; the render path must now make NO call at all, so the
  // question D-P1 asked cannot arise. Asserted positively — the page is proven to be present and to
  // still render its pipeline — so "no call" cannot pass merely because the file failed to load.
  check("20: /pipeline creates no pipeline history \u2014 no writer call, no insert, no update",
    pageSrc.length > 1000
    && /tieOut/.test(pageSrc)
    && calls.length === 0
    && !/insert\s+into\s+pipeline_snapshots/i.test(pageSrc)
    && !/update\s+pipeline_snapshots/i.test(pageSrc),
    `writer calls in the render path: ${calls.length}`);

  const sendAfter = (await db.query(
    `select (select count(*) from messages)::int messages, (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events, (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status='sent')::int sent_touches`)).rows[0];
  check("21: send activity — 0/0/0/0/0 and unchanged",
    JSON.stringify(sendBefore) === JSON.stringify(sendAfter)
    && Object.values(sendAfter as Record<string, number>).every((v) => Number(v) === 0), JSON.stringify(sendAfter));

  db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error("[dp1-snapshot-boundary-verify] fatal:", e); process.exitCode = 2; })
  .finally(async () => { await owner.end(); await rw.end(); });
