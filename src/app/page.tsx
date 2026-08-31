import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { rankNextActions, type NextAction, type PortfolioState } from "@/lib/portfolio/next-best";
import { BandBadge, Card, CountChip, PageHeader, StatusBadge } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { accountDivergences } from "@/lib/context/divergence";
import { enabledTriggers } from "@/lib/triggers/catalog";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getTodayQueue, getTodayExposure, type TodayExposure } from "@/lib/pursuits/read-models/today";
import { callerFor } from "@/lib/pursuits/read-models/caller";
import { Panel } from "@/components/pursuit/panel";
import { TodayQueue } from "@/components/pursuit/today";
import { SyntheticBadge } from "@/components/pursuit/parts";
import type { TodayQueueView } from "@/lib/pursuits/read-models/types";
import { getScopeContext, scopeParamFrom } from "@/lib/scope/server";
import { getAccountIntel } from "@/lib/accounts/intel";
import { IntelDrawer } from "@/components/intel/intel-drawer";

export const dynamic = "force-dynamic";

const TODAY_TOP_DECISIONS = 6;
const TODAY_TOP_CONDITIONS = 4;
const usdShort = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

/** Preserve the query (scope etc.) while dropping the `today` view-all flag. */
function cleanQuery(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (k !== "today" && typeof v === "string") out[k] = v;
  return out;
}

function ExposureFigure({ value, label, strong, accent }: { value: string; label: string; strong?: boolean; accent?: string }) {
  return (
    <span className="flex flex-col">
      <span className="tnum font-extrabold leading-none" style={{ fontSize: strong ? 24 : 19, color: accent }}>{value}</span>
      <span className="mt-1 text-[11px] text-neutral-500">{label}</span>
    </span>
  );
}

async function loadNextActions() {
  return withTenant(async (db, orgId) => {
    const [drafts, approved, review, contradictions, refreshes] = await Promise.all([
      db.query(
        `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
       where m.status = 'draft'`,
      ),
      db.query(
        `select m.id, c.legal_name, m.estimated_value_usd, p.score as propensity,
              exists (select 1 from campaigns cp where cp.motion_id = m.id) as has_campaign
       from revenue_motions m
       join companies c on c.id = m.company_id
       left join propensity_scores p on p.id = m.propensity_score_id
       where m.status = 'approved'`,
      ),
      db.query(`select count(*) as n from review_queue where status = 'pending'`),
      db.query(
        `select distinct c.id, c.legal_name from contradictions ct
       join companies c on c.id = ct.company_id where ct.status = 'open'`,
      ),
      db.query(
        `select id, legal_name, refresh_tier from companies
       where next_refresh_at is not null and next_refresh_at <= now()`,
      ),
    ]);

    const expected = (v: unknown, p: unknown) =>
      v == null ? null : Math.round((Number(v) * (p == null ? 50 : Number(p))) / 100);

    const state: PortfolioState = {
      draftMotions: drafts.rows.map((m) => ({
        motionId: m.id,
        company: m.legal_name,
        expectedValueUsd: expected(m.estimated_value_usd, m.propensity),
      })),
      approvedMotions: approved.rows.map((m) => ({
        motionId: m.id,
        company: m.legal_name,
        expectedValueUsd: expected(m.estimated_value_usd, m.propensity),
        hasCampaign: m.has_campaign,
      })),
      pendingReviewCount: Number(review.rows[0].n),
      openContradictions: contradictions.rows.map((c) => ({
        company: c.legal_name,
        companyId: c.id,
      })),
      refreshDue: refreshes.rows.map((r) => ({
        company: r.legal_name,
        companyId: r.id,
        tier: r.refresh_tier ?? "low",
      })),
    };
    const ranked = rankNextActions(state, 6);

    // Renewal windows surfaced by the account-digest routine (task #77): a
    // renewal inside 90 days is decision-shaped, not FYI — it belongs here,
    // not just on the account card.
    const renewalActions: NextAction[] = [];
    if ((await enabledTriggers(db, orgId)).has("renewal_window")) {
      const { rows: digests } = await db.query<{
        company_id: string;
        legal_name: string;
        items: { type: string; text: string; at: string }[];
      }>(
        `select distinct on (d.company_id) d.company_id, c.legal_name, d.items
       from account_digests d join companies c on c.id = d.company_id
       where d.org_id = $1
       order by d.company_id, d.created_at desc`,
        [orgId],
      );
      for (const d of digests) {
        const renewal = (d.items ?? []).find((it) => it.type === "renewal");
        if (!renewal) continue;
        renewalActions.push({
          type: "RENEWAL_WINDOW",
          priority: 70,
          title: `Plan the renewal — ${d.legal_name}`,
          reason: `${renewal.text} (from this week's account digest)`,
          href: `/accounts/${d.company_id}`,
        });
      }
    }
    return [...ranked, ...renewalActions].slice(0, 7);
  });
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const viewAll = sp.today === "all";
  // Ecosystem scope (scale-disclosure §1): narrow every primary surface to the authorized
  // company-id set. null = the full RLS-scoped set. Re-authorized server-side each request.
  const scope = await getScopeContext(scopeParamFrom(sp));
  const scopeIds = scope.companyIds;

  // Contextual intelligence drawer (§4 / R7): fetched (and serialized) only when ?drawer= is present.
  const drawerId = typeof sp.drawer === "string" ? sp.drawer : undefined;
  const drawerIntel = drawerId ? await withTenant((db) => getAccountIntel(db, drawerId)) : null;
  const preserved = new URLSearchParams();
  for (const kk of ["scope", "today"]) { const v = sp[kk]; if (typeof v === "string") preserved.set(kk, v); }
  const drawerHref = (companyId: string) => { const p = new URLSearchParams(preserved); p.set("drawer", companyId); const qs = p.toString(); return qs ? `/?${qs}` : "/"; };
  const drawerCloseHref = preserved.toString() ? `/?${preserved.toString()}` : "/";
  const drawerBase = preserved.toString();

  const nextActions = await loadNextActions();

  // Pursuit decision queue (D.5 §20): the operating queue — what needs my
  // decision that can materially change revenue, ordered by materiality. Compressed to a
  // command-center top-N by default (§2); the full queue renders under ?today=all.
  let pursuitQueue: TodayQueueView | null = null;
  let exposure: TodayExposure | null = null;
  if (pursuitExperienceEnabled()) {
    ({ pursuitQueue, exposure } = await withTenant(async (db, orgId) => ({
      pursuitQueue: await getTodayQueue(db, await callerFor(db, orgId), { companyIds: scopeIds, limit: viewAll ? undefined : TODAY_TOP_DECISIONS }),
      exposure: await getTodayExposure(db, scopeIds),
    })));
  }

  // Reality-divergence detection (task #83): where the systems disagree —
  // with each other, or with the partner's side of the deal.
  const { divergences: allDivergences, counts, drafts, top, activity } = await withTenant(async (db, orgId) => {
    const rawDiv = await accountDivergences(db, orgId, 12);
    // Scope narrowing (§1): keep only conditions on in-scope accounts.
    const divergences = scopeIds == null ? rawDiv : rawDiv.filter((d) => scopeIds.includes(d.companyId));
    const [countsRes, draftsRes, topRes, activityRes] = await Promise.all([
      db.query(
        `select
           (select count(*) from revenue_motions where status = 'draft') as draft_motions,
           (select count(*) from review_queue where status = 'pending') as pending_review,
           (select count(distinct company_id) from propensity_scores) as scored_accounts,
           (select count(*) from evidence where status = 'verified') as verified_evidence`,
      ),
      db.query(
        `select m.id, m.trigger_summary, m.confidence, c.legal_name, c.id as company_id, n.slug
         from revenue_motions m
         join companies c on c.id = m.company_id
         join taxonomy_nodes n on n.id = m.taxonomy_node_id
         where m.status = 'draft' order by m.created_at limit 5`,
      ),
      db.query(
        `select distinct on (p.company_id) p.company_id, p.score, p.band, c.legal_name, n.slug
         from propensity_scores p
         join companies c on c.id = p.company_id
         join taxonomy_nodes n on n.id = p.taxonomy_node_id
         where ($2::boolean is false or p.company_id = any($1))
         order by p.company_id, p.computed_at desc`,
        [scopeIds ?? [], scopeIds != null],
      ),
      db.query(
        `select e.event_type, e.occurred_at, c.legal_name
         from outcome_events e left join companies c on c.id = e.company_id
         where ($2::boolean is false or e.company_id = any($1))
         order by e.occurred_at desc limit 6`,
        [scopeIds ?? [], scopeIds != null],
      ),
    ]);
    return { divergences, counts: countsRes.rows, drafts: draftsRes.rows, top: topRes.rows, activity: activityRes.rows };
  });
  const c = counts[0];
  const topRanked = [...top].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 5);
  // Command-center cut (§2): show the top conditions by default; ?today=all reveals the rest.
  const divergences = viewAll ? allDivergences : allDivergences.slice(0, TODAY_TOP_CONDITIONS);
  const decisionsTotal = pursuitQueue?.total ?? pursuitQueue?.items.length ?? 0;

  return (
    <main>
      <PageHeader
        title="Today"
        subtitle="What needs your decision, and where the next revenue is."
      />
      <RoomTabs tabs={[{ href: "/", label: "Today" }, { href: "/queue", label: "Queue" }]} />

      {/* Revenue exposure band (§2): one calm row — where the revenue is, in the active scope. */}
      {exposure && (
        <Card className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
              Exposure{scope.scope.kind !== "ALL" ? ` · ${scope.label}` : ""}
            </h2>
            <span className="text-label text-neutral-400">open pipeline, weighted, and what needs deciding</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-7 gap-y-2">
            <ExposureFigure value={usdShort(exposure.openUsd)} label="open pipeline" strong />
            <ExposureFigure value={usdShort(exposure.weightedUsd)} label="weighted" />
            <ExposureFigure value={String(decisionsTotal)} label={`decision${decisionsTotal === 1 ? "" : "s"} to make`} accent="var(--color-priority)" />
            <ExposureFigure value={String(allDivergences.length)} label={`condition${allDivergences.length === 1 ? "" : "s"}`} accent="var(--color-accent-attention)" />
            <ExposureFigure value={usdShort(exposure.wonUsdPeriod)} label={`won · 90d (${exposure.wonCountPeriod})`} accent="var(--color-accent-verified)" />
          </div>
        </Card>
      )}

      {pursuitQueue && pursuitQueue.items.length > 0 && (
        <Panel
          eyebrow="What can materially change revenue — ordered by materiality, not arrival"
          title="Decisions that move revenue"
          accent="var(--color-priority)"
          className="mb-6"
          aside={pursuitQueue.demoBanner ? <SyntheticBadge text="Demo environment" /> : undefined}
        >
          <TodayQueue items={pursuitQueue.items} drawerBase={drawerBase} />
          {!viewAll && decisionsTotal > pursuitQueue.items.length && (
            <div className="mt-3">
              <Link href={{ query: { ...cleanQuery(sp), today: "all" } }} className="text-[12.5px] font-semibold text-accent hover:underline dark:text-blue-400">
                View all {decisionsTotal} decisions →
              </Link>
            </div>
          )}
          {viewAll && (
            <div className="mt-3">
              <Link href={{ query: cleanQuery(sp) }} className="text-[12.5px] font-medium text-neutral-500 hover:underline">← Back to command center</Link>
            </div>
          )}
        </Panel>
      )}

      {/* Where your systems disagree — first-class intelligence, promoted to sit with
          the decision queue (not a secondary table). The cross-company rules only a
          two-sided platform can run. */}
      {divergences.length > 0 && (
        <Card tone="amber" className="mb-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--color-accent-attention)" }}>
              Where your systems disagree
            </h2>
            {!viewAll && allDivergences.length > divergences.length ? (
              <Link href={{ query: { ...cleanQuery(sp), today: "all" } }} className="text-label font-semibold text-accent hover:underline dark:text-blue-400">View all {allDivergences.length} →</Link>
            ) : (
              <span className="text-label text-neutral-400">the record and the deal have parted ways — each row names both</span>
            )}
          </div>
          <ul className="space-y-px">
            {divergences.map((d, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-control px-2 py-1.5 text-sm transition-colors hover:bg-[var(--surface-inset)]">
                <span className="mt-1 h-6 w-0.5 shrink-0 rounded-full" style={{ background: d.kind === "joint_vs_pipeline" ? "var(--color-accent-violet)" : "var(--color-accent-attention)" }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <Link href={drawerHref(d.companyId)} scroll={false} className="font-semibold hover:underline" title="Open account intelligence">{d.account}</Link>
                  <span className="text-neutral-500"> — {d.text}</span>
                </span>
                <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-400">{d.kind.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Instrumentation is secondary to decisions (D.5 §4): when the decision
          queue leads, the KPI strip steps back — smaller and dimmer — so Today
          is dominated by what needs acting on, not empty counters. */}
      <div className={pursuitQueue && pursuitQueue.items.length > 0 ? "mb-6" : "mb-6"}>
        {pursuitQueue && pursuitQueue.items.length > 0 && (
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-400">At a glance</div>
        )}
        <div className={`flex flex-wrap gap-2 ${pursuitQueue && pursuitQueue.items.length > 0 ? "scale-[0.92] origin-left opacity-75" : ""}`}>
          <CountChip label="Awaiting approval" value={c.draft_motions} href="/motions" tone={Number(c.draft_motions) > 0 ? "amber" : "neutral"} />
          <CountChip label="Evidence to review" value={c.pending_review} href="/review" tone={Number(c.pending_review) > 0 ? "amber" : "neutral"} />
          <CountChip label="Scored accounts" value={c.scored_accounts} href="/accounts" tone="sky" />
          <CountChip label="Verified evidence" value={c.verified_evidence} href="/sources" tone="green" />
        </div>
      </div>

      {nextActions.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Next best actions
          </h2>
          <ol className="space-y-2">
            {nextActions.map((a, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="tnum w-5 text-right font-semibold text-neutral-400">{i + 1}</span>
                <span>
                  <Link href={a.href} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <span className="ml-2 text-neutral-500">— {a.reason}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Pending approvals
          </h2>
          {drafts.length === 0 ? (
            <p className="text-sm text-neutral-500">
              All clear — new motions appear here when the designer drafts them.
            </p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((m) => (
                <li key={m.id} className="text-sm">
                  <Link href="/motions" className="font-medium hover:underline">
                    {m.legal_name}
                  </Link>{" "}
                  <span className="text-neutral-500">— {m.slug}</span>
                  <p className="mt-0.5 line-clamp-2 text-neutral-600 dark:text-neutral-400">
                    {m.trigger_summary}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Top opportunities
          </h2>
          {topRanked.length === 0 ? (
            <p className="text-sm text-neutral-500">Run the scoring pipeline to populate.</p>
          ) : (
            <ul className="space-y-2">
              {topRanked.map((r) => (
                <li key={r.company_id} className="flex items-center justify-between text-sm">
                  <Link href={drawerHref(r.company_id)} scroll={false} className="font-medium hover:underline" title="Open account intelligence">
                    {r.legal_name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="tnum font-semibold">{Number(r.score).toFixed(0)}</span>
                    <BandBadge band={r.band} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-neutral-500">Outcome events land here.</p>
        ) : (
          <ul className="space-y-1.5">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <StatusBadge status={a.event_type.toLowerCase().replace(/_/g, " ")} />
                <span>{a.legal_name}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(a.occurred_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {drawerIntel && <IntelDrawer intel={drawerIntel} closeHref={drawerCloseHref} />}
    </main>
  );
}
