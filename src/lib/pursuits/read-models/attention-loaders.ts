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
import { resolvePlanStanding } from "./pursuit-plan";
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
    const stagedId = inForce?.content.nextAction?.stagedMotionActionId ?? null;
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
      liveFingerprint: ctx.live.basis.fingerprint,
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
  const ids = [...new Set(queue.items.map((i) => i.pursuitId).filter((x): x is string => !!x))];
  const owned = ids.length
    ? (await db.query<{ id: string }>(`select id from pursuits where org_id = $1 and id = any($2::uuid[])`, [caller.orgId, ids])).rows.map((r) => r.id)
    : [];
  const tenant = new Set([...owned, ...attention.map((a) => a.pursuitId)]);
  const composed = composeAttentionQueue({ items: queue.items, attention, tenantPursuitIds: tenant, now, limit: opts.limit });
  // The badge answers from what the caller owns, never from an item another org contributed.
  const synthetic = composed.all.some((i) => i.synthetic) || await orgHasSynthetic(db, caller.orgId);
  return { generatedAt: queue.generatedAt, items: composed.items, counts: composed.counts, total: composed.total, demoBanner: synthetic ? DEMO_BANNER : null };
}

/**
 * Plan lineage for queued actions, keyed by `motion_actions.id`. Only the actions a person put
 * in the Queue by approving a pursuit plan have one — the join is the existing
 * `content.nextAction.stagedMotionActionId` a DECISION revision carries (Slice 2A). No action is
 * copied, and no action without a plan is annotated.
 */
export async function loadQueuePlanLineage(db: PoolClient, caller: Caller, motionActionIds: string[], now: Date = new Date()): Promise<Record<string, QueueLineage>> {
  if (!motionActionIds.length) return {};
  const { rows } = await db.query<{ id: string; pursuit_id: string; plan_id: string; decision: "APPROVED" | "ADJUSTED"; actor_type: string; created_at: Date; staged: string }>(
    `select r.id, r.pursuit_id, r.plan_id, r.decision, r.actor_type, r.created_at, ma.id::text as staged
       from pursuit_plan_revisions r
       join pursuit_plans pp on pp.id = r.plan_id and pp.org_id = r.org_id
       join pursuits pu on pu.id = r.pursuit_id and pu.org_id = r.org_id
       join motion_actions ma on ma.id::text = r.content->'nextAction'->>'stagedMotionActionId' and ma.org_id = r.org_id
      where r.org_id = $1 and r.kind = 'DECISION' and r.decision in ('APPROVED','ADJUSTED')
        and ma.id::text = any($2::text[])
      order by r.created_at asc, r.id asc`,
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
