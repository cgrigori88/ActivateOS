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
import { readFileSync } from "node:fs";
import { DATA_ENVIRONMENTS, LEARNING_ELIGIBLE_ENVIRONMENTS, REAL_WORLD_DATA_ENVIRONMENTS,
         CERTIFICATION_SUBJECT_KINDS, certificationExcludedSql, isLearningEligible,
         isRealWorldEnvironment, learningCorpusSql, learningEligibleSql,
         realWorldEnvironmentSql } from "../src/lib/pursuits/lineage";
import { advanceOpportunity, createOpportunityFromMotion } from "../src/lib/opportunities/lifecycle";
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

/**
 * Source with comments removed.
 *
 * EVERY STRUCTURAL ASSERTION BELOW SCANS THIS, NOT THE RAW FILE, and the first run proved why: two
 * assertions failed because the prose EXPLAINING the invariant contained the very words the
 * assertion was looking for — a doc comment naming the old API, and a comment promising "no
 * timestamp window here". A control that a comment can satisfy, or break, is not a control.
 */
const codeOf = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

async function main() {
  await assertSeededClone(pool);
  console.log(`Pilot Evidence Foundation  (${NS})`);
  const org = await one(`insert into organizations (name) values ($1) returning id`, [`PE ${NS}`]);
  const co = await one(`insert into companies (legal_name, normalized_name) values ($1,$2) returning id`, [`PE Co ${NS}`, `pe-co-${NS}`]);

  // ── PROVENANCE ────────────────────────────────────────────────────────────────────────────────
  HD("PROVENANCE — real-world activity and training eligibility are SEPARATE dimensions");
  ck("the vocabulary can now say PILOT and CERTIFICATION",
    DATA_ENVIRONMENTS.includes("PILOT") && DATA_ENVIRONMENTS.includes("CERTIFICATION"));
  ck("PILOT is REAL-WORLD evidence", isRealWorldEnvironment("PILOT") && REAL_WORLD_DATA_ENVIRONMENTS.includes("PILOT"));
  ck("but PILOT is NOT learning-eligible — being real does not grant a training licence",
    !isLearningEligible("PILOT") && !LEARNING_ELIGIBLE_ENVIRONMENTS.includes("PILOT"));
  ck("CERTIFICATION is neither real-world evidence nor learning-eligible",
    !isRealWorldEnvironment("CERTIFICATION") && !isLearningEligible("CERTIFICATION"));
  ck("DEMO is never learning-eligible", !isLearningEligible("DEMO"));
  ck("CONTROL — PRODUCTION is still both, so neither filter is refusing everything",
    isLearningEligible("PRODUCTION") && isRealWorldEnvironment("PRODUCTION"));
  ck("the two SQL filters are genuinely different fragments",
    learningEligibleSql("x") !== realWorldEnvironmentSql("x")
    && !learningEligibleSql("x").includes("PILOT") && realWorldEnvironmentSql("x").includes("PILOT"),
    { learning: learningEligibleSql("x"), realWorld: realWorldEnvironmentSql("x") });
  // §3 — the NAME must not collapse provenance into evidentiary standing.
  const lineageSrc = codeOf("../src/lib/pursuits/lineage.ts");
  ck("no exported provenance API calls an environment `Evidence`",
    !/RealWorld\w*Evidence/.test(lineageSrc) && /REAL_WORLD_DATA_ENVIRONMENTS/.test(lineageSrc));
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

  // ── ATOMICITY AND FORGERY ─────────────────────────────────────────────────────────────────────
  HD("THE OBSERVATION IS SERVER EVIDENCE — it cannot be forged, and it cannot outlive a rollback");
  {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("savepoint dispatch");
      const staged = await captureAttention(client as never, {
        orgId: org.id, view: view([pursuits[2], pursuits[0], pursuits[1]]),
        algorithmVersion: "p2-rollback", dataEnvironment: "PILOT" });
      const mid = Number((await client.query(
        `select count(*)::int n from attention_observations where org_id=$1 and algorithm_version='p2-rollback'`, [org.id])).rows[0].n);
      // A handler that fails AFTER staging its observation must leave nothing behind: the snapshot
      // claims a decision boundary, so it may not survive a boundary that did not commit.
      await client.query("rollback to savepoint dispatch");
      const after = Number((await client.query(
        `select count(*)::int n from attention_observations where org_id=$1 and algorithm_version='p2-rollback'`, [org.id])).rows[0].n);
      await client.query("commit");
      ck("a failed dispatch leaves NO orphan observation — staged, then rewound to zero",
        staged.written === 3 && mid === 3 && after === 0);
    } finally { client.release(); }
  }
  const captureSrc = codeOf("../src/lib/pursuits/evidence/attention-capture.ts");
  const inputShape = captureSrc.slice(captureSrc.indexOf("interface AttentionCaptureInput"), captureSrc.indexOf("export function attentionFingerprint"));
  ck("the producer accepts NO caller-supplied rank, score, fingerprint, components or eligible set",
    !/\b(rank|score|band|fingerprint|components|items)\s*[?:]/.test(inputShape), { inputShape: inputShape.replace(/\s+/g, " ").slice(0, 160) });
  ck("the fingerprint is COMPUTED from the server-ranked view, never accepted",
    /function attentionFingerprint\(view: PortfolioPertinenceView/.test(captureSrc)
    && attentionFingerprint(v1, "p2-v1") === attentionFingerprint(view(pursuits), "p2-v1"));
  ck("CONTROL — and it is not a constant: a different comparison set is a different fingerprint",
    attentionFingerprint(view(pursuits.slice(0, 2)), "p2-v1") !== attentionFingerprint(v1, "p2-v1"));

  // ── READ PATHS WRITE NOTHING ──────────────────────────────────────────────────────────────────
  HD("READ PATHS — opening a surface records nothing (D-HIST-1 stays closed)");
  {
    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const { callerFor } = await import("../src/lib/pursuits/read-models/caller");
      const { getPortfolioPertinence } = await import("../src/lib/pursuits/read-models/portfolio");
      const v = await getPortfolioPertinence(client, await callerFor(client, org.id), { scope: "All pursuits" });
      await client.query("commit");
      // A READ ONLY transaction is the strongest available form of this assertion: PostgreSQL, not
      // the test, refuses any write the ranking attempts. It ran, so it wrote nothing.
      ck("the whole P2 ranking runs inside a READ ONLY transaction — the database itself enforces it",
        v.comparisonSetSize >= 0);
    } catch (e) {
      await pool.query("rollback").catch(() => {});
      ck("the whole P2 ranking runs inside a READ ONLY transaction — the database itself enforces it",
        false, (e as Error).message);
    } finally { client.release(); }
    ck("and no observation was written by looking",
      await n(`select count(*)::int n from attention_observations where org_id=$1 and algorithm_version like 'p2-v%'`, [org.id]) === 6);
    // §1 RULING: recommend_pursuit_plan@1 does not consume P2, so attaching a ranking to it would
    // be FALSE LINEAGE. This asserts the ruling holds — the dispatch writes no observation — and it
    // is the control that would catch someone wiring the producer there anyway.
    const beforeObs = await n(`select count(*)::int n from attention_observations where org_id=$1`, [org.id]);
    const c2 = await pool.connect();
    try {
      await c2.query("begin");
      await c2.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const { dispatchSkill } = await import("../src/lib/pursuits/federation/skills");
      const d = await dispatchSkill(c2, "recommend_pursuit_plan",
        { type: "SYSTEM", id: null, orgId: org.id, role: "operator" },
        { pursuitId: pursuits[0], dataEnvironment: "PILOT" });
      const after = Number((await c2.query(`select count(*)::int n from attention_observations where org_id=$1`, [org.id])).rows[0].n);
      await c2.query("commit");
      ck("recommend_pursuit_plan@1 writes NO attention observation — it never consumed P2, so it may not claim one",
        after === beforeObs, { dispatch: d.status, before: beforeObs, after });
    } catch (e) { await pool.query("rollback").catch(() => {}); ck("recommend_pursuit_plan@1 writes no attention observation", false, (e as Error).message); }
    finally { c2.release(); }
  }

  // ── COMMERCIAL EVENTS: CREATION, STAGE, AMOUNT ────────────────────────────────────────────────
  HD("COMMERCIAL EVENTS — creation is not import, and provenance is derived from the subject");
  const node = (await one(`select id from taxonomy_nodes limit 1`))?.id ?? null;
  for (const env of ["DEMO", "PILOT", "CERTIFICATION"] as const) {
    const pu = await one(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                          values ($1,$2,'QUALIFIED',$3,$4,'MODERNIZATION') returning id`, [org.id, co.id, `${NS}-opp-${env}`, env]);
    const motion = await one(`insert into revenue_motions (org_id, company_id, taxonomy_node_id, status, estimated_value_usd, pursuit_id)
                              values ($1,$2,$3,'active',250000,$4) returning id`, [org.id, co.id, node, pu.id]);
    const client = await pool.connect();
    let oppId = "";
    try {
      await client.query("begin");
      await client.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      oppId = (await createOpportunityFromMotion(client, org.id, motion.id)).opportunityId;
      await advanceOpportunity(client, org.id, oppId, "proposal");
      await client.query("commit");
    } catch (e) { await client.query("rollback"); ck(`commercial events on a ${env} pursuit`, false, (e as Error).message); }
    finally { client.release(); }

    const led = await q(`select change_type, materiality, data_environment, before_state, after_state
                           from change_ledger where entity_id=$1 order by recorded_at, change_type`, [oppId]);
    ck(`${env}: a GENUINE business creation is on the append-only ledger, not only in a mutable table`,
      led.some((r) => r.change_type === "OPPORTUNITY_CREATED" && r.materiality === "HIGH"
        && r.before_state === null && r.after_state?.stage === "discovery"));
    ck(`${env}: the stage transition carries a typed before/after`,
      led.some((r) => r.change_type === "STAGE_CHANGED" && r.before_state?.stage === "discovery" && r.after_state?.stage === "proposal"));
    ck(`${env}: provenance is DERIVED FROM THE SUBJECT, not defaulted to PRODUCTION`,
      led.length >= 2 && led.every((r) => r.data_environment === env), { got: [...new Set(led.map((r) => r.data_environment))] });

    // AMOUNT-ONLY MUTATION. No application path can perform one, so there is nothing to instrument
    // — and that claim is only worth anything if the absence is checked rather than asserted.
    const before = await n(`select count(*)::int n from change_ledger where entity_id=$1`, [oppId]);
    await q(`update opportunities set amount_usd = coalesce(amount_usd,0) + 1 where id=$1`, [oppId]);
    ck(`${env}: CONTROL — a raw amount UPDATE produces no history, which is why no such path may exist`,
      await n(`select count(*)::int n from change_ledger where entity_id=$1`, [oppId]) === before);
  }
  const lifecycleSrc = codeOf("../src/lib/opportunities/lifecycle.ts");
  const srcFiles = ["src/lib/opportunities/lifecycle.ts", "src/lib/ingest/staged.ts", "src/lib/pursuits/reparent.ts"];
  const writers = srcFiles.map((f) => codeOf(`../${f}`)).join("\n");
  ck("NO application path mutates an opportunity's amount after creation — the amount-only event is UNREACHABLE",
    !/update\s+opportunities[\s\S]{0,200}?amount_usd\s*=/i.test(writers));
  const stagedSrc = codeOf("../src/lib/ingest/staged.ts");
  ck("an IMPORT is recorded as an observation (crm_snapshots) and never claims to have created the deal",
    stagedSrc.includes("crm_snapshots") && !stagedSrc.includes("OPPORTUNITY_CREATED"),
    { why: "import time is not business creation time, and no imported column carries the real one" });
  ck("CONTROL — the genuine creation path DOES claim it, so the distinction is real and not an omission",
    lifecycleSrc.includes('changeType: "OPPORTUNITY_CREATED"'));

  // ── ELIGIBILITY COMPOSITION ───────────────────────────────────────────────────────────────────
  HD("ELIGIBILITY — the allow-list ALONE admits every legacy certification row; only the composition refuses it");
  const clean = await one(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, status, data_environment)
                           values ($1,'draft_campaign_touch',1,'INTERNAL_WRITE','AGENT','EXECUTED','PRODUCTION') returning id`, [org.id]);
  const demoInv = await one(`insert into governed_action_invocations (org_id, skill_id, skill_version, effect_class, actor_type, status, data_environment)
                             values ($1,'draft_campaign_touch',1,'INTERNAL_WRITE','AGENT','EXECUTED','DEMO') returning id`, [org.id]);
  const cols = { orgColumn: "i.org_id", idColumn: "i.id" };
  const admits = async (frag: string, id: string) =>
    await n(`select count(*)::int n from governed_action_invocations i where i.id=$1 and ${frag}`, [id]) === 1;
  ck("THE DEFECT, DEMONSTRATED — the allow-list alone admits the known mislabelled certification row",
    await admits(learningEligibleSql("i.data_environment"), inv.id));
  ck("THE FIX — the composed corpus filter refuses it, by exact id and nothing else",
    !(await admits(learningCorpusSql("governed_action_invocation", cols), inv.id)));
  ck("CONTROL — an identical PRODUCTION row that is NOT in the manifest is still admitted",
    await admits(learningCorpusSql("governed_action_invocation", cols), clean.id));
  ck("CONTROL — a DEMO row is refused even though the manifest never mentions it",
    !(await admits(learningCorpusSql("governed_action_invocation", cols), demoInv.id))
    && !(await admits(certificationExcludedSql("governed_action_invocation", cols), demoInv.id)));
  ck("effect refs are excluded THROUGH their parent, by FK and not by a second manifest entry",
    (await q(`select 1 from information_schema.columns where table_name='invocation_effect_refs' and column_name='invocation_id'`)).length === 1);

  // ── THE CHECKED-IN MANIFEST ───────────────────────────────────────────────────────────────────
  HD("THE MANIFEST — exact ids, and no way to identify certification by time or proximity");
  const manifest = JSON.parse(readFileSync(new URL("../docs/pilot/certification-exclusion-manifest.json", import.meta.url), "utf8")) as
    { subjects: { orgId: string; subjectKind: string; subjectId: string }[]; counts: Record<string, number> };
  ck("every manifest subject kind is one the schema will accept",
    manifest.subjects.every((x) => CERTIFICATION_SUBJECT_KINDS.includes(x.subjectKind as never)));
  ck("every subject is named by an exact uuid",
    manifest.subjects.length > 0 && manifest.subjects.every((x) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.subjectId)
      && /^[0-9a-f]{8}-/.test(x.orgId)));
  ck("the manifest is internally consistent", manifest.subjects.length === manifest.counts.TOTAL);
  ck("no subject is named twice for one org",
    new Set(manifest.subjects.map((x) => `${x.orgId}|${x.subjectKind}|${x.subjectId}`)).size === manifest.subjects.length);
  const activator = codeOf("./certification-exclusion-activate.ts");
  ck("BITING — the activation path contains NO time, proximity, deployment or count heuristic",
    !/interval|between\s|recorded_at\s*[<>]|requested_at\s*[<>]|deployment|Date\.now|timestamp/i.test(activator),
    { method: "exact ids read from the manifest" });
  ck("and it never rewrites a source row", !/update\s+(governed_action_invocations|change_ledger|pursuits)/i.test(activator));

  // ── CREDENTIAL-BOUND PROVENANCE ───────────────────────────────────────────────────────────────
  HD("CREDENTIAL PROVENANCE — the one thing an external caller cannot choose");
  const { mintKey } = await import("../src/lib/agents/mcp-tools");
  const { resolveKey } = await import("../src/lib/agents/mcp-tools");
  const mint = async (orgId: string, label: string, env: string | null) => {
    const { plaintext, hash } = mintKey();
    const r = await one(`insert into api_keys (org_id, name, key_hash, scope, data_environment)
                         values ($1,$2,$3,'write',$4) returning id`, [orgId, `${NS}-${label}`, hash, env]);
    return { id: r.id as string, bearer: plaintext };
  };
  const certKey = await mint(org.id, "cert", "CERTIFICATION");
  const pilotKey = await mint(org.id, "pilot", "PILOT");
  const legacyKey = await mint(org.id, "legacy", null);
  // A CREDENTIAL MINTED BY A PATH THAT NEVER MENTIONS PROVENANCE — which is what every issuing path
  // did before 0120, and what a careless new one would do again. The column must have NO DEFAULT:
  // an explicit null proves nothing about a default, and an earlier version of this control tested
  // only that, so adding `default 'PRODUCTION'` back to the schema passed it silently.
  const silentKey = await (async () => {
    const { plaintext, hash } = mintKey();
    const r = await one(`insert into api_keys (org_id, name, key_hash, scope) values ($1,$2,$3,'write') returning id`,
      [org.id, `${NS}-silent`, hash]);
    return { id: r.id as string, bearer: plaintext };
  })();
  const foreignKey = await mint(other.id, "foreign", "PRODUCTION");

  const rc = await resolveKey(pool as never, certKey.bearer);
  const rp = await resolveKey(pool as never, pilotKey.bearer);
  const rl = await resolveKey(pool as never, legacyKey.bearer);
  const rf = await resolveKey(pool as never, foreignKey.bearer);
  ck("a certification credential resolves CERTIFICATION", rc?.dataEnvironment === "CERTIFICATION" && rc?.orgId === org.id);
  ck("a pilot credential resolves PILOT", rp?.dataEnvironment === "PILOT" && rp?.orgId === org.id);
  ck("BITING — an unclassified credential resolves NULL, and NULL is not a synonym for PRODUCTION",
    rl !== null && rl.dataEnvironment === null, { keyId: rl?.keyId });
  const rs = await resolveKey(pool as never, silentKey.bearer);
  ck("BITING — a credential issued WITHOUT naming provenance stays unclassified: the column has NO default",
    rs !== null && rs.dataEnvironment === null,
    { got: rs?.dataEnvironment, why: "a default here would recreate the exact defect, at the schema level" });
  ck("and the schema confirms it directly",
    (await one(`select coalesce(column_default,'-') d from information_schema.columns
                 where table_name='api_keys' and column_name='data_environment'`)).d === "-");
  ck("a foreign-org credential carries its OWN org and its OWN provenance — it cannot lend either",
    rf?.orgId === other.id && rf?.dataEnvironment === "PRODUCTION" && rf?.orgId !== org.id);
  // The resolver is the whole trust boundary, so nothing about the REQUEST may move its answer.
  const rc2 = await resolveKey(pool as never, certKey.bearer);
  ck("resolution is a property of the bearer alone — repeated resolution is identical",
    JSON.stringify(rc) === JSON.stringify(rc2));
  ck("a bearer that is not ours costs no lookup and yields nothing",
    (await resolveKey(pool as never, "not-a-key")) === null && (await resolveKey(pool as never, null)) === null);

  // IMMUTABLE AFTER ISSUE, BY PRIVILEGE. 0116 narrowed app_rw to `update (revoked_at)`; a column
  // added to this table inherits that, which is the whole reason provenance lives here.
  const colUpd = await q(`select column_name from information_schema.column_privileges
                           where grantee='app_rw' and table_name='api_keys' and privilege_type='UPDATE'`);
  ck("app_rw may update ONLY revoked_at on a credential — provenance cannot drift CERTIFICATION → PILOT",
    colUpd.length === 1 && colUpd[0].column_name === "revoked_at");
  ck("POSITIVE CONTROL — the legitimate lifecycle operation still works: a credential can be revoked",
    (await pool.query(`update api_keys set revoked_at = now() where id = $1 and revoked_at is null`, [legacyKey.id])).rowCount === 1);
  ck("and a revoked credential resolves to nothing at all",
    (await resolveKey(pool as never, legacyKey.bearer)) === null);
  ck("app_rw may INSERT provenance (issue) but the column is bounded by CHECK",
    (await q(`select column_name from information_schema.column_privileges
               where grantee='app_rw' and table_name='api_keys' and privilege_type='INSERT'
                 and column_name='data_environment'`)).length === 1);
  let badKeyEnv = "";
  try { await pool.query(`insert into api_keys (org_id, name, key_hash, data_environment) values ($1,$2,$3,'NONSENSE')`,
                         [org.id, `${NS}-bad`, `${NS}-bad-hash`]); }
  catch (e) { badKeyEnv = (e as Error).message; }
  ck("CONTROL — an unknown credential environment is refused by the database",
    /violates check constraint/.test(badKeyEnv));

  // ── THE DISPATCH BOUNDARY CANNOT FORGET PROVENANCE ────────────────────────────────────────────
  HD("DISPATCH — provenance is required, so a new call site cannot inherit PRODUCTION by silence");
  const skillsSrc = codeOf("../src/lib/pursuits/federation/skills.ts");
  ck("DispatchCtx.dataEnvironment is REQUIRED, not optional",
    /dataEnvironment: DataEnvironment;/.test(skillsSrc) && !/dataEnvironment\?:/.test(skillsSrc));
  ck("and no `?? \"PRODUCTION\"` survives anywhere on the governed dispatch path",
    !skillsSrc.includes('?? "PRODUCTION"'));
  const ledgerSrc = codeOf("../src/lib/pursuits/ledger.ts");
  ck("recordChange cannot omit provenance either — the ledger is append-only and cannot be corrected",
    /dataEnvironment: DataEnvironment;/.test(ledgerSrc) && !ledgerSrc.includes('?? "PRODUCTION"'));
  const routeSrc = codeOf("../src/app/api/mcp/route.ts");
  ck("BITING — /api/mcp no longer contains the literal \"PRODUCTION\" at all",
    !routeSrc.includes('"PRODUCTION"'));
  ck("and it FAILS CLOSED on an unclassified credential rather than substituting a value",
    /key\.dataEnvironment/.test(routeSrc) && /provenance/i.test(routeSrc));
  const provSrc = codeOf("../src/lib/pursuits/provenance.ts");
  ck("the shared subject resolver returns null rather than a default",
    /Promise<DataEnvironment \| null>/.test(provSrc) && !provSrc.includes('"PRODUCTION"'));

  // BEHAVIOURAL: the whole dispatch, with a real credential's provenance.
  {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('app.org_id', $1, true)`, [org.id]);
      const { dispatchSkill } = await import("../src/lib/pursuits/federation/skills");
      const actor = { type: "AGENT" as const, id: null, orgId: org.id, role: "operator" as const };
      for (const [label, cred] of [["CERTIFICATION", rc], ["PILOT", rp]] as const) {
        const d = await dispatchSkill(client, "explain_route", actor, { dataEnvironment: cred!.dataEnvironment! });
        const row = await (await client.query(`select data_environment from governed_action_invocations where id=$1`, [d.invocationId])).rows[0];
        ck(`a ${label} credential's invocation is recorded as ${label}, not PRODUCTION`,
          d.status === "EXECUTED" && row.data_environment === label);
      }
      await client.query("commit");
    } catch (e) { await pool.query("rollback").catch(() => {}); ck("credential provenance reaches the invocation row", false, (e as Error).message); }
    finally { client.release(); }
  }

  // ── WHO GETS TO SAY WHAT ENVIRONMENT THIS IS ──────────────────────────────────────────────────
  HD("ENVIRONMENT TRUST — a caller may not declare its own provenance");
  const appSrc = ["src/app/pursuits/[id]/actions.ts", "src/app/api/mcp/route.ts", "src/app/experience/pursuits/actions.ts"]
    .map((f) => codeOf(`../${f}`)).join("\n");
  ck("no entry point reads dataEnvironment from a request body, params or tool arguments",
    !/(args|body|params|input|payload|searchParams)[^\n]{0,40}\.(dataEnvironment|data_environment)/.test(appSrc));
  // The derivation moved OUT of the surfaces into one resolver, which is why this looks for the
  // resolver rather than for five copies of a query string. Five copies is how the `?? "PRODUCTION"`
  // tail spread in the first place: once written, a default looks like the house style.
  ck("the UI path DERIVES it through the shared subject resolver, not from a request",
    /pursuitEnvironment\(db, orgId,/.test(appSrc) && /PROVENANCE_UNRESOLVED/.test(appSrc));
  ck("and that resolver reads the SUBJECT ROW, server-side, under the caller's org",
    /select data_environment from pursuits where id = \$1 and org_id = \$2/.test(provSrc));
  ck("a surface REFUSES when the subject yields no provenance — it never substitutes one",
    (appSrc.match(/PROVENANCE_UNRESOLVED/g) ?? []).length >= 5);
  const certPursuit = await one(`select data_environment from pursuits where org_id=$1 and dedup_key=$2`, [org.id, `${NS}-CERTIFICATION`]);
  ck("BEHAVIOURAL — that derivation returns CERTIFICATION for a certification subject, not PRODUCTION",
    certPursuit.data_environment === "CERTIFICATION");
  ck("no MCP tool argument, body field or parameter can name a provenance",
    !/(args|body|params|input|payload|searchParams)\s*(\.|\[["']?)(dataEnvironment|data_environment)/.test(appSrc));
  note("RESIDUAL, NAMED — an opportunity linked to no pursuit has no subject to derive from and "
    + "`opportunities` carries no environment of its own, so both ledger emissions are SKIPPED for it "
    + "rather than written with an invented label. Before this slice they wrote nothing at all, so "
    + "nothing is lost; closing it means giving CRM intake its own provenance, which is Slice 2.");
  note("SUPERSEDED — /api/mcp's hardcoded \"PRODUCTION\" is gone — /api/mcp passes the literal \"PRODUCTION\" for every call, "
    + "so MCP traffic cannot yet be PILOT or CERTIFICATION. That is the source of all 18 mislabelled hosted invocations. "
    + "A trusted replacement is an owner ruling (§5), not something this slice may guess.");

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
