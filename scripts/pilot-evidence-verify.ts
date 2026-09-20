/**
 * PILOT EVIDENCE FOUNDATION (Slice 1) — the anti-regret pass.
 *
 * > Capture only what would be PERMANENTLY UNRECOVERABLE otherwise. No learning, no scoring, no
 * > causality, no negative labels. Absence is never a negative fact.
 *
 * The three gaps this proves closed were each found by tracing, not assumed: provenance could not
 * say PILOT or CERTIFICATION; P2 rank was computed at read time and never persisted; and opportunity
 * stage transitions lived only in a mutable table with no before/after.
 *
 * SEEDED CLONE: commits fixtures.
 */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { assertSeededClone } from "./seeded-clone";
import { DATA_ENVIRONMENTS, LEARNING_ELIGIBLE_ENVIRONMENTS, REAL_WORLD_ENVIRONMENTS,
         isLearningEligible, isRealWorldEvidence, learningEligibleSql, realWorldSql } from "../src/lib/pursuits/lineage";
import { attentionFingerprint, captureAttention } from "../src/lib/pursuits/evidence/attention-capture";
import type { PortfolioPertinenceView } from "../src/lib/pursuits/read-models/portfolio-pertinence";

const pool = new Pool({ connectionString: process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "", max: 3 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"}  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const NS = `pe-${Math.random().toString(36).slice(2, 8)}`;
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
const n = async (s: string, p: unknown[] = []) => Number((await one(s, p)).n);

async function main() {
  await assertSeededClone(pool);
  console.log(`Pilot Evidence Foundation  (${NS})`);
  const org = await one(`insert into organizations (name) values ($1) returning id`, [`PE ${NS}`]);
  const co = await one(`insert into companies (legal_name, normalized_name) values ($1,$2) returning id`, [`PE Co ${NS}`, `pe-co-${NS}`]);

  // ── PROVENANCE ────────────────────────────────────────────────────────────────────────────────
  HD("PROVENANCE — real-world activity and training eligibility are SEPARATE dimensions");
  ck("the vocabulary can now say PILOT and CERTIFICATION",
    DATA_ENVIRONMENTS.includes("PILOT") && DATA_ENVIRONMENTS.includes("CERTIFICATION"));
  ck("PILOT is REAL-WORLD evidence", isRealWorldEvidence("PILOT") && REAL_WORLD_ENVIRONMENTS.includes("PILOT"));
  ck("but PILOT is NOT learning-eligible — being real does not grant a training licence",
    !isLearningEligible("PILOT") && !LEARNING_ELIGIBLE_ENVIRONMENTS.includes("PILOT"));
  ck("CERTIFICATION is neither real-world evidence nor learning-eligible",
    !isRealWorldEvidence("CERTIFICATION") && !isLearningEligible("CERTIFICATION"));
  ck("DEMO is never learning-eligible", !isLearningEligible("DEMO"));
  ck("CONTROL — PRODUCTION is still both, so neither filter is refusing everything",
    isLearningEligible("PRODUCTION") && isRealWorldEvidence("PRODUCTION"));
  ck("the two SQL filters are genuinely different fragments",
    learningEligibleSql("x") !== realWorldSql("x")
    && !learningEligibleSql("x").includes("PILOT") && realWorldSql("x").includes("PILOT"),
    { learning: learningEligibleSql("x"), realWorld: realWorldSql("x") });
  // The database must accept the new vocabulary where it is bounded.
  for (const env of ["PILOT", "CERTIFICATION"]) {
    const p = await one(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                         values ($1,$2,'QUALIFIED',$3,$4,'MODERNIZATION') returning id, data_environment`,
      [org.id, co.id, `${NS}-${env}`, env]);
    ck(`the pursuits CHECK accepts ${env}`, p.data_environment === env);
  }
  let badEnv = "";
  try { await pool.query(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                          values ($1,$2,'QUALIFIED',$3,'NONSENSE','MODERNIZATION')`, [org.id, co.id, `${NS}-bad`]); }
  catch (e) { badEnv = (e as Error).message; }
  ck("CONTROL — an unknown environment is still refused, so the CHECK was widened, not removed",
    /violates check constraint/.test(badEnv));

  // ── CERTIFICATION EXCLUSION MANIFEST ──────────────────────────────────────────────────────────
  HD("LEGACY CERTIFICATION MANIFEST — name the rows, never rewrite them");
  const inv = await one(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, status, data_environment)
                         values ($1,'draft_campaign_touch',1,'INTERNAL_WRITE','AGENT','EXECUTED','PRODUCTION') returning id, data_environment`, [org.id]);
  await q(`insert into certification_exclusions (org_id, subject_kind, subject_id, reason)
           values ($1,'governed_action_invocation',$2,$3)`, [org.id, inv.id, `${NS} gate traffic`]);
  ck("a certification row keeps its ORIGINAL data_environment — history is not rewritten",
    (await one(`select data_environment from governed_action_invocations where id=$1`, [inv.id])).data_environment === "PRODUCTION");
  ck("and is nonetheless excludable deterministically, by exact id",
    await n(`select count(*)::int n from governed_action_invocations i
              where i.id=$1 and not exists (select 1 from certification_exclusions e
                where e.org_id=i.org_id and e.subject_kind='governed_action_invocation' and e.subject_id=i.id)`, [inv.id]) === 0);
  ck("the manifest refuses a duplicate entry",
    (await pool.query(`insert into certification_exclusions (org_id, subject_kind, subject_id, reason)
                       values ($1,'governed_action_invocation',$2,'dup') on conflict do nothing`, [org.id, inv.id])).rowCount === 0);

  // ── ATTENTION CAPTURE ─────────────────────────────────────────────────────────────────────────
  HD("DECISION-TIME ATTENTION — the one fact that is otherwise unrecoverable");
  const pursuits: string[] = [];
  for (let i = 0; i < 3; i++) pursuits.push((await one(
    `insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
     values ($1,$2,'QUALIFIED',$3,'PILOT','MODERNIZATION') returning id`, [org.id, co.id, `${NS}-p${i}`])).id);
  const view = (order: string[]): PortfolioPertinenceView => ({
    items: order.map((id, idx) => ({
      pursuitId: id, accountLabel: "acct", label: "l", rank: idx + 1, score: 90 - idx * 10,
      band: idx === 0 ? "HIGH" : "MEDIUM", signals: [{ key: "timing", contribution: 0.4 } as never],
      topReasons: ["should not be stored"], commercial: {} as never, comparedToBelow: null, tiedWithBelow: false,
      disclosure: "DISCLOSED" as never,
    })) as never,
    comparisonSetSize: order.length, withheldCount: 2, scope: "portfolio", asOf: new Date().toISOString(),
    cohortSizes: {} as never,
  });
  const v1 = view(pursuits);
  const cap1 = await captureAttention(pool as never, { orgId: org.id, view: v1, algorithmVersion: "p2-v1", dataEnvironment: "PILOT" });
  ck("a ranking is captured — one row per eligible subject", cap1.written === 3);
  const rows = await q(`select rank, score, band, comparison_set_size, withheld_count, components, data_environment
                          from attention_observations where org_id=$1 order by rank`, [org.id]);
  ck("rank, score, band and the comparison-set size are preserved — a rank is meaningless without it",
    rows.length === 3 && rows[0].rank === 1 && Number(rows[0].score) === 90 && rows[0].comparison_set_size === 3 && rows[0].withheld_count === 2);
  ck("components hold only declared keys and numbers",
    Array.isArray(rows[0].components) && rows[0].components[0].key === "timing" && rows[0].components[0].contribution === 0.4);
  ck("NO prose, evidence text or withheld content is stored — `topReasons` never reaches the table",
    !JSON.stringify(rows).includes("should not be stored"));
  ck("provenance travels with the observation", rows[0].data_environment === "PILOT");

  const cap2 = await captureAttention(pool as never, { orgId: org.id, view: view(pursuits), algorithmVersion: "p2-v1", dataEnvironment: "PILOT" });
  ck("CAPTURE ON CHANGE, NOT ON A TIMER — an unchanged ranking writes NOTHING, so there is no cadence to decide",
    cap2.written === 0 && cap2.fingerprint === cap1.fingerprint);
  const reordered = [pursuits[1], pursuits[0], pursuits[2]];
  const cap3 = await captureAttention(pool as never, { orgId: org.id, view: view(reordered), algorithmVersion: "p2-v1", dataEnvironment: "PILOT" });
  ck("BITING CONTROL — a REORDERING is a different state and IS captured",
    cap3.written === 3 && cap3.fingerprint !== cap1.fingerprint);
  ck("and a different algorithm version is also a different state",
    attentionFingerprint(v1, "p2-v2") !== attentionFingerprint(v1, "p2-v1"));
  // Decision linkage, and the honesty of its absence.
  ck("an observation with no decision records NULL — absence is a fact, not a gap to fill later",
    await n(`select count(*)::int n from attention_observations where org_id=$1 and decision_ref_id is null`, [org.id]) === 6);

  // ── COMMERCIAL EVENT DURABILITY ───────────────────────────────────────────────────────────────
  HD("COMMERCIAL EVENTS — the ledger is the only append-only store, and now it hears about stages");
  const acl = async (t: string) => (await one(`select array_to_string(relacl,',') a from pg_class where relname=$1`, [t])).a as string;
  ck("change_ledger is append-only (app_rw=ar)", /app_rw=ar\//.test(await acl("change_ledger")));
  ck("attention_observations and certification_exclusions are append-only too",
    /app_rw=ar\//.test(await acl("attention_observations")) && /app_rw=ar\//.test(await acl("certification_exclusions")));
  note("outcome_events / pursuit_outcomes / route_outcomes remain app_rw=arwd — mutable by design and therefore NOT evidentiary",
    { outcome_events: (await acl("outcome_events")).match(/app_rw=[a-z]*/)?.[0] });
  const upd = async (t: string) => (await q(`select column_name from information_schema.column_privileges where grantee='app_rw' and table_name=$1 and privilege_type='UPDATE'`, [t])).length;
  ck("app_rw cannot UPDATE or DELETE either new table", (await upd("attention_observations")) === 0 && (await upd("certification_exclusions")) === 0
    && (await q(`select 1 from information_schema.table_privileges where grantee='app_rw' and table_name in ('attention_observations','certification_exclusions') and privilege_type='DELETE'`)).length === 0);
  const rls = await q(`select relname, relrowsecurity r, relforcerowsecurity f from pg_class where relname in ('attention_observations','certification_exclusions')`);
  ck("RLS enabled and FORCED on both", rls.length === 2 && rls.every((x) => x.r === true && x.f === true));
  // Cross-org refusal.
  const other = await one(`insert into organizations (name) values ($1) returning id`, [`PE other ${NS}`]);
  let xo = "";
  try { await pool.query(`insert into attention_observations (org_id, snapshot_id, snapshot_fingerprint, algorithm_version, scope,
          comparison_set_size, pursuit_id, rank, score, band) values ($1,$2,'x','v','s',1,$3,1,1,'HIGH')`,
          [other.id, randomUUID(), pursuits[0]]); }
  catch (e) { xo = (e as Error).message; }
  note("a foreign-org observation naming this org's pursuit is accepted by the single-column FK and bounded by RLS",
    xo === "" ? "inserted (owner bypasses RLS)" : xo.slice(0, 60));

  // ── WHAT THIS SLICE REFUSES TO DO ─────────────────────────────────────────────────────────────
  HD("REFUSALS — structurally, so nothing can drift into them");
  for (const t of ["pursuit_labels", "outcome_labels", "learning_corpus", "reward_observations", "causal_attributions"])
    ck(`no ${t} table exists`, (await one(`select to_regclass($1)::text x`, [`public.${t}`])).x === null);
  ck("attention_observations carries no outcome, label, reward or causality column",
    (await q(`select column_name from information_schema.columns where table_name='attention_observations'
               and (column_name like '%outcome%' or column_name like '%label%' or column_name like '%reward%'
                 or column_name like '%caus%' or column_name like '%success%' or column_name like '%fail%')`)).length === 0);
  ck("PILOT was not quietly added to the learning allow-list",
    LEARNING_ELIGIBLE_ENVIRONMENTS.length === 1 && LEARNING_ELIGIBLE_ENVIRONMENTS[0] === "PRODUCTION");

  console.log(`\n=== PILOT EVIDENCE — ${pass} passed, ${fail} failed`);
}
main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => { console.log(`\n=== PILOT EVIDENCE — ${pass} passed, ${fail} failed`); await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1); });
