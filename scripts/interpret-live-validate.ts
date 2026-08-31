/**
 * P2C-1 LIVE validation — the interpreter against a real model provider.
 *
 * The P2C-1 suite proves the CONTRACT: no model output, however hostile, can reach a resolver
 * without passing the registry. It cannot prove SEMANTIC QUALITY — whether a real model picks the
 * right intent for a real paraphrase. That needs a credential, and it is the one claim P2C-1 could
 * not make.
 *
 * This is that run, as a single command. It changes nothing about the architecture: it calls the
 * same `interpret()` and the same `answerQuestion()` production uses, with the transport seam left
 * empty so the real provider answers.
 *
 * It is bounded on purpose — one call per case, a small fixed case list, the cheap tier — so it can
 * be run against a demo-environment credential without a surprising bill.
 *
 * No secret is printed, logged or persisted. The credential is read by the SDK's own resolution
 * order and never touched by this file.
 *
 *   set -a; . ./.env.local; set +a
 *   DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo \
 *     npx tsx scripts/interpret-live-validate.ts
 */
import { Pool, type PoolClient } from "pg";
import { getAnthropic } from "../src/lib/ai/client";
import { interpret } from "../src/lib/interpret/interpreter";
import { answerQuestion, classifyForAnswer } from "../src/lib/interpret/answer";
import { routeIntent, type IntentClass } from "../src/lib/search/registry";
import "../src/lib/search/intents";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

type Expect =
  | { kind: "MATCHED"; intentKey: string; slots?: Record<string, string> }
  | { kind: "AMBIGUOUS" }
  | { kind: "UNSUPPORTED" };

interface Case {
  /** Which §1 requirement this case covers. */
  covers: string;
  q: string;
  expect: Expect;
  /** True when the deterministic parser is expected to answer WITHOUT consulting the model. */
  deterministic: boolean;
}

const CASES: Case[] = [
  // 1 · a paraphrase deterministic parsing already handles — the model must NOT be consulted.
  { covers: "deterministic paraphrase", deterministic: true,
    q: "which high-value pursuits lack an economic buyer",
    expect: { kind: "MATCHED", intentKey: "stakeholder.coverage_gap" } },

  // 2 · a paraphrase that REQUIRES the interpreter.
  { covers: "model-required paraphrase", deterministic: false,
    q: "which deals have nobody signing off on the money",
    expect: { kind: "MATCHED", intentKey: "stakeholder.coverage_gap", slots: { role: "economic_buyer" } } },

  // 3 · genuinely ambiguous — §4's own worked example.
  { covers: "ambiguous", deterministic: false,
    q: "show me the best partners",
    expect: { kind: "AMBIGUOUS" } },

  // 4 · outside every registered capability.
  { covers: "unsupported", deterministic: false,
    q: "what is the weather in Dallas tomorrow",
    expect: { kind: "UNSUPPORTED" } },

  // 5 · compound, several constraint families at once.
  { covers: "compound", deterministic: false,
    q: "big deals through WWT coming up for renewal soon where nobody has confirmed the budget holder",
    expect: { kind: "MATCHED", intentKey: "pursuit.compound" } },

  // 6 · Value Case.
  { covers: "value case", deterministic: false,
    q: "which of these can I actually defend the economics on",
    expect: { kind: "MATCHED", intentKey: "value.confirmed" } },

  // 7 · lifecycle.
  { covers: "lifecycle", deterministic: false,
    q: "who's got contracts coming up for renewal soon",
    expect: { kind: "MATCHED", intentKey: "lifecycle.horizon" } },

  // 8 · stakeholder, phrased as a question about the buying committee.
  { covers: "stakeholder", deterministic: false,
    q: "where are we missing the person who signs the cheque",
    expect: { kind: "MATCHED", intentKey: "stakeholder.coverage_gap" } },
];

const pct = (xs: number[], p: number) =>
  xs.length === 0 ? 0 : xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

async function credentialAvailable(): Promise<{ ok: boolean; reason: string }> {
  try {
    const c = getAnthropic();
    await c.messages.create({ model: "claude-haiku-4-5", max_tokens: 8, messages: [{ role: "user", content: "ok" }] });
    return { ok: true, reason: "" };
  } catch (err) {
    // The message may quote provider detail; it never contains the key itself.
    return { ok: false, reason: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

async function main() {
  console.log("P2C-1 LIVE VALIDATION\n");

  const cred = await credentialAvailable();
  if (!cred.ok) {
    console.log("  MODEL CREDENTIAL: UNAVAILABLE");
    console.log(`  reason: ${cred.reason}\n`);
    console.log("  Live interpretation was NOT validated. The deterministic tier is unaffected:");
    console.log("  every registered intent still parses and resolves, and an unavailable model");
    console.log("  degrades to REJECTED in ~1ms with the deterministic answer standing.");
    console.log("  Re-run this script once an authorized demo credential is configured.");
    process.exit(2);
  }
  console.log("  MODEL CREDENTIAL: available\n");

  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;

    let correct = 0, graded = 0;
    const interpretMs: number[] = [], resolveMs: number[] = [], totalMs: number[] = [];

    for (const c of CASES) {
      const cls: IntentClass = classifyForAnswer(c.q) === "goto" ? "showme" : classifyForAnswer(c.q);
      const parserWouldAnswer = routeIntent(c.q, cls).kind === "MATCHED";

      // The full production chain: query → interpretation → validation → resolver → answer.
      const env = await answerQuestion(db, org, c.q, { intentClass: cls });

      // The raw interpretation, captured separately so accuracy can be graded even where the
      // deterministic tier (correctly) answered first without consulting the model.
      const raw = c.deterministic ? null : await interpret(c.q, { intentClass: cls });

      let verdict = "?";
      graded++;
      if (c.expect.kind === "MATCHED") {
        const keyOk = env.intentKey === c.expect.intentKey;
        const slotOk = !c.expect.slots || Object.entries(c.expect.slots).every(([k, v]) => String(env.slots?.[k] ?? "") === v);
        if (keyOk && slotOk) { correct++; verdict = "PASS"; }
        else verdict = `FAIL (got ${env.intentKey ?? "—"}${keyOk ? ", slots differ" : ""})`;
      } else if (c.expect.kind === "AMBIGUOUS") {
        if (env.outcome === "AMBIGUOUS") { correct++; verdict = "PASS"; } else verdict = `FAIL (got ${env.outcome})`;
      } else {
        if (env.outcome === "UNSUPPORTED") { correct++; verdict = "PASS"; } else verdict = `FAIL (got ${env.outcome})`;
      }

      // §1's ordering claim, checked rather than assumed.
      if (c.deterministic && env.path !== "DETERMINISTIC") verdict += " — WARNING: model was consulted for a parseable query";
      if (c.deterministic && !parserWouldAnswer) verdict += " — WARNING: expected deterministic, parser declined";

      if (env.latency.interpretMs != null) interpretMs.push(env.latency.interpretMs);
      resolveMs.push(env.latency.resolveMs);
      totalMs.push(env.latency.totalMs);

      console.log(`  [${c.covers}] ${verdict}`);
      console.log(`      q: "${c.q}"`);
      console.log(`      path=${env.path} outcome=${env.outcome} intent=${env.intentKey ?? "—"} slots=${JSON.stringify(env.slots ?? {})}`);
      if (raw) console.log(`      raw interpretation: ${raw.outcome} ${raw.intentKey ?? ""} ${JSON.stringify(raw.slots)}${raw.rejection ? ` rejected: ${raw.rejection}` : ""}`);
      console.log(`      latency: interpret ${env.latency.interpretMs ?? "—"}ms · resolve ${env.latency.resolveMs}ms · total ${env.latency.totalMs}ms`);
      if (env.clarification) console.log(`      clarification: ${env.clarification}`);
      console.log(`      answer: ${env.answer.slice(0, 160)}`);
      console.log("");
    }

    console.log(`  Interpretation accuracy: ${correct}/${graded}`);
    console.log(`  Interpreter latency: p50 ${pct(interpretMs, 0.5)}ms · p95 ${pct(interpretMs, 0.95)}ms (n=${interpretMs.length})`);
    console.log(`  Resolver latency:    p50 ${pct(resolveMs, 0.5)}ms · p95 ${pct(resolveMs, 0.95)}ms`);
    console.log(`  Total latency:       p50 ${pct(totalMs, 0.5)}ms · p95 ${pct(totalMs, 0.95)}ms`);
    if (correct < graded) process.exitCode = 1;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
