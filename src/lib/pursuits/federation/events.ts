import type { PoolClient } from "pg";
import { recomputeRoute } from "../../routing/route-model";
import { recordChange, type ChangeType } from "../ledger";
import { priorityDeltaMateriality, isSurfaced, type Materiality } from "../materiality";
import type { DataEnvironment } from "../lineage";
import { reportEvent } from "../../obs/reporter";

/**
 * Event-driven recompute engine (Workstream E3-E). The reactive half the mapping
 * found missing: a material event deterministically ENQUEUES the recomputations it
 * invalidates (R11 deterministic dependency map), which run at the event's as-of —
 * never now() (R12) — and produce new append-only snapshots (R13, history is never
 * rewritten). Immaterial recomputes are computed but SUPPRESSED, so a 68→69 nudge
 * never becomes a Today item (R22). A correlation chain past the guard depth is
 * refused (R23), so an event storm cannot loop. The engine wires the REAL route
 * recompute; the full dimension scorer is out of scope here (R40) — E3-E proves the
 * dispatch / as-of / materiality / loop-guard machinery, not a new scoring model.
 */

export type RecomputeTarget = "SCORE" | "ROUTE" | "READINESS" | "TODAY" | "WHY_NOW";

/**
 * The deterministic dependency map (R11): a change type declares exactly which
 * recompute targets it invalidates. Silence is meaningful — an unlisted change type
 * enqueues nothing. TODAY is downstream of anything that can change the decision
 * queue, and is deliberately last so its inputs recompute first.
 */
export const DEPENDENCY_MAP: Record<string, RecomputeTarget[]> = {
  // Facts move belief → score, why-now, and (through score) the route.
  FACT_ACCEPTED: ["SCORE", "WHY_NOW", "ROUTE", "TODAY"],
  FACT_PROMOTED: ["SCORE", "WHY_NOW", "ROUTE", "TODAY"],
  FACT_SUPERSEDED: ["SCORE", "WHY_NOW", "ROUTE", "TODAY"],
  CONTRADICTION_DETECTED: ["SCORE", "WHY_NOW", "TODAY"],
  WHY_NOW_CHANGED: ["TODAY"],
  // Contributions are federated belief — same downstream as facts.
  CONTRIBUTION_ADDED: ["SCORE", "ROUTE", "READINESS", "TODAY"],
  CONTRIBUTION_REVOKED: ["SCORE", "ROUTE", "READINESS", "TODAY"],
  // Participation / consent changes the set of eligible routes and the team readiness.
  PARTICIPANT_JOINED: ["ROUTE", "READINESS", "TODAY"],
  PARTICIPANT_LEFT: ["ROUTE", "READINESS", "TODAY"],
  PARTICIPANT_REVOKED: ["ROUTE", "READINESS", "TODAY"],
  ACCESS_GRANTED: ["ROUTE", "READINESS", "TODAY"],
  ACCESS_REVOKED: ["ROUTE", "READINESS", "TODAY"],
  // Route + team execution feed readiness and the queue.
  ROUTE_SELECTED: ["READINESS", "TODAY"],
  PARTNER_SELECTED: ["READINESS", "TODAY"],
  PARTNER_DECLINED: ["ROUTE", "READINESS", "TODAY"],
  TEAM_MEMBER_ASSIGNED: ["READINESS", "TODAY"],
  TEAM_MEMBER_ACCEPTED: ["READINESS", "TODAY"],
  // Outreach / opportunity signals move readiness and the queue.
  REPLY_RECEIVED: ["READINESS", "TODAY"],
  MEETING_BOOKED: ["READINESS", "TODAY"],
  OPPORTUNITY_CREATED: ["READINESS", "TODAY"],
  STAGE_CHANGED: ["READINESS", "TODAY"],
  // Transaction adjacency signal → route.
  TRANSACTION_SIGNAL_INGESTED: ["ROUTE", "TODAY"],
};

/** Targets a change type invalidates (R11). Empty ⇒ inert (no recompute). */
export function targetsFor(changeType: string): RecomputeTarget[] {
  return DEPENDENCY_MAP[changeType] ?? [];
}

const MAX_CHAIN = 25; // R23 loop guard — a correlation chain past this depth is refused.

export interface EnqueueInput {
  orgId: string;
  pursuitId: string;
  changeType: string;
  /** The TRIGGERING EVENT's occurred_at (business time). Propagated as the recompute as-of (R12). */
  asOf: Date;
  requestedByEventId?: string | null;
  causationId?: string | null;
  correlationId?: string | null;
  dataEnvironment?: DataEnvironment;
}

export interface EnqueueResult { enqueued: RecomputeTarget[]; suppressed: boolean; reason?: string }

/**
 * Enqueue the recomputes a change invalidates. Deterministic (R11), as-of-carrying
 * (R12), idempotent (a PENDING request for the same pursuit+target+as_of+correlation
 * is not duplicated), and loop-guarded (R23): once a correlation chain reaches the
 * depth cap, further enqueues land a single SUPPRESSED marker instead of fanning out.
 */
export async function enqueueRecompute(db: PoolClient, i: EnqueueInput): Promise<EnqueueResult> {
  const targets = targetsFor(i.changeType);
  if (!targets.length) return { enqueued: [], suppressed: false, reason: "no dependency (inert change type)" };

  // Loop guard (R23): count prior requests on this correlation chain.
  if (i.correlationId) {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text n from recompute_requests where correlation_id = $1`, [i.correlationId]);
    if (Number(rows[0].n) >= MAX_CHAIN) {
      await db.query(
        `insert into recompute_requests (org_id, pursuit_id, change_type, target, as_of, requested_by_event_id,
           causation_id, correlation_id, status, reason, data_environment)
         values ($1,$2,$3,'TODAY',$4,$5,$6,$7,'SUPPRESSED','loop guard: recompute chain too deep',$8)`,
        [i.orgId, i.pursuitId, i.changeType, i.asOf, i.requestedByEventId ?? null, i.causationId ?? null,
         i.correlationId, i.dataEnvironment ?? "PRODUCTION"]);
      return { enqueued: [], suppressed: true, reason: "loop guard" };
    }
  }

  const enqueued: RecomputeTarget[] = [];
  for (const target of targets) {
    // Idempotency: don't duplicate a PENDING request for the same coordinates.
    const dup = await db.query<{ id: string }>(
      `select id from recompute_requests
        where pursuit_id = $1 and target = $2 and as_of = $3 and status = 'PENDING'
          and coalesce(correlation_id::text, '') = coalesce($4::text, '')`,
      [i.pursuitId, target, i.asOf, i.correlationId ?? null]);
    if (dup.rows[0]) continue;
    await db.query(
      `insert into recompute_requests (org_id, pursuit_id, change_type, target, as_of, requested_by_event_id,
         causation_id, correlation_id, status, data_environment)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9)`,
      [i.orgId, i.pursuitId, i.changeType, target, i.asOf, i.requestedByEventId ?? null, i.causationId ?? null,
       i.correlationId ?? null, i.dataEnvironment ?? "PRODUCTION"]);
    enqueued.push(target);
  }
  return { enqueued, suppressed: false };
}

/** The change type a material recompute of a target emits downstream (append-only). */
const EMIT_FOR_TARGET: Partial<Record<RecomputeTarget, ChangeType>> = {
  ROUTE: "ROUTE_RECOMMENDATION_CHANGED",
  READINESS: "READINESS_CHANGED",
  SCORE: "SCORE_CHANGED",
  WHY_NOW: "WHY_NOW_CHANGED",
};

interface Scored { before?: unknown; after?: unknown }
function numeric(v: unknown): number | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["score", "priority", "priority_score", "readiness"]) {
      if (typeof o[k] === "number") return o[k] as number;
    }
  }
  return typeof v === "number" ? v : null;
}

/**
 * Classify the materiality of a completed recompute (R22). ROUTE materiality comes
 * from whether the recommendation actually changed. For score-like targets we read
 * the TRIGGERING EVENT's before/after and apply the shared priority-delta policy, so
 * a 68→69 nudge is LOW (suppressed) while a band-crossing jump surfaces.
 */
function classify(target: RecomputeTarget, trigger: Scored | null, routeChanged: boolean): Materiality {
  if (target === "ROUTE") return routeChanged ? "HIGH" : "LOW";
  const before = numeric(trigger?.before);
  const after = numeric(trigger?.after);
  if (before !== null && after !== null) return priorityDeltaMateriality(after - before);
  // No numeric signal to judge by — treat as MEDIUM (real, not surfaced) rather than inventing a jump.
  return "MEDIUM";
}

export interface DrainResult { processed: number; done: number; suppressed: number; failed: number; surfaced: number }

/**
 * Drain the recompute queue. For each PENDING request: run the target's recompute AT
 * THE REQUEST'S AS-OF (R12), classify materiality (R22), and either mark DONE +
 * append a downstream change event (only when material — that event carries the
 * correlation id so the loop guard bounds any cascade, R23) or mark SUPPRESSED when
 * immaterial so it never reaches Today. Append-only: recompute writes new snapshots,
 * never mutating prior ones (R13). Idempotent per row via `for update skip locked`.
 */
const RECOMPUTE_LEASE_MS = 5 * 60 * 1000; // a RUNNING row idle past this is presumed abandoned

export async function drainRecomputeQueue(
  db: PoolClient, opts: { limit?: number; emitDownstream?: boolean; now?: Date } = {},
): Promise<DrainResult> {
  const emitDownstream = opts.emitDownstream ?? true;
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - RECOMPUTE_LEASE_MS);
  // Recover work safely: pick PENDING rows AND any RUNNING row whose lease has expired
  // (a worker that died mid-drain). A fresh RUNNING (recent locked_at) is left alone.
  const { rows } = await db.query<{
    id: string; org_id: string; pursuit_id: string; change_type: string; target: RecomputeTarget;
    as_of: Date; correlation_id: string | null; requested_by_event_id: string | null; data_environment: string;
    attempts: number; max_attempts: number;
  }>(
    `select id, org_id, pursuit_id, change_type, target, as_of, correlation_id, requested_by_event_id,
            data_environment, attempts, max_attempts
       from recompute_requests
      where status = 'PENDING'
         or (status = 'RUNNING' and (locked_at is null or locked_at < $2))
      order by created_at limit $1 for update skip locked`,
    [opts.limit ?? 100, staleBefore]);

  const res: DrainResult = { processed: 0, done: 0, suppressed: 0, failed: 0, surfaced: 0 };
  for (const r of rows) {
    res.processed++;
    // Poison guard: a request that has already burned its attempts fails visibly rather
    // than looping forever.
    if (r.attempts >= r.max_attempts) {
      await db.query(`update recompute_requests set status='FAILED', reason='max attempts exceeded', updated_at=now() where id=$1`, [r.id]);
      res.failed++; continue;
    }
    await db.query(`update recompute_requests set status='RUNNING', attempts=attempts+1, locked_at=now(), updated_at=now() where id=$1`, [r.id]);
    try {
      // Load the triggering event's before/after for score-like materiality.
      let trigger: Scored | null = null;
      if (r.requested_by_event_id) {
        const ev = await db.query<{ before_state: unknown; after_state: unknown }>(
          `select before_state, after_state from change_ledger where id = $1`, [r.requested_by_event_id]);
        if (ev.rows[0]) trigger = { before: ev.rows[0].before_state, after: ev.rows[0].after_state };
      }

      let routeChanged = false;
      if (r.target === "ROUTE") {
        // The REAL route recompute, at the event's as-of (R12). New snapshot appended (R13).
        const rr = await recomputeRoute(db, r.pursuit_id, new Date(r.as_of), r.data_environment as DataEnvironment);
        routeChanged = rr.changed;
      }
      // SCORE / READINESS / WHY_NOW / TODAY: the reactive dispatch + as-of + materiality is what
      // E3-E proves; the production dimension scorer is out of scope (R40). No score is fabricated.

      const materiality = classify(r.target, trigger, routeChanged);
      if (isSurfaced(materiality)) {
        const emit = EMIT_FOR_TARGET[r.target];
        if (emitDownstream && emit) {
          await recordChange(db, {
            orgId: r.org_id, pursuitId: r.pursuit_id, entityType: "pursuit", entityId: r.pursuit_id,
            changeType: emit, materiality, reason: `recompute(${r.target}) after ${r.change_type}`,
            actorType: "WORKER", triggerType: "EVENT_TRIGGERED", triggerId: r.requested_by_event_id,
            dataEnvironment: r.data_environment as DataEnvironment, occurredAt: new Date(r.as_of),
          });
        }
        await db.query(`update recompute_requests set status='DONE', reason=$2, updated_at=now() where id=$1`,
          [r.id, `material:${materiality}`]);
        res.done++; res.surfaced++;
      } else {
        await db.query(`update recompute_requests set status='SUPPRESSED', reason=$2, updated_at=now() where id=$1`,
          [r.id, `immaterial:${materiality}`]);
        res.suppressed++;
      }
    } catch (e) {
      await db.query(`update recompute_requests set status='FAILED', reason=$2, updated_at=now() where id=$1`,
        [r.id, (e as Error).message.slice(0, 240)]);
      // OR-3: a failed recompute is operator-actionable. Ids + target only — no payload.
      reportEvent({ kind: "recompute", severity: "error", message: `recompute ${r.target} failed for ${r.change_type}`,
        correlationId: r.correlation_id, orgId: r.org_id, pursuitId: r.pursuit_id, recomputeRequestId: r.id, retryCount: r.attempts + 1, environment: r.data_environment });
      res.failed++;
    }
  }
  return res;
}

/** Convenience: record a change AND enqueue its recomputes in one call (the producer path). */
export async function recordAndEnqueue(
  db: PoolClient,
  event: Parameters<typeof recordChange>[1],
  opts: { correlationId?: string | null } = {},
): Promise<{ eventId: string; enqueue: EnqueueResult }> {
  const eventId = await recordChange(db, event);
  const asOf = event.occurredAt ?? new Date();
  const enqueue = await enqueueRecompute(db, {
    orgId: event.orgId, pursuitId: event.pursuitId ?? "", changeType: event.changeType,
    asOf, requestedByEventId: eventId, causationId: eventId,
    correlationId: opts.correlationId ?? null, dataEnvironment: event.dataEnvironment,
  });
  return { eventId, enqueue };
}
