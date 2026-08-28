import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import {
  BAND_LABELS,
  BandBadge,
  CountChip,
  DimensionBars,
  FilterPill,
  PageHeader,
  SearchBox,
  SortHeader,
  Toolbar,
} from "@/components/ui";
import { QuerySelect } from "@/components/query-select";

export const dynamic = "force-dynamic";

const BANDS = ["very_high", "high", "medium", "low"] as const;
const BAND_TONES: Record<string, "green" | "sky" | "amber" | "neutral"> = {
  very_high: "green",
  high: "sky",
  medium: "amber",
  low: "neutral",
};
const DIM_ORDER = [
  "purchase_need",
  "purchase_propensity",
  "timing",
  "solution_fit",
  "evidence_confidence",
  "corroboration",
  "convergence",
];

/**
 * Configurable columns (#57) — the same URL-driven pattern as the mapping-room
 * matrix picker: a popover of checkboxes toggles the `cols` param, so a column
 * set is shareable and bookmarkable. Account name is always shown.
 */
const COLUMNS: { key: string; label: string; default: boolean }[] = [
  { key: "industry", label: "Industry", default: true },
  { key: "score", label: "Score", default: true },
  { key: "band", label: "Band", default: true },
  { key: "partners", label: "Partners", default: true },
  { key: "opps", label: "Open opps", default: true },
  { key: "pipeline", label: "Pipeline", default: true },
  { key: "evidence", label: "Evidence", default: true },
  { key: "dims", label: "Dimensions", default: false },
  { key: "delta", label: "Δ score", default: false },
  { key: "routed", label: "Routed partner", default: false },
  { key: "location", label: "Location", default: false },
  { key: "refresh", label: "Refresh", default: false },
];
const COL_KEYS = COLUMNS.map((c) => c.key);
const DEFAULT_COLS = COLUMNS.filter((c) => c.default).map((c) => c.key);

interface Params {
  band?: string;
  q?: string;
  sort?: string;
  industry?: string;
  partner?: string;
  cols?: string;
}

function buildQS(params: Params, overrides: Partial<Params>): string {
  const merged = { ...params, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const { band, q, industry, partner } = params;
  const sort = params.sort ?? "-score";

  const activeCols = params.cols
    ? params.cols.split(",").filter((k) => COL_KEYS.includes(k))
    : DEFAULT_COLS;
  const show = (k: string) => activeCols.includes(k);
  const toggleCols = (k: string) => {
    const set = new Set(activeCols);
    if (set.has(k)) set.delete(k);
    else set.add(k);
    return COL_KEYS.filter((x) => set.has(x)).join(",");
  };

  const { all, partnerRows, oppRows, dimRows } = await withTenant(async (db) => {
    const { rows: all } = await db.query(
      `select latest.*, pt.partner_name, pt.team_status,
            c.refresh_tier, c.next_refresh_at, c.country, c.state,
            (select count(*) from evidence e
              where e.company_id = latest.company_id and e.status = 'verified') as evidence_count
     from (
       select distinct on (p.company_id)
         p.id as score_id, p.company_id, p.score, p.band, p.changes,
         c2.legal_name, c2.industry, n.slug
       from propensity_scores p
       join companies c2 on c2.id = p.company_id
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
       order by p.company_id, p.computed_at desc
     ) latest
     join companies c on c.id = latest.company_id
     left join lateral (
       select pa.name as partner_name, t.status as team_status
       from pursuit_teams t join partners pa on pa.id = t.partner_id
       where t.company_id = latest.company_id and t.status in ('recommended','accepted')
       order by t.created_at desc limit 1) pt on true`,
    );

    const companyIds = all.map((r) => r.company_id);

    // Partners each account is associated with — from approved partner lists AND
    // pursuit routing. An account can carry several (multi-partner / multi-vendor
    // plays are real), so we keep the full set, not a single "routed" flag.
    const partnerRows = companyIds.length
      ? (await db.query<{ company_id: string; partners: string[] }>(
          `select company_id, array_agg(distinct name order by name) as partners from (
         select pm.company_id, p.name
         from population_members pm
         join account_populations ap on ap.id = pm.population_id and ap.partner_id is not null and ap.status = 'approved'
         join partners p on p.id = ap.partner_id
         where pm.company_id = any($1)
         union
         select t.company_id, pa.name
         from pursuit_teams t join partners pa on pa.id = t.partner_id
         where t.company_id = any($1) and t.status in ('recommended','accepted')
       ) x group by company_id`,
          [companyIds],
        )).rows
      : [];

    // Open-opportunity rollup per account (count + pipeline $).
    const oppRows = companyIds.length
      ? (await db.query<{ company_id: string; open: string; pipeline: string }>(
          `select company_id,
              count(*) filter (where stage not like 'closed%') as open,
              coalesce(sum(amount_usd) filter (where stage not like 'closed%'), 0) as pipeline
       from opportunities where company_id = any($1) group by company_id`,
          [companyIds],
        )).rows
      : [];

    const { rows: dimRows } = await db.query(
      `select score_id, dimension, value from propensity_dimensions where score_id = any($1)`,
      [all.map((r) => r.score_id)],
    );

    return { all, partnerRows, oppRows, dimRows };
  });

  const partnersByCompany = new Map<string, string[]>();
  for (const r of partnerRows) partnersByCompany.set(r.company_id, r.partners);
  const partnersOf = (id: string) => partnersByCompany.get(id) ?? [];

  const oppsByCompany = new Map<string, { open: number; pipeline: number }>();
  for (const r of oppRows) oppsByCompany.set(r.company_id, { open: Number(r.open), pipeline: Number(r.pipeline) });
  const oppsOf = (id: string) => oppsByCompany.get(id) ?? { open: 0, pipeline: 0 };

  const dimsByScore = new Map<string, Map<string, number>>();
  for (const d of dimRows) {
    const m = dimsByScore.get(d.score_id) ?? new Map();
    m.set(d.dimension, Number(d.value));
    dimsByScore.set(d.score_id, m);
  }

  const counts: Record<string, number> = { all: all.length };
  for (const b of BANDS) counts[b] = all.filter((r) => r.band === b).length;

  const industryOptions = [...new Set(all.map((r) => r.industry).filter(Boolean) as string[])].sort();
  const partnerOptions = [...new Set([...partnersByCompany.values()].flat())].sort();

  let rows = all;
  if (band) rows = rows.filter((r) => r.band === band);
  if (industry) rows = rows.filter((r) => r.industry === industry);
  if (partner) {
    if (partner === "__multi") rows = rows.filter((r) => partnersOf(r.company_id).length > 1);
    else if (partner === "__none") rows = rows.filter((r) => partnersOf(r.company_id).length === 0);
    else rows = rows.filter((r) => partnersOf(r.company_id).includes(partner));
  }
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.legal_name.toLowerCase().includes(needle) ||
        (r.industry ?? "").toLowerCase().includes(needle) ||
        partnersOf(r.company_id).some((p) => p.toLowerCase().includes(needle)),
    );
  }
  const key = sort.replace(/^-/, "");
  const dir = sort.startsWith("-") ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    const val = (r: (typeof rows)[number]) =>
      key === "score" ? Number(r.score)
      : key === "evidence" ? Number(r.evidence_count)
      : key === "opps" ? oppsOf(r.company_id).open
      : key === "pipeline" ? oppsOf(r.company_id).pipeline
      : key === "refresh" ? (r.next_refresh_at ? new Date(r.next_refresh_at).getTime() : Infinity)
      : String(r.legal_name).toLowerCase();
    const va = val(a);
    const vb = val(b);
    return va < vb ? -dir : va > vb ? dir : 0;
  });

  const makeSortHref = (s: string) => `/accounts${buildQS(params, { sort: s })}`;
  const activeFilters = band || q || industry || partner;

  return (
    <main>
      <PageHeader
        title="Accounts"
        subtitle={`${rows.length} of ${all.length} scored accounts — every number filters, every row explains itself.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <CountChip label="Total" value={counts.all} href={`/accounts${buildQS(params, { band: undefined })}`} active={!band} />
        {BANDS.map((b) => (
          <CountChip
            key={b}
            label={BAND_LABELS[b]}
            value={counts[b]}
            tone={BAND_TONES[b]}
            href={`/accounts${buildQS(params, { band: band === b ? undefined : b })}`}
            active={band === b}
          />
        ))}
      </div>

      <Toolbar
        actions={
          <div className="flex items-center gap-2">
            {/* Configure columns — same popover methodology as the mapping matrix */}
            <details className="relative">
              <summary className="cursor-pointer rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800">
                ☰ Columns
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                <p className="px-1.5 pb-1 text-micro uppercase tracking-wide text-neutral-400">Show columns</p>
                {COLUMNS.map((c) => {
                  const on = show(c.key);
                  return (
                    <Link
                      key={c.key}
                      href={`/accounts${buildQS(params, { cols: toggleCols(c.key) })}`}
                      className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${on ? "" : "text-neutral-400"}`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-sm border ${on ? "border-blue-600 bg-blue-600" : "border-neutral-300 dark:border-neutral-600"}`} />
                      {c.label}
                    </Link>
                  );
                })}
                <Link href={`/accounts${buildQS(params, { cols: undefined })}`} className="mt-1 block px-1.5 py-1 text-xs text-neutral-500 hover:underline">Reset to default</Link>
              </div>
            </details>
            <a
              href={`/accounts/export${buildQS(params, {})}`}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              ↓ CSV
            </a>
          </div>
        }
      >
        <SearchBox placeholder="Search accounts, industries, partners…" defaultValue={q} hidden={{ band, sort: params.sort, industry, partner, cols: params.cols }} />
        {industryOptions.length > 0 && (
          <QuerySelect param="industry" value={industry ?? "all"} label="Industry" options={[{ value: "all", label: "Any industry" }, ...industryOptions.map((i) => ({ value: i, label: i }))]} />
        )}
        <QuerySelect
          param="partner"
          value={partner ?? "all"}
          label="Partner"
          options={[
            { value: "all", label: "Any partner" },
            { value: "__multi", label: "Multi-partner" },
            { value: "__none", label: "Unmapped" },
            ...partnerOptions.map((p) => ({ value: p, label: p })),
          ]}
        />
        {activeFilters && (
          <>
            {band && <FilterPill label={`Band: ${BAND_LABELS[band] ?? band}`} clearHref={`/accounts${buildQS(params, { band: undefined })}`} />}
            {industry && <FilterPill label={industry} clearHref={`/accounts${buildQS(params, { industry: undefined })}`} />}
            {partner && <FilterPill label={`Partner: ${partner === "__multi" ? "multi" : partner === "__none" ? "unmapped" : partner}`} clearHref={`/accounts${buildQS(params, { partner: undefined })}`} />}
            {q && <FilterPill label={`“${q}”`} clearHref={`/accounts${buildQS(params, { q: undefined })}`} />}
            <Link href="/accounts" className="text-xs text-neutral-500 hover:underline">Clear all</Link>
          </>
        )}
      </Toolbar>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white scroll-thin dark:border-neutral-800 dark:bg-neutral-900">
        <table className="data-table">
          <thead>
            <tr>
              <th><SortHeader label="Account" sortKey="name" current={sort} makeHref={makeSortHref} /></th>
              {show("industry") && <th>Industry</th>}
              {show("score") && <th><SortHeader label="Score" sortKey="score" current={sort} makeHref={makeSortHref} /></th>}
              {show("band") && <th>Band</th>}
              {show("partners") && <th>Partners</th>}
              {show("opps") && <th className="text-right"><SortHeader label="Open opps" sortKey="opps" current={sort} makeHref={makeSortHref} /></th>}
              {show("pipeline") && <th className="text-right"><SortHeader label="Pipeline" sortKey="pipeline" current={sort} makeHref={makeSortHref} /></th>}
              {show("dims") && <th>Dims</th>}
              {show("delta") && <th>Δ</th>}
              {show("routed") && <th>Routed partner</th>}
              {show("evidence") && <th className="text-right"><SortHeader label="Evidence" sortKey="evidence" current={sort} makeHref={makeSortHref} /></th>}
              {show("location") && <th>Location</th>}
              {show("refresh") && <th><SortHeader label="Refresh" sortKey="refresh" current={sort} makeHref={makeSortHref} /></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={activeCols.length + 1} className="py-8 text-center text-neutral-500">
                  No accounts match — clear filters or ingest and score accounts.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const dims = dimsByScore.get(r.score_id);
              const delta = r.changes?.delta;
              const refreshDue = r.next_refresh_at && new Date(r.next_refresh_at).getTime() < Date.now();
              const ps = partnersOf(r.company_id);
              const o = oppsOf(r.company_id);
              return (
                <tr key={r.company_id}>
                  <td>
                    <Link href={`/accounts/${r.company_id}`} className="font-medium text-blue-800 hover:underline dark:text-blue-300">{r.legal_name}</Link>
                  </td>
                  {show("industry") && <td className="text-neutral-500">{r.industry ?? "—"}</td>}
                  {show("score") && <td className="tnum text-base font-semibold">{Number(r.score).toFixed(0)}</td>}
                  {show("band") && <td><BandBadge band={r.band} /></td>}
                  {show("partners") && (
                    <td>
                      {ps.length === 0 ? (
                        <span className="text-neutral-300 dark:text-neutral-600">unmapped</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {ps.map((p) => (
                            <Link key={p} href={`/accounts${buildQS(params, { partner: p })}`} className="rounded bg-neutral-100 px-1.5 py-0.5 text-micro font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300">{p}</Link>
                          ))}
                        </span>
                      )}
                    </td>
                  )}
                  {show("opps") && <td className="tnum text-right text-neutral-600 dark:text-neutral-300">{o.open || <span className="text-neutral-300 dark:text-neutral-600">—</span>}</td>}
                  {show("pipeline") && <td className="tnum text-right text-neutral-600 dark:text-neutral-300">{o.pipeline ? `$${Math.round(o.pipeline / 1000)}k` : <span className="text-neutral-300 dark:text-neutral-600">—</span>}</td>}
                  {show("dims") && <td>{dims ? <DimensionBars values={DIM_ORDER.map((d) => dims.get(d) ?? 0)} /> : <span className="text-neutral-300">—</span>}</td>}
                  {show("delta") && (
                    <td className={`tnum text-xs font-medium ${delta > 0 ? "text-positive dark:text-green-400" : delta < 0 ? "text-red-700 dark:text-red-400" : "text-neutral-400"}`}>
                      {delta == null ? "—" : delta > 0 ? `+${delta}` : `${delta}`}
                    </td>
                  )}
                  {show("routed") && (
                    <td className="text-neutral-600 dark:text-neutral-400">
                      {r.partner_name ?? <span className="text-neutral-300 dark:text-neutral-600">unrouted</span>}
                      {r.team_status === "accepted" && <span className="ml-1 text-micro font-semibold uppercase text-positive dark:text-green-400">✓</span>}
                    </td>
                  )}
                  {show("evidence") && <td className="tnum text-right text-neutral-500">{r.evidence_count}</td>}
                  {show("location") && <td className="text-xs text-neutral-500">{[r.state, r.country].filter(Boolean).join(", ") || "—"}</td>}
                  {show("refresh") && (
                    <td className={`text-xs ${refreshDue ? "font-semibold text-amber-700 dark:text-amber-400" : "text-neutral-400"}`}>
                      {r.next_refresh_at ? new Date(r.next_refresh_at).toISOString().slice(0, 10) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
