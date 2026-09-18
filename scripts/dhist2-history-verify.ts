import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { producePipelineSnapshot } from "../src/lib/pipeline/snapshot";

/**
 * D-HIST-2 — pipeline history has an explicit producer, honest provenance, and a UTC day.
 *
 * > **Observing canonical state may not create history as a side effect of the observation.**
 *
 * THE CONSUMER QUERIES ARE NOT RETYPED HERE. They are extracted from `/pipeline`'s own source and
 * executed verbatim, so this suite tests the query the page actually runs. A consumer that drifted
 * back to "find something old enough" would fail these checks rather than quietly passing beside a
 * copy that still looked strict.
 *
 *   npx tsx scripts/verify-run.ts --suite dhist2-history
 *
 * The suite COMMITS fixtures, so it runs on a disposable seeded clone.
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const owner = new Pool({ connectionString: CONN, max: 4 });

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const NS = `DHIST2-${randomUUID().slice(0, 8)}`;
const PAGE = readFileSync(new URL("../src/app/pipeline/page.tsx", import.meta.url), "utf8");

/** Pull a consumer's SQL out of the page, so the test cannot drift from the product. */
function extractQuery(marker: RegExp, label: string): string {
  const m = marker.exec(PAGE);
  if (!m) throw new Error(`INVALID: could not extract the ${label} query from /pipeline`);
  return m[1].replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  await assertSeededClone(owner);
  const db = await owner.connect();

  console.log(`\n── D-HIST-2 · fixtures ${NS}`);

  // ── fixtures: one org with a known opportunity set ──
  const orgId = String((await db.query(
    `insert into organizations (name, kind) values ($1, 'full') returning id`, [`${NS} Org`])).rows[0].id);
  await db.query(`insert into org_features (org_id, pursuits, facts, routing, pursuit_experience, federation)
                  values ($1, true, true, true, true, true)`, [orgId]);
  const companyId = String((await db.query(
    `insert into companies (legal_name, normalized_name) values ($1,$2) returning id`,
    [`${NS} Co`, NS.toLowerCase()])).rows[0].id);
  const addOpp = (amount: number, stage = "qualification") => db.query(
    `insert into opportunities (org_id, company_id, name, stage, amount_usd) values ($1,$2,$3,$4,$5)`,
    [orgId, companyId, `${NS} opp ${amount}`, stage, amount]);
  await addOpp(400000);
  await addOpp(100000);

  const utcToday = String((await db.query(`select (now() at time zone 'utc')::date::text d`)).rows[0].d);
  const rowsFor = async () => (await db.query<{ taken_on: string; source: string; open_usd: string; open_count: number }>(
    `select taken_on::text, source, open_usd, open_count from pipeline_snapshots where org_id = $1 order by taken_on`, [orgId])).rows;

  // ── 1. READ PURITY (structural — the observable half runs hosted) ──
  const calls = [...PAGE.matchAll(/producePipelineSnapshot\(([^)]*)\)/g)];
  check("1: the /pipeline render path contains no snapshot producer call",
    PAGE.length > 1000 && /tieOut/.test(PAGE) && calls.length === 0, `calls: ${calls.length}`);
  check("2: the render path contains no snapshot INSERT or UPDATE of its own",
    !/insert\s+into\s+pipeline_snapshots/i.test(PAGE) && !/update\s+pipeline_snapshots/i.test(PAGE));

  // ── 2. PRODUCER CAUSALITY ──
  check("3: no sample exists before the producer runs", (await rowsFor()).length === 0);
  await producePipelineSnapshot(db, orgId);
  const afterFirst = await rowsFor();
  check("4: the explicit producer creates exactly one sample for this org and UTC date",
    afterFirst.length === 1 && afterFirst[0].taken_on === utcToday,
    `${afterFirst.length} row(s) @ ${afterFirst[0]?.taken_on}`);
  check("5: it is stamped scheduled_daily_v1, never legacy",
    afterFirst[0]?.source === "scheduled_daily_v1", afterFirst[0]?.source);
  check("6: it records the org's FULL unfiltered open pipeline",
    Number(afterFirst[0].open_usd) === 500000 && afterFirst[0].open_count === 2,
    `${afterFirst[0].open_count} / ${afterFirst[0].open_usd}`);

  // ── 3. NO-VISIT INDEPENDENCE ──
  // Nothing rendered anything: the sample above came from a direct producer call.
  check("7: a valid sample exists with no /pipeline request having occurred", afterFirst.length === 1);

  // ── 4. FIRST-WRITE-WINS — semantic, not merely a row count ──
  await addOpp(2_000_000);   // canonical state changes AFTER the day's sample
  await producePipelineSnapshot(db, orgId);
  const afterSecond = await rowsFor();
  check("8: a second producer run does not create a duplicate row", afterSecond.length === 1);
  check("9: …and does not REVISE the day's sample — values are unchanged",
    JSON.stringify(afterSecond[0]) === JSON.stringify(afterFirst[0]),
    `${afterSecond[0].open_count} / ${afterSecond[0].open_usd}`);
  const live = await db.query<{ n: string; usd: string }>(
    `select count(*)::text n, coalesce(sum(amount_usd),0)::text usd from opportunities
      where org_id = $1 and stage not like 'closed%'`, [orgId]);
  check("10: the sample is deliberately behind live canonical state, which is what a SAMPLE means",
    live.rows[0].n === "3" && Number(afterSecond[0].open_usd) === 500000);

  // ── 5. PROVENANCE CANNOT BE ACQUIRED ACCIDENTALLY ──
  let omitted = "no error";
  try {
    await db.query("begin");
    await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd)
                    values ($1, (now() at time zone 'utc')::date - 1, 1, 1, 1)`, [orgId]);
    await db.query("rollback");
  } catch (e) { await db.query("rollback"); omitted = e instanceof Error ? e.message : String(e); }
  check("11: an insert that omits provenance FAILS rather than becoming legacy data",
    /null value in column "source"|violates not-null/i.test(omitted), omitted.slice(0, 60));

  let bogus = "no error";
  try {
    await db.query("begin");
    await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, source)
                    values ($1, (now() at time zone 'utc')::date - 1, 1, 1, 1, 'scheduled_daily_v2')`, [orgId]);
    await db.query("rollback");
  } catch (e) { await db.query("rollback"); bogus = e instanceof Error ? e.message : String(e); }
  check("12: the provenance vocabulary is closed", /pipeline_snapshots_source_check/.test(bogus), bogus.slice(0, 50));

  // ── 6. TIME BASIS — proven by RUNNING THE PRODUCER on a deliberately skewed session ──
  //
  // A check that merely compares two dates only discriminates when the ambient clock happens to put
  // UTC and the session on different days, so it would pass vacuously for most of the day. Instead a
  // timezone is CHOSEN so that the session's own date differs from UTC right now — UTC+14 and UTC-11
  // cannot both agree with UTC at the same instant — and the producer is then run on that session.
  // If it used `now()::date` it would write the session's day; it must write the UTC day.
  let skewTz = "", skewLocalDate = "";
  for (const tz of ["Pacific/Kiritimati", "Pacific/Midway"]) {
    const c = await owner.connect();
    try {
      await c.query(`set time zone '${tz}'`);
      const { rows } = await c.query<{ local: string; utc: string }>(
        `select now()::date::text local, (now() at time zone 'utc')::date::text utc`);
      if (rows[0].local !== rows[0].utc) { skewTz = tz; skewLocalDate = rows[0].local; break; }
    } finally { c.release(); }
  }
  check("13: a session timezone genuinely disagreeing with UTC was found, so the next check can bite",
    skewTz !== "" && skewLocalDate !== utcToday, `${skewTz || "none"} local=${skewLocalDate} utc=${utcToday}`);

  const skewOrg = String((await db.query(
    `insert into organizations (name, kind) values ($1, 'full') returning id`, [`${NS} Skew`])).rows[0].id);
  const skewed = await owner.connect();
  let skewTaken = "";
  try {
    await skewed.query(`set time zone '${skewTz}'`);
    await producePipelineSnapshot(skewed, skewOrg);
    skewTaken = String((await skewed.query<{ d: string }>(
      `select taken_on::text d from pipeline_snapshots where org_id = $1`, [skewOrg])).rows[0]?.d ?? "");
  } finally { skewed.release(); }
  check("14: the producer writes the UTC date even on a session whose own date differs",
    skewTaken === utcToday, `wrote ${skewTaken} · session-local would have been ${skewLocalDate}`);
  await db.query(`delete from pipeline_snapshots where org_id = $1`, [skewOrg]);
  await db.query(`delete from organizations where id = $1`, [skewOrg]);

  // ── 7. CONSUMER SEMANTICS — the page's OWN queries, extracted and executed ──
  const weekAgoSql = extractQuery(
    /select open_usd, taken_on::text from pipeline_snapshots\s*\n?\s*(where org_id = \$1[\s\S]*?)`/, "week-ago");
  check("15: the week-ago consumer requires an EXACT sample and excludes legacy",
    /source = 'scheduled_daily_v1'/.test(weekAgoSql) && /taken_on = \(\(now\(\) at time zone 'utc'\)::date - 7\)/.test(weekAgoSql),
    weekAgoSql.slice(0, 90));
  const weekAgo = async () => (await db.query(
    `select open_usd, taken_on::text from pipeline_snapshots ${weekAgoSql}`, [orgId])).rows;

  // A LEGACY row on exactly the right date must not satisfy it.
  await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, source)
                  values ($1, (now() at time zone 'utc')::date - 7, 9, 999999, 9, 'legacy_observation')`, [orgId]);
  check("16: a LEGACY row at exactly −7 does not satisfy the week-ago comparison", (await weekAgo()).length === 0);

  // Valid samples at −8 and −21 must not become "last week".
  for (const d of [8, 21]) {
    await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, source)
                    values ($1, (now() at time zone 'utc')::date - ($2)::int, 5, 555555, 5, 'scheduled_daily_v1')`, [orgId, d]);
  }
  check("17: valid samples at −8 and −21 do not become 'a week ago'", (await weekAgo()).length === 0);

  // The exact −7 valid sample makes the comparison available.
  await db.query(`delete from pipeline_snapshots where org_id = $1 and taken_on = (now() at time zone 'utc')::date - 7`, [orgId]);
  await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, source)
                  values ($1, (now() at time zone 'utc')::date - 7, 7, 777777, 7, 'scheduled_daily_v1')`, [orgId]);
  const wk = await weekAgo();
  check("18: a VALID sample at exactly −7 makes the comparison available",
    wk.length === 1 && Number(wk[0].open_usd) === 777777, JSON.stringify(wk[0]));

  // Calibration: exact horizons, valid provenance only.
  const calSql = extractQuery(/select distinct on \(bucket\) taken_on::text, weighted_usd, open_usd\s*\n?\s*(from \(\s*[\s\S]*?)`/, "calibration");
  check("19: the calibration consumer buckets EXACT horizons and excludes legacy",
    /source = 'scheduled_daily_v1'/.test(calSql)
    && /taken_on = \(\(now\(\) at time zone 'utc'\)::date - 60\)/.test(calSql)
    && /taken_on = \(\(now\(\) at time zone 'utc'\)::date - 30\)/.test(calSql),
    calSql.slice(0, 80));
  const cal = async () => (await db.query(`select distinct on (bucket) taken_on::text, weighted_usd, open_usd ${calSql}`, [orgId])).rows;
  check("20: with no sample at −30 or −60, the calibration card has NO buckets", (await cal()).length === 0);
  await db.query(`insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, source)
                  values ($1, (now() at time zone 'utc')::date - 30, 3, 333333, 3, 'legacy_observation')`, [orgId]);
  check("21: a LEGACY row at exactly −30 does not populate a bucket", (await cal()).length === 0);
  await db.query(`update pipeline_snapshots set source = 'scheduled_daily_v1'
                  where org_id = $1 and taken_on = (now() at time zone 'utc')::date - 30`, [orgId]);
  const calOne = await cal();
  check("22: a VALID sample at exactly −30 populates exactly one bucket, and −60 stays absent",
    calOne.length === 1, `${calOne.length} bucket(s)`);

  // ── 8. THE PRODUCER MUTATES NO CANONICAL BUSINESS STATE ──
  const canonical = async () => (await db.query<{ h: string }>(
    `select md5(string_agg(x.h, '' order by x.h)) h from (
       select md5(o::text) h from opportunities o where o.org_id = $1
       union all select md5(c::text) from companies c where c.id = $2
       union all select md5(f::text) from org_features f where f.org_id = $1) x`, [orgId, companyId])).rows[0].h;
  const before = await canonical();
  await producePipelineSnapshot(db, orgId);
  check("23: producing a sample changes no canonical business row", (await canonical()) === before);

  // ── cleanup: this suite's own fixtures only ──
  await db.query(`delete from pipeline_snapshots where org_id = $1`, [orgId]);
  await db.query(`delete from opportunities where org_id = $1`, [orgId]);
  await db.query(`delete from org_features where org_id = $1`, [orgId]);
  await db.query(`delete from companies where id = $1`, [companyId]);
  await db.query(`delete from organizations where id = $1`, [orgId]);
  const left = (await db.query<{ n: string }>(
    `select count(*)::text n from organizations where name like $1 || '%'`, [NS])).rows[0].n;
  check("24: fixture cleanup is exact", left === "0", left);

  db.release();
  console.log(`\nD-HIST-2: ${passed} passed, ${failed} failed`);
  if (failures.length) for (const f of failures) console.log(`   FAILED: ${f}`);
  await owner.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("dhist2 fatal:", e instanceof Error ? e.message : String(e)); process.exit(2); });
