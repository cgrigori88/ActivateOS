import type { PoolClient } from "pg";

/**
 * Seller / Partner Intelligence read-models (Intelligence Wave P1B). READ-FIRST: nothing here
 * mutates, nothing feeds back into route scoring (fit-v2 is a deliberately deferred, versioned
 * decision), and NO composite partner score exists — presence, relationship, activation,
 * execution, outcomes and attribution are separate truths that are valuable precisely because
 * they can disagree.
 *
 * RELATIONSHIP SUBSTRATE BOUNDARIES (approved design):
 *  - presence/overlap  = list membership (`account_populations`/`population_members`,
 *    `partner_accounts`) — an import truth; carries NO strength.
 *  - claims            = a partner's customer/open_opportunity list membership — a stated book,
 *    not a verified relationship.
 *  - relationship tier = `partner_relationships` strength (human-asserted; ACTIVE ≥60, OVERLAP >0)
 *    and `seller_account_relationships` with temporal decay — the strength truth.
 *  - participation     = consented joint execution (`joint_pursuits`, team acceptance) — the
 *    behavioral truth.
 * They are presented TOGETHER but never merged; a disagreement (present everywhere, activating
 * rarely) is itself the intelligence.
 *
 * ATTRIBUTION BOUNDARY (P0.3): execution/outcome figures here use ONLY canonical
 * `pursuit_outcomes` + `attribution` (effective class = human override ?? machine). The
 * settlement module's registration-based sourced/influenced stays in its own bounded context
 * (partner-room scorecard) and is labeled there.
 */

export interface PartnerActivationProfile {
  partnerId: string;
  name: string;
  presence: {
    overlapAccounts: number;           // distinct companies on this partner's lists/imports
    claimedAccounts: number;           // on their customer/open_opportunity lists
    relationshipTiers: { tier: string; count: number }[];   // asserted-strength distribution
  };
  activation: {
    candidateIn: number;               // current route snapshots where they are a candidate
    recommendedIn: number;
    selectedIn: number;                // the governed human decision chose them (live pursuits)
    jointRoomsActive: number;          // consented joint pursuits (partnership substrate)
    askedToAccept: number;             // team invitations issued (invited_at stamped)
    accepted: number;
    declined: number;
    pendingNow: number;                // INVITED right now
    medianAcceptDays: number | null;   // null = UNKNOWN (no timestamped pairs) — never zero
    acceptSample: number;              // pairs behind the median — always shown beside it
  };
  execution: {
    won: number; lost: number; noDecision: number;
    byAttributionClass: Record<string, number>;   // canonical EFFECTIVE classes only
    byCategory: { taxonomyNodeId: string; name: string; won: number; lost: number }[];
    sample: number;                    // terminal canonical outcomes on their selected pursuits
  };
  blocking: { pursuitId: string; account: string; role: string; waitingDays: number }[];
  coverageGaps: { companyId: string; account: string; gap: "NO_RELATIONSHIP" | "NO_NAMED_SELLER" }[];
}

const ROLE = (r: string) => r.replace(/_/g, " ").toLowerCase();

export async function getPartnerActivationProfile(
  db: PoolClient, orgId: string, partnerId: string, opts: { companyIds?: string[] | null } = {},
): Promise<PartnerActivationProfile | null> {
  const p = (await db.query<{ id: string; name: string }>(`select id, name from partners where id = $1 and org_id = $2`, [partnerId, orgId])).rows[0];
  if (!p) return null;
  const scoped = opts.companyIds != null;
  const ids = opts.companyIds ?? [];

  // ---- Presence (list truth — no strength) ----------------------------------------------------
  const presence = (await db.query<{ overlap: string; claimed: string }>(
    `select
       (select count(distinct company_id) from (
          select pa.company_id from partner_accounts pa where pa.partner_id = $1 and pa.org_id = $2
          union
          select pm.company_id from population_members pm
            join account_populations ap on ap.id = pm.population_id
           where ap.partner_id = $1 and ap.org_id = $2
        ) u where ($4::boolean is false or u.company_id = any($3)))::text overlap,
       (select count(distinct pm.company_id) from population_members pm
          join account_populations ap on ap.id = pm.population_id
         where ap.partner_id = $1 and ap.org_id = $2 and ap.category in ('customer','open_opportunity')
           and ($4::boolean is false or pm.company_id = any($3)))::text claimed`,
    [partnerId, orgId, ids, scoped])).rows[0];

  const tiers = (await db.query<{ tier: string; n: string }>(
    `select case when strength >= 60 then 'ACTIVE_RELATIONSHIP' when strength > 0 then 'ACCOUNT_OVERLAP' else 'NONE' end tier,
            count(*)::text n
       from partner_relationships where partner_id = $1
        and ($3::boolean is false or company_id = any($2))
      group by 1 order by 1`, [partnerId, ids, scoped])).rows;

  // ---- Activation (behavioral truth) ----------------------------------------------------------
  const act = (await db.query<{ cand: string; rec: string; sel: string; joint: string }>(
    `select
       (select count(distinct s.pursuit_id) from route_candidates rc
          join pursuit_route_snapshots s on s.id = rc.route_snapshot_id
          join pursuits pu on pu.id = s.pursuit_id
         where rc.partner_id = $1 and s.is_current and pu.org_id = $2
           and ($4::boolean is false or pu.account_id = any($3)))::text cand,
       (select count(distinct s.pursuit_id) from route_candidates rc
          join pursuit_route_snapshots s on s.id = rc.route_snapshot_id
          join pursuits pu on pu.id = s.pursuit_id
         where rc.partner_id = $1 and rc.is_recommended and s.is_current and pu.org_id = $2
           and ($4::boolean is false or pu.account_id = any($3)))::text rec,
       (select count(*) from pursuits pu where pu.selected_partner_id = $1 and pu.org_id = $2
           and pu.status not in ('WON','LOST','DISQUALIFIED')
           and ($4::boolean is false or pu.account_id = any($3)))::text sel,
       (select count(*) from joint_pursuits jp
          join partnerships pr on pr.id = jp.partnership_id
         where jp.status = 'active'
           and (pr.initiator_partner_id = $1 or pr.counterpart_partner_id = $1))::text joint`,
    [partnerId, orgId, ids, scoped])).rows[0];

  // Acceptance behavior — timestamps only; a missing invited/accepted pair is UNKNOWN, and a
  // missing acceptance record is NEVER counted as a decline (only status DECLINED is).
  const acc = (await db.query<{ asked: string; accepted: string; declined: string; pending: string; median_days: string | null; sample: string }>(
    `select
       count(*) filter (where tm.invited_at is not null)::text asked,
       count(*) filter (where tm.status in ('ACCEPTED','ACTIVE'))::text accepted,
       count(*) filter (where tm.status = 'DECLINED')::text declined,
       count(*) filter (where tm.status = 'INVITED')::text pending,
       (percentile_cont(0.5) within group (order by extract(epoch from tm.accepted_at - tm.invited_at) / 86400)
          filter (where tm.accepted_at is not null and tm.invited_at is not null))::text median_days,
       count(*) filter (where tm.accepted_at is not null and tm.invited_at is not null)::text sample
       from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
      where tm.partner_id = $1 and pu.org_id = $2 and tm.status <> 'SUPERSEDED'
        and ($4::boolean is false or pu.account_id = any($3))`,
    [partnerId, orgId, ids, scoped])).rows[0];

  // ---- Execution (canonical outcomes + attribution ONLY) --------------------------------------
  const exec = (await db.query<{ label: string; n: string }>(
    `select po.outcome_label label, count(*)::text n
       from pursuit_outcomes po join pursuits pu on pu.id = po.pursuit_id
      where pu.org_id = $1 and pu.selected_partner_id = $2 and po.is_terminal
        and ($4::boolean is false or pu.account_id = any($3))
      group by 1`, [orgId, partnerId, ids, scoped])).rows;
  const label = (k: string) => Number(exec.find((e) => e.label === k)?.n ?? 0);
  const classes = (await db.query<{ cls: string; n: string }>(
    `select coalesce(a.human_override_class, a.attribution_class) cls, count(*)::text n
       from attribution a where a.org_id = $1 and a.subject_kind = 'PARTNER' and a.subject_id = $2
      group by 1`, [orgId, partnerId])).rows;
  const byCategory = (await db.query<{ node_id: string; name: string; won: string; lost: string }>(
    `select n.id node_id, n.name,
            count(*) filter (where po.outcome_label = 'CLOSED_WON')::text won,
            count(*) filter (where po.outcome_label = 'CLOSED_LOST')::text lost
       from pursuit_outcomes po
       join pursuits pu on pu.id = po.pursuit_id
       join taxonomy_nodes n on n.id = pu.product_category_id
      where pu.org_id = $1 and pu.selected_partner_id = $2 and po.is_terminal
      group by n.id, n.name order by n.name`, [orgId, partnerId])).rows;

  // ---- Blocking now + coverage gaps ------------------------------------------------------------
  const blocking = (await db.query<{ pursuit_id: string; account: string; role: string; days: string }>(
    `select tm.pursuit_id, c.legal_name account, tm.role,
            floor(extract(epoch from now() - coalesce(tm.invited_at, tm.created_at)) / 86400)::text days
       from pursuit_team_members tm
       join pursuits pu on pu.id = tm.pursuit_id
       join companies c on c.id = pu.account_id
      where tm.partner_id = $1 and pu.org_id = $2 and tm.status = 'INVITED'
        and pu.status not in ('WON','LOST','DISQUALIFIED')
      order by 4 desc limit 10`, [partnerId, orgId])).rows;

  const gaps = (await db.query<{ company_id: string; account: string; gap: string }>(
    `with overlap as (
       select pa.company_id from partner_accounts pa where pa.partner_id = $1 and pa.org_id = $2
       union
       select pm.company_id from population_members pm
         join account_populations ap on ap.id = pm.population_id
        where ap.partner_id = $1 and ap.org_id = $2)
     select o.company_id, c.legal_name account,
            case when not exists (select 1 from partner_relationships pr where pr.partner_id = $1 and pr.company_id = o.company_id and pr.strength > 0)
                 then 'NO_RELATIONSHIP' else 'NO_NAMED_SELLER' end gap
       from overlap o join companies c on c.id = o.company_id
      where not exists (select 1 from partner_relationships pr where pr.partner_id = $1 and pr.company_id = o.company_id and pr.strength > 0)
         or not exists (select 1 from seller_account_relationships sar join sellers s on s.id = sar.seller_id
                         where s.partner_id = $1 and sar.company_id = o.company_id and sar.strength > 0)
      order by c.legal_name limit 12`, [partnerId, orgId])).rows;

  return {
    partnerId, name: p.name,
    presence: {
      overlapAccounts: Number(presence.overlap), claimedAccounts: Number(presence.claimed),
      relationshipTiers: tiers.map((t) => ({ tier: t.tier, count: Number(t.n) })),
    },
    activation: {
      candidateIn: Number(act.cand), recommendedIn: Number(act.rec), selectedIn: Number(act.sel),
      jointRoomsActive: Number(act.joint),
      askedToAccept: Number(acc.asked), accepted: Number(acc.accepted), declined: Number(acc.declined),
      pendingNow: Number(acc.pending),
      medianAcceptDays: acc.median_days == null ? null : Math.round(Number(acc.median_days) * 10) / 10,
      acceptSample: Number(acc.sample),
    },
    execution: {
      won: label("CLOSED_WON"), lost: label("CLOSED_LOST"), noDecision: label("NO_DECISION"),
      byAttributionClass: Object.fromEntries(classes.map((c) => [c.cls, Number(c.n)])),
      byCategory: byCategory.map((b) => ({ taxonomyNodeId: b.node_id, name: b.name, won: Number(b.won), lost: Number(b.lost) })),
      sample: exec.reduce((s, e) => s + Number(e.n), 0),
    },
    blocking: blocking.map((b) => ({ pursuitId: b.pursuit_id, account: b.account, role: ROLE(b.role), waitingDays: Number(b.days) })),
    coverageGaps: gaps.map((g) => ({ companyId: g.company_id, account: g.account, gap: g.gap as "NO_RELATIONSHIP" | "NO_NAMED_SELLER" })),
  };
}

/** Compact per-partner headline chips for the Partners index + Insights (grouped, cheap). */
export interface PartnerHeadline {
  partnerId: string; name: string;
  overlap: number; selected: number; accepted: number; pending: number;
  medianAcceptDays: number | null; acceptSample: number;
  won: number; sample: number;
}
export async function partnerActivationHeadlines(db: PoolClient, orgId: string): Promise<PartnerHeadline[]> {
  const { rows } = await db.query<{ id: string; name: string; overlap: string; sel: string; acc: string; pend: string; med: string | null; sample: string; won: string; osample: string }>(
    `select p.id, p.name,
       (select count(distinct u.company_id) from (
          select pa.company_id from partner_accounts pa where pa.partner_id = p.id and pa.org_id = $1
          union
          select pm.company_id from population_members pm join account_populations ap on ap.id = pm.population_id
           where ap.partner_id = p.id and ap.org_id = $1) u)::text overlap,
       (select count(*) from pursuits pu where pu.selected_partner_id = p.id and pu.org_id = $1
          and pu.status not in ('WON','LOST','DISQUALIFIED'))::text sel,
       (select count(*) from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
         where tm.partner_id = p.id and pu.org_id = $1 and tm.status in ('ACCEPTED','ACTIVE'))::text acc,
       (select count(*) from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
         where tm.partner_id = p.id and pu.org_id = $1 and tm.status = 'INVITED')::text pend,
       (select (percentile_cont(0.5) within group (order by extract(epoch from tm.accepted_at - tm.invited_at) / 86400))::text
          from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
         where tm.partner_id = p.id and pu.org_id = $1 and tm.accepted_at is not null and tm.invited_at is not null) med,
       (select count(*) from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
         where tm.partner_id = p.id and pu.org_id = $1 and tm.accepted_at is not null and tm.invited_at is not null)::text sample,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id = po.pursuit_id
         where pu.org_id = $1 and pu.selected_partner_id = p.id and po.outcome_label = 'CLOSED_WON')::text won,
       (select count(*) from pursuit_outcomes po join pursuits pu on pu.id = po.pursuit_id
         where pu.org_id = $1 and pu.selected_partner_id = p.id and po.is_terminal)::text osample
       from partners p where p.org_id = $1 order by p.name`, [orgId]);
  return rows.map((r) => ({
    partnerId: r.id, name: r.name, overlap: Number(r.overlap), selected: Number(r.sel),
    accepted: Number(r.acc), pending: Number(r.pend),
    medianAcceptDays: r.med == null ? null : Math.round(Number(r.med) * 10) / 10, acceptSample: Number(r.sample),
    won: Number(r.won), sample: Number(r.osample),
  }));
}

/**
 * Seller paths into one account (P1B.5). Preserves the five relationship tiers and temporal decay
 * (recency multiplies strength exactly as the seller-fit model does); NULL recency renders
 * UNKNOWN, never a fabricated freshness. Ownership ≠ recommendation: this lists evidence-ranked
 * paths, it does not assign anyone.
 */
export interface SellerPath {
  sellerId: string; name: string; partnerLabel: string | null;   // null = vendor seller
  tier: string; strength: number | null;                          // decayed 0..100; null = none
  recency: "fresh" | "stale" | "UNKNOWN"; lastAt: string | null;
  assignedOnLivePursuit: boolean;                                 // sits on an ACCEPTED/ACTIVE team here
}
export async function getSellerPaths(db: PoolClient, orgId: string, companyId: string): Promise<SellerPath[]> {
  const { rows } = await db.query<{ seller_id: string; name: string; partner_name: string | null; strength: string; last_at: Date | null; assigned: boolean }>(
    `select s.id seller_id, s.name, pn.name partner_name, sar.strength, sar.last_interaction_at last_at,
            exists (select 1 from pursuit_team_members tm join pursuits pu on pu.id = tm.pursuit_id
                     where tm.seller_id = s.id and pu.account_id = $2 and pu.org_id = $1
                       and tm.status in ('ACCEPTED','ACTIVE') and pu.status not in ('WON','LOST','DISQUALIFIED')) assigned
       from seller_account_relationships sar
       join sellers s on s.id = sar.seller_id
       left join partners pn on pn.id = s.partner_id
      where sar.company_id = $2 and s.org_id = $1 and sar.strength > 0`, [orgId, companyId]);
  const DAY = 86_400_000;
  const paths: SellerPath[] = rows.map((r) => {
    const days = r.last_at ? (Date.now() - r.last_at.getTime()) / DAY : null;
    // The canonical decay (relationship.ts recencyFactor): unknown → neutral 0.5, displayed UNKNOWN.
    const factor = days == null ? 0.5 : days <= 90 ? 1 : days >= 730 ? 0.2 : 1 - 0.8 * ((days - 90) / 640);
    const strength = Number(r.strength) * factor;
    const tier = strength >= 60 ? "SELLER_RELATIONSHIP" : strength > 0 ? "ACTIVE_RELATIONSHIP" : "NONE";
    return {
      sellerId: r.seller_id, name: r.name, partnerLabel: r.partner_name,
      tier, strength: Math.round(strength),
      recency: days == null ? "UNKNOWN" : days <= 90 ? "fresh" : "stale",
      lastAt: r.last_at ? r.last_at.toISOString() : null,
      assignedOnLivePursuit: r.assigned,
    };
  });
  paths.sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  return paths;
}

/**
 * "Where should I use this partner?" (UX normalization §5) — the OBSERVED activation pattern.
 * Groups this partner's existing route/execution evidence by category × asserted relationship
 * state and reports, per cell: pursuits where they appeared as a candidate, where the governed
 * decision selected them, where they accepted, and the terminal canonical outcomes — each with
 * its sample size. NOT a composite score, NOT a route-scoring input (fit-v2 stays deferred);
 * cells below the calibrated-sample floor say "insufficient evidence", and a partner with no
 * evidence at all is UNKNOWN — never fabricated.
 */
const MIN_CALIBRATED_SAMPLE = 5;   // below this, render observations, never conclusions (same floor as motions/funnel.ts)

export interface ObservedActivationRow {
  taxonomyNodeId: string | null; category: string;
  relationshipState: "ACTIVE_RELATIONSHIP" | "ACCOUNT_OVERLAP" | "NONE";
  segments: string[];                                   // industries observed in this cell — descriptor, not a dimension claim
  candidate: number; selected: number; accepted: number;
  outcomes: { won: number; lost: number; sample: number };   // terminal canonical outcomes on selected pursuits
  sufficient: boolean;                                  // outcomes.sample ≥ calibrated floor
}
export interface ObservedActivationPattern {
  rows: ObservedActivationRow[];
  evidencePursuits: number;                             // distinct pursuits behind the whole pattern
  status: "OBSERVED" | "INSUFFICIENT" | "UNKNOWN";      // UNKNOWN = no evidence at all, honestly
}

export async function getObservedActivationPattern(
  db: PoolClient, orgId: string, partnerId: string,
): Promise<ObservedActivationPattern> {
  const { rows } = await db.query<{
    node_id: string | null; category: string; rel: string; segs: string[] | null;
    cand: string; sel: string; acc: string; won: string; lost: string; osample: string;
  }>(
    `with pp as (
       select pu.id, pu.product_category_id, pu.account_id,
              (pu.selected_partner_id = $2) as selected
         from pursuits pu
        where pu.org_id = $1
          and (pu.selected_partner_id = $2
               or exists (select 1 from pursuit_route_snapshots s
                            join route_candidates rc on rc.route_snapshot_id = s.id
                           where s.pursuit_id = pu.id and s.is_current and rc.partner_id = $2)))
     select n.id node_id, coalesce(n.name, 'Uncategorized') category,
            case when pr.strength >= 60 then 'ACTIVE_RELATIONSHIP'
                 when pr.strength > 0 then 'ACCOUNT_OVERLAP' else 'NONE' end rel,
            array_agg(distinct c.industry) filter (where c.industry is not null) segs,
            count(*)::text cand,
            count(*) filter (where pp.selected)::text sel,
            count(*) filter (where exists (select 1 from pursuit_team_members tm
                                            where tm.pursuit_id = pp.id and tm.partner_id = $2
                                              and tm.status in ('ACCEPTED','ACTIVE')))::text acc,
            count(*) filter (where pp.selected and exists (select 1 from pursuit_outcomes po
                               where po.pursuit_id = pp.id and po.is_terminal and po.outcome_label = 'CLOSED_WON'))::text won,
            count(*) filter (where pp.selected and exists (select 1 from pursuit_outcomes po
                               where po.pursuit_id = pp.id and po.is_terminal and po.outcome_label = 'CLOSED_LOST'))::text lost,
            count(*) filter (where pp.selected and exists (select 1 from pursuit_outcomes po
                               where po.pursuit_id = pp.id and po.is_terminal))::text osample
       from pp
       join companies c on c.id = pp.account_id
       left join taxonomy_nodes n on n.id = pp.product_category_id
       left join partner_relationships pr on pr.partner_id = $2 and pr.company_id = pp.account_id
      group by 1, 2, 3
      order by count(*) desc, 2`, [orgId, partnerId]);

  const out: ObservedActivationRow[] = rows.map((r) => ({
    taxonomyNodeId: r.node_id, category: r.category,
    relationshipState: r.rel as ObservedActivationRow["relationshipState"],
    segments: r.segs ?? [],
    candidate: Number(r.cand), selected: Number(r.sel), accepted: Number(r.acc),
    outcomes: { won: Number(r.won), lost: Number(r.lost), sample: Number(r.osample) },
    sufficient: Number(r.osample) >= MIN_CALIBRATED_SAMPLE,
  }));
  const evidencePursuits = out.reduce((s, r) => s + r.candidate, 0);
  return {
    rows: out, evidencePursuits,
    status: evidencePursuits === 0 ? "UNKNOWN" : out.some((r) => r.sufficient) ? "OBSERVED" : "INSUFFICIENT",
  };
}

/**
 * Execution-history EVIDENCE for a route candidate (P1B.2). Displayed beside the existing
 * dimensions on the compare — explicitly NOT an input to any score. Canonical outcomes +
 * attribution only; INTERNAL disclosure with a GENERALIZED substitute so the partner rendering
 * generalizes it exactly like other reasons.
 */
export interface ExecutionEvidence {
  won: number; lost: number; noDecision: number; sample: number;
  medianDaysToOutcome: number | null;
  classMix: Record<string, number>;
  lines: { text: string; polarity: 1 | -1 | 0; refType: string; refId: string | null }[];
}
export async function getExecutionEvidence(
  db: PoolClient, orgId: string, partnerId: string, taxonomyNodeId: string | null,
): Promise<ExecutionEvidence> {
  const { rows } = await db.query<{ label: string; n: string; med: string | null }>(
    `select po.outcome_label label, count(*)::text n,
            (percentile_cont(0.5) within group (order by po.seconds_since_recommended / 86400.0))::text med
       from pursuit_outcomes po join pursuits pu on pu.id = po.pursuit_id
      where pu.org_id = $1 and pu.selected_partner_id = $2 and po.is_terminal
        and ($3::uuid is null or pu.product_category_id = $3)
      group by 1`, [orgId, partnerId, taxonomyNodeId]);
  const g = (k: string) => Number(rows.find((r) => r.label === k)?.n ?? 0);
  const won = g("CLOSED_WON"), lost = g("CLOSED_LOST"), noDecision = g("NO_DECISION");
  const sample = rows.reduce((s, r) => s + Number(r.n), 0);
  const medRaw = rows.find((r) => r.med != null)?.med;
  const classMix = Object.fromEntries((await db.query<{ cls: string; n: string }>(
    `select coalesce(a.human_override_class, a.attribution_class) cls, count(*)::text n
       from attribution a join pursuits pu on pu.id = a.pursuit_id
      where a.org_id = $1 and a.subject_kind = 'PARTNER' and a.subject_id = $2
        and ($3::uuid is null or pu.product_category_id = $3)
      group by 1`, [orgId, partnerId, taxonomyNodeId])).rows.map((r) => [r.cls, Number(r.n)]));

  const lines: ExecutionEvidence["lines"] = [];
  if (sample === 0) {
    lines.push({ text: "No canonical execution history in this category yet", polarity: 0, refType: "outcome", refId: null });
  } else {
    const mix = Object.entries(classMix).map(([k, v]) => `${v} ${k}`).join(", ");
    lines.push({
      text: `${won} won · ${lost} lost${noDecision ? ` · ${noDecision} no decision` : ""} (canonical${mix ? ` · attribution ${mix}` : ""})`,
      polarity: won > lost ? 1 : won < lost ? -1 : 0, refType: "pursuit_outcomes", refId: null,
    });
    if (medRaw != null) lines.push({ text: `Median ${Math.round(Number(medRaw))}d recommendation → outcome`, polarity: 0, refType: "pursuit_outcomes", refId: null });
    if (sample < 5) lines.push({ text: `Sample of ${sample} — too small for calibrated conclusions`, polarity: 0, refType: "outcome", refId: null });
  }
  return { won, lost, noDecision, sample, medianDaysToOutcome: medRaw == null ? null : Math.round(Number(medRaw)), classMix, lines };
}
