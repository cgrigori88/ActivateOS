/**
 * P2C-1 §16 latency. Three numbers matter and they are measured separately, because a single
 * "response time" would hide the only question worth asking: does introducing an interpreter tier
 * slow down the queries that never touch it?
 *
 *   GOTO           entity navigation — must never pay for the model's existence
 *   DETERMINISTIC  parsed and resolved — the model is not consulted at all
 *   INTERPRETED    interpretation + validation + entity resolution + resolution
 *
 * The interpreter is driven through an injected transport with a fixed simulated latency, so the
 * numbers below isolate OUR overhead (validation, entity resolution, resolver) from the provider's
 * round trip, which varies by network and model and is not ours to report.
 *
 *   DEMO_URL=... npx tsx scripts/interpret-perf.ts
 */
import { Pool, type PoolClient } from "pg";
import { answerQuestion } from "../src/lib/interpret/answer";
import type { InterpretTransport, RawInterpretation } from "../src/lib/interpret/interpreter";
import "../src/lib/search/intents";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const N = Number(process.env.N ?? 25);

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const report = (label: string, xs: number[]) =>
  console.log(`  ${label.padEnd(46)} p50 ${String(pct(xs, 0.5)).padStart(5)}ms   p95 ${String(pct(xs, 0.95)).padStart(5)}ms   n=${xs.length}`);

/** A transport with a fixed, honest simulated provider latency. */
const stub = (out: Partial<RawInterpretation>, delayMs: number): InterpretTransport => async () => {
  await new Promise((r) => setTimeout(r, delayMs));
  return { output: { outcome: "MATCHED", intentKey: "", slots: [], candidates: [], clarification: "", ...out } as RawInterpretation, model: "stub" };
};

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const t = Date.now(); await fn(); return Date.now() - t;
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    const account = (await db.query<{ legal_name: string }>(
      `select c.legal_name from companies c join pursuits p on p.account_id = c.id
        where c.legal_name ilike '%Globex Manufacturing%' and p.org_id = $1 limit 1`, [org])).rows[0].legal_name;

    const cases: [string, () => Promise<unknown>][] = [
      [`GOTO "${account}" (no model — §16)`, () => answerQuestion(db, org, account, {})],
      ["DETERMINISTIC lifecycle.horizon", () => answerQuestion(db, org, "what changes in the next 90 days", { intentClass: "showme" })],
      ["DETERMINISTIC stakeholder.coverage_gap", () => answerQuestion(db, org, "which high-value pursuits lack an economic buyer", { intentClass: "showme" })],
      ["DETERMINISTIC attention.today (focus)", () => answerQuestion(db, org, "what should I focus on today", { intentClass: "showme" })],
      ["DETERMINISTIC attention.today (blocked)", () => answerQuestion(db, org, "where is revenue blocked", { intentClass: "showme" })],
      ["DETERMINISTIC change.recent (30d)", () => answerQuestion(db, org, "what changed in the last 30 days", { intentClass: "showme" })],
      ["DETERMINISTIC pursuit.compound (4 families)", () =>
        answerQuestion(db, org, "show WWT pursuits over $500K renewing in 90 days without a verified economic buyer", { intentClass: "showme" })],
      ["DETERMINISTIC record.explain (route)", () => answerQuestion(db, org, `why is ${account} routed through WWT`, { intentClass: "explain" })],
      ["INTERPRETED overhead only (0ms provider)", () =>
        answerQuestion(db, org, "which deals have nobody signing off on the money", {
          intentClass: "showme",
          transport: stub({ intentKey: "stakeholder.coverage_gap", slots: [{ name: "role", value: "economic_buyer" }] }, 0),
        })],
      ["INTERPRETED with entity resolution (0ms provider)", () =>
        answerQuestion(db, org, "what's the business justification for that account", {
          intentClass: "showme",
          transport: stub({ intentKey: "value.no_case", slots: [] }, 0),
        })],
      ["REJECTED → deterministic fallback (0ms provider)", () =>
        answerQuestion(db, org, "zzz nothing parses", {
          intentClass: "showme",
          transport: stub({ intentKey: "not.real", slots: [] }, 0),
        })],
    ];

    console.log(`\nP2C-1 latency (n=${N} each, after a warm-up)\n`);
    for (const [label, fn] of cases) {
      await fn();                                   // warm-up: connection, plan cache, module load
      const xs: number[] = [];
      for (let i = 0; i < N; i++) xs.push(await time(fn));
      report(label, xs);
    }

    // The §16 claim in one line: navigation must not have become slower.
    const nav: number[] = [];
    for (let i = 0; i < N; i++) nav.push(await time(() => answerQuestion(db, org, account, {})));
    const det: number[] = [];
    for (let i = 0; i < N; i++) det.push(await time(() => answerQuestion(db, org, "what changes in the next 90 days", { intentClass: "showme" })));
    console.log(`\n  §16: GOTO p95 ${pct(nav, 0.95)}ms and DETERMINISTIC p95 ${pct(det, 0.95)}ms — neither path invokes the model.`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
