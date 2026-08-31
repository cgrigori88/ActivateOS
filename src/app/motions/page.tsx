import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { Bento, Card, MiniBar, NextStep, PageHeader, StatusBadge } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { goalOptions } from "@/lib/goals/goals";
import {
  abandonMotionAction, editMotionAction,
  activateMotionAction,
  approveMotionAction,
  completeMotionAction,
  draftMotionsAction,
  rejectMotionAction,
  setMotionGoalAction,
  setMotionInitiativeAction,
} from "./actions";
import { initiativeOptions } from "@/lib/partnerships/initiatives";
import { getScopeContext } from "@/lib/scope/server";
import { getMotionFunnels } from "@/lib/motions/funnel";
import { MotionFunnelCommand, MotionConstraintDrawer } from "@/components/motions/funnel-command";

export const dynamic = "force-dynamic";
// AI drafting actions invoked from this segment can run tens of seconds —
// raise the serverless limit so generation never dies as a platform timeout.
export const maxDuration = 60;

const STATUS_ORDER = ["draft", "approved", "active", "completed", "abandoned"];

interface MotionRow {
  id: string;
  status: string;
  thesis: string;
  trigger_summary: string;
  operator_notes: string | null;
  cta: string;
  confidence: string;
  company_id: string;
  legal_name: string;
  slug: string;
  industry: string | null;
  outcome: string | null;
  estimated_value_usd: string | null;
  effort: number | null;
  propensity: string | null;
  partner_name: string | null;
  goal_id: string | null;
  initiative_id: string | null;
  goal_name: string | null;
}

const GROUPS: Record<string, { label: string; key: (m: MotionRow) => string }> = {
  status: { label: "Status", key: (m) => m.status },
  solution: { label: "Solution / play", key: (m) => m.slug },
  vertical: { label: "Vertical", key: (m) => m.industry ?? "—" },
  partner: { label: "Partner", key: (m) => m.partner_name ?? "Direct" },
  goal: { label: "Goal", key: (m) => m.goal_name ?? "No goal" },
  company: { label: "Company", key: (m) => m.legal_name },
};

export default async function MotionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    partner?: string;
    goal?: string;
    group?: string;
    approved?: string;
    compose?: string;
    drafted?: string;
    failed?: string;
    skipped?: string;
    blocked?: string;
    more?: string;
    notice?: string;
    scope?: string;
    mdrawer?: string;
    mstage?: string;
  }>;
}) {
  const sp = await searchParams;
  const groupKey = GROUPS[sp.group ?? "status"] ? (sp.group ?? "status") : "status";
  const group = GROUPS[groupKey];
  // Ecosystem scope (§1): the funnel narrows to the authorized company set — never widens.
  const scope = await getScopeContext(sp.scope ?? null);
  // URL builder preserving room state (filters, scope, drawer) — drawer opens with scroll intact.
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: sp.status, partner: sp.partner, goal: sp.goal, group: sp.group, scope: sp.scope, mdrawer: sp.mdrawer, mstage: sp.mstage })) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) { if (v == null) p.delete(k); else p.set(k, v); }
    const s = p.toString(); return `/motions${s ? `?${s}` : ""}`;
  };

  const { all, goals, initiativeOpts, draftLists, draftCandidates, funnels } = await withTenant(async (db, orgId) => ({
    // Motion Intelligence (P1A): the command funnel, derived from canonical records at read time.
    funnels: await getMotionFunnels(db, orgId, { companyIds: scope.companyIds }),
    all: (await db.query<MotionRow>(
      `select m.id, m.status, m.thesis, m.trigger_summary, m.cta, m.confidence, m.operator_notes,
            m.company_id, c.legal_name, n.slug, c.industry, m.outcome,
            m.estimated_value_usd, m.effort, p.score as propensity, pa.name as partner_name,
            m.goal_id, g.name as goal_name, m.initiative_id
     from revenue_motions m
     join companies c on c.id = m.company_id
     join taxonomy_nodes n on n.id = m.taxonomy_node_id
     left join propensity_scores p on p.id = m.propensity_score_id
     left join partners pa on pa.id = m.partner_id
     left join goals g on g.id = m.goal_id
     order by m.created_at desc limit 500`,
    )).rows,
    goals: await goalOptions(db, orgId),
    initiativeOpts: await initiativeOptions(db, orgId),
    // Composer targets (task #83): approved lists with how many members are
    // still motion-less, and the top unmotioned accounts by propensity.
    draftLists: (await db.query<{ id: string; name: string; partner_name: string | null; members: string; ready: string }>(
      `select ap.id, ap.name, p.name as partner_name,
                (select count(*) from population_members pm where pm.population_id = ap.id) as members,
                (select count(*) from population_members pm where pm.population_id = ap.id
                   and not exists (select 1 from revenue_motions m
                                   where m.company_id = pm.company_id
                                     and m.status in ('draft', 'approved', 'active'))) as ready
         from account_populations ap
         left join partners p on p.id = ap.partner_id
         where ap.org_id = $1 and ap.status = 'approved'
         order by ap.name`,
      [orgId],
    )).rows,
    draftCandidates: (await db.query<{ company_id: string; legal_name: string; score: string }>(
      `select company_id, legal_name, score from (
       select distinct on (p.company_id) p.company_id, c.legal_name, p.score
       from propensity_scores p join companies c on c.id = p.company_id
       where not exists (select 1 from revenue_motions m
                         where m.company_id = p.company_id
                           and m.status in ('draft', 'approved', 'active'))
         -- Suppression is a hard guardrail: blocked accounts never even appear.
         and ($1::uuid is null or not exists (
           select 1 from account_suppressions sl
           where sl.org_id = $1 and (
             (sl.kind = 'domain' and c.primary_domain is not null
               and (c.primary_domain = sl.value or c.primary_domain like '%.' || sl.value))
             or (sl.kind = 'name' and c.normalized_name = sl.value))))
       order by p.company_id, p.computed_at desc
     ) x order by x.score desc limit 18`,
      [orgId],
    )).rows,
  }));
  const draftedN = sp.drafted !== undefined ? Number(sp.drafted) : null;

  const justApproved = sp.approved ? all.find((m) => m.id === sp.approved && m.status === "approved") : undefined;
  const partnerOptions = [...new Set(all.map((m) => m.partner_name).filter(Boolean) as string[])];
  const motions = all.filter(
    (m) =>
      (!sp.status || sp.status === "all" || m.status === sp.status) &&
      (!sp.partner || sp.partner === "all" || m.partner_name === sp.partner) &&
      (!sp.goal || sp.goal === "all" || (sp.goal === "__none" ? !m.goal_id : m.goal_id === sp.goal)),
  );

  // Bentos
  const activeN = motions.filter((m) => m.status === "active").length;
  const props = motions.map((m) => (m.propensity == null ? null : Number(m.propensity))).filter((v): v is number => v != null);
  const avgProp = props.length ? Math.round(props.reduce((a, b) => a + b, 0) / props.length) : null;
  const estPipe = motions.reduce((s, m) => s + Number(m.estimated_value_usd ?? 0), 0);
  const expected = motions.reduce((s, m) => s + (Number(m.estimated_value_usd ?? 0) * Number(m.propensity ?? 0)) / 100, 0);
  const wonN = motions.filter((m) => m.outcome === "won").length;

  // Group + chart
  const groups = new Map<string, MotionRow[]>();
  for (const m of motions) {
    const k = group.key(m);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  const orderKeys = (keys: string[]) =>
    groupKey === "status" ? STATUS_ORDER.filter((s) => keys.includes(s)) : keys.sort((a, b) => (groups.get(b)!.length - groups.get(a)!.length));
  // Status grouping shows the full lifecycle, empty statuses included, so the
  // shape of the funnel is always visible; other groupings show their top 10.
  const chartRows =
    groupKey === "status"
      ? STATUS_ORDER.map((s) => ({ label: s, value: groups.get(s)?.length ?? 0 }))
      : [...groups.entries()].map(([label, ms]) => ({ label, value: ms.length })).sort((a, b) => b.value - a.value).slice(0, 10);

  const drawerFunnel = sp.mdrawer ? funnels.find((f) => f.hypothesis.taxonomyNodeId === sp.mdrawer) : undefined;

  return (
    <main>
      <PageHeader title="Motions" subtitle="Each commercial hypothesis as a live funnel — where it qualifies, through whom, what can move now, and exactly what blocks the rest." />

      {/* ── Motion command (P1A.1): the hypothesis funnel is the first viewport ── */}
      <MotionFunnelCommand funnels={funnels} qs={qs} />

      {/* Next-step pull (#79): the just-approved play flows straight into outreach. */}
      {justApproved && (
        <NextStep
          message={`Motion approved — ${justApproved.legal_name} is ready to become outreach.`}
          href={`/campaigns?motion=${justApproved.id}#composer`}
          cta="Compose the campaign"
        />
      )}

      {sp.notice && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {sp.notice}
        </div>
      )}

      {/* Draft-run results (task #83) — honest about every account: drafted,
          skipped (open motion), failed (no score/evidence/AI), still queued. */}
      {draftedN !== null && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${
            draftedN > 0
              ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {draftedN > 0 ? `Drafted ${draftedN} motion${draftedN === 1 ? "" : "s"} — review below.` : "Nothing drafted."}
          {Number(sp.skipped ?? 0) > 0 && ` ${sp.skipped} skipped (already carry an open motion).`}
          {Number(sp.blocked ?? 0) > 0 && ` ${sp.blocked} blocked by your suppression list.`}
          {Number(sp.failed ?? 0) > 0 && ` ${sp.failed} couldn't draft (each needs a propensity score, verified evidence, and AI configured).`}
          {Number(sp.more ?? 0) > 0 && ` ${sp.more} more ready — run again for the next batch of 10.`}
        </div>
      )}

      {/* ── Draft motions (task #83): scalable targeting — a list or a pick ── */}
      <details className="pos-card glass mb-6 rounded-card p-5" open={sp.compose === "1" || draftedN !== null}>
        <summary className="cursor-pointer text-sm font-semibold">
          ＋ Draft motions (AI)
          <span className="ml-2 text-xs font-normal text-neutral-500">
            target a whole list or pick accounts — every draft grounded in that account&apos;s evidence
          </span>
        </summary>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form action={draftMotionsAction}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">From a list</h3>
            <p className="mb-2 text-xs text-neutral-500">
              Targets every account on the list. &ldquo;Ready&rdquo; counts members without an open motion.
            </p>
            {draftLists.length === 0 ? (
              <p className="text-sm text-neutral-500">No approved lists yet — Intake and Mapping create them.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-neutral-500">List</span>
                  <select name="populationId" className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                    {draftLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.partner_name ? ` · ${l.partner_name}` : ""} — {l.ready}/{l.members} ready
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
                  Draft motions from list
                </button>
              </div>
            )}
          </form>

          <form action={draftMotionsAction}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pick accounts</h3>
            <p className="mb-2 text-xs text-neutral-500">
              Top accounts by propensity without an open motion.
            </p>
            {draftCandidates.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Every scored account already has an open motion — the pipeline scores new ones as intelligence lands.
              </p>
            ) : (
              <>
                <div className="mb-3 grid max-h-44 gap-1 overflow-y-auto pr-1 scroll-thin sm:grid-cols-2">
                  {draftCandidates.map((c) => (
                    <label key={c.company_id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-neutral-900/[0.04] dark:hover:bg-white/5">
                      <input type="checkbox" name="companyIds" value={c.company_id} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{c.legal_name}</span>
                      <span className="tnum text-xs text-neutral-400">{Math.round(Number(c.score))}</span>
                    </label>
                  ))}
                </div>
                <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
                  Draft motions for selected
                </button>
              </>
            )}
          </form>
        </div>
        <p className="mt-3 text-label text-neutral-400">
          Drafts run in batches of 10, highest propensity first — rerun for the next batch. Accounts already carrying
          a draft, approved, or active motion are skipped, so drafting a whole list is always safe.
        </p>
      </details>

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="motions" value={motions.length} href="/motions" />
        <Bento label="active" value={activeN} subs={[`${wonN} won`]} href="/motions?status=active" />
        <Bento label="avg propensity" value={avgProp ?? "—"} />
        <Bento label="est. pipeline" value={`$${Math.round(estPipe / 1000)}k`} href="/pipeline" />
        <Bento label="expected" value={`$${Math.round(expected / 1000)}k`} subs={["value × propensity"]} />
        <Bento label="partners" value={partnerOptions.length} href="/motions?group=partner" />
      </div>

      {/* Filters + group-by */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="status" value={sp.status ?? "all"} label="Status" options={[{ value: "all", label: "Any status" }, ...STATUS_ORDER.map((s) => ({ value: s, label: s }))]} />
        <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        {goals.length > 0 && (
          <QuerySelect param="goal" value={sp.goal ?? "all"} label="Goal" options={[{ value: "all", label: "Any goal" }, { value: "__none", label: "No goal" }, ...goals.map((g) => ({ value: g.id, label: g.name }))]} />
        )}
        <QuerySelect param="group" value={groupKey} label="Group by" options={Object.entries(GROUPS).map(([k, g]) => ({ value: k, label: g.label }))} />
        <span className="ml-auto text-xs text-neutral-500">{motions.length} motion(s)</span>
      </div>

      {motions.length === 0 ? (
        <p className="text-sm text-neutral-500">No motions match — clear a filter, or score accounts and run design-motion.</p>
      ) : (
        <>
          {/* Chart */}
          <Card className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Motions by {group.label.toLowerCase()}</h2>
            <MiniBar rows={chartRows} />
          </Card>

          {/* Grouped list */}
          {orderKeys([...groups.keys()]).map((k) => (
            <section key={k} className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {groupKey === "status" ? <StatusBadge status={k} /> : <span>{k}</span>}
                <span className="tnum text-neutral-400">{groups.get(k)!.length}</span>
              </h2>
              <div className="space-y-3">
                {groups.get(k)!.map((m) => (
                  <Card key={m.id}>
                    <p className="mb-1 text-sm">
                      <Link href={`/accounts/${m.company_id}`} className="font-semibold hover:underline">{m.legal_name}</Link>
                      <span className="text-neutral-400"> — {m.slug}</span>
                      {m.industry && <span className="ml-1 text-xs text-neutral-400">· {m.industry}</span>}
                      <span className="ml-2 text-xs text-neutral-400">({m.confidence} confidence)</span>
                      <Link href={`/briefs/${m.id}`} className="ml-2 text-xs font-medium text-accent hover:underline dark:text-blue-400">Brief →</Link>
                      {m.outcome && <span className={`ml-2 text-xs font-semibold uppercase ${m.outcome === "won" ? "text-positive dark:text-green-400" : "text-neutral-500"}`}>{m.outcome.replace(/_/g, " ")}</span>}
                    </p>
                    {(m.estimated_value_usd != null || m.partner_name) && (
                      <p className="mb-1 text-xs text-neutral-500">
                        {m.estimated_value_usd != null && (
                          <>
                            ~${Math.round(Number(m.estimated_value_usd) / 1000)}k estimated
                            {m.propensity != null && ` · $${Math.round((Number(m.estimated_value_usd) * Number(m.propensity)) / 100 / 1000)}k expected at ${Number(m.propensity).toFixed(0)}`}
                            {m.effort != null && ` · effort ${m.effort}/5`}
                          </>
                        )}
                        {m.partner_name && <>{m.estimated_value_usd != null && " · "}via {m.partner_name}</>}
                      </p>
                    )}
                    {goals.length > 0 && (
                      <form action={setMotionGoalAction.bind(null, m.id)} className="mb-1 flex items-center gap-1.5 text-xs">
                        <span className="text-neutral-400">Goal:</span>
                        <select name="goalId" defaultValue={m.goal_id ?? ""} className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700">
                          <option value="">— none —</option>
                          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                        <button className="font-medium text-accent hover:underline dark:text-blue-400">set</button>
                        {m.goal_name && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-micro font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">{m.goal_name}</span>}
                      </form>
                    )}
                    {initiativeOpts.length > 0 && (
                      <form action={setMotionInitiativeAction.bind(null, m.id)} className="mb-1 flex items-center gap-1.5 text-xs" title="initiative this motion's work rolls up into">
                        <span className="text-neutral-400">Initiative:</span>
                        <select name="initiativeId" defaultValue={m.initiative_id ?? ""} className={`rounded border bg-transparent px-1 py-0.5 text-xs ${m.initiative_id ? "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300" : "border-neutral-300 dark:border-neutral-700"}`}>
                          <option value="">— none —</option>
                          {initiativeOpts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <button className="font-medium text-accent hover:underline dark:text-blue-400">set</button>
                      </form>
                    )}
                    <details className="mb-1">
                      <summary className="cursor-pointer text-xs font-medium text-accent hover:underline dark:text-blue-400">Thesis &amp; trigger</summary>
                      <p className="mb-2 mt-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{m.thesis}</p>
                      <p className="text-sm text-neutral-500"><span className="font-medium">Trigger:</span> {m.trigger_summary}<br /><span className="font-medium">CTA:</span> {m.cta}</p>
                      {m.operator_notes && (
                        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          <span className="font-medium">Notes:</span> {m.operator_notes}
                        </p>
                      )}
                    </details>
                    <details className="mb-1">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:underline">Edit &amp; notes</summary>
                      <form action={editMotionAction.bind(null, m.id)} className="mt-2 space-y-2">
                        <label className="block text-sm"><span className="mb-1 block text-xs text-neutral-500">Thesis</span>
                          <textarea name="thesis" defaultValue={m.thesis ?? ""} rows={2} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block text-sm"><span className="mb-1 block text-xs text-neutral-500">Trigger</span>
                            <input name="trigger" defaultValue={m.trigger_summary ?? ""} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
                          <label className="block text-sm"><span className="mb-1 block text-xs text-neutral-500">CTA</span>
                            <input name="cta" defaultValue={m.cta ?? ""} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
                        </div>
                        <label className="block text-sm"><span className="mb-1 block text-xs text-neutral-500">Operator notes — the AI reads these when drafting campaigns for this motion (context, do/don&apos;t, who really decides)</span>
                          <textarea name="notes" defaultValue={m.operator_notes ?? ""} rows={2} placeholder="e.g. CFO owns this decision; avoid mentioning the migration until Q2." className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" /></label>
                        <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">Save</button>
                      </form>
                    </details>
                    {m.status === "draft" && (
                      <div className="mt-3 flex gap-2">
                        <form action={approveMotionAction.bind(null, m.id)}><button className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800">Approve</button></form>
                        <form action={rejectMotionAction.bind(null, m.id)}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">Reject</button></form>
                      </div>
                    )}
                    {m.status === "approved" && (
                      <div className="mt-3 flex gap-2">
                        <form action={activateMotionAction.bind(null, m.id)}><button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">Activate</button></form>
                        <form action={abandonMotionAction.bind(null, m.id)}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">Abandon</button></form>
                      </div>
                    )}
                    {m.status === "active" && (
                      <div className="mt-3 flex gap-2">
                        <form action={completeMotionAction.bind(null, m.id, "won")}><button className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800">Complete — won</button></form>
                        <form action={completeMotionAction.bind(null, m.id, "lost")}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">Complete — lost</button></form>
                        <form action={completeMotionAction.bind(null, m.id, "no_decision")}><button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">No decision</button></form>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* Constraint decomposition drawer (P1A.2) — server-rendered only when open. */}
      {drawerFunnel && (
        <MotionConstraintDrawer funnel={drawerFunnel} stage={sp.mstage ?? "not_ready"} closeHref={qs({ mdrawer: null, mstage: null })} />
      )}
    </main>
  );
}
