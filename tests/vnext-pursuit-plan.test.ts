import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ContextGap } from "../src/lib/pursuits/read-models/missing-context";
import {
  DEFAULT_ACTION_DUE_DAYS,
  PLAN_STATE_LABEL,
  applyAdjustments,
  assessPlanReview,
  composePursuitPlanView,
  draftGoal,
  evaluateMilestones,
  planMilestones,
  recommendPursuitPlan,
  resolveOwner,
  resolvePlanStanding,
  type PlanRecords,
  type PlanState,
  type RevisionRecord,
} from "../src/lib/pursuits/read-models/pursuit-plan";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";

/**
 * Pursuit Plan (vNext Slice 2A) — the pure half of Pursuit Coordination.
 *
 * What these pin: the goal is composed from canonical records; milestones are
 * computed, with their dependencies; the focus carries the upstream rank; the owner
 * is honest about being unassigned; account context never reads as pursuit-confirmed;
 * a recommendation and a decision stay distinct; new evidence makes an approved plan
 * REVIEWABLE without rewriting it; a person's adjustment is recorded field by field;
 * disclosure removes before rendering and only counts.
 *
 * Pure: no database, no clock of its own.
 */

const NOW = new Date("2026-09-14T12:00:00Z");
const INTERNAL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-1", canSeeInternal: false, canSeeTransactionDetail: false };

function gap(over: Partial<ContextGap> = {}): ContextGap {
  return {
    key: "stakeholder:economic_buyer", source: "STAKEHOLDER_COVERAGE", kind: "MISSING",
    text: "No economic buyer identified",
    whyItMatters: "Owns final economic approval — without verified buying authority the commercial close has no confirmed owner.",
    howToResolve: "Customer confirms budget/approval ownership.",
    refType: "stakeholder_role", refId: "economic_buyer", rank: 80, rankReasons: [],
    ...over,
  };
}

/** A Globex-shaped state, as the loaders would produce it from the canonical world. */
function globex(over: Partial<PlanState> = {}): PlanState {
  return {
    pursuitId: "p-globex",
    accountLabel: "Globex Manufacturing Inc.",
    pursuitStatus: "DETECTED",
    businessProblem: "Exit legacy virtualization before renewal",
    opportunity: { id: "o-1", name: "Legacy virtualization exit", stage: "proposal", amountUsd: 920000, expectedClose: "2026-10-24" },
    route: { decided: true, selectedLabel: "WWT", recommendedLabel: "CDW", overridden: true },
    motion: { id: "m-1", label: "Virtualization", status: "active", partnerLabel: "WWT", linkage: "OPPORTUNITY", openActions: 1 },
    stakeholders: {
      established: true, withheld: false,
      roles: [
        { role: "economic_buyer", state: "MISSING", personName: null },
        { role: "champion", state: "VERIFIED", personName: "Sarah Kim" },
        { role: "technical_buyer", state: "VERIFIED", personName: "Mike Rivera" },
      ],
    },
    qualification: { metrics: "strong", economic_buyer: "strong", decision_process: "unknown", paper_process: "unknown", champion: "weak" },
    valueState: "STRONG",
    timing: { anchored: false, accountEvent: { label: "Renewal", date: "2026-11-29", state: "VERIFIED_DATE", factId: "f-renewal" } },
    gaps: [
      gap(),
      gap({ key: "whynow:unknown:0", source: "WHY_NOW", text: "No verified timing anchor.", whyItMatters: null, howToResolve: null, refType: "pursuit", refId: "p-globex", rank: 72 }),
    ],
    team: [
      { id: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
      { id: "tm-sp", role: "VENDOR_SPECIALIST", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
    ],
    warmPaths: [
      { tier: "SELLER_ACCOUNT", text: "CDW seller CDW Rep holds a strong relationship at this account.", via: "CDW", refType: "seller_account_relationships", refId: "s-cdw" },
      { tier: "SELLER_ACCOUNT", text: "WWT seller WWT Rep holds a strong relationship at this account.", via: "WWT", refType: "seller_account_relationships", refId: "s-wwt" },
      { tier: "ACCOUNT_OVERLAP", text: "Acme has account overlap here, but no seller-level relationship is currently verified.", via: "Acme", refType: "partner_relationships", refId: "pr-1" },
    ],
    ...over,
  };
}

let seq = 0;
function revision(kind: RevisionRecord["kind"], rec: ReturnType<typeof recommendPursuitPlan>, over: Partial<RevisionRecord> = {}): RevisionRecord {
  seq++;
  return {
    id: `r-${seq}`, revisionNo: seq, kind, decision: kind === "DECISION" ? "APPROVED" : null,
    respondsToRevisionId: null, content: rec.content, basis: rec.basis, fingerprint: rec.basis.fingerprint,
    adjustments: null, reviewTrigger: null, reason: null, actorType: kind === "DECISION" ? "USER" : "SYSTEM",
    createdAt: new Date(NOW.getTime() + seq * 1000).toISOString(), ...over,
  };
}

function records(revisions: RevisionRecord[], goalStatus: "PROPOSED" | "ACTIVE" = "PROPOSED"): PlanRecords {
  return {
    goal: { id: "g-1", objective: "Exit legacy virtualization before renewal and close the $920K opportunity", targetDate: "2026-10-24", status: goalStatus, origin: "SYSTEM_RECOMMENDED", decidedAt: null, supersedesGoalId: null, createdAt: NOW.toISOString() },
    plan: { id: "plan-1", goalId: "g-1", status: goalStatus === "ACTIVE" ? "ACTIVE" : "PROPOSED", createdAt: NOW.toISOString() },
    revisions, stagedActions: {},
  };
}

// --- goal ---------------------------------------------------------------------

test("plan: Globex's goal is the commercial outcome — thesis and opportunity, no route choice (D-033)", () => {
  const g = draftGoal(globex());
  assert.equal(g.objective, "Exit legacy virtualization before renewal and close the $920K opportunity");
  assert.equal(g.targetDate, "2026-10-24", "target is the opportunity's canonical close date");
  assert.ok(!/WWT|CDW/.test(g.objective), "no partner or route in the objective");
  assert.deepEqual(g.basis.map((b) => b.refType), ["pursuit", "opportunity"], "no route in the goal's basis either");
});

test("plan: a route change WWT → CDW (or back) leaves the goal identical and changes only the plan", () => {
  const wwt = globex();
  const cdw = globex({ route: { decided: true, selectedLabel: "CDW", recommendedLabel: "CDW", overridden: false } });
  const undecided = globex({ route: { decided: false, selectedLabel: null, recommendedLabel: "CDW", overridden: false } });
  assert.deepEqual(draftGoal(cdw), draftGoal(wwt), "WWT → CDW: same goal");
  assert.deepEqual(draftGoal(undecided), draftGoal(wwt), "no decision yet: same goal");
  const planWwt = recommendPursuitPlan(wwt, NOW);
  const planCdw = recommendPursuitPlan(cdw, NOW);
  assert.notEqual(planWwt.basis.fingerprint, planCdw.basis.fingerprint, "the route is plan state, so the plan moves");
  assert.deepEqual(planWwt.goal, planCdw.goal, "…and the goal does not");
  const review = assessPlanReview(planWwt, planCdw);
  assert.equal(review.state, "REVIEW_NEEDED");
  assert.ok(review.reasons.includes("Route is now CDW."));
  assert.ok(!review.reasons.some((r) => /goal|objective/i.test(r)), "a route change never reads as a change of objective");
  assert.ok(/WWT/.test(JSON.stringify(planWwt.content)) && /CDW/.test(JSON.stringify(planCdw.content)), "the route lives in the plan revision");
});

test("plan: a motion change or an action adjustment never touches the goal", () => {
  const base = globex();
  const noMotion = globex({ motion: null });
  const abandoned = globex({ motion: { ...base.motion!, status: "completed" } });
  assert.deepEqual(draftGoal(noMotion), draftGoal(base));
  assert.deepEqual(draftGoal(abandoned), draftGoal(base));
  const rec = recommendPursuitPlan(base, NOW);
  const { content } = applyAdjustments(rec.content, { nextActionText: "Book time with the CFO office", ownerTeamMemberId: "tm-sp" }, base.team);
  assert.ok(!("goalObjective" in content) && !("goal" in content), "a plan revision carries no goal text to adjust");
  assert.deepEqual(draftGoal(base), rec.goal, "the goal is what it was before the adjustment");
});

test("plan: 0103 gives goals append-only replacement — a back-pointer on the new row, never a rewritable one", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0103_pursuit_coordination.sql", import.meta.url), "utf8");
  assert.match(sql, /supersedes_goal_id\s+uuid references pursuit_goals\(id\)/);
  assert.match(sql, /supersession_reason\s+text/);
  assert.ok(!/superseded_by/.test(sql), "no forward pointer that would have to be written onto the old row");
  assert.match(sql, /pursuit_goals_supersession_shape check/);
  assert.match(sql, /pursuit_goals_supersedes_once on pursuit_goals \(supersedes_goal_id\)/, "a goal is replaced at most once");
  const grant = sql.match(/grant update \(([^)]*)\) on pursuit_goals to app_rw/)?.[1] ?? "";
  for (const col of ["objective", "basis", "origin", "supersedes_goal_id", "supersession_reason", "target_date"]) {
    assert.ok(!grant.includes(col), `${col} must not be updatable`);
  }
  // Doubled quotes: the value is written inside the dynamic SQL string that rebuilds the CHECK.
  assert.match(sql, /''GOAL_REPLACED''::text/);
});

test("plan: without an opportunity the goal falls back to the thesis and has no invented date", () => {
  const g = draftGoal(globex({ opportunity: null }));
  assert.equal(g.objective, "Exit legacy virtualization before renewal");
  assert.equal(g.targetDate, null);
});

// --- milestones ---------------------------------------------------------------

test("plan: milestones are computed from canonical domains, with dependencies", () => {
  const s = globex();
  const ms = planMilestones(s);
  const st = evaluateMilestones(ms, s);
  assert.equal(st.route_decided, "DONE");
  assert.equal(st.champion_confirmed, "DONE");
  assert.equal(st.technical_buyer_confirmed, "DONE");
  assert.equal(st.economic_buyer_confirmed, "OPEN");
  assert.equal(st.decision_path_mapped, "BLOCKED", "waits on the economic buyer");
  assert.equal(st.timing_confirmed, "OPEN", "account timing is not pursuit timing");
  assert.equal(st.value_case_strong, "DONE");
  assert.equal(st.closed_won, "BLOCKED");
  assert.equal(ms.length, 8);
  assert.equal(Object.values(st).filter((x) => x === "DONE").length, 4);
});

test("plan: coverage milestones are NOT ESTABLISHED, not failed, when the map is withheld", () => {
  const s = globex({ stakeholders: { established: true, withheld: true, roles: [] } });
  const ms = planMilestones(s);
  assert.ok(!ms.some((m) => m.key === "economic_buyer_confirmed"), "not applicable — never shown as open work");
  assert.ok(ms.find((m) => m.key === "closed_won")!.dependsOn.every((d) => ms.some((m) => m.key === d)), "no dangling dependency");
});

// --- focus, owner, next action --------------------------------------------------

test("plan: focus is the top gap, carrying its upstream rank and source (D-019)", () => {
  const r = recommendPursuitPlan(globex(), NOW);
  assert.equal(r.content.focus?.gapKey, "stakeholder:economic_buyer");
  assert.equal(r.content.focus?.rank, 80);
  assert.equal(r.content.focus?.source, "STAKEHOLDER_COVERAGE");
  assert.equal(r.content.focus?.milestoneKey, "economic_buyer_confirmed");
  assert.match(r.content.nextAction!.text, /economic buyer at Globex/);
  assert.equal(r.content.nextAction!.doneWhen, "Customer confirms budget/approval ownership.", "carried, not rewritten");
  assert.equal(r.content.nextAction!.dueInDays, DEFAULT_ACTION_DUE_DAYS);
});

test("plan: the owner is honest — role proposed is not a person, and no role is unassigned", () => {
  const team = globex().team;
  const proposed = resolveOwner("VENDOR_ACCOUNT_EXECUTIVE", team);
  assert.equal(proposed.kind, "ROLE_UNFILLED");
  assert.equal(proposed.confirmed, false);
  assert.equal(resolveOwner("VENDOR_EXECUTIVE_SPONSOR", team).kind, "UNASSIGNED");
  const accepted = resolveOwner("VENDOR_ACCOUNT_EXECUTIVE", [{ id: "x", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "ACCEPTED", personLabel: "Jo Park", partnerLabel: null }]);
  assert.equal(accepted.kind, "PERSON");
  assert.equal(accepted.confirmed, true);
});

test("plan: the warm path follows the route a person chose, and overlap is never a path", () => {
  const r = recommendPursuitPlan(globex(), NOW);
  assert.match(r.content.nextAction!.via!.text, /^WWT seller/);
  const onlyOverlap = recommendPursuitPlan(globex({ warmPaths: [globex().warmPaths[2]] }), NOW);
  assert.equal(onlyOverlap.content.nextAction!.via, null);
});

// --- evidence lineage ---------------------------------------------------------------

test("plan: account timing is ACCOUNT context, dated, and never claims pursuit confirmation (D-020)", () => {
  const r = recommendPursuitPlan(globex(), NOW);
  const timing = r.content.why.find((w) => w.refId === "f-renewal");
  assert.ok(timing);
  assert.equal(timing.origin, "ACCOUNT");
  assert.match(timing.text, /Nov 29, 2026 — not yet confirmed for this pursuit/);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(timing.text), "no raw ISO date reaches a reader (U-20)");
  assert.ok(!/in \d+ days/.test(timing.text), "a persisted plan must not freeze a relative count");
  for (const w of r.content.why.filter((x) => x.origin === "ACCOUNT")) {
    assert.ok(!/confirmed for this pursuit\.$/.test(w.text) || /not yet confirmed/.test(w.text));
  }
});

test("plan: why follows the human route decision and preserves the recommendation", () => {
  const r = recommendPursuitPlan(globex(), NOW);
  assert.ok(r.content.why.some((w) => w.text === "Runs through WWT — the route a person chose over the CDW recommendation."));
  const refs = r.basis.evidence.map((e) => e.refType);
  for (const t of ["pursuit", "opportunity", "route", "stakeholder_role", "motion"]) assert.ok(refs.includes(t), `basis cites ${t}`);
});

// --- determinism + course correction ---------------------------------------------

test("plan: deterministic — same state, same fingerprint; the clock alone never makes a plan stale", () => {
  const a = recommendPursuitPlan(globex(), NOW);
  const b = recommendPursuitPlan(globex(), new Date("2026-10-01T00:00:00Z"));
  assert.equal(a.basis.fingerprint, b.basis.fingerprint);
  assert.deepEqual(a.content, b.content);
  assert.equal(assessPlanReview(a, b).state, "CURRENT");
});

test("plan: new evidence makes an approved plan REVIEW_NEEDED and says why", () => {
  const approved = recommendPursuitPlan(globex(), NOW);
  const s2 = globex({
    stakeholders: { established: true, withheld: false, roles: [
      { role: "economic_buyer", state: "VERIFIED", personName: "Dana Whitfield" },
      { role: "champion", state: "VERIFIED", personName: "Sarah Kim" },
      { role: "technical_buyer", state: "VERIFIED", personName: "Mike Rivera" },
    ] },
    gaps: [globex().gaps[1]],
  });
  const now = recommendPursuitPlan(s2, NOW);
  const review = assessPlanReview(approved, now);
  assert.equal(review.state, "REVIEW_NEEDED");
  assert.ok(review.reasons.includes("Economic buyer confirmed — reached since the plan was approved."));
  assert.ok(review.reasons.some((r) => /most important gap is now: No verified timing anchor/.test(r)));
  assert.equal(approved.content.nextAction!.text, recommendPursuitPlan(globex(), NOW).content.nextAction!.text, "the approved content is untouched");
});

test("plan: a route change or a motion change is a reason, not a silent rewrite", () => {
  const approved = recommendPursuitPlan(globex(), NOW);
  const moved = recommendPursuitPlan(globex({ motion: { ...globex().motion!, status: "completed" } }), NOW);
  const r = assessPlanReview(approved, moved);
  assert.equal(r.state, "REVIEW_NEEDED");
  assert.ok(r.reasons.includes("The motion is now completed."));
});

// --- recommendation vs decision ----------------------------------------------------

test("plan: recommendation ≠ decision — standing resolves pending vs in force, and a decline keeps the prior plan", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  assert.equal(resolvePlanStanding([r1]).pending?.id, r1.id);
  assert.equal(resolvePlanStanding([r1]).inForce, null);

  const d1 = revision("DECISION", rec, { respondsToRevisionId: r1.id });
  const s1 = resolvePlanStanding([r1, d1]);
  assert.equal(s1.inForce?.id, d1.id);
  assert.equal(s1.pending, null);

  const r2 = revision("RECOMMENDATION", rec);
  const d2 = revision("DECISION", rec, { respondsToRevisionId: r2.id, decision: "REJECTED", reason: "not yet" });
  const s2 = resolvePlanStanding([r1, d1, r2, d2]);
  assert.equal(s2.inForce?.id, d1.id, "declining an update leaves the approved plan in force");
  assert.equal(s2.pending, null);
});

test("plan: adjustments are a whitelist, keep the action's key, and record each change", () => {
  const rec = recommendPursuitPlan(globex(), NOW);
  const { content, changes } = applyAdjustments(rec.content, { ownerTeamMemberId: "tm-sp", dueInDays: 3 }, globex().team);
  assert.deepEqual(changes.map((c) => c.field).sort(), ["nextAction.dueInDays", "nextAction.owner"]);
  assert.equal(content.nextAction!.key, rec.content.nextAction!.key);
  assert.equal(content.nextAction!.owner.teamMemberId, "tm-sp");
  assert.equal(content.focus, rec.content.focus, "focus is not adjustable — that is a different plan");
  assert.equal(rec.content.nextAction!.dueInDays, DEFAULT_ACTION_DUE_DAYS, "the recommendation object is not mutated");
  assert.throws(() => applyAdjustments(rec.content, { ownerTeamMemberId: "not-on-team" }, globex().team), /not on this pursuit's team/);
  assert.throws(() => applyAdjustments(rec.content, {}, globex().team), /Nothing was changed/);
  const unassigned = applyAdjustments(rec.content, { ownerTeamMemberId: null }, globex().team);
  assert.equal(unassigned.content.nextAction!.owner.kind, "UNASSIGNED");
});

// --- view-model ----------------------------------------------------------------------

test("plan view: awaiting a decision, with every section populated from the recommendation", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const v = composePursuitPlanView({ pursuitId: "p-globex", caller: INTERNAL, state: globex(), records: records([revision("RECOMMENDATION", rec)]), live: rec, changesSinceDecision: [], now: NOW });
  assert.equal(v.status.state, "AWAITING_DECISION");
  assert.equal(v.status.label, PLAN_STATE_LABEL.AWAITING_DECISION);
  assert.equal(v.goal?.targetLabel, "Target Oct 24");
  assert.equal(v.goal?.provenanceLabel, "Proposed by PursuitOS — not yet confirmed");
  assert.equal(v.progress.label, "4 of 8 milestones done");
  assert.equal(v.nextAction?.ownerLabel, "Unassigned");
  assert.match(v.nextAction?.ownerNote ?? "", /Account executive role proposed — no one confirmed yet/);
  assert.equal(v.nextAction?.dueLabel, `Due within ${DEFAULT_ACTION_DUE_DAYS} days of approval`);
  assert.equal(v.motion.line, "Virtualization motion · via WWT · active");
  assert.match(v.motion.note ?? "", /Linked through this pursuit's opportunity · 1 open step already queued/);
  assert.equal(v.decision.recommendationId, "r-1");
  assert.equal(v.decision.stale, false);
  assert.equal(v.why.find((w) => /held on the account/.test(w.text))?.scopeLabel, "Account context");
});

test("plan view: REVIEW_NEEDED keeps the APPROVED content on screen and offers the update beside it", () => {
  seq = 0;
  const rec1 = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec1);
  const d1 = revision("DECISION", rec1, { respondsToRevisionId: r1.id });
  const s2 = globex({ gaps: [globex().gaps[1]], stakeholders: { established: true, withheld: false, roles: globex().stakeholders!.roles.map((r) => ({ ...r, state: "VERIFIED" as const })) } });
  const rec2 = recommendPursuitPlan(s2, NOW);
  const r2 = revision("RECOMMENDATION", rec2, { reviewTrigger: { fromRevisionId: d1.id, reasons: ["Economic buyer confirmed — reached since the plan was approved."], ledgerEventIds: ["l-1"] } });
  const v = composePursuitPlanView({ pursuitId: "p-globex", caller: INTERNAL, state: s2, records: records([r1, d1, r2], "ACTIVE"), live: rec2, changesSinceDecision: [{ id: "l-1", changeType: "STAKEHOLDER_ROLE_ASSERTED", reason: "economic buyer — verified", occurredAt: NOW.toISOString() }], now: NOW });
  assert.equal(v.status.state, "REVIEW_NEEDED");
  assert.equal(v.nextAction?.text, rec1.content.nextAction!.text, "the approved plan is what is shown");
  assert.equal(v.review.update?.revisionId, r2.id);
  assert.equal(v.review.update?.stale, false);
  assert.equal(v.progress.reachedSinceDecision, 1);
  assert.equal(v.review.changesSince[0].text, "economic buyer — verified");
  assert.equal(v.history.length, 3);
  assert.equal(v.history[0].label, "Updated recommendation from PursuitOS");
});

test("plan view: a pending recommendation that no longer matches the pursuit is marked stale", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const live = recommendPursuitPlan(globex({ pursuitStatus: "QUALIFIED" }), NOW);
  const v = composePursuitPlanView({ pursuitId: "p-globex", caller: INTERNAL, state: globex(), records: records([revision("RECOMMENDATION", rec)]), live, changesSinceDecision: [], now: NOW });
  assert.equal(v.decision.stale, true);
});

test("plan view: disclosure removes INTERNAL lines before rendering and discloses only a count (D-018)", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const v = composePursuitPlanView({ pursuitId: "p-globex", caller: GUEST, state: globex(), records: records([revision("RECOMMENDATION", rec)]), live: rec, changesSinceDecision: [], now: NOW });
  const text = JSON.stringify(v.why) + JSON.stringify(v.nextAction);
  assert.ok(!text.includes("Sarah Kim"));
  assert.ok(!text.includes("WWT seller"));
  assert.equal(v.nextAction?.via, null);
  assert.equal(v.withheldCount, rec.content.why.length + 1);
});

test("plan view: no architecture terminology reaches a reader (U-12)", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  const v = composePursuitPlanView({ pursuitId: "p-globex", caller: INTERNAL, state: globex(), records: records([r1, revision("DECISION", rec, { respondsToRevisionId: r1.id })], "ACTIVE"), live: rec, changesSinceDecision: [], now: NOW });
  const copy = JSON.stringify({ ...v, decision: undefined, pursuitId: undefined, planId: undefined, milestones: v.milestones.map((m) => ({ ...m, key: undefined })), history: v.history.map((h) => ({ ...h, id: undefined })) });
  for (const word of ["fingerprint", "revision", "recommender", "RECOMMENDATION", "STAKEHOLDER_COVERAGE", "gapKey", "Engine"]) {
    assert.ok(!copy.includes(word), `"${word}" must not reach the surface`);
  }
});

test("plan view: no plan yet renders an honest empty state", () => {
  const v = composePursuitPlanView({ pursuitId: "p", caller: INTERNAL, state: globex(), records: { goal: null, plan: null, revisions: [], stagedActions: {} }, live: null, changesSinceDecision: [], now: NOW });
  assert.equal(v.exists, false);
  assert.equal(v.status.state, "NONE");
});

// --- no external send path ------------------------------------------------------------

test("plan: the coordination write path cannot reach an external system", () => {
  const src = readFileSync(new URL("../src/lib/pursuits/coordination/plan-store.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["action_outbox", "comms/", "resend", "sendEmail", "fetch(", "externalSendingArmed", "drainOutbox", "insert into messages"]) {
    assert.ok(!code.includes(forbidden), `plan-store must not reference ${forbidden}`);
  }
  const skills = readFileSync(new URL("../src/lib/pursuits/federation/skills.ts", import.meta.url), "utf8");
  for (const id of ["recommend_pursuit_plan", "decide_pursuit_plan"]) {
    const line = skills.split("\n").find((l) => l.includes(`skillId: "${id}"`)) ?? "";
    assert.match(line, /effectClass: "INTERNAL_WRITE"/, `${id} is INTERNAL_WRITE`);
  }
  const decide = skills.slice(skills.indexOf('skillId: "decide_pursuit_plan"'));
  assert.match(decide.slice(0, 400), /eligibleActors: \["USER"\]/, "only a person decides");
});

test("plan: the surface is loaded only behind the coordination capability (flag OFF = no query)", () => {
  const page = readFileSync(new URL("../src/app/pursuits/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const pursuitPlan = vnext\.pursuitCoordination \? await loadPursuitPlanView\(db, caller, id\) : null;/);
  assert.equal((page.match(/loadPursuitPlanView\(/g) ?? []).length, 1, "one gated call site");
  assert.match(page, /const planSection = loaded\.pursuitPlan \? \(/, "no plan section without a loaded plan");
  assert.match(page, /\{planSection \? <>\{whyNowSection\}\{planSection\}<\/> : whyNowSection\}/,
    "flag OFF renders exactly the pre-slice child — no extra null in the serialized tree (U-16)");
});
