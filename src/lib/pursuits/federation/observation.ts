import type { PoolClient } from "pg";

/**
 * P8-0 — THE EXECUTION OBSERVATION SPINE.
 *
 * Internal instrumentation only. Nothing here is authority, nothing here is disclosure, and nothing
 * here is reachable from a request payload.
 *
 * ── WHY A MODULE-PRIVATE SYMBOL ─────────────────────────────────────────────────────────────────
 *
 * The canonical invocation id and the staged effect set travel with a dispatch, but a caller must
 * have ZERO authority over either: an MCP argument named `invocationId` or `effects` must not be
 * able to forge an identity or inject an effect that never happened. `OBSERVATION` is never
 * exported, so a plain object spread of caller-supplied context cannot carry one — the same device
 * P7 Slice 14 used to make a sealed cohort unforgeable.
 */
const OBSERVATION = Symbol("p8.observation");

/** The bounded kinds the v1 effect contracts can produce. Mirrors 0117's CHECK exactly. */
export type EffectKind =
  | "campaign_touch" | "pursuit_plan_revision" | "pursuit_goal"
  | "pursuit_plan" | "motion_action" | "pursuit_team_member";

/** v1 has exactly one relation, and that is proven rather than chosen — see the contract §7. */
export type EffectRelation = "CREATED";

export interface StagedEffect { relation: EffectRelation; kind: EffectKind; id: string }

/**
 * The staged set for one dispatch. It is APPLICATION MEMORY, which is the whole reason
 * `discardEffects` exists: a PostgreSQL savepoint rollback does not rewind JavaScript.
 */
export interface EffectSink { effects: StagedEffect[] }

interface Observation { invocationId: string; sink: EffectSink }

/** THE EXACT v1 EFFECT-OBSERVED REGISTRY. Mirrors 0117's CHECK; the database refuses any drift. */
export const P8_V1_REGISTRY: ReadonlyArray<{ skillId: string; version: number }> = [
  { skillId: "draft_campaign_touch", version: 1 },
  { skillId: "recommend_pursuit_plan", version: 1 },
  { skillId: "decide_pursuit_plan", version: 1 },
  { skillId: "assemble_pursuit_team", version: 1 },
];

export const P8_OBSERVATION_CONTRACT_V1 = 1;

/** Is this exact capability/version covered by the v1 observation contract? */
export function coveredByV1(skillId: string, version: number): boolean {
  return P8_V1_REGISTRY.some((r) => r.skillId === skillId && r.version === version);
}

/**
 * Attach a fresh observation to a COPY of the caller's context. The caller's own object is never
 * mutated, so a dispatch cannot leak state back to whoever supplied the context.
 */
export function withObservation<T extends object>(ctx: T, invocationId: string): T {
  return { ...ctx, [OBSERVATION]: { invocationId, sink: { effects: [] } } as Observation } as T;
}

function observationOf(ctx: object | undefined): Observation | undefined {
  return ctx ? (ctx as Record<symbol, Observation>)[OBSERVATION] : undefined;
}

/** The server-allocated canonical invocation id for this dispatch, for handler-level ledger writes. */
export function observedInvocationId(ctx: object | undefined): string | null {
  return observationOf(ctx)?.invocationId ?? null;
}

/** The sink, for handlers that must pass it deeper than their own frame (plan-store, team). */
export function effectSinkOf(ctx: object | undefined): EffectSink | null {
  return observationOf(ctx)?.sink ?? null;
}

/**
 * Stage one durable business object this dispatch actually created.
 *
 * CALLED AT THE CREATION BRANCH, never afterwards from a return value that cannot distinguish
 * "created now" from "already existed", and never by parsing a handler's public result.
 */
export function noteEffect(sink: EffectSink | null | undefined, kind: EffectKind, id: string | null | undefined): void {
  if (!sink || !id) return;
  if (sink.effects.some((e) => e.kind === kind && e.id === id)) return;   // idempotent within a dispatch
  sink.effects.push({ relation: "CREATED", kind, id });
}

/** Convenience for handlers that hold the context rather than the sink. */
export function noteEffectOnCtx(ctx: object | undefined, kind: EffectKind, id: string | null | undefined): void {
  noteEffect(effectSinkOf(ctx), kind, id);
}

/**
 * THE FAILURE RULE. A handler may stage effects and then throw; the savepoint rolls the database
 * back but leaves those entries sitting in memory. A FAILED or REJECTED invocation that inherited
 * them would durably claim effects that never persisted — the precise lie this slice exists to
 * prevent. Every non-EXECUTED terminal path calls this first.
 */
export function discardEffects(ctx: object | undefined): void {
  const obs = observationOf(ctx);
  if (obs) obs.sink.effects = [];
}

export function drainEffects(ctx: object | undefined): StagedEffect[] {
  const obs = observationOf(ctx);
  if (!obs) return [];
  const out = obs.sink.effects.slice();
  obs.sink.effects = [];
  return out;
}

/**
 * Persist the staged effects for a terminal invocation, in the SAME transaction as its row.
 *
 * Ordering matters and is not incidental: the invocation row is inserted first, so the composite
 * FK resolves. If this INSERT fails the exception propagates out of `dispatchSkill`, the caller's
 * transaction aborts, and neither the business mutation nor the invocation row commits — so no
 * durable state can claim v1 completeness while its required observations are missing.
 */
export async function persistEffects(
  db: PoolClient, orgId: string, invocationId: string, effects: StagedEffect[],
): Promise<void> {
  for (const e of effects) {
    await db.query(
      `insert into invocation_effect_refs (org_id, invocation_id, effect_relation, effect_kind, effect_id)
       values ($1,$2,$3,$4,$5)
       on conflict (org_id, invocation_id, effect_kind, effect_id) do nothing`,
      [orgId, invocationId, e.relation, e.kind, e.id]);
  }
}
