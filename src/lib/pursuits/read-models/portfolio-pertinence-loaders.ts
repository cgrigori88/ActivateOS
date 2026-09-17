import type { PoolClient } from "pg";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import type { Stage } from "@/lib/opportunities/lifecycle";
import type { Caller } from "./helpers";
import {
  MOMENTUM_EXCLUDED_CHANGE_TYPES,
  type MomentumEvent,
  type PortfolioCandidate,
  type ValueBasis,
} from "./portfolio-pertinence";
import type { DisclosureClass } from "./types";

/**
 * Canonical inputs for Portfolio Pertinence (P2).
 *
 * Every query is explicitly `org_id`-scoped ON TOP OF RLS (the house rule), and the caller's
 * disclosure class travels with each candidate so the ranking module can filter BEFORE it builds a
 * comparison set. Nothing here is written: this module reads canonical state and nothing else.
 *
 * ONE CLOCK. `asOf` is supplied by the caller and captured once per computation; no function below
 * calls `now()` for a ranking input, so two pursuits can never be scored against two instants.
 * `now()` appears only in the DB predicate for "open" opportunities, which is a set definition
 * rather than a scored value.
 */

export interface LoadOptions {
  /** Restrict the comparison set. Narrowing recomputes within the narrowed set — that is intended. */
  pursuitIds?: string[];
}

export async function loadPortfolioCandidates(
  db: PoolClient, caller: Caller, asOf: Date, opts: LoadOptions = {},
): Promise<PortfolioCandidate[]> {
  const scopeIds = opts.pursuitIds ?? null;

  // ── The pursuits in play. Terminal and merged pursuits are excluded, exactly as portfolio.ts does.
  const { rows: pursuits } = await db.query<{
    id: string; account_label: string; thesis: string | null; use_case: string | null; data_environment: string;
  }>(
    `select pu.id, c.legal_name account_label, pu.business_problem thesis, pu.use_case, pu.data_environment
       from pursuits pu
       join companies c on c.id = pu.account_id
      where pu.org_id = $1 and pu.status not in ('WON','LOST','DISQUALIFIED') and pu.merged_into_pursuit_id is null
        and ($2::uuid[] is null or pu.id = any($2::uuid[]))
      order by pu.id`, [caller.orgId, scopeIds]);
  if (pursuits.length === 0) return [];
  const ids = pursuits.map((p) => p.id);

  // ── PIPELINE magnitude: stage-weighted OPEN opportunity value, using the ORG'S OWN editable stage
  //    curve with per-partner overrides — the same source `upsertCanonicalPipelineSnapshot` and
  //    /pipeline use. Never the STAGE_PROBABILITY constant (the D-P1 lesson).
  const stageWeights = await loadStageWeights(db, caller.orgId);
  const { rows: opps } = await db.query<{
    pursuit_id: string; stage: string; amount_usd: string | null; partner_id: string | null; expected_close_date: Date | null;
  }>(
    `select o.pursuit_id, o.stage, o.amount_usd, m.partner_id, o.expected_close_date
       from opportunities o
       left join revenue_motions m on m.id = o.motion_id and m.org_id = o.org_id
      where o.org_id = $1 and o.pursuit_id = any($2::uuid[]) and o.stage not like 'closed%'`,
    [caller.orgId, ids]);

  const pipeline = new Map<string, { usd: number; days: number | null }>();
  for (const o of opps) {
    const usd = Number(o.amount_usd ?? 0) * stageWeights.weightFor(o.partner_id ?? null, o.stage as Stage);
    const days = o.expected_close_date
      ? Math.round((o.expected_close_date.getTime() - asOf.getTime()) / 86_400_000)
      : null;
    const cur = pipeline.get(o.pursuit_id) ?? { usd: 0, days: null };
    // Sum over all open opportunities; the SOONEST close governs proximity.
    cur.usd += usd;
    cur.days = cur.days == null ? days : days == null ? cur.days : Math.min(cur.days, days);
    pipeline.set(o.pursuit_id, cur);
  }

  // ── MODELED magnitude: defensible modelled customer impact. A CONFLICTING case is deliberately
  //    NOT credited commercially — it surfaces through contextNeed instead, so a conflict can never
  //    be counted as both value and need.
  const modeled = await loadModeledImpact(db, caller.orgId, ids);

  // ── contextNeed, momentum, readiness, pending decisions.
  const need = await loadContextNeed(db, caller.orgId, ids);
  const momentum = await loadMomentum(db, caller.orgId, ids);
  const readiness = await loadReadiness(db, caller.orgId, ids);
  const pending = await loadPendingDecisions(db, caller.orgId, ids);

  return pursuits.map((p) => {
    const pipe = pipeline.get(p.id);
    const mod = modeled.get(p.id);
    const basis: ValueBasis = pipe && pipe.usd > 0 ? "PIPELINE" : mod != null ? "MODELED" : "UNESTABLISHED";
    const n = need.get(p.id) ?? { value: 0.1, reason: "No outstanding context gaps" };
    const r = readiness.get(p.id) ?? { value: 0.5, reason: "Readiness not yet assessed" };
    return {
      pursuitId: p.id,
      accountLabel: p.account_label,
      label: p.thesis ?? p.use_case ?? "Untitled pursuit",
      // Portfolio rows carry no narrower disclosure class of their own; the caller's org membership
      // is the boundary, and RLS has already enforced it. PII/RESTRICTED rows never reach here.
      disclosure: "INTERNAL" as DisclosureClass,
      pendingDecisions: pending.get(p.id) ?? [],
      valueBasis: basis,
      magnitudeUsd: basis === "PIPELINE" ? pipe!.usd : basis === "MODELED" ? mod! : null,
      daysToClose: basis === "PIPELINE" ? pipe!.days : null,
      contextNeed: n.value, contextNeedReason: n.reason,
      momentumEvents: momentum.get(p.id) ?? [],
      activationReadiness: r.value, activationReadinessReason: r.reason,
    };
  });
}

/**
 * Modelled customer impact, midpoint of the defensible interval.
 *
 * BASELINE drivers are excluded — `value/case.ts` §4: "spending $2M a year today is not a $2M
 * benefit". A case with a CONFLICTING driver returns null, so the pursuit falls to UNESTABLISHED
 * for commercial purposes and is attended to through contextNeed instead.
 */
async function loadModeledImpact(db: PoolClient, orgId: string, ids: string[]): Promise<Map<string, number>> {
  const { rows } = await db.query<{ pursuit_id: string; low: string | null; high: string | null; conflicting: boolean; roles: number }>(
    `select f.pursuit_id,
            sum(case when fp.driver_role = 'BENEFIT' then f.value_low end) low,
            sum(case when fp.driver_role = 'BENEFIT' then f.value_high end) high,
            bool_or(f.status = 'DISPUTED' or fp.driver_role = 'CONFLICTING') conflicting,
            count(*) filter (where fp.driver_role = 'BENEFIT')::int roles
       from facts f
       join fact_predicates fp on fp.key = f.predicate_key
      where f.org_id = $1 and f.pursuit_id = any($2::uuid[]) and fp.driver_role is not null
      group by f.pursuit_id`, [orgId, ids]).catch(() => ({ rows: [] as never[] }));
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.conflicting || r.roles === 0 || r.low == null || r.high == null) continue;   // not defensible → UNESTABLISHED
    out.set(r.pursuit_id, (Number(r.low) + Number(r.high)) / 2);
  }
  return out;
}

/**
 * contextNeed — how much reason there is to attend to this pursuit's context.
 *
 * Sources the CUSTOMER-side picture: unverified/missing buying roles (`stakeholders.assertion_state`)
 * and disputed or stale facts. It deliberately does NOT read `pursuit_team_members`, which is OUR
 * selling team and belongs to activationReadiness — different tables, different sides of the deal,
 * so a missing economic buyer is counted here exactly once.
 */
async function loadContextNeed(db: PoolClient, orgId: string, ids: string[]): Promise<Map<string, { value: number; reason: string }>> {
  const { rows } = await db.query<{ pursuit_id: string; disputed: number; stale: number; unverified: number; missing_roles: number }>(
    `select pu.id pursuit_id,
            count(f.*) filter (where f.status = 'DISPUTED')::int disputed,
            count(f.*) filter (where f.status = 'STALE')::int stale,
            count(distinct s.id) filter (where s.assertion_state in ('INFERRED','UNVERIFIED'))::int unverified,
            (3 - count(distinct s.role) filter (where s.assertion_state = 'VERIFIED'))::int missing_roles
       from pursuits pu
       left join facts f on f.pursuit_id = pu.id and f.org_id = pu.org_id
       left join stakeholders s on s.pursuit_id = pu.id
      where pu.org_id = $1 and pu.id = any($2::uuid[])
      group by pu.id`, [orgId, ids]).catch(() => ({ rows: [] as never[] }));
  const out = new Map<string, { value: number; reason: string }>();
  for (const r of rows) {
    const missing = Math.max(0, r.missing_roles);
    // Declared arithmetic: a disagreement outranks an absence (the missing-context principle).
    const value = Math.min(1, r.disputed * 0.5 + r.stale * 0.2 + missing * 0.15 + r.unverified * 0.05);
    const parts: string[] = [];
    if (r.disputed) parts.push(`${r.disputed} disputed fact${r.disputed > 1 ? "s" : ""}`);
    if (missing) parts.push(`${missing} buying role${missing > 1 ? "s" : ""} unverified`);
    if (r.stale) parts.push(`${r.stale} stale fact${r.stale > 1 ? "s" : ""}`);
    out.set(r.pursuit_id, { value: value || 0.1, reason: parts.length ? parts.join(", ") : "No outstanding context gaps" });
  }
  return out;
}

/**
 * momentum — COMPLETED material change only.
 *
 * Events that OPEN a pending decision are excluded, because `decisionPressure` already counts that
 * same condition as pending state. Their resolutions are retained.
 */
async function loadMomentum(db: PoolClient, orgId: string, ids: string[]): Promise<Map<string, MomentumEvent[]>> {
  const { rows } = await db.query<{ pursuit_id: string; materiality: string; recorded_at: Date; change_type: string }>(
    `select pursuit_id, materiality, recorded_at, change_type
       from change_ledger
      where org_id = $1 and pursuit_id = any($2::uuid[])
      order by recorded_at desc limit 500`, [orgId, ids]);
  const out = new Map<string, MomentumEvent[]>();
  for (const r of rows) {
    if (MOMENTUM_EXCLUDED_CHANGE_TYPES.has(r.change_type)) continue;
    const list = out.get(r.pursuit_id) ?? [];
    list.push({ materiality: r.materiality, at: r.recorded_at });
    out.set(r.pursuit_id, list);
  }
  return out;
}

/**
 * activationReadiness — can this be progressed today, on OUR side.
 * Route confidence and the recommended candidate's activation readiness, both from `route_candidates`.
 */
async function loadReadiness(db: PoolClient, orgId: string, ids: string[]): Promise<Map<string, { value: number; reason: string }>> {
  const { rows } = await db.query<{ pursuit_id: string; readiness: string | null; confidence: string | null }>(
    `select sn.pursuit_id, rc.activation_readiness_score readiness, sn.route_confidence confidence
       from pursuit_route_snapshots sn
       left join route_candidates rc on rc.route_snapshot_id = sn.id and rc.is_recommended and rc.org_id = sn.org_id
      where sn.org_id = $1 and sn.pursuit_id = any($2::uuid[]) and sn.is_current`, [orgId, ids]);
  const out = new Map<string, { value: number; reason: string }>();
  for (const r of rows) {
    if (r.readiness == null && r.confidence == null) continue;
    const readiness = r.readiness == null ? 0.5 : Number(r.readiness) / 100;
    const confidence = r.confidence == null ? 0.5 : Number(r.confidence) / 100;
    const value = readiness * confidence;
    out.set(r.pursuit_id, {
      value,
      reason: readiness < 0.6 ? "Route is not activation-ready — seller, capacity or team roles outstanding"
        : confidence < 0.6 ? "Route recommended with low confidence" : "Route is activation-ready",
    });
  }
  return out;
}

/** decisionPressure — what has NOT happened: decisions currently waiting on a person. */
async function loadPendingDecisions(db: PoolClient, orgId: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const add = (id: string, s: string) => { const l = out.get(id) ?? []; l.push(s); out.set(id, l); };

  const { rows: routes } = await db.query<{ pursuit_id: string }>(
    `select sn.pursuit_id from pursuit_route_snapshots sn
       join pursuits pu on pu.id = sn.pursuit_id and pu.org_id = sn.org_id
      where sn.org_id = $1 and sn.pursuit_id = any($2::uuid[]) and sn.is_current and pu.selected_partner_id is null
        and sn.recommended_partner_id is not null`, [orgId, ids]);
  for (const r of routes) add(r.pursuit_id, "A recommended route is waiting for approval");

  const { rows: plans } = await db.query<{ pursuit_id: string }>(
    `select distinct r.pursuit_id from pursuit_plan_revisions r
      where r.org_id = $1 and r.pursuit_id = any($2::uuid[]) and r.kind = 'RECOMMENDATION'
        and not exists (select 1 from pursuit_plan_revisions d
                         where d.org_id = r.org_id and d.responds_to_revision_id = r.id)`, [orgId, ids]);
  for (const r of plans) add(r.pursuit_id, "A recommended plan is waiting for a decision");

  const { rows: appr } = await db.query<{ pursuit_id: string }>(
    `select distinct a.pursuit_id from pursuit_run_approvals a
      where a.org_id = $1 and a.pursuit_id = any($2::uuid[]) and a.decision = 'REQUESTED'
        and not exists (select 1 from pursuit_run_approvals t where t.request_id = a.id)`, [orgId, ids])
    .catch(() => ({ rows: [] as never[] }));
  for (const r of appr) add(r.pursuit_id, "A governed action is waiting for approval");

  return out;
}
