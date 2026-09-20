import { Pool, type PoolClient } from "pg";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import { loadPlanRecords, loadPursuitPlanView } from "../src/lib/pursuits/read-models/plan-loaders";
import { resolvePlanStanding } from "../src/lib/pursuits/read-models/pursuit-plan";
import { COORDINATION_SKILLS, dispatchSkill, SKILL_REGISTRY } from "../src/lib/pursuits/federation/skills";
import { getGovernedActions } from "../src/lib/pursuits/federation/read-models";
import { transitionMotion } from "../src/lib/motions/lifecycle";

/**
 * Pursuit Coordination — integration harness (vNext Slice 2A).
 *
 * Proves the Goal → Plan → Motion → Action path against the REAL schema and the
 * canonical Globex pursuit: the composed read-model, recommendation vs decision,
 * course correction, evidence lineage, tenant isolation, disclosure, append-only
 * enforcement and the absence of any external-send path.
 *
 * LEAVES THE WORLD AS IT FOUND IT. Read checks run in READ ONLY transactions. Every
 * scenario that writes (approve, adjust, decline, a new stakeholder assertion, a
 * review) runs inside a transaction that is ROLLED BACK — so the seeded
 * recommendation is still awaiting a decision afterwards, and the harness is
 * repeatable. Proven at the end by re-reading the counts.
 *
 * CLASSIFICATION: SEEDED — it needs the canonical world and the plan layer.
 *
 *   DATABASE_URL_VERIFY=… npx tsx scripts/vnext-coordination-verify.ts
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN, max: 2 });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

async function readOnly<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin read only");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** A scenario that writes — always rolled back. */
async function scenario<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

const count = async (db: PoolClient, sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

async function main(): Promise<void> {
  console.log(`[vnext-coordination-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  const hero = (await pool.query<{ id: string; org_id: string; env: string; account_id: string }>(
    `select p.id, p.org_id, p.data_environment env, p.account_id from pursuits p join companies c on c.id = p.account_id
      where c.legal_name = 'Globex Manufacturing Inc.' and p.pursuit_type = 'MODERNIZATION' order by p.created_at limit 1`)).rows[0];
  if (!hero) { console.log("FATAL: Globex hero pursuit not found — seed the canonical world first."); process.exit(1); }
  const otherOrg = (await pool.query<{ id: string }>(`select id from organizations where id <> $1 order by created_at limit 1`, [hero.org_id])).rows[0].id;
  const caller: Caller = await readOnly(hero.org_id, (db) => callerFor(db, hero.org_id));
  const guest: Caller = { orgId: hero.org_id, canSeeInternal: false, canSeeTransactionDetail: false };
  const operator = { type: "USER" as const, id: null, orgId: hero.org_id, role: "operator" as const };
  console.log(`\nPursuit under test: Globex Manufacturing Inc. · ${hero.id}`);

  const before = await readOnly(hero.org_id, async (db) => ({
    revisions: await count(db, `select count(*)::text n from pursuit_plan_revisions where pursuit_id = $1`, [hero.id]),
    ledger: await count(db, `select count(*)::text n from change_ledger where pursuit_id = $1`, [hero.id]),
    outbox: await count(db, `select count(*)::text n from action_outbox`),
    messages: await count(db, `select count(*)::text n from messages`),
    pursuitFacts: await count(db, `select count(*)::text n from pursuit_facts where pursuit_id = $1`, [hero.id]),
    motionActions: await count(db, `select count(*)::text n from motion_actions`),
  }));

  // =========================================================================
  console.log("\n1  Schema, grants and append-only enforcement");
  // =========================================================================
  await readOnly(hero.org_id, async (db) => {
    for (const t of ["pursuit_goals", "pursuit_plans", "pursuit_plan_revisions"]) {
      const r = (await db.query<{ rls: boolean; force: boolean }>(`select relrowsecurity rls, relforcerowsecurity force from pg_class where relname = $1`, [t])).rows[0];
      check(`${t} exists with RLS enabled and forced`, !!r && r.rls && r.force);
    }
    const priv = async (t: string, p: string) => (await db.query<{ ok: boolean }>(`select has_table_privilege('app_rw', $1, $2) ok`, [t, p])).rows[0].ok;
    check("revisions: app_rw may INSERT", await priv("pursuit_plan_revisions", "INSERT"));
    check("revisions: app_rw may NOT UPDATE (append-only)", !(await priv("pursuit_plan_revisions", "UPDATE")));
    check("revisions: app_rw may NOT DELETE (append-only)", !(await priv("pursuit_plan_revisions", "DELETE")));
    check("goals: app_rw may NOT DELETE", !(await priv("pursuit_goals", "DELETE")));
    const colPriv = async (t: string, col: string) => (await db.query<{ ok: boolean }>(`select has_column_privilege('app_rw', $1, $2, 'UPDATE') ok`, [t, col])).rows[0].ok;
    check("goals: objective is NOT updatable (immutable)", !(await colPriv("pursuit_goals", "objective")));
    check("goals: status IS updatable (forward lifecycle)", await colPriv("pursuit_goals", "status"));
    check("plans: goal_id is NOT updatable", !(await colPriv("pursuit_plans", "goal_id")));
    const ledgerDef = (await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'change_ledger_change_type_check'`)).rows[0].d;
    check("ledger vocabulary widened, prior values kept", ledgerDef.includes("PLAN_DECIDED") && ledgerDef.includes("ECONOMIC_FACT_DISPUTED") && ledgerDef.includes("PURSUIT_CREATED"));
    const ovDef = (await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'pursuit_overrides_field_check'`)).rows[0].d;
    check("override vocabulary widened with 'plan', prior values kept", ovDef.includes("'plan'") && ovDef.includes("'partner'"));
  });

  // =========================================================================
  console.log("\n2  Globex composed read-model (seeded recommendation)");
  // =========================================================================
  const view = await readOnly(hero.org_id, (db) => loadPursuitPlanView(db, caller, hero.id));
  check("plan view loads for the sponsor", !!view && view.exists);
  if (!view) { await pool.end(); process.exit(1); }
  console.log(`     goal     : ${view.goal?.objective} · ${view.goal?.targetLabel}`);
  console.log(`     progress : ${view.progress.label}`);
  console.log(`     focus    : ${view.focus?.headline} [${view.focus?.stateLabel}]`);
  console.log(`     motion   : ${view.motion.line} (${view.motion.note})`);
  console.log(`     next     : ${view.nextAction?.text} · owner ${view.nextAction?.ownerLabel} — ${view.nextAction?.ownerNote}`);
  for (const w of view.why) console.log(`     why      : ${w.text}${w.scopeLabel ? ` [${w.scopeLabel}]` : ""}`);
  check("status is awaiting a person's decision", view.status.state === "AWAITING_DECISION");
  check("goal is the commercial outcome from thesis + opportunity — no route choice in it (D-033)",
    view.goal?.objective === "Exit legacy virtualization before renewal and close the $920K opportunity" && !/WWT|CDW/.test(view.goal.objective), view.goal?.objective);
  check("the route a person chose lives in the plan (motion via WWT, why)", /WWT/.test(view.motion.line ?? "") && view.why.some((w) => /WWT/.test(w.text)));
  const oppClose = (await pool.query<{ d: string }>(`select to_char(expected_close_date,'YYYY-MM-DD') d from opportunities where pursuit_id = $1`, [hero.id])).rows[0]?.d;
  check("goal target is the opportunity's canonical close date", !!oppClose && view.goal?.targetLabel === `Target ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(oppClose.slice(5, 7)) - 1]} ${Number(oppClose.slice(8, 10))}`, `${view.goal?.targetLabel} vs ${oppClose}`);
  check("goal is proposed, not yet confirmed", view.goal?.confirmed === false);
  check("focus is the top-ranked gap: the missing economic buyer", /economic buyer/i.test(view.focus?.headline ?? ""));
  check("motion is the existing WWT Virtualization motion", /Virtualization/.test(view.motion.line ?? "") && /WWT/.test(view.motion.line ?? ""));
  check("motion linkage is stated as through the opportunity (canonical link, not inferred)", /opportunity/i.test(view.motion.note ?? ""));
  check("next action addresses the focus", /economic buyer/i.test(view.nextAction?.text ?? ""));
  check("owner is explicitly unassigned (role proposed, no one confirmed)", view.nextAction?.ownerLabel === "Unassigned" && /no one confirmed/.test(view.nextAction?.ownerNote ?? ""));
  const ms = Object.fromEntries(view.milestones.map((m) => [m.key, m.status]));
  check("route decided = DONE (a person's selection)", ms.route_decided === "DONE");
  check("champion + technical buyer = DONE (verified assertions)", ms.champion_confirmed === "DONE" && ms.technical_buyer_confirmed === "DONE");
  check("economic buyer = OPEN", ms.economic_buyer_confirmed === "OPEN");
  check("decision/paper process waits on the economic buyer (dependency)", ms.decision_path_mapped === "BLOCKED");
  check("value case = DONE (STRONG)", ms.value_case_strong === "DONE");
  check("timing for this pursuit = OPEN (account timing is not pursuit timing)", ms.timing_confirmed === "OPEN");
  check("progress is computed, 4 of 8", view.progress.done === 4 && view.progress.total === 8, view.progress.label);
  check("why follows the human route decision and preserves the recommendation", view.why.some((w) => /WWT/.test(w.text) && /CDW recommendation/.test(w.text)));
  check("why names the confirmed champion and technical buyer", view.why.some((w) => /Sarah Kim/.test(w.text) && /Mike Rivera/.test(w.text)));

  // =========================================================================
  console.log("\n3  Evidence lineage");
  // =========================================================================
  const timingWhy = view.why.find((w) => /held on the account/.test(w.text));
  check("account renewal is carried as ACCOUNT context, labelled so", !!timingWhy && timingWhy.scopeLabel === "Account context");
  check("account context never reads as confirmed for this pursuit", !!timingWhy && /not yet confirmed for this pursuit/.test(timingWhy.text));
  await readOnly(hero.org_id, async (db) => {
    const rec = resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).pending!;
    const refs = rec.basis.evidence.map((e) => `${e.refType}:${e.refId}`);
    check("recommendation basis cites the opportunity, route, motion and focus records",
      refs.some((r) => r.startsWith("opportunity:")) && refs.some((r) => r.startsWith("route:")) && refs.some((r) => r.startsWith("motion:")) && refs.some((r) => r.startsWith("stakeholder_role:economic_buyer")));
    check("focus carries the upstream gap rank and source (D-019)", rec.content.focus?.source === "STAKEHOLDER_COVERAGE" && (rec.content.focus?.rank ?? 0) >= 80);
    const allText = JSON.stringify(rec.content) + JSON.stringify(view);
    check("the RESTRICTED route reason never reaches the plan", !allText.includes("1,840,000") && !allText.includes("RAW_SPEND"));
  });

  // =========================================================================
  console.log("\n4  Recommendation vs decision — approve (rolled back)");
  // =========================================================================
  await scenario(hero.org_id, async (db) => {
    const recsBefore = await loadPlanRecords(db, caller, hero.id);
    const rec = resolvePlanStanding(recsBefore.revisions).pending!;
    const recRow = (await db.query(`select content, basis, created_at from pursuit_plan_revisions where id = $1`, [rec.id])).rows[0];
    const res = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: recsBefore.plan!.id, recommendationId: rec.id, decision: "APPROVED" }, dataEnvironment: hero.env,
    });
    check("approve dispatches EXECUTED through the governed boundary", res.status === "EXECUTED", res.reason ?? "");
    const after = await loadPlanRecords(db, caller, hero.id);
    const st = resolvePlanStanding(after.revisions);
    check("a DECISION revision now answers the recommendation", st.inForce?.kind === "DECISION" && st.inForce.respondsToRevisionId === rec.id && st.inForce.decision === "APPROVED");
    const recRowAfter = (await db.query(`select content, basis, created_at from pursuit_plan_revisions where id = $1`, [rec.id])).rows[0];
    check("the recommendation itself is unchanged (never overwritten)", JSON.stringify(recRow) === JSON.stringify(recRowAfter));
    // POSTURE-AGNOSTIC: this suite asserts that the approved action REACHED THE QUEUE, not which
    // generation recorded the link. A v1 decision keeps the pointer inside its content; a v2
    // decision carries lineage columns. Both are correct, and which one runs is a deployment
    // setting (PLAN_CONTENT_V2_WRITES_ENABLED), not a property of coordination.
    const staged = st.inForce
      ? (st.inForce.legacyStagedActionId
        ?? (await db.query<{ id: string }>(`select id from motion_actions where org_id = $1 and plan_revision_id = $2`, [caller.orgId, st.inForce.id])).rows[0]?.id)
      : undefined;
    const ma = staged ? (await db.query<{ status: string; action: string; motion_id: string }>(`select status, action, motion_id from motion_actions where id = $1`, [staged])).rows[0] : null;
    check("the next action is staged as a pending step on the existing motion queue", !!ma && ma.status === "pending" && /economic buyer/i.test(ma.action));
    check("goal confirmed and plan active on approval", after.goal?.status === "ACTIVE" && after.plan?.status === "ACTIVE");
    const types = (await db.query<{ change_type: string }>(`select change_type from change_ledger where pursuit_id = $1 and recorded_at >= now()`, [hero.id])).rows.map((r) => r.change_type);
    check("ledger records the human decision and the queued action", types.includes("PLAN_DECIDED") && types.includes("ACTION_CREATED"));
    const inv = (await db.query<{ status: string; effect_class: string }>(`select status, effect_class from governed_action_invocations where skill_id = 'decide_pursuit_plan' and pursuit_id = $1 order by requested_at desc limit 1`, [hero.id])).rows[0];
    check("the invocation is audited as INTERNAL_WRITE", inv?.status === "EXECUTED" && inv.effect_class === "INTERNAL_WRITE");
    const v = await loadPursuitPlanView(db, caller, hero.id);
    check("surface reads Approved and the plan is current", v?.status.state === "APPROVED" && v.review.state === "CURRENT");
    check("surface shows the action as queued", v?.nextAction?.queued === true);

    // Deciding the same recommendation twice is refused.
    const again = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: after.plan!.id, recommendationId: rec.id, decision: "APPROVED" }, dataEnvironment: hero.env,
    });
    check("a recommendation can be decided only once", again.status === "FAILED" && /no longer awaiting/.test(again.reason ?? ""));

    // =========================================================================
    console.log("\n5  Course correction — new evidence makes the approved plan reviewable (rolled back)");
    // =========================================================================
    const opp = (await db.query<{ id: string }>(`select id from opportunities where pursuit_id = $1 limit 1`, [hero.id])).rows[0].id;
    const dana = (await db.query<{ id: string }>(`select id from contacts where name = 'Dana Whitfield' limit 1`)).rows[0]?.id;
    const assert = await dispatchSkill(db, "assert_stakeholder_role", operator, {
      pursuitId: hero.id, dataEnvironment: hero.env,
      args: { opportunityId: opp, contactId: dana, role: "economic_buyer", assertionState: "verified", source: "verifier", evidence: "Customer confirmed budget ownership on the call.", basis: ["human_statement"] },
    });
    check("a governed assertion verifies the economic buyer", assert.status === "EXECUTED", assert.reason ?? "");
    const v2 = await loadPursuitPlanView(db, caller, hero.id);
    check("the approved plan is now REVIEW_NEEDED", v2?.status.state === "REVIEW_NEEDED" && v2.review.state === "REVIEW_NEEDED");
    check("review says why: the milestone that was reached", (v2?.review.reasons ?? []).some((r) => /Economic buyer confirmed — reached/.test(r)), JSON.stringify(v2?.review.reasons));
    check("review says why: the focus moved", (v2?.review.reasons ?? []).some((r) => /most important gap is now/i.test(r)));
    const stillInForce = resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).inForce;
    check("the approved plan was NOT rewritten by the new evidence", stillInForce?.id === st.inForce?.id && v2?.nextAction?.text === v?.nextAction?.text);
    const rr = await dispatchSkill(db, "recommend_pursuit_plan", operator, { pursuitId: hero.id, dataEnvironment: hero.env });
    const rrResult = rr.result as { status: string; reviewRequired: boolean } | undefined;
    check("an updated recommendation is recorded with a review trigger", rr.status === "EXECUTED" && rrResult?.status === "RECORDED" && rrResult.reviewRequired === true);
    const trig = (await db.query<{ review_trigger: { reasons: string[]; fromRevisionId: string } }>(`select review_trigger from pursuit_plan_revisions where plan_id = $1 order by revision_no desc limit 1`, [after.plan!.id])).rows[0].review_trigger;
    check("the review trigger names the plan it supersedes and why", trig?.fromRevisionId === st.inForce?.id && trig.reasons.length > 0);
    check("PLAN_REVIEW_REQUIRED is on the ledger", await count(db, `select count(*)::text n from change_ledger where pursuit_id = $1 and change_type = 'PLAN_REVIEW_REQUIRED'`, [hero.id]) === 1);
    const v3 = await loadPursuitPlanView(db, caller, hero.id);
    check("the surface offers the update while the approved plan stays shown", !!v3?.review.update && !v3.review.update.stale && v3.nextAction?.text === v?.nextAction?.text);
    check("the update's focus moved off the economic buyer", !/economic buyer/i.test(v3?.review.update?.focusHeadline ?? "economic buyer"));
    const approveUpdate = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: after.plan!.id, recommendationId: v3!.review.update!.revisionId, decision: "APPROVED" }, dataEnvironment: hero.env,
    });
    check("a person approves the update", approveUpdate.status === "EXECUTED", approveUpdate.reason ?? "");
    const v4 = await loadPursuitPlanView(db, caller, hero.id);
    check("the plan is current again, and history keeps all four steps", v4?.review.state === "CURRENT" && v4.history.length === 4);
    check("progress moved: a milestone reached since approval is counted", (v4?.progress.done ?? 0) === 5);
  });

  // =========================================================================
  console.log("\n6  Human adjustment is preserved as supervision data (rolled back)");
  // =========================================================================
  await scenario(hero.org_id, async (db) => {
    const recs = await loadPlanRecords(db, caller, hero.id);
    const rec = resolvePlanStanding(recs.revisions).pending!;
    const noReason = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: recs.plan!.id, recommendationId: rec.id, decision: "ADJUSTED", adjustments: { dueInDays: 3 } }, dataEnvironment: hero.env,
    });
    check("an adjustment without a reason is refused", noReason.status === "FAILED");
    const specialist = (await db.query<{ id: string }>(`select id from pursuit_team_members where pursuit_id = $1 and role = 'VENDOR_SPECIALIST' limit 1`, [hero.id])).rows[0].id;
    const adj = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, dataEnvironment: hero.env,
      args: { planId: recs.plan!.id, recommendationId: rec.id, decision: "ADJUSTED", reason: "Specialist already knows the CFO office", adjustments: { ownerTeamMemberId: specialist, dueInDays: 3 } },
    });
    check("an adjusted approval is accepted", adj.status === "EXECUTED", adj.reason ?? "");
    const after = resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions);
    // The FIELDS a person changed, independent of the generation's vocabulary: a v1 row records
    // `nextAction.owner`, a v2 row `action.owner`, and both mean the owner changed.
    const changedFields = after.inForce?.adjustments?.map((c) => c.field.replace(/^(nextAction|action)\./, "")).sort();
    check("the decision records exactly what changed", JSON.stringify(changedFields) === JSON.stringify(["dueInDays", "owner"]), JSON.stringify(changedFields));
    check("the adjusted action keeps the recommended action's key", after.inForce?.content.actions[0]?.key === rec.content.actions[0]?.key);
    const ov = (await db.query<{ field: string; original_recommendation: { revisionId: string }; human_decision: { decision: string }; data_environment: string }>(
      `select field, original_recommendation, human_decision, data_environment from pursuit_overrides where pursuit_id = $1 and field = 'plan'`, [hero.id])).rows[0];
    check("the divergence lands on pursuit_overrides (field 'plan') with both sides", !!ov && ov.original_recommendation.revisionId === rec.id && ov.human_decision.decision === "ADJUSTED");
    check("the override carries the pursuit's synthetic lineage, not PRODUCTION", ov?.data_environment === hero.env);
    const goalAfter = (await loadPlanRecords(db, caller, hero.id)).goal;
    check("an action adjustment leaves the goal's identity and objective untouched", goalAfter?.id === recs.goal?.id && goalAfter?.objective === recs.goal?.objective);
  });

  // =========================================================================
  console.log("\n7  Decline (rolled back)");
  // =========================================================================
  await scenario(hero.org_id, async (db) => {
    const recs = await loadPlanRecords(db, caller, hero.id);
    const rec = resolvePlanStanding(recs.revisions).pending!;
    const rej = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: recs.plan!.id, recommendationId: rec.id, decision: "REJECTED", reason: "Waiting for the QBR" }, dataEnvironment: hero.env,
    });
    check("a decline with a reason is recorded", rej.status === "EXECUTED", rej.reason ?? "");
    const after = await loadPlanRecords(db, caller, hero.id);
    const st = resolvePlanStanding(after.revisions);
    check("nothing comes into force on a decline", st.inForce === null && st.pending === null);
    check("the goal stays proposed and nothing is queued", after.goal?.status === "PROPOSED" && (await count(db, `select count(*)::text n from motion_actions where org_id = $1 and plan_revision_id = $2`, [caller.orgId, st.latestDecision?.id ?? "00000000-0000-0000-0000-000000000000"])) === 0);
    const v = await loadPursuitPlanView(db, caller, hero.id);
    check("the surface says the recommendation was declined", v?.status.state === "DECLINED");
  });

  // =========================================================================
  console.log("\n7b Goal ↔ plan boundary — route, motion and action are plan state; the goal is the outcome");
  // =========================================================================
  await readOnly(hero.org_id, async (db) => {
    const g = (await db.query(`select objective, basis from pursuit_goals where pursuit_id = $1`, [hero.id])).rows;
    check("exactly one goal, and neither its objective nor its basis names a partner or route", g.length === 1 && !/WWT|CDW|route/i.test(JSON.stringify(g)), JSON.stringify(g));
    const rec = resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).pending!;
    check("the plan revision carries the route; it carries no copy of the goal", /WWT/.test(JSON.stringify(rec.content)) && !("goalObjective" in (rec.content as object)));
  });

  const routeCandidate = async (db: PoolClient, partner: string) => (await db.query<{ id: string }>(
    `select rc.id from route_candidates rc
       join pursuit_route_snapshots sn on sn.id = rc.route_snapshot_id
       join partners p on p.id = rc.partner_id
      where sn.pursuit_id = $1 and sn.is_current and p.name = $2 order by rc.rank limit 1`, [hero.id, partner])).rows[0]?.id;

  await scenario(hero.org_id, async (db) => {
    const r0 = await loadPlanRecords(db, caller, hero.id);
    const goal0 = r0.goal!;
    const plan0 = r0.plan!;
    const rec0 = resolvePlanStanding(r0.revisions).pending!;
    await dispatchSkill(db, "decide_pursuit_plan", operator, { pursuitId: hero.id, args: { planId: plan0.id, recommendationId: rec0.id, decision: "APPROVED" }, dataEnvironment: hero.env });

    const toCdw = await dispatchSkill(db, "select_partner_route", operator, { pursuitId: hero.id, args: { candidateKey: await routeCandidate(db, "CDW") }, dataEnvironment: hero.env });
    check("route WWT → CDW through the governed route decision", toCdw.status === "EXECUTED", toCdw.reason ?? "");
    const r1 = await loadPlanRecords(db, caller, hero.id);
    const v1 = await loadPursuitPlanView(db, caller, hero.id);
    check("WWT → CDW: the SAME goal row, the same objective", r1.goal?.id === goal0.id && r1.goal?.objective === goal0.objective && v1?.goal?.objective === goal0.objective);
    check("WWT → CDW: the approved PLAN becomes reviewable because the route changed",
      v1?.review.state === "REVIEW_NEEDED" && v1.review.reasons.some((r) => /^Route is now CDW/.test(r)), JSON.stringify(v1?.review.reasons));
    check("WWT → CDW: no review reason claims the objective changed", !(v1?.review.reasons ?? []).some((r) => /goal|objective/i.test(r)));
    const rr = await dispatchSkill(db, "recommend_pursuit_plan", operator, { pursuitId: hero.id, dataEnvironment: hero.env });
    const r1b = await loadPlanRecords(db, caller, hero.id);
    check("WWT → CDW: plan history gains a recommendation on the SAME plan, with a review trigger",
      rr.status === "EXECUTED" && r1b.plan?.id === plan0.id && r1b.revisions.length === r1.revisions.length + 1 && !!r1b.revisions.at(-1)?.reviewTrigger);
    const upd = resolvePlanStanding(r1b.revisions).pending!;
    check("WWT → CDW: the updated plan names the route a person approved (a recommendation accepted is still a choice)",
      upd.content.why.some((w) => w.text === "Runs through CDW, the recommended route, approved by a person."), JSON.stringify(upd.content.why.map((w) => w.text)));
    const ap = await dispatchSkill(db, "decide_pursuit_plan", operator, { pursuitId: hero.id, args: { planId: plan0.id, recommendationId: upd.id, decision: "APPROVED" }, dataEnvironment: hero.env });
    check("WWT → CDW: a person approves the route-updated plan; the goal row is unchanged", ap.status === "EXECUTED" && (await loadPlanRecords(db, caller, hero.id)).goal?.id === goal0.id);

    const toWwt = await dispatchSkill(db, "override_partner_route", operator, { pursuitId: hero.id, args: { candidateKey: await routeCandidate(db, "WWT"), reason: "exec relationship", category: "EXECUTIVE_DIRECTION" }, dataEnvironment: hero.env });
    const r2 = await loadPlanRecords(db, caller, hero.id);
    const v2 = await loadPursuitPlanView(db, caller, hero.id);
    check("CDW → WWT: the SAME goal again; only the plan is reviewable",
      toWwt.status === "EXECUTED" && r2.goal?.id === goal0.id && r2.goal?.objective === goal0.objective && v2?.review.reasons.some((r) => /^Route is now WWT/.test(r)) === true, JSON.stringify(v2?.review.reasons));
    check("neither route change created or superseded a goal", await count(db, `select count(*)::text n from pursuit_goals where pursuit_id = $1`, [hero.id]) === 1);
  });

  await scenario(hero.org_id, async (db) => {
    const r0 = await loadPlanRecords(db, caller, hero.id);
    const rec0 = resolvePlanStanding(r0.revisions).pending!;
    await dispatchSkill(db, "decide_pursuit_plan", operator, { pursuitId: hero.id, args: { planId: r0.plan!.id, recommendationId: rec0.id, decision: "APPROVED" }, dataEnvironment: hero.env });
    await transitionMotion(db, hero.org_id, rec0.content.motion.motionId!, "abandoned");
    const r1 = await loadPlanRecords(db, caller, hero.id);
    const v = await loadPursuitPlanView(db, caller, hero.id);
    check("motion change: the SAME goal row and objective", r1.goal?.id === r0.goal?.id && r1.goal?.objective === r0.goal?.objective);
    check("motion change: the plan is reviewable because its motion changed", v?.review.state === "REVIEW_NEEDED" && v.review.reasons.some((r) => /motion/i.test(r)), JSON.stringify(v?.review.reasons));
  });

  await scenario(hero.org_id, async (db) => {
    const r0 = await loadPlanRecords(db, caller, hero.id);
    const old = (await db.query(`select * from pursuit_goals where id = $1`, [r0.goal!.id])).rows[0];
    const revs0 = r0.revisions.length;
    const noReason = await dispatchSkill(db, "replace_pursuit_goal", operator, { pursuitId: hero.id, args: { objective: "Consolidate onto one platform" }, dataEnvironment: hero.env });
    check("replacing a goal without a reason is refused", noReason.status === "FAILED");
    const same = await dispatchSkill(db, "replace_pursuit_goal", operator, { pursuitId: hero.id, args: { objective: old.objective, reason: "restated" }, dataEnvironment: hero.env });
    check("restating the current objective is not a replacement", same.status === "FAILED");
    const newObjective = "Exit legacy virtualization and consolidate onto one platform before renewal";
    const rep = await dispatchSkill(db, "replace_pursuit_goal", operator, {
      pursuitId: hero.id, args: { objective: newObjective, targetDate: "2026-12-15", reason: "Customer widened the program at the QBR" }, dataEnvironment: hero.env,
    });
    check("a genuinely different objective replaces the goal (governed, human, with a reason)", rep.status === "EXECUTED", rep.reason ?? "");
    const res = rep.result as { goalId: string; replacedGoalId: string; supersededPlanId: string | null };
    const oldAfter = (await db.query(`select * from pursuit_goals where id = $1`, [old.id])).rows[0];
    check("the historical goal keeps its meaning byte for byte; only its status moved to SUPERSEDED",
      oldAfter.status === "SUPERSEDED" && oldAfter.objective === old.objective && JSON.stringify(oldAfter.basis) === JSON.stringify(old.basis)
        && oldAfter.origin === old.origin && String(oldAfter.target_date) === String(old.target_date) && oldAfter.supersedes_goal_id === null);
    const neu = (await db.query(`select * from pursuit_goals where id = $1`, [res.goalId])).rows[0];
    check("the new goal names the goal it replaces, and why — set by a person, active",
      neu.supersedes_goal_id === old.id && neu.supersession_reason === "Customer widened the program at the QBR" && neu.origin === "HUMAN_AUTHORED" && neu.status === "ACTIVE" && neu.objective === newObjective);
    check("the old goal's plan is superseded with every revision intact",
      res.supersededPlanId === r0.plan!.id && (await db.query(`select status from pursuit_plans where id = $1`, [r0.plan!.id])).rows[0].status === "SUPERSEDED"
        && await count(db, `select count(*)::text n from pursuit_plan_revisions where plan_id = $1`, [r0.plan!.id]) === revs0);
    check("GOAL_REPLACED is on the ledger", await count(db, `select count(*)::text n from change_ledger where pursuit_id = $1 and change_type = 'GOAL_REPLACED'`, [hero.id]) === 1);
    const v0 = await loadPursuitPlanView(db, caller, hero.id);
    check("the old plan is not shown as the new goal's plan", v0?.exists === false);
    const rr = await dispatchSkill(db, "recommend_pursuit_plan", operator, { pursuitId: hero.id, dataEnvironment: hero.env });
    const r2 = await loadPlanRecords(db, caller, hero.id);
    check("the next recommendation starts a NEW plan implementing the NEW goal", rr.status === "EXECUTED" && r2.goal?.id === res.goalId && r2.plan?.goalId === res.goalId && r2.plan.id !== r0.plan!.id && r2.revisions.length === 1);
    const v2 = await loadPursuitPlanView(db, caller, hero.id);
    check("the goal area shows the new commercial outcome, set by a person", v2?.goal?.objective === newObjective && v2.goal.provenanceLabel === "Set by a person");

    const attempt = async (sql: string, params: unknown[]) => {
      await db.query("savepoint probe");
      try { await db.query(sql, params); await db.query("release savepoint probe"); return "OK"; }
      catch (e) { await db.query("rollback to savepoint probe"); return (e as { code?: string }).code ?? "ERR"; }
    };
    check("a goal can be replaced only once — history cannot fork (23505)", await attempt(
      `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type, supersedes_goal_id, supersession_reason)
       values ($1,$2,'fork','SUPERSEDED','HUMAN_AUTHORED','USER',$3,'fork')`, [hero.org_id, hero.id, old.id]) === "23505");
    check("only a human-authored goal with a reason may supersede another (23514)", await attempt(
      `insert into pursuit_goals (org_id, pursuit_id, objective, status, origin, proposed_by_actor_type, supersedes_goal_id)
       values ($1,$2,'machine','SUPERSEDED','SYSTEM_RECOMMENDED','SYSTEM',$3)`, [hero.org_id, hero.id, res.goalId]) === "23514");
  });

  await scenario(hero.org_id, async (db) => {
    await db.query("set local role app_rw");
    const attempt = async (sql: string) => {
      await db.query("savepoint probe");
      try { await db.query(sql, [hero.id]); await db.query("release savepoint probe"); return "OK"; }
      catch (e) { await db.query("rollback to savepoint probe"); return (e as { code?: string }).code ?? "ERR"; }
    };
    check("as app_rw, a goal's objective cannot be rewritten (42501)", await attempt(`update pursuit_goals set objective = 'x' where pursuit_id = $1`) === "42501");
    check("as app_rw, a goal's supersession pointer cannot be rewritten (42501)", await attempt(`update pursuit_goals set supersedes_goal_id = null where pursuit_id = $1`) === "42501");
  });

  await scenario(otherOrg, async (db) => {
    const r = await dispatchSkill(db, "replace_pursuit_goal", { type: "USER", id: null, orgId: otherOrg, role: "operator" }, {
      pursuitId: hero.id, args: { objective: "hijacked objective", reason: "x" } });
    check("another org cannot replace this pursuit's goal", r.status === "REJECTED");
  });

  // =========================================================================
  console.log("\n8  Tenant isolation");
  // =========================================================================
  const otherCaller: Caller = await readOnly(otherOrg, (db) => callerFor(db, otherOrg));
  await readOnly(otherOrg, async (db) => {
    check("another org cannot load this pursuit's plan view", (await loadPursuitPlanView(db, otherCaller, hero.id)) === null);
    const r = await loadPlanRecords(db, otherCaller, hero.id);
    check("another org sees no goal, plan or revisions", r.goal === null && r.plan === null && r.revisions.length === 0);
  });
  await scenario(otherOrg, async (db) => {
    const res = await dispatchSkill(db, "decide_pursuit_plan", { type: "USER", id: null, orgId: otherOrg, role: "operator" }, {
      pursuitId: hero.id, args: { planId: "00000000-0000-0000-0000-000000000000", recommendationId: "00000000-0000-0000-0000-000000000000", decision: "APPROVED" },
    });
    check("another org's decision is REJECTED at the governed boundary", res.status === "REJECTED" && /not found in this org/.test(res.reason ?? ""));
    const rr = await dispatchSkill(db, "recommend_pursuit_plan", { type: "USER", id: null, orgId: otherOrg, role: "operator" }, { pursuitId: hero.id });
    check("another org cannot record a recommendation on it either", rr.status === "REJECTED");
  });
  await scenario(hero.org_id, async (db) => {
    await db.query("set local role app_rw");
    await db.query("select set_config('app.org_id', $1, true)", [otherOrg]);
    check("under RLS as app_rw, another org reads 0 revisions", await count(db, `select count(*)::text n from pursuit_plan_revisions where pursuit_id = $1`, [hero.id]) === 0);
  });
  await scenario(hero.org_id, async (db) => {
    await db.query("set local role app_rw");
    let code = "OK";
    try { await db.query(`update pursuit_plan_revisions set reason = 'x' where pursuit_id = $1`, [hero.id]); } catch (e) { code = (e as { code?: string }).code ?? "ERR"; }
    check("as app_rw, UPDATE of a revision is denied (42501)", code === "42501", code);
  });

  // =========================================================================
  console.log("\n9  Disclosure");
  // =========================================================================
  const guestView = await readOnly(hero.org_id, (db) => loadPursuitPlanView(db, guest, hero.id));
  const guestText = JSON.stringify(guestView);
  check("a caller without internal visibility sees no stakeholder names", !guestText.includes("Sarah Kim") && !guestText.includes("Mike Rivera"));
  check("…and no warm path", guestView?.nextAction?.via == null);
  check("…and is told only a count", (guestView?.withheldCount ?? 0) > 0);

  // =========================================================================
  console.log("\n10 No external send path, and nothing left behind");
  // =========================================================================
  const planSkills = COORDINATION_SKILLS.filter((s) => s.skillId === "recommend_pursuit_plan" || s.skillId === "decide_pursuit_plan");
  check("both plan skills are INTERNAL_WRITE", planSkills.length === 2 && planSkills.every((s) => s.effectClass === "INTERNAL_WRITE"));
  check("only a USER may decide", planSkills.find((s) => s.skillId === "decide_pursuit_plan")?.eligibleActors.join() === "USER");
  check("plan skills stay out of the registry the Federation panel lists (flag-OFF page unchanged)",
    !SKILL_REGISTRY.some((s) => s.skillId.includes("pursuit_plan")));
  const fedActions = await readOnly(hero.org_id, (db) => getGovernedActions(db, { type: "USER", orgId: hero.org_id, role: "operator" }, hero.id));
  check("…and the Federation panel's actions and history carry no plan skill",
    !fedActions.eligible.some((s) => s.skillId.includes("pursuit_plan")) && !fedActions.history.some((h) => h.skillId.includes("pursuit_plan")));
  await readOnly(hero.org_id, async (db) => {
    const now = {
      revisions: await count(db, `select count(*)::text n from pursuit_plan_revisions where pursuit_id = $1`, [hero.id]),
      ledger: await count(db, `select count(*)::text n from change_ledger where pursuit_id = $1`, [hero.id]),
      outbox: await count(db, `select count(*)::text n from action_outbox`),
      messages: await count(db, `select count(*)::text n from messages`),
      pursuitFacts: await count(db, `select count(*)::text n from pursuit_facts where pursuit_id = $1`, [hero.id]),
      motionActions: await count(db, `select count(*)::text n from motion_actions`),
    };
    check("no outbox row and no message exists", now.outbox === before.outbox && now.messages === before.messages && now.messages === 0);
    check("no pursuit_facts link was written (ranking never links)", now.pursuitFacts === before.pursuitFacts);
    check("world unchanged after the harness (all writes rolled back)", JSON.stringify(now) === JSON.stringify(before), JSON.stringify({ before, now }));
    check("the seeded recommendation wrote no ledger row — Slice 1 history is unchanged", before.ledger === 10, `ledger ${before.ledger}`);
  });

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) { for (const f of failures) console.log(`  - ${f}`); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[vnext-coordination-verify] fatal:", e); await pool.end().catch(() => {}); process.exit(1); });
