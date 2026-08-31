/**
 * Ask demo story (P2C-1 §15). No new demo DATA — the synthetic world built by P1C/P2A/P2B already
 * supports every question below. This runs the §15 demo questions through the real answer stack and
 * lands each exchange, with its provenance, on the record so the /ask room has something true to
 * render.
 *
 * Every answer here comes from the same canonical resolvers the rooms render, so an operator can
 * ask a question and then open the linked room and see the same figures. That reconciliation is the
 * point of the exercise — a demo answer that does not match the screen behind it is worse than no
 * demo answer.
 *
 *   DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo npx tsx scripts/demo-ask-story.ts
 */
import { Pool, type PoolClient } from "pg";
import { answerQuestion } from "../src/lib/interpret/answer";
import { logAnswer } from "../src/lib/interpret/log";
import "../src/lib/search/intents";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

const QUESTIONS = [
  "What should I focus on today?",
  "What renews in the next 90 days?",
  "Which high-value pursuits lack an economic buyer?",
  "What would strengthen Umbrella Health Systems's value case?",
  "Which value cases contain conflicting economic facts?",
  "Where is revenue blocked?",
  "What materially changed in the last 30 days?",
  "Which motion has the most constrained revenue?",
  "Where does CDW activate well?",
  "Why is Globex Manufacturing Inc. routed through WWT?",
  "Show WWT pursuits over $500K renewing in 90 days without a verified economic buyer.",
];

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = (await pool.connect()) as PoolClient;
  try {
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    // Replayable: the demo set is rewritten rather than appended, so re-running does not silt up
    // the room with duplicates.
    await db.query(`delete from ask_exchanges where org_id = $1 and question = any($2)`, [org, QUESTIONS]);

    for (const q of QUESTIONS) {
      // deterministicOnly: this environment has no model credentials, and a demo answer must be
      // reproducible anyway. Every question below is within deterministic coverage by design.
      const env = await answerQuestion(db, org, q, { deterministicOnly: true });
      await logAnswer(db, org, env, env.model);
      const n = env.hits.length;
      console.log(`  ${env.outcome.padEnd(11)} ${(env.intentKey ?? "—").padEnd(28)} ${String(n).padStart(2)} hit(s)  ${q}`);
      if (env.outcome === "UNSUPPORTED") console.log(`      ↳ ${env.answer}`);
    }
    console.log("\nAsk demo exchanges written (deterministic path, canonical resolvers).");
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
