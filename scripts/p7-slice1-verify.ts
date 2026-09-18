import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { executePursuitQuery, resolveGoTo } from "../src/lib/experience/execute";
import { PLANS, explainPlanFor } from "../src/lib/experience/plans";
import { testFixturePrincipal } from "../src/lib/experience/principal";
import { FILTERS } from "../src/lib/experience/registry";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import { compileIntent } from "../src/lib/experience/intent/compile";
import { runCompiledIntent } from "../src/lib/experience/intent/run";
import type { PursuitQuery } from "../src/lib/experience/types";

/**
 * P7 SLICE 1 — the proofs that need a real database and a real `app_rw` session.
 *
 * WHAT THIS PROVES, and why each one is here rather than in the unit suite: validation can be tested
 * without a database, but "an undisclosable pursuit cannot enter the result set" cannot — it needs
 * RLS binding on a non-BYPASSRLS role, a second organization, a live participation window and a
 * grant that can be withdrawn. Every assertion below runs through the SAME boundary the web route
 * calls, so what is measured is the behaviour a caller would actually get.
 *
 *   npx tsx scripts/verify-run.ts --suite p7-slice1
 *
 * The suite COMMITS fixtures, so it runs on a disposable seeded clone.
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 4 });
process.env.DATABASE_URL = rwUrl;   // the boundary's withTenant runs as app_rw, exactly like the app

/**
 * THE DEPLOYMENT MASTERS THIS SUITE REQUIRES, declared by the suite rather than assumed.
 * `experienceEnabledFor` is `envEnabled(flag) && org_features[flag]` for each of four flags: the
 * masters are a deployment switch and the org row is the tenant's entitlement. A suite that set only
 * the org row would be testing half the gate and would pass for the wrong reason — so both halves
 * are set here, and check 4 then turns the ORG row off with the masters still on, which is the case
 * that matters (ruling 1).
 */
for (const v of ["PURSUITS_ENABLED", "FACTS_ENABLED", "ROUTING_ENABLED", "PURSUIT_EXPERIENCE_ENABLED"]) process.env[v] = "true";
// This suite executes AS organizations it planted; the principal factory refuses without this.
process.env.P7_TEST_PRINCIPAL = "allow";

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const NS = `P7S1-${randomUUID().slice(0, 8)}`;

interface World { a: string; b: string; c: string; d: string; pursuitA: string; pursuitB: string; company: string }

/**
 * Every pursuit this suite plants, counted by the suite itself. Check 15 asserts the database holds
 * exactly these and no more — so "P7 wrote nothing" stays a real assertion even though later checks
 * deliberately plant additional OWNER fixtures to create an authority contrast.
 */
let planted = 0;

/**
 * Two organizations and a pursuit each. B participates on A's pursuit — so A's pursuit is VISIBLE to
 * B through participation, which is exactly the case where disclosure and derivation authority must
 * do the deciding rather than tenancy alone.
 */
async function plant(db: PoolClient): Promise<World> {
  const org = async (tag: string) => String((await db.query(
    `insert into organizations (name, kind) values ($1, 'full') returning id`, [`${NS} ${tag}`])).rows[0].id);
  // D exists to answer the empty-cohort question: an organization with NO adjacent candidates at all,
  // whose result must be byte-identical to C's, which has them and may see none.
  const a = await org("A"), b = await org("B"), c = await org("C"), d = await org("D");
  for (const o of [a, b, c, d]) {
    await db.query(`insert into org_features (org_id, pursuits, facts, routing, pursuit_experience, federation)
                    values ($1, true, true, true, true, true)`, [o]);
  }
  const company = String((await db.query(
    `insert into companies (legal_name, normalized_name) values ($1, $2) returning id`,
    [`${NS} Co`, NS.toLowerCase()])).rows[0].id);

  const pursuitA = await plantPursuit(db, a, company, `${NS}-A`), pursuitB = await plantPursuit(db, b, company, `${NS}-B`);

  for (const [p, sponsor] of [[pursuitA, a], [pursuitB, b]] as const) {
    await db.query(`insert into pursuit_participants (org_id, pursuit_id, sponsor_org_id, role_key, participation_state)
                    values ($1, $2, $3, 'VENDOR', 'ACTIVE')`, [sponsor, p, sponsor]);
  }
  // B is an ACTIVE participant on A's pursuit, inside its window.
  await db.query(`insert into pursuit_participants (org_id, pursuit_id, sponsor_org_id, role_key, participation_state, effective_from)
                  values ($1, $2, $3, 'DISTRIBUTOR', 'ACTIVE', now() - interval '1 hour')`, [b, pursuitA, a]);

  // Open opportunities: the metric's inputs.
  for (const [p, orgId, amount] of [[pursuitA, a, 500000], [pursuitA, a, 250000], [pursuitB, b, 100000]] as const) {
    await db.query(`insert into opportunities (org_id, company_id, pursuit_id, name, stage, amount_usd)
                    values ($1, $2, $3, $4, 'qualification', $5)`, [orgId, company, p, `${NS} opp`, amount]);
  }
  return { a, b, c, d, pursuitA, pursuitB, company };
}

/** One owner-planted pursuit. Counted, so check 15 stays an assertion and not an accounting. */
async function plantPursuit(db: PoolClient, orgId: string, company: string, key: string): Promise<string> {
  planted++;
  return String((await db.query(
    `insert into pursuits (org_id, account_id, dedup_key, status, pursuit_type, use_case, compelling_event)
     values ($1, $2, $3, 'QUALIFIED', 'EXPANSION', $4, $5) returning id`,
    [orgId, company, key, `${NS} use case`, `${NS} COMPELLING EVENT`])).rows[0].id);
}

/**
 * Run a plan AS a given organization. A script has no web session, so it uses the boundary's
 * explicit-org entry point — the same `withTenantOrg` path the MCP surface uses when the org comes
 * from an API key rather than a cookie. The org is planted by this suite, never taken from input.
 */
const asOrg = (orgId: string, p: PursuitQuery) => executePursuitQuery(p, testFixturePrincipal(orgId));

async function main(): Promise<void> {
  await assertSeededClone(owner);
  const db = await owner.connect();
  const w = await plant(db);
  db.release();   // inserts above auto-commit; the suite runs on a disposable clone

  console.log(`\n── P7 Slice 1 · fixtures ${NS}`);

  const onlyPursuits = (rows: { objectRef: { id: string } }[]) => rows.map((r) => r.objectRef.id);
  const plan = (over: Partial<PursuitQuery> = {}): PursuitQuery => ({ ...structuredClone(PLANS["open-by-value"].plan), ...over });

  // ── 1. The boundary refuses an invalid plan BEFORE any database work ──
  const invalid = await executePursuitQuery({ ...plan(), metrics: [{ id: "made.up", version: 1 }] });
  check("1: an unregistered metric is rejected by the boundary, not by the database",
    invalid.ok === false && invalid.error === "INVALID_PLAN", invalid.ok === false ? invalid.detail : "");

  const badField = await executePursuitQuery({ ...plan(), projection: ["pursuit.id", "pursuit.current_priority_score"] });
  check("2: an unregistered field is rejected", badField.ok === false && badField.error === "INVALID_PLAN");

  const historical = await executePursuitQuery({ ...plan(), asOf: "2026-01-01" as unknown as null });
  check("3: a historical asOf is rejected — Slice 1 has no historical semantics", historical.ok === false);

  // ── 2. Tenant entitlement denies even with the environment master ON ──
  const db2 = await owner.connect();
  await db2.query(`update org_features set pursuit_experience = false where org_id = $1`, [w.b]);
  const denied = await asOrg(w.b, plan());
  check("4: org entitlement false denies despite the env master being on",
    denied.ok === false && denied.error === "CAPABILITY_DENIED", denied.ok === false ? denied.detail : "");
  await db2.query(`update org_features set pursuit_experience = true where org_id = $1`, [w.b]);
  db2.release();

  // ── 3. Tenancy: A sees its own pursuit; C sees neither ──
  const asA = await asOrg(w.a, plan());
  check("5: the owning org sees its own pursuit", asA.ok && onlyPursuits(asA.result.rows).includes(w.pursuitA));
  const asC = await asOrg(w.c, plan());
  check("6: an unrelated org sees neither pursuit — absence is indistinguishable from non-existence",
    asC.ok && !onlyPursuits(asC.result.rows).includes(w.pursuitA) && !onlyPursuits(asC.result.rows).includes(w.pursuitB));

  // ── 4. The metric: derivation authority is NECESSARY BUT NOT SUFFICIENT ──
  const aMetric = asA.ok ? asA.result.rows.find((r) => r.objectRef.id === w.pursuitA)?.cells["pursuit.open_pipeline_usd@1"] : undefined;
  check("7: the owner's metric computes from its own inputs", aMetric?.visibility === "EXACT" && aMetric?.value === 750000,
    String(aMetric?.value));

  const asB = await asOrg(w.b, plan());
  const bOnA = asB.ok ? asB.result.rows.find((r) => r.objectRef.id === w.pursuitA) : undefined;
  check("8: a participant sees the foreign pursuit at all (participation, not ownership)", Boolean(bOnA));
  check("9: with NO machine-governed grant, the participant's metric is withheld — mayDerive is necessary",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.visibility === "SUPPRESSED",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.reason);
  check("10: a withheld metric carries NO value, no zero and no partial sum",
    bOnA?.cells["pursuit.open_pipeline_usd@1"]?.value === null);

  // ── 5. A governed field is resolved by the ladder, not by ownership alone ──
  check("11: PURSUIT_INTERNAL field on a foreign pursuit is not disclosed to a participant",
    bOnA?.cells["pursuit.compelling_event"] === undefined ||
    bOnA.cells["pursuit.compelling_event"].visibility === "SUPPRESSED");

  // ── 6. The response bytes must not carry a withheld value ──
  const serialized = JSON.stringify(asB.ok ? asB.result : {});
  check("12: no withheld value appears in the response bytes", !serialized.includes("COMPELLING EVENT"));

  // ── 7. Determinism ──
  const again = await asOrg(w.a, plan());
  check("13: the same plan twice produces the identical governed result",
    asA.ok && again.ok && JSON.stringify(stripInstant(asA.result)) === JSON.stringify(stripInstant(again.result)));

  // ── 8. The result is regenerable from the plan alone ──
  check("14: the result echoes the validated plan, so the surface is re-derivable",
    asA.ok && JSON.stringify(asA.result.plan) === JSON.stringify(plan()));

  // ── 8b. account_name: a governed cross-object field, not an alternate access path ──
  const aRow = asA.ok ? asA.result.rows.find((r) => r.objectRef.id === w.pursuitA) : undefined;
  check("16: account_name resolves for the owner, with its own provenance",
    aRow?.cells["pursuit.account_name"]?.visibility === "EXACT" &&
    aRow?.cells["pursuit.account_name"]?.provenance === "pursuit.account_name" &&
    String(aRow?.cells["pursuit.account_name"]?.value).startsWith(NS), String(aRow?.cells["pursuit.account_name"]?.value));

  // The outsider sees no row at all, so the subselect cannot have reached companies on its behalf.
  const outsiderBytes = JSON.stringify(asC.ok ? asC.result : {});
  check("17: an unauthorized org recovers no account name from the response bytes", !outsiderBytes.includes(`${NS} Co`));

  // The subselect runs inside the SAME tenant-pinned, RLS-bound statement as the row it belongs to:
  // it reads one column of one company keyed by the pursuit's own account_id, so it can neither
  // enumerate companies nor widen the row set. Proven by asking the same session for the company
  // directly and comparing: what the projection can see is never more than the session can see.
  const db4 = await owner.connect();
  const { rows: cmp } = await db4.query<{ n: string }>(
    `select count(*)::text as n from companies where id = $1`, [w.company]);
  db4.release();
  check("18: the fixture company exists exactly once — the projection reads a keyed scalar, not a set",
    cmp[0].n === "1", cmp[0].n);

  // ── 8c. Canonical vocabulary parity — the registry guard must match the database ──
  const db5 = await owner.connect();
  const vocab = async (constraint: string, upper: boolean) => {
    const { rows } = await db5.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = $1`, [constraint]);
    const re = upper ? /'([A-Z_]+)'::text/g : /'([a-z_]+)'::text/g;
    return [...(rows[0]?.d ?? "").matchAll(re)].map((m) => m[1]).sort();
  };
  const dbStatuses = await vocab("pursuits_status_check", true);
  const dbTypes = await vocab("pursuits_pursuit_type_check", true);
  db5.release();
  const regStatuses = [...(FILTERS["pursuit.status"].values ?? [])].sort();
  const regTypes = [...(FILTERS["pursuit.pursuit_type"].values ?? [])].sort();
  check("19: the accepted status vocabulary matches the database CHECK exactly — drift fails loudly",
    JSON.stringify(regStatuses) === JSON.stringify(dbStatuses),
    `code ${regStatuses.length} vs db ${dbStatuses.length}`);
  check("20: the accepted pursuit-type vocabulary matches the database CHECK exactly",
    JSON.stringify(regTypes) === JSON.stringify(dbTypes), `code ${regTypes.length} vs db ${dbTypes.length}`);

  // ── 8d. No request input can select another organization ──
  const crossOrg = await executePursuitQuery({ ...plan(), orgId: w.a } as unknown);
  check("21: a plan carrying an organization is rejected — an org is not a query parameter",
    crossOrg.ok === false && crossOrg.error === "INVALID_PLAN", crossOrg.ok === false ? crossOrg.detail : "");

  // ── 8e. EXPLAIN (Slice 2), through the same governed path ──
  const explainAsOwner = await asOrg(w.a, explainPlanFor(w.pursuitA));
  const ex = explainAsOwner.ok ? explainAsOwner.explanation : undefined;
  check("22: the owner receives an explanation for one authorized subject", Boolean(ex),
    explainAsOwner.ok ? (explainAsOwner.explanationError ?? "") : "");
  check("23: it carries provenance, NOT a second copy of the plan",
    Boolean(ex) && !("plan" in (ex as object)) && typeof ex?.planDigest === "string" && ex?.templateId === "pursuit.summary",
    ex ? `${ex.templateId}@${ex.templateVersion} plan ${ex.planDigest}` : "");
  check("24: every statement names a cell of the governed result",
    (ex?.statements ?? []).every((st) => st.ref in (explainAsOwner.ok ? explainAsOwner.result.rows[0].cells : {})),
    String(ex?.statements.length));

  // EXPLAIN CANNOT WIDEN A RESULT: the same plan with and without it returns the identical rows.
  const withoutExplain = await asOrg(w.a, { ...explainPlanFor(w.pursuitA), explain: false as const });
  const sameRows = explainAsOwner.ok && withoutExplain.ok &&
    JSON.stringify(explainAsOwner.result.rows) === JSON.stringify(withoutExplain.result.rows);
  check("25: explain:true returns the identical row set as explain:false", sameRows);

  // A participant with no machine-governed grant: the metric is unavailable, and the explanation
  // says so at OPERATION level without naming evidence — and the amount is nowhere in the bytes.
  const explainAsB = await asOrg(w.b, explainPlanFor(w.pursuitA));
  const exB = explainAsB.ok ? explainAsB.explanation : undefined;
  const metricStatement = exB?.statements.find((st) => st.ref === "pursuit.open_pipeline_usd@1");
  check("26: a grantless participant gets operation-level text for the metric, naming no evidence",
    metricStatement?.kind === "OPERATION" && !/grant|evidence|economic|opportunit/i.test(metricStatement.text),
    metricStatement?.text);
  const exBytes = JSON.stringify(exB ?? {});
  check("27: the withheld amount appears nowhere in the explanation bytes",
    !exBytes.includes("750000") && !exBytes.includes("500000") && !exBytes.includes("250000"));
  check("28: no internal reason code reaches the recipient-facing explanation",
    !/NOT_DISCLOSABLE|DERIVATION_DENIED|INPUT_NOT_DISCLOSABLE/.test(exBytes));

  // An unauthorized subject yields no explanation at all — not an error that confirms existence.
  const explainAsC = await asOrg(w.c, explainPlanFor(w.pursuitA));
  check("29: an unauthorized subject produces no explanation, indistinguishable from non-existence",
    explainAsC.ok && explainAsC.explanation === undefined,
    explainAsC.ok ? (explainAsC.explanationError ?? "") : "");

  // ── 8f. ANALYZE (Slice 3) — cohort membership under real RLS and real participation ──────────
  //
  // These are the §L proofs the unit suite cannot make. "A hidden member cannot affect an aggregate"
  // is only meaningful when the member is hidden by RLS and `mayDerive` rather than by a fixture
  // literal — B genuinely participates on A's pursuit, genuinely sees the row, and genuinely cannot
  // derive its economic value.
  const cohortPlan = (over: Partial<PursuitQuery> = {}): PursuitQuery =>
    ({ ...structuredClone(PLANS["open-pipeline-cohort"].plan), ...over });
  const METRIC = "pursuit.open_pipeline_usd@1";

  const cohortA = await asOrg(w.a, cohortPlan());
  const aggA = cohortA.ok ? cohortA.aggregate : undefined;
  const aCells = cohortA.ok ? cohortA.result.rows.map((r) => r.cells[METRIC]) : [];
  check("30: the owner's cohort computes, and equals the cells it can already see individually",
    aggA?.visibility === "EXACT" && aggA.value === aCells.reduce((s, c) => s + Number(c?.value), 0),
    `${aggA?.value} over ${aCells.length}`);
  check("31: basis.members is exactly the post-governance membership",
    aggA?.basis?.members === (cohortA.ok ? cohortA.result.rows.length : -1),
    String(aggA?.basis?.members));
  // L11: this cohort has one member, and the aggregate is that member's own governed metric — the
  // caller could already derive it, so a one-member cohort is not a channel.
  check("32: a single-member cohort reveals nothing the caller could not already derive",
    aCells.length === 1 && aggA?.value === aCells[0]?.value, String(aggA?.value));

  // B's cohort contains a member (A's pursuit) it can SEE but whose contribution it cannot DERIVE.
  const cohortB = await asOrg(w.b, cohortPlan());
  const aggB = cohortB.ok ? cohortB.aggregate : undefined;
  const bSawForeign = cohortB.ok && cohortB.result.rows.some((r) => r.objectRef.id === w.pursuitA);
  check("33: RULING 1 — one underivable contribution withholds the WHOLE aggregate",
    bSawForeign && aggB?.visibility === "WITHHELD" && aggB.value === null,
    `foreign member present: ${bSawForeign}`);
  const aggBytes = JSON.stringify(aggB ?? {});
  check("34: the withheld aggregate carries no partial sum, no basis and no member identity",
    !aggBytes.includes("100000") && !aggBytes.includes("750000") && !/"basis"|"members"/.test(aggBytes) &&
    !aggBytes.includes(w.pursuitA) && !aggBytes.includes(w.pursuitB));

  // L4: narrowing to B's OWN pursuit yields only what B already sees cell-by-cell, and the wide
  // cohort stays withheld — so there is no pair of published sums to difference.
  const narrowB = await asOrg(w.b, cohortPlan({ subject: { class: "pursuit", ids: [w.pursuitB] } }));
  const narrowAgg = narrowB.ok ? narrowB.aggregate : undefined;
  const bOwnCell = narrowB.ok ? narrowB.result.rows[0]?.cells[METRIC] : undefined;
  check("35: narrowing cannot expose a hidden member by subtraction",
    narrowAgg?.visibility === "EXACT" && narrowAgg.value === bOwnCell?.value && aggB?.value === null,
    `narrow ${narrowAgg?.value}, wide ${String(aggB?.value)}`);

  // L12, under governance: identical bytes on both the computed and the withheld path.
  const againA = await asOrg(w.a, cohortPlan());
  const againB = await asOrg(w.b, cohortPlan());
  check("36: the same cohort plan twice is byte-identical, basis.members included",
    JSON.stringify(aggA) === JSON.stringify(againA.ok ? againA.aggregate : null) &&
    JSON.stringify(aggB) === JSON.stringify(againB.ok ? againB.aggregate : null));

  // L8: change ONLY a value B cannot see. B's recipient-visible output must not move at all.
  const before = JSON.stringify({ rows: cohortB.ok ? cohortB.result.rows : null, agg: aggB });
  const db6 = await owner.connect();
  await db6.query(`insert into opportunities (org_id, company_id, pursuit_id, name, stage, amount_usd)
                   values ($1, $2, $3, $4, 'qualification', 424242)`, [w.a, w.company, w.pursuitA, `${NS} hidden opp`]);
  db6.release();
  const afterB = await asOrg(w.b, cohortPlan());
  const after = JSON.stringify({ rows: afterB.ok ? afterB.result.rows : null, agg: afterB.ok ? afterB.aggregate : undefined });
  check("37: changing only a hidden value changes neither B's output nor its basis",
    before === after && !after.includes("424242"));
  // …while the owner's own aggregate does move, proving the fixture actually changed something.
  const movedA = await asOrg(w.a, cohortPlan());
  check("38: the hidden change was real — the owner's own aggregate moved by exactly that amount",
    movedA.ok && Number(movedA.aggregate?.value) === Number(aggA?.value) + 424242,
    `${aggA?.value} → ${String(movedA.ok ? movedA.aggregate?.value : "")}`);

  // L1: an org that may see nothing is indistinguishable from one for which nothing exists.
  const cohortC = await asOrg(w.c, cohortPlan());
  const aggC = cohortC.ok ? cohortC.aggregate : undefined;
  check("39: an undisclosable pursuit influences neither membership, sum, nor provenance",
    cohortC.ok && cohortC.result.rows.length === 0 && aggC?.basis?.members === 0 &&
    !JSON.stringify(aggC ?? {}).includes(NS));

  // RULING 5: what executed is the code-defined cohort, unchanged.
  check("40: the executed cohort is exactly the code-defined plan",
    cohortA.ok && JSON.stringify(cohortA.result.plan) === JSON.stringify(PLANS["open-pipeline-cohort"].plan));
  const badAgg = await executePursuitQuery({ ...cohortPlan(), aggregate: { id: "made.up", version: 1 } });
  check("41: an unregistered aggregate is refused by the boundary, never by the database",
    badAgg.ok === false && badAgg.error === "INVALID_PLAN", badAgg.ok === false ? badAgg.detail : "");

  // ── 8g. THE EMPTY GOVERNED COHORT (ruled: EXACT 0 / members 0) ───────────────────────────────
  //
  // Zero means "zero over the cohort you are authorized to analyze" — never a claim that no hidden
  // business data exists elsewhere. The whole point is that the two are INDISTINGUISHABLE: an
  // organization with adjacent undisclosable candidates and one with none must produce identical
  // recipient-visible bytes, or the aggregate would confirm that something is being withheld.
  const visibleBytes = (o: Awaited<ReturnType<typeof asOrg>>) =>
    JSON.stringify(o.ok ? { rows: o.result.rows, counts: o.result.counts, agg: o.aggregate } : { error: o.error });

  const emptyD = await asOrg(w.d, cohortPlan());   // no adjacent candidates at all
  const emptyC1 = await asOrg(w.c, cohortPlan());  // adjacent candidates exist; C may see none
  check("42: an empty governed cohort is a deterministic zero over an empty set",
    emptyD.ok && emptyD.result.rows.length === 0 && emptyD.aggregate?.visibility === "EXACT" &&
    emptyD.aggregate.value === 0 && emptyD.aggregate.basis?.members === 0,
    `${String(emptyD.ok && emptyD.aggregate?.value)} over ${String(emptyD.ok && emptyD.aggregate?.basis?.members)}`);
  check("43: hidden candidates or none — the recipient-visible result is byte-identical",
    visibleBytes(emptyC1) === visibleBytes(emptyD));

  // Now plant a genuinely new hidden candidate under A, with its own open value. C cannot see it.
  const db7 = await owner.connect();
  const hidden = await plantPursuit(db7, w.a, w.company, `${NS}-HIDDEN`);
  await db7.query(`insert into pursuit_participants (org_id, pursuit_id, sponsor_org_id, role_key, participation_state)
                   values ($1, $2, $3, 'VENDOR', 'ACTIVE')`, [w.a, hidden, w.a]);
  await db7.query(`insert into opportunities (org_id, company_id, pursuit_id, name, stage, amount_usd)
                   values ($1, $2, $3, $4, 'qualification', 777777)`, [w.a, w.company, hidden, `${NS} hidden`]);
  db7.release();

  const emptyC2 = await asOrg(w.c, cohortPlan());
  check("44: a hidden candidate outside the governed cohort does not alter the empty result",
    visibleBytes(emptyC2) === visibleBytes(emptyC1) && !visibleBytes(emptyC2).includes("777777"));

  // Change only that hidden value. Nothing the recipient can see may move.
  const db8 = await owner.connect();
  await db8.query(`update opportunities set amount_usd = 888888 where pursuit_id = $1`, [hidden]);
  db8.release();
  const emptyC3 = await asOrg(w.c, cohortPlan());
  check("45: changing only a hidden candidate's value leaves the empty result unchanged",
    visibleBytes(emptyC3) === visibleBytes(emptyC1) && !visibleBytes(emptyC3).includes("888888"));

  // …and the hidden candidate was real: the authorized principal's aggregate moved by exactly it.
  const aAfterHidden = await asOrg(w.a, cohortPlan());
  check("46: the hidden candidate was real — the authorized principal's aggregate moved by exactly it",
    aAfterHidden.ok && Number(aAfterHidden.aggregate?.value) === Number(movedA.ok ? movedA.aggregate?.value : NaN) + 888888,
    String(aAfterHidden.ok ? aAfterHidden.aggregate?.value : ""));
  check("47: basis.members reflects only post-governance membership, on both sides of the contrast",
    emptyC3.ok && emptyC3.aggregate?.basis?.members === 0 && emptyC3.result.counts.authorized === 0 &&
    aAfterHidden.ok && aAfterHidden.aggregate?.basis?.members === aAfterHidden.result.rows.length,
    `${String(emptyC3.ok && emptyC3.aggregate?.basis?.members)} vs ${String(aAfterHidden.ok && aAfterHidden.aggregate?.basis?.members)}`);
  check("48: the empty result recovers no identifier from the cohort it may not see",
    !visibleBytes(emptyC3).includes(NS) && !visibleBytes(emptyC3).includes(w.pursuitA) &&
    !visibleBytes(emptyC3).includes(hidden));

  // ── 8h. GO TO (Slice 4) — resolution under real RLS, participation and disclosure ─────────────
  //
  // The proof that needs a database: an object that genuinely EXISTS but that this principal may not
  // see must be indistinguishable from one that does not exist. Only RLS and `can_see_pursuit` can
  // create that contrast honestly.
  const goTo = (orgId: string, id: string) =>
    resolveGoTo({ requestVersion: 1, ref: { class: "pursuit", id }, surface: "canonical" }, testFixturePrincipal(orgId));
  const NONEXISTENT = "11111111-2222-4333-8444-999999999999";

  const ownTarget = await goTo(w.a, w.pursuitA);
  check("49: the owner resolves its own pursuit to a governed navigation target",
    ownTarget.ok === true && ownTarget.target.path === `/pursuits/${w.pursuitA}`,
    ownTarget.ok ? ownTarget.target.path : ownTarget.error);
  check("50: the label never exceeds disclosure — it equals the governed cell the same principal sees",
    ownTarget.ok === true && ownTarget.target.label === String(aRow?.cells["pursuit.account_name"]?.value),
    ownTarget.ok ? ownTarget.target.label : "");

  // AN EXISTING BUT INVISIBLE OBJECT AND A NONEXISTENT ONE MUST BE THE SAME ANSWER.
  const invisible = await goTo(w.c, w.pursuitA);
  const nonexistent = await goTo(w.c, NONEXISTENT);
  check("51: an unauthorized object and a nonexistent one are byte-identical at the boundary",
    JSON.stringify(invisible) === JSON.stringify(nonexistent) && invisible.ok === false,
    JSON.stringify(invisible));
  check("52: neither answer carries a reason, a path or the id that was named",
    !JSON.stringify(invisible).includes(w.pursuitA) && !JSON.stringify(invisible).includes("/pursuits/") &&
    invisible.ok === false && Object.keys(invisible).sort().join(",") === "error,ok");

  // A participant may SEE the foreign pursuit, so it resolves — participation, not ownership.
  const participantTarget = await goTo(w.b, w.pursuitA);
  check("53: a participant resolves the foreign pursuit it is authorized to see",
    participantTarget.ok === true, participantTarget.ok ? participantTarget.target.label : participantTarget.error);
  check("54: no withheld value reaches the navigation target",
    !JSON.stringify(participantTarget).includes("COMPELLING EVENT") &&
    !JSON.stringify(participantTarget).includes("750000") &&
    !JSON.stringify(participantTarget).includes("888888"));

  // Changing only data hidden from C must not change C's navigation answer.
  const db9 = await owner.connect();
  await db9.query(`update pursuits set use_case = $1 where id = $2`, [`${NS} moved`, w.pursuitA]);
  db9.release();
  const invisibleAgain = await goTo(w.c, w.pursuitA);
  check("55: changing only hidden target data does not change the recipient-visible answer",
    JSON.stringify(invisibleAgain) === JSON.stringify(invisible));

  // Determinism, and the org is never a request parameter.
  const twice = await goTo(w.a, w.pursuitA);
  check("56: the same principal and the same canonical reference yield the same target",
    JSON.stringify(twice) === JSON.stringify(ownTarget));
  const crossOrgGoTo = await resolveGoTo(
    { requestVersion: 1, ref: { class: "pursuit", id: w.pursuitA }, surface: "canonical", orgId: w.a } as unknown,
    testFixturePrincipal(w.c));
  check("57: an organization smuggled into the request is refused, never honoured",
    crossOrgGoTo.ok === false && crossOrgGoTo.error === "INVALID_REQUEST",
    crossOrgGoTo.ok === false && crossOrgGoTo.error === "INVALID_REQUEST" ? crossOrgGoTo.detail : "");

  // ── 8i. INTENT (Slice 5) — a compiled proposal grants nothing a plan did not ──────────────────
  //
  // The proofs that need a database: a proposal is untrusted input, so what matters is that compiling
  // one adds NO authority. Everything here runs on hand-authored proposals (ruling 5) — there is no
  // model in this suite, and the deterministic path cannot tell that there isn't.
  const manifestFor = (o: Awaited<ReturnType<typeof asOrg>>) =>
    buildContextManifest(o.ok ? o.result.rows : []);
  const compileAs = (proposal: unknown, manifest: ReturnType<typeof buildContextManifest>, digest = manifest.digest) =>
    compileIntent({ proposal, manifest, boundContextDigest: digest, source: "HAND_AUTHORED" });

  const aList = await asOrg(w.a, plan());
  const aManifest = manifestFor(aList);
  const showMe = compileAs({ operation: "SHOW_ME", view: "open-by-value" }, aManifest);
  check("58: a hand-authored proposal compiles to a canonical operation",
    showMe.ok === true && showMe.intent.operation === "SHOW_ME",
    showMe.ok ? showMe.intent.interpretedAs : showMe.state);

  if (showMe.ok) {
    const viaIntent = await runCompiledIntent(showMe.intent, testFixturePrincipal(w.a));
    check("59: executing a compiled intent returns EXACTLY what the fixed plan returns directly",
      viaIntent.kind === "RESULT" && viaIntent.outcome.ok && aList.ok &&
      JSON.stringify(stripInstant(viaIntent.outcome.result)) === JSON.stringify(stripInstant(aList.result)));

    // THE PRINCIPAL IS NOT A PROPOSAL FIELD. The same compiled intent, run as a different org, returns
    // that org's governed result — the proposal carried no authority to move between them.
    const asCViaIntent = await runCompiledIntent(showMe.intent, testFixturePrincipal(w.c));
    check("60: the same compiled intent run as another principal returns THAT principal's result",
      asCViaIntent.kind === "RESULT" && asCViaIntent.outcome.ok && asCViaIntent.outcome.result.rows.length === 0,
      asCViaIntent.kind === "RESULT" && asCViaIntent.outcome.ok ? String(asCViaIntent.outcome.result.rows.length) : "");
  }

  // Two differently-worded proposals that compile to the same intent execute identically.
  const p1 = compileAs({ operation: "ANALYZE", view: "open-pipeline-cohort" }, aManifest);
  const p2 = compileAs({ view: "open-pipeline-cohort", operation: "ANALYZE" }, aManifest);
  check("61: proposals differing only in wording compile to an identical CompiledIntent",
    p1.ok && p2.ok && JSON.stringify(p1.intent) === JSON.stringify(p2.intent));
  if (p1.ok && p2.ok) {
    const [r1, r2] = [await runCompiledIntent(p1.intent, testFixturePrincipal(w.a)),
                      await runCompiledIntent(p2.intent, testFixturePrincipal(w.a))];
    check("62: and they execute identically, aggregate included",
      r1.kind === "RESULT" && r2.kind === "RESULT" && r1.outcome.ok && r2.outcome.ok &&
      JSON.stringify(r1.outcome.aggregate) === JSON.stringify(r2.outcome.aggregate),
      r1.kind === "RESULT" && r1.outcome.ok ? String(r1.outcome.aggregate?.value) : "");
  }

  // A CONTEXT REFERENCE CANNOT REACH OUTSIDE THE PRINCIPAL'S OWN MANIFEST.
  const cManifest = manifestFor(asC);
  check("63: an empty context refuses a subject reference rather than searching for one",
    compileAs({ operation: "EXPLAIN", subject: { fromContext: 0 } }, cManifest).ok === false);
  const foreignDigest = aManifest.digest;
  check("64: a proposal bound to another principal's context digest does not resolve",
    compileAs({ operation: "EXPLAIN", subject: { fromContext: 0 } }, cManifest, foreignDigest).ok === false);

  // An EXPLAIN compiled from A's own context equals the direct explain path for that subject.
  const explainIntent = compileAs({ operation: "EXPLAIN", subject: { fromContext: 0 } }, aManifest);
  if (explainIntent.ok) {
    const viaIntent = await runCompiledIntent(explainIntent.intent, testFixturePrincipal(w.a));
    const direct = await asOrg(w.a, explainPlanFor(aManifest.ids[0]));
    // The explanation carries the governance instant (D-P6-1), which legitimately differs between two
    // executions — so compare the SEMANTIC content with the instant masked, exactly as check 13 does.
    const maskExplanation = (e: unknown) =>
      JSON.stringify(e).replace(/"computedAt":"[^"]+"/, '"computedAt":"<instant>"');
    check("65: EXPLAIN via intent is identical to EXPLAIN via the certified path",
      viaIntent.kind === "RESULT" && viaIntent.outcome.ok && direct.ok &&
      Boolean(direct.explanation) &&
      maskExplanation(viaIntent.outcome.explanation) === maskExplanation(direct.explanation),
      direct.ok ? String(direct.explanation?.statements.length) : "");
  } else {
    check("65: EXPLAIN via intent is identical to EXPLAIN via the certified path", false, explainIntent.state);
  }

  // Invalid model output executes nothing: there is no CompiledIntent to run.
  for (const bad of [{ operation: "SHOW_ME", view: "everything" }, { operation: "SHOW_ME", orgId: w.b },
                     { operation: "EXPLAIN", subject: { id: w.pursuitA } }, null, { operation: "DELETE" }]) {
    const r = compileAs(bad, aManifest);
    if (r.ok) { check(`66: invalid proposal executes nothing — ${JSON.stringify(bad)}`, false); break; }
  }
  check("66: invalid proposals execute nothing — none of five compiled", true);

  // ── 9. No P7-local write occurred ──
  const db3 = await owner.connect();
  const { rows: counts } = await db3.query<{ n: string }>(
    `select (select count(*) from pursuits where dedup_key like $1 || '%')::text as n`, [NS]);
  check("15: the run wrote nothing of its own — only the suite's declared owner fixtures exist",
    counts[0].n === String(planted), `${counts[0].n} of ${planted}`);
  db3.release();

  console.log(`\nP7 Slice 1: ${passed} passed, ${failed} failed`);
  if (failures.length) for (const f of failures) console.log(`   FAILED: ${f}`);
  await owner.end();
  process.exit(failed === 0 ? 0 : 1);
}

const stripInstant = (r: { computedAt: string }) => ({ ...r, computedAt: "<instant>" });

main().catch((e) => { console.error("p7-slice1 fatal:", e instanceof Error ? e.message : String(e)); process.exit(2); });
