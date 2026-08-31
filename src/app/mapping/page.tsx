import Link from "next/link";
import { BandBadge, Bento, Card, PageHeader } from "@/components/ui";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  availableFields,
  intersection,
  listPopulations,
  matrix,
  partnersWithPopulations,
  type Category,
  type Population,
} from "@/lib/mapping/populations";
import { partnerCoverage } from "@/lib/mapping/populations";
import { partnerHub } from "@/lib/mapping/partner-hub";
import { crossPartnerOpportunities, suggestedTargetLists } from "@/lib/mapping/insights";
import { suggestMultiVendorPlays, coverageWinRates } from "@/lib/campaigns/multi-vendor";
import { createTargetListAction, generateMotionsForSelectionAction, createMultiVendorCampaignAction } from "./actions";
import { SelectableAccounts } from "./selectable-accounts";
import { JointPlayCard } from "./joint-play-card";
import { OverlapWorkbench, type OverlapRow } from "./overlap-workbench";
import { alignedFieldKeys, populationFields } from "@/lib/mapping/populations";
import { createPopulationAction, setPopulationStatusAction, targetFromCellAction, acceptPopulationAction } from "./actions";
import { ViewSelect, PartnerSelect } from "./view-select";
import { withTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";
// AI drafting actions invoked from this segment can run tens of seconds —
// raise the serverless limit so generation never dies as a platform timeout.
export const maxDuration = 60;

/**
 * Mapping (Phase 8→10): where the SAME account shows up across a reseller, a
 * distributor and a vendor — the overlap that founds a co-sell campaign. The
 * old overlap / coverage / targets triplet is consolidated into one Overlap &
 * motions workbench (account × partner grid + real plays + conflict + named
 * lists); their URLs still resolve there.
 */

type View = "matrix" | "recommend" | "review" | "overlap";
const VIEW_KEYS: View[] = ["matrix", "recommend", "review", "overlap"];
const VIEW_LABEL: Record<View, string> = {
  matrix: "Account mapping",
  recommend: "AI recommendations",
  review: "Pending review",
  overlap: "Overlap & motions",
};

function ViewTabs({ view, pendingCount = 0 }: { view: View; pendingCount?: number }) {
  const views = VIEW_KEYS.map((k) => ({
    key: k,
    label: k === "review" && pendingCount > 0 ? `${VIEW_LABEL[k]} (${pendingCount})` : VIEW_LABEL[k],
  }));
  return (
    <div className="mb-4">
      <ViewSelect current={view} views={views} />
      {/* Work waiting on a decision announces itself in the room, not just in
          the view picker (and the rail badge carries it across the app). */}
      {pendingCount > 0 && view !== "review" && (
        <Link
          href="/mapping?view=review"
          className="pos-lift mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
        >
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-micro font-bold leading-none text-white">{pendingCount}</span>
          <span>
            {pendingCount === 1 ? "A partner list is" : `${pendingCount} partner lists are`} waiting for your review before
            {pendingCount === 1 ? " it maps" : " they map"} — open the review queue →
          </span>
        </Link>
      )}
    </div>
  );
}

export default async function MappingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; partner?: string; row?: string; col?: string; cols?: string; hide?: string; notice?: string; mr?: string; mc?: string; pop?: string }>;
}) {
  const sp = await searchParams;
  // coverage/targets were folded into the overlap workbench — old URLs still land there.
  const rawView = ["coverage", "targets"].includes(sp.view ?? "") ? "overlap" : sp.view;
  const view: View = (["matrix", "recommend", "review", "overlap"].includes(rawView ?? "") ? rawView : "matrix") as View;

  const pendingCount = Number(
    (await withTenant((db) => db.query<{ n: string }>(`select count(*)::text n from account_populations where status = 'pending'`))).rows[0]?.n ?? 0,
  );

  // ── Pending review — vet a pushed partner list before it maps ────────────
  if (view === "review") {
    return (
      <main>
        <PageHeader
          title="Pending review"
          subtitle="Lists a partner pushed. Inspect the fields against yours, then accept."
        />
        <ViewTabs view={view} pendingCount={pendingCount} />
        {sp.notice && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {sp.notice}
          </div>
        )}
        <ReviewSection openId={sp.pop} />
      </main>
    );
  }

  // ── AI cross-partner recommendations (Phase 10 / #49) ────────────────────
  if (view === "recommend") {
    return (
      <main>
        <PageHeader
          title="AI recommendations"
          subtitle="Every account across every connected partner, ranked by co-sell strength."
        />
        <ViewTabs view={view} pendingCount={pendingCount} />
        {sp.notice && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {sp.notice}
          </div>
        )}
        <RecommendSection />
      </main>
    );
  }

  // ── Account-mapping matrix (Phase 10) ────────────────────────────────────
  if (view === "matrix") {
    return (
      <main>
        <PageHeader
          title="Account mapping"
          subtitle="Your lists crossed with a partner's. Each cell is the accounts you share."
        />
        <ViewTabs view={view} pendingCount={pendingCount} />
        {sp.notice && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {sp.notice}
          </div>
        )}
        {sp.row && sp.col ? (
          <CellView rowId={sp.row} colId={sp.col} cols={sp.cols} partnerId={sp.partner} />
        ) : (
          <MatrixSection partnerId={sp.partner} hideEmpty={sp.hide === "1"} mr={sp.mr} mc={sp.mc} />
        )}
        <PopulationManager />
      </main>
    );
  }

  // ── Overlap & motions workbench (consolidates overlap / coverage / targets) ──
  // Same populations data as the matrix — a co-sell overlap is an account in
  // both an org and a partner list — enriched with the real suggested play,
  // propensity drivers, and explicit channel conflict.
  const { rows, partnerList } = await withTenant(async (db, orgId) => {
    let rows: OverlapRow[] = [];
    let partnerList: { id: string; name: string; type: string | null }[] = [];
    {
      const coverage = await partnerCoverage(db, orgId);
      const companyIds = coverage.map((a) => a.companyId);

      // Per (account, partner): which lists/categories, and whether that partner
      // actively claims the account (their customer / open opportunity).
      const marks = new Map<string, Record<string, { onList: boolean; categories: string[]; claims: boolean }>>();
      if (companyIds.length) {
        const { rows: pc } = await db.query<{ company_id: string; partner_id: string; category: string }>(
          `select pm.company_id, ap.partner_id, ap.category
           from population_members pm
           join account_populations ap on ap.id = pm.population_id
             and ap.partner_id is not null and ap.status = 'approved' and ap.org_id = $1
           where pm.company_id = any($2)`,
          [orgId, companyIds],
        );
        for (const r of pc) {
          const byPartner = marks.get(r.company_id) ?? {};
          const m = byPartner[r.partner_id] ?? { onList: true, categories: [], claims: false };
          const label = CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category;
          if (!m.categories.includes(label)) m.categories.push(label);
          if (r.category === "customer" || r.category === "open_opportunity") m.claims = true;
          byPartner[r.partner_id] = m;
          marks.set(r.company_id, byPartner);
        }
      }

      // Latest score per account, with the solution node + drivers + delta.
      const scoreInfo = new Map<string, { scoreId: string; nodeId: string; solution: string; delta: number | null }>();
      if (companyIds.length) {
        const { rows: sc } = await db.query<{ company_id: string; score_id: string; node_id: string; solution: string; changes: { delta?: number } | null }>(
          `select distinct on (p.company_id) p.company_id, p.id as score_id, n.id as node_id, n.name as solution, p.changes
           from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
           where p.company_id = any($1) order by p.company_id, p.computed_at desc`,
          [companyIds],
        );
        for (const s of sc) scoreInfo.set(s.company_id, { scoreId: s.score_id, nodeId: s.node_id, solution: s.solution, delta: s.changes?.delta ?? null });
      }
      const dimsByScore = new Map<string, { dim: string; value: number }[]>();
      const scoreIds = [...scoreInfo.values()].map((s) => s.scoreId);
      if (scoreIds.length) {
        const { rows: dims } = await db.query<{ score_id: string; dimension: string; value: string }>(
          `select score_id, dimension, value from propensity_dimensions where score_id = any($1) order by value desc`,
          [scoreIds],
        );
        for (const d of dims) {
          const list = dimsByScore.get(d.score_id) ?? [];
          if (list.length < 3) list.push({ dim: d.dimension, value: Number(d.value) });
          dimsByScore.set(d.score_id, list);
        }
      }

      // Active play per solution node — the REAL play, with objective + CTA.
      const playByNode = new Map<string, { name: string; objective: string | null; offer: string | null }>();
      {
        const { rows: plays } = await db.query<{ taxonomy_node_id: string | null; name: string; objective: string | null; offer: string | null }>(
          `select taxonomy_node_id, name, definition->>'objective' as objective, definition->'cta'->>'offer' as offer
           from play_templates where status = 'active'`,
        );
        for (const p of plays) if (p.taxonomy_node_id) playByNode.set(p.taxonomy_node_id, { name: p.name, objective: p.objective, offer: p.offer });
      }

      // Latest verified signal per account + which accounts already have motions.
      const signalByCompany = new Map<string, string>();
      const hasMotion = new Set<string>();
      if (companyIds.length) {
        const { rows: ev } = await db.query<{ company_id: string; claim: string }>(
          `select distinct on (company_id) company_id, claim from evidence
           where company_id = any($1) and status = 'verified'
           order by company_id, computed_confidence desc nulls last, observed_at desc`,
          [companyIds],
        );
        for (const e of ev) signalByCompany.set(e.company_id, e.claim);
        const { rows: ms } = await db.query<{ company_id: string }>(
          `select distinct company_id from revenue_motions where company_id = any($1) and status in ('draft','approved','active')`,
          [companyIds],
        );
        for (const m of ms) hasMotion.add(m.company_id);
      }

      rows = coverage.map((a) => {
        const byPartner = marks.get(a.companyId) ?? {};
        const claimants = Object.values(byPartner).filter((m) => m.claims).length;
        const si = scoreInfo.get(a.companyId);
        const play = si ? playByNode.get(si.nodeId) ?? null : null;
        return {
          companyId: a.companyId,
          name: a.name,
          domain: a.domain,
          score: a.score,
          band: a.band,
          motion: a.isCustomer ? "cross-sell / upsell" : "net-new",
          conflict: claimants >= 2,
          marks: byPartner,
          play: play && si ? { ...play, solution: si.solution } : null,
          why: {
            drivers: si ? dimsByScore.get(si.scoreId) ?? [] : [],
            signal: signalByCompany.get(a.companyId) ?? null,
            delta: si?.delta ?? null,
          },
          hasMotion: hasMotion.has(a.companyId),
        };
      });

      const pmap = new Map<string, { id: string; name: string; type: string | null }>();
      for (const a of coverage) for (const p of a.partners) pmap.set(p.id, p);
      partnerList = [...pmap.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    return { rows, partnerList };
  });

  return (
    <main>
      <PageHeader
        title="Overlap & motions"
        subtitle="Every co-sell account crossed with every partner, with the play to run."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ViewTabs view={view} pendingCount={pendingCount} />
        <span className="ml-auto text-xs text-neutral-500">{rows.length} co-sell overlap(s)</span>
      </div>
      {sp.notice && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {sp.notice}
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            No co-sell overlaps yet. An overlap is an account that sits in one of your lists AND a partner&apos;s —
            build lists on both sides in the <Link href="/mapping?view=matrix" className="text-accent hover:underline dark:text-blue-400">Account mapping</Link> view.
          </p>
        </Card>
      ) : (
        <OverlapWorkbench
          rows={rows}
          partners={partnerList}
          createTarget={createTargetListAction}
          generateMotions={generateMotionsForSelectionAction}
        />
      )}
    </main>
  );
}

// ── Account-mapping matrix components (Phase 10) ─────────────────────────────

const CAT_TONE: Record<string, string> = {
  customer: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  open_opportunity: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  prospect: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  target: "bg-green-50 text-positive ring-green-600/20 dark:bg-green-950 dark:text-green-300",
};
function catTone(c: string): string {
  return CAT_TONE[c] ?? "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-300";
}


async function ReviewSection({ openId }: { openId?: string }) {
  return withTenant(async (db, orgId) => {
    const { rows: pending } = await db.query<{ id: string; name: string; category: Category; partner_name: string | null; members: number; created_at: Date }>(
      `select ap.id, ap.name, ap.category, p.name as partner_name,
              (select count(*) from population_members m where m.population_id = ap.id)::int as members, ap.created_at
       from account_populations ap left join partners p on p.id = ap.partner_id
       where ap.org_id = $1 and ap.status = 'pending'
       order by ap.created_at desc`,
      [orgId],
    );

    if (pending.length === 0) {
      return (
        <Card>
          <p className="text-sm text-neutral-500">
            No lists awaiting review. When a partner pushes an account list, it lands here for you to inspect and accept
            before it maps. (Propose one yourself in the <Link href="/mapping?view=matrix" className="text-accent hover:underline dark:text-blue-400">Account mapping</Link> lists manager.)
          </p>
        </Card>
      );
    }

    const open = openId ? pending.find((p) => p.id === openId) : undefined;
    // Fetch dialog data here (while the connection is live) — never inside an
    // async child, which React would render after this function releases db.
    const dialog = open
      ? { pop: open, ...(await populationFields(db, { populationId: open.id, aligned: await alignedFieldKeys(db, orgId) })) }
      : null;

    return (
      <div className="space-y-4">
        {/* Queue */}
        <div className="rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr><th>List</th><th>From</th><th>Category</th><th className="text-right">Accounts</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id} className={open?.id === p.id ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}>
                  <td className="font-medium">{p.name}</td>
                  <td className="text-neutral-500">{p.partner_name ?? "Your side"}</td>
                  <td className="text-neutral-500">{CATEGORY_LABEL[p.category]}</td>
                  <td className="tnum text-right">{p.members}</td>
                  <td className="text-right">
                    <Link href={`/mapping?view=review&pop=${p.id}`} className="rounded-md bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800">
                      Review fields
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Field-alignment review dialog */}
        {dialog && <ReviewDialog {...dialog} />}
      </div>
    );
  });
}

function ReviewDialog({
  pop,
  fields,
  total,
  sample,
}: {
  pop: { id: string; name: string; category: Category; partner_name: string | null; members: number };
  fields: import("@/lib/mapping/populations").PopulationField[];
  total: number;
  sample: { name: string; attributes: Record<string, unknown> }[];
}) {
  const alignedCount = fields.filter((f) => f.aligned).length;

  return (
    <Card className="border-blue-200 dark:border-blue-900">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Review: {pop.name}</h2>
        <span className="text-xs text-neutral-500">from {pop.partner_name ?? "your side"} · {CATEGORY_LABEL[pop.category]} · {total} accounts</span>
        <Link href="/mapping?view=review" className="ml-auto text-xs text-neutral-500 hover:underline">close</Link>
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        {fields.length} field(s) detected · <span className="font-medium text-positive dark:text-green-400">{alignedCount} align to yours</span>. Choose which to carry into the mapped matrix, then accept.
      </p>

      <form action={acceptPopulationAction.bind(null, pop.id)}>
        <div className="mb-3 overflow-x-auto rounded-lg border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr><th className="w-8"></th><th>Field</th><th>Aligns?</th><th className="text-right">Present</th><th>Sample</th></tr>
            </thead>
            <tbody>
              {fields.length === 0 ? (
                <tr><td colSpan={5} className="text-sm text-neutral-400">No extra fields on this list — accounts will map on company identity alone.</td></tr>
              ) : fields.map((f) => (
                <tr key={f.key}>
                  <td><input type="checkbox" name="fields" value={f.key} defaultChecked className="h-4 w-4" /></td>
                  <td className="font-medium capitalize">{f.key.replace(/_/g, " ")}</td>
                  <td>
                    {f.aligned
                      ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-micro font-medium text-positive dark:bg-green-950 dark:text-green-300">aligned</span>
                      : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-micro font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">new field</span>}
                  </td>
                  <td className="tnum text-right text-neutral-500">{Math.round((f.present / Math.max(total, 1)) * 100)}%</td>
                  <td className="text-neutral-500">{f.sample ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sample.length > 0 && (
          <details className="mb-3">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
              Preview accounts — showing {sample.length} of {total.toLocaleString()}
            </summary>
            {/* A real table, not prose: fields become columns (first six; the field
                list above is the full inventory), rows scroll. Built to be read
                the same at 12 accounts or 12,000 — the page is the sample. */}
            <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-neutral-200 scroll-thin dark:border-neutral-800">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    {fields.slice(0, 6).map((f) => (
                      <th key={f.key} className="capitalize">{f.key.replace(/_/g, " ")}</th>
                    ))}
                    {fields.length > 6 && <th className="text-neutral-400">+{fields.length - 6} more</th>}
                  </tr>
                </thead>
                <tbody>
                  {sample.map((s, i) => (
                    <tr key={i}>
                      <td className="font-medium">{s.name}</td>
                      {fields.slice(0, 6).map((f) => {
                        const v = s.attributes[f.key];
                        return <td key={f.key} className="max-w-[14rem] truncate text-neutral-500">{v == null || v === "" ? "—" : String(v)}</td>;
                      })}
                      {fields.length > 6 && <td className="text-neutral-400">…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > sample.length && (
              <p className="mt-1.5 text-label text-neutral-400">
                First {sample.length} of {total.toLocaleString()} accounts, alphabetically — the field table above summarizes the whole list.
              </p>
            )}
          </details>
        )}

        <div className="flex items-center gap-3">
          <button className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800">Accept &amp; map</button>
          <span className="text-label text-neutral-400">Reviewed in-app — nothing leaves the system.</span>
        </div>
      </form>
      <form action={setPopulationStatusAction.bind(null, pop.id, "rejected")} className="mt-2">
        <button className="text-xs font-medium text-red-700 hover:underline dark:text-red-400">Reject list</button>
      </form>
    </Card>
  );
}

async function RecommendSection() {
  return withTenant(async (db, orgId) => {
    const accounts = await crossPartnerOpportunities(db, orgId);
    if (accounts.length === 0) {
      return (
        <Card>
          <p className="text-sm text-neutral-500">
            No cross-partner accounts to learn from yet — approve lists on your side and at least one partner in{" "}
            <Link href="/mapping?view=matrix" className="text-accent hover:underline dark:text-blue-400">Account mapping</Link>.
          </p>
        </Card>
      );
    }
    const buckets = suggestedTargetLists(accounts);
    const top = accounts.slice(0, 200);
    const multi = accounts.filter((a) => a.partnerCount >= 2).length;
    const plays = (await suggestMultiVendorPlays(db, orgId)).slice(0, 4);
    const winRates = await coverageWinRates(db, orgId);
    const mp = winRates.find((w) => w.bucket === "multi_partner");
    const spn = winRates.find((w) => w.bucket === "single_partner");

    return (
      <>
        <div className="mb-4 flex flex-wrap gap-3">
          <Bento label="co-sell accounts" value={accounts.length} href="/mapping?view=overlap" />
          <Bento label="covered by 2+ partners" value={multi} href="/mapping?view=overlap" />
          <Bento label="high propensity" value={accounts.filter((a) => a.band === "high" || a.band === "very_high").length} href="/mapping?view=overlap" />
        </div>

        {/* Suggested target lists — one click creates an approved target population */}
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {buckets.map((b) => (
            <Card key={b.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{b.name}</h3>
                <span className="tnum whitespace-nowrap rounded bg-neutral-100 px-1.5 py-0.5 text-label font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {b.companyIds.length} account{b.companyIds.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mb-3 text-xs text-neutral-500">{b.rationale}</p>
              <form action={createTargetListAction}>
                <input type="hidden" name="name" value={b.name} />
                <input type="hidden" name="companyIds" value={b.companyIds.join(",")} />
                <button className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800">
                  Create target list
                </button>
              </form>
            </Card>
          ))}
        </div>

        {/* Multi-vendor plays — one account, several partners, one joint campaign */}
        {plays.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Multi-vendor plays · suggested</h2>
              <span className="text-label text-neutral-400">One click builds the package: named list → campaign → partners in roles. You still approve every touch.</span>
            </div>
            {(mp || spn) && mp && mp.closed > 0 && (
              <p className="mb-3 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
                Learned so far: multi-partner-covered accounts close-win at <span className="font-semibold">{mp.rate}%</span> ({mp.won}/{mp.closed})
                {spn && spn.closed > 0 && <> vs <span className="font-semibold">{spn.rate}%</span> ({spn.won}/{spn.closed}) with a single partner</>}
                . Every close sharpens this signal.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {plays.map((p) => {
                const defaultName = `Joint play — ${p.partners.map((x) => x.name.split(" ")[0]).join(" × ")}`;
                return (
                  <JointPlayCard
                    key={p.key}
                    play={{
                      key: p.key,
                      partners: p.partners,
                      accounts: p.accounts,
                      avgScore: p.avgScore,
                      play: p.play,
                      defaultName,
                    }}
                    create={createMultiVendorCampaignAction}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Ranked opportunities — filter, select one or many, then act */}
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Ranked co-sell opportunities</h2>
          <span className="text-label text-neutral-400">Filter, select accounts, then create a target list or draft motions.</span>
        </div>
        <SelectableAccounts
          accounts={top.map((a) => ({
            companyId: a.companyId,
            name: a.name,
            industry: a.industry,
            score: a.score,
            band: a.band,
            partners: a.partners,
            partnerCount: a.partnerCount,
            motion: a.motion,
            hasMotion: a.hasMotion,
          }))}
          createTarget={createTargetListAction}
          generateMotions={generateMotionsForSelectionAction}
        />
        <p className="mt-2 text-label text-neutral-400">
          Rank = propensity + a boost for each additional partner covering the account. &ldquo;Generate motions&rdquo; is
          bounded to 10 at a time and grounds each in the account&apos;s evidence.
        </p>
      </>
    );
  });
}

/** Subtle propensity heatmap — blue with alpha, legible on light and dark. */
function cellShade(avg: number | null): string | undefined {
  if (avg == null) return undefined;
  const alpha = Math.max(0.05, Math.min(0.3, 0.05 + (avg / 100) * 0.25));
  return `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
}

async function MatrixSection({ partnerId, hideEmpty, mr, mc }: { partnerId?: string; hideEmpty?: boolean; mr?: string; mc?: string }) {
  return withTenant(async (db, orgId) => {
    const partners = await partnersWithPopulations(db, orgId);
    if (partners.length === 0) {
      return (
        <Card>
          <p className="text-sm text-neutral-500">
            No partner lists yet. Create lists for your side and a partner below, then the overlap matrix
            appears here — like Crossbeam&apos;s account mapping, scored by propensity.
          </p>
        </Card>
      );
    }

    const isAll = partnerId === "all";
    const selected = isAll ? "all" : partnerId && partners.some((p) => p.id === partnerId) ? partnerId : partners[0].id;
    const matrixPartner = isAll ? null : selected;
    const selectedName = isAll ? "All partners" : partners.find((p) => p.id === selected)?.name ?? "Partner";

    const { rows: allRows, cols: allCols, cells, rowTotals, colTotals, kpi } = await matrix(db, { orgId, partnerId: matrixPartner });
    const hub = await partnerHub(db, { orgId, partnerId: matrixPartner });

    // Organize matrix: mr / mc explicitly list included row / column populations.
    const mrSet = mr ? new Set(mr.split(",").filter(Boolean)) : null;
    const mcSet = mc ? new Set(mc.split(",").filter(Boolean)) : null;
    let rows = mrSet ? allRows.filter((r) => mrSet.has(r.id)) : allRows;
    let cols = mcSet ? allCols.filter((c) => mcSet.has(c.id)) : allCols;
    if (hideEmpty) {
      rows = rows.filter((r) => (rowTotals.get(r.id) ?? 0) > 0);
      cols = cols.filter((c) => (colTotals.get(c.id) ?? 0) > 0);
    }

    // URL builder that preserves matrix state; pass undefined to drop a param.
    const q = (over: Record<string, string | undefined> = {}): string => {
      const p = new URLSearchParams();
      p.set("view", "matrix");
      const merged: Record<string, string | undefined> = { partner: isAll ? "all" : selected, hide: hideEmpty ? "1" : undefined, mr, mc, ...over };
      for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
      return `/mapping?${p.toString()}`;
    };
    const toggleCsv = (all: { id: string }[], set: Set<string> | null, id: string): string | undefined => {
      const inc = set ? new Set(set) : new Set(all.map((x) => x.id));
      if (inc.has(id)) inc.delete(id); else inc.add(id);
      return inc.size === all.length ? undefined : [...inc].join(",");
    };

    return (
      <>
        {/* Partner picker + organize + hide */}
        <div className="mb-4 flex flex-wrap items-center gap-6">
          <div className="ml-auto flex flex-col items-end gap-2">
            <PartnerSelect current={isAll ? "all" : selected} hideEmpty={hideEmpty} partners={partners.map((p) => ({ id: p.id, name: p.name }))} />
            <div className="flex items-center gap-3">
              {/* Organize matrix — choose which populations are rows / columns */}
              <details className="relative">
                <summary className="cursor-pointer text-label font-medium text-accent hover:underline dark:text-blue-400">Organize matrix</summary>
                <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  <p className="mb-1 text-micro uppercase tracking-wide text-neutral-400">Rows — your lists</p>
                  <div className="mb-3 space-y-0.5">
                    {allRows.map((r) => {
                      const on = mrSet ? mrSet.has(r.id) : true;
                      return (
                        <Link key={r.id} href={q({ mr: toggleCsv(allRows, mrSet, r.id) })} className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${on ? "" : "text-neutral-400"}`}>
                          <span className={`inline-block h-3 w-3 rounded-sm border ${on ? "border-blue-600 bg-blue-600" : "border-neutral-300 dark:border-neutral-600"}`} />
                          {r.name}
                        </Link>
                      );
                    })}
                  </div>
                  <p className="mb-1 text-micro uppercase tracking-wide text-neutral-400">Columns — partner lists</p>
                  <div className="space-y-0.5">
                    {allCols.map((c) => {
                      const on = mcSet ? mcSet.has(c.id) : true;
                      return (
                        <Link key={c.id} href={q({ mc: toggleCsv(allCols, mcSet, c.id) })} className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${on ? "" : "text-neutral-400"}`}>
                          <span className={`inline-block h-3 w-3 rounded-sm border ${on ? "border-blue-600 bg-blue-600" : "border-neutral-300 dark:border-neutral-600"}`} />
                          {isAll && c.partner_name ? `${c.partner_name}: ${c.name}` : c.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </details>
              <Link href={q({ hide: hideEmpty ? undefined : "1" })} className="text-label text-neutral-500 hover:underline">
                {hideEmpty ? "Show empty lists" : "Hide empty lists"}
              </Link>
            </div>
          </div>
        </div>

        {/* Partner hub — aggregate rollups (one partner, or all rolled up) */}
        <Card className="mb-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{selectedName}</h2>
            <span className="rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-neutral-500 ring-1 ring-inset ring-neutral-300/50 dark:ring-neutral-700">
              {isAll ? "all partners" : "connected partner"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Bento label="lists" value={hub.populations.toLocaleString()} href="/mapping?view=review" />
            <Bento label="overlapping accounts" value={kpi.accounts.toLocaleString()} subs={[`${kpi.hot} hot`, kpi.avg != null ? `avg ${kpi.avg}` : ""]} href="/mapping?view=overlap" />
            <Bento label="propensity (hot)" value={kpi.hot.toLocaleString()} subs={[kpi.avg != null ? `avg ${kpi.avg}` : "no scores"]} href="/mapping?view=overlap" />
            <Bento label="motions" value={hub.motionsTotal.toLocaleString()} subs={[`${hub.motionsActive} active`]} href="/motions" />
            <Bento label="campaigns" value={hub.campaignsTotal.toLocaleString()} subs={[`${hub.campaignsLive} live`, `${hub.touchesSent} sent`]} href="/campaigns" />
            <Bento label="open pipeline" value={`$${Math.round(hub.pipelineUsd / 1000)}k`} subs={[`${hub.oppsOpen} open`, hub.oppsWon ? `${hub.oppsWon} won $${Math.round(hub.wonUsd / 1000)}k` : ""]} href="/pipeline" />
          </div>
          <p className="mt-3 text-label text-neutral-400">
            {isAll
              ? "Rolled up across every connected partner. Each partner's lists + fields stay scoped to them; totals here aggregate all partner-attributed motions, campaigns, and pipeline."
              : `Scoped to ${selectedName}: their lists + fields stay theirs; motions, campaigns, and pipeline count here when attributed to this partner. Your own lists (the vendor side) map against every partner.`}
          </p>
        </Card>

        {rows.length === 0 || cols.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500">
              {allRows.length === 0 || allCols.length === 0
                ? "Approve at least one list on each side to populate the matrix. Manage lists below."
                : "Nothing to show with the current organize / hide-empty settings."}
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-neutral-900">Your lists ↓ / Partner →</th>
                  <th className="text-center text-neutral-500">Total</th>
                  {cols.map((c) => (
                    <th key={c.id} className="text-center align-bottom">
                      {isAll && c.partner_name && <div className="text-micro font-semibold text-accent dark:text-blue-400">{c.partner_name}</div>}
                      <div className="font-medium">{c.name}</div>
                      <div className="text-micro font-normal text-neutral-400">{CATEGORY_LABEL[c.category]}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky left-0 z-10 bg-white dark:bg-neutral-900">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-label font-medium ring-1 ring-inset ${catTone(r.category)}`}>
                        {r.name}
                      </span>
                      <div className="text-micro text-neutral-400">{r.members} accounts</div>
                    </td>
                    <td className="text-center tnum font-semibold text-neutral-500">{(rowTotals.get(r.id) ?? 0).toLocaleString()}</td>
                    {cols.map((c) => {
                      const cell = cells.get(`${r.id}:${c.id}`);
                      if (!cell || cell.count === 0) {
                        return <td key={c.id} className="text-center text-neutral-300 dark:text-neutral-700">None</td>;
                      }
                      return (
                        <td key={c.id} className="p-0 text-center" style={{ backgroundColor: cellShade(cell.avgScore) }}>
                          <Link href={q({ row: r.id, col: c.id })} className="flex flex-col items-center px-3 py-2.5 hover:ring-2 hover:ring-inset hover:ring-blue-500">
                            <span className="tnum text-lg font-semibold text-blue-800 dark:text-blue-300">{cell.count.toLocaleString()}</span>
                            <span className="text-micro text-neutral-600 dark:text-neutral-400">
                              {cell.avgScore != null ? `avg ${cell.avgScore.toFixed(0)}` : "—"}
                              {cell.highCount > 0 ? ` · ${cell.highCount} hot` : ""}
                            </span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-neutral-200 dark:border-neutral-700">
                  <td className="sticky left-0 z-10 bg-white text-xs font-semibold text-neutral-500 dark:bg-neutral-900">Total (distinct)</td>
                  <td className="text-center tnum font-bold">{kpi.accounts.toLocaleString()}</td>
                  {cols.map((c) => (
                    <td key={c.id} className="text-center tnum font-semibold text-neutral-500">{(colTotals.get(c.id) ?? 0).toLocaleString()}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="border-t border-neutral-100 px-3 py-2 text-label text-neutral-500 dark:border-neutral-800">
              Cell = accounts on both lists, shaded by avg propensity · hot = high/very-high band · Total = distinct
              accounts · {isAll ? "columns span every partner" : "click a cell to drill in"} · use Organize matrix to choose rows/columns.
            </p>
          </div>
        )}
      </>
    );
  });
}

const BASE_COLS = ["industry", "employees", "propensity"];

async function CellView({ rowId, colId, cols, partnerId }: { rowId: string; colId: string; cols?: string; partnerId?: string }) {
  return withTenant(async (db) => {
    const { row, col, accounts } = await intersection(db, { rowPopId: rowId, colPopId: colId });
    const fields = await availableFields(db, { rowPopId: rowId, colPopId: colId });
    // Honor the fields chosen at review time (selected_fields); if none set on
    // either population, default to every detected field (Crossbeam-style).
    const { rows: chosen } = await db.query<{ selected_fields: string[] | null }>(
      `select selected_fields from account_populations where id = any($1)`,
      [[rowId, colId]],
    );
    const chosenUnion = [...new Set(chosen.flatMap((c) => c.selected_fields ?? []))].filter((k) => fields.includes(k));
    const defaultFields = chosenUnion.length ? chosenUnion : fields;
    const selected = (cols ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const active = selected.length ? selected : [...BASE_COLS, ...defaultFields];
    const backHref = `/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}`;
    const cellBase = `/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}&row=${rowId}&col=${colId}`;

    const allToggles = [...BASE_COLS, ...fields];
    const toggleHref = (key: string) => {
      const next = active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
      return `${cellBase}${next.length ? `&cols=${next.join(",")}` : ""}`;
    };

    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Link href={backHref} className="pos-backlink !mb-0">← Matrix</Link>
          <h2 className="text-base font-semibold">
            {row?.name ?? "?"} <span className="text-neutral-400">vs</span> {col?.name ?? "?"}
          </h2>
          <span className="text-xs text-neutral-500">{accounts.length} account(s)</span>

          {/* Mapping → targeting: turn this cell into a target list */}
          <details className="relative ml-auto">
            <summary className="cursor-pointer rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">
              Build target list
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-2 text-label text-neutral-500">Creates an approved target list from these {accounts.length} accounts — ready to score, sequence, and campaign.</p>
              <form action={targetFromCellAction.bind(null, rowId, colId)} className="flex items-end gap-2">
                <input type="hidden" name="partner" value={partnerId ?? ""} />
                <input name="name" defaultValue={`${row?.name ?? ""} × ${col?.name ?? ""}`} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                <button className="shrink-0 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">Create</button>
              </form>
            </div>
          </details>

          <details className="relative">
            <summary className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">
              Columns
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-1 px-1 text-micro uppercase tracking-wide text-neutral-400">Toggle columns (from the data)</p>
              {allToggles.map((k) => (
                <Link
                  key={k}
                  href={toggleHref(k)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${active.includes(k) ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}
                >
                  <span className={`inline-block h-3 w-3 rounded-sm border ${active.includes(k) ? "border-blue-600 bg-blue-600" : "border-neutral-300 dark:border-neutral-600"}`} />
                  {k.replace(/_/g, " ")}
                </Link>
              ))}
            </div>
          </details>
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Record</th>
                {active.map((k) => <th key={k} className="capitalize">{k.replace(/_/g, " ")}</th>)}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.company_id}>
                  <td>
                    <Link href={`/accounts/${a.company_id}`} className="font-medium hover:underline">{a.legal_name}</Link>
                    {a.primary_domain && <div className="text-label text-neutral-400">{a.primary_domain}</div>}
                  </td>
                  {active.map((k) => {
                    if (k === "industry") return <td key={k} className="text-neutral-600 dark:text-neutral-300">{a.industry ?? "—"}</td>;
                    if (k === "employees") return <td key={k} className="tnum text-neutral-600 dark:text-neutral-300">{a.employee_count == null ? "—" : Number(a.employee_count).toLocaleString()}</td>;
                    if (k === "propensity") return (
                      <td key={k}>
                        {a.score == null ? <span className="text-neutral-400">—</span> : (
                          <span className="inline-flex items-center gap-2">
                            <span className="tnum font-semibold">{Number(a.score).toFixed(0)}</span>
                            {a.band && <BandBadge band={a.band} />}
                          </span>
                        )}
                      </td>
                    );
                    const v = a.attributes?.[k];
                    const text = v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
                    return <td key={k} className="text-neutral-600 dark:text-neutral-300">{text}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  });
}

async function PopulationManager() {
  return withTenant(async (db, orgId) => {
    const { rows: partners } = await db.query<{ id: string; name: string }>(
      `select id, name from partners where org_id = $1 order by name`,
      [orgId],
    );
    const pending = await listPopulations(db, { orgId, partnerId: null, status: "pending" });
    const pendingPartner: Population[] = [];
    for (const p of partners) pendingPartner.push(...(await listPopulations(db, { orgId, partnerId: p.id, status: "pending" })));
    const allPending = [...pending, ...pendingPartner];

    const nameFor = (pid: string | null) => (pid ? partners.find((p) => p.id === pid)?.name ?? "Partner" : "Your side");

    return (
      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Account lists</h2>

        {allPending.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">Pending approval — vet before they map</p>
            <div className="space-y-1.5">
              {allPending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-500">{nameFor(p.partner_id)} · {CATEGORY_LABEL[p.category]} · {p.members} accounts</span>
                  <span className="ml-auto flex gap-1">
                    <form action={setPopulationStatusAction.bind(null, p.id, "approved")}>
                      <button className="text-xs font-medium text-positive hover:underline dark:text-green-400">approve</button>
                    </form>
                    <form action={setPopulationStatusAction.bind(null, p.id, "rejected")}>
                      <button className="text-xs font-medium text-red-700 hover:underline dark:text-red-400">reject</button>
                    </form>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form action={createPopulationAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Name</span>
            <input name="name" placeholder="e.g. Corporate Territory East" className="w-52 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Category</span>
            <select name="category" defaultValue="customer" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              {(CATEGORIES as readonly Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Side</span>
            <select name="side" defaultValue="org" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <option value="org">Your side</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
            Propose list
          </button>
        </form>
        <p className="mt-2 text-label text-neutral-400">
          Members + fields (territory, vertical, segment, owner, contacts) come from a CSV ingest — the attributes model
          is ready; the ingest wiring is the next step. Proposed lists start pending until approved.
        </p>
      </Card>
    );
  });
}
