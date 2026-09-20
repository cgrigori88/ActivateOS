import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computeContextHealth, type ContextFactInput, type ContextHealthConcern } from "../src/lib/pursuits/read-models/context-health";
import { composeMissingContext } from "../src/lib/pursuits/read-models/missing-context";
import {
  actionStanding,
  applyAdjustments,
  assessPlanReview,
  deriveOrderedActions,
  evaluateMilestones,
  fingerprintInputs,
  fingerprintOf,
  freshBasisFor,
  legacyStagedActionId,
  MAX_PLAN_ACTIONS_V2,
  normalizePlanContent,
  planMilestones,
  recommendPursuitPlan,
  resolveOwner,
  selectCurrentPlanAction,
  selectDisplayPlanAction,
  UnknownPlanContentSchema,
  type PlanActionV2,
  type PlanContentV1,
  type PlanState,
} from "../src/lib/pursuits/read-models/pursuit-plan";
import { globexPlanState } from "./fixtures/plan-state";

/**
 * P3 SLICE 2C-A — ORDERED PLAN ACTIONS.
 *
 * > **A durable plan revision expresses an ordered set of intended actions. P3 owns what should
 * > happen; P5 owns what is happening.**
 *
 * The database half of acceptance (staging, lineage, deletion semantics, ledger bounds) lives in
 * `scripts/p3-2c-verify.ts`, because it is about what PostgreSQL enforces. Everything here is about
 * meaning, and every security or integrity claim carries a control that fails when the claim does.
 */

const NOW = new Date("2026-02-10T09:00:00Z");
const state = (over: Partial<PlanState> = {}): PlanState => globexPlanState(over);

// ── 1 · THE VERSIONED BOUNDARY ──────────────────────────────────────────────────────────────────

const V1: PlanContentV1 = {
  schema: 1,
  focus: { gapKey: "stakeholder:economic_buyer", source: "STAKEHOLDER_COVERAGE", kind: "MISSING", headline: "No economic buyer identified", rank: 90, refType: "stakeholder_role", refId: "economic_buyer", milestoneKey: "economic_buyer_confirmed" },
  motion: { motionId: "m-1", linkage: "PURSUIT", label: "Globex renewal", status: "active", partnerLabel: null, openActions: 2 },
  nextAction: {
    key: "verify_role:economic_buyer", text: "Identify and verify the economic buyer at Globex",
    doneWhen: "Customer confirms budget ownership.", via: null,
    owner: { kind: "PERSON", teamMemberId: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", roleLabel: "Account executive", personLabel: "Dana", confirmed: true },
    dueInDays: 5, stagedMotionActionId: "ma-legacy",
  },
  milestones: [{ key: "economic_buyer_confirmed", label: "Economic buyer confirmed", rule: { kind: "ROLE_VERIFIED", role: "economic_buyer" }, dependsOn: [] }],
  why: [],
};

test("2C-A: a stored v1 revision normalizes into the v2 view without being rewritten", () => {
  const frozen = JSON.stringify(V1);
  const n = normalizePlanContent(V1);
  assert.equal(n.schema, 2);
  assert.equal(n.actions.length, 1);
  assert.equal(n.actions[0].key, V1.nextAction!.key);
  assert.equal(n.actions[0].text, V1.nextAction!.text);
  assert.equal(n.actions[0].dueInDays, V1.nextAction!.dueInDays);
  // NOTHING IS INVENTED. v1 never recorded which milestone its action advanced, so the normalized
  // action does not claim one — a link the revision never made must not appear because a later
  // schema has somewhere to put it.
  assert.equal(n.actions[0].milestoneKey, null);
  assert.equal(JSON.stringify(V1), frozen, "the stored row is untouched");
  // The staging pointer stays readable exactly where v1 put it, and only for v1.
  assert.equal(legacyStagedActionId(V1), "ma-legacy");
  assert.equal(legacyStagedActionId({ ...V1, schema: 2 }), null);
});

test("2C-A: a v1 revision with no action normalizes to an empty ordered set, not to null", () => {
  assert.deepEqual(normalizePlanContent({ ...V1, nextAction: null }).actions, []);
});

test("2C-A CONTROL: an unknown schema FAILS CLOSED — it is never read by shape", () => {
  // The trap this exists to stop: a future v3 that happens to carry an `actions` array would be
  // silently interpreted as v2 by any reader that sniffs fields instead of dispatching on version.
  const v3 = { schema: 3, focus: null, motion: V1.motion, actions: [], milestones: [], why: [] };
  assert.throws(() => normalizePlanContent(v3), UnknownPlanContentSchema);
  assert.throws(() => normalizePlanContent({ ...V1, schema: undefined }), UnknownPlanContentSchema);
  assert.throws(() => normalizePlanContent(null), UnknownPlanContentSchema);
  assert.equal(legacyStagedActionId(v3), null, "and an unknown schema yields no legacy pointer either");
});

// ── 2 · ORDERED DERIVATION ──────────────────────────────────────────────────────────────────────

test("2C-A: a v2 recommendation carries an ordered set, bounded and in the gaps' own rank order", () => {
  const s = state();
  const rec = recommendPursuitPlan(s, NOW);
  assert.equal(rec.content.schema, 2);
  assert.ok(rec.content.actions.length >= 3, `expected at least 3 actions, got ${rec.content.actions.length}`);
  assert.ok(rec.content.actions.length <= MAX_PLAN_ACTIONS_V2);
  const derived = deriveOrderedActions(s);
  // ORDER IS INHERITED, NOT RECOMPUTED (D-019): each action's driving gap keeps the rank order
  // Missing Context gave it.
  const ranks = derived.map((d) => d.gap.rank);
  assert.deepEqual([...ranks].sort((a, b) => b - a), ranks, "actions follow the ranked gaps");
  assert.equal(rec.content.focus?.gapKey, s.gaps[0].key, "the focus is still the top-ranked gap");
  assert.equal(rec.content.actions[0].key, derived[0].action.key);
});

test("2C-A: identity and order are deterministic — same state, same plan, same fingerprint", () => {
  const a = recommendPursuitPlan(state(), NOW);
  const b = recommendPursuitPlan(state(), new Date(NOW.getTime() + 86_400_000));
  assert.deepEqual(a.content, b.content, "content does not move with the clock");
  assert.equal(a.basis.fingerprint, b.basis.fingerprint);
  assert.equal(a.legacyBasis.fingerprint, b.legacyBasis.fingerprint);
});

test("2C-A: several timing gaps collapse to ONE confirm_timing action, highest-ranked wins", () => {
  // The one real collision in the taxonomy: `whynow:not_established`, `whynow:unknown:{i}` and
  // `whynow:contradiction:{i}` all mean "confirm the timing" — three REASONS for one act, not three
  // acts. A seller confirms timing once.
  const gaps = state().gaps;
  const timing = (key: string, rank: number, text: string) => ({
    key, source: "WHY_NOW" as const, kind: "MISSING" as const, text,
    whyItMatters: null, howToResolve: null, refType: "pursuit", refId: "p-1", rank, rankReasons: [],
  });
  const s = state({
    gaps: [
      timing("whynow:unknown:0", 95, "The renewal timing is unknown"),
      timing("whynow:contradiction:1", 80, "Two sources disagree on the renewal anchor"),
      timing("whynow:not_established", 70, "Timing is not established"),
      ...gaps,
    ],
  });
  const derived = deriveOrderedActions(s);
  const timingActions = derived.filter((d) => d.action.key === "confirm_timing");
  assert.equal(timingActions.length, 1, "one action for one intent");
  assert.equal(timingActions[0].gap.key, "whynow:unknown:0", "the highest-ranked occurrence wins");
  // AND NO INDEX SUFFIX EVER: a key must represent a stable intent, so `confirm_timing#2` is not a
  // repair. The proof is that every key in the plan is one `actionFor` could produce unaided.
  for (const d of derived) assert.ok(!/#\d+$/.test(d.action.key), `${d.action.key} was made unique artificially`);
  assert.equal(new Set(derived.map((d) => d.action.key)).size, derived.length, "keys are distinct");
});

test("2C-A CONTROL: a losing sibling gap does not move the plan or its fingerprint", () => {
  const base = state({
    gaps: [
      { key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING", text: "The renewal timing is unknown", whyItMatters: null, howToResolve: null, refType: "pursuit", refId: "p-1", rank: 95, rankReasons: [] },
      ...state().gaps,
    ],
  });
  const withSibling = state({
    gaps: [
      base.gaps[0],
      { key: "whynow:contradiction:0", source: "WHY_NOW", kind: "CONFLICTING", text: "Sources disagree on the renewal anchor", whyItMatters: null, howToResolve: null, refType: "pursuit", refId: "p-1", rank: 90, rankReasons: [] },
      ...state().gaps,
    ],
  });
  const a = recommendPursuitPlan(base, NOW);
  const b = recommendPursuitPlan(withSibling, NOW);
  assert.deepEqual(a.content.actions.map((x) => x.key), b.content.actions.map((x) => x.key));
  assert.equal(a.basis.fingerprint, b.basis.fingerprint, "a gap that changes no action changes no fingerprint");
});

// ── 3 · VERSIONED FINGERPRINTS ──────────────────────────────────────────────────────────────────

test("2C-A: a stored v1 plan is compared v1-to-v1 — deploying v2 makes NO plan reviewable", () => {
  const s = state();
  const live = recommendPursuitPlan(s, NOW);
  // What a v1 revision holds: v1 content, and a v1 basis computed by the unchanged algorithm.
  const milestones = evaluateMilestones(planMilestones(s), s);
  const owner = resolveOwner("VENDOR_ACCOUNT_EXECUTIVE", s.team);
  const v1Inputs = fingerprintInputs(s, milestones, s.gaps[0], owner);
  const stored = {
    content: normalizePlanContent(V1),
    basis: { recommenderVersion: "pursuit-plan-v1", computedAt: NOW.toISOString(), fingerprint: fingerprintOf(v1Inputs), inputs: v1Inputs, evidence: [] },
  };
  assert.equal(freshBasisFor(stored.basis, live).fingerprint, live.legacyBasis.fingerprint, "the v1 algorithm is selected");
  assert.notEqual(live.legacyBasis.fingerprint, live.basis.fingerprint, "the two algorithms genuinely differ");
  assert.equal(assessPlanReview(stored, live).state, "CURRENT", "an unchanged world leaves a v1 plan CURRENT");
});

test("2C-A CONTROL: the v1 comparison still detects a real v1 input change", () => {
  const s = state();
  const milestones = evaluateMilestones(planMilestones(s), s);
  const v1Inputs = fingerprintInputs(s, milestones, s.gaps[0], resolveOwner("VENDOR_ACCOUNT_EXECUTIVE", s.team));
  const stored = {
    content: normalizePlanContent(V1),
    basis: { recommenderVersion: "pursuit-plan-v1", computedAt: NOW.toISOString(), fingerprint: fingerprintOf(v1Inputs), inputs: v1Inputs, evidence: [] },
  };
  const moved = recommendPursuitPlan(state({ pursuitStatus: "COMMITTED" }), NOW);
  const review = assessPlanReview(stored, moved);
  assert.equal(review.state, "REVIEW_NEEDED");
  assert.ok(review.reasons.some((r) => /Pursuit is now/.test(r)), review.reasons.join(" | "));
});

test("2C-A: a v2 plan is compared v2-to-v2, and an unknown basis version fails closed", () => {
  const live = recommendPursuitPlan(state(), NOW);
  const stored = { content: live.content, basis: live.basis };
  assert.equal(freshBasisFor(stored.basis, live).fingerprint, live.basis.fingerprint);
  assert.equal(assessPlanReview(stored, live).state, "CURRENT");
  const alien = { ...live.basis, inputs: { ...live.basis.inputs, v: 7 } } as never;
  assert.throws(() => freshBasisFor(alien, live), UnknownPlanContentSchema);
});

test("2C-A: the v2 basis notices a change to action 2 or 3 that v1 could never see", () => {
  // THE REASON V2 NEEDS ITS OWN BASIS. Actions 2 and 3 descend from gaps the v1 inputs never
  // mention, so under the v1 algorithm this change is invisible and the plan looks current.
  const s = state();
  const before = recommendPursuitPlan(s, NOW);
  assert.ok(before.content.actions.length >= 3);
  const droppedThird = state({ gaps: s.gaps.filter((g) => g.key !== s.gaps[2].key) });
  const after = recommendPursuitPlan(droppedThird, NOW);
  assert.notEqual(before.basis.fingerprint, after.basis.fingerprint, "v2 sees it");
  const review = assessPlanReview({ content: before.content, basis: before.basis }, after);
  assert.equal(review.state, "REVIEW_NEEDED");
  assert.ok(review.reasons.some((r) => /No longer recommended|Now recommended/.test(r)), review.reasons.join(" | "));
});

test("2C-A: reordering the recommended actions moves the v2 fingerprint", () => {
  const s = state();
  const a = recommendPursuitPlan(s, NOW);
  const swapped = state({ gaps: [s.gaps[1], s.gaps[0], ...s.gaps.slice(2)].map((g, i) => ({ ...g, rank: 100 - i })) });
  const b = recommendPursuitPlan(swapped, NOW);
  assert.notDeepEqual(a.content.actions.map((x) => x.key), b.content.actions.map((x) => x.key));
  assert.notEqual(a.basis.fingerprint, b.basis.fingerprint, "order is part of the recommendation");
});

test("2C-A: the v2 basis carries inputs, never rendered prose", () => {
  const inputs = recommendPursuitPlan(state(), NOW).basis.inputs;
  assert.equal(inputs.v, 2);
  const serialized = JSON.stringify(inputs);
  for (const prose of ["Identify and verify", "Done when", "Globex Manufacturing"]) {
    assert.ok(!serialized.includes(prose), `basis leaked prose: ${prose}`);
  }
  if (inputs.v === 2) {
    for (const a of inputs.actions) {
      assert.deepEqual(Object.keys(a).sort(), ["gapKey", "key", "kind", "milestoneKey", "owner", "source"]);
    }
  }
});

test("2C-A: a human adjustment never rewrites the recommendation basis", () => {
  // Plan review asks whether the WORLD moved, never whether the world would reproduce a person's
  // edited words. The adjusted content is what is stored; the basis stays the recommendation's.
  const live = recommendPursuitPlan(state(), NOW);
  const key = live.content.actions[0].key;
  const { content } = applyAdjustments(live.content, { actions: { [key]: { text: "Book time with the CFO office" } } }, state().team);
  const stored = { content, basis: live.basis };
  assert.equal(assessPlanReview(stored, live).state, "CURRENT", "editing my own plan does not make it stale");
});

// ── 4 · THE CANONICAL CURRENT ACTION ────────────────────────────────────────────────────────────

const act = (key: string, milestoneKey: string | null): PlanActionV2 => ({
  key, text: key, doneWhen: null, via: null,
  owner: { kind: "UNASSIGNED", teamMemberId: null, role: null, roleLabel: null, personLabel: null, confirmed: false },
  dueInDays: 5, milestoneKey,
});

test("2C-A: standing comes from canonical milestone state, with a named fallback where none exists", () => {
  const m = { done: "DONE" as const, blocked: "BLOCKED" as const, open: "OPEN" as const, unknown: "NOT_ESTABLISHED" as const };
  assert.deepEqual(actionStanding(act("a", "done"), m), { standing: "RESOLVED", reason: "MILESTONE_DONE" });
  assert.deepEqual(actionStanding(act("a", "blocked"), m), { standing: "BLOCKED", milestoneKey: "blocked" });
  assert.deepEqual(actionStanding(act("a", "open"), m), { standing: "ACTIONABLE" });
  assert.deepEqual(actionStanding(act("a", "unknown"), m), { standing: "ACTIONABLE" }, "not established is work to do");
  assert.deepEqual(actionStanding(act("a", null), m), { standing: "ACTIONABLE" });
  assert.deepEqual(actionStanding(act("a", null), m, { a: { status: "done" } }), { standing: "RESOLVED", reason: "MOTION_ACTION_DONE" });
  // SKIPPED MEANS "NO LONGER PENDING", NEVER "THE CONDITION WAS SATISFIED". The reason is carried
  // so no surface can round it up into success.
  assert.deepEqual(actionStanding(act("a", null), m, { a: { status: "skipped" } }), { standing: "RESOLVED", reason: "MOTION_ACTION_SKIPPED" });
  // A milestone-backed action is NOT resolved by queue bookkeeping: the domain decides.
  assert.deepEqual(actionStanding(act("a", "open"), m, { a: { status: "skipped" } }), { standing: "ACTIONABLE" });
});

test("2C-A: selection skips blocked and resolved — a later action may be the work that unblocks an earlier one", () => {
  const m = { m1: "BLOCKED" as const, m2: "OPEN" as const, m3: "OPEN" as const };
  const actions = [act("map_paper_process", "m1"), act("confirm_eb", "m2"), act("third", "m3")];
  const current = selectCurrentPlanAction(actions, m);
  assert.equal(current?.action.key, "confirm_eb");
  assert.equal(current?.index, 1, "position is reported, so nothing has to re-find it");
  const allDone = selectCurrentPlanAction(actions, { m1: "DONE", m2: "DONE", m3: "DONE" });
  assert.equal(allDone, null, "null means no remaining recommended actions");
});

test("2C-A: the display action falls back to the top-ranked one, and says it is not current", () => {
  const actions = [act("a", "m1"), act("b", "m2")];
  const none = selectDisplayPlanAction(actions, { m1: "DONE", m2: "DONE" });
  assert.equal(none?.action.key, "a");
  assert.equal(none?.isCurrent, false, "a plan with nothing to do still shows what it was");
  const some = selectDisplayPlanAction(actions, { m1: "DONE", m2: "OPEN" });
  assert.equal(some?.action.key, "b");
  assert.equal(some?.isCurrent, true);
  assert.equal(selectDisplayPlanAction([], {}), null);
});

// ── 5 · ADJUSTMENTS ─────────────────────────────────────────────────────────────────────────────

test("2C-A: reorder and remove are recorded by stable key, and nothing can be added", () => {
  const rec = recommendPursuitPlan(state(), NOW);
  const [a, b, c] = rec.content.actions.map((x) => x.key);
  const reordered = applyAdjustments(rec.content, { order: [b, a, c] }, state().team);
  assert.deepEqual(reordered.content.actions.map((x) => x.key), [b, a, c]);
  assert.ok(reordered.changes.some((ch) => ch.field === "actions.order"), "the order change is recorded");
  const removed = applyAdjustments(rec.content, { order: [a, c] }, state().team);
  assert.deepEqual(removed.content.actions.map((x) => x.key), [a, c]);
  const removal = removed.changes.find((ch) => ch.field === "action.removed");
  assert.equal(removal?.actionKey, b, "the removed action is named, so the divergence is reconstructable");
  // AN ADJUSTMENT MAY REDUCE THE RECOMMENDATION; IT MAY NOT INVENT COMMERCIAL WORK.
  assert.throws(() => applyAdjustments(rec.content, { order: [a, "invented:action"] }, state().team), /no action invented:action/);
  assert.throws(() => applyAdjustments(rec.content, { actions: { "invented:action": { text: "x" } } }, state().team), /no action invented:action/);
  assert.throws(() => applyAdjustments(rec.content, { order: [a, a] }, state().team), /once in the approved order/);
});

test("2C-A: an adjustment leaves the recommendation object untouched", () => {
  const rec = recommendPursuitPlan(state(), NOW);
  const frozen = JSON.stringify(rec.content);
  applyAdjustments(rec.content, { order: [rec.content.actions[1].key] }, state().team);
  assert.equal(JSON.stringify(rec.content), frozen);
});

// ── 6 · GAP IDENTITY, THE INVARIANT ORDERING AND DEDUP BOTH REST ON ─────────────────────────────

test("2C-A: every CONTEXT_HEALTH emitter yields a non-null refId and a unique (kind, refId)", () => {
  // All six emitter classes driven at once, so a seventh that breaks the rule fails HERE rather
  // than silently producing a `health:{kind}:none` gap that cannot be identified, deduplicated,
  // ordered or fingerprinted.
  const fact = (over: Partial<ContextFactInput> & { factId: string }): ContextFactInput => ({
    predicateKey: "renewal_date", label: over.factId, relevance: "SUPPORTING_CONTEXT", status: "CURRENT",
    confidence: 0.9, provenanceClass: "FIRST_PARTY", freshnessPolicy: "DECAYING",
    observedLastAt: new Date("2024-01-01T00:00:00Z"), halfLifeDays: 30, superseded: false, ...over,
  });
  const health = computeContextHealth({
    pursuitId: "p-1",
    facts: [
      fact({ factId: "f-stale" }),                                                        // STALE_FACT
      fact({ factId: "f-weak", confidence: 0.1, provenanceClass: "THIRD_PARTY_UNVERIFIED", observedLastAt: NOW }),  // WEAK_PROVENANCE
      fact({ factId: "f-sup", observedLastAt: NOW, superseded: true }),                   // SUPERSEDED_FACT
      fact({ factId: "f-dis", observedLastAt: NOW, status: "DISPUTED" }),                 // DISPUTED_FACT
    ],
    completeness: { providersRun: new Set<string>(), familiesPresent: new Set<string>() },
    requiredCategories: ["timing", "technology"],                                          // MISSING_COVERAGE
    openContradictions: 3,                                                                 // OPEN_CONTRADICTION
    now: NOW,
  });
  const kinds = new Set(health.concerns.map((c) => c.kind));
  assert.ok(kinds.size >= 4, `expected several emitter classes, saw ${[...kinds].join(",")}`);
  for (const c of health.concerns) {
    assert.ok(c.refId !== null && c.refId !== undefined, `${c.kind} emitted a null refId`);
  }
  const keys = health.concerns.map((c) => `${c.kind}:${c.refId}`);
  assert.equal(new Set(keys).size, keys.length, `duplicate (kind, refId): ${keys.join(", ")}`);
  // THREE open contradictions are ONE concern, not three: the emitter sits outside its own loop.
  // That is the case that would otherwise mint duplicate gap keys on the same pursuit id.
  assert.equal(health.concerns.filter((c) => c.kind === "OPEN_CONTRADICTION").length, 1);
});

test("2C-A CONTROL: an unidentifiable health concern is omitted with a reason, never keyed `none`", () => {
  const concern = { kind: "MISSING_COVERAGE", dimension: "coverage", text: "no reference", refType: "coverage_category", refId: null, weight: 0.5 } as ContextHealthConcern;
  const mc = composeMissingContext({
    pursuitId: "p-1",
    contextHealth: { concerns: [concern] } as never,
    maxHealthConcerns: 3,
  } as never);
  assert.ok(!mc.gaps.some((g) => g.key.endsWith(":none")), "no synthetic identity was minted");
  assert.ok(mc.notEvaluated.some((n) => n.source === "CONTEXT_HEALTH" && /no reference|not ranked/i.test(n.reason)),
    JSON.stringify(mc.notEvaluated));
});

test("2C-A: gap keys are unique — the ranked order is total only while they are", () => {
  // `rank desc, key asc` is a TOTAL order exactly when keys are distinct. Duplicate keys would
  // degrade a certified deterministic order into insertion order, which is why uniqueness is an
  // ordering invariant and not merely a dedup convenience.
  const gaps = state().gaps;
  assert.equal(new Set(gaps.map((g) => g.key)).size, gaps.length);
  const sorted = [...gaps].sort((a, b) => (b.rank - a.rank) || a.key.localeCompare(b.key));
  const shuffled = [...gaps].reverse().sort((a, b) => (b.rank - a.rank) || a.key.localeCompare(b.key));
  assert.deepEqual(sorted.map((g) => g.key), shuffled.map((g) => g.key), "the order does not depend on input order");
});

// ── 7 · THE STAGING WRITER, AND WHAT THE DATABASE CANNOT CHECK ──────────────────────────────────

const PLAN_STORE = readFileSync(new URL("../src/lib/pursuits/coordination/plan-store.ts", import.meta.url), "utf8");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("2C-A: the staged pair comes from RESOLVED objects, never from caller-supplied strings", () => {
  // The foreign key proves the revision exists in the tenant. It CANNOT prove that a key names an
  // action inside that revision's JSON — there is no SQL that reads the document and agrees with
  // TypeScript about what a member is. So the membership proof has to live above the boundary, and
  // what must be true of it is structural: the values persisted are derived here, not passed in.
  const code = strip(PLAN_STORE);
  const insert = code.slice(code.indexOf("insert into motion_actions"), code.indexOf("returning id", code.indexOf("insert into motion_actions")) + 200);
  assert.match(insert, /plan_revision_id, plan_action_key/, "the writer populates the lineage columns");
  assert.match(insert, /revisionId, chosen\.key/, "with the revision it just inserted and the action it just resolved");
  // `chosen` is the action found IN the decision's own normalized content, and it must be the very
  // object the canonical selector returned — identity, not a key that merely looks equal.
  assert.match(code, /const chosen = content\.actions\.find\(\(a\) => a\.key === current\.action\.key\)/);
  assert.match(code, /if \(!chosen \|\| chosen !== current\.action\) throw/);
  assert.match(code, /const current = selectCurrentPlanAction\(content\.actions, milestones\)/);
  // AND NOTHING FROM `args` REACHES THE PAIR. A caller supplies a decision and adjustments; it never
  // supplies an action key to stage.
  assert.ok(!/plan_action_key[^;]*args\./.test(code), "no caller field reaches plan_action_key");
  assert.ok(!/args\.(actionKey|planActionKey|stagedActionKey)/.test(code), "there is no caller-supplied action key at all");
});

test("2C-A: exactly ONE action is staged per decision — the current one", () => {
  const code = strip(PLAN_STORE);
  const inserts = code.match(/insert into motion_actions/g) ?? [];
  assert.equal(inserts.length, 1, "one staging site, so 'only the current action' cannot be bypassed elsewhere");
  // No loop, map or forEach over actions anywhere near the staging site.
  const region = code.slice(code.indexOf("STAGE EXACTLY ONE ACTION") >= 0 ? code.indexOf("let stagedMotionActionId") : 0);
  const staging = region.slice(0, region.indexOf("const revisionNo") >= 0 ? region.indexOf("const revisionNo") : 4000);
  assert.ok(!/content\.actions\.(map|forEach|flatMap)\(/.test(staging), "the staging path never iterates the plan");
});

test("2C-A: the ledger corroborates lineage and carries nothing more", () => {
  const code = strip(PLAN_STORE);
  const after = code.slice(code.indexOf("changeType: \"ACTION_CREATED\""));
  const payload = after.slice(after.indexOf("after: {"), after.indexOf("}", after.indexOf("after: {")) + 1);
  for (const field of ["planId", "planRevisionId", "planActionKey"]) {
    assert.ok(payload.includes(field), `the corroboration names ${field}`);
  }
  // AND NOTHING ELSE that would turn an audit row into a second source of truth or leak content.
  for (const forbidden of ["args", "capability", "skillId", "evidence", "doneWhen", "via"]) {
    assert.ok(!payload.includes(forbidden), `the ledger payload leaked ${forbidden}`);
  }
});
