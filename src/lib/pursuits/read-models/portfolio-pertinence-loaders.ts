import type { PoolClient } from "pg";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { getValueCase } from "@/lib/value/case";
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
 * NO QUERY ERROR IS EVER CAUGHT HERE. These queries run inside the caller's transaction, and in
 * PostgreSQL a failed statement aborts that transaction: catching the JavaScript error does NOT
 * recover it, it only hides the real failure and leaves every later statement failing with 25P02.
 * An earlier version wrapped three of these in `.catch(() => ({ rows: [] }))`, which turned two
 * genuinely broken queries into a silent "no data" locally and a 500 on the hosted Today page.
 * A query that can fail belongs behind a SAVEPOINT, as `dispatchSkill` does; a query that should
 * not fail must simply be correct.
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
  const modeled = await loadModeledImpact(db, caller.orgId, ids, asOf);

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
 * USES THE CANONICAL VALUE CASE, not hand-written SQL. `getValueCase` owns the driver taxonomy, the
 * interval arithmetic, the BASELINE exclusion ("spending $2M a year today is not a $2M benefit") and
 * the defensibility rule. Re-deriving any of that here would be a second source of truth for the
 * economics — and my first attempt at hand-rolled SQL was simply wrong: it read `facts.pursuit_id`
 * and `facts.value_low`, neither of which exists (facts link through `pursuit_facts`).
 *
 * A CONFLICTING or undefensible case returns null, so the pursuit falls to UNESTABLISHED for
 * commercial purposes and is attended to through contextNeed instead — never credited as both.
 */
async function loadModeledImpact(db: PoolClient, orgId: string, ids: string[], asOf: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of ids) {
    const vc = await getValueCase(db, orgId, id, asOf);
    if (!vc || !vc.defensible || vc.modeledImpact == null) continue;
    if (vc.state !== "STRONG" && vc.state !== "INCOMPLETE") continue;   // CONFLICTING earns no commercial credit
    out.set(id, (vc.modeledImpact.low + vc.modeledImpact.high) / 2);
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
  // Facts reach a pursuit through `pursuit_facts` — `facts` itself carries no `pursuit_id`. Each
  // measure is its own scalar subquery rather than one multi-join with filtered counts: joining
  // facts AND stakeholders in a single row set fans out, and `stakeholders` has no `id` column to
  // count distinctly on (its identity is opportunity+contact). Subqueries are both correct and
  // immune to that fan-out.
  const { rows } = await db.query<{ pursuit_id: string; disputed: number; stale: number; unverified: number; verified_roles: number }>(
    `select pu.id pursuit_id,
            (select count(*) from pursuit_facts pf join facts f on f.id = pf.ref_id
              where pf.pursuit_id = pu.id and f.org_id = pu.org_id and f.status = 'DISPUTED')::int disputed,
            (select count(*) from pursuit_facts pf join facts f on f.id = pf.ref_id
              where pf.pursuit_id = pu.id and f.org_id = pu.org_id and f.status = 'STALE')::int stale,
            (select count(*) from stakeholders s
              where s.pursuit_id = pu.id and s.assertion_state in ('inferred','unverified'))::int unverified,
            (select count(distinct s.role) from stakeholders s
              where s.pursuit_id = pu.id and s.assertion_state = 'verified'
                and s.role in ('economic_buyer','champion','technical_buyer'))::int verified_roles
       from pursuits pu
      where pu.org_id = $1 and pu.id = any($2::uuid[])`, [orgId, ids]);
  const out = new Map<string, { value: number; reason: string }>();
  for (const r of rows) {
    // The three buying roles a pursuit needs verified; absence is a gap, never zero.
    const missing = Math.max(0, 3 - r.verified_roles);
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
        and not exists (select 1 from pursuit_run_approvals t where t.request_id = a.id)`, [orgId, ids]);
  for (const r of appr) add(r.pursuit_id, "A governed action is waiting for approval");

  return out;
}
