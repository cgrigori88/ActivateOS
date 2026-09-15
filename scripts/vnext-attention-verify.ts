import { Pool, type PoolClient } from "pg";
import { DAY_MS, startOfToday } from "../src/lib/motions/due-buckets";
import { recordPlanRecommendation } from "../src/lib/pursuits/coordination/plan-store";
import { dispatchSkill } from "../src/lib/pursuits/federation/skills";
import { composeTodayAttention, loadPursuitAttention, loadQueuePlanLineage } from "../src/lib/pursuits/read-models/attention-loaders";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import { loadPlanRecords, loadPursuitPlanView } from "../src/lib/pursuits/read-models/plan-loaders";
import type { PursuitAttention } from "../src/lib/pursuits/read-models/pursuit-attention";
import { frameApprovedPlan, resolvePlanStanding } from "../src/lib/pursuits/read-models/pursuit-plan";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import type { DataEnvironment } from "../src/lib/pursuits/lineage";
import type { TodayQueueView } from "../src/lib/pursuits/read-models/types";

/**
 * Pursuit Attention — integration harness (vNext Slice 2B).
 *
 * Proves Today / Queue coordination against the REAL schema and the canonical Globex pursuit,
 * through the four acceptance states:
 *
 *   A  the seeded recommendation awaits a person        → Today: "Plan awaiting approval"
 *   B  a person approves; the action is queued           → one Queue row, with its plan lineage
 *   C  the economic buyer is verified after approval     → Today: "Plan needs review" outranks
 *                                                           the old action, which stays queued
 *   D  an updated recommendation is recorded, undecided  → still ONE plan-review card
 *
 * plus: reads never write (every read runs inside a READ ONLY transaction), one card per
 * pursuit with nothing lost by collapsing, tenant isolation of cards, counts, ranks, badges and
 * hidden "other items", partner-safe disclosure, and no send path.
 *
 * LEAVES THE WORLD AS IT FOUND IT. Every write (approve, verify, recommend, a simulated due
 * date) runs inside a transaction that is ROLLED BACK. Proven at the end by re-counting.
 *
 * CLASSIFICATION: SEEDED — it needs the canonical world and the Slice 2A plan layer.
 *
 *   DATABASE_URL_VERIFY=… npx tsx scripts/vnext-attention-verify.ts
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

/** Every table a Today / Queue read could conceivably touch. A read must leave each one unchanged. */
const WORLD = [
  "pursuit_goals", "pursuit_plans", "pursuit_plan_revisions", "change_ledger", "motion_actions",
  "governed_action_invocations", "pursuit_overrides", "pursuit_team_members", "pursuit_facts",
  "stakeholders", "outcome_events", "action_outbox", "messages", "email_events",
];
async function snapshot(db: PoolClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of WORLD) out[t] = await count(db, `select count(*)::text n from ${t}`);
  return out;
}

/** Today exactly as the page composes it with the capability armed — uncut. */
async function todayFor(db: PoolClient, caller: Caller): Promise<TodayQueueView> {
  return composeTodayAttention(db, caller, await getTodayQueue(db, caller, {}), {});
}

/** Everything a reader can see on a Today card, minus request-time stamps. */
const project = (v: TodayQueueView) => JSON.stringify({
  total: v.total, counts: v.counts, banner: v.demoBanner,
  cards: v.items.map((i) => ({ p: i.pursuitId, t: i.type, c: i.decisionClass, u: i.operationalUrgency, b: i.commercialPriority, title: i.title, reason: i.reason, others: (i.others ?? []).map((o) => o.title) })),
});

const cardsFor = (v: TodayQueueView, pursuitId: string) => v.items.filter((i) => i.pursuitId === pursuitId);
const heroAttention = (list: PursuitAttention[], pursuitId: string) => list.filter((a) => a.pursuitId === pursuitId);

const SECRETS = ["Sarah Kim", "Mike Rivera", "Dana Whitfield", "WWT seller", "Identify and verify", "CDW recommendation", "1,840,000", "RAW_SPEND", "Account executive role proposed"];

async function main(): Promise<void> {
  console.log(`[vnext-attention-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  const hero = (await pool.query<{ id: string; org_id: string; env: string }>(
    `select p.id, p.org_id, p.data_environment env from pursuits p join companies c on c.id = p.account_id
      where c.legal_name = 'Globex Manufacturing Inc.' and p.pursuit_type = 'MODERNIZATION' order by p.created_at limit 1`)).rows[0];
  if (!hero) { console.log("FATAL: Globex hero pursuit not found — seed the canonical world first."); process.exit(1); }
  const otherOrgs = (await pool.query<{ id: string; name: string; kind: string }>(`select id, name, kind from organizations where id <> $1 order by created_at`, [hero.org_id])).rows;
  const orgOf = new Map((await pool.query<{ id: string; org_id: string }>(`select id, org_id from pursuits`)).rows.map((r) => [r.id, r.org_id]));
  const caller: Caller = await readOnly(hero.org_id, (db) => callerFor(db, hero.org_id));
  const guest: Caller = { orgId: hero.org_id, canSeeInternal: false, canSeeTransactionDetail: false };
  const operator = { type: "USER" as const, id: null, orgId: hero.org_id, role: "operator" as const };
  const today0 = startOfToday();
  const tomorrow = new Date(today0 + DAY_MS + 10 * 3_600_000);
  const yesterday = new Date(today0 - DAY_MS + 10 * 3_600_000);
  console.log(`\nPursuit under test: Globex Manufacturing Inc. · ${hero.id}`);

  const worldBefore = await readOnly(hero.org_id, snapshot);

  // =========================================================================
  console.log("\n1  Reads never write — every read below runs inside a READ ONLY transaction");
  // =========================================================================
  let roError = "OK";
  let stateA: { att: PursuitAttention[]; today: TodayQueueView; raw: TodayQueueView; lineage: Record<string, unknown>; pendingIds: string[] } | null = null;
  try {
    stateA = await readOnly(hero.org_id, async (db) => {
      const s0 = await snapshot(db);
      const att = await loadPursuitAttention(db, caller);
      const raw = await getTodayQueue(db, caller, {});
      // Composed from the SAME raw queue: several existing item types stamp `new Date()` into
      // their ids, so ids from two separate reads never match.
      const today = await composeTodayAttention(db, caller, raw, {});
      const pendingIds = (await db.query<{ id: string }>(`select id from motion_actions where status = 'pending' order by id`)).rows.map((r) => r.id);
      const lineage = await loadQueuePlanLineage(db, caller, pendingIds);
      await loadPursuitPlanView(db, caller, hero.id);
      const s1 = await snapshot(db);
      check("attention, composed Today, Queue lineage and the plan surface wrote nothing (every table count identical)", JSON.stringify(s0) === JSON.stringify(s1), JSON.stringify({ s0, s1 }));
      return { att, today, raw, lineage, pendingIds };
    });
  } catch (e) { roError = (e as { code?: string }).code ?? String(e); }
  check("…and could not have: a write inside READ ONLY would have raised 25006", roError === "OK", roError);
  if (!stateA) { await pool.end(); process.exit(1); }

  // =========================================================================
  console.log("\n2  STATE A — the seeded recommendation awaits a person");
  // =========================================================================
  const a = heroAttention(stateA.att, hero.id);
  check("exactly one attention for Globex", a.length === 1);
  const aa = a[0];
  console.log(`     primary : ${aa?.primary.headline} — ${aa?.primary.detail}`);
  check("A: PLAN_DECISION_REQUIRED — \"Plan awaiting approval\"", aa?.primary.kind === "PLAN_DECISION_REQUIRED" && aa.primary.headline === "Plan awaiting approval");
  check("A: CTA \"Review plan\" deep-links to the Pursuit Plan surface", aa?.primary.cta.label === "Review plan" && aa.primary.cta.href === `/pursuits/${hero.id}#plan`);
  check("A: the key is grounded in the recommendation awaiting a decision", /^attention:[0-9a-f-]+:PLAN_DECISION_REQUIRED:[0-9a-f-]{36}$/.test(aa?.key ?? ""), aa?.key);
  const aCards = cardsFor(stateA.today, hero.id);
  check("A: ONE Today card for Globex, and it is the plan decision", aCards.length === 1 && aCards[0].type === "PLAN_DECISION_REQUIRED");
  check("A: Globex's existing Today items fold beneath it (the economic-buyer gap among them)",
    (aCards[0]?.others ?? []).some((o) => /lacks a verified economic buyer/.test(o.title)), JSON.stringify(aCards[0]?.others?.map((o) => o.title)));
  const pids = stateA.today.items.map((i) => i.pursuitId).filter((x): x is string => !!x);
  check("one card per pursuit across the whole of Today", new Set(pids).size === pids.length);
  const ownRaw = stateA.raw.items.filter((i) => i.pursuitId && orgOf.get(i.pursuitId) === hero.org_id);
  const lost = ownRaw.filter((i) => {
    const card = stateA!.today.items.find((c) => c.pursuitId === i.pursuitId);
    return !card || !(card.id === i.id || (card.others ?? []).some((o) => o.key === i.id));
  });
  check("nothing is lost by collapsing: every item of this org is a card or listed beneath one", lost.length === 0, lost.map((i) => i.title).join("; "));
  check(`Today shrinks from ${stateA.raw.total} item cards to ${stateA.today.total} pursuit cards`, (stateA.today.total ?? 0) < (stateA.raw.total ?? 0));
  check("A: nothing is approved, so no queue row carries plan lineage", Object.keys(stateA.lineage).length === 0);
  const again = await readOnly(hero.org_id, (db) => loadPursuitAttention(db, caller));
  check("deterministic: a second read yields the same keys", JSON.stringify(again.map((x) => x.key)) === JSON.stringify(stateA.att.map((x) => x.key)));

  // =========================================================================
  console.log("\n3  STATES B → C → D, on the real world (rolled back)");
  // =========================================================================
  await scenario(hero.org_id, async (db) => {
    const recs = await loadPlanRecords(db, caller, hero.id);
    const rec = resolvePlanStanding(recs.revisions).pending!;
    const motionId = rec.content.motion.motionId!;
    const dec = await dispatchSkill(db, "decide_pursuit_plan", operator, {
      pursuitId: hero.id, args: { planId: recs.plan!.id, recommendationId: rec.id, decision: "APPROVED" }, dataEnvironment: hero.env,
    });
    check("B: a person approves the recommendation (governed)", dec.status === "EXECUTED", dec.reason ?? "");
    const inForce = resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).inForce!;
    const inForceRow = JSON.stringify((await db.query(`select content, basis, basis_fingerprint, created_at from pursuit_plan_revisions where id = $1`, [inForce.id])).rows[0]);
    const stagedId = inForce.content.nextAction!.stagedMotionActionId!;
    const staged = (await db.query<{ action: string; status: string }>(`select action, status from motion_actions where id = $1`, [stagedId])).rows[0];
    const cadenceStep = (await db.query<{ id: string }>(`select id from motion_actions where motion_id = $1 and status = 'pending' and id <> $2 order by step limit 1`, [motionId, stagedId])).rows[0]?.id;
    const onceInQueue = async () => count(db, `select count(*)::text n from motion_actions where motion_id = $1 and action = $2`, [motionId, staged.action]);
    check("B: the approved action entered the Queue exactly once", !!staged && staged.status === "pending" && await onceInQueue() === 1);

    // The clock, simulated inside the rolled-back transaction: the approved action falls due tomorrow.
    await db.query(`update motion_actions set due_at = $2 where id = $1`, [stagedId, tomorrow]);
    const b0 = await snapshot(db);
    const attB = heroAttention(await loadPursuitAttention(db, caller), hero.id)[0];
    const todayB = await todayFor(db, caller);
    const linB = await loadQueuePlanLineage(db, caller, [stagedId, ...(cadenceStep ? [cadenceStep] : [])]);
    check("B: reading Today and Queue wrote nothing", JSON.stringify(b0) === JSON.stringify(await snapshot(db)));
    console.log(`     primary : ${attB?.primary.headline} — ${attB?.primary.detail}`);
    check("B: no plan decision is needed, so the approved action surfaces — led by its missing owner",
      attB?.primary.kind === "OWNER_MISSING" && attB.others.some((r) => r.kind === "ACTION_DUE" && r.ref.refId === stagedId), JSON.stringify(attB?.reasons.map((r) => r.kind)));
    check("B: still ONE Globex card", cardsFor(todayB, hero.id).length === 1);
    check("B: the queued action names its plan: current, approved by a person",
      linB[stagedId]?.state === "CURRENT" && linB[stagedId].label === "From the approved plan" && linB[stagedId].revisionId === inForce.id
        && linB[stagedId].planId === recs.plan!.id && linB[stagedId].approvedByPerson && linB[stagedId].pursuitId === hero.id);
    check("B: the motion's own cadence step carries no plan lineage", !!cadenceStep && !linB[cadenceStep]);
    await db.query(`update motion_actions set due_at = $2 where id = $1`, [stagedId, yesterday]);
    const attBo = heroAttention(await loadPursuitAttention(db, caller), hero.id)[0];
    check("B: once the approved action is overdue, ACTION_OVERDUE leads", attBo?.primary.kind === "ACTION_OVERDUE" && attBo.due?.bucket === "OVERDUE");
    await db.query(`update motion_actions set due_at = $2 where id = $1`, [stagedId, tomorrow]);

    // ── C: new evidence after approval ─────────────────────────────────────────
    const opp = (await db.query<{ id: string }>(`select id from opportunities where pursuit_id = $1 limit 1`, [hero.id])).rows[0].id;
    const dana = (await db.query<{ id: string }>(`select id from contacts where name = 'Dana Whitfield' limit 1`)).rows[0]?.id;
    const eb = await dispatchSkill(db, "assert_stakeholder_role", operator, {
      pursuitId: hero.id, dataEnvironment: hero.env,
      args: { opportunityId: opp, contactId: dana, role: "economic_buyer", assertionState: "verified", source: "verifier", evidence: "Customer confirmed budget ownership on the call.", basis: ["human_statement"] },
    });
    check("C: the economic buyer is verified through the governed path", eb.status === "EXECUTED", eb.reason ?? "");
    const c0 = await snapshot(db);
    const attC = heroAttention(await loadPursuitAttention(db, caller), hero.id)[0];
    const todayC = await todayFor(db, caller);
    const linC = await loadQueuePlanLineage(db, caller, [stagedId]);
    const viewC = (await loadPursuitPlanView(db, caller, hero.id))!;
    check("C: reading Today, Queue and the plan wrote nothing (no ledger event, no recommendation)", JSON.stringify(c0) === JSON.stringify(await snapshot(db)));
    console.log(`     primary : ${attC?.primary.headline} — ${attC?.primary.detail}`);
    console.log(`     others  : ${attC?.others.map((r) => r.headline).join(" · ")}`);
    check("C: PLAN NEEDS REVIEW is the primary", attC?.primary.kind === "PLAN_REVIEW_REQUIRED" && attC.primary.headline === "Plan needs review");
    check("C: CTA \"Review plan\" → the Pursuit Plan surface", attC?.primary.cta.label === "Review plan" && attC.primary.cta.href === `/pursuits/${hero.id}#plan`);
    check("C: it says why — the economic buyer, reached since approval", /Economic buyer confirmed — reached since the plan was approved/.test(attC?.primary.detail ?? ""));
    check("C: review outranks the old economic-buyer action, which remains as context only",
      attC?.others.some((r) => r.kind === "ACTION_DUE" && r.ref.refId === stagedId) === true && attC.due === null);
    check("C: critical while the stale plan still has queued work", attC?.primary.urgency === "critical");
    const cCards = cardsFor(todayC, hero.id);
    check("C: ONE Globex card on Today, and it is the plan review", cCards.length === 1 && cCards[0].type === "PLAN_REVIEW_REQUIRED");
    check("C: it leads Today — before every route approval", todayC.items[0]?.pursuitId === hero.id, todayC.items[0]?.title);
    check("C: the Queue keeps the approved action — same row, still pending, still once",
      (await db.query<{ status: string }>(`select status from motion_actions where id = $1`, [stagedId])).rows[0].status === "pending" && await onceInQueue() === 1);
    check("C: …and marks it, restrained: \"Plan needs review\" → the plan",
      linC[stagedId]?.state === "REVIEW_NEEDED" && linC[stagedId].label === "Plan needs review" && linC[stagedId].linkLabel === "Review plan" && linC[stagedId].href === `/pursuits/${hero.id}#plan`);
    check("C: the approved plan was not rewritten", viewC.status.state === "REVIEW_NEEDED" && resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).inForce?.id === inForce.id
      && JSON.stringify((await db.query(`select content, basis, basis_fingerprint, created_at from pursuit_plan_revisions where id = $1`, [inForce.id])).rows[0]) === inForceRow);
    check("C: the next unresolved gap is timing", viewC.review.reasons.some((r) => /most important gap is now: No verified timing anchor/.test(r)), JSON.stringify(viewC.review.reasons));
    const framed = frameApprovedPlan(viewC);
    check("C: Pursuit Detail frames the preserved plan as the \"Current approved plan\" — its content unchanged",
      framed.approvedPlanFrame?.label === "Current approved plan" && framed.approvedPlanFrame.focusLabel === "Focus when approved"
        && framed.focus?.headline === viewC.focus?.headline && framed.nextAction?.text === viewC.nextAction?.text);

    // ── D: an updated recommendation, not yet decided ─────────────────────────
    const rr = await dispatchSkill(db, "recommend_pursuit_plan", operator, { pursuitId: hero.id, dataEnvironment: hero.env });
    check("D: an updated recommendation is recorded", rr.status === "EXECUTED" && (rr.result as { reviewRequired?: boolean } | undefined)?.reviewRequired === true, rr.reason ?? "");
    const viewD = (await loadPursuitPlanView(db, caller, hero.id))!;
    check("D: history holds three separate records — recommendation, human approval, updated recommendation",
      viewD.history.length === 3 && viewD.history[0].label === "Updated recommendation from PursuitOS" && viewD.history[1].label === "Approved by a person" && viewD.history[2].label === "Recommended by PursuitOS");
    const d0 = await snapshot(db);
    const attD = heroAttention(await loadPursuitAttention(db, caller), hero.id);
    const todayD = await todayFor(db, caller);
    const linD = await loadQueuePlanLineage(db, caller, [stagedId]);
    check("D: reading wrote nothing", JSON.stringify(d0) === JSON.stringify(await snapshot(db)));
    console.log(`     primary : ${attD[0]?.primary.headline} — ${attD[0]?.primary.detail}`);
    check("D: still ONE attention and ONE card for Globex — the plan review", attD.length === 1 && attD[0].primary.kind === "PLAN_REVIEW_REQUIRED" && cardsFor(todayD, hero.id).length === 1);
    check("D: the pending decision is carried by the review, never a duplicate",
      attD[0]?.reasons.some((r) => r.kind === "PLAN_DECISION_REQUIRED" && r.subsumedBy === "PLAN_REVIEW_REQUIRED") === true && !attD[0].others.some((r) => r.kind === "PLAN_DECISION_REQUIRED"));
    check("D: the card invites the decision", /An updated recommendation is waiting for your decision\./.test(attD[0]?.primary.detail ?? ""));
    check("D: the approved historical plan is intact, byte for byte",
      JSON.stringify((await db.query(`select content, basis, basis_fingerprint, created_at from pursuit_plan_revisions where id = $1`, [inForce.id])).rows[0]) === inForceRow);
    check("D: the Queue still holds the approved action once, pending, marked for review",
      await onceInQueue() === 1 && linD[stagedId]?.state === "REVIEW_NEEDED");

    // ── The hosted Slice 2B review: one ACCOUNT, two canonical PURSUITS ───────────
    const sibling = (await db.query<{ id: string; label: string }>(
      `select p.id, p.business_problem label from pursuits p
        where p.account_id = (select account_id from pursuits where id = $1) and p.org_id = $2 and p.id <> $1
        order by p.created_at limit 1`, [hero.id, hero.org_id])).rows[0];
    const heroLabel = (await db.query<{ label: string }>(`select business_problem label from pursuits where id = $1`, [hero.id])).rows[0].label;
    const rawD = await getTodayQueue(db, caller, {});
    const siblingRoute = sibling ? rawD.items.find((i) => i.pursuitId === sibling.id && i.type === "ROUTE_APPROVAL") : undefined;
    check("D: Globex holds a second canonical pursuit with its OWN pending route approval (the hosted second card)", !!siblingRoute, sibling?.label);
    const heroCardD = cardsFor(todayD, hero.id)[0];
    const siblingCards = sibling ? cardsFor(todayD, sibling.id) : [];
    check("D: exactly ONE card for the hero pursuit — the plan review", cardsFor(todayD, hero.id).length === 1 && heroCardD?.type === "PLAN_REVIEW_REQUIRED");
    check("D: the other pursuit's route approval is its own card — pursuits are never merged by account",
      siblingCards.length === 1 && siblingCards[0].type === "ROUTE_APPROVAL" && !(heroCardD?.others ?? []).some((o) => /Approve route/.test(o.title)));
    check("D: where one account has two pursuit cards, each names its pursuit",
      heroCardD?.title === `${heroLabel.replace(/\.$/, "")} · Plan needs review` && siblingCards[0]?.title === `${sibling!.label.replace(/\.$/, "")} · Approve route via CDW`,
      `${heroCardD?.title} | ${siblingCards[0]?.title}`);
    const top4 = await composeTodayAttention(db, caller, rawD, { limit: 4 });
    const unique = (v: TodayQueueView) => { const p = v.items.map((i) => i.pursuitId).filter(Boolean); return new Set(p).size === p.length; };
    check("D: no pursuit appears twice — Today's top decisions and View all", unique(top4) && unique(todayD));
    check("D: the folded reasons stay actionable (each carries its own CTA)", (heroCardD?.others ?? []).every((o) => !!o.actionLabel && !!o.deepLink));
    check("D: 'decisions to make' counts every underlying reason, not the collapsed cards",
      todayD.decisionCount === todayD.items.reduce((n, c) => n + 1 + (c.others?.length ?? 0), 0) && (todayD.decisionCount ?? 0) > (todayD.total ?? 0));

    // ── Disclosure, in the richest state ───────────────────────────────────────
    const g = heroAttention(await loadPursuitAttention(db, guest), hero.id)[0];
    const gCard = cardsFor(await todayFor(db, guest), hero.id)[0];
    const gText = JSON.stringify({ g, title: gCard?.title, reason: gCard?.reason, attention: gCard?.attention, others: (gCard?.others ?? []).filter((o) => o.key.startsWith("attention:")) });
    check("disclosure: a partner-safe caller still learns the plan needs review", g?.primary.kind === "PLAN_REVIEW_REQUIRED");
    const leaked = SECRETS.filter((s) => gText.includes(s));
    check("disclosure: …and receives no names, warm paths, plan text, reasoning or economics", leaked.length === 0, leaked.join(", "));
    check("disclosure: the owner is only 'Unassigned' — no role detail", g?.owner?.label === "Unassigned" && g.owner.note === null);
  });

  // =========================================================================
  console.log("\n4  Tenant isolation — cards, counts, ranking, badges and hidden 'other items'");
  // =========================================================================
  for (const o of otherOrgs) {
    await readOnly(o.id, async (db) => {
      const oc = await callerFor(db, o.id);
      const att = await loadPursuitAttention(db, oc);
      check(`${o.name}: derives attention only for its own pursuits`, att.every((x) => orgOf.get(x.pursuitId) === o.id) && !att.some((x) => x.pursuitId === hero.id));
      const t = await todayFor(db, oc);
      const foreign = t.items.filter((i) => i.pursuitId && orgOf.get(i.pursuitId) !== o.id);
      check(`${o.name}: composed Today holds no card for a pursuit it does not own`, foreign.length === 0, foreign.map((i) => `${i.accountLabel}: ${i.title}`).slice(0, 3).join("; "));
      const pending = (await db.query<{ id: string }>(`select id from motion_actions where status = 'pending'`)).rows.map((r) => r.id);
      check(`${o.name}: sees no plan lineage on another org's queue rows`, Object.keys(await loadQueuePlanLineage(db, oc, pending)).length === 0);
    });
  }
  const meridian = otherOrgs.find((o) => o.kind === "guest") ?? otherOrgs[0];
  await scenario(hero.org_id, async (db) => {
    const base = project(await todayFor(db, caller));
    const theirs = (await db.query<{ id: string; env: string }>(`select id, data_environment env from pursuits where org_id = $1 order by created_at limit 1`, [meridian.id])).rows[0];
    let made = false;
    if (theirs) {
      await db.query("select set_config('app.org_id', $1, true)", [meridian.id]);
      await db.query("savepoint foreign_plan");
      try {
        await recordPlanRecommendation(db, { type: "SYSTEM", id: null, orgId: meridian.id }, theirs.id, { env: theirs.env as DataEnvironment, correlationId: null });
        made = await count(db, `select count(*)::text n from pursuit_plans where pursuit_id = $1`, [theirs.id]) === 1;
      } catch (e) { await db.query("rollback to savepoint foreign_plan"); console.log(`     (could not record a plan for ${meridian.name}: ${(e as Error).message})`); }
      await db.query("select set_config('app.org_id', $1, true)", [hero.org_id]);
    }
    check(`${meridian.name} now has a live plan of its own`, made);
    check("…and this org's Today is identical: same cards, counts, ranks, badge and hidden 'other items'", project(await todayFor(db, caller)) === base);
  });

  // =========================================================================
  console.log("\n5  No send path, and nothing left behind");
  // =========================================================================
  await readOnly(hero.org_id, async (db) => {
    const now = await snapshot(db);
    check("no outbox row, no message, no email event", now.action_outbox === 0 && now.messages === 0 && now.email_events === 0);
    check("world unchanged after the harness (all writes rolled back)", JSON.stringify(now) === JSON.stringify(worldBefore), JSON.stringify({ worldBefore, now }));
    check("the seeded recommendation is still awaiting a person", resolvePlanStanding((await loadPlanRecords(db, caller, hero.id)).revisions).pending != null);
  });

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) { for (const f of failures) console.log(`  - ${f}`); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[vnext-attention-verify] fatal:", e); await pool.end().catch(() => {}); process.exit(1); });
