import type { PoolClient } from "pg";
import type { PursuitDetailView, WhyNowView, WhyNowComponent, PursuitTeamView, TeamMemberView, PursuitTimelineView, TimelineEvent, FactItem, DecisionItem, ScoreView } from "./types";
import { scoreView, freshness, type Caller } from "./helpers";
import { isTimelineWorthy } from "./materiality";
import { getRouteComparison } from "./route";
import { buildPendingDecisions } from "./today";
import { getStakeholderCoverage } from "@/lib/stakeholders/coverage";
import { loadLifecycleFacts, eventsForAccount } from "@/lib/lifecycle/state";

/**
 * Pursuit detail read model (Workstream D, §7/§8/§11-15). Page-shaped composite: decision band,
 * structured Why Now (traceable, missing-stays-missing), route comparison (disclosure-filtered),
 * team + readiness, material What-Changed timeline, and facts by trust state. No score is
 * recomputed here — every number is read from the A/B/C caches/services.
 */

const DEMO_BANNER = "Demo environment — includes illustrative synthetic partner/distributor data.";

export async function getPursuitDetail(db: PoolClient, caller: Caller, pursuitId: string): Promise<PursuitDetailView | null> {
  const p = await db.query<{
    account_id: string; account_label: string; business_problem: string | null; use_case: string | null; solution: string | null;
    status: string; expected_value_weighted: string | null; currency: string | null; last_material_change_at: Date | null;
    current_priority_score: string | null; current_purchase_propensity_score: string | null; current_evidence_confidence_score: string | null;
    current_timing_score: string | null; data_environment: string; updated_at: Date | null;
  }>(
    `select pu.account_id, c.legal_name account_label, pu.business_problem, pu.use_case, tn.name solution,
            pu.status, pu.expected_value_weighted, pu.expected_value_currency currency, pu.last_material_change_at,
            pu.current_priority_score, pu.current_purchase_propensity_score, pu.current_evidence_confidence_score,
            pu.current_timing_score, pu.data_environment, pu.updated_at
       from pursuits pu join companies c on c.id = pu.account_id
       left join taxonomy_nodes tn on tn.id = pu.product_category_id
      where pu.id = $1`, [pursuitId]);
  if (!p.rows[0]) return null;
  const r = p.rows[0];

  const route = await getRouteComparison(db, caller, pursuitId);
  const whyNow = await getPursuitWhyNow(db, pursuitId);
  const team = await getPursuitTeam(db, caller, pursuitId);
  const timeline = await getPursuitTimeline(db, pursuitId);
  const facts = await getFacts(db, r.account_id);
  const pending = await buildPendingDecisions(db, caller, pursuitId);
  // Stakeholder Intelligence (P1C) — coverage over the linked opportunities; a pre-opportunity
  // pursuit comes back NOT ESTABLISHED (honest UNKNOWN), never synthesized.
  const stakeholders = await getStakeholderCoverage(db, caller.orgId, pursuitId);
  // Value Case (P2B) — the INTERNAL, fully-authorized projection. The partner projection is built
  // separately by toPartnerValueCase and is never this object with fields hidden.
  const valueCase = await (await import("@/lib/value/case")).getValueCase(db, caller.orgId, pursuitId);
  const synthetic = r.data_environment !== "PRODUCTION" || route.recommended?.synthetic === true;

  const decisionBand: ScoreView[] = [
    scoreView("priority", numOrNull(r.current_priority_score)),
    scoreView("purchase_propensity", numOrNull(r.current_purchase_propensity_score)),
    scoreView("evidence_confidence", numOrNull(r.current_evidence_confidence_score)),
    scoreView("timing", numOrNull(r.current_timing_score)),
    scoreView("route", route.recommended?.routeScore.value ?? null),
    scoreView("activation_readiness", route.recommended?.readiness.value ?? null),
  ];

  return {
    pursuitId, accountId: r.account_id, accountLabel: r.account_label,
    thesis: r.business_problem ?? r.use_case ?? "Untitled pursuit", solution: r.solution,
    lifecycle: r.status, expectedValue: numOrNull(r.expected_value_weighted), currency: r.currency,
    lastMaterialChange: r.last_material_change_at?.toISOString() ?? null,
    decisionBand, whyNow, route, team, timeline, facts, pendingDecisions: pending, stakeholders, valueCase,
    freshness: [freshness("Updated", r.updated_at)],
    synthetic, demoBanner: r.data_environment !== "PRODUCTION" ? DEMO_BANNER : null,
  };
}

export async function getPursuitWhyNow(db: PoolClient, pursuitId: string): Promise<WhyNowView> {
  const { rows } = await db.query<{ why_now: Record<string, unknown> | null; org_id: string; account_id: string }>(
    `select why_now, org_id, account_id from pursuits where id = $1`, [pursuitId]);
  const wn = rows[0]?.why_now as WhyNowRaw | null;
  // Lifecycle Intelligence (P2A): derived from canonical facts, independent of whether a structured
  // Why Now has been assembled — an account can have a renewal on the clock and no Why Now yet.
  const lifecycle = rows[0]
    ? eventsForAccount((await loadLifecycleFacts(db, rows[0].org_id, [rows[0].account_id])).get(rows[0].account_id) ?? [])
    : [];
  if (!wn || typeof wn !== "object") {
    return { present: false, businessTrigger: null, technologyCondition: null, timingAnchor: null, signalConvergence: null, routeRelevance: null, contradictions: [], unknowns: ["No structured Why Now assembled yet."], renderedSummary: null, asOf: null, lifecycle };
  }
  const comp = (kind: string, label: string, o: { fact_id?: string; predicate?: string; label?: string; date?: string | null } | null | undefined, implication: string | null = null): WhyNowComponent | null =>
    o ? { kind, label, present: true, detail: o.label ?? o.predicate ?? o.date ?? null, commercialImplication: implication, refType: "fact", refId: o.fact_id ?? null } : null;

  const unknowns: string[] = [];
  if (!wn.business_trigger) unknowns.push("No confirmed business trigger.");
  if (!wn.timing_anchor) unknowns.push("No verified timing anchor.");
  if (!wn.partner_route_relevance) unknowns.push("No partner route established.");

  return {
    present: true,
    businessTrigger: comp("business_trigger", "Business Trigger", wn.business_trigger, wn.business_trigger ? "Creates a defined commercial window." : null),
    technologyCondition: comp("technology_condition", "Technology Condition", wn.technology_condition),
    timingAnchor: wn.timing_anchor ? { kind: "timing_anchor", label: "Timing Anchor", present: true, detail: wn.timing_anchor.date ?? wn.timing_anchor.predicate ?? null, commercialImplication: "Defines the planning window.", refType: "fact", refId: wn.timing_anchor.fact_id ?? null } : null,
    signalConvergence: wn.signal_convergence ? { kind: "signal_convergence", label: "Signal Convergence", present: true, detail: `${wn.signal_convergence.independent_family_count ?? 0} independent families`, commercialImplication: null } : null,
    routeRelevance: wn.partner_route_relevance ? { kind: "route_relevance", label: "Route Relevance", present: true, detail: (wn.partner_route_relevance.shareable ?? []).map((l) => l.text).slice(0, 2).join("; ") || "Route context", commercialImplication: null, synthetic: false } : null,
    contradictions: (wn.contradictory_evidence ?? []).map((c) => ({ text: c.basis || "Conflicting evidence", supporting: 0, contradicting: 1 })),
    unknowns,
    renderedSummary: null,
    asOf: wn.as_of ?? null,
    lifecycle,
  };
}

export async function getPursuitTeam(db: PoolClient, caller: Caller, pursuitId: string): Promise<PursuitTeamView> {
  const p = await db.query<{ org_id: string; pursuit_type: string | null; account_id: string }>(`select org_id, pursuit_type, account_id from pursuits where id = $1`, [pursuitId]);
  const orgId = p.rows[0]?.org_id;
  const members = await db.query<{ id: string; role: string; side: string; status: string; person_ref: string | null; fit_score: string | null; partner_name: string | null }>(
    `select tm.id, tm.role, tm.side, tm.status, tm.person_ref, tm.fit_score, pn.name partner_name
       from pursuit_team_members tm left join partners pn on pn.id = tm.partner_id
      where tm.pursuit_id = $1 and tm.status <> 'SUPERSEDED' order by tm.side, tm.role`, [pursuitId]);
  const reqRoles = new Set((await db.query<{ role: string }>(`select role from pursuit_team_requirements where required = true and (org_id is null or org_id = $1) and (pursuit_type is null or pursuit_type = $2)`, [orgId, p.rows[0]?.pursuit_type])).rows.map((r) => r.role));
  const memberViews: TeamMemberView[] = members.rows.map((m) => ({
    id: m.id, role: m.role, side: m.side, personLabel: m.person_ref, partnerLabel: m.partner_name,
    status: m.status, fit: m.fit_score != null ? scoreView("seller_fit", Number(m.fit_score)) : null, missing: false,
    required: reqRoles.has(m.role),
    // Recommendation ≠ decision: a recommended member is CONFIRMED (the human team decision); a
    // confirmed (invited) one is then marked ACCEPTED. Terminal states offer no further governed step.
    nextGovernedAction: m.status === "RECOMMENDED" ? "confirm" : m.status === "INVITED" ? "accept" : null,
    waiting: m.status === "INVITED",
  }));

  const accepted = new Set(members.rows.filter((m) => m.status === "ACCEPTED" || m.status === "ACTIVE").map((m) => m.role));
  const missing = [...reqRoles].filter((r) => !accepted.has(r));

  // Readiness from the current route snapshot's recommended candidate.
  const rd = await db.query<{ activation_readiness_score: string | null }>(
    `select rc.activation_readiness_score from route_candidates rc join pursuit_route_snapshots sn on sn.id = rc.route_snapshot_id where sn.pursuit_id = $1 and sn.is_current and rc.is_recommended`, [pursuitId]);
  const gapActions: DecisionItem[] = missing.map((role) => ({
    id: `gap:${pursuitId}:${role}`, type: role.includes("SELLER") ? "SELLER_SELECTION" : "TEAM_REPLACEMENT", decisionClass: "ACTION_REQUIRED",
    operationalUrgency: "high", commercialPriority: "high", pursuitId, companyId: null, accountLabel: "", title: `Assign ${role.replace(/_/g, " ").toLowerCase()}`,
    reason: "Required role not yet accepted — lowers activation readiness.", allowedActions: [{ label: "Assign", skill: "assemble_pursuit_team", sideEffect: "INTERNAL_WRITE" }],
    deepLink: `/pursuits/${pursuitId}/route`, synthetic: false, at: new Date().toISOString(),
  }));

  const sellerAlts = await db.query<{ seller_id: string; total_score: string | null; name: string | null }>(
    `select rsc.seller_id, rsc.total_score, s.name from route_seller_candidates rsc join sellers s on s.id = rsc.seller_id where rsc.pursuit_id = $1 order by rsc.rank limit 3`, [pursuitId]);
  void caller;
  return {
    members: memberViews,
    activationReadiness: scoreView("activation_readiness", rd.rows[0]?.activation_readiness_score != null ? Number(rd.rows[0].activation_readiness_score) : null),
    missingRequiredRoles: missing, gapActions,
    sellerAlternatives: sellerAlts.rows.map((s) => ({ sellerId: s.seller_id, label: s.name ?? "Seller", fit: scoreView("seller_fit", s.total_score != null ? Number(s.total_score) : null) })),
  };
}

export async function getPursuitTimeline(db: PoolClient, pursuitId: string): Promise<PursuitTimelineView> {
  const { rows } = await db.query<{ recorded_at: Date; change_type: string; reason: string | null; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null; materiality: string; data_environment: string }>(
    `select recorded_at, change_type, reason, before_state, after_state, materiality, data_environment
       from change_ledger where pursuit_id = $1 order by recorded_at desc limit 100`, [pursuitId]);
  const events: TimelineEvent[] = [];
  for (const e of rows) {
    if (!isTimelineWorthy(e.materiality)) continue;   // only material events (§23)
    events.push({ at: e.recorded_at.toISOString(), changeType: e.change_type, label: e.reason ?? e.change_type, before: brief(e.before_state), after: brief(e.after_state), materiality: e.materiality, synthetic: e.data_environment !== "PRODUCTION" });
  }
  return { events };
}

async function getFacts(db: PoolClient, companyId: string): Promise<FactItem[]> {
  const { rows } = await db.query<{ id: string; predicate_key: string; subject_label: string; status: string; confidence: string; provenance_class: string }>(
    `select id, predicate_key, subject_label, status, confidence, provenance_class from facts where company_id = $1 and status <> 'REJECTED' order by confidence desc limit 20`, [companyId]);
  return rows.map((f) => {
    const trust = [] as FactItem["trust"];
    if (f.status === "CURRENT") trust.push("VERIFIED"); else if (f.status === "DISPUTED") trust.push("DISPUTED"); else if (f.status === "STALE") trust.push("STALE"); else if (f.status === "SUPERSEDED") trust.push("SUPERSEDED");
    if (f.provenance_class === "FIRST_PARTY" || f.provenance_class === "CUSTOMER_DECLARED") trust.push("FIRST_PARTY");
    if (f.provenance_class === "HUMAN_ASSERTED") trust.push("HUMAN_ASSERTED");
    return { id: f.id, proposition: `${f.subject_label} — ${f.predicate_key.replace(/_/g, " ")}`, state: f.status, trust, confidence: scoreView("evidence_confidence", Number(f.confidence) * 100) };
  });
}

interface WhyNowRaw {
  as_of?: string;
  business_trigger?: { fact_id?: string; predicate?: string; label?: string } | null;
  technology_condition?: { fact_id?: string; predicate?: string; label?: string } | null;
  timing_anchor?: { fact_id?: string; predicate?: string; date?: string | null } | null;
  signal_convergence?: { independent_family_count?: number } | null;
  partner_route_relevance?: { shareable?: { text: string }[] } | null;
  contradictory_evidence?: { basis: string }[] | null;
}
function numOrNull(v: string | null): number | null { return v == null ? null : Number(v); }
function brief(o: Record<string, unknown> | null): string | null { if (!o) return null; const k = Object.keys(o)[0]; return k ? `${o[k]}` : null; }
