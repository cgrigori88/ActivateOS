import Link from "next/link";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { loadStageWeights } from "@/lib/opportunities/stage-weights";
import { enabledTriggers } from "@/lib/triggers/catalog";
import {
  STAGE_PROBABILITY,
  STAGES,
  stakeholderGaps,
  weightedPipelineValue,
  type Stage,
} from "@/lib/opportunities/lifecycle";
import { Bento, Card, MiniBar, PageHeader, StatusBadge } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
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
import { dealMomentum, MOMENTUM_LABEL, type Momentum } from "@/lib/opportunities/momentum";
import {
  advanceOpportunityAction,
  registerDealAction,
  setRegistrationStatusAction,
  setStakeholderAction,
  setMeddpiccAction,
  assessMeddpiccAction,
} from "./actions";

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
  searchParams: Promise<{ view?: string; timeframe?: string; stage?: string; partner?: string; quote?: string; qual?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "review" ? "review" : "board";
  const timeframe = ["7", "30", "90"].includes(sp.timeframe ?? "") ? Number(sp.timeframe) : null;
  const pool = getPool();
  const { rows: allOpps } = await pool.query(
    `select o.id, o.name, o.stage, o.amount_usd, o.next_step, o.expected_close_date, o.updated_at,
            o.company_id, c.legal_name, n.slug, o.motion_id,
            pa.name as partner_name, m.partner_id
     from opportunities o
     join companies c on c.id = o.company_id
     left join taxonomy_nodes n on n.id = o.taxonomy_node_id
     left join revenue_motions m on m.id = o.motion_id
     left join partners pa on pa.id = m.partner_id
     order by o.updated_at desc`,
  );

  // Renewal radar (B+3): every account on an approved list whose renewal_date
  // sits inside 120 days — the co-sell clock. Engagement quiet = decay risk;
  // partners on the account = who to attach before it runs out.
  const orgIdForRadar = await currentOrgId(pool);
  const radarOn = orgIdForRadar
    ? (await enabledTriggers(pool, orgIdForRadar)).has("renewal_window")
    : false;
  const { rows: renewalRows } = orgIdForRadar && radarOn
    ? await pool.query<{ company_id: string; legal_name: string; renewal: string; list_name: string }>(
        `select distinct on (pm.company_id)
                pm.company_id, c.legal_name,
                pm.attributes->>'renewal_date' as renewal, ap.name as list_name
         from population_members pm
         join account_populations ap on ap.id = pm.population_id
           and ap.org_id = $1 and ap.status = 'approved'
         join companies c on c.id = pm.company_id
         where pm.attributes ? 'renewal_date'
           and (pm.attributes->>'renewal_date')::date
               between now()::date and (now() + interval '120 days')::date
         order by pm.company_id, (pm.attributes->>'renewal_date')::date asc`,
        [orgIdForRadar],
      )
    : { rows: [] };
  const renewalIds = renewalRows.map((r) => r.company_id);
  const engagementByCompany = new Map<string, number>();
  const partnersByRenewal = new Map<string, string[]>();
  if (renewalIds.length) {
    const { rows: eng } = await pool.query<{ company_id: string; score: string }>(
      `select company_id, max(engagement_score) as score
       from engagement_scores where company_id = any($1) group by company_id`,
      [renewalIds],
    );
    for (const e of eng) engagementByCompany.set(e.company_id, Number(e.score));
    const { rows: pns } = await pool.query<{ company_id: string; partners: string[] }>(
      `select pm.company_id, array_agg(distinct p.name order by p.name) as partners
       from population_members pm
       join account_populations ap on ap.id = pm.population_id
         and ap.org_id = $2 and ap.partner_id is not null and ap.status = 'approved'
       join partners p on p.id = ap.partner_id
       where pm.company_id = any($1) group by pm.company_id`,
      [renewalIds, orgIdForRadar],
    );
    for (const r of pns) partnersByRenewal.set(r.company_id, r.partners);
  }
  const renewals = renewalRows
    .map((r) => ({
      ...r,
      daysOut: Math.max(0, Math.ceil((new Date(r.renewal).getTime() - Date.now()) / 86_400_000)),
      openUsd: allOpps
        .filter((o) => o.company_id === r.company_id && !["closed_won", "closed_lost"].includes(o.stage))
        .reduce((s, o) => s + Number(o.amount_usd ?? 0), 0),
      engagement: engagementByCompany.get(r.company_id) ?? null,
      partners: partnersByRenewal.get(r.company_id) ?? [],
    }))
    .sort((a, b) => a.daysOut - b.daysOut)
    .slice(0, 12);

  // Timeframe filter: opportunities whose expected close falls within N days.
  const horizon = timeframe ? Date.now() + timeframe * 86_400_000 : null;
  const opps = horizon
    ? allOpps.filter((o) => o.expected_close_date && new Date(o.expected_close_date).getTime() <= horizon)
    : allOpps;

  const { rows: stakeholderRows } = await pool.query(
    `select s.opportunity_id, s.contact_id, s.role, s.sentiment, ct.name, ct.email
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

  const { rows: regRows } = await pool.query<DealReg>(
    `select id, opportunity_id, vendor, product, status, protected_until
     from deal_registrations where opportunity_id = any($1)
     order by created_at desc`,
    [opps.map((o) => o.id)],
  );
  const regByOpp = new Map<string, DealReg>();
  for (const r of regRows) if (r.opportunity_id && !regByOpp.has(r.opportunity_id)) regByOpp.set(r.opportunity_id, r);

  const meddpicc = await meddpiccFor(pool, opps.map((o) => o.id));
  const scoreOf = (id: string) => {
    const m = meddpicc.get(id);
    return m ? meddpiccScore(m) : 0;
  };

  // Quote-delivered signal, read from each opportunity's email conversation.
  const quotes = await quoteSignals(pool, opps.map((o) => o.id));
  const quoteOf = (id: string) => quotes.get(id) ?? { delivered: false, note: null, at: null };

  // Deal momentum (task #88): observed behavior beside the declared stage —
  // deterministic, cross-company aware (joint-room activity counts).
  const momentum = orgIdForRadar
    ? await dealMomentum(
        pool,
        orgIdForRadar,
        opps.map((o) => ({
          id: o.id,
          companyId: o.company_id,
          stage: o.stage,
          updatedAt: o.updated_at,
          quote: quoteOf(o.id),
        })),
      )
    : new Map<string, Momentum>();

  // Atomic filters (apply to both board and review; bentos/chart stay on the
  // full timeframe set so the totals don't move as you slice).
  const partnerOptions = [...new Set(allOpps.map((o) => o.partner_name).filter(Boolean) as string[])];
  const qualOf = (id: string) => (scoreOf(id) >= 70 ? "strong" : scoreOf(id) < 40 ? "risk" : "ok");
  const visible = opps.filter(
    (o) =>
      (!sp.stage || sp.stage === "all" || o.stage === sp.stage) &&
      (!sp.partner || sp.partner === "all" || (o.partner_name ?? "Direct") === sp.partner) &&
      (!sp.quote || sp.quote === "all" || (sp.quote === "yes" ? quoteOf(o.id).delivered : !quoteOf(o.id).delivered)) &&
      (!sp.qual || sp.qual === "all" || qualOf(o.id) === sp.qual),
  );

  const open = opps.filter((o) => !o.stage.startsWith("closed"));
  // Stage weights: the org's editable curve (Insights → calibration card),
  // with per-partner overrides applied to deals attributed to that partner.
  const stageWeights = await loadStageWeights(pool, await currentOrgId(pool));
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
  const tieOrgId = orgIdForRadar;
  let tieOut: {
    crmUsd: number;
    liveUsd: number;
    weightedUsd: number;
    deltas: { companyId: string; account: string; crm: number; live: number }[];
    weekAgo: { openUsd: number; takenOn: string } | null;
  } | null = null;
  if (tieOrgId) {
    const { rows: crmByCompany } = await pool.query<{ company_id: string; legal_name: string; crm: string }>(
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
      const { rows: weekAgoRows } = await pool.query<{ open_usd: string; taken_on: string }>(
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
    }
    // Today's snapshot, idempotent — history accrues just by looking.
    await pool.query(
      `insert into pipeline_snapshots (org_id, taken_on, open_count, open_usd, weighted_usd, crm_usd)
       values ($1, now()::date, $2, $3, $4, $5)
       on conflict (org_id, taken_on) do update
         set open_count = excluded.open_count, open_usd = excluded.open_usd,
             weighted_usd = excluded.weighted_usd, crm_usd = excluded.crm_usd`,
      [tieOrgId, open.length, total, weighted, tieOut?.crmUsd ?? null],
    );
  }

  return (
    <main>
      <PageHeader
        title="Pipeline"
        subtitle="Opportunities advanced from motions. Weighted by declared stage probabilities until outcomes calibrate them."
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
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Bento label="open opportunities" value={open.length} href="/pipeline" />
              <Bento label="total pipeline" value={`$${Math.round(total / 1000)}k`} />
              <Bento label="weighted" value={`$${Math.round(weighted / 1000)}k`} subs={["by stage probability"]} />
              <Bento label="avg qualification" value={avgQual == null ? "—" : `${avgQual}`} subs={["MEDDPICC health"]} />
              <Bento label="won" value={wonCount} subs={[`$${Math.round(wonUsd / 1000)}k`]} href="/pipeline?stage=closed_won" />
              <Bento label="reg'd deals" value={regRows.length} href="/pipeline?view=review" />
            </div>

            {/* ── Tie-out (task #87): one place where the numbers reconcile ── */}
            {tieOut && (
              <Card className="mb-5">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Does it tie out?</h2>
                  <span className="text-[11px] text-neutral-400">CRM export vs live record, account by account</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span>Your CRM export says <span className="tnum font-semibold">${Math.round(tieOut.crmUsd / 1000)}k</span></span>
                  <span>PursuitOS holds <span className="tnum font-semibold">${Math.round(tieOut.liveUsd / 1000)}k</span> on those accounts</span>
                  <span className={Math.abs(tieOut.crmUsd - tieOut.liveUsd) < 1 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                    {Math.abs(tieOut.crmUsd - tieOut.liveUsd) < 1
                      ? "Ties out."
                      : `${tieOut.crmUsd > tieOut.liveUsd ? "+" : "−"}$${Math.round(Math.abs(tieOut.crmUsd - tieOut.liveUsd) / 1000)}k apart`}
                  </span>
                  {tieOut.weekAgo && (
                    <span className="text-neutral-500">
                      Open pipeline {tieOut.weekAgo.takenOn}: <span className="tnum">${Math.round(tieOut.weekAgo.openUsd / 1000)}k</span>
                      {" → "}today: <span className="tnum">${Math.round(total / 1000)}k</span>
                    </span>
                  )}
                </div>
                {tieOut.deltas.length > 0 ? (
                  <ul className="space-y-1">
                    {tieOut.deltas.map((d) => (
                      <li key={d.companyId} className="flex items-center gap-2 text-sm">
                        <Link href={`/accounts/${d.companyId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {d.account}
                        </Link>
                        <span className="tnum text-xs text-neutral-500">CRM ${Math.round(d.crm / 1000)}k</span>
                        <span className="tnum text-xs text-neutral-500">live ${Math.round(d.live / 1000)}k</span>
                        <span className="tnum w-16 text-right text-xs font-semibold text-amber-700 dark:text-amber-400">
                          {d.crm > d.live ? "+" : "−"}${Math.round(Math.abs(d.crm - d.live) / 1000)}k
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">
                    Every account with a CRM snapshot matches the live record.
                  </p>
                )}
                <p className="mt-2 text-[11px] text-neutral-400">
                  Somebody&rsquo;s number is usually wrong — this names whose, with the receipts on each account&rsquo;s timeline.
                </p>
              </Card>
            )}

            {/* ── Renewal radar (B+3): the co-sell clock ── */}
            {renewals.length > 0 && (
              <Card tone="amber" className="mb-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Renewal radar</h2>
                <p className="mb-3 text-xs text-neutral-500">
                  Renewals inside 120 days across your approved lists. Quiet engagement is decay risk; the partners
                  column is who to attach before the clock runs out.
                </p>
                <ul className="space-y-1.5">
                  {renewals.map((r) => (
                    <li key={r.company_id} className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`/accounts/${r.company_id}`} className="min-w-0 font-medium hover:underline">
                        {r.legal_name}
                      </Link>
                      <span
                        className={`tnum rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          r.daysOut <= 30
                            ? "bg-rose/12 text-rose dark:text-rose-300"
                            : "bg-amber/14 text-amber dark:text-amber-300"
                        }`}
                      >
                        in {r.daysOut}d
                      </span>
                      <span className="text-[11px] text-neutral-400">{r.renewal} · from “{r.list_name}”</span>
                      <span className="ml-auto flex items-center gap-2 text-[11.5px]">
                        {r.partners.length > 0 && (
                          <span className="text-violet dark:text-violet-300">{r.partners.join(", ")}</span>
                        )}
                        <span className={r.engagement == null ? "text-neutral-400" : "text-neutral-500"}>
                          {r.engagement == null ? "engagement quiet" : `engagement ${Math.round(r.engagement)}`}
                        </span>
                        <span className={r.openUsd > 0 ? "tnum font-semibold" : "text-neutral-400"}>
                          {r.openUsd > 0 ? `$${Math.round(r.openUsd / 1000)}k open` : "no open opp"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Roll-up chips — each is a count AND an atomic filter (click to slice). */}
            {(() => {
              const chipHref = (o: Record<string, string | undefined>) => {
                const p = new URLSearchParams();
                p.set("view", view);
                for (const [k, v] of Object.entries({ timeframe: sp.timeframe, stage: sp.stage, partner: sp.partner, quote: sp.quote, qual: sp.qual, ...o })) if (v) p.set(k, v);
                return `/pipeline?${p.toString()}`;
              };
              const chip = (label: string, count: number, active: boolean, href: string, tone = "neutral") => {
                const tones: Record<string, string> = {
                  neutral: "text-neutral-600 dark:text-neutral-300",
                  green: "text-green-700 dark:text-green-400",
                  amber: "text-amber-700 dark:text-amber-400",
                  red: "text-red-700 dark:text-red-400",
                  blue: "text-blue-700 dark:text-blue-400",
                };
                return (
                  <Link key={label} href={href} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${active ? "border-accent bg-accent text-white" : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"}`}>
                    <span className={`tnum font-semibold ${active ? "" : tones[tone]}`}>{count}</span>
                    <span className={active ? "" : "text-neutral-500"}>{label}</span>
                  </Link>
                );
              };
              const cStage = (s: string) => opps.filter((o) => o.stage === s).length;
              const quoteSent = opps.filter((o) => quoteOf(o.id).delivered).length;
              const strong = opps.filter((o) => qualOf(o.id) === "strong").length;
              const risk = opps.filter((o) => qualOf(o.id) === "risk").length;
              const noFilters = !sp.stage && !sp.quote && !sp.qual;
              return (
                <div className="mb-5 flex flex-wrap gap-2">
                  {chip("all", opps.length, noFilters, chipHref({ stage: undefined, quote: undefined, qual: undefined }))}
                  {[...STAGES, "closed_won", "closed_lost"].map((s) =>
                    chip(s.replace(/_/g, " "), cStage(s), sp.stage === s, chipHref({ stage: sp.stage === s ? undefined : s }), s === "closed_won" ? "green" : s === "closed_lost" ? "red" : "blue"),
                  )}
                  {chip("quote sent", quoteSent, sp.quote === "yes", chipHref({ quote: sp.quote === "yes" ? undefined : "yes" }), "green")}
                  {chip("well-qualified", strong, sp.qual === "strong", chipHref({ qual: sp.qual === "strong" ? undefined : "strong" }), "green")}
                  {chip("at risk", risk, sp.qual === "risk", chipHref({ qual: sp.qual === "risk" ? undefined : "risk" }), "amber")}
                </div>
              );
            })()}
            {(wonQual != null || lostQual != null) && (
              <Card className="mb-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">AI learned signal · qualification vs outcome</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Closed-won deals qualified at <span className="font-semibold text-green-700 dark:text-green-400">{wonQual ?? "—"}</span> MEDDPICC health on average;
                  closed-lost at <span className="font-semibold text-red-700 dark:text-red-400">{lostQual ?? "—"}</span>.
                  {wonQual != null && lostQual != null && wonQual > lostQual && (
                    <> The <span className="font-medium">+{wonQual - lostQual}</span> gap is the pattern the model banks at each close — stronger qualification, higher conversion.</>
                  )}
                </p>
              </Card>
            )}
            {stageRows.length > 0 && (
              <Card className="mb-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Open opportunities by stage</h2>
                <MiniBar rows={stageRows} />
              </Card>
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
                <Card className="mb-5">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Pipeline &amp; revenue roll-up</h2>
                    <span className="text-[11px] text-neutral-400">open pipeline · base (direct) vs joint (co-sell)</span>
                  </div>
                  {/* Base vs joint split bar */}
                  <div className="mb-1 flex h-5 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                    <div className="flex items-center justify-center bg-neutral-400 text-[10px] font-medium text-white dark:bg-neutral-600" style={{ width: `${totalOpen ? (baseOpen / totalOpen) * 100 : 0}%` }} title={`Base $${Math.round(baseOpen / 1000)}k`} />
                    <div className="flex items-center justify-center bg-teal-500 text-[10px] font-medium text-white" style={{ width: `${totalOpen ? (jointOpen / totalOpen) * 100 : 0}%` }} title={`Joint $${Math.round(jointOpen / 1000)}k`} />
                  </div>
                  <div className="mb-4 flex gap-4 text-[11px] text-neutral-500">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-neutral-400 dark:bg-neutral-600" /> base ${Math.round(baseOpen / 1000)}k</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-teal-500" /> joint / co-sell ${Math.round(jointOpen / 1000)}k</span>
                    <span className="ml-auto">co-sell lift {totalOpen ? Math.round((jointOpen / totalOpen) * 100) : 0}%</span>
                  </div>
                  {/* Per-partner: open (teal) + won (green) */}
                  {partners.length > 0 ? (
                    <div className="space-y-2">
                      {partners.map(([name, v]) => (
                        <div key={name} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-xs text-neutral-600 dark:text-neutral-300" title={name}>{name}</span>
                          <div className="flex h-4 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                            <div className="bg-teal-500" style={{ width: `${((v.open) / maxP) * 100}%` }} title={`open $${Math.round(v.open / 1000)}k`} />
                            <div className="bg-green-600" style={{ width: `${((v.won) / maxP) * 100}%` }} title={`won $${Math.round(v.won / 1000)}k`} />
                          </div>
                          <span className="tnum w-24 shrink-0 text-right text-xs text-neutral-500">${Math.round(v.open / 1000)}k{v.won ? ` · ${Math.round(v.won / 1000)}k won` : ""}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-400">No partner-attributed pipeline yet — opportunities inherit their partner from the motion.</p>
                  )}
                </Card>
              );
            })()}
          </>
        );
      })()}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {(["board", "review"] as const).map((v) => {
          const qs = new URLSearchParams();
          qs.set("view", v);
          for (const k of ["timeframe", "stage", "partner", "quote", "qual"] as const) if (sp[k]) qs.set(k, sp[k]!);
          return (
            <Link
              key={v}
              href={`/pipeline?${qs.toString()}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                view === v
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              {v === "board" ? "Board" : "Review + deal reg"}
            </Link>
          );
        })}
        <QuerySelect param="stage" value={sp.stage ?? "all"} label="Stage" options={[{ value: "all", label: "Any stage" }, ...STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })), { value: "closed_won", label: "closed won" }, { value: "closed_lost", label: "closed lost" }]} />
        {partnerOptions.length > 0 && (
          <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        )}
        <QuerySelect param="quote" value={sp.quote ?? "all"} label="Quote" options={[{ value: "all", label: "Any" }, { value: "yes", label: "Quote sent" }, { value: "no", label: "No quote" }]} />
        <QuerySelect param="timeframe" value={sp.timeframe ?? "all"} label="Closing within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <span className="ml-auto text-xs text-neutral-500">{visible.length} of {opps.length}</span>
      </div>

      {opps.length === 0 && (
        <p className="text-sm text-neutral-500">
          No opportunities yet — promote an active motion from its brief when a conversation
          earns a meeting.
        </p>
      )}
      {opps.length > 0 && visible.length === 0 && (
        <p className="text-sm text-neutral-500">No opportunities match these filters — clear one above.</p>
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
                      <div className="text-[11px] text-neutral-400">{o.legal_name}</div>
                    </td>
                    <td className="text-xs text-neutral-500">{o.partner_name ?? "—"}</td>
                    <td className="text-xs uppercase tracking-wide text-neutral-500">{o.stage.replace(/_/g, " ")}</td>
                    <td className="tnum text-right">{amt != null ? `$${Math.round(amt / 1000)}k` : "—"}</td>
                    <td className="tnum text-right text-neutral-500">
                      {amt != null && !closed ? `$${Math.round((amt * probOf(o)) / 1000)}k` : "—"}
                    </td>
                    <td className="tnum text-right">
                      {(() => {
                        const s = scoreOf(o.id);
                        const tone = s >= 70 ? "text-green-700 dark:text-green-400" : s >= 40 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
                        return <span className={tone}>{s}</span>;
                      })()}
                    </td>
                    <td className="text-xs">
                      {quote.delivered ? (
                        <span className="text-green-700 dark:text-green-400" title={quote.note ?? undefined}>✓ sent{quote.at ? ` ${quote.at}` : ""}</span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="text-xs text-neutral-500">{o.expected_close_date ? new Date(o.expected_close_date).toISOString().slice(0, 10) : "—"}</td>
                    <td>
                      {reg ? (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={reg.status === "approved" ? "approved" : reg.status === "rejected" ? "rejected" : reg.status === "submitted" ? "running" : "skipped"} />
                          <span className="text-[11px] text-neutral-400">
                            {reg.vendor ?? "vendor"}{reg.protected_until ? ` · until ${reg.protected_until}` : ""}
                          </span>
                          {reg.status === "submitted" && (
                            <span className="flex gap-1">
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "approved")}>
                                <button className="text-[11px] font-medium text-green-700 hover:underline dark:text-green-400">approve</button>
                              </form>
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "rejected")}>
                                <button className="text-[11px] font-medium text-red-700 hover:underline dark:text-red-400">reject</button>
                              </form>
                            </span>
                          )}
                        </div>
                      ) : closed ? (
                        <span className="text-xs text-neutral-400">—</span>
                      ) : (
                        <form action={registerDealAction.bind(null, o.id)} className="flex items-center gap-1">
                          <input name="vendor" placeholder="vendor" className="w-20 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-neutral-700" />
                          <input name="product" placeholder="product" className="w-24 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-neutral-700" />
                          <button className="rounded bg-blue-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-800">Register</button>
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

      {view === "board" && visible.length > 0 && (
      <div className="space-y-4">
        {visible.map((o) => {
          const stakeholders = stakeholdersByOpp.get(o.id) ?? [];
          const gaps = o.stage.startsWith("closed") ? [] : stakeholderGaps(stakeholders);
          const stageIdx = STAGES.indexOf(o.stage as (typeof STAGES)[number]);
          const won = o.stage === "closed_won";
          const lost = o.stage === "closed_lost";
          const quote = quoteOf(o.id);
          const mo = momentum.get(o.id);
          return (
            <Card key={o.id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/accounts/${o.company_id}`} className="font-semibold hover:underline">
                  {o.name}
                </Link>
                <span className={`text-xs font-medium uppercase tracking-wide ${won ? "text-green-700 dark:text-green-400" : lost ? "text-red-700 dark:text-red-400" : "text-neutral-500"}`}>
                  {o.stage.replace(/_/g, " ")}
                </span>
                {mo && (
                  <span
                    title={mo.reasons.join(" · ") || "observed behavior over the last 14 days"}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      mo.verdict === "advancing"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : mo.verdict === "at_risk"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : mo.verdict === "stalling"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                    }`}
                  >
                    {mo.jointActive ? "◆ " : ""}{MOMENTUM_LABEL[mo.verdict]}
                  </span>
                )}
                {o.amount_usd != null && (
                  <span className="tnum text-sm text-neutral-500">
                    ${Math.round(Number(o.amount_usd) / 1000)}k
                    {!o.stage.startsWith("closed") &&
                      ` · $${Math.round((Number(o.amount_usd) * probOf(o)) / 1000)}k weighted`}
                  </span>
                )}
                {o.partner_name && (
                  <span className="text-xs text-neutral-400">via {o.partner_name}</span>
                )}
                {o.expected_close_date && (
                  <span className="text-xs text-neutral-400">· close {new Date(o.expected_close_date).toISOString().slice(0, 10)}</span>
                )}
                {quote.delivered ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300" title={quote.note ?? "detected in email conversation"}>
                    quote sent{quote.at ? ` · ${quote.at}` : ""}
                  </span>
                ) : (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800" title="no priced document detected in the conversation yet">no quote</span>
                )}
                {o.motion_id && (
                  <Link
                    href={`/briefs/${o.motion_id}`}
                    className="ml-auto text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    Brief →
                  </Link>
                )}
              </div>

              {/* Stage timeline — shown for every opportunity, won or lost or open. */}
              <div className="mb-2 flex gap-1">
                {STAGES.map((s, idx) => {
                  const on = won ? true : lost ? false : idx <= stageIdx;
                  const isCurrent = !o.stage.startsWith("closed") && idx === stageIdx;
                  const tone = won ? "bg-green-500" : on ? (isCurrent ? "bg-blue-600" : "bg-blue-400") : "bg-neutral-200 dark:bg-neutral-700";
                  return (
                    <div key={s} className="flex-1" title={s.replace(/_/g, " ")}>
                      <div className={`h-1.5 rounded-full ${tone}`} />
                      <div className={`mt-0.5 hidden text-[9px] uppercase tracking-wide sm:block ${isCurrent ? "font-semibold text-blue-700 dark:text-blue-400" : "text-neutral-400"}`}>{s.replace(/_/g, " ")}</div>
                    </div>
                  );
                })}
              </div>
              {lost && <p className="mb-2 text-[11px] font-medium text-red-700 dark:text-red-400">Closed lost — stages shown for the record.</p>}

              {gaps.length > 0 && (
                <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Risk: {gaps.join(" · ")}
                </p>
              )}

              {stakeholders.length > 0 && (
                <div className="mb-2 space-y-1">
                  {stakeholders.map((s) => (
                    <form
                      key={s.contact_id}
                      action={setStakeholderAction.bind(null, o.id, s.contact_id)}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="font-medium">{s.name ?? s.email}</span>
                      <select
                        name="role"
                        defaultValue={s.role}
                        className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        name="sentiment"
                        defaultValue={s.sentiment}
                        className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                      >
                        {SENTIMENTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                      >
                        Save
                      </button>
                    </form>
                  ))}
                </div>
              )}

              {/* MEDDPICC qualification */}
              {(() => {
                const m = meddpicc.get(o.id)!;
                const score = meddpiccScore(m);
                const gaps = meddpiccGaps(m);
                const scoreTone = score >= 70 ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : score >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
                return (
                  <details className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                    <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
                      <span className="uppercase tracking-wide">MEDDPICC</span>
                      <span className={`tnum rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreTone}`}>{score}</span>
                      <span className="text-[11px] font-normal text-neutral-400">
                        {gaps.length === 0 ? "fully qualified" : `${gaps.length} to firm up`}
                      </span>
                    </summary>
                    <div className="mt-2">
                      <form action={assessMeddpiccAction.bind(null, o.id)} className="mb-2 flex items-center gap-2">
                        <button className="rounded-md px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:ring-blue-800 dark:hover:bg-blue-950">
                          AI assess from evidence
                        </button>
                        <span className="text-[10px] text-neutral-400">drafts every element you haven&rsquo;t set from stakeholders &amp; verified signals — your call to keep</span>
                      </form>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {ELEMENTS.map((e) => {
                          const st = m[e.key];
                          return (
                            <form key={e.key} action={setMeddpiccAction.bind(null, o.id, e.key)} className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 dark:border-neutral-800" title={e.hint}>
                              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] font-bold text-neutral-500 dark:bg-neutral-800">{e.letter}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-[11px] font-medium">{e.label}</span>
                                  {st.source === "ai_assist" && <span className="rounded bg-blue-100 px-1 text-[8px] font-bold uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-300" title="AI-drafted, unconfirmed">AI</span>}
                                </div>
                                <input name="notes" defaultValue={st.notes ?? ""} placeholder="notes" className="mt-0.5 w-full rounded border border-transparent bg-transparent text-[11px] text-neutral-500 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-700" />
                              </div>
                              <select name="status" defaultValue={st.status} className={`rounded px-1 py-0.5 text-[10px] font-medium ${STATUS_TONE[st.status]}`}>
                                {MEDDPICC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                              </select>
                              <button className="text-[10px] font-medium text-blue-700 hover:underline dark:text-blue-400">save</button>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })()}

              {!o.stage.startsWith("closed") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...STAGES, "closed_won", "closed_lost"]
                    .filter((s) => {
                      const idx = STAGES.indexOf(s as (typeof STAGES)[number]);
                      if (s === "closed_won" || s === "closed_lost") return true;
                      return idx > stageIdx || idx === stageIdx - 1;
                    })
                    .map((s) => (
                      <form key={s} action={advanceOpportunityAction.bind(null, o.id, s as Stage)}>
                        <button
                          type="submit"
                          className={
                            s === "closed_won"
                              ? "rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800"
                              : s === "closed_lost"
                                ? "rounded-md px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950"
                                : "rounded-md px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                          }
                        >
                          {s.replace(/_/g, " ")}
                        </button>
                      </form>
                    ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      )}
    </main>
  );
}
