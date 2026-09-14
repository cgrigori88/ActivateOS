import type { PoolClient } from "pg";
import type { Caller } from "./helpers";
import { loadMissingContextInput } from "./context-loaders";
import { getPursuitTeam } from "./detail";
import { composeMissingContext } from "./missing-context";
import {
  composePursuitPlanView,
  recommendPursuitPlan,
  resolvePlanStanding,
  type GoalRecord,
  type PlanLedgerChange,
  type PlanRecommendation,
  type PlanRecord,
  type PlanRecords,
  type PlanState,
  type PursuitPlanView,
  type RevisionRecord,
} from "./pursuit-plan";
import { getRouteComparison } from "./route";

/**
 * Loaders for Pursuit Coordination (vNext Slice 2A).
 *
 * THIN, like the Slice 1 loaders: fetch → scope → normalize → map onto the input
 * contracts `pursuit-plan.ts` declares. Every judgement — what the focus is, what a
 * milestone means, whether the plan is stale — lives in the pure module.
 *
 * TENANT SCOPING IS EXPLICIT. Every query carries `org_id = caller.orgId`, and the
 * pursuit is resolved inside the caller's tenant FIRST, before any read-model that
 * addresses a pursuit by id alone (route, why-now, team) is allowed to run. RLS is
 * correct and inert on this path until task #67; the application predicate is the
 * control that actually runs today.
 *
 * DISCLOSURE IS APPLIED HERE. Gaps arrive from Missing Context already filtered for
 * the caller. The sponsor's stakeholder map and warm paths are INTERNAL: a caller
 * without internal visibility gets `withheld`, not an empty map that would read as
 * "no one is covered".
 *
 * Read-only. No INSERT, no UPDATE, no DELETE.
 */

interface PursuitRow {
  id: string;
  account_id: string;
  account_label: string;
  status: string;
  business_problem: string | null;
}

async function loadPursuitInTenant(db: PoolClient, caller: Caller, pursuitId: string): Promise<PursuitRow | null> {
  const { rows } = await db.query<PursuitRow>(
    `select pu.id, pu.account_id, c.legal_name as account_label, pu.status, pu.business_problem
       from pursuits pu join companies c on c.id = pu.account_id
      where pu.id = $1 and pu.org_id = $2`,
    [pursuitId, caller.orgId],
  );
  return rows[0] ?? null;
}

/** The canonical state of one pursuit, normalized for `recommendPursuitPlan`. Null when not the caller's. */
export async function loadPlanState(db: PoolClient, caller: Caller, pursuitId: string, now?: Date): Promise<PlanState | null> {
  const p = await loadPursuitInTenant(db, caller, pursuitId);
  if (!p) return null;

  // Sequential on purpose: one pg client runs one query at a time anyway, and pg 8
  // deprecates queueing concurrent calls on a single client.
  const missingInput = await loadMissingContextInput(db, caller, pursuitId, now);
  const route = await getRouteComparison(db, caller, pursuitId);
  const team = await getPursuitTeam(db, caller, pursuitId);
  const opp = await db.query<{ id: string; name: string; stage: string; amount_usd: string | null; close: string | null }>(
      `select id, name, stage, amount_usd, to_char(expected_close_date, 'YYYY-MM-DD') as close
         from opportunities
        where pursuit_id = $1 and org_id = $2
        order by (stage not like 'closed%') desc, amount_usd desc nulls last, created_at asc
        limit 1`,
      [pursuitId, caller.orgId],
  );
  // The motion carrying this pursuit — a canonical link only: it names the pursuit,
  // or it is the motion this pursuit's opportunity is attributed to. Never inferred
  // from account or category, which is how two pursuits end up claiming one motion.
  const motion = await db.query<{ id: string; status: string; label: string | null; partner: string | null; linkage: "PURSUIT" | "OPPORTUNITY"; open: string }>(
      `select * from (
         select m.id, m.status, tn.name as label, pa.name as partner, 'PURSUIT'::text as linkage, m.created_at, 0 as pref,
                (select count(*) from motion_actions ma where ma.motion_id = m.id and ma.status = 'pending')::text as open
           from revenue_motions m
           left join taxonomy_nodes tn on tn.id = m.taxonomy_node_id
           left join partners pa on pa.id = m.partner_id
          where m.pursuit_id = $1 and m.org_id = $2 and m.status in ('draft','approved','active')
         union all
         select m.id, m.status, tn.name, pa.name, 'OPPORTUNITY'::text, m.created_at, 1,
                (select count(*) from motion_actions ma where ma.motion_id = m.id and ma.status = 'pending')::text
           from opportunities o
           join revenue_motions m on m.id = o.motion_id
           left join taxonomy_nodes tn on tn.id = m.taxonomy_node_id
           left join partners pa on pa.id = m.partner_id
          where o.pursuit_id = $1 and o.org_id = $2 and m.org_id = $2
            and m.status in ('draft','approved','active')
       ) x order by pref asc, created_at desc limit 1`,
      [pursuitId, caller.orgId],
  );

  const missing = missingInput ? composeMissingContext(missingInput) : null;
  const coverage = missingInput?.stakeholderCoverage ?? null;
  const internal = caller.canSeeInternal;

  const whyNow = missingInput?.whyNow ?? null;
  const timingEvent = (whyNow?.lifecycle ?? [])
    .map((e) => ({ e, date: e.date ?? e.window?.from ?? null }))
    .filter((x) => x.date != null && (x.e.state === "VERIFIED_DATE" || x.e.state === "INFERRED_WINDOW"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] ?? null;

  const o = opp.rows[0];
  const m = motion.rows[0];
  const routeKnown = route.recommended != null || route.selected != null || route.decided;
  // The route a person chose. `route.selected` is deliberately null when the choice EQUALS the
  // recommendation (the route surface reads that as "approved the recommended route"), so the
  // raw selection is resolved from `selectedKey`, which the route read-model keeps either way.
  const chosen = route.decided
    ? [route.recommended, ...route.alternatives].find((c) => c != null && c.key === route.selectedKey) ?? route.selected
    : null;

  return {
    pursuitId,
    accountLabel: p.account_label,
    pursuitStatus: p.status,
    businessProblem: p.business_problem,
    opportunity: o
      ? { id: o.id, name: o.name, stage: o.stage, amountUsd: o.amount_usd == null ? null : Number(o.amount_usd), expectedClose: o.close }
      : null,
    route: routeKnown
      ? {
        decided: route.decided,
        selectedLabel: chosen?.label ?? null,
        recommendedLabel: route.recommended?.label ?? null,
        overridden: route.decided && !route.selectionMatchesRecommendation,
      }
      : null,
    motion: m
      ? { id: m.id, label: m.label, status: m.status, partnerLabel: m.partner, linkage: m.linkage, openActions: Number(m.open) }
      : null,
    stakeholders: coverage
      ? {
        established: coverage.established,
        withheld: !internal,
        roles: internal ? coverage.roles.map((r) => ({ role: r.role, state: r.state, personName: r.person?.name ?? null })) : [],
      }
      : null,
    qualification: missingInput?.meddpicc
      ? Object.fromEntries(Object.entries(missingInput.meddpicc).map(([k, v]) => [k, v.status]))
      : null,
    valueState: missingInput?.valueCase?.state ?? null,
    timing: {
      anchored: whyNow?.timingAnchor?.present === true,
      accountEvent: timingEvent
        ? { label: timingEvent.e.label, date: timingEvent.date!.slice(0, 10), state: timingEvent.e.state, factId: timingEvent.e.facts[0]?.factId ?? null }
        : null,
    },
    gaps: missing?.gaps ?? [],
    team: team.members.map((t) => ({ id: t.id, role: t.role, status: t.status, personLabel: t.personLabel, partnerLabel: t.partnerLabel })),
    warmPaths: internal ? (coverage?.warmPaths ?? []) : [],
  };
}

// ---------------------------------------------------------------------------

interface GoalRow { id: string; objective: string; target_date: string | null; status: GoalRecord["status"]; origin: GoalRecord["origin"]; decided_at: Date | null; supersedes_goal_id: string | null; created_at: Date }
interface PlanRow { id: string; goal_id: string; status: PlanRecord["status"]; created_at: Date }
interface RevisionRow {
  id: string; revision_no: number; kind: RevisionRecord["kind"]; decision: RevisionRecord["decision"];
  responds_to_revision_id: string | null; content: RevisionRecord["content"]; basis: RevisionRecord["basis"];
  basis_fingerprint: string; adjustments: RevisionRecord["adjustments"]; review_trigger: RevisionRecord["reviewTrigger"];
  reason: string | null; actor_type: RevisionRecord["actorType"]; created_at: Date;
}

/** The live goal, the live plan, and the plan's full revision history. */
export async function loadPlanRecords(db: PoolClient, caller: Caller, pursuitId: string): Promise<PlanRecords> {
  const goal = await db.query<GoalRow>(
    `select id, objective, to_char(target_date, 'YYYY-MM-DD') as target_date, status, origin, decided_at, supersedes_goal_id, created_at
       from pursuit_goals where pursuit_id = $1 and org_id = $2
      order by (status in ('PROPOSED','ACTIVE')) desc, created_at desc limit 1`,
    [pursuitId, caller.orgId],
  );
  const g = goal.rows[0];
  // The plan shown is the one implementing the CURRENT goal. After a goal is replaced, the old
  // goal's plan is superseded with its history intact — it is not this goal's plan and is never
  // shown as if it were (D-033).
  const plan = g
    ? await db.query<PlanRow>(
      `select id, goal_id, status, created_at
         from pursuit_plans where pursuit_id = $1 and org_id = $2 and goal_id = $3
        order by (status in ('PROPOSED','ACTIVE')) desc, created_at desc limit 1`,
      [pursuitId, caller.orgId, g.id],
    )
    : { rows: [] as PlanRow[] };
  const p = plan.rows[0];
  if (!p) return { goal: g ? goalRecord(g) : null, plan: null, revisions: [], stagedActions: {} };

  const revs = await db.query<RevisionRow>(
    `select id, revision_no, kind, decision, responds_to_revision_id, content, basis, basis_fingerprint,
            adjustments, review_trigger, reason, actor_type, created_at
       from pursuit_plan_revisions where plan_id = $1 and org_id = $2 order by revision_no asc`,
    [p.id, caller.orgId],
  );
  const revisions = revs.rows.map(revisionRecord);

  const stagedIds = revisions.map((r) => r.content.nextAction?.stagedMotionActionId).filter((x): x is string => !!x);
  const stagedActions: PlanRecords["stagedActions"] = {};
  if (stagedIds.length) {
    const staged = await db.query<{ id: string; due_at: Date; status: string }>(
      `select id, due_at, status from motion_actions where id = any($1) and org_id = $2`, [stagedIds, caller.orgId]);
    for (const s of staged.rows) stagedActions[s.id] = { dueAt: s.due_at.toISOString(), status: s.status };
  }

  return {
    goal: g ? goalRecord(g) : null,
    plan: { id: p.id, goalId: p.goal_id, status: p.status, createdAt: p.created_at.toISOString() },
    revisions,
    stagedActions,
  };
}

function goalRecord(g: GoalRow): GoalRecord {
  return {
    id: g.id, objective: g.objective, targetDate: g.target_date, status: g.status, origin: g.origin,
    decidedAt: g.decided_at?.toISOString() ?? null, supersedesGoalId: g.supersedes_goal_id, createdAt: g.created_at.toISOString(),
  };
}

function revisionRecord(r: RevisionRow): RevisionRecord {
  return {
    id: r.id, revisionNo: r.revision_no, kind: r.kind, decision: r.decision,
    respondsToRevisionId: r.responds_to_revision_id, content: r.content, basis: r.basis,
    fingerprint: r.basis_fingerprint, adjustments: r.adjustments, reviewTrigger: r.review_trigger,
    reason: r.reason, actorType: r.actor_type, createdAt: r.created_at.toISOString(),
  };
}

/**
 * Material ledger events recorded after a point in time — what has happened to the
 * pursuit since the plan in force was decided. The plan's own bookkeeping (its
 * decisions, its review triggers, the actions it queued) is excluded: a plan is not
 * made stale by the act of approving it.
 */
export async function loadChangesSince(db: PoolClient, caller: Caller, pursuitId: string, since: string): Promise<PlanLedgerChange[]> {
  const { rows } = await db.query<{ id: string; change_type: string; reason: string | null; occurred_at: Date }>(
    `select id, change_type, reason, occurred_at
       from change_ledger
      where pursuit_id = $1 and org_id = $2 and recorded_at > $3
        and materiality in ('MEDIUM','HIGH','CRITICAL')
        and change_type not in ('PLAN_DECIDED','PLAN_REVIEW_REQUIRED')
        and entity_type not in ('pursuit_plan','motion_action')
      order by occurred_at desc limit 10`,
    [pursuitId, caller.orgId, since],
  );
  return rows.map((r) => ({ id: r.id, changeType: r.change_type, reason: r.reason, occurredAt: r.occurred_at.toISOString() }));
}

/** The plan surface's inputs and its view — one read, shared by Pursuit Detail, Today and Queue. */
export interface PursuitPlanContext {
  state: PlanState;
  records: PlanRecords;
  /** The recommendation as the pursuit stands now — computed, never persisted. */
  live: PlanRecommendation;
  changesSinceDecision: PlanLedgerChange[];
  view: PursuitPlanView;
}

/**
 * Everything the Pursuit plan surface is composed from, plus the view itself. Today's pursuit
 * attention (Slice 2B) reads the SAME context, so "this plan needs review" can never mean one
 * thing on Pursuit Detail and another on Today. Read-only.
 */
export async function loadPursuitPlanContext(db: PoolClient, caller: Caller, pursuitId: string, now: Date = new Date()): Promise<PursuitPlanContext | null> {
  const state = await loadPlanState(db, caller, pursuitId, now);
  if (!state) return null;
  const records = await loadPlanRecords(db, caller, pursuitId);
  const live = recommendPursuitPlan(state, now);
  const { inForce } = resolvePlanStanding(records.revisions);
  const changesSinceDecision = inForce ? await loadChangesSince(db, caller, pursuitId, inForce.createdAt) : [];
  const view = composePursuitPlanView({ pursuitId, caller, state, records, live, changesSinceDecision, now });
  return { state, records, live, changesSinceDecision, view };
}

/**
 * Everything the Pursuit plan surface renders, in one call. Computes the live
 * recommendation to judge staleness — and persists nothing: reading a page never
 * writes a recommendation.
 */
export async function loadPursuitPlanView(db: PoolClient, caller: Caller, pursuitId: string, now: Date = new Date()): Promise<PursuitPlanView | null> {
  return (await loadPursuitPlanContext(db, caller, pursuitId, now))?.view ?? null;
}
