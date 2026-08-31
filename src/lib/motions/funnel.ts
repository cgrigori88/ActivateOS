import type { PoolClient } from "pg";

/**
 * Motion Intelligence read-models (Intelligence Wave P1A). The commercial hypothesis funnel and
 * its constraint decomposition, DERIVED at read time from canonical records only — propensity,
 * pursuits, route snapshots/candidates/disqualifiers, the governed team lifecycle, motion status,
 * canonical outcomes + attribution. No stored funnel counters, no new readiness score, no new
 * qualification model: every gate reads a stored canonical object and every constraint uses the
 * existing vocabulary (route disqualifier codes, readiness roles, team statuses, motion statuses,
 * timing UNKNOWN). A blocker is never inferred from an unrelated empty field.
 *
 * The hypothesis level is the EXISTING structure: a taxonomy node that carries revenue_motions
 * (the play/slug + propensity + Pursuit/Motion substrate) — deliberately NOT a new motion_targets
 * membership table.
 *
 * ATTRIBUTION BOUNDARY (P0.3): outcome rollups here use ONLY the canonical attribution taxonomy
 * (attribution.attribution_class, human override wins). Settlement's registration-based
 * vocabulary never appears on this surface.
 */

export type ConstraintSeverity = "HARD" | "SOFT" | "UNKNOWN";
export interface MotionConstraint {
  code: string;                        // canonical vocabulary — never invented
  label: string;
  severity: ConstraintSeverity;
  gating: boolean;                     // gates execution-readiness (informational overlays do not)
  refType: string | null;
  refId: string | null;
  remedy: { label: string; skill?: string; deepLink: string } | null;
}

export type Cohort = "ready" | "nearly_ready" | "blocked" | "unknown";

export interface FunnelAccount {
  companyId: string;
  name: string;
  band: string;
  score: number;
  pursuitId: string | null;
  expectedValue: number | null;
  cohort: Cohort;
  constraints: MotionConstraint[];     // gating first, then informational
}

export interface MotionFunnelStage { key: string; label: string; count: number }

export interface MotionFunnelView {
  hypothesis: {
    taxonomyNodeId: string; slug: string; name: string;
    thesis: string | null;             // the most recent motion's thesis — why this Motion exists
    motionCounts: Record<string, number>;
  };
  stages: MotionFunnelStage[];
  addressableUsd: number | null;       // Σ expected_value_weighted over qualified accounts
  readyUsd: number | null;             // Σ over execution-ready accounts
  cohorts: Record<Cohort, number>;
  accounts: FunnelAccount[];           // ranked by expected value within materiality; capped
  outcomes: {
    pursuitsActivated: number;         // motions active on this hypothesis
    opportunitiesCreated: number;      // canonical linkage only
    won: number; lost: number; noDecision: number;
    byAttributionClass: Record<string, number>;   // EFFECTIVE class (human override wins)
    sample: number;                    // terminal canonical outcomes observed
    calibrated: boolean;               // sample >= MIN_CALIBRATED_SAMPLE
  };
  truncated: boolean;                  // account list capped for scale
}

const QUALIFYING_BANDS = new Set(["very_high", "high"]);
const MIN_CALIBRATED_SAMPLE = 5;       // below this, render observations, never conclusions
const ACCOUNT_CAP = 2000;              // defensive scale guard; stages still count the full set
const WEAK_EVIDENCE_BELOW = 40;
const CONTESTED_WITHIN = 6;            // the existing Accounts-pane route-conflict rule

const ROLE = (r: string) => r.replace(/_/g, " ").toLowerCase();

interface GateRow {
  companyId: string; name: string; band: string; score: number;
  pursuitId: string | null; pursuitType: string | null;
  timing: number | null; evidence: number | null; expectedValue: number | null;
  snapshotId: string | null; routeStatus: string | null; viableCandidates: number; disqCodes: string[];
  acceptedRoles: string[]; invitedRoles: string[]; requiredRoles: string[];
  motionStatuses: string[];
  stakeholderGapRoles: string[];       // from linked opportunities' stakeholder map (informational)
  contested: boolean;                  // two partner relationship strengths within CONTESTED_WITHIN
}

/** All hypotheses (taxonomy nodes carrying motions) with their live funnels. */
export async function getMotionFunnels(
  db: PoolClient, orgId: string, opts: { companyIds?: string[] | null } = {},
): Promise<MotionFunnelView[]> {
  const hyps = await db.query<{ id: string; slug: string; name: string; thesis: string | null; statuses: string[] }>(
    `select n.id, n.slug, n.name,
            (select m2.thesis from revenue_motions m2 where m2.taxonomy_node_id = n.id and m2.org_id = $1 order by m2.created_at desc limit 1) thesis,
            array_agg(m.status) statuses
       from revenue_motions m join taxonomy_nodes n on n.id = m.taxonomy_node_id
      where m.org_id = $1 group by n.id, n.slug, n.name order by n.name`, [orgId]);
  const out: MotionFunnelView[] = [];
  for (const h of hyps.rows) {
    const counts: Record<string, number> = {};
    for (const s of h.statuses) counts[s] = (counts[s] ?? 0) + 1;
    out.push(await buildFunnel(db, orgId, { id: h.id, slug: h.slug, name: h.name, thesis: h.thesis, motionCounts: counts }, opts));
  }
  return out;
}

/** Full constraint decomposition for one account within one hypothesis (the drill-in). */
export async function getMotionConstraints(
  db: PoolClient, orgId: string, taxonomyNodeId: string, companyId: string,
): Promise<{ account: FunnelAccount | null }> {
  const node = (await db.query<{ id: string; slug: string; name: string }>(`select id, slug, name from taxonomy_nodes where id = $1`, [taxonomyNodeId])).rows[0];
  if (!node) return { account: null };
  const view = await buildFunnel(db, orgId, { id: node.id, slug: node.slug, name: node.name, thesis: null, motionCounts: {} }, { companyIds: [companyId] });
  return { account: view.accounts[0] ?? null };
}

async function buildFunnel(
  db: PoolClient, orgId: string,
  hyp: { id: string; slug: string; name: string; thesis: string | null; motionCounts: Record<string, number> },
  opts: { companyIds?: string[] | null },
): Promise<MotionFunnelView> {
  const scoped = opts.companyIds != null;
  const ids = opts.companyIds ?? [];

  // Evaluated = latest propensity per company on this node (scope narrows, never widens).
  const evaluated = await db.query<{ company_id: string; legal_name: string; band: string; score: string }>(
    `select distinct on (p.company_id) p.company_id, c.legal_name, p.band, p.score
       from propensity_scores p join companies c on c.id = p.company_id
      where p.taxonomy_node_id = $1 and (p.org_id is null or p.org_id = $2)
        and ($4::boolean is false or p.company_id = any($3))
      order by p.company_id, p.computed_at desc`, [hyp.id, orgId, ids, scoped]);
  const companyIds = evaluated.rows.map((r) => r.company_id);

  const rows: GateRow[] = evaluated.rows.map((r) => ({
    companyId: r.company_id, name: r.legal_name, band: r.band, score: Number(r.score),
    pursuitId: null, pursuitType: null, timing: null, evidence: null, expectedValue: null,
    snapshotId: null, routeStatus: null, viableCandidates: 0, disqCodes: [],
    acceptedRoles: [], invitedRoles: [], requiredRoles: [],
    motionStatuses: [], stakeholderGapRoles: [], contested: false,
  }));
  const byCompany = new Map(rows.map((r) => [r.companyId, r]));

  if (companyIds.length > 0) {
    // Pursuits on (org, account, node). Where several exist, the funnel evaluates the account's
    // BEST pursuit (most gates passed) — asking "can at least one pursuit here move", which needs
    // no linkage guess. Fetched flat; representative chosen in JS.
    const pursuits = await db.query<{
      id: string; account_id: string; pursuit_type: string | null; status: string;
      timing: string | null; evidence: string | null; ev: string | null;
      snapshot_id: string | null; route_status: string | null; viable: string | null; disq: string[] | null;
    }>(
      `select pu.id, pu.account_id, pu.pursuit_type, pu.status,
              pu.current_timing_score timing, pu.current_evidence_confidence_score evidence, pu.expected_value_weighted ev,
              s.id snapshot_id, s.route_status,
              (select count(*) from route_candidates rc where rc.route_snapshot_id = s.id and not rc.disqualified)::text viable,
              (select array_agg(distinct d.code) from route_candidates rc join route_candidate_disqualifiers d on d.candidate_id = rc.id
                where rc.route_snapshot_id = s.id) disq
         from pursuits pu
         left join pursuit_route_snapshots s on s.pursuit_id = pu.id and s.is_current
        where pu.org_id = $1 and pu.product_category_id = $2 and pu.account_id = any($3)
          and pu.status not in ('WON','LOST','DISQUALIFIED') and pu.merged_into_pursuit_id is null`,
      [orgId, hyp.id, companyIds]);

    const pursuitIds = pursuits.rows.map((p) => p.id);
    // Team truth per pursuit (canonical pursuit_team_members — NEVER the legacy pursuit_teams).
    const teamAgg = pursuitIds.length
      ? await db.query<{ pursuit_id: string; accepted: string[] | null; invited: string[] | null }>(
          `select pursuit_id,
                  array_agg(distinct role) filter (where status in ('ACCEPTED','ACTIVE')) accepted,
                  array_agg(distinct role) filter (where status = 'INVITED') invited
             from pursuit_team_members where pursuit_id = any($1) and status <> 'SUPERSEDED' group by pursuit_id`, [pursuitIds])
      : { rows: [] as { pursuit_id: string; accepted: string[] | null; invited: string[] | null }[] };
    const teamBy = new Map(teamAgg.rows.map((t) => [t.pursuit_id, t]));
    const reqRows = await db.query<{ pursuit_type: string | null; role: string }>(
      `select pursuit_type, role from pursuit_team_requirements
        where required = true and (org_id is null or org_id = $1)`, [orgId]);
    const reqFor = (pt: string | null) => reqRows.rows.filter((r) => r.pursuit_type == null || r.pursuit_type === pt).map((r) => r.role);

    // Stakeholder coverage where existing data supports it (linked opportunities' stakeholder map).
    const gaps = pursuitIds.length
      ? await db.query<{ pursuit_id: string; has_eb: boolean }>(
          `select o.pursuit_id, bool_or(exists (select 1 from stakeholders st where st.opportunity_id = o.id and st.role = 'economic_buyer')) has_eb
             from opportunities o where o.pursuit_id = any($1) group by o.pursuit_id`, [pursuitIds])
      : { rows: [] as { pursuit_id: string; has_eb: boolean }[] };
    const gapBy = new Map(gaps.rows.map((g) => [g.pursuit_id, g.has_eb]));

    // Pick each account's representative pursuit = most gates passed (deterministic tiebreak by id).
    for (const p of pursuits.rows) {
      const row = byCompany.get(p.account_id);
      if (!row) continue;
      const team = teamBy.get(p.id);
      const required = reqFor(p.pursuit_type);
      const accepted = new Set(team?.accepted ?? []);
      const cand = {
        pursuitId: p.id, pursuitType: p.pursuit_type,
        timing: p.timing == null ? null : Number(p.timing),
        evidence: p.evidence == null ? null : Number(p.evidence),
        expectedValue: p.ev == null ? null : Number(p.ev),
        snapshotId: p.snapshot_id, routeStatus: p.route_status,
        viableCandidates: Number(p.viable ?? 0), disqCodes: p.disq ?? [],
        acceptedRoles: team?.accepted ?? [], invitedRoles: team?.invited ?? [], requiredRoles: required,
        stakeholderGapRoles: gapBy.has(p.id) && !gapBy.get(p.id) ? ["economic_buyer"] : [],
      };
      const passes = (c: typeof cand) =>
        (c.snapshotId && c.viableCandidates > 0 ? 1 : 0) + (c.routeStatus === "SELECTED" ? 1 : 0) +
        (c.timing != null ? 1 : 0) + (c.requiredRoles.every((r) => accepted.has(r)) ? 1 : 0);
      const currentPasses = row.pursuitId
        ? (row.snapshotId && row.viableCandidates > 0 ? 1 : 0) + (row.routeStatus === "SELECTED" ? 1 : 0) +
          (row.timing != null ? 1 : 0) + (row.requiredRoles.every((r) => new Set(row.acceptedRoles).has(r)) ? 1 : 0)
        : -1;
      if (passes(cand) > currentPasses || (passes(cand) === currentPasses && (row.pursuitId == null || cand.pursuitId < row.pursuitId))) {
        Object.assign(row, cand);
      }
    }

    // Motion instance statuses per company on this node.
    const ms = await db.query<{ company_id: string; statuses: string[] }>(
      `select company_id, array_agg(status) statuses from revenue_motions
        where org_id = $1 and taxonomy_node_id = $2 and company_id = any($3) group by company_id`, [orgId, hyp.id, companyIds]);
    for (const m of ms.rows) { const r = byCompany.get(m.company_id); if (r) r.motionStatuses = m.statuses; }

    // Route contested overlay — the existing Accounts-pane rule: top-2 partner strengths within 6.
    const contested = await db.query<{ company_id: string }>(
      `select company_id from (
         select pr.company_id, max(pr.strength) - (array_agg(pr.strength order by pr.strength desc))[2] gap, count(*) n
           from partner_relationships pr join partners p on p.id = pr.partner_id
          where p.org_id = $1 and pr.company_id = any($2) group by pr.company_id
       ) x where n >= 2 and gap is not null and gap <= ${CONTESTED_WITHIN}`, [orgId, companyIds]);
    for (const c of contested.rows) { const r = byCompany.get(c.company_id); if (r) r.contested = true; }
  }

  // ---- Assemble constraints + cohorts (pure derivation) ----------------------------------------
  const accounts: FunnelAccount[] = rows.map((r) => {
    const constraints = decompose(r);
    return {
      companyId: r.companyId, name: r.name, band: r.band, score: r.score,
      pursuitId: r.pursuitId, expectedValue: r.expectedValue,
      cohort: classify(constraints), constraints,
    };
  });
  accounts.sort((a, b) => (b.expectedValue ?? -1) - (a.expectedValue ?? -1));

  const qualified = accounts.filter((a) => QUALIFYING_BANDS.has(a.band));
  const has = (a: FunnelAccount, code: string) => a.constraints.some((c) => c.gating && (c.code === code || c.code.startsWith(code + ":")));
  const routeViable = qualified.filter((a) => !has(a, "NO_PURSUIT") && !has(a, "NO_ROUTE_SNAPSHOT") && !has(a, "ROUTE_DISQUALIFIED"));
  const timingVerified = routeViable.filter((a) => !has(a, "TIMING_UNKNOWN"));
  const teamReady = timingVerified.filter((a) => !has(a, "TEAM_ROLE_MISSING") && !has(a, "ACCEPTANCE_PENDING"));
  const ready = accounts.filter((a) => a.cohort === "ready");

  const cohorts: Record<Cohort, number> = { ready: 0, nearly_ready: 0, blocked: 0, unknown: 0 };
  for (const a of accounts) cohorts[a.cohort]++;
  const sum = (xs: FunnelAccount[]) => { const v = xs.reduce((s, a) => s + (a.expectedValue ?? 0), 0); return v > 0 ? v : null; };

  // ---- Canonical outcome rollup (P1A.4) --------------------------------------------------------
  const oc = await db.query<{ activated: string; opps: string; won: string; lost: string; nodecision: string; sample: string }>(
    `select
       (select count(*) from revenue_motions m where m.org_id=$1 and m.taxonomy_node_id=$2 and m.status='active')::text activated,
       (select count(*) from opportunities o join pursuits pu on pu.id=o.pursuit_id
         where pu.org_id=$1 and pu.product_category_id=$2)::text opps,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id=po.pursuit_id
         where pu.org_id=$1 and pu.product_category_id=$2 and po.outcome_label='CLOSED_WON')::text won,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id=po.pursuit_id
         where pu.org_id=$1 and pu.product_category_id=$2 and po.outcome_label='CLOSED_LOST')::text lost,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id=po.pursuit_id
         where pu.org_id=$1 and pu.product_category_id=$2 and po.outcome_label='NO_DECISION')::text nodecision,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id=po.pursuit_id
         where pu.org_id=$1 and pu.product_category_id=$2 and po.is_terminal)::text sample`, [orgId, hyp.id]);
  const byClass = await db.query<{ cls: string; n: string }>(
    `select coalesce(a.human_override_class, a.attribution_class) cls, count(*)::text n
       from attribution a join pursuits pu on pu.id = a.pursuit_id
      where pu.org_id = $1 and pu.product_category_id = $2 group by 1`, [orgId, hyp.id]);
  const o = oc.rows[0];
  const sample = Number(o.sample);

  return {
    hypothesis: { taxonomyNodeId: hyp.id, slug: hyp.slug, name: hyp.name, thesis: hyp.thesis, motionCounts: hyp.motionCounts },
    stages: [
      { key: "evaluated", label: "evaluated", count: accounts.length },
      { key: "qualified", label: "qualify", count: qualified.length },
      { key: "route_viable", label: "route-viable", count: routeViable.length },
      { key: "timing_verified", label: "timing verified", count: timingVerified.length },
      { key: "team_ready", label: "team ready", count: teamReady.length },
      { key: "execution_ready", label: "execution-ready", count: ready.length },
    ],
    addressableUsd: sum(qualified), readyUsd: sum(ready),
    cohorts,
    accounts: accounts.slice(0, ACCOUNT_CAP),
    outcomes: {
      pursuitsActivated: Number(o.activated), opportunitiesCreated: Number(o.opps),
      won: Number(o.won), lost: Number(o.lost), noDecision: Number(o.nodecision),
      byAttributionClass: Object.fromEntries(byClass.rows.map((r) => [r.cls, Number(r.n)])),
      sample, calibrated: sample >= MIN_CALIBRATED_SAMPLE,
    },
    truncated: accounts.length > ACCOUNT_CAP,
  };
}

/** The gate ladder → canonical constraints. Order = the funnel's own order; gating first. */
function decompose(r: GateRow): MotionConstraint[] {
  const cs: MotionConstraint[] = [];
  const pd = (path: string) => (r.pursuitId ? { label: "Open pursuit", deepLink: `/pursuits/${r.pursuitId}${path}` } : null);

  if (!QUALIFYING_BANDS.has(r.band)) {
    cs.push({ code: "BELOW_PROPENSITY_BAND", label: `Propensity ${r.band.replace(/_/g, " ")} (${Math.round(r.score)}) — below the qualifying band`, severity: "SOFT", gating: true, refType: "propensity", refId: null, remedy: { label: "Open account", deepLink: `/accounts/${r.companyId}` } });
  }
  if (!r.pursuitId) {
    cs.push({ code: "NO_PURSUIT", label: "No canonical pursuit on this category", severity: "SOFT", gating: true, refType: "pursuit", refId: null, remedy: { label: "Open account", deepLink: `/accounts/${r.companyId}` } });
  } else {
    if (!r.snapshotId) {
      cs.push({ code: "NO_ROUTE_SNAPSHOT", label: "No route computed yet", severity: "SOFT", gating: true, refType: "route", refId: null, remedy: pd("#route") });
    } else if (r.viableCandidates === 0) {
      const codes = r.disqCodes.length ? r.disqCodes : ["NO_VIABLE_CANDIDATE"];
      for (const code of codes.slice(0, 3)) {
        cs.push({ code: `ROUTE_DISQUALIFIED:${code}`, label: `No viable route — ${code.replace(/_/g, " ").toLowerCase()}`, severity: "HARD", gating: true, refType: "route_snapshot", refId: r.snapshotId, remedy: pd("#route") });
      }
    } else if (r.routeStatus !== "SELECTED") {
      cs.push({ code: "ROUTE_DECISION_PENDING", label: "Route recommended — governed decision pending", severity: "SOFT", gating: true, refType: "route_snapshot", refId: r.snapshotId, remedy: { label: "Decide route", skill: "select_partner_route", deepLink: `/pursuits/${r.pursuitId}#route` } });
    }
    if (r.timing == null) {
      cs.push({ code: "TIMING_UNKNOWN", label: "Timing UNKNOWN — no verified anchor", severity: "UNKNOWN", gating: true, refType: "pursuit", refId: r.pursuitId, remedy: pd("") });
    }
    const accepted = new Set(r.acceptedRoles);
    const invited = new Set(r.invitedRoles);
    for (const role of r.requiredRoles) {
      if (accepted.has(role)) continue;
      if (invited.has(role)) {
        cs.push({ code: `ACCEPTANCE_PENDING:${role}`, label: `Waiting on ${ROLE(role)} to accept`, severity: "SOFT", gating: true, refType: "team", refId: r.pursuitId, remedy: { label: "Mark accepted", skill: "accept_team_member", deepLink: `/pursuits/${r.pursuitId}#team` } });
      } else {
        cs.push({ code: `TEAM_ROLE_MISSING:${role}`, label: `Required role not staffed: ${ROLE(role)}`, severity: "SOFT", gating: true, refType: "team", refId: r.pursuitId, remedy: { label: "Confirm team", skill: "confirm_team_member", deepLink: `/pursuits/${r.pursuitId}#team` } });
      }
    }
  }
  const open = r.motionStatuses.filter((s) => s === "approved" || s === "active");
  if (open.length === 0) {
    if (r.motionStatuses.includes("draft")) {
      cs.push({ code: "MOTION_NOT_APPROVED", label: "Motion drafted — approval pending", severity: "SOFT", gating: true, refType: "motion", refId: null, remedy: { label: "Approve motion", skill: "approve_motion", deepLink: `/motions?status=draft` } });
    } else {
      cs.push({ code: "NO_MOTION_INSTANCE", label: "Motion not yet drafted for this account", severity: "SOFT", gating: true, refType: "motion", refId: null, remedy: { label: "Draft motions", deepLink: `/motions?compose=1` } });
    }
  }

  // Informational overlays — real canonical signals that do NOT gate execution-readiness
  // (their gates belong to other models; asserting them as blockers would invent a relationship).
  if (r.evidence != null && r.evidence < WEAK_EVIDENCE_BELOW) {
    cs.push({ code: "WEAK_EVIDENCE", label: `Evidence confidence low (${Math.round(r.evidence)})`, severity: "SOFT", gating: false, refType: "pursuit", refId: r.pursuitId, remedy: r.pursuitId ? { label: "Review evidence", deepLink: `/pursuits/${r.pursuitId}` } : null });
  }
  if (r.contested) {
    cs.push({ code: "ROUTE_CONTESTED", label: "Two partners within 6 relationship points — route contested", severity: "SOFT", gating: false, refType: "relationship", refId: null, remedy: r.pursuitId ? { label: "Compare routes", deepLink: `/pursuits/${r.pursuitId}#route` } : null });
  }
  for (const role of r.stakeholderGapRoles) {
    cs.push({ code: `STAKEHOLDER_GAP:${role}`, label: `No verified ${ROLE(role)} on the linked opportunity`, severity: "UNKNOWN", gating: false, refType: "stakeholders", refId: r.pursuitId, remedy: null });
  }
  return cs;
}

/** Cohorts (P1A.3) from gating constraints only. UNKNOWN stays its own cohort — never "blocked". */
function classify(constraints: MotionConstraint[]): Cohort {
  const gating = constraints.filter((c) => c.gating);
  if (gating.length === 0) return "ready";
  if (gating.every((c) => c.severity === "UNKNOWN")) return "unknown";
  const real = gating.filter((c) => c.severity !== "UNKNOWN");
  if (real.length === 1 && real[0].severity === "SOFT") return "nearly_ready";
  return "blocked";
}

/** Accounts that PASS a given funnel stage (same predicates the stage counts use). */
export function accountsAtStage(view: MotionFunnelView, stage: string): FunnelAccount[] {
  const has = (a: FunnelAccount, code: string) => a.constraints.some((c) => c.gating && (c.code === code || c.code.startsWith(code + ":")));
  const qualified = (a: FunnelAccount) => QUALIFYING_BANDS.has(a.band);
  const routeViable = (a: FunnelAccount) => qualified(a) && !has(a, "NO_PURSUIT") && !has(a, "NO_ROUTE_SNAPSHOT") && !has(a, "ROUTE_DISQUALIFIED");
  const timing = (a: FunnelAccount) => routeViable(a) && !has(a, "TIMING_UNKNOWN");
  const team = (a: FunnelAccount) => timing(a) && !has(a, "TEAM_ROLE_MISSING") && !has(a, "ACCEPTANCE_PENDING");
  switch (stage) {
    case "evaluated": return view.accounts;
    case "qualified": return view.accounts.filter(qualified);
    case "route_viable": return view.accounts.filter(routeViable);
    case "timing_verified": return view.accounts.filter(timing);
    case "team_ready": return view.accounts.filter(team);
    case "execution_ready": return view.accounts.filter((a) => a.cohort === "ready");
    case "not_ready": return view.accounts.filter((a) => a.cohort !== "ready");
    default: return view.accounts.filter((a) => a.cohort === stage);   // cohort keys drill too
  }
}

/**
 * Today's material-intervention signal (P1A.6): expected value held ONLY by participant
 * acceptance, per hypothesis. One cheap grouped query — not the full funnel — and surfaced only
 * past the materiality floor, so Today stays exceptions-only.
 */
export const ACCEPTANCE_BLOCK_FLOOR_USD = 100_000;
export async function motionAcceptanceBlockage(
  db: PoolClient, orgId: string,
): Promise<{ taxonomyNodeId: string; name: string; blockedUsd: number; pursuits: number }[]> {
  const { rows } = await db.query<{ node_id: string; name: string; usd: string | null; n: string }>(
    `select n.id node_id, n.name, sum(pu.expected_value_weighted) usd, count(distinct pu.id)::text n
       from pursuit_team_members tm
       join pursuits pu on pu.id = tm.pursuit_id
       join taxonomy_nodes n on n.id = pu.product_category_id
      where pu.org_id = $1 and tm.status = 'INVITED'
        and pu.status not in ('WON','LOST','DISQUALIFIED')
        and exists (select 1 from revenue_motions m
                     where m.org_id = pu.org_id and m.taxonomy_node_id = pu.product_category_id
                       and m.company_id = pu.account_id and m.status in ('approved','active'))
      group by n.id, n.name`, [orgId]);
  return rows
    .map((r) => ({ taxonomyNodeId: r.node_id, name: r.name, blockedUsd: Number(r.usd ?? 0), pursuits: Number(r.n) }))
    .filter((r) => r.blockedUsd >= ACCEPTANCE_BLOCK_FLOOR_USD);
}
