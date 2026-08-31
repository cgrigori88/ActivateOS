import type { PoolClient } from "pg";
import type { TodayQueueView, DecisionItem, DecisionClass } from "./types";
import { bandOf, type Caller } from "./helpers";
import { classifyChange, isMaterial, todaySort, type OperationalUrgency } from "./materiality";
import { STAGE_PROBABILITY, type Stage } from "@/lib/opportunities/lifecycle";

/**
 * Today decision-queue read model (Workstream D, §2/§3/§4/§54). Builds typed DecisionItems from
 * canonical state — route approvals, fact reviews, team declines, material ledger changes,
 * contradictions, team gaps — ordered by the server-side materiality policy (decision class →
 * operational urgency → commercial priority → age), NOT by recency. Operational urgency is kept
 * distinct from commercial priority. Every action maps to a governed Skill.
 */

const DEMO_BANNER = "Demo environment — includes illustrative synthetic partner/distributor data.";

/**
 * Options (additive, back-compat): `companyIds` narrows the queue to an ecosystem scope
 * (scale-disclosure §1) — null/undefined = the full RLS-scoped set; `limit` caps the returned
 * items for the Today command center's top-N cut (§2), with `total` reporting the full count for
 * the "View all (N)" affordance. Materiality order is unchanged.
 */
export interface TodayQueueOpts {
  companyIds?: string[] | null;
  limit?: number;
}

export async function getTodayQueue(db: PoolClient, caller: Caller, opts: TodayQueueOpts = {}): Promise<TodayQueueView> {
  const items: DecisionItem[] = [];
  const now = Date.now();
  // Scope narrowing (§1): an empty array is a valid "nothing in scope" set → no items. `null`/absent
  // = no restriction. Applied as an additional company_id predicate; never widens the RLS-scoped set.
  const scoped = opts.companyIds != null;
  const ids = opts.companyIds ?? [];

  // 1) Routes recommended but not yet selected → DECISION_REQUIRED.
  const routes = await db.query<{ pursuit_id: string; company_id: string; account_label: string; priority: string | null; recommended: string | null; synthetic: boolean; at: Date }>(
    `select sn.pursuit_id, c.id company_id, c.legal_name account_label, pu.current_priority_score priority, p.name recommended,
            (pu.data_environment <> 'PRODUCTION') synthetic, sn.calculated_at at
       from pursuit_route_snapshots sn
       join pursuits pu on pu.id = sn.pursuit_id
       join companies c on c.id = pu.account_id
       left join partners p on p.id = sn.recommended_partner_id
      where sn.is_current and sn.route_status = 'RECOMMENDED' and sn.selected_partner_id is null
        and pu.status not in ('WON','LOST','DISQUALIFIED')
        and ($2::boolean is false or pu.account_id = any($1))`, [ids, scoped]);
  for (const r of routes.rows) items.push(mk("ROUTE_APPROVAL", "DECISION_REQUIRED", "high", bandOf(n(r.priority)), r.pursuit_id, r.company_id, r.account_label,
    `Approve route${r.recommended ? ` via ${r.recommended}` : ""}`, "Recommended route is awaiting your approval.", r.synthetic, r.at, now,
    [{ label: "Approve", skill: "select_partner_route", sideEffect: "INTERNAL_WRITE" }, { label: "Override", skill: "override_partner_route", sideEffect: "INTERNAL_WRITE" }, { label: "Compare", skill: "explain_partner_route", sideEffect: "READ" }],
    // Deep-link into the route-decision section of the canonical Pursuit detail (the decision
    // room) — NOT a dedicated /route sub-room (that segment never existed → 404). The `#route`
    // anchor natively scrolls to the governed decision control; scope persists via the cookie.
    `/pursuits/${r.pursuit_id}#route`));

  // 2) Fact reviews open → DECISION_REQUIRED (RISK operational when material predicate).
  const reviews = await db.query<{ id: string; reason: string; created_at: Date; account_label: string | null; pursuit_id: string | null; company_id: string | null }>(
    `select fr.id, fr.reason, fr.created_at, c.legal_name account_label, null::uuid pursuit_id, fc.company_id
       from fact_reviews fr
       left join fact_candidates fc on fc.id = fr.candidate_id
       left join companies c on c.id = fc.company_id
      where fr.human_decision is null and fr.system_recommendation = 'REVIEW'
        and ($2::boolean is false or fc.company_id = any($1))`, [ids, scoped]);
  for (const rv of reviews.rows) items.push(mk("FACT_REVIEW", "DECISION_REQUIRED", "normal", "moderate", rv.pursuit_id, rv.company_id, rv.account_label ?? "Account",
    "Review a proposed fact", rv.reason, false, rv.created_at, now,
    [{ label: "Accept", skill: "review_fact", sideEffect: "INTERNAL_WRITE" }, { label: "Reject", skill: "review_fact", sideEffect: "INTERNAL_WRITE" }], `/review`));

  // 2b) Confirmed team roles awaiting acceptance → ACTION_REQUIRED. A member the operator confirmed
  //     (INVITED) but who has not yet accepted is a participant the pursuit is WAITING ON — the
  //     Multi-Party Execution Plan surfaced in the decision queue. Accept is the one governed step.
  const waitingTeam = await db.query<{ id: string; role: string; pursuit_id: string; company_id: string; account_label: string; partner_name: string | null; priority: string | null; synthetic: boolean; invited_at: Date | null }>(
    `select tm.id, tm.role, tm.pursuit_id, c.id company_id, c.legal_name account_label, pn.name partner_name,
            pu.current_priority_score priority, (pu.data_environment <> 'PRODUCTION') synthetic, tm.invited_at
       from pursuit_team_members tm
       join pursuits pu on pu.id = tm.pursuit_id
       join companies c on c.id = pu.account_id
       left join partners pn on pn.id = tm.partner_id
      where tm.status = 'INVITED' and pu.status not in ('WON','LOST','DISQUALIFIED')
        and ($2::boolean is false or pu.account_id = any($1))`, [ids, scoped]);
  for (const w of waitingTeam.rows) {
    const who = w.partner_name ?? w.role.replace(/_/g, " ").toLowerCase();
    items.push(mk("TEAM_WAITING", "ACTION_REQUIRED", "normal", bandOf(n(w.priority)), w.pursuit_id, w.company_id, w.account_label,
      `Waiting on ${who} to accept`, `A confirmed ${w.role.replace(/_/g, " ").toLowerCase()} role has not yet been accepted — activation readiness is held.`,
      w.synthetic, w.invited_at ?? new Date(), now,
      [{ label: "Mark accepted", skill: "accept_team_member", sideEffect: "INTERNAL_WRITE" }], `/pursuits/${w.pursuit_id}#team`));
  }

  // 3) Material ledger changes (recent) → MATERIAL_CHANGE / RISK / OPPORTUNITY.
  const changes = await db.query<{ id: string; pursuit_id: string; company_id: string; change_type: string; reason: string | null; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null; materiality: string; recorded_at: Date; account_label: string; priority: string | null; synthetic: boolean }>(
    `select cl.id, cl.pursuit_id, c.id company_id, cl.change_type, cl.reason, cl.before_state, cl.after_state, cl.materiality, cl.recorded_at,
            c.legal_name account_label, pu.current_priority_score priority, (cl.data_environment <> 'PRODUCTION') synthetic
       from change_ledger cl
       join pursuits pu on pu.id = cl.pursuit_id
       join companies c on c.id = pu.account_id
      where cl.pursuit_id is not null and cl.recorded_at > now() - interval '14 days'
        and ($2::boolean is false or pu.account_id = any($1))
      order by cl.recorded_at desc limit 60`, [ids, scoped]);
  for (const ch of changes.rows) {
    const cls = classifyChange(ch.change_type);
    if (!cls || !isMaterial(ch.materiality)) continue;
    items.push(mk(ch.change_type, cls, cls === "RISK" ? "high" : "normal", bandOf(n(ch.priority)), ch.pursuit_id, ch.company_id, ch.account_label,
      humanChange(ch.change_type), ch.reason ?? "", ch.synthetic, ch.recorded_at, now,
      [{ label: "Open", skill: "explain_partner_route", sideEffect: "READ" }], `/pursuits/${ch.pursuit_id}`, brief(ch.before_state), brief(ch.after_state)));
  }

  items.sort((a, b) => todaySort(
    { decisionClass: a.decisionClass, operationalUrgency: a.operationalUrgency, commercialPriority: a.commercialPriority, ageSeconds: (now - new Date(a.at).getTime()) / 1000 },
    { decisionClass: b.decisionClass, operationalUrgency: b.operationalUrgency, commercialPriority: b.commercialPriority, ageSeconds: (now - new Date(b.at).getTime()) / 1000 }));

  const counts = { DECISION_REQUIRED: 0, MATERIAL_CHANGE: 0, ACTION_REQUIRED: 0, RISK: 0, OPPORTUNITY: 0, FYI: 0 } as Record<DecisionClass, number>;
  for (const it of items) counts[it.decisionClass]++;
  const total = items.length;
  const anySynthetic = items.some((i) => i.synthetic) || await orgHasSynthetic(db, caller.orgId);
  const cut = opts.limit != null ? items.slice(0, opts.limit) : items;
  return { generatedAt: new Date().toISOString(), items: cut, counts, total, demoBanner: anySynthetic ? DEMO_BANNER : null };
}

/**
 * Today revenue-exposure summary (§2). One aggregate over the canonical opportunities set, scoped
 * to the ecosystem (§1). Pure read — no new score, no schema. Weighted uses the declared stage
 * probability curve (STAGE_PROBABILITY), the same canonical curve Pipeline starts from.
 */
export interface TodayExposure {
  openUsd: number;
  weightedUsd: number;
  openCount: number;
  wonUsdPeriod: number;
  wonCountPeriod: number;
}

export async function getTodayExposure(db: PoolClient, companyIds?: string[] | null): Promise<TodayExposure> {
  const scoped = companyIds != null;
  const ids = companyIds ?? [];
  // Per-stage open sums + won-in-period, aggregated once; weighting applied in JS against the
  // canonical STAGE_PROBABILITY curve so the number never drifts from the shared definition.
  const { rows } = await db.query<{ stage: string; usd: string; n: string }>(
    `select stage, coalesce(sum(amount_usd), 0) usd, count(*) n
       from opportunities
      where ($2::boolean is false or company_id = any($1))
        and (stage not in ('closed_won','closed_lost') or (stage = 'closed_won' and closed_at >= now() - interval '90 days'))
      group by stage`,
    [ids, scoped],
  );
  let openUsd = 0, weightedUsd = 0, openCount = 0, wonUsdPeriod = 0, wonCountPeriod = 0;
  for (const r of rows) {
    const usd = Number(r.usd), nn = Number(r.n);
    if (r.stage === "closed_won") { wonUsdPeriod += usd; wonCountPeriod += nn; continue; }
    if (r.stage === "closed_lost") continue;
    openUsd += usd; openCount += nn;
    weightedUsd += usd * (STAGE_PROBABILITY[r.stage as Stage] ?? 0);
  }
  return { openUsd, weightedUsd, openCount, wonUsdPeriod, wonCountPeriod };
}

/** The pending decisions attached to a single pursuit (used by the detail page). */
export async function buildPendingDecisions(db: PoolClient, caller: Caller, pursuitId: string): Promise<DecisionItem[]> {
  const all = await getTodayQueue(db, caller);
  return all.items.filter((i) => i.pursuitId === pursuitId && (i.decisionClass === "DECISION_REQUIRED" || i.decisionClass === "ACTION_REQUIRED"));
}

async function orgHasSynthetic(db: PoolClient, orgId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text n from transaction_features where org_id = $1 and is_simulated = true`, [orgId]);
  return Number(rows[0].n) > 0;
}

function mk(type: string, decisionClass: DecisionClass, urgency: OperationalUrgency, priority: DecisionItem["commercialPriority"], pursuitId: string | null, companyId: string | null, accountLabel: string, title: string, reason: string, synthetic: boolean, at: Date, now: number, allowedActions: DecisionItem["allowedActions"], deepLink: string, before: string | null = null, after: string | null = null): DecisionItem {
  void now;
  return { id: `${type}:${pursuitId ?? "x"}:${at.getTime()}`, type, decisionClass, operationalUrgency: urgency, commercialPriority: priority, pursuitId, companyId, accountLabel, title, reason, before, after, allowedActions, deepLink, synthetic, at: at.toISOString() };
}
function humanChange(ct: string): string {
  return ({ ROUTE_RECOMMENDATION_CHANGED: "Recommended route changed", SCORE_CHANGED: "Score changed", FACT_PROMOTED: "New fact promoted", CONVERGENCE_CHANGED: "Signal convergence changed", WHY_NOW_CHANGED: "Why Now updated", CONTRADICTION_DETECTED: "Conflicting evidence detected", PARTNER_DECLINED: "Partner declined", CUSTOMER_ENGAGED: "Customer engaged", OPPORTUNITY_LINKED: "Opportunity created" } as Record<string, string>)[ct] ?? ct;
}
function n(v: string | null): number | null { return v == null ? null : Number(v); }
function brief(o: Record<string, unknown> | null): string | null { if (!o) return null; const k = Object.keys(o)[0]; return k ? `${o[k]}` : null; }
