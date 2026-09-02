import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { enabledTriggers } from "@/lib/triggers/catalog";
import { renewalProjection } from "@/lib/lifecycle/projection";
import { loadLifecycleFacts, eventsForAccount, primaryLifecycleEvent, STATE_LABEL, type LifecycleEvent } from "@/lib/lifecycle/state";
import {
  STAGE_PROBABILITY,
  STAGES,
  stakeholderGaps,
  weightedPipelineValue,
  type Stage,
} from "@/lib/opportunities/lifecycle";
import { Bento, Card, MiniBar, PageHeader, StatusBadge, SectionHeading, Disclosure, SummaryBand, buttonClass, fieldClass, BlockLabel } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { segmentClass, segmentTrackClass } from "@/components/segmented";
import {
  ELEMENTS,
  STATUS_LABEL,
  STATUS_TONE,
  meddpiccFor,
  meddpiccScore,
  meddpiccGaps,
  type Status,
} from "@/lib/opportunities/meddpicc";
import { quoteSignals } from "@/lib/opportunities/quotes";
import { dealMomentum, MOMENTUM_LABEL } from "@/lib/opportunities/momentum";
import {
  advanceOpportunityAction,
  assignInitiativeAction,
  decideWritebackAction,
  draftWritebacksAction,
  registerDealAction,
  setRegistrationStatusAction,
  setStakeholderAction,
  setMeddpiccAction,
  assessMeddpiccAction,
} from "./actions";
import { initiativeOptions } from "@/lib/partnerships/initiatives";
import { listWritebacks } from "@/lib/opportunities/writeback";
import { opportunityAutopsy, type Autopsy } from "@/lib/opportunities/autopsy";
import { getScopeContext, scopeParamFrom } from "@/lib/scope/server";
import { opportunityCondition, type ConditionState } from "@/lib/opportunities/condition";
import { buildPortfolio, availableDims, type PortfolioOpp, type RowDim, type ColDim } from "@/lib/opportunities/portfolio";
import { PortfolioMatrix } from "@/components/pipeline/portfolio-matrix";
import { PipelineAllTable } from "@/components/pipeline/all-table";
import { getAccountIntel } from "@/lib/accounts/intel";
import { IntelDrawer } from "@/components/intel/intel-drawer";
import { formatMoney } from "@/lib/format/money";
import { OperatingModel } from "@/components/operating-model";

const MEDDPICC_STATUSES: Status[] = ["unknown", "gap", "weak", "strong"];

export const dynamic = "force-dynamic";
// AI drafting actions invoked from this segment can run tens of seconds —
// raise the serverless limit so generation never dies as a platform timeout.
export const maxDuration = 60;

const ROLES = ["economic_buyer", "technical_buyer", "champion", "influencer", "blocker", "end_user"];
const SENTIMENTS = ["unknown", "positive", "neutral", "negative"];

interface DealReg {
  id: string;
  opportunity_id: string | null;
  vendor: string | null;
  product: string | null;
  status: string;
  protected_until: string | null;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qp = (k: string): string | undefined => { const v = sp[k]; return typeof v === "string" ? v : undefined; };
  // Progressive views (§3): Attention (intervention now) · Portfolio (where exposure concentrates) ·
  // All (the exhaustive dataset, compact) · Review (deal registration — capability preserved).
  const view = (["attention", "portfolio", "all", "review"].includes(qp("view") ?? "") ? qp("view") : "attention") as "attention" | "portfolio" | "all" | "review";
  const timeframe = ["7", "30", "90"].includes(qp("timeframe") ?? "") ? Number(qp("timeframe")) : null;
  // Ecosystem scope (§1): narrow the whole board to the authorized company-id set. Re-authorized server-side.
  const scope = await getScopeContext(scopeParamFrom(sp));
  const scopeIds = scope.companyIds;
  // Portfolio pivot dimensions + drill-in condition filter.
  const prow = (qp("prow") ?? "partner") as RowDim;
  const pcol = (qp("pcol") ?? "condition") as ColDim;
  const condFilter = (["at_risk", "stalling", "healthy"].includes(qp("cond") ?? "") ? qp("cond") : undefined) as ConditionState | undefined;

  // RISK-1 adoption (task #67): all reads run under withTenant, which pins the
  // session to the caller's org. Inert on the owner connection; real isolation
  // once DATABASE_URL points at app_rw.
  const {
    opps, open, total, weighted, regRows, tieOut, writebacks, approvedWb,
    calibration, renewals, scoreOf, quoteOf, probOf, qualOf, partnerOptions,
    visible, stakeholdersByOpp, regByOpp, meddpicc, momentum, initiativeOpts,
    autopsies, ecoByCompany,
  } = await withTenant(async (db, orgId) => {
  const { rows: allOpps } = await db.query(
    `select o.id, o.name, o.stage, o.amount_usd, o.next_step, o.expected_close_date, o.updated_at,
            o.company_id, c.legal_name, n.slug, o.motion_id, o.initiative_id,
            pa.name as partner_name, m.partner_id, mn.name as motion_hypothesis
     from opportunities o
     join companies c on c.id = o.company_id
     left join taxonomy_nodes n on n.id = o.taxonomy_node_id
     left join revenue_motions m on m.id = o.motion_id
     left join taxonomy_nodes mn on mn.id = m.taxonomy_node_id
     left join partners pa on pa.id = m.partner_id
     where ($2::boolean is false or o.company_id = any($1))
     order by o.updated_at desc`,
    [scopeIds ?? [], scopeIds != null],
  );

  // Ecosystem map (§3.2 / R4): each in-scope company's primary seller and, through it, vendor and
  // territory — the ecosystem dimensions the Portfolio pivots over. Primary = strongest relationship.
  const { rows: ecoRows } = await db.query<{ company_id: string; seller: string | null; vendor: string | null; territory: string | null }>(
    `select distinct on (r.company_id) r.company_id, s.name seller, v.name vendor, s.territory
       from seller_account_relationships r
       join sellers s on s.id = r.seller_id and s.org_id = $1
       left join vendors v on v.id = s.vendor_id
      order by r.company_id, r.strength desc nulls last`,
    [orgId],
  );
  const ecoByCompany = new Map(ecoRows.map((r) => [r.company_id, { seller: r.seller, vendor: r.vendor, territory: r.territory }]));

  // Renewal radar (B+3, RECONCILED in P2A §5): the co-sell clock, now read from the canonical
  // fact graph through the one-way projection instead of re-interpreting the import JSON. It
  // therefore sees customer-confirmed dates, inferred windows and contradictions — and it states
  // which it is rather than printing every row as a confirmed day. Engagement quiet = decay risk;
  // the partners column is who to attach before the clock runs out.
  const radarOn = (await enabledTriggers(db, orgId)).has("renewal_window");
  const renewalRows = radarOn ? await renewalProjection(db, orgId, { days: 120, limit: 12 }) : [];
  const renewalIds = renewalRows.map((r) => r.companyId);
  const engagementByCompany = new Map<string, number>();
  const partnersByRenewal = new Map<string, string[]>();
  if (renewalIds.length) {
    const { rows: eng } = await db.query<{ company_id: string; score: string }>(
      `select company_id, max(engagement_score) as score
       from engagement_scores where company_id = any($1) group by company_id`,
      [renewalIds],
    );
    for (const e of eng) engagementByCompany.set(e.company_id, Number(e.score));
    const { rows: pns } = await db.query<{ company_id: string; partners: string[] }>(
      `select pm.company_id, array_agg(distinct p.name order by p.name) as partners
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
         and ap.org_id = $2 and ap.partner_id is not null and ap.status = 'approved'
       join partners p on p.id = ap.partner_id
       where pm.company_id = any($1) group by pm.company_id`,
      [renewalIds, orgId],
    );
    for (const r of pns) partnersByRenewal.set(r.company_id, r.partners);
  }
  const renewals = renewalRows.map((r) => ({
    ...r,
    openUsd: allOpps
      .filter((o) => o.company_id === r.companyId && !["closed_won", "closed_lost"].includes(o.stage))
      .reduce((s, o) => s + Number(o.amount_usd ?? 0), 0),
    engagement: engagementByCompany.get(r.companyId) ?? null,
    partners: partnersByRenewal.get(r.companyId) ?? [],
  }));

  // Timeframe filter: opportunities whose expected close falls within N days.
  const horizon = timeframe ? Date.now() + timeframe * 86_400_000 : null;
  const opps = horizon
    ? allOpps.filter((o) => o.expected_close_date && new Date(o.expected_close_date).getTime() <= horizon)
    : allOpps;

  const { rows: stakeholderRows } = await db.query(
    `select s.opportunity_id, s.contact_id, s.role, s.sentiment, s.assertion_state, ct.name, ct.email
     from stakeholders s join contacts ct on ct.id = s.contact_id
     where s.opportunity_id = any($1)`,
    [opps.map((o) => o.id)],
  );
  const stakeholdersByOpp = new Map<string, typeof stakeholderRows>();
  for (const s of stakeholderRows) {
    const list = stakeholdersByOpp.get(s.opportunity_id) ?? [];
    list.push(s);
    stakeholdersByOpp.set(s.opportunity_id, list);
  }

  const { rows: regRows } = await db.query<DealReg>(
    `select id, opportunity_id, vendor, product, status, protected_until
     from deal_registrations where opportunity_id = any($1)
     order by created_at desc`,
    [opps.map((o) => o.id)],
  );
  const regByOpp = new Map<string, DealReg>();
  for (const r of regRows) if (r.opportunity_id && !regByOpp.has(r.opportunity_id)) regByOpp.set(r.opportunity_id, r);

  const meddpicc = await meddpiccFor(db, opps.map((o) => o.id));
  const scoreOf = (id: string) => {
    const m = meddpicc.get(id);
    return m ? meddpiccScore(m) : 0;
  };

  // Initiatives (task #83): the named targets an opportunity can roll into.
  const initiativeOpts = await initiativeOptions(db, orgId);

  // CRM writeback queue (slice A): corrections the tie-out proposes back.
  const writebacks = await listWritebacks(db, orgId);
  const approvedWb = writebacks.filter((w) => w.status === "approved").length;

  // Win/loss autopsies (slice E): the deterministic post-mortem on every
  // closed deal — what happened, assembled from the record, no opinions.
  const autopsies = new Map<string, Autopsy>();
  for (const o of opps.filter((x) => x.stage.startsWith("closed")).slice(0, 12)) {
    const a = await opportunityAutopsy(db, orgId, o.id);
    if (a) autopsies.set(o.id, a);
  }

  // Quote-delivered signal, read from each opportunity's email conversation.
  const quotes = await quoteSignals(db, opps.map((o) => o.id));
  const quoteOf = (id: string) => quotes.get(id) ?? { delivered: false, note: null, at: null };

  // Deal momentum (task #88): observed behavior beside the declared stage —
  // deterministic, cross-company aware (joint-room activity counts).
  const momentum = await dealMomentum(
    db,
    orgId,
    opps.map((o) => ({
      id: o.id,
      companyId: o.company_id,
      stage: o.stage,
      updatedAt: o.updated_at,
      quote: quoteOf(o.id),
    })),
  );

  // Atomic filters (apply to both board and review; bentos/chart stay on the
  // full timeframe set so the totals don't move as you slice).
  const partnerOptions = [...new Set(allOpps.map((o) => o.partner_name).filter(Boolean) as string[])];
  const qualOf = (id: string) => (scoreOf(id) >= 70 ? "strong" : scoreOf(id) < 40 ? "risk" : "ok");

  // Lifecycle filter (P2A §8) — deliberately RESTRAINED: three states an operator actually acts on,
  // slotted in beside the existing atomic filters. No new dashboard, no new score, no new column.
  // UNKNOWN is not offered here on purpose: Accounts already answers "where do we know nothing",
  // and a pipeline view of deals-with-no-lifecycle-evidence is noise, not an action.
  const lifecycleByCompany = new Map<string, LifecycleEvent>();
  const lifeIds = [...new Set(opps.map((o) => o.company_id).filter(Boolean))] as string[];
  if (lifeIds.length) {
    for (const [cid, rows] of await loadLifecycleFacts(db, orgId, lifeIds)) {
      const primary = primaryLifecycleEvent(eventsForAccount(rows));
      if (primary && primary.state !== "UNKNOWN") lifecycleByCompany.set(cid, primary);
    }
  }
  const lifeOf = (companyId: string | null) => (companyId ? lifecycleByCompany.get(companyId) ?? null : null);
  const lifeMatch = (companyId: string | null) => {
    const f = qp("life");
    if (!f || f === "all") return true;
    const e = lifeOf(companyId);
    if (!e) return false;
    if (f === "renew90") {
      return (e.state === "VERIFIED_DATE" || e.state === "INFERRED_WINDOW")
        && e.daysUntil != null && e.daysUntil >= 0 && e.daysUntil <= 90;
    }
    if (f === "conflicting") return e.state === "CONFLICTING_DATE";
    if (f === "stale") return e.state === "STALE_DATE";
    return true;
  };

  // Value Case filter (P2B §14) — a compact context field beside the existing atomic filters.
  // No new dashboard, no new score: it reads the derived state the Pursuit already carries.
  const valueByCompany = new Map<string, string>();
  if (qp("value") && qp("value") !== "all") {
    const { getValueCase } = await import("@/lib/value/case");
    const rows = (await db.query<{ id: string; account_id: string }>(
      `select id, account_id from pursuits where org_id = $1 and account_id = any($2)`,
      [orgId, [...new Set(opps.map((o) => o.company_id).filter(Boolean))] as string[]])).rows;
    for (const r of rows) {
      const vc = await getValueCase(db, orgId, r.id);
      if (vc) valueByCompany.set(r.account_id, vc.state);
    }
  }
  const valueMatch = (companyId: string | null) => {
    const f = qp("value");
    if (!f || f === "all") return true;
    if (!companyId) return false;
    const st = valueByCompany.get(companyId) ?? "NOT_ESTABLISHED";
    return f === "strong" ? st === "STRONG"
      : f === "conflicting" ? st === "CONFLICTING"
        : f === "incomplete" ? st === "INCOMPLETE"
          : f === "none" ? st === "NOT_ESTABLISHED" : true;
  };

  const visible = opps.filter(
    (o) =>
      valueMatch(o.company_id) &&
      (!qp("stage") || qp("stage") === "all" || o.stage === qp("stage")) &&
      (!qp("partner") || qp("partner") === "all" || (o.partner_name ?? "Direct") === qp("partner")) &&
      (!qp("quote") || qp("quote") === "all" || (qp("quote") === "yes" ? quoteOf(o.id).delivered : !quoteOf(o.id).delivered)) &&
      (!qp("qual") || qp("qual") === "all" || qualOf(o.id) === qp("qual")) &&
      lifeMatch(o.company_id),
  );

  const open = opps.filter((o) => !o.stage.startsWith("closed"));
  // Stage weights: the org's editable curve (Insights → calibration card),
  // with per-partner overrides applied to deals attributed to that partner.
  const stageWeights = await loadStageWeights(db, orgId);
  const probOf = (o: { partner_id: string | null; stage: string }) =>
    stageWeights.weightFor(o.partner_id ?? null, o.stage as Stage);
  const weighted = weightedPipelineValue(
    opps.map((o) => ({
      stage: o.stage as Stage,
      amountUsd: o.amount_usd ? Number(o.amount_usd) : null,
      probability: probOf(o),
    })),
  );
  const total = open.reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);

  // ── Tie-out (task #87): does the number tie out — across systems? ──
  // The CRM's latest word per opportunity vs the live record, per account,
  // plus a daily snapshot so number drift has history instead of hearsay.
  const tieOrgId = orgId;
  let tieOut: {
    crmUsd: number;
    liveUsd: number;
    weightedUsd: number;
    deltas: { companyId: string; account: string; crm: number; live: number }[];
    weekAgo: { openUsd: number; takenOn: string } | null;
  } | null = null;
  const calibration: {
    takenOn: string; weightedUsd: number; openUsd: number;
    wonUsd: number; wonN: number; lostUsd: number; lostN: number;
  }[] = [];
  if (tieOrgId) {
    const { rows: crmByCompany } = await db.query<{ company_id: string; legal_name: string; crm: string }>(
      `select s.company_id, c.legal_name, sum(s.amount_usd) as crm
       from (select distinct on (company_id, lower(opportunity_name)) company_id, opportunity_name, amount_usd, stage
             from crm_snapshots where org_id = $1
             order by company_id, lower(opportunity_name), reported_at desc) s
       join companies c on c.id = s.company_id
       where s.stage not in ('closed_won', 'closed_lost') and s.amount_usd is not null
       group by s.company_id, c.legal_name`,
      [tieOrgId],
    );
    if (crmByCompany.length > 0) {
      const liveByCompany = new Map<string, number>();
      for (const o of allOpps) {
        if (o.stage.startsWith("closed")) continue;
        liveByCompany.set(o.company_id, (liveByCompany.get(o.company_id) ?? 0) + Number(o.amount_usd ?? 0));
      }
      const crmUsd = crmByCompany.reduce((s, r) => s + Number(r.crm), 0);
      const liveUsd = crmByCompany.reduce((s, r) => s + (liveByCompany.get(r.company_id) ?? 0), 0);
      const deltas = crmByCompany
        .map((r) => ({
          companyId: r.company_id,
          account: r.legal_name,
          crm: Number(r.crm),
          live: liveByCompany.get(r.company_id) ?? 0,
        }))
        .filter((d) => Math.abs(d.crm - d.live) >= 1)
        .sort((a, b) => Math.abs(b.crm - b.live) - Math.abs(a.crm - a.live))
        .slice(0, 5);
      const { rows: weekAgoRows } = await db.query<{ open_usd: string; taken_on: string }>(
        `select open_usd, taken_on::text from pipeline_snapshots
         where org_id = $1 and taken_on <= (now() - interval '6 days')::date
         order by taken_on desc limit 1`,
        [tieOrgId],
      );
      tieOut = {
        crmUsd,
        liveUsd,
        weightedUsd: weighted,
        deltas,
        weekAgo: weekAgoRows[0] ? { openUsd: Number(weekAgoRows[0].open_usd), takenOn: weekAgoRows[0].taken_on } : null,
      };
      // Forecast calibration (meets/beats batch): what the weighted pipeline
      // said N days ago vs what actually closed since. The forecast is
      // measured against reality, not just displayed.
      const { rows: calRows } = await db.query<{ taken_on: string; weighted_usd: string; open_usd: string }>(
        `select distinct on (bucket) taken_on::text, weighted_usd, open_usd
         from (
           select *, case when taken_on <= (now() - interval '55 days')::date then 60
                          when taken_on <= (now() - interval '25 days')::date then 30
                     end as bucket
           from pipeline_snapshots where org_id = $1
         ) x where bucket is not null
         order by bucket, taken_on desc`,
        [tieOrgId],
      );
      for (const snap of calRows) {
        const { rows: realized } = await db.query<{ won_usd: string; won_n: string; lost_usd: string; lost_n: string }>(
          `select coalesce(sum(amount_usd) filter (where stage = 'closed_won'), 0) as won_usd,
                  count(*) filter (where stage = 'closed_won') as won_n,
                  coalesce(sum(amount_usd) filter (where stage = 'closed_lost'), 0) as lost_usd,
                  count(*) filter (where stage = 'closed_lost') as lost_n
           from opportunities where org_id = $1 and closed_at >= $2::date`,
          [tieOrgId, snap.taken_on],
        );
        calibration.push({
          takenOn: snap.taken_on,
          weightedUsd: Number(snap.weighted_usd),
          openUsd: Number(snap.open_usd),
          wonUsd: Number(realized[0].won_usd),
          wonN: Number(realized[0].won_n),
          lostUsd: Number(realized[0].lost_usd),
          lostN: Number(realized[0].lost_n),
        });
      }
    }
    // Today's snapshot, idempotent — history accrues just by looking.
    await db.query(
      `insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd)
       values ($1, now()::date, $2, $3, $4, $5)
       on conflict (org_id, taken_on) do update
         set open_count = excluded.open_count, open_usd = excluded.open_usd,
             weighted_usd = excluded.weighted_usd, crm_usd = excluded.crm_usd`,
      [tieOrgId, open.length, total, weighted, tieOut?.crmUsd ?? null],
    );
  }

  return {
    opps, open, total, weighted, regRows, tieOut, writebacks, approvedWb,
    calibration, renewals, scoreOf, quoteOf, probOf, qualOf, partnerOptions,
    visible, stakeholdersByOpp, regByOpp, meddpicc, momentum, initiativeOpts,
    autopsies, ecoByCompany,
  };
  });

  // Normalize the visible book into canonical pivot rows (§3.2): partner from the motion, seller /
  // vendor / territory from the ecosystem map, condition from the shared canonical classifier.
  const portfolioOpps: PortfolioOpp[] = visible.map((o) => {
    const eco = ecoByCompany.get(o.company_id);
    const closed = o.stage.startsWith("closed");
    const cond = opportunityCondition({ stage: o.stage, updatedAt: o.updated_at }, momentum.get(o.id));
    const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
    return {
      amountUsd: amt, weighted: closed ? 0 : (amt ?? 0) * probOf(o), stage: o.stage, closed,
      condition: cond.state, partner: o.partner_name ?? null,
      vendor: eco?.vendor ?? null, territory: eco?.territory ?? null, seller: eco?.seller ?? null,
      motion: o.motion_hypothesis ?? null,
    };
  });
  const dims = availableDims(portfolioOpps);
  const safeRow: RowDim = dims.rows.includes(prow) ? prow : (dims.rows[0] ?? "partner");
  const safeCol: ColDim = dims.cols.includes(pcol) && pcol !== (safeRow as string) ? pcol : (dims.cols.find((cInner) => cInner !== (safeRow as string)) ?? "condition");
  const portfolio = buildPortfolio(portfolioOpps, safeRow, safeCol, [...STAGES, "closed_won", "closed_lost"]);
  // Attention view (§3.1): intervention-worthy opps only, materiality-ordered, honoring drill-in filters.
  const attentionVisible = visible.filter((o) => {
    if (o.stage.startsWith("closed")) return false;
    const cond = opportunityCondition({ stage: o.stage, updatedAt: o.updated_at }, momentum.get(o.id));
    if (!cond.needsAttention) return false;
    return !condFilter || cond.state === condFilter;
  });

  // Contextual intelligence drawer (§4 / R7): body fetched (and serialized) ONLY when ?drawer= is
  // present — closed drawers leak nothing. Reuses getAccountIntel (the viewer's RLS-scoped projection).
  const drawerId = qp("drawer");
  const drawerIntel = drawerId ? await withTenant((db) => getAccountIntel(db, drawerId)) : null;
  // Preserve the whole view (filters, scope, sort) across open/close — the drawer never navigates away.
  const preserved = new URLSearchParams();
  for (const k of ["view", "timeframe", "stage", "partner", "quote", "qual", "scope", "prow", "pcol", "cond", "life", "value"] as const) { const v = qp(k); if (v) preserved.set(k, v); }
  const drawerHref = (companyId: string) => { const p = new URLSearchParams(preserved); p.set("drawer", companyId); return `/pipeline?${p.toString()}`; };
  const drawerCloseHref = `/pipeline${preserved.toString() ? `?${preserved.toString()}` : ""}`;
  const drawerBase = preserved.toString();

  return (
    <main>
      <PageHeader
        title="Pipeline"
        subtitle="The revenue the motions produced — what condition it is in, and where to intervene."
      />

      {/* Wave 3 §2/§6: the consequence layer of the model, and the way back up it.
          `opportunities.motion_id` is the real edge — every opportunity here names
          the motion that produced it — so "Motion" is a true link, not a gesture. */}
      <OperatingModel
        current="pipeline"
        steps={{
          goal: { href: "/goals", detail: "the number this rolls into" },
          motion: { href: "/motions", detail: "the plays that produced these" },
          pursuit: { href: "/pursuits", detail: "the account-level work" },
          /* §10: this is the WHOLE book, not a goal's slice. A reader arriving from
             a goal that reports its own open pipeline would otherwise read two
             different totals for what looks like the same measure — they are the
             same measure over different scopes, and the label says which. */
          pipeline: { label: `${open.length} open`, detail: `${formatMoney(open.reduce((s, o) => s + Number(o.amount_usd ?? 0), 0))} across every motion` },
        }}
      />

      {(() => {
        const wonCount = opps.filter((o) => o.stage === "closed_won").length;
        const wonUsd = opps.filter((o) => o.stage === "closed_won").reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);
        const stageCounts = new Map<string, number>();
        for (const o of open) stageCounts.set(o.stage, (stageCounts.get(o.stage) ?? 0) + 1);
        // Show every open stage, including the empty ones, so the shape of the
        // funnel is always visible.
        const stageRows = STAGES.map((s) => ({ label: s.replace(/_/g, " "), value: stageCounts.get(s) ?? 0 }));
        const avgQual = open.length ? Math.round(open.reduce((s, o) => s + scoreOf(o.id), 0) / open.length) : null;
        // Learned signal: qualification strength of past wins vs losses.
        const avg = (list: typeof opps) => (list.length ? Math.round(list.reduce((s, o) => s + scoreOf(o.id), 0) / list.length) : null);
        const wonQual = avg(opps.filter((o) => o.stage === "closed_won"));
        const lostQual = avg(opps.filter((o) => o.stage === "closed_lost"));
        return (
          <>
            <SummaryBand className="mb-3">
              <Bento label="open opportunities" value={open.length} href="/pipeline" />
              <Bento label="total pipeline" value={`${formatMoney(total)}`} />
              <Bento label="weighted" value={`${formatMoney(weighted)}`} subs={["by stage probability"]} />
              <Bento label="avg qualification" value={avgQual == null ? "—" : `${avgQual}`} subs={["MEDDPICC health"]} />
              <Bento label="won" value={wonCount} intent="positive" subs={[`${formatMoney(wonUsd)}`]} href="/pipeline?stage=closed_won" />
              {/* §11 KPI overload: registered deals is a governance count that reads
                  zero in most tenants. It keeps its tile only when it has something
                  to report; the Review view is one tab away regardless. */}
              {regRows.length > 0 && <Bento label="registered deals" value={regRows.length} href="/pipeline?view=review" />}
            </SummaryBand>

            {/* ── Tie-out (task #87): one place where the numbers reconcile ── */}
            {tieOut && (
              <Card className="mb-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <BlockLabel>Does it tie out?</BlockLabel>
                  <span className="text-label text-neutral-400">CRM export vs live record, account by account</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-copy">
                  <span>Your CRM export says <span className="tnum font-semibold">{formatMoney(tieOut.crmUsd)}</span></span>
                  <span>PursuitOS holds <span className="tnum font-semibold">{formatMoney(tieOut.liveUsd)}</span> on those accounts</span>
                  <span className={Math.abs(tieOut.crmUsd - tieOut.liveUsd) < 1 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                    {Math.abs(tieOut.crmUsd - tieOut.liveUsd) < 1
                      ? "Ties out."
                      : `${tieOut.crmUsd > tieOut.liveUsd ? "+" : "−"}${formatMoney(Math.abs(tieOut.crmUsd - tieOut.liveUsd))} apart`}
                  </span>
                  {tieOut.weekAgo && (
                    <span className="text-neutral-500">
                      Open pipeline {tieOut.weekAgo.takenOn}: <span className="tnum">{formatMoney(tieOut.weekAgo.openUsd)}</span>
                      {" → "}today: <span className="tnum">{formatMoney(total)}</span>
                    </span>
                  )}
                </div>
                {tieOut.deltas.length > 0 ? (
                  <ul className="space-y-1">
                    {tieOut.deltas.map((d) => (
                      <li key={d.companyId} className="flex items-center gap-2 text-copy">
                        <Link href={`/accounts/${d.companyId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {d.account}
                        </Link>
                        <span className="tnum text-body text-neutral-500">CRM {formatMoney(d.crm)}</span>
                        <span className="tnum text-body text-neutral-500">live {formatMoney(d.live)}</span>
                        <span className="tnum w-16 text-right text-body font-semibold text-amber-700 dark:text-amber-400">
                          {d.crm > d.live ? "+" : "−"}{formatMoney(Math.abs(d.crm - d.live))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-copy text-emerald-700 dark:text-emerald-400">
                    Every account with a CRM snapshot matches the live record.
                  </p>
                )}
                <p className="mt-2 text-label text-neutral-400">
                  Somebody&rsquo;s number is usually wrong — this names whose, with the receipts on each account&rsquo;s timeline.
                </p>
              </Card>
            )}

            {/* ── CRM writeback queue (slice A): drift detected → repair proposed,
                approved by a human, exported to the CRM. Detection alone just
                moves the stitching problem downstream; this closes it. ── */}
            {tieOut && (tieOut.deltas.length > 0 || writebacks.length > 0) && (
              <Card className="mb-3">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <BlockLabel>Fix the CRM</BlockLabel>
                  <span className="text-body text-neutral-400">corrections proposed from the tie-out — nothing touches the CRM without approval</span>
                </div>
                {writebacks.length === 0 ? (
                  <form action={draftWritebacksAction}>
                    <button className={buttonClass("primary", "md")}>
                      Draft corrections from the tie-out
                    </button>
                  </form>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {writebacks.map((w) => (
                        <li key={w.id} className="flex items-start gap-2 text-copy">
                          <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-micro font-bold uppercase ${w.field === "presence" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-blue-100 text-accent dark:bg-blue-950 dark:text-blue-300"}`}>
                            {w.field}
                          </span>
                          <span className="min-w-0 flex-1">
                            <Link href={`/accounts/${w.companyId}`} className="font-medium hover:underline">{w.accountName}</Link>
                            <span className="text-neutral-500"> — {w.rationale}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {w.status === "proposed" ? (
                              <>
                                <form action={decideWritebackAction.bind(null, w.id, "approved")}>
                                  <button className={buttonClass("primary", "sm")}>Approve</button>
                                </form>
                                <form action={decideWritebackAction.bind(null, w.id, "dismissed")}>
                                  <button className={buttonClass("subtle", "md")}>dismiss</button>
                                </form>
                              </>
                            ) : (
                              <StatusBadge status={w.status} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center gap-3">
                      <form action={draftWritebacksAction}>
                        <button className={buttonClass("subtle", "md")}>re-draft from current tie-out</button>
                      </form>
                      {approvedWb > 0 && (
                        <a href="/api/writebacks" className="rounded-inner bg-accent px-3 py-1 text-body font-medium text-white">
                          Export {approvedWb} approved correction{approvedWb === 1 ? "" : "s"} (CSV)
                        </a>
                      )}
                      <span className="text-label text-neutral-400">CSV today; the live CRM push adapter drains this same queue when connected.</span>
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* ── Forecast calibration: the forecast measured against reality ── */}
            {calibration.length > 0 && (
              <Card className="mb-3">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <BlockLabel>Was the forecast right?</BlockLabel>
                  <span className="text-body text-neutral-400">what the weighted pipeline said, vs what closed since</span>
                </div>
                <div className="space-y-1">
                  {calibration.map((c) => {
                    const daysAgo = Math.round((Date.now() - new Date(c.takenOn).getTime()) / 86_400_000);
                    const hitRate = c.weightedUsd > 0 ? Math.round((c.wonUsd / c.weightedUsd) * 100) : null;
                    return (
                      <p key={c.takenOn} className="text-copy text-neutral-600 dark:text-neutral-300">
                        <span className="font-medium">{daysAgo}d ago</span> ({c.takenOn}) the book held{" "}
                        <span className="tnum">{formatMoney(c.openUsd)}</span> open,{" "}
                        <span className="tnum">{formatMoney(c.weightedUsd)}</span> weighted. Since then:{" "}
                        <span className="tnum font-semibold text-positive dark:text-green-400">{formatMoney(c.wonUsd)} won</span> ({c.wonN}),{" "}
                        <span className="tnum font-semibold text-red-700 dark:text-red-400">{formatMoney(c.lostUsd)} lost</span> ({c.lostN})
                        {hitRate != null && <> — <span className="tnum font-medium">{hitRate}%</span> of the weighted number has realized so far</>}.
                      </p>
                    );
                  })}
                </div>
                <p className="mt-2 text-label text-neutral-400">
                  Snapshots accrue daily just by looking at this page; every stage-weight opinion eventually meets an outcome here.
                </p>
              </Card>
            )}

            {/* ── Renewal radar (B+3): the co-sell clock ── */}
            {renewals.length > 0 && (
              <Card tone="amber" className="mb-3">
                <SectionHeading hint="Lifecycle dates inside 120 days, from the canonical record.">
                  Renewal radar
                </SectionHeading>
                <Disclosure summary="How to read a row" className="mb-3">
                  Each row says what KIND of date it is — a confirmed day, an inferred window, or a
                  contradiction. Quiet engagement is decay risk; the partners column is who to attach
                  before the clock runs out.
                </Disclosure>
                {/* Wave 3 §5/§8: the radar is already sorted by how close the clock
                    is, so the rows past the first few are the ones with the most
                    time left — genuinely lower priority. Showing the nearest three
                    keeps the room's primary control (Attention / Portfolio / All)
                    inside the first viewport, which is the point of the room. The
                    rest are one click away and nothing is dropped. */}
                <ul className="space-y-1.5">
                  {renewals.slice(0, 3).map((r) => (
                    <li key={r.companyId} className="flex flex-wrap items-center gap-2 text-copy">
                      <Link href={`/accounts/${r.companyId}`} className="min-w-0 font-medium hover:underline">
                        {r.legalName}
                      </Link>
                      <span
                        className={`tnum rounded-full px-2 py-0.5 text-label font-bold ${
                          r.state === "CONFLICTING_DATE"
                            ? "bg-rose/12 text-rose dark:text-rose-300"
                            : r.daysOut <= 30
                              ? "bg-rose/12 text-rose dark:text-rose-300"
                              : "bg-amber/14 text-amber dark:text-amber-300"
                        }`}
                      >
                        {r.state === "CONFLICTING_DATE" ? "conflicting" : r.precise ? `in ${r.daysOut}d` : `~${r.daysOut}d`}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-label text-neutral-400"
                        title={`${r.label} ${r.phrase} · ${r.sourceNote}${r.listName ? ` · on “${r.listName}”` : ""}`}
                      >
                        {r.label} {r.phrase} · {r.sourceNote}
                        {r.listName ? ` · on “${r.listName}”` : ""}
                      </span>
                      <span className="ml-auto flex items-center gap-2 text-label">
                        {r.partners.length > 0 && (
                          <span className="text-violet dark:text-violet-300">{r.partners.join(", ")}</span>
                        )}
                        <span className={r.engagement == null ? "text-neutral-400" : "text-neutral-500"}>
                          {r.engagement == null ? "engagement quiet" : `engagement ${Math.round(r.engagement)}`}
                        </span>
                        <span className={r.openUsd > 0 ? "tnum font-semibold" : "text-neutral-400"}>
                          {r.openUsd > 0 ? `${formatMoney(r.openUsd)} open` : "no open opp"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {renewals.length > 3 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-label font-semibold text-accent hover:underline dark:text-blue-400">
                      {renewals.length - 3} more inside the window
                    </summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {renewals.slice(3).map((r) => (
                        <li key={r.companyId} className="flex flex-wrap items-center gap-2 text-copy">
                          <Link href={`/accounts/${r.companyId}`} className="min-w-0 font-medium hover:underline">{r.legalName}</Link>
                          <span className="tnum rounded-full bg-amber/14 px-2 py-0.5 text-label font-bold text-amber dark:text-amber-300">
                            {r.state === "CONFLICTING_DATE" ? "conflicting" : r.precise ? `in ${r.daysOut}d` : `~${r.daysOut}d`}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-label text-neutral-400">
                            {r.label} {r.phrase} · {r.sourceNote}
                          </span>
                          <span className={r.openUsd > 0 ? "tnum ml-auto font-semibold" : "ml-auto text-label text-neutral-400"}>
                            {r.openUsd > 0 ? `${formatMoney(r.openUsd)} open` : "no open opp"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            )}

            {/* Roll-up chips — each is a count AND an atomic filter (click to slice). */}
            {(() => {
              const chipHref = (o: Record<string, string | undefined>) => {
                const p = new URLSearchParams();
                p.set("view", view);
                for (const [k, v] of Object.entries({ timeframe: qp("timeframe"), stage: qp("stage"), partner: qp("partner"), quote: qp("quote"), qual: qp("qual"), ...o })) if (v) p.set(k, v);
                return `/pipeline?${p.toString()}`;
              };
              const chip = (label: string, count: number, active: boolean, href: string, tone = "neutral") => {
                const tones: Record<string, string> = {
                  neutral: "text-neutral-600 dark:text-neutral-300",
                  green: "text-positive dark:text-green-400",
                  amber: "text-amber-700 dark:text-amber-400",
                  red: "text-red-700 dark:text-red-400",
                  blue: "text-accent dark:text-blue-400",
                };
                return (
                  <Link key={label} href={href} className={`flex items-center gap-1.5 rounded-inner border px-2.5 py-1 text-body transition-colors ${active ? "border-accent bg-accent text-white" : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"}`}>
                    <span className={`tnum font-semibold ${active ? "" : tones[tone]}`}>{count}</span>
                    <span className={active ? "" : "text-neutral-500"}>{label}</span>
                  </Link>
                );
              };
              const cStage = (s: string) => opps.filter((o) => o.stage === s).length;
              const quoteSent = opps.filter((o) => quoteOf(o.id).delivered).length;
              const strong = opps.filter((o) => qualOf(o.id) === "strong").length;
              const risk = opps.filter((o) => qualOf(o.id) === "risk").length;
              const noFilters = !qp("stage") && !qp("quote") && !qp("qual");
              return (
                <div className="mb-5 flex flex-wrap gap-2">
                  {chip("all", opps.length, noFilters, chipHref({ stage: undefined, quote: undefined, qual: undefined }))}
                  {[...STAGES, "closed_won", "closed_lost"].map((s) =>
                    chip(s.replace(/_/g, " "), cStage(s), qp("stage") === s, chipHref({ stage: qp("stage") === s ? undefined : s }), s === "closed_won" ? "green" : s === "closed_lost" ? "red" : "blue"),
                  )}
                  {chip("quote sent", quoteSent, qp("quote") === "yes", chipHref({ quote: qp("quote") === "yes" ? undefined : "yes" }), "green")}
                  {chip("well-qualified", strong, qp("qual") === "strong", chipHref({ qual: qp("qual") === "strong" ? undefined : "strong" }), "green")}
                  {chip("at risk", risk, qp("qual") === "risk", chipHref({ qual: qp("qual") === "risk" ? undefined : "risk" }), "amber")}
                </div>
              );
            })()}
            {/*
              Wave 3 §5 — "do not lead with aggregate BI."

              Below this point sat three analytical blocks: qualification-vs-outcome,
              open-opportunities-by-stage, and the base/joint revenue roll-up with its
              per-partner bars. Together with the radar and the chips above them they
              put roughly a thousand pixels of aggregate reporting BETWEEN the page
              title and the Attention/Portfolio/All switcher — so on a 1000px viewport
              an operator could not see a single pipeline row, or even the control that
              chooses which rows to see, without scrolling.

              Pipeline's job is "what condition is this revenue in and where should
              someone intervene". These blocks answer a different, slower question:
              how is the book performing in aggregate. Both belong in the room; only
              one belongs first. Nothing is removed, no figure changes, and one click
              restores the previous layout exactly.
            */}
            <details className="mb-3 group">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-accent hover:underline dark:text-blue-400">
                <span aria-hidden className="ink-faint transition-transform group-open:rotate-90">▸</span>
                Pipeline analytics
                <span className="font-normal ink-faint">— qualification vs outcome, stage mix, base vs co-sell</span>
              </summary>
              <div className="mt-3">
            {((wonQual != null || lostQual != null) || stageRows.length > 0) && (
              <div className="mb-3 grid gap-3 lg:grid-cols-2 lg:items-start">
                {(wonQual != null || lostQual != null) && (
                  <Card>
                    <BlockLabel>Qualification vs outcome</BlockLabel>
                    <p className="text-copy ink-soft">
                      Closed-won qualified at <span className="font-semibold text-positive dark:text-green-400">{wonQual ?? "—"}</span> MEDDPICC health on average;
                      closed-lost at <span className="font-semibold text-red-700 dark:text-red-400">{lostQual ?? "—"}</span>.
                      {wonQual != null && lostQual != null && wonQual > lostQual && (
                        <> A <span className="font-medium">+{wonQual - lostQual}</span> gap.</>
                      )}
                    </p>
                    <Disclosure summary="What the model does with this" className="mt-2">
                      The gap is the pattern banked at each close — stronger qualification, higher
                      conversion. It is an observation over closed deals, not a forecast.
                    </Disclosure>
                  </Card>
                )}
                {stageRows.length > 0 && (
                  <Card>
                    <BlockLabel>Open opportunities by stage</BlockLabel>
                    <MiniBar rows={stageRows} series="ordered" />
                  </Card>
                )}
              </div>
            )}

            {/* Pipeline & revenue roll-up — base (direct) vs joint (partner co-sell),
                with a per-partner breakdown. The base/joint split is the co-sell
                lift; per-partner shows who's driving it. */}
            {(() => {
              const baseOpen = open.filter((o) => !o.partner_name).reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);
              const jointOpen = open.filter((o) => o.partner_name).reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);
              const totalOpen = baseOpen + jointOpen;
              const roll = new Map<string, { open: number; won: number }>();
              for (const o of opps) {
                if (!o.partner_name) continue;
                const e = roll.get(o.partner_name) ?? { open: 0, won: 0 };
                if (o.stage === "closed_won") e.won += Number(o.amount_usd ?? 0);
                else if (!o.stage.startsWith("closed")) e.open += Number(o.amount_usd ?? 0);
                roll.set(o.partner_name, e);
              }
              const partners = [...roll.entries()].sort((a, b) => b[1].open + b[1].won - (a[1].open + a[1].won));
              const maxP = Math.max(1, ...partners.map(([, v]) => v.open + v.won));
              if (totalOpen === 0 && partners.length === 0) return null;
              return (
                <Card className="mb-3">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <BlockLabel>Pipeline &amp; revenue roll-up</BlockLabel>
                    <span className="text-label text-neutral-400">open pipeline · base (direct) vs joint (co-sell)</span>
                  </div>
                  {/* Base vs joint split bar */}
                  <div className="mb-1 flex h-5 overflow-hidden rounded-inner bg-neutral-100 dark:bg-neutral-800">
                    <div className="flex items-center justify-center bg-neutral-400 text-micro font-medium text-white dark:bg-neutral-600" style={{ width: `${totalOpen ? (baseOpen / totalOpen) * 100 : 0}%` }} title={`Base ${formatMoney(baseOpen)}`} />
                    <div className="flex items-center justify-center bg-teal-500 text-micro font-medium text-white" style={{ width: `${totalOpen ? (jointOpen / totalOpen) * 100 : 0}%` }} title={`Joint ${formatMoney(jointOpen)}`} />
                  </div>
                  <div className="mb-4 flex gap-4 text-label text-neutral-500">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-inner bg-neutral-400 dark:bg-neutral-600" /> base {formatMoney(baseOpen)}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-inner bg-teal-500" /> joint / co-sell {formatMoney(jointOpen)}</span>
                    <span className="ml-auto">co-sell lift {totalOpen ? Math.round((jointOpen / totalOpen) * 100) : 0}%</span>
                  </div>
                  {/* Per-partner: open (teal) + won (green) */}
                  {partners.length > 0 ? (
                    <div className="space-y-2">
                      {partners.map(([name, v]) => (
                        <div key={name} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-body text-neutral-600 dark:text-neutral-300" title={name}>{name}</span>
                          <div className="flex h-4 flex-1 overflow-hidden rounded-inner bg-neutral-100 dark:bg-neutral-800">
                            <div className="bg-teal-500" style={{ width: `${((v.open) / maxP) * 100}%` }} title={`open ${formatMoney(v.open)}`} />
                            <div className="bg-green-600" style={{ width: `${((v.won) / maxP) * 100}%` }} title={`won ${formatMoney(v.won)}`} />
                          </div>
                          <span className="tnum w-24 shrink-0 text-right text-body text-neutral-500">{formatMoney(v.open)}{v.won ? ` · ${formatMoney(v.won)} won` : ""}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-body text-neutral-400">No partner-attributed pipeline yet — opportunities inherit their partner from the motion.</p>
                  )}
                </Card>
              );
            })()}
              </div>
            </details>
          </>
        );
      })()}

      {(() => {
        // Preserve scope + active filters across the view switch.
        const viewHref = (v: string) => {
          const qs = new URLSearchParams();
          qs.set("view", v);
          for (const k of ["timeframe", "stage", "partner", "quote", "qual", "scope", "life", "value"] as const) { const val = qp(k); if (val) qs.set(k, val); }
          return `/pipeline?${qs.toString()}`;
        };
        const seg: { key: typeof view; label: string; hint: string }[] = [
          { key: "attention", label: "Attention", hint: "needs intervention now" },
          { key: "portfolio", label: "Portfolio", hint: "where exposure concentrates" },
          { key: "all", label: "All", hint: "the whole book, compact" },
          { key: "review", label: "Review", hint: "deal registration" },
        ];
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* The room's primary view switcher was a SEVENTH segmented grammar —
                its own track radius, a hard white selected chip and a hard-coded
                dark-mode pair. It carried no `role="tablist"`, which is why the
                earlier sweep for hand-rolled controls did not see it. Same
                grammar as every other segmented control now, so the Pipeline
                switcher, the room-pair tabs and the Sponsor/Partner toggle all
                behave and read alike. */}
            <div className={segmentTrackClass()}>
              {seg.map((v) => (
                <Link key={v.key} href={viewHref(v.key)} title={v.hint}
                  aria-current={view === v.key ? "page" : undefined}
                  className={segmentClass(view === v.key)}>
                  {v.label}
                </Link>
              ))}
            </div>
            {(view === "all" || view === "review") && (
              <>
                <QuerySelect param="stage" value={qp("stage") ?? "all"} label="Stage" options={[{ value: "all", label: "Any stage" }, ...STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })), { value: "closed_won", label: "closed won" }, { value: "closed_lost", label: "closed lost" }]} />
                {partnerOptions.length > 0 && (
                  <QuerySelect param="partner" value={qp("partner") ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
                )}
                <QuerySelect param="quote" value={qp("quote") ?? "all"} label="Quote" options={[{ value: "all", label: "Any" }, { value: "yes", label: "Quote sent" }, { value: "no", label: "No quote" }]} />
                <QuerySelect param="timeframe" value={qp("timeframe") ?? "all"} label="Closing within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
                {/* Lifecycle (P2A §8) — three states, no fourth. */}
                <QuerySelect param="life" value={qp("life") ?? "all"} label="Lifecycle" options={[{ value: "all", label: "Any lifecycle" }, { value: "renew90", label: "Renewing in 90 days" }, { value: "conflicting", label: "Conflicting timing" }, { value: "stale", label: "Stale evidence" }]} />
                {/* Value case (P2B §14) — the derived state, four values, no new score. */}
                <QuerySelect param="value" value={qp("value") ?? "all"} label="Value case" options={[{ value: "all", label: "Any value case" }, { value: "strong", label: "Strong" }, { value: "incomplete", label: "Incomplete" }, { value: "conflicting", label: "Conflicting economics" }, { value: "none", label: "Not established" }]} />
              </>
            )}
            <span className="ml-auto text-body text-neutral-500">{visible.length} of {opps.length}</span>
          </div>
        );
      })()}

      {/* Lifecycle filter context (P2A §8): the filter says WHAT it selected on, and — because a
          lifecycle state is a claim about evidence — how certain that selection is. Progressive
          disclosure: the first line is the state, the detail sits one click away on the account. */}
      {qp("life") && qp("life") !== "all" && (view === "all" || view === "review") && (
        <p className="mb-3 text-body text-neutral-500">
          {visible.length === 0
            ? "No open deal sits on an account in this lifecycle state."
            : <>
                {visible.length} deal{visible.length === 1 ? "" : "s"} on{" "}
                {new Set(visible.map((o) => o.company_id)).size} account
                {new Set(visible.map((o) => o.company_id)).size === 1 ? "" : "s"} where the lifecycle date reads{" "}
                <b>{qp("life") === "renew90" ? "verified or inferred inside 90 days"
                  : qp("life") === "conflicting" ? STATE_LABEL.CONFLICTING_DATE : STATE_LABEL.STALE_DATE}</b>.{" "}
                {qp("life") === "conflicting"
                  ? "Sources disagree — the date is not settled by choosing one."
                  : qp("life") === "stale"
                    ? "We knew this once; it is past its validity, not unknown."
                    : "Windows are ranges, not days — open an account for its evidence."}
              </>}
        </p>
      )}

      {opps.length === 0 && (
        <p className="text-copy text-neutral-500">
          No opportunities yet — promote an active motion from its brief when a conversation
          earns a meeting.
        </p>
      )}
      {opps.length > 0 && visible.length === 0 && view !== "portfolio" && (
        <p className="text-copy text-neutral-500">No opportunities match these filters — clear one above.</p>
      )}

      {/* PORTFOLIO (§3.2 / R4): ecosystem-native pivot matrix over the canonical open book. */}
      {view === "portfolio" && (
        <PortfolioMatrix portfolio={portfolio} rows={dims.rows} cols={dims.cols} basePath="/pipeline" scopeToken={qp("scope")} />
      )}

      {/* ALL (§3.3 / R5): the exhaustive book as one dense, sortable, virtualized table. */}
      {view === "all" && visible.length > 0 && (
        <PipelineAllTable
          drawerBase={drawerBase}
          rows={[...visible].map((o) => {
            const cond = opportunityCondition({ stage: o.stage, updatedAt: o.updated_at }, momentum.get(o.id));
            const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
            return {
              id: o.id, name: o.name, account: o.legal_name, companyId: o.company_id, stage: o.stage,
              amountUsd: amt, weightedUsd: amt != null && !o.stage.startsWith("closed") ? Math.round(amt * probOf(o)) : null,
              partner: o.partner_name ?? null, condition: cond.state,
              closeDate: o.expected_close_date ? new Date(o.expected_close_date).toISOString().slice(0, 10) : null,
              meddpicc: scoreOf(o.id),
            };
          })}
        />
      )}

      {view === "review" && visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Partner</th>
                <th>Stage</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Weighted</th>
                <th className="text-right">MEDDPICC</th>
                <th>Quote</th>
                <th>Close</th>
                <th>Deal registration</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const reg = regByOpp.get(o.id);
                const closed = o.stage.startsWith("closed");
                const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
                const quote = quoteOf(o.id);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/accounts/${o.company_id}`} className="font-medium hover:underline">{o.name}</Link>
                      <div className="text-label text-neutral-400">{o.legal_name}</div>
                    </td>
                    <td className="text-body text-neutral-500">{o.partner_name ?? "—"}</td>
                    <td className="text-body uppercase tracking-wide text-neutral-500">{o.stage.replace(/_/g, " ")}</td>
                    <td className="tnum text-right">{amt != null ? `${formatMoney(amt)}` : "—"}</td>
                    <td className="tnum text-right text-neutral-500">
                      {amt != null && !closed ? `${formatMoney((amt * probOf(o)))}` : "—"}
                    </td>
                    <td className="tnum text-right">
                      {(() => {
                        const s = scoreOf(o.id);
                        const tone = s >= 70 ? "text-positive dark:text-green-400" : s >= 40 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
                        return <span className={tone}>{s}</span>;
                      })()}
                    </td>
                    <td className="text-body">
                      {quote.delivered ? (
                        <span className="text-positive dark:text-green-400" title={quote.note ?? undefined}>✓ sent{quote.at ? ` ${quote.at}` : ""}</span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="text-body text-neutral-500">{o.expected_close_date ? new Date(o.expected_close_date).toISOString().slice(0, 10) : "—"}</td>
                    <td>
                      {reg ? (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={reg.status === "approved" ? "approved" : reg.status === "rejected" ? "rejected" : reg.status === "submitted" ? "running" : "skipped"} />
                          <span className="text-label text-neutral-400">
                            {reg.vendor ?? "vendor"}{reg.protected_until ? ` · until ${reg.protected_until}` : ""}
                          </span>
                          {reg.status === "submitted" && (
                            <span className="flex gap-1">
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "approved")}>
                                <button className={buttonClass("subtle", "md")}>approve</button>
                              </form>
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "rejected")}>
                                <button className={buttonClass("subtle", "md")}>reject</button>
                              </form>
                            </span>
                          )}
                        </div>
                      ) : closed ? (
                        <span className="text-body text-neutral-400">—</span>
                      ) : (
                        <form action={registerDealAction.bind(null, o.id)} className="flex items-center gap-1">
                          <input name="vendor" placeholder="vendor" className="w-20 rounded-inner border border-neutral-300 bg-transparent px-1.5 py-0.5 text-label dark:border-neutral-700" />
                          <input name="product" placeholder="product" className="w-24 rounded-inner border border-neutral-300 bg-transparent px-1.5 py-0.5 text-label dark:border-neutral-700" />
                          <button className={buttonClass("primary", "sm")}>Register</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "attention" && attentionVisible.length === 0 && (
        <p className="rounded-card p-4 text-copy text-neutral-500" style={{ background: "var(--surface-inset)" }}>
          Nothing needs intervention right now{condFilter ? " in this slice" : ""}. The open book is in{" "}
          <Link href="/pipeline?view=all" className="font-medium text-accent hover:underline dark:text-blue-400">All</Link>, concentrated in{" "}
          <Link href="/pipeline?view=portfolio" className="font-medium text-accent hover:underline dark:text-blue-400">Portfolio</Link>.
        </p>
      )}
      {/* Attention, top-weighted (Wave 3 §6). The list is the same list in the
          same order — this only decides how much of it is open on arrival. Four
          cards is what a reader can hold at once; beyond that the page becomes a
          stack to scroll rather than a set to act on, and the fifth card looks
          exactly as urgent as the first. The rest are one click away, counted,
          and nothing is filtered out. Ranking, materiality and intervention
          logic are untouched. */}
      {view === "attention" && attentionVisible.length > 0 && (() => {
        const ordered = [...attentionVisible]
          // Materiality controls order: open deals by weighted value, closed sink to the bottom.
          .sort((a, b) => {
            const ca = a.stage.startsWith("closed"), cb = b.stage.startsWith("closed");
            if (ca !== cb) return ca ? 1 : -1;
            return (Number(b.amount_usd ?? 0) * probOf(b)) - (Number(a.amount_usd ?? 0) * probOf(a));
          });
        const LEAD = 4;
        const lead = ordered.slice(0, LEAD);
        const rest = ordered.slice(LEAD);
        const card = (o: (typeof ordered)[number]) => {
          const stakeholders = stakeholdersByOpp.get(o.id) ?? [];
          const gaps = o.stage.startsWith("closed") ? [] : stakeholderGaps(stakeholders);
          const stageIdx = STAGES.indexOf(o.stage as (typeof STAGES)[number]);
          const won = o.stage === "closed_won";
          const lost = o.stage === "closed_lost";
          const closed = won || lost;
          const quote = quoteOf(o.id);
          const mo = momentum.get(o.id);
          const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
          // Raw dollars, not thousands: formatMoney owns the scale decision, and a
          // pre-divided value would render $1.5K for one and a half million.
          const weighted = amt != null && !closed ? Math.round(amt * probOf(o)) : null;
          // Canonical "what is actually happening" — same conditions/language as Where-Your-Systems-Disagree.
          const silentDays = o.updated_at ? Math.floor((Date.now() - new Date(o.updated_at).getTime()) / 86_400_000) : null;
          const lateStage = o.stage === "proposal" || o.stage === "negotiation";
          const material = amt != null && amt >= 900_000 ? "high" : amt != null && amt >= 400_000 ? "mid" : "low";
          type Att = { tone: "rose" | "amber"; label: string; next: string } | null;
          const attention: Att = closed ? null
            : lateStage && silentDays != null && silentDays >= 30 ? { tone: "rose", label: `Late-stage on paper, silent ${silentDays} days — the record and the deal have parted ways`, next: "Re-engage the economic buyer" }
            : silentDays != null && silentDays >= 21 ? { tone: "amber", label: `Untouched ${silentDays} days — renewal window closing, deal dormant`, next: "Follow up before the window lapses" }
            : mo?.verdict === "at_risk" ? { tone: "rose", label: mo.reasons.join(" · ") || "Momentum at risk", next: "Intervene now" }
            : mo?.verdict === "stalling" ? { tone: "amber", label: mo.reasons.join(" · ") || "Stalling — plan says moving, outbox stopped", next: "Advance the next step" }
            : null;
          const railColor = won ? "var(--color-accent-verified)" : lost ? "var(--color-neutral-400)"
            : attention?.tone === "rose" ? "var(--color-accent-risk)" : attention?.tone === "amber" ? "var(--color-accent-attention)"
            : mo?.verdict === "advancing" ? "var(--color-route)" : "var(--border-subtle)";
          const attTone = (t: "rose" | "amber") => t === "rose"
            ? { fg: "var(--color-accent-risk)", bg: "color-mix(in srgb, var(--color-accent-risk) 8%, transparent)" }
            : { fg: "var(--color-accent-attention)", bg: "color-mix(in srgb, var(--color-accent-attention) 9%, transparent)" };
          return (
            <Card key={o.id} className={`relative overflow-hidden ${material === "high" && attention ? "shadow-[var(--shadow-mid)]" : ""}`}>
              {/* Materiality + attention. This was a 2–4px coloured rail down the card's left
                  edge, with the WIDTH encoding materiality on top of the colour — two variables
                  on one decoration, neither labelled. A card already states its condition in a
                  chip and its value in the figure; the rail is now a 1px hairline that tints
                  with the same signal, so the edge reads as the card's own material rather than
                  as a second, louder status system. */}
              <div aria-hidden className="absolute inset-y-0 left-0 w-px" style={{ background: railColor }} />

              {/* Header — identity, outcome/stage, materiality amount, route */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-1.5">
                <Link href={drawerHref(o.company_id)} scroll={false} className="text-title font-bold hover:underline" title="Open account intelligence">{o.name}</Link>
                {closed
                  ? <span className="rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-[0.04em]" style={won ? { background: "color-mix(in srgb, var(--color-accent-verified) 14%, transparent)", color: "var(--color-accent-verified)" } : { background: "var(--surface-inset)", color: "var(--color-neutral-500)" }}>{won ? "Closed won" : "Closed lost — no decision"}</span>
                  : <span className="text-label font-semibold uppercase tracking-[0.04em] text-neutral-500">{o.stage.replace(/_/g, " ")}</span>}
                {/* Materiality sizes the amount — a bigger deal reads bigger. The
                    three steps were 17 / 15 / 13.5px inline, which is off the named
                    scale in both directions (and nobody designs on a half-pixel
                    grid). Same three-step ramp, now section / title / copy. */}
                {amt != null && (
                  <span className={`tnum font-extrabold ${material === "high" ? "text-section" : material === "mid" ? "text-title" : "text-copy"}`}>
                    {formatMoney(amt)}
                    {weighted != null && <span className="ml-1 text-label font-medium text-neutral-400">· {formatMoney(weighted)} weighted</span>}
                  </span>
                )}
                {o.partner_name && <span className="text-label text-neutral-500">route <b className="text-neutral-600 dark:text-neutral-300">{o.partner_name}</b></span>}
                {mo && !closed && (
                  <span title={mo.reasons.join(" · ") || "observed behavior over the last 14 days"} className="rounded-full px-2 py-0.5 text-micro font-bold"
                    style={mo.verdict === "advancing" ? { background: "color-mix(in srgb, var(--color-route) 12%, transparent)", color: "var(--color-route)" }
                      : mo.verdict === "at_risk" ? { background: "color-mix(in srgb, var(--color-accent-risk) 12%, transparent)", color: "var(--color-accent-risk)" }
                      : mo.verdict === "stalling" ? { background: "color-mix(in srgb, var(--color-accent-attention) 12%, transparent)", color: "var(--color-accent-attention)" }
                      : { background: "var(--surface-inset)", color: "var(--color-neutral-500)" }}>
                    {mo.jointActive ? "◆ " : ""}{MOMENTUM_LABEL[mo.verdict]}
                  </span>
                )}
                {o.expected_close_date && <span className="text-label text-neutral-400">close {new Date(o.expected_close_date).toISOString().slice(0, 10)}</span>}
                {o.motion_id && <Link href={`/briefs/${o.motion_id}`} className="ml-auto text-label font-medium text-accent hover:underline dark:text-blue-400">Brief →</Link>}
              </div>

              {/* One clean stage rail */}
              <div className="mt-2.5 mb-1 flex gap-1 pl-1.5">
                {STAGES.map((s, idx) => {
                  const on = won ? true : lost ? false : idx <= stageIdx;
                  const isCurrent = !closed && idx === stageIdx;
                  const tone = won ? "bg-green-500" : on ? (isCurrent ? "bg-blue-600" : "bg-blue-400") : "bg-neutral-200 dark:bg-neutral-700";
                  return (
                    <div key={s} className="flex-1" title={s.replace(/_/g, " ")}>
                      <div className={`h-1 rounded-full ${tone}`} />
                      <div className={`mt-0.5 hidden text-micro uppercase tracking-wide sm:block ${isCurrent ? "font-semibold text-accent dark:text-blue-400" : "text-neutral-400"}`}>{s.replace(/_/g, " ")}</div>
                    </div>
                  );
                })}
              </div>

              {/* PRIMARY: what is actually happening + the next intervention (materiality-gated) */}
              {attention && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-2.5 py-2 pl-2.5 text-body" style={{ background: attTone(attention.tone).bg }}>
                  <span className="font-semibold" style={{ color: attTone(attention.tone).fg }}>{attention.label}.</span>
                  <span className="text-neutral-500">Next: <b className="text-neutral-700 dark:text-neutral-200">{attention.next}</b></span>
                </div>
              )}

              {/* Manage — CRM detail behind progressive disclosure (native <details>, robust) */}
              {!closed && (
                <details className="mt-2 pl-1.5">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-label font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                    <span className="uppercase tracking-[0.04em]">Manage</span>
                    {(() => { const m = meddpicc.get(o.id)!; const sc = meddpiccScore(m); const mg = meddpiccGaps(m);
                      const t = sc >= 70 ? "var(--color-accent-verified)" : sc >= 40 ? "var(--color-accent-attention)" : "var(--color-accent-risk)";
                      return <span className="tnum rounded-inner px-1.5 py-0.5 text-micro font-semibold" style={{ background: `color-mix(in srgb, ${t} 12%, transparent)`, color: t }}>MEDDPICC {sc}{mg.length ? ` · ${mg.length} to firm up` : ""}</span>; })()}
                    {gaps.length > 0 && <span className="text-micro text-neutral-400">buyer roles: {gaps.length} gap{gaps.length === 1 ? "" : "s"}</span>}
                    {!quote.delivered && <span className="text-micro text-neutral-400">no quote</span>}
                  </summary>

                  <div className="mt-2.5 space-y-2.5">
                    {gaps.length > 0 && (
                      <p className="text-body font-medium" style={{ color: "var(--color-accent-attention)" }}>Buyer-role gaps: {gaps.join(" · ")}</p>
                    )}
                    {stakeholders.length > 0 && (
                      <div className="space-y-1">
                        {stakeholders.map((s) => (
                          <form key={s.contact_id} action={setStakeholderAction.bind(null, o.id, s.contact_id)} className="flex items-center gap-2 text-copy">
                            <span className="font-medium">{s.name ?? s.email}</span>
                            {/* Assertion state (P1C): verified/inferred/unverified stay distinct. A role
                                change here lands as an unverified proposal — verification happens on the
                                Pursuit's stakeholder panel, with evidence, through the governed skill. */}
                            <span className={`rounded-full px-1.5 py-px text-micro font-semibold ${s.assertion_state === "verified" ? "bg-emerald/12 text-emerald-700 dark:text-emerald-300" : s.assertion_state === "inferred" ? "bg-violet/12 text-violet-700 dark:text-violet-300" : "bg-neutral-500/10 text-neutral-500"}`}>
                              {s.assertion_state}
                            </span>
                            <select name="role" defaultValue={s.role} className={fieldClass("sm")}>
                              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                            </select>
                            <select name="sentiment" defaultValue={s.sentiment} className={fieldClass("sm")}>
                              {SENTIMENTS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button type="submit" className={buttonClass("subtle", "md")}>Save</button>
                          </form>
                        ))}
                      </div>
                    )}
                    {/* MEDDPICC editor */}
                    {(() => {
                      const m = meddpicc.get(o.id)!;
                      return (
                        <div>
                          <form action={assessMeddpiccAction.bind(null, o.id)} className="mb-2 flex items-center gap-2">
                            <button className={buttonClass("primary", "sm")}>AI assess from evidence</button>
                            <span className="text-micro text-neutral-400">drafts every element you haven&rsquo;t set from stakeholders &amp; verified signals — your call to keep</span>
                          </form>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {ELEMENTS.map((e) => {
                              const st = m[e.key];
                              return (
                                <form key={e.key} action={setMeddpiccAction.bind(null, o.id, e.key)} className="flex items-center gap-1.5 rounded-control border border-neutral-200 px-2 py-1.5 dark:border-neutral-800" title={e.hint}>
                                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner bg-neutral-100 text-micro font-bold text-neutral-500 dark:bg-neutral-800">{e.letter}</span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1">
                                      <span className="truncate text-label font-medium">{e.label}</span>
                                      {st.source === "ai_assist" && <span className="rounded-inner bg-blue-100 px-1 text-micro font-bold uppercase text-accent dark:bg-blue-900 dark:text-blue-300" title="AI-drafted, unconfirmed">AI</span>}
                                    </div>
                                    <input name="notes" defaultValue={st.notes ?? ""} placeholder="notes" className="mt-0.5 w-full rounded-inner border border-transparent bg-transparent text-label text-neutral-500 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-700" />
                                  </div>
                                  <select name="status" defaultValue={st.status} className={`rounded-inner px-1 py-0.5 text-micro font-medium ${STATUS_TONE[st.status]}`}>
                                    {MEDDPICC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                                  </select>
                                  <button className={buttonClass("subtle", "md")}>save</button>
                                </form>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Stage controls (secondary — outcomes are not generic buttons) */}
                    <div className="flex flex-wrap items-center gap-2 border-t pt-2.5" style={{ borderColor: "var(--border-subtle)" }}>
                      <span className="text-micro uppercase tracking-[0.04em] text-neutral-400">Advance / close</span>
                      {[...STAGES, "closed_won", "closed_lost"]
                        .filter((s) => { const idx = STAGES.indexOf(s as (typeof STAGES)[number]); if (s === "closed_won" || s === "closed_lost") return true; return idx > stageIdx || idx === stageIdx - 1; })
                        .map((s) => (
                          <form key={s} action={advanceOpportunityAction.bind(null, o.id, s as Stage)}>
                            {/* One row of stage-advance controls, so one geometry. These hand-wrote their
                                own padding, height and text size — the exact drift `buttonClass` exists to
                                stop — and filled the won button solid green, making one option in a row of
                                equals look like the recommended one. Outcome is carried by ink now. */}
                            <button
                              type="submit"
                              className={`${buttonClass("ghost", "sm")} ${
                                s === "closed_won" ? "text-emerald dark:text-emerald"
                                : s === "closed_lost" ? "text-rose dark:text-rose" : ""
                              }`}
                            >
                              {s.replace(/_/g, " ")}
                            </button>
                          </form>
                        ))}
                      {initiativeOpts.length > 0 && (
                        <form action={assignInitiativeAction.bind(null, o.id)} className="ml-auto flex items-center gap-1" title="initiative this deal rolls up into">
                          <select name="initiativeId" defaultValue={o.initiative_id ?? ""} className={`max-w-[180px] rounded-inner border bg-transparent px-1 py-0.5 text-body ${o.initiative_id ? "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300" : "border-neutral-300 text-neutral-500 dark:border-neutral-700"}`}>
                            <option value="">no initiative</option>
                            {initiativeOpts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                          <button className={buttonClass("subtle", "md")}>set</button>
                        </form>
                      )}
                    </div>
                  </div>
                </details>
              )}

              {/* Closed — the outcome + its autopsy, read as an outcome not a stage */}
              {closed && autopsies.has(o.id) && (
                <details className="mt-2 pl-1.5">
                  <summary className="cursor-pointer text-label font-medium text-accent hover:underline dark:text-blue-400">Autopsy — what the record says happened</summary>
                  <ul className="mt-1.5 space-y-0.5 text-copy text-neutral-600 dark:text-neutral-300">
                    {autopsies.get(o.id)!.lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                  <p className="mt-1 text-label text-neutral-400">Assembled from the record at read time — duration, path, contact, and grounding sources. No opinions, no AI.</p>
                </details>
              )}
            </Card>
          );        };
        return (
          <>
            <div className="space-y-3">{lead.map(card)}</div>
            {rest.length > 0 && (
              <details className="group mt-3">
                <summary className="cursor-pointer list-none rounded-card px-4 py-2.5 text-copy font-semibold ink-muted transition-colors hover:ink"
                  style={{ background: "var(--surface-inset)" }}>
                  {rest.length} more needing attention
                  <span className="ml-1.5 ink-faint group-open:hidden" aria-hidden>▸</span>
                  <span className="ml-1.5 hidden ink-faint group-open:inline" aria-hidden>▾</span>
                </summary>
                <div className="mt-3 space-y-3">{rest.map(card)}</div>
              </details>
            )}
          </>
        );
      })()}

      {drawerIntel && <IntelDrawer intel={drawerIntel} closeHref={drawerCloseHref} />}
    </main>
  );
}
