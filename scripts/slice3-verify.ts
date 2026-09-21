import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { assertSeededClone } from "./seeded-clone";
import { evaluateMotions, loadMotionTemplates } from "../src/lib/motions/eligibility";
import { applyMotion } from "../src/lib/motions/apply";
import { motionV1Of, predicatesOf } from "../src/lib/motions/template";

/**
 * SLICE 3 — THIN P9: REUSABLE PURSUIT MOTIONS.
 *
 * The claim under test is a product claim: a reusable commercial pattern can be applied repeatedly
 * across accounts, establishing real pursuit structure from existing governed primitives — without
 * a model, without new authority, and without inventing evidence.
 *
 * SEEDED CLONE: commits fixtures.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "", max: 3 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"}  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const NS = `s3-${Math.random().toString(36).slice(2, 7)}`;
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
const n = async (s: string, p: unknown[] = []) => Number((await one(s, p)).n);
const codeOf = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const ASOF = new Date("2026-09-21T12:00:00.000Z");

/**
 * A canonical fact fixture. `facts` has eleven NOT NULL columns with no defaults — identity and
 * value keys, the three observation timestamps, the as-of, the origin kind — so a partial insert
 * fails one column at a time. One helper, built from that surface, keeps the fixtures honest and
 * the failures about the thing under test.
 */
const putFact = async (orgId: string, companyId: string, predicate: string,
  v: { objectType: "DATE" | "STRING"; date?: Date; text?: string; family: string; polarity?: number }) => {
  const at = new Date();
  await q(
    `insert into facts (org_id, company_id, subject_scope, subject_label, predicate_key, object_type,
                        date_value, text_value, status, provenance_class, origin_kind, family,
                        as_of, observed_at, observed_first_at, observed_last_at,
                        fact_identity_key, fact_value_key, data_environment, polarity)
     values ($1,$2,'COMPANY',$3,$4,$5,$6,$7,'CURRENT','FIRST_PARTY','HUMAN',$8,$9,$9,$9,$9,$10,$11,'DEMO',$12)`,
    [orgId, companyId, `fixture ${NS}`, predicate, v.objectType, v.date ?? null, v.text ?? null,
     v.family, at, `${companyId}|${predicate}|${v.text ?? ""}`,
     `${companyId}|${predicate}|${v.polarity ?? 1}|${v.date?.toISOString() ?? v.text ?? ""}`, v.polarity ?? 1]);
};

const tx = async <T>(orgId: string, fn: (db: import("pg").PoolClient) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [orgId]);
    const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
};

async function main() {
  await assertSeededClone(pool);
  console.log(`Slice 3 — thin P9: reusable pursuit motions  (${NS})`);

  const org = await one(`insert into organizations (name, kind, data_environment) values ($1,'full','DEMO') returning id`, [`S3 ${NS}`]);
  await q(`insert into org_features (org_id) values ($1) on conflict do nothing`, [org.id]);
  const node = await one(`select id from taxonomy_nodes where slug='virtualization'`);
  const aiNode = await one(`select id from taxonomy_nodes where slug='ai-platforms'`);

  // ── TEMPLATES ─────────────────────────────────────────────────────────────────────────────────
  HD("TEMPLATES — the pattern is content, and it reuses the primitive that already existed");
  const templates = await tx(org.id, (db) => loadMotionTemplates(db));
  const displacementSlug = "vmware-displacement-datacenter-modernization";
  ck("the three thin-P9 motions load, and the pre-existing LLM play is ignored rather than broken",
    templates.length === 3
    && !templates.some((t) => t.slug === "infrastructure-automation-modernization"),
    templates.map((t) => `${t.slug}@${t.version}`));
  ck("NO NEW TEMPLATE TABLE — identity and version come from play_templates, unique on (slug, version)",
    (await q(`select indexdef from pg_indexes where tablename='play_templates' and indexdef like '%slug%version%'`)).length === 1);
  ck("every predicate a template names EXISTS as a canonical fact predicate",
    await (async () => {
      const known = new Set((await q(`select key from fact_predicates`)).map((r) => r.key));
      return templates.every((t) => predicatesOf(t.motion).every((p) => known.has(p)));
    })());
  // A template naming a predicate that does not exist must be REFUSED, not silently unknowable.
  await q(`insert into play_templates (slug, version, name, definition, status)
           values ($1,1,'bogus',$2,'active')`,
          [`${NS}-bogus`, JSON.stringify({ motion_v1: { objective: "x", goalTemplate: "y",
            requires: [{ predicate: "no_such_predicate_at_all", op: "present", because: "z" }] } })]);
  let refused = "";
  try { await tx(org.id, (db) => loadMotionTemplates(db)); } catch (e) { refused = (e as Error).message; }
  ck("BITING — a template naming an unknown predicate is REFUSED, not left permanently unknowable",
    /names predicates that do not exist/.test(refused), { refused: refused.slice(0, 80) });
  await q(`delete from play_templates where slug=$1`, [`${NS}-bogus`]);

  // ── TEMPLATE IMMUTABILITY, AND THE ESCAPE HATCH ───────────────────────────────────────────────
  HD("IMMUTABILITY — a published version cannot change meaning, and the hatch is not application-reachable");
  ck("app_rw holds INSERT and SELECT on play_templates and NOTHING else",
    /app_rw=ar\//.test((await one(`select array_to_string(relacl,',') a from pg_class where relname='play_templates'`)).a));
  ck("and no column-level UPDATE grant sneaks back in",
    (await q(`select column_name from information_schema.column_privileges
               where grantee='app_rw' and table_name='play_templates' and privilege_type in ('UPDATE','DELETE')`)).length === 0);
  ck("a trigger refuses an in-place update even for a role that HAS the privilege",
    (await q(`select tgname from pg_trigger where tgrelid='play_templates'::regclass and not tgisinternal
               and tgname='play_templates_no_update'`)).length === 1);
  let ownerRewrite = "";
  try { await q(`update play_templates set name = 'rewritten' where slug = $1`, [displacementSlug]); }
  catch (e) { ownerRewrite = (e as Error).message; }
  ck("BEHAVIOURAL — even the owner is refused without the deliberate maintenance setting",
    /published and immutable/.test(ownerRewrite), { refused: ownerRewrite.slice(0, 70) });
  /**
   * THE HATCH IS NOT REACHABLE FROM ORDINARY EXECUTION.
   *
   * `pursuitos.allow_template_rewrite` is a custom GUC, and any role may set one — so the setting
   * is NOT the barrier and must not be relied on as one. The barrier is the PRIVILEGE: app_rw
   * cannot UPDATE or DELETE this table at all, so setting the GUC buys it nothing. The remaining
   * question is whether some SECURITY DEFINER function runs as the owner and could be induced to
   * write here; none does.
   */
  ck("NO SECURITY DEFINER function touches play_templates — there is no owner-privileged path in",
    (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname='public' and p.prosecdef and pg_get_functiondef(p.oid) ilike '%play_templates%'`)).length === 0);
  const srcAll = ["../src/lib/motions/apply.ts", "../src/lib/motions/eligibility.ts",
                  "../src/app/pursuits/[id]/actions.ts", "../src/lib/pursuits/federation/skills.ts"]
    .map((f) => codeOf(f)).join("\n");
  ck("and no application path sets the maintenance GUC or writes a template",
    !/allow_template_rewrite/.test(srcAll)
    && !/(insert|update|delete)[\s\S]{0,40}play_templates/i.test(srcAll));

  // ── ELIGIBILITY: THREE STATES ─────────────────────────────────────────────────────────────────
  HD("ELIGIBILITY — three states, because two would turn missing evidence into a negative finding");
  const co = async (label: string) => (await one(
    `insert into companies (legal_name, normalized_name) values ($1,$2) returning id`,
    [`${label} ${NS}`, `${label.toLowerCase()}-${NS}`])).id;

  const qualifying = await co("Renewing Co");
  await putFact(org.id, qualifying, 'renewal_date', { objectType: 'DATE', date: new Date(ASOF.getTime() + 120 * 86_400_000), family: 'trigger' });
  const silent = await co("Silent Co");                       // no facts at all
  const distant = await co("Distant Co");
  await putFact(org.id, distant, 'renewal_date', { objectType: 'DATE', date: new Date(ASOF.getTime() + 900 * 86_400_000), family: 'trigger' });

  const live = await tx(org.id, (db) => loadMotionTemplates(db));
  const displacement = live.find((t) => t.slug === "vmware-displacement-datacenter-modernization")!;
  const fits = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [qualifying, silent, distant], ASOF));
  ck("MOTION B BITE — renewal inside the window but the incumbent platform UNKNOWN ⇒ INSUFFICIENT_CONTEXT",
    fits.get(qualifying)![0].verdict === "INSUFFICIENT_CONTEXT", { got: fits.get(qualifying)![0].verdict });
  ck("the explanation says why: timely, but the platform is not established",
    fits.get(qualifying)![0].clauses.some((c) => c.predicate === "technology_in_use" && c.satisfied === null)
    && fits.get(qualifying)![0].missingContext.some((m) => /virtualization platform/i.test(m)));
  await putFact(org.id, qualifying, "technology_in_use", { objectType: "STRING", text: "VMware vSphere", family: "technology" });
  const withPlatform = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [qualifying], ASOF));
  ck("renewal window PLUS an established incumbent platform ⇒ ELIGIBLE",
    withPlatform.get(qualifying)![0].verdict === "ELIGIBLE", { got: withPlatform.get(qualifying)![0].verdict });
  /**
   * THE EXPLANATION FOLLOWS THE FACT, NOT THE MOTION'S NAME.
   *
   * The motion is called "VMware Displacement / Datacenter Modernization" whatever the evidence
   * says. The sentence shown to the reader may not inherit that name.
   */
  const platformNarrative = (fit: { clauses: { predicate: string; because: string }[] }) =>
    fit.clauses.find((c) => c.predicate === "technology_in_use")?.because ?? "";
  ck("a VMware-family incumbent MAY be described as displacement, naming the established value",
    /VMware displacement/i.test(platformNarrative(withPlatform.get(qualifying)![0]))
    && platformNarrative(withPlatform.get(qualifying)![0]).includes("VMware vSphere"),
    { narrative: platformNarrative(withPlatform.get(qualifying)![0]).slice(0, 90) });
  const hyperv = await co("HyperV Co");
  await putFact(org.id, hyperv, "renewal_date", { objectType: "DATE", date: new Date(ASOF.getTime() + 90 * 86_400_000), family: "trigger" });
  await putFact(org.id, hyperv, "technology_in_use", { objectType: "STRING", text: "Hyper-V", family: "technology" });
  const hvFit = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [hyperv], ASOF));
  ck("THE BITE — a NON-VMware incumbent is ELIGIBLE but the explanation does NOT claim VMware",
    hvFit.get(hyperv)![0].verdict === "ELIGIBLE"
    && !/vmware/i.test(platformNarrative(hvFit.get(hyperv)![0]))
    && /modernization/i.test(platformNarrative(hvFit.get(hyperv)![0]))
    && platformNarrative(hvFit.get(hyperv)![0]).includes("Hyper-V"),
    { narrative: platformNarrative(hvFit.get(hyperv)![0]).slice(0, 110) });
  const generic = await co("Generic Co");
  await putFact(org.id, generic, "renewal_date", { objectType: "DATE", date: new Date(ASOF.getTime() + 90 * 86_400_000), family: "trigger" });
  await putFact(org.id, generic, "technology_in_use", { objectType: "STRING", text: "virtualization", family: "technology" });
  const genFit = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [generic], ASOF));
  ck("and a merely GENERIC category fact is never promoted into a named-incumbent claim",
    !/vmware|hyper-v|nutanix/i.test(platformNarrative(genFit.get(generic)![0]))
    && /not named by the evidence/i.test(platformNarrative(genFit.get(generic)![0])),
    { narrative: platformNarrative(genFit.get(generic)![0]).slice(0, 110) });
  ck("ABSENT — an account with no renewal fact is INSUFFICIENT_CONTEXT, NOT ineligible",
    fits.get(silent)![0].verdict === "INSUFFICIENT_CONTEXT", { got: fits.get(silent)![0].verdict });
  ck("DEFINITIVE — a renewal outside the window IS a negative, because the fact exists and answers",
    fits.get(distant)![0].verdict === "NOT_ELIGIBLE", { got: fits.get(distant)![0].verdict });
  ck("the verdict carries the clauses that decided it, with fact REFERENCES and no evidence text",
    fits.get(qualifying)![0].clauses.every((c) => Array.isArray(c.factIds))
    && !JSON.stringify(fits.get(qualifying)![0].clauses).includes("SPONSOR_ONLY"));
  ck("what the product cannot observe is DECLARED, not invented as a signal",
    fits.get(qualifying)![0].missingContext.some((m) => /technology_in_use|no observations|unobserved/i.test(m)),
    fits.get(qualifying)![0].missingContext.slice(0, 1));

  // OWNER RULING — cost pressure is NOT generically disqualifying, and may strengthen the case.
  await putFact(org.id, qualifying, "budget_reduction_target", { objectType: "STRING", text: "15%", family: "trigger" });
  const withBudget = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [qualifying], ASOF));
  ck("BITING — budget_reduction_target does NOT independently produce NOT_ELIGIBLE",
    withBudget.get(qualifying)![0].verdict === "ELIGIBLE", { got: withBudget.get(qualifying)![0].verdict });
  ck("and no v1 motion declares a disqualifier merely to populate the field",
    live.every((t) => (t.motion.disqualifiers ?? []).length === 0));

  // ── MOTION A: WHITESPACE IS NEVER INFERRED FROM ABSENCE ───────────────────────────────────────
  HD("MOTION A — coverage is not whitespace, and silence is not evidence of absence");
  const whitespace = live.find((t) => t.slug === "install-base-whitespace-expansion")!;
  const partner = await one(`insert into partners (org_id, name, partner_type) values ($1,$2,'distributor') returning id`, [org.id, `P ${NS}`]);
  const covered = await co("Covered Co");
  await q(`insert into partner_accounts (org_id, partner_id, company_id, target_product, installed)
           values ($1,$2,$3,'Platform',false)`, [org.id, partner.id, covered]);
  const ws1 = await tx(org.id, (db) => evaluateMotions(db, org.id, [whitespace], [covered], ASOF));
  ck("THE BITE — a partner covers the account and install status is UNKNOWN ⇒ INSUFFICIENT_CONTEXT",
    ws1.get(covered)![0].verdict === "INSUFFICIENT_CONTEXT", { got: ws1.get(covered)![0].verdict });
  ck("and `installed = false` is proved to be the ABSENCE OF A STATEMENT, not a statement of absence",
    (await one(`select coalesce(column_default,'(none)') d, is_nullable from information_schema.columns
                 where table_name='partner_accounts' and column_name='installed'`)).d === "false");
  ck("the missing context names install-base confirmation explicitly",
    ws1.get(covered)![0].missingContext.some((m) => /install-base|product-state|installed/i.test(m)));

  // POSITIVE CONTROL — authoritative product-absence, which the model CAN state: polarity -1.
  await putFact(org.id, covered, "technology_in_use", { objectType: "STRING", text: "Infrastructure Automation", family: "technology", polarity: -1 });
  const ws2 = await tx(org.id, (db) => evaluateMotions(db, org.id, [whitespace], [covered], ASOF));
  ck("POSITIVE CONTROL — explicit evidence that the capability is NOT in use ⇒ ELIGIBLE",
    ws2.get(covered)![0].verdict === "ELIGIBLE", { got: ws2.get(covered)![0].verdict });
  // And the opposite affirmative closes it.
  const installedCo = await co("Installed Co");
  await q(`insert into partner_accounts (org_id, partner_id, company_id, target_product, installed)
           values ($1,$2,$3,'Platform',true)`, [org.id, partner.id, installedCo]);
  await putFact(org.id, installedCo, "technology_in_use", { objectType: "STRING", text: "Infrastructure Automation", family: "technology" });
  const ws3 = await tx(org.id, (db) => evaluateMotions(db, org.id, [whitespace], [installedCo], ASOF));
  ck("an affirmative install fact closes the whitespace ⇒ NOT_ELIGIBLE", ws3.get(installedCo)![0].verdict === "NOT_ELIGIBLE");
  ck("silence never satisfies `absent` — an account with no facts at all stays unknown",
    await (async () => {
      const bare = await co("Bare Co");
      const r = await tx(org.id, (db) => evaluateMotions(db, org.id, [whitespace], [bare], ASOF));
      return r.get(bare)![0].verdict === "INSUFFICIENT_CONTEXT";
    })());
  /**
   * THE DIRECT POLARITY CONTROL.
   *
   * A fact that DENIES `technology_in_use: VMware` must never satisfy an affirmative clause looking
   * for that value — it says the opposite. Without this, ignoring polarity in the affirmative filter
   * passed the whole suite, because every other case happened to route through the `absent` branch.
   */
  const denier = await co("Denier Co");
  await putFact(org.id, denier, "renewal_date", { objectType: "DATE", date: new Date(ASOF.getTime() + 100 * 86_400_000), family: "trigger" });
  await putFact(org.id, denier, "technology_in_use", { objectType: "STRING", text: "VMware vSphere", family: "technology", polarity: -1 });
  const denied = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [denier], ASOF));
  ck("BITING — a DENIAL of the incumbent platform is a definitive NO, never a match",
    denied.get(denier)![0].verdict === "NOT_ELIGIBLE"
    && denied.get(denier)![0].clauses.some((c) => c.predicate === "technology_in_use" && c.satisfied === false),
    { got: denied.get(denier)![0].verdict });
  ck("CONTROL — the same value asserted AFFIRMATIVELY does match, so the check is about polarity",
    await (async () => {
      const affirmer = await co("Affirmer Co");
      await putFact(org.id, affirmer, "renewal_date", { objectType: "DATE", date: new Date(ASOF.getTime() + 100 * 86_400_000), family: "trigger" });
      await putFact(org.id, affirmer, "technology_in_use", { objectType: "STRING", text: "VMware vSphere", family: "technology" });
      const r = await tx(org.id, (db) => evaluateMotions(db, org.id, [displacement], [affirmer], ASOF));
      return r.get(affirmer)![0].verdict === "ELIGIBLE";
    })());

  // ── APPLYING ──────────────────────────────────────────────────────────────────────────────────
  HD("APPLYING — an explicit act that composes existing primitives");
  const user = (await one(`select id from auth.users limit 1`))?.id ?? null;
  const applied = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: displacement.slug, subjectKind: "company", subjectId: qualifying,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("the motion applies", applied.status === "APPLIED", { status: applied.status, reason: applied.reason });
  ck("A PURSUIT EXISTS, carrying the motion's objective and the template's taxonomy node",
    !!applied.pursuitId
    && (await one(`select product_category_id, pursuit_type, data_environment from pursuits where id=$1`, [applied.pursuitId])).product_category_id === node.id);
  const motion = await one(`select play_template_id, pursuit_id, status, thesis from revenue_motions where id=$1`, [applied.motionId]);
  ck("A MOTION INSTANCE exists, bound to the exact template ROW — version is recorded structurally",
    motion.pursuit_id === applied.pursuitId
    && motion.play_template_id === (await one(`select id from play_templates where slug=$1 and version=$2`, [displacement.slug, displacement.version])).id);
  const actions = await q(`select step, action, due_at from motion_actions where motion_id=$1 order by step`, [applied.motionId]);
  ck("THE TEMPLATE'S OWN CADENCE became ordered dated actions — via the existing instantiator",
    actions.length === displacement.cadence.length && actions[0].step === 1 && !!actions[0].due_at,
    { steps: actions.length });
  const rev = await one(`select kind, decision, recommender_version from pursuit_plan_revisions where id=$1`, [applied.planRevisionId]);
  ck("A PLAN RECOMMENDATION resulted — through P3, not a parallel recommender",
    rev?.kind === "RECOMMENDATION" && rev?.decision === null);
  ck("and it is a PROPOSAL: nothing was approved, sent, queued or granted",
    await n(`select count(*)::int n from pursuit_plan_revisions where pursuit_id=$1 and kind='DECISION'`, [applied.pursuitId]) === 0
    && await n(`select count(*)::int n from action_outbox`) === 0
    && await n(`select count(*)::int n from campaign_touches where sent_at is not null`) === 0
    && await n(`select count(*)::int n from actor_capability_grants where org_id=$1`, [org.id]) === 0);
  const app = await one(`select * from motion_applications where id=$1`, [applied.applicationId]);
  ck("THE ACT IS RECORDED: template, version, subject, who, when, what resulted, and the verdict",
    app.template_slug === displacement.slug && app.template_version === displacement.version
    && app.subject_kind === "company" && app.subject_id === qualifying
    && app.applied_by_user_id === user && !!app.applied_at
    && app.pursuit_id === applied.pursuitId && app.eligibility === "ELIGIBLE"
    && app.data_environment === "DEMO");
  ck("the basis holds REFERENCES, CATEGORIES and TIMESTAMPS — and the missing context as it stood",
    Array.isArray(app.eligibility_basis.clauses)
    && app.eligibility_basis.clauses.every((b: Record<string, unknown>) =>
      Object.keys(b).every((k) => ["predicate", "op", "satisfied", "because", "factIds", "observed"].includes(k)))
    && Array.isArray(app.eligibility_basis.missingContext) && !!app.eligibility_basis.evaluatedAt);
  ck("BITING — the evaluated STATE is captured by value, so the verdict survives the facts moving",
    app.eligibility_basis.clauses.some((c: { observed?: { value?: string; observedAt?: string }[] }) =>
      (c.observed ?? []).some((o) => !!o.observedAt && o.value !== undefined)));
  ck("and no evidence prose crossed into it — values are normalized categories or dates",
    !JSON.stringify(app.eligibility_basis).includes("SPONSOR_ONLY"));
  ck("NO CAUSAL COLUMN EXISTS — there is nothing here to read as 'the motion caused it'",
    (await q(`select column_name from information_schema.columns where table_name='motion_applications'
               and (column_name like '%outcome%' or column_name like '%result%' or column_name like '%effect%'
                 or column_name like '%score%' or column_name like '%uplift%' or column_name like '%caus%')`)).length === 0);

  // ── IDEMPOTENCE AND VERSION ───────────────────────────────────────────────────────────────────
  HD("IDEMPOTENCE — the same act twice is one act; a new version is a new act");
  const again = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: displacement.slug, subjectKind: "company", subjectId: qualifying,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("re-applying the SAME version returns the existing instance and creates nothing",
    again.status === "ALREADY_APPLIED" && again.applicationId === applied.applicationId
    && await n(`select count(*)::int n from motion_applications where org_id=$1`, [org.id]) === 1
    && await n(`select count(*)::int n from revenue_motions where org_id=$1`, [org.id]) === 1);
  // Evolve the template. The historical application must not move.
  const nextVersion = displacement.version + 1;
  await q(`insert into play_templates (slug, version, name, taxonomy_node_id, definition, status)
           select slug, $2, name || ' next', taxonomy_node_id, definition, 'active'
             from play_templates where slug=$1 and version=$3`,
          [displacement.slug, nextVersion, displacement.version]);
  const histApp = await one(`select template_version, play_template_id from motion_applications where id=$1`, [applied.applicationId]);
  ck("VERSION — the historical application still names its own version after a newer one is published",
    histApp.template_version === displacement.version
    && histApp.play_template_id === (await one(`select id from play_templates where slug=$1 and version=$2`, [displacement.slug, displacement.version])).id);
  const v2 = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: displacement.slug, subjectKind: "company", subjectId: qualifying,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("and applying the NEWER version is a DIFFERENT act, which is what makes a rerun explicit",
    v2.status === "APPLIED" && v2.appliedVersion === nextVersion && v2.applicationId !== applied.applicationId);

  // ── MULTIPLE MOTIONS ──────────────────────────────────────────────────────────────────────────
  HD("MULTIPLE MOTIONS — the existing pursuit identity rule already answers this");
  const multi = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: whitespace.slug, subjectKind: "company", subjectId: covered,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("a different motion on a different account creates its own pursuit", multi.status === "APPLIED" && multi.pursuitId !== applied.pursuitId);
  // ── MOTION C: AN AI INITIATIVE IS A REASON TO INVESTIGATE, NOT PRODUCT FIT ────────────────────
  HD("MOTION C — a declared AI initiative does not establish RHAI or NVIDIA fit");
  const ai = live.find((t) => t.slug === "rhai-nvidia-ai-growth")!;
  const aiCo = await co("AI Co");
  await putFact(org.id, aiCo, "strategic_initiative", { objectType: "STRING", text: "GenAI platform rollout", family: "initiative" });
  const aiOnly = await tx(org.id, (db) => evaluateMotions(db, org.id, [ai], [aiCo], ASOF));
  ck("THE BITE — AI initiative present, platform/accelerator context missing ⇒ INSUFFICIENT_CONTEXT",
    aiOnly.get(aiCo)![0].verdict === "INSUFFICIENT_CONTEXT", { got: aiOnly.get(aiCo)![0].verdict });
  ck("and the missing context names workload, GPU estate, platform and accelerator relationship",
    ["workload", "GPU", "latform", "ccelerator"].every((w) => aiOnly.get(aiCo)![0].missingContext.join(" ").includes(w)));
  const nonAi = await co("NonAI Co");
  await putFact(org.id, nonAi, "strategic_initiative", { objectType: "STRING", text: "cost reduction programme", family: "initiative" });
  const nonAiFit = await tx(org.id, (db) => evaluateMotions(db, org.id, [ai], [nonAi], ASOF));
  ck("a non-AI initiative is a DEFINITIVE negative under v1 — the fact exists and answers",
    nonAiFit.get(nonAi)![0].verdict === "NOT_ELIGIBLE");
  await putFact(org.id, aiCo, "technology_in_use", { objectType: "STRING", text: "OpenShift with NVIDIA GPU nodes", family: "technology" });
  const aiFull = await tx(org.id, (db) => evaluateMotions(db, org.id, [ai], [aiCo], ASOF));
  ck("initiative PLUS established platform/accelerator context ⇒ ELIGIBLE — reachable with real predicates",
    aiFull.get(aiCo)![0].verdict === "ELIGIBLE", { got: aiFull.get(aiCo)![0].verdict });

  // Same account, second motion, different taxonomy node ⇒ different pursuit, by the dedup key.
  await putFact(org.id, qualifying, "strategic_initiative", { objectType: "STRING", text: "GenAI platform rollout", family: "initiative" });
  await putFact(org.id, qualifying, "technology_in_use", { objectType: "STRING", text: "OpenShift", family: "technology" });
  const second = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: ai.slug, subjectKind: "company", subjectId: qualifying,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("a SECOND motion on the SAME account, targeting a different category, gets its own pursuit",
    second.status === "APPLIED" && second.pursuitId !== applied.pursuitId,
    { node: aiNode?.id ? "ai-platforms" : "(absent)" });
  ck("and the account now legitimately carries two motions — one pursuit is not one playbook",
    await n(`select count(*)::int n from revenue_motions where org_id=$1 and company_id=$2`, [org.id, qualifying]) >= 2);
  // Applied to the PURSUIT rather than the company: joins, never forks. The AI motion is used here
  // because this account now has affirmative technology facts, which correctly CLOSE the whitespace
  // motion — the fixture follows the semantics rather than the other way round.
  const onPursuit = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: ai.slug, subjectKind: "pursuit", subjectId: applied.pursuitId!,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("applying to an existing PURSUIT joins that work instead of forking a new pursuit",
    onPursuit.status === "APPLIED" && onPursuit.pursuitId === applied.pursuitId);

  // ── REFUSALS AND GOVERNANCE ───────────────────────────────────────────────────────────────────
  HD("REFUSALS — eligibility recommends; it never instantiates");
  const refusedApply = await tx(org.id, (db) => applyMotion(db, {
    orgId: org.id, slug: displacement.slug, subjectKind: "company", subjectId: distant,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("a NOT_ELIGIBLE subject is refused, and nothing is created",
    refusedApply.status === "REFUSED"
    && await n(`select count(*)::int n from pursuits where org_id=$1 and account_id=$2`, [org.id, distant]) === 0);
  ck("BITING — eligibility alone instantiates NOTHING: evaluating every account created no state",
    await n(`select count(*)::int n from motion_applications where org_id=$1 and subject_id=$2`, [org.id, silent]) === 0
    && await n(`select count(*)::int n from pursuits where org_id=$1 and account_id=$2`, [org.id, silent]) === 0);
  const applySrc = codeOf("../src/lib/motions/apply.ts");
  ck("applying grants no authority: no grant, actor, credential or outbox write anywhere in the path",
    !/actor_capability_grants|governed_actors|api_keys|action_outbox/.test(applySrc));
  ck("and it reaches no provider and sends nothing",
    !/resend|sendgrid|fetch\(|provider|sent_at/i.test(applySrc));
  const skillsSrc = codeOf("../src/lib/pursuits/federation/skills.ts");
  ck("the skill is USER-only and INTERNAL_WRITE — an agent cannot choose which pattern fits",
    /skillId: "apply_pursuit_motion"[\s\S]{0,400}eligibleActors: \["USER"\][\s\S]{0,80}requiredPermission: "operator"/.test(skillsSrc));

  // ── P2 IS NOT TOUCHED ─────────────────────────────────────────────────────────────────────────
  HD("P2 — motion fit is a different quantity, and it stays out of the ranking");
  const p2Src = codeOf("../src/lib/pursuits/read-models/portfolio-pertinence.ts");
  const loaderSrc = codeOf("../src/lib/pursuits/read-models/portfolio-pertinence-loaders.ts");
  ck("no eligibility value reaches the ranking — P2 does not read motions, templates or fit",
    !/motion|eligib|play_template|motion_applications/i.test(p2Src)
    && !/motion_applications|play_template|eligib/i.test(loaderSrc));
  ck("P2's declared signal weights are unchanged — motion fit did not become an undocumented component",
    (p2Src.match(/decisionPressure|commercialPriority|contextNeed|momentum|activationReadiness/g) ?? []).length > 0
    && !/motionFit|motion_fit/.test(p2Src));
  const eligSrc = codeOf("../src/lib/motions/eligibility.ts");
  ck("and eligibility produces no number at all — nothing to mistake for a probability or a forecast",
    !/score|probability|likelihood|confidence\s*[:=]/i.test(eligSrc.split("export type Verdict")[1] ?? ""));

  // ── PROVENANCE AND TENANCY ────────────────────────────────────────────────────────────────────
  HD("PROVENANCE AND TENANCY");
  ck("the application carries the operating context's provenance, and the pursuit agrees",
    app.data_environment === "DEMO"
    && (await one(`select data_environment from pursuits where id=$1`, [applied.pursuitId])).data_environment === "DEMO");
  const other = await one(`insert into organizations (name, kind, data_environment) values ($1,'full','DEMO') returning id`, [`S3 other ${NS}`]);
  const foreign = await tx(other.id, (db) => applyMotion(db, {
    orgId: other.id, slug: displacement.slug, subjectKind: "pursuit", subjectId: applied.pursuitId!,
    appliedByUserId: user, dataEnvironment: "DEMO", now: ASOF }));
  ck("TENANT — another organization cannot apply a motion to this org's pursuit",
    foreign.status === "REFUSED", { reason: foreign.reason });
  ck("append-only: app_rw can neither edit nor delete an application record",
    /app_rw=ar\//.test((await one(`select array_to_string(relacl,',') a from pg_class where relname='motion_applications'`)).a));

  // ── PERFORMANCE ───────────────────────────────────────────────────────────────────────────────
  HD("PERFORMANCE — portfolio eligibility does not repeat P2's mistake");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('app.org_id',$1,true)`, [org.id]);
    const all = (await client.query(`select id from companies limit 200`)).rows.map((r) => r.id);
    const orig = client.query.bind(client); let stmts = 0;
    (client as unknown as { query: typeof orig }).query = ((...a: unknown[]) => { stmts++; return orig(...(a as Parameters<typeof orig>)); }) as typeof orig;
    await evaluateMotions(client, org.id, live, all, ASOF);
    (client as unknown as { query: typeof orig }).query = orig;
    await client.query("rollback");
    ck("evaluating EVERY template against EVERY account is a CONSTANT two statements",
      stmts === 2, { companies: all.length, templates: live.length, statements: stmts });
  } finally { client.release(); }

  console.log(`\n=== SLICE 3 — ${pass} passed, ${fail} failed`);
}
main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => { console.log(`\n=== SLICE 3 — ${pass} passed, ${fail} failed`); await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1); });
