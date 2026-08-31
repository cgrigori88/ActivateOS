import type { PoolClient } from "pg";
import type { TodayQueueView, DecisionItem, DecisionClass } from "./types";
import { bandOf, type Caller } from "./helpers";
import { classifyChange, isMaterial, todaySort, type OperationalUrgency } from "./materiality";
import { motionAcceptanceBlockage } from "@/lib/motions/funnel";
import { getLifecycleHorizon } from "@/lib/lifecycle/horizon";
import { STAGE_PROBABILITY, type Stage } from "@/lib/opportunities/lifecycle";

/**
 * Today decision-queue read model (Workstream D, §2/§3/§4/§54). Builds typed DecisionItems from
 * canonical state — route approvals, fact reviews, team declines, material ledger changes,
 * contradictions, team gaps — ordered by the server-side materiality policy (decision class →
 * operational urgency → commercial priority → age), NOT by recency. Operational urgency is kept
 * distinct from commercial priority. Every action maps to a governed Skill.
 */

const DEMO_BANNER = "Demo environment — includes illustrative synthetic partner/distributor data.";

/** P1C §11 materiality floor: stakeholder gaps surface on Today only above this expected value. */
export const STAKEHOLDER_GAP_FLOOR_USD = 500_000;
/** P2A §8: an approaching lifecycle window is an opportunity only above this value... */
export const LIFECYCLE_FLOOR_USD = 500_000;
/** ...while a CONFLICTING date is a risk at a lower bar — disagreeing with ourselves is cheap to fix. */
export const LIFECYCLE_CONFLICT_FLOOR_USD = 250_000;

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
    // Materiality escalation (P1B): a partner acceptance holding a HIGH-band pursuit is operationally
    // urgent, not routine — same item type, upgraded urgency only where the band supports it.
    const wBand = bandOf(n(w.priority));
    items.push(mk("TEAM_WAITING", "ACTION_REQUIRED", wBand === "very_high" || wBand === "high" ? "high" : "normal", wBand, w.pursuit_id, w.company_id, w.account_label,
      `Waiting on ${who} to accept`, `A confirmed ${w.role.replace(/_/g, " ").toLowerCase()} role has not yet been accepted — activation readiness is held.`,
      w.synthetic, w.invited_at ?? new Date(), now,
      [{ label: "Mark accepted", skill: "accept_team_member", sideEffect: "INTERNAL_WRITE" }], `/pursuits/${w.pursuit_id}#team`));
  }

  // 2c) Motion blocked by participant acceptance (P1A.6) — an exceptions-only aggregate: only when
  //     the expected value held by pending acceptances on an approved/active hypothesis clears the
  //     materiality floor. One line per hypothesis ("$2.1M of X is blocked by partner acceptance"),
  //     never one per pursuit — the per-pursuit items are 2b above.
  if (!scoped) {   // hypothesis-level aggregate is a whole-book signal; scoped views keep 2b only
    const blockage = await motionAcceptanceBlockage(db, caller.orgId);
    for (const b of blockage) {
      items.push(mk("MOTION_ACCEPTANCE_BLOCKED", "ACTION_REQUIRED", "high", "high", null, null, b.name,
        `$${(b.blockedUsd / 1_000_000).toFixed(1)}M of ${b.name} is blocked by participant acceptance`,
        `${b.pursuits} pursuit${b.pursuits === 1 ? "" : "s"} on this hypothesis are waiting on a confirmed participant (partner or vendor side) to accept.`,
        false, new Date(), now,
        [{ label: "Mark accepted", skill: "accept_team_member", sideEffect: "INTERNAL_WRITE" }],
        `/motions?mdrawer=${b.taxonomyNodeId}&mstage=not_ready`));
    }
  }

  // 2d) Material stakeholder gap (P1C §11) — exceptions only: a pursuit above the value floor
  //     whose linked opportunity has NO VERIFIED economic buyer. One item per pursuit, and the
  //     strongest KNOWN path is named ONLY when relationship evidence exists (a named seller with
  //     an asserted account relationship). Overlap/ownership/selected-partner name nothing.
  const ebGaps = await db.query<{ pursuit_id: string; company_id: string; account_label: string; ev: string | null; priority: string | null; synthetic: boolean; path_partner: string | null; path_seller: string | null }>(
    `select pu.id pursuit_id, c.id company_id, c.legal_name account_label, pu.expected_value_weighted ev,
            pu.current_priority_score priority, (pu.data_environment <> 'PRODUCTION') synthetic,
            sp.partner_name path_partner, sp.seller_name path_seller
       from pursuits pu
       join companies c on c.id = pu.account_id
       left join lateral (
         select s.name seller_name, pn.name partner_name
           from seller_account_relationships sar
           join sellers s on s.id = sar.seller_id and s.org_id = $3
           left join partners pn on pn.id = s.partner_id
          where sar.company_id = pu.account_id and sar.strength > 0
          order by sar.strength desc limit 1) sp on true
      where pu.org_id = $3 and pu.status not in ('WON','LOST','DISQUALIFIED')
        and coalesce(pu.expected_value_weighted, 0) >= ${STAKEHOLDER_GAP_FLOOR_USD}
        and exists (select 1 from opportunities o where o.pursuit_id = pu.id)
        and not exists (select 1 from opportunities o join stakeholders st on st.opportunity_id = o.id
                         where o.pursuit_id = pu.id and st.role = 'economic_buyer' and st.assertion_state = 'verified')
        and ($2::boolean is false or pu.account_id = any($1))`, [ids, scoped, caller.orgId]);
  for (const g of ebGaps.rows) {
    const evUsd = g.ev == null ? null : Number(g.ev);
    items.push(mk("STAKEHOLDER_GAP", "ACTION_REQUIRED", "high", bandOf(n(g.priority)), g.pursuit_id, g.company_id, g.account_label,
      `${evUsd != null ? `$${(evUsd / 1_000_000).toFixed(1)}M pursuit` : "Pursuit"} lacks a verified economic buyer`,
      g.path_seller
        ? `No verified buying authority. Strongest known path: ${g.path_partner ? `${g.path_partner} seller ` : ""}${g.path_seller} (account-level relationship).`
        : "No verified buying authority, and no warm path is known — UNKNOWN, not zero.",
      g.synthetic, new Date(), now,
      [{ label: "Verify role", skill: "assert_stakeholder_role", sideEffect: "INTERNAL_WRITE" }], `/pursuits/${g.pursuit_id}#stakeholders`));
  }

  // 2e) Material lifecycle windows (P2A §8) — exceptions only. A pursuit above the value floor whose
  //     lifecycle event enters the horizon, or whose lifecycle dates CONFLICT. Verified dates that
  //     are simply approaching are informational, not an action; a conflict always is.
  {
    const horizon = await getLifecycleHorizon(db, caller.orgId, { days: 90, companyIds: scoped ? ids : null });
    for (const it of horizon.items) {
      const ev = it.expectedValue ?? 0;
      const conflicting = it.event.state === "CONFLICTING_DATE";
      if (!conflicting && ev < LIFECYCLE_FLOOR_USD) continue;   // approaching dates need materiality
      if (conflicting && ev < LIFECYCLE_CONFLICT_FLOOR_USD) continue;
      const money = ev >= 1_000_000 ? `$${(ev / 1_000_000).toFixed(1)}M` : `$${Math.round(ev / 1000)}k`;
      items.push(mk(
        conflicting ? "LIFECYCLE_CONFLICT" : "LIFECYCLE_WINDOW",
        conflicting ? "RISK" : "OPPORTUNITY",
        conflicting ? "high" : "normal",
        bandOf(ev >= 1_000_000 ? 85 : 60),
        it.pursuitId, it.companyId, it.accountLabel,
        // The row already names the account, and several predicate labels already end in "window"
        // ("Renewal window") — appending another produces "renewal window window".
        conflicting
          ? `${it.event.label} timing is conflicting across sources`
          : `${money} Pursuit enters ${/\bwindow$/i.test(it.event.label)
              ? `a ${it.event.label.toLowerCase()}`
              : `a ${it.event.label.toLowerCase()} window`} in ${it.event.daysUntil} days`,
        it.whyItMatters, false, new Date(), now,
        [{ label: it.nextAction?.label ?? "Open", skill: "explain_partner_route", sideEffect: "READ" }],
        it.nextAction?.deepLink ?? (it.pursuitId ? `/pursuits/${it.pursuitId}#whynow` : `/accounts/${it.companyId}`)));
    }
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
