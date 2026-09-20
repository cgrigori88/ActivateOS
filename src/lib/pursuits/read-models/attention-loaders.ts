import type { PoolClient } from "pg";
import type { Caller } from "./helpers";
import { loadPursuitPlanContext } from "./plan-loaders";
import {
  composeAttentionQueue,
  derivePursuitAttention,
  queueLineageFor,
  type PursuitAttention,
  type QueueLineage,
} from "./pursuit-attention";
import { freshBasisFor, resolvePlanStanding, selectDisplayPlanAction } from "./pursuit-plan";
import { DEMO_BANNER, orgHasSynthetic } from "./today";
import type { TodayQueueView } from "./types";

/**
 * Loaders for Pursuit Attention (vNext Slice 2B).
 *
 * THIN, like every vNext loader: find the caller's pursuits whose plan is live, read each one's
 * Slice 2A plan context — the SAME read Pursuit Detail makes, so the two surfaces cannot
 * disagree about whether a plan needs review — and hand it to the pure `pursuit-attention.ts`.
 *
 * TENANT SCOPING IS EXPLICIT. Every query carries `org_id = caller.orgId`; RLS is correct and
 * inert on this path until task #67, so the application predicate is the control that runs.
 *
 * READ-ONLY. No INSERT, no UPDATE, no DELETE — opening Today or Queue records nothing: no
 * ledger event, no recommendation, no plan change, no queue change, no owner, no status. Proven
 * by the Slice 2B harness, which runs these inside READ ONLY transactions.
 */

/** A scale guard: Today never derives attention for more live plans than this in one read. */
export const ATTENTION_PURSUIT_CAP = 50;

export interface AttentionLoadOpts {
  /** Ecosystem scope — null/undefined = no narrowing. Never widens the caller's tenant. */
  companyIds?: string[] | null;
  now?: Date;
}

/** Attention for every pursuit in the caller's organization whose plan is live. */
export async function loadPursuitAttention(db: PoolClient, caller: Caller, opts: AttentionLoadOpts = {}): Promise<PursuitAttention[]> {
  const now = opts.now ?? new Date();
  const scoped = opts.companyIds != null;
  const { rows } = await db.query<{ id: string; account_id: string; account_label: string; priority: string | null; synthetic: boolean }>(
    `select pu.id, pu.account_id, c.legal_name as account_label, pu.current_priority_score as priority,
            (pu.data_environment <> 'PRODUCTION') as synthetic
       from pursuit_plans pp
       join pursuits pu on pu.id = pp.pursuit_id and pu.org_id = pp.org_id
       join companies c on c.id = pu.account_id
      where pp.org_id = $1 and pp.status in ('PROPOSED','ACTIVE')
        and pu.status not in ('WON','LOST','DISQUALIFIED')
        and ($3::boolean is false or pu.account_id = any($2::uuid[]))
      order by pu.id
      limit ${ATTENTION_PURSUIT_CAP}`,
    [caller.orgId, opts.companyIds ?? [], scoped],
  );

  const out: PursuitAttention[] = [];
  // Sequential on purpose: one pg client runs one query at a time.
  for (const r of rows) {
    const ctx = await loadPursuitPlanContext(db, caller, r.id, now);
    if (!ctx) continue;
    const { inForce, pending } = resolvePlanStanding(ctx.records.revisions);
    // The queue row for the action a narrow surface would show — resolved through the canonical
    // selector, never by re-deriving "current" here.
    const displayed = inForce
      ? selectDisplayPlanAction(inForce.content.actions, inForce.basis.inputs.milestones,
        Object.fromEntries(Object.entries(ctx.records.stagedByActionKey).map(([k, v]) => [k, { status: v.status }])))
      : null;
    const lineage = displayed ? ctx.records.stagedByActionKey[displayed.action.key] : undefined;
    const stagedId = lineage?.motionActionId ?? null;
    const held = stagedId ? ctx.records.stagedActions[stagedId] : undefined;
    const firstChangeAt = ctx.changesSinceDecision.reduce<string | null>((m, c) => (m == null || c.occurredAt < m ? c.occurredAt : m), null);
    const a = derivePursuitAttention({
      pursuitId: r.id,
      companyId: r.account_id,
      accountLabel: r.account_label,
      priorityScore: r.priority == null ? null : Number(r.priority),
      synthetic: r.synthetic,
      view: ctx.view,
      inForce,
      pending,
      // The attention KEY for a review, so a new drift is a new attention. Dispatched on the
      // in-force plan's own generation: the key must move when THAT plan's basis moves, not when
      // this deployment happens to switch which algorithm it generates with.
      liveFingerprint: inForce ? freshBasisFor(inForce.basis, ctx.live).fingerprint : ctx.live.basis.fingerprint,
      stagedByActionKey: Object.fromEntries(Object.entries(ctx.records.stagedByActionKey).map(([k, v]) => [k, { status: v.status }])),
      team: ctx.state.team,
      staged: stagedId && held ? { id: stagedId, dueAt: held.dueAt, status: held.status } : null,
      firstChangeAt,
    }, caller, now);
    if (a) out.push(a);
  }
  return out;
}

/**
 * Today's decision queue, composed with pursuit attention: one card per pursuit (see
 * `composeAttentionQueue`). Takes the UNCUT existing queue and applies the top-N cut itself, after
 * collapsing, so "View all N" counts cards, not the rows folded beneath them.
 */
export async function composeTodayAttention(
  db: PoolClient, caller: Caller, queue: TodayQueueView, opts: AttentionLoadOpts & { limit?: number } = {},
): Promise<TodayQueueView> {
  const now = opts.now ?? new Date();
  const attention = await loadPursuitAttention(db, caller, { companyIds: opts.companyIds, now });
  const ids = [...new Set([...queue.items.map((i) => i.pursuitId), ...attention.map((a) => a.pursuitId)].filter((x): x is string => !!x))];
  // The caller's own pursuits among them — the tenant set, and each one's name for telling two
  // pursuits on one account apart. Read with `org_id = caller.orgId`: a foreign pursuit is absent.
  const owned = ids.length
    ? (await db.query<{ id: string; business_problem: string | null }>(
      `select id, business_problem from pursuits where org_id = $1 and id = any($2::uuid[])`, [caller.orgId, ids])).rows
    : [];
  const tenant = new Set(owned.map((r) => r.id));
  const pursuitLabels = new Map(owned.filter((r) => r.business_problem).map((r) => [r.id, r.business_problem!]));
  const composed = composeAttentionQueue({ items: queue.items, attention, tenantPursuitIds: tenant, pursuitLabels, now, limit: opts.limit });
  // The badge answers from what the caller owns, never from an item another org contributed.
  const synthetic = composed.all.some((i) => i.synthetic) || await orgHasSynthetic(db, caller.orgId);
  return {
    generatedAt: queue.generatedAt, items: composed.items, counts: composed.counts,
    total: composed.total, decisionCount: composed.decisionCount, demoBanner: synthetic ? DEMO_BANNER : null,
  };
}

/**
 * Plan lineage for queued actions, keyed by `motion_actions.id`. Only the actions a person put
 * in the Queue by approving a pursuit plan have one — the join is the existing
 * `content.nextAction.stagedMotionActionId` a DECISION revision carries (Slice 2A). No action is
 * copied, and no action without a plan is annotated.
 */
export async function loadQueuePlanLineage(db: PoolClient, caller: Caller, motionActionIds: string[], now: Date = new Date()): Promise<Record<string, QueueLineage>> {
  if (!motionActionIds.length) return {};
  // TWO EXPLICITLY VERSIONED ROUTES, AND NO THIRD.
  //
  // v2+ lineage is a STRUCTURAL column join that reads no plan content at all — it is therefore
  // version-independent by construction, and a future schema staging through the same columns is
  // found on structure rather than on interpretation.
  //
  // v1 lineage lives inside the immutable content, and that branch names `schema = 1` outright. An
  // unknown schema matches NEITHER branch: it yields no lineage, which is absence, never a guess.
  // A shape test such as "does it have an actions field" would be exactly the silent
  // misinterpretation this arrangement exists to prevent.
  const { rows } = await db.query<{ id: string; pursuit_id: string; plan_id: string; decision: "APPROVED" | "ADJUSTED"; actor_type: string; created_at: Date; staged: string }>(
    `select r.id, r.pursuit_id, r.plan_id, r.decision, r.actor_type, r.created_at, ma.id::text as staged
       from motion_actions ma
       join pursuit_plan_revisions r on r.org_id = ma.org_id and r.id = ma.plan_revision_id
       join pursuit_plans pp on pp.id = r.plan_id and pp.org_id = r.org_id
       join pursuits pu on pu.id = r.pursuit_id and pu.org_id = r.org_id
      where ma.org_id = $1 and ma.id::text = any($2::text[])
        and ma.plan_revision_id is not null and ma.plan_action_key is not null
        and r.kind = 'DECISION' and r.decision in ('APPROVED','ADJUSTED')
     union all
     select r.id, r.pursuit_id, r.plan_id, r.decision, r.actor_type, r.created_at, ma.id::text as staged
       from pursuit_plan_revisions r
       join pursuit_plans pp on pp.id = r.plan_id and pp.org_id = r.org_id
       join pursuits pu on pu.id = r.pursuit_id and pu.org_id = r.org_id
       join motion_actions ma on ma.id::text = r.content->'nextAction'->>'stagedMotionActionId' and ma.org_id = r.org_id
      where r.org_id = $1 and r.kind = 'DECISION' and r.decision in ('APPROVED','ADJUSTED')
        and (r.content->>'schema')::int = 1
        and ma.plan_revision_id is null
        and ma.id::text = any($2::text[])
      order by created_at asc, id asc`,
    [caller.orgId, motionActionIds],
  );

  const standing = new Map<string, { livePlanId: string | null; inForceId: string | null; state: ReturnType<typeof stateOf> } | null>();
  const out: Record<string, QueueLineage> = {};
  for (const r of rows) {
    if (!standing.has(r.pursuit_id)) {
      const ctx = await loadPursuitPlanContext(db, caller, r.pursuit_id, now);
      standing.set(r.pursuit_id, ctx
        ? { livePlanId: ctx.records.plan?.id ?? null, inForceId: resolvePlanStanding(ctx.records.revisions).inForce?.id ?? null, state: stateOf(ctx.view) }
        : null);
    }
    const s = standing.get(r.pursuit_id);
    if (!s) continue;
    out[r.staged] = queueLineageFor({
      motionActionId: r.staged,
      pursuitId: r.pursuit_id,
      planId: r.plan_id,
      decisionRevision: { id: r.id, decision: r.decision, actorType: r.actor_type, createdAt: r.created_at.toISOString() },
      livePlanId: s.livePlanId,
      inForceRevisionId: s.inForceId,
      planState: s.state,
      now,
    });
  }
  return out;
}

function stateOf(view: { status: { state: import("./pursuit-plan").PlanDisplayState } }) {
  return view.status.state;
}
