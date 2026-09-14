import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DAY_MS, dueBucket, startOfToday } from "../src/lib/motions/due-buckets";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import type { ContextGap } from "../src/lib/pursuits/read-models/missing-context";
import {
  ATTENTION_ORDER,
  ATTENTION_POLICY,
  attentionToDecisionItem,
  composeAttentionQueue,
  derivePursuitAttention,
  queueLineageFor,
  type PursuitAttention,
  type PursuitAttentionInput,
} from "../src/lib/pursuits/read-models/pursuit-attention";
import {
  composePursuitPlanView,
  frameApprovedPlan,
  recommendPursuitPlan,
  resolvePlanStanding,
  type PlanLedgerChange,
  type PlanRecommendation,
  type PlanRecords,
  type PlanState,
  type RevisionRecord,
} from "../src/lib/pursuits/read-models/pursuit-plan";
import type { DecisionItem } from "../src/lib/pursuits/read-models/types";

/**
 * Pursuit Attention (vNext Slice 2B) — the pure half of Today / Queue coordination.
 *
 * What these pin: the four Globex acceptance states (A awaiting approval · B approved, action
 * due · C approved plan needs review · D an update awaits a decision); the declared priority
 * order and its fit with Today's materiality policy; ONE card per pursuit, with every other
 * reason counted beneath it; disclosure before ranking and counting; tenant isolation of cards,
 * counts and hidden "other items"; deterministic keys and ordering; the Queue's plan lineage;
 * and the flag-OFF shape of every touched surface.
 *
 * Pure: no database, no clock of its own.
 */

const NOW = new Date(2026, 8, 14, 12, 0, 0);            // local noon — due buckets are local-day
const TODAY0 = startOfToday(NOW);
const at = (days: number, hour = 10) => new Date(TODAY0 + days * DAY_MS + hour * 3_600_000).toISOString();
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
const TIMING_GAP = gap({ key: "whynow:unknown:0", source: "WHY_NOW", text: "No verified timing anchor.", whyItMatters: null, howToResolve: null, refType: "pursuit", refId: "p-globex", rank: 72 });

function globex(over: Partial<PlanState> = {}): PlanState {
  return {
    pursuitId: "p-globex", accountLabel: "Globex Manufacturing Inc.", pursuitStatus: "DETECTED",
    businessProblem: "Exit legacy virtualization before renewal",
    opportunity: { id: "o-1", name: "Legacy virtualization exit", stage: "proposal", amountUsd: 920000, expectedClose: "2026-10-24" },
    route: { decided: true, selectedLabel: "WWT", recommendedLabel: "CDW", overridden: true },
    motion: { id: "m-1", label: "Virtualization", status: "active", partnerLabel: "WWT", linkage: "OPPORTUNITY", openActions: 1 },
    stakeholders: { established: true, withheld: false, roles: [
      { role: "economic_buyer", state: "MISSING", personName: null },
      { role: "champion", state: "VERIFIED", personName: "Sarah Kim" },
      { role: "technical_buyer", state: "VERIFIED", personName: "Mike Rivera" },
    ] },
    qualification: { metrics: "strong", economic_buyer: "strong", decision_process: "unknown", paper_process: "unknown", champion: "weak" },
    valueState: "STRONG",
    timing: { anchored: false, accountEvent: { label: "Renewal", date: "2026-11-29", state: "VERIFIED_DATE", factId: "f-renewal" } },
    gaps: [gap(), TIMING_GAP],
    team: [
      { id: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
      { id: "tm-sp", role: "VENDOR_SPECIALIST", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
    ],
    warmPaths: [{ tier: "SELLER_ACCOUNT", text: "WWT seller WWT Rep holds a strong relationship at this account.", via: "WWT", refType: "seller_account_relationships", refId: "s-wwt" }],
    ...over,
  };
}
/** After the economic buyer is verified: the Slice 2A acceptance's new evidence. */
const verifiedEb = (over: Partial<PlanState> = {}) => globex({
  stakeholders: { established: true, withheld: false, roles: globex().stakeholders!.roles.map((r) => ({ ...r, state: "VERIFIED" as const, personName: r.personName ?? "Dana Whitfield" })) },
  gaps: [TIMING_GAP],
  ...over,
});

let seq = 0;
function revision(kind: RevisionRecord["kind"], rec: PlanRecommendation, over: Partial<RevisionRecord> = {}): RevisionRecord {
  seq++;
  return {
    id: `r-${seq}`, revisionNo: seq, kind, decision: kind === "DECISION" ? "APPROVED" : null,
    respondsToRevisionId: null, content: rec.content, basis: rec.basis, fingerprint: rec.basis.fingerprint,
    adjustments: null, reviewTrigger: null, reason: null, actorType: kind === "DECISION" ? "USER" : "SYSTEM",
    createdAt: new Date(NOW.getTime() - (100 - seq) * 60_000).toISOString(), ...over,
  };
}
/** A decision that staged its next action as motion action `ma-1`. */
function decision(rec: PlanRecommendation, respondsTo: RevisionRecord, over: Partial<RevisionRecord> = {}): RevisionRecord {
  const content = { ...rec.content, nextAction: { ...rec.content.nextAction!, stagedMotionActionId: "ma-1" } };
  return revision("DECISION", { ...rec, content }, { respondsToRevisionId: respondsTo.id, ...over });
}

interface Scenario {
  revisions: RevisionRecord[];
  state: PlanState;
  live: PlanRecommendation;
  staged?: { dueAt: string; status: string } | null;
  changes?: PlanLedgerChange[];
  caller?: Caller;
  pursuitId?: string;
}
function input(s: Scenario): PursuitAttentionInput {
  const caller = s.caller ?? INTERNAL;
  const pursuitId = s.pursuitId ?? "p-globex";
  const active = s.revisions.some((r) => r.kind === "DECISION" && r.decision !== "REJECTED");
  const records: PlanRecords = {
    goal: { id: "g-1", objective: "Exit legacy virtualization before renewal and close the $920K opportunity", targetDate: "2026-10-24", status: active ? "ACTIVE" : "PROPOSED", origin: "SYSTEM_RECOMMENDED", decidedAt: null, supersedesGoalId: null, createdAt: NOW.toISOString() },
    plan: { id: "plan-1", goalId: "g-1", status: active ? "ACTIVE" : "PROPOSED", createdAt: NOW.toISOString() },
    revisions: s.revisions,
    stagedActions: s.staged ? { "ma-1": s.staged } : {},
  };
  const changes = s.changes ?? [];
  const view = composePursuitPlanView({ pursuitId, caller, state: s.state, records, live: s.live, changesSinceDecision: changes, now: NOW });
  const { inForce, pending } = resolvePlanStanding(s.revisions);
  return {
    pursuitId, companyId: `c-${pursuitId}`, accountLabel: "Globex Manufacturing Inc.", priorityScore: 72, synthetic: true,
    view, inForce, pending, liveFingerprint: s.live.basis.fingerprint, team: s.state.team,
    staged: s.staged ? { id: "ma-1", ...s.staged } : null,
    firstChangeAt: changes.at(-1)?.occurredAt ?? null,
  };
}
const derive = (s: Scenario) => derivePursuitAttention(input(s), s.caller ?? INTERNAL, NOW);

// The four Globex acceptance states, from canonical-shaped records ---------------------

function stateA() {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  return { revisions: [revision("RECOMMENDATION", rec)], state: globex(), live: rec } satisfies Scenario;
}
function stateB(stagedDue = at(3)) {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  return { revisions: [r1, decision(rec, r1)], state: globex(), live: rec, staged: { dueAt: stagedDue, status: "pending" } } satisfies Scenario;
}
const EB_CHANGE: PlanLedgerChange = { id: "l-eb", changeType: "STAKEHOLDER_ROLE_ASSERTED", reason: "economic buyer — verified", occurredAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() };
function stateC() {
  const b = stateB();
  return { ...b, state: verifiedEb(), live: recommendPursuitPlan(verifiedEb(), NOW), changes: [EB_CHANGE] } satisfies Scenario;
}
function stateD() {
  const c = stateC();
  const d1 = c.revisions[1];
  const r2 = revision("RECOMMENDATION", c.live, { reviewTrigger: { fromRevisionId: d1.id, reasons: ["Economic buyer confirmed — reached since the plan was approved."], ledgerEventIds: ["l-eb"] } });
  return { ...c, revisions: [...c.revisions, r2] } satisfies Scenario;
}

test("attention A: an undecided recommendation is PLAN_DECISION_REQUIRED, and the CTA opens the plan", () => {
  const a = derive(stateA())!;
  assert.equal(a.primary.kind, "PLAN_DECISION_REQUIRED");
  assert.equal(a.primary.headline, "Plan awaiting approval");
  assert.equal(a.primary.cta.label, "Review plan");
  assert.equal(a.primary.cta.href, "/pursuits/p-globex#plan");
  assert.equal(a.primary.decisionClass, "DECISION_REQUIRED");
  assert.match(a.primary.detail ?? "", /^PursuitOS recommends: Identify and verify the economic buyer at Globex/);
  assert.deepEqual(a.others, [], "nothing is executing yet — no execution reasons");
  assert.equal(a.owner?.label, "Unassigned", "the proposed owner is stated honestly");
  assert.equal(a.due, null);
});

test("attention B: approved plan, action due — the unowned action leads, the due date rides beneath, one card", () => {
  const a = derive(stateB())!;
  assert.equal(a.primary.kind, "OWNER_MISSING", "owner before due: a due action nobody holds will not happen on its date");
  assert.match(a.primary.detail ?? "", /Account executive role proposed — no one confirmed yet/);
  assert.equal(a.primary.cta.href, "/pursuits/p-globex#team");
  assert.deepEqual(a.others.map((r) => r.kind), ["ACTION_DUE"]);
  assert.match(a.others[0].detail ?? "", /Identify and verify the economic buyer .* — due Sep 17\.$/);
  assert.equal(a.due?.bucket, "THIS_WEEK");
  assert.equal(a.owner, null, "the owner line would only repeat the primary");
  const item = attentionToDecisionItem(a);
  assert.equal(item.others?.length, 1, "OWNER_MISSING does not create a second card — ACTION_DUE is folded");
});

test("attention B': with a confirmed owner, ACTION_DUE is the primary — no higher plan decision exists", () => {
  seq = 0;
  const team = [{ id: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "ACCEPTED", personLabel: "Jo Park", partnerLabel: null }];
  const s = globex({ team });
  const rec = recommendPursuitPlan(s, NOW);
  const r1 = revision("RECOMMENDATION", rec);
  const soon = derive({ revisions: [r1, decision(rec, r1)], state: s, live: rec, staged: { dueAt: at(3), status: "pending" } })!;
  assert.equal(soon.primary.kind, "ACTION_DUE");
  assert.equal(soon.primary.urgency, "normal");
  assert.equal(soon.primary.cta.label, "Open the work");
  assert.equal(soon.primary.cta.href, "/briefs/m-1", "the same destination the Queue's own 'Open the work' uses");
  assert.equal(soon.owner?.label, "Jo Park · Account executive");
  assert.equal(soon.due?.label, "Due Sep 17");
  const today = derive({ revisions: [r1, decision(rec, r1)], state: s, live: rec, staged: { dueAt: at(0, 16), status: "pending" } })!;
  assert.equal(today.primary.kind, "ACTION_DUE");
  assert.equal(today.primary.urgency, "high", "due today is operationally more urgent than due this week");
  assert.equal(today.due?.label, "Due today");
  const later = derive({ revisions: [r1, decision(rec, r1)], state: s, live: rec, staged: { dueAt: at(12), status: "pending" } });
  assert.equal(later, null, "beyond the Queue's seven-day window nothing needs attention — it is just work");
  const done = derive({ revisions: [r1, decision(rec, r1)], state: s, live: rec, staged: { dueAt: at(-2), status: "done" } });
  assert.equal(done, null, "handled work never raises attention");
});

test("attention: ACTION_OVERDUE outranks ordinary ACTION_DUE — within the order and across pursuits", () => {
  assert.ok(ATTENTION_ORDER.indexOf("ACTION_OVERDUE") < ATTENTION_ORDER.indexOf("ACTION_DUE"));
  const overdue = derive({ ...stateB(at(-2)), pursuitId: "p-late" })!;
  assert.equal(overdue.primary.kind, "ACTION_OVERDUE", "overdue before owner");
  assert.match(overdue.primary.detail ?? "", /was due Sep 12/);
  assert.equal(overdue.due?.label, "Overdue since Sep 12");
  assert.deepEqual(overdue.others.map((r) => r.kind), ["OWNER_MISSING"], "a late action is never also 'due'");
  const due = derive({ ...stateB(at(3)), pursuitId: "p-due" })!;
  const q = composeAttentionQueue({ items: [], attention: [due, overdue], tenantPursuitIds: new Set(["p-late", "p-due"]), now: NOW });
  assert.deepEqual(q.items.map((i) => i.pursuitId), ["p-late", "p-due"]);
});

test("attention C: the approved plan needs review — review outranks the old queued action, which stays in force", () => {
  const a = derive(stateC())!;
  assert.equal(a.primary.kind, "PLAN_REVIEW_REQUIRED");
  assert.equal(a.primary.headline, "Plan needs review");
  assert.equal(a.primary.cta.label, "Review plan");
  assert.equal(a.primary.cta.href, "/pursuits/p-globex#plan");
  assert.equal(a.primary.urgency, "critical", "a stale plan with queued work someone could execute is the acting-blindly case");
  assert.equal(a.primary.detail, "Economic buyer confirmed — reached since the plan was approved. The approved plan stays in force until a person decides.");
  assert.deepEqual(a.others.map((r) => r.kind), ["OWNER_MISSING", "ACTION_DUE"], "the old action is context, never the headline");
  assert.match(a.others.find((r) => r.kind === "ACTION_DUE")!.detail ?? "", /Still queued from the approved plan, which now needs review/);
  assert.equal(a.due, null, "no due date on a review card — it would point the reader at the stale step");
  const progress = a.reasons.find((r) => r.kind === "MILESTONE_ADVANCED");
  assert.equal(progress?.subsumedBy, "PLAN_REVIEW_REQUIRED", "progress is WHY the review exists — derived, not repeated");
  assert.ok(!a.others.some((r) => r.kind === "MILESTONE_ADVANCED"));
  assert.equal(a.primary.at, EB_CHANGE.occurredAt, "the review is dated by the change that caused it, not by the clock");
});

test("attention D: an updated recommendation awaiting a decision is still ONE plan-review card, not a second one", () => {
  const a = derive(stateD())!;
  assert.equal(a.primary.kind, "PLAN_REVIEW_REQUIRED");
  assert.match(a.primary.detail ?? "", /An updated recommendation is waiting for your decision\.$/);
  const decisionReason = a.reasons.find((r) => r.kind === "PLAN_DECISION_REQUIRED");
  assert.ok(decisionReason, "the pending decision is derived…");
  assert.equal(decisionReason.subsumedBy, "PLAN_REVIEW_REQUIRED", "…and carried by the review card");
  assert.ok(!a.others.some((r) => r.kind === "PLAN_DECISION_REQUIRED"), "never a duplicate");
  const q = composeAttentionQueue({ items: [], attention: [a], tenantPursuitIds: new Set(["p-globex"]), now: NOW });
  assert.equal(q.items.filter((i) => i.pursuitId === "p-globex").length, 1);
});

test("attention: PLAN_REVIEW_REQUIRED outranks ACTION_DUE for the same pursuit, and every plan reason outranks execution", () => {
  assert.deepEqual([...ATTENTION_ORDER], ["PLAN_REVIEW_REQUIRED", "PLAN_DECISION_REQUIRED", "ACTION_OVERDUE", "ACTION_BLOCKED", "OWNER_MISSING", "ACTION_DUE", "MILESTONE_ADVANCED"]);
  const RANK = { DECISION_REQUIRED: 0, RISK: 1, ACTION_REQUIRED: 2, MATERIAL_CHANGE: 3, OPPORTUNITY: 4, FYI: 5 } as const;
  for (let i = 1; i < ATTENTION_ORDER.length; i++) {
    const prev = RANK[ATTENTION_POLICY[ATTENTION_ORDER[i - 1]].decisionClass];
    const cur = RANK[ATTENTION_POLICY[ATTENTION_ORDER[i]].decisionClass];
    assert.ok(prev <= cur, `${ATTENTION_ORDER[i - 1]} → ${ATTENTION_ORDER[i]}: the declared order never contradicts Today's class ranking`);
  }
});

test("attention: an approved action with no active motion to carry it is BLOCKED — a real dependency, not a guess", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  const d1 = revision("DECISION", rec, { respondsToRevisionId: r1.id });   // nothing staged
  const a = derive({ revisions: [r1, d1], state: globex(), live: rec })!;
  assert.equal(a.primary.kind, "ACTION_BLOCKED");
  assert.equal(a.primary.detail, "Not queued — no active motion to carry it.", "the same words the plan surface uses");
  assert.deepEqual(a.others.map((r) => r.kind), ["OWNER_MISSING"], "blocked before owner");
});

test("attention: a declined recommendation or no plan at all raises nothing", () => {
  seq = 0;
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  assert.equal(derive({ revisions: [r1, revision("DECISION", rec, { respondsToRevisionId: r1.id, decision: "REJECTED", reason: "not yet" })], state: globex(), live: rec }), null);
  const none = input(stateA());
  assert.equal(derivePursuitAttention({ ...none, view: { ...none.view, exists: false } }, INTERNAL, NOW), null);
});

// Today composition ------------------------------------------------------------

function existing(over: Partial<DecisionItem>): DecisionItem {
  return {
    id: `${over.type}:${over.pursuitId}`, type: "STAKEHOLDER_GAP", decisionClass: "ACTION_REQUIRED", operationalUrgency: "high",
    commercialPriority: "high", pursuitId: null, companyId: null, accountLabel: "Account", title: "t", reason: "r",
    allowedActions: [{ label: "Open", skill: "explain_partner_route", sideEffect: "READ" }], deepLink: "/x", synthetic: true,
    at: new Date(NOW.getTime() - 3_600_000).toISOString(), ...over,
  };
}
const GLOBEX_EXISTING = [
  existing({ type: "STAKEHOLDER_GAP", pursuitId: "p-globex", accountLabel: "Globex Manufacturing Inc.", title: "$1.25M pursuit lacks a verified economic buyer", deepLink: "/pursuits/p-globex#stakeholders" }),
  existing({ type: "ROUTE_RECOMMENDATION_CHANGED", decisionClass: "DECISION_REQUIRED", operationalUrgency: "normal", pursuitId: "p-globex", accountLabel: "Globex Manufacturing Inc.", title: "Recommended route changed", deepLink: "/pursuits/p-globex" }),
  existing({ type: "LIFECYCLE_WINDOW", decisionClass: "OPPORTUNITY", operationalUrgency: "normal", pursuitId: "p-globex", accountLabel: "Globex Manufacturing Inc.", title: "$1.25M Pursuit enters a renewal window in 76 days", deepLink: "/pursuits/p-globex#whynow" }),
];
const STARK = [
  existing({ type: "ROUTE_APPROVAL", decisionClass: "DECISION_REQUIRED", operationalUrgency: "high", pursuitId: "p-stark", accountLabel: "Stark Industries LLC", title: "Approve route via WWT", at: new Date(NOW.getTime() - 86_400_000).toISOString() }),
  existing({ type: "VALUE_GAP", operationalUrgency: "normal", commercialPriority: "very_high", pursuitId: "p-stark", accountLabel: "Stark Industries LLC", title: "$1.45M Pursuit has no defensible economic baseline" }),
  existing({ type: "LIFECYCLE_CONFLICT", decisionClass: "RISK", pursuitId: "p-stark", accountLabel: "Stark Industries LLC", title: "Contract expiry timing is conflicting across sources" }),
];
const FACT_REVIEW = existing({ type: "FACT_REVIEW", decisionClass: "DECISION_REQUIRED", operationalUrgency: "normal", commercialPriority: "moderate", title: "Review a proposed fact" });
const TENANT = new Set(["p-globex", "p-stark"]);

test("today: one card per pursuit — the plan's attention leads where a person coordinates it; the rest fold beneath", () => {
  const a = derive(stateC())!;
  const q = composeAttentionQueue({ items: [...GLOBEX_EXISTING, ...STARK, FACT_REVIEW], attention: [a], tenantPursuitIds: TENANT, now: NOW });
  assert.equal(q.total, 3, "Globex, Stark, and the fact review that belongs to no pursuit");
  const g = q.items.find((i) => i.pursuitId === "p-globex")!;
  assert.equal(g.type, "PLAN_REVIEW_REQUIRED");
  assert.equal(g.others?.length, 2 + GLOBEX_EXISTING.length, "attention reasons first, then the pursuit's folded Today items");
  assert.deepEqual(g.others!.slice(2).map((o) => o.title), ["Recommended route changed", "$1.25M pursuit lacks a verified economic buyer", "$1.25M Pursuit enters a renewal window in 76 days"],
    "folded items keep Today's materiality order: decision before action before opportunity");
  const s = q.items.find((i) => i.pursuitId === "p-stark")!;
  assert.equal(s.type, "ROUTE_APPROVAL", "a pursuit with no plan keeps its most material item (the existing policy)");
  assert.equal(s.others?.length, 2);
  assert.equal(q.items[0].pursuitId, "p-globex", "a critical plan review outranks a high route approval — the class is the same, urgency decides");
  assert.equal(q.items.find((i) => i.type === "FACT_REVIEW")?.others, undefined, "items with no pursuit are left exactly as they are");
});

test("today: a pursuit with a single item and no plan renders exactly the certified card", () => {
  const one = existing({ type: "TEAM_WAITING", pursuitId: "p-stark", title: "Waiting on CDW to accept" });
  const q = composeAttentionQueue({ items: [one], attention: [], tenantPursuitIds: TENANT, now: NOW });
  assert.deepEqual(q.items, [one], "same object shape: no attention, no others");
});

test("today: a plan awaiting approval ranks with route approvals — honest materiality, no special pleading", () => {
  const a = derive(stateA())!;
  const q = composeAttentionQueue({ items: STARK, attention: [a], tenantPursuitIds: TENANT, now: NOW });
  assert.equal(q.items[0].pursuitId, "p-stark", "both HIGH decisions; the older route approval breaks the tie");
  assert.equal(q.items[1].type, "PLAN_DECISION_REQUIRED");
});

test("today: tenant isolation — another org's items change no card, count, rank, badge or hidden 'other items' number", () => {
  const a = derive(stateC())!;
  const base = composeAttentionQueue({ items: [...GLOBEX_EXISTING, ...STARK], attention: [a], tenantPursuitIds: TENANT, now: NOW });
  const foreign = [
    existing({ type: "ROUTE_APPROVAL", decisionClass: "DECISION_REQUIRED", operationalUrgency: "critical", commercialPriority: "very_high", pursuitId: "p-foreign", accountLabel: "Foreign Co", title: "Approve route via CDW", synthetic: false }),
    existing({ type: "STAKEHOLDER_GAP", pursuitId: "p-foreign", accountLabel: "Foreign Co" }),
  ];
  const foreignAttention = { ...derive({ ...stateD(), pursuitId: "p-foreign" })!, pursuitId: "p-foreign" } as PursuitAttention;
  const leaked = composeAttentionQueue({ items: [...foreign, ...GLOBEX_EXISTING, ...STARK], attention: [foreignAttention, a], tenantPursuitIds: TENANT, now: NOW });
  assert.deepEqual(leaked, base, "identical — the other org's pursuit never reaches grouping, ranking or counting");
});

test("today: ranking is deterministic — arrival order and repeated derivation change nothing", () => {
  const a = derive(stateC())!;
  const items = [...GLOBEX_EXISTING, ...STARK, FACT_REVIEW];
  const q1 = composeAttentionQueue({ items, attention: [a], tenantPursuitIds: TENANT, now: NOW });
  const q2 = composeAttentionQueue({ items: [...items].reverse(), attention: [derive(stateC())!], tenantPursuitIds: TENANT, now: NOW });
  assert.deepEqual(q2, q1);
  assert.equal(derive(stateC())!.key, a.key, "the same canonical state yields the same key");
  assert.ok(!/T\d\d:\d\d/.test(a.key), "no clock in the key");
  assert.match(a.key, /^attention:p-globex:PLAN_REVIEW_REQUIRED:r-2:[0-9a-f]{16}$/, "grounded in the revision in force and the live fingerprint");
  const later = derivePursuitAttention(input(stateC()), INTERNAL, new Date(NOW.getTime() + 60_000));
  assert.equal(later!.key, a.key, "time passing alone does not make a new attention");
});

test("today: the top-N cut happens after collapsing, and the total counts cards", () => {
  const a = derive(stateC())!;
  const q = composeAttentionQueue({ items: [...GLOBEX_EXISTING, ...STARK, FACT_REVIEW], attention: [a], tenantPursuitIds: TENANT, now: NOW, limit: 2 });
  assert.equal(q.items.length, 2);
  assert.equal(q.total, 3);
  assert.equal(q.all.length, 3);
});

// Disclosure --------------------------------------------------------------------

test("disclosure: a partner-safe caller gets declared wording only — no names, warm paths, plan text or reasoning", () => {
  seq = 0;
  const guestState = (s: PlanState): PlanState => ({ ...s, stakeholders: { established: true, withheld: true, roles: [] }, warmPaths: [] });
  const rec = recommendPursuitPlan(globex(), NOW);
  const r1 = revision("RECOMMENDATION", rec);
  // A person reworded the action with a name in it, and assigned a named owner.
  const team = [{ id: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "INVITED", personLabel: "Jo Park", partnerLabel: null }];
  const adjusted = { ...rec, content: { ...rec.content, nextAction: { ...rec.content.nextAction!, text: "Call Dana Whitfield about budget", owner: { kind: "PERSON" as const, teamMemberId: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", roleLabel: "Account executive", personLabel: "Jo Park", confirmed: false } } } };
  const d1 = decision(adjusted, r1, { decision: "ADJUSTED" });
  const scenarios: Scenario[] = [
    { revisions: [r1], state: guestState(globex({ team })), live: rec, caller: GUEST },
    { revisions: [r1, d1], state: guestState(globex({ team })), live: recommendPursuitPlan(guestState(verifiedEb({ team })), NOW), staged: { dueAt: at(-1), status: "pending" }, changes: [EB_CHANGE], caller: GUEST },
  ];
  for (const s of scenarios) {
    const a = derive(s)!;
    assert.ok(a, "the guest still learns that the pursuit needs attention");
    const text = JSON.stringify({ primary: a.primary, others: a.others, reasons: a.reasons, owner: a.owner, due: a.due, item: attentionToDecisionItem(a) });
    for (const secret of ["Sarah Kim", "Mike Rivera", "Dana Whitfield", "Jo Park", "WWT seller", "Identify and verify", "economic buyer", "Account executive role", "CDW recommendation"]) {
      assert.ok(!text.includes(secret), `"${secret}" must not reach a partner-safe caller`);
    }
  }
  const guestReview = derive(scenarios[1])!;
  assert.equal(guestReview.primary.detail, "The pursuit has changed since the plan was approved. The approved plan stays in force until a person decides.");
  assert.equal(guestReview.others.find((r) => r.kind === "OWNER_MISSING")?.detail, "No confirmed owner on the pursuit team yet.");
});

test("disclosure: a withheld line changes no visible reason, order or count (D-018)", () => {
  const withWhy = input(stateC());
  const moreHidden = { ...withWhy, view: { ...withWhy.view, withheldCount: withWhy.view.withheldCount + 3 } };
  assert.deepEqual(derivePursuitAttention(moreHidden, INTERNAL, NOW), derivePursuitAttention(withWhy, INTERNAL, NOW));
});

test("copy: no architecture terminology in anything a reader sees (U-12)", () => {
  for (const s of [stateA(), stateB(), stateC(), stateD()]) {
    const a = derive(s)!;
    const copy = JSON.stringify([...a.reasons.map((r) => [r.headline, r.detail, r.cta.label]), a.owner, a.due]);
    for (const word of ["fingerprint", "revision", "recommender", "PLAN_REVIEW_REQUIRED", "OWNER_MISSING", "STAKEHOLDER_COVERAGE", "Engine", "attention"]) {
      assert.ok(!copy.includes(word), `"${word}" must not reach the surface`);
    }
  }
});

// Queue lineage -------------------------------------------------------------------

test("queue: an action keeps its lineage — current, needs review, or queued by an earlier approval", () => {
  const base = { motionActionId: "ma-1", pursuitId: "p-globex", planId: "plan-1", decisionRevision: { id: "r-2", decision: "APPROVED" as const, actorType: "USER", createdAt: at(-1) }, livePlanId: "plan-1", now: NOW };
  const current = queueLineageFor({ ...base, inForceRevisionId: "r-2", planState: "APPROVED" });
  assert.equal(current.state, "CURRENT");
  assert.equal(current.label, "From the approved plan");
  assert.equal(current.href, "/pursuits/p-globex#plan");
  assert.equal(current.provenance, "Approved by a person on Sep 13");
  assert.ok(current.approvedByPerson && current.inForce);
  const review = queueLineageFor({ ...base, inForceRevisionId: "r-2", planState: "REVIEW_NEEDED" });
  assert.equal(review.state, "REVIEW_NEEDED");
  assert.equal(review.label, "Plan needs review");
  assert.equal(review.linkLabel, "Review plan");
  assert.ok(review.inForce, "still the plan in force — the Queue keeps the action");
  const earlier = queueLineageFor({ ...base, inForceRevisionId: "r-4", planState: "APPROVED" });
  assert.equal(earlier.state, "EARLIER_PLAN");
  assert.match(earlier.provenance, /a later decision replaced this plan$/);
  const replacedGoal = queueLineageFor({ ...base, livePlanId: "plan-2", inForceRevisionId: "r-2", planState: "APPROVED" });
  assert.equal(replacedGoal.state, "EARLIER_PLAN", "a superseded plan's action is never presented as the current plan's");
});

test("queue: plan review never touches the queued action — the in-force action and its staged id are unchanged", () => {
  const c = stateC();
  const b = stateB();
  assert.equal(c.revisions[1].content.nextAction?.stagedMotionActionId, "ma-1");
  assert.deepEqual(c.revisions[1].content, b.revisions[1].content, "the approved plan is byte-identical after the evidence");
  const a = derive(c)!;
  assert.ok(a.reasons.some((r) => r.kind === "ACTION_DUE" && r.ref.refId === "ma-1"), "the same one action, still due");
});

test("due buckets: one definition — the Queue's local-day boundaries", () => {
  assert.equal(dueBucket(new Date(TODAY0 - 1), TODAY0), "OVERDUE");
  assert.equal(dueBucket(new Date(TODAY0), TODAY0), "TODAY");
  assert.equal(dueBucket(new Date(TODAY0 + DAY_MS), TODAY0), "THIS_WEEK");
  assert.equal(dueBucket(new Date(TODAY0 + 7 * DAY_MS), TODAY0), "LATER");
  assert.equal(dueBucket(null, TODAY0), "NO_DATE");
  const queue = readFileSync(new URL("../src/app/queue/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /QUEUE_BUCKET_LABEL\[dueBucket\(i\.dueAt, today0\)\]/, "the Queue groups by the shared buckets");
  assert.ok(!/function startOfToday/.test(queue), "no second definition of 'today' in the Queue");
});

// Pursuit Detail labelling ----------------------------------------------------------

test("detail: once the approved plan needs review it is framed as the CURRENT APPROVED PLAN — content untouched", () => {
  const c = input(stateC());
  const framed = frameApprovedPlan(c.view);
  assert.deepEqual(framed.approvedPlanFrame, { label: "Current approved plan", note: `Approved ${c.view.status.atLabel} — recorded before the changes above`, focusLabel: "Focus when approved" });
  const { approvedPlanFrame, ...rest } = framed;
  void approvedPlanFrame;
  assert.deepEqual(rest, c.view, "labelling only — not one field of the plan changes");
  assert.equal(frameApprovedPlan(input(stateB()).view).approvedPlanFrame, null, "a current plan is not framed");
  assert.equal("approvedPlanFrame" in c.view, false, "the Slice 2A composer never sets it — flag OFF payload unchanged");
});

// Reads never write, and flag OFF is the certified product ----------------------------

test("reads never write: the attention model and its loaders contain no write path", () => {
  for (const f of ["../src/lib/pursuits/read-models/pursuit-attention.ts", "../src/lib/pursuits/read-models/attention-loaders.ts"]) {
    const code = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [/\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i, /dispatchSkill/, /recordChange/, /recordOverride/, /plan-store/, /action_outbox/, /fetch\(/]) {
      assert.ok(!forbidden.test(code), `${f} must not contain ${forbidden}`);
    }
  }
});

test("flag OFF: Today, Queue and Pursuit Detail run exactly the certified path", () => {
  const today = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(today, /const attention = vnextEnvEnabled\("pursuit_attention"\) && vnextCapabilities\(await tenantFeatures\(db, orgId\)\)\.pursuitAttention;/);
  assert.match(today, /: await getTodayQueue\(db, caller, \{ companyIds: scopeIds, limit \}\),/, "the certified queue call, unchanged, when the capability is off");
  assert.equal((today.match(/composeTodayAttention\(/g) ?? []).length, 1, "one gated call site");
  assert.match(today, /title=\{attentionOn \? "Needs your attention" : "Decisions that move revenue"\}/);

  const queue = readFileSync(new URL("../src/app/queue/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /vnextEnvEnabled\("pursuit_attention"\) && vnextCapabilities\(await tenantFeatures\(db, orgId\)\)\.pursuitAttention\s*\?\s*await loadQueuePlanLineage/);
  assert.match(queue, /\.\.\.\(lineage\?\.\[a\.id as string\] \? \{ lineage: lineage\[a\.id as string\] \} : \{\}\)/, "no lineage property on a flag-OFF row");

  const detail = readFileSync(new URL("../src/app/pursuits/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /pursuitPlan: pursuitPlan && vnext\.pursuitAttention \? frameApprovedPlan\(pursuitPlan\) : pursuitPlan,/);

  const card = readFileSync(new URL("../src/components/pursuit/today.tsx", import.meta.url), "utf8");
  assert.match(card, /\) : why\}/, "a card with no folded items renders the certified disclosure alone");
});
